/**
 * Main-thread gestures (Background-Thread side).
 *
 * Lynx has a native gesture-recognizer system (pan / fling / tap / longpress /
 * rotation / pinch, plus relations between them — `waitFor`, `simultaneousWith`,
 * `continueWith` — for composing e.g. "this pan only wins if that tap loses")
 * that runs entirely on the Main Thread: `__SetGestureDetector(dom, id, type,
 * config, relationMap)`, confirmed by reading `@lynx-js/react`'s bundled
 * `runtime/lib/snapshot/gesture/processGesture.js` (ReactLynx's own gesture
 * support compiles a user-authored `Gesture` builder down to exactly this PAPI
 * call — that builder itself isn't vendored here, but the underlying wire
 * contract it targets is what this module speaks directly).
 *
 * A gesture's callbacks (`onStart`/`onUpdate`/`onEnd`/… — the exact set is
 * engine/version-dependent; Lynx invokes whichever ones you register) are
 * **worklets**: `processGesture.js` treats `callbacks: Record<string, Worklet>`
 * exactly like `[lynxMainThread]`'s event map treats its worklet refs, so this
 * directive reuses the same `defineWorklet`/`registerWorklet` machinery
 * (`ng-lynx/worklet`) — no new Main-Thread registration mechanism needed.
 *
 * @remarks
 * **Experimental.** It needs `pluginAngularLynx({ enableNewGesture: true })`.
 * Pan has run on Explorer 4.2 on iOS and Android; tap, long press, a `waitFor`
 * relation and `ctx.gesture.fail()`/`end()` on iOS only. The web preview's
 * detectors are no-ops (web-core 0.26). See docs/32-gestures.md.
 */
import {
  Directive,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  type OnDestroy,
  type OnInit,
  Output,
} from '@angular/core';

import { OP } from 'ng-lynx/internal/ops';

import { register, unregister } from './event-registry.js';
import { scheduleFlush } from './flush.js';
import { pushOp } from './ops.js';
import type { ShadowElement } from './shadow-element.js';
import { toWorkletRef, type WorkletHandle, type WorkletRef } from './worklet.js';

/**
 * Numeric gesture-type codes the native `__SetGestureDetector` PAPI expects —
 * mirrors `GestureTypeInner` in `@lynx-js/react`'s bundled worklet-runtime
 * (`runtime/lib/snapshot/gesture/types.js`: `PAN: 0, FLING: 1, DEFAULT: 2, TAP:
 * 3, LONGPRESS: 4, ROTATION: 5, PINCH: 6, NATIVE: 7`). `COMPOSED` (`-1`, a
 * nested AND-group of sub-gestures) is deliberately not exposed here — every
 * base gesture on an element gets its own `__SetGestureDetector` call already
 * (the common case per `processGesture.js`'s own "fast path"), related via
 * `waitFor`/`simultaneousWith`/`continueWith` below; a true composed tree is a
 * follow-up if a real use case needs it.
 */
export const GESTURE_TYPE = {
  pan: 0,
  fling: 1,
  default: 2,
  tap: 3,
  longpress: 4,
  rotation: 5,
  pinch: 6,
  native: 7,
} as const;

/** @public */
export type LynxGestureType = keyof typeof GESTURE_TYPE;

/**
 * One gesture detector bound on an element. `callbacks` keys are the
 * gesture-phase names the native engine invokes as worklets (commonly
 * `onStart`/`onUpdate`/`onEnd`/`onTouchesDown`/`onTouchesMove`/`onTouchesUp` —
 * see the module doc's confidence caveat). `waitFor`/`simultaneousWith`/
 * `continueWith` reference *other keys in the same `[lynxGesture]` map* on
 * this element, resolved to the native numeric gesture ids at bind time.
 *
 * @public
 */
export interface LynxGestureDescriptor {
  type: LynxGestureType;
  /** Gesture-phase name → worklet (a `defineWorklet` or `bindWorklet` handle, or a string id for `registerWorklet`). */
  callbacks: Record<string, string | WorkletHandle<never>>;
  /** Native gesture-specific tuning (e.g. pan direction/distance) — passed through as-is. */
  config?: Record<string, unknown>;
  /** Local keys this gesture must wait to lose to before it can activate. */
  waitFor?: string[];
  /** Local keys this gesture may recognize simultaneously with. */
  simultaneousWith?: string[];
  /** Local keys enabled to continue recognizing once this gesture ends. */
  continueWith?: string[];
}

/** `[lynxGesture]`'s input value: local key → gesture descriptor. @public */
export type LynxGestures = Record<string, LynxGestureDescriptor>;

/** Native gesture ids are unique per Background-Thread session (like element/worklet ids). */
let nextGestureId = 1;

/**
 * The wire shape a gesture callback's `callback` value must carry — the same
 * `_elId`/`_bgCallbackId`-augmented worklet ref `[lynxMainThread]` sends (see
 * `worklet.ts`'s `WorkletRef`): `_elId` is what the Main Thread's
 * `makeDispatcher` uses to resolve *which* element to build a
 * `WorkletContext` for (a gesture callback has no other way to reach it —
 * `__SetGestureDetector`'s callback list carries only worklet refs, not
 * element ids), and `_bgCallbackId` is what routes `ctx.runOnBackground(...)`
 * to this directive's `(mainThreadCallback)` output.
 */
function workletRef(
  worklet: string | WorkletHandle<never>,
  elId: number,
  bgCallbackId: string,
  gestureId: number,
): WorkletRef & { _workletType: 'main-thread'; _elId: number; _gestureId: number } {
  return { ...toWorkletRef(worklet, bgCallbackId), _workletType: 'main-thread', _elId: elId, _gestureId: gestureId };
}

/**
 * Bind one or more native gesture detectors on an element.
 *
 * @example
 * ```html
 * <view
 *   [lynxGesture]="{ pan: { type: 'pan', callbacks: { onStart, onUpdate, onEnd } } }"
 *   (mainThreadCallback)="onGestureMessage($event)">
 * </view>
 * ```
 * The callbacks must be worklets (author them in a Main-Thread module exactly
 * like `[lynxMainThread]`'s — see `ng-lynx/worklet`'s `defineWorklet`).
 * `ctx.runOnBackground(...)` from *any* gesture's *any* callback on this
 * element surfaces at the shared `(mainThreadCallback)` output — same
 * one-emitter-per-binding model as `[lynxMainThread]`. Binds once, at
 * `ngOnInit` — like `[lynxMainThread]`, this directive doesn't support
 * dynamically changing the gesture map after the first bind.
 *
 * @public
 */
@Directive({
  selector: '[lynxGesture]',
  standalone: true,
})
export class LynxGesture implements OnInit, OnDestroy {
  @Input('lynxGesture') gestures: LynxGestures = {};

  /** Receives values passed to `ctx.runOnBackground(...)` from any gesture callback on this element. */
  @Output('mainThreadCallback') readonly mainThreadCallback = new EventEmitter<unknown>();

  private readonly elRef = inject(ElementRef);
  private bgCallbackId: string | undefined;

  ngOnDestroy(): void {
    if (this.bgCallbackId !== undefined) unregister(this.bgCallbackId);
  }

  ngOnInit(): void {
    const el = this.elRef.nativeElement as ShadowElement;
    const bgCallbackId = (this.bgCallbackId = register((data) => this.mainThreadCallback.emit(data)));
    const entries = Object.entries(this.gestures);
    const localIds = new Map<string, number>();
    for (const [key] of entries) localIds.set(key, nextGestureId++);

    // Writing a style to a flattened view mid-gesture stops its detector for good on
    // Android (Explorer 4.2), and gestures usually move their element.
    pushOp(OP.SET_ATTR, el.id, 'flatten', false);

    const resolveIds = (keys: string[] | undefined): number[] =>
      (keys ?? [])
        .map((k) => localIds.get(k))
        .filter((id): id is number => id !== undefined);

    for (const [key, gesture] of entries) {
      const config: Record<string, unknown> = {
        callbacks: Object.entries(gesture.callbacks).map(([name, worklet]) => ({
          name,
          callback: workletRef(worklet, el.id, bgCallbackId, localIds.get(key)!),
        })),
      };
      if (gesture.config) config['config'] = gesture.config;
      const relationMap = {
        waitFor: resolveIds(gesture.waitFor),
        simultaneous: resolveIds(gesture.simultaneousWith),
        continueWith: resolveIds(gesture.continueWith),
      };
      pushOp(
        OP.SET_GESTURE_DETECTOR,
        el.id,
        localIds.get(key)!,
        GESTURE_TYPE[gesture.type],
        config,
        relationMap,
      );
    }
    scheduleFlush();
  }
}

/** Reset the gesture-id counter — for testing (deterministic ids across sequential renders). */
export function resetGestureState(): void {
  nextGestureId = 1;
}
