/**
 * Main-thread worklets (Background-Thread side).
 *
 * A *worklet* is a function that runs on the Main Thread in response to a native
 * event — no Background-Thread round-trip — so it can read the event and mutate
 * the element at gesture rate. The worklet body is registered on the Main Thread
 * by string id (see `angular-lynx/worklet`'s `registerWorklet`); the Background
 * Thread only binds an event to that id.
 *
 * @remarks
 * This is angular-lynx's **explicit** worklet model: author the worklet in a
 * Main-Thread module (with `defineWorklet` for a typed reference, or
 * `registerWorklet` for a string id) and bind it via `[lynxMainThread]`. The
 * inline `'main thread'` directive that auto-extracts a closure (as in ReactLynx)
 * isn't possible here — the AOT compiler (`@ngtools/webpack`) reads component
 * sources from disk, bypassing any build transform, and a closure can't be
 * relocated into the separate Main-Thread bundle. See docs/11-worklets.md.
 */
import {
  Directive,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  type OnChanges,
  type OnDestroy,
  Output,
  type SimpleChanges,
} from '@angular/core';

import { type BoundWorklet, OP, type WorkletHandle } from 'angular-lynx/internal/ops';

import { register, unregister } from './event-registry.js';
import { scheduleFlush } from './flush.js';
import { pushOp } from './ops.js';
import type { ShadowElement } from './shadow-element.js';

export type { WorkletHandle };

/**
 * Map of native event name → worklet: a string id (matching a
 * `registerWorklet(id, …)` call), a {@link WorkletHandle} from `defineWorklet`, or
 * one from `bindWorklet`, which gives this binding its own `ctx.params`.
 * e.g. `{ tap: 'onTapMT' }`, `{ tap: onTapMT }`, `{ tap: bindWorklet(onTapMT, state) }`.
 */
export type MainThreadEvents = Record<string, string | WorkletHandle<never>>;

/** Serialized reference to a main-thread worklet, sent across the wire. */
export interface WorkletRef {
  _wkltId: string;
  /** Sign of the Background callback the worklet may invoke via runOnBackground. */
  _bgCallbackId?: string;
  /** The binding's `ctx.params`. */
  _params?: unknown;
}

/** The wire form of one entry of a {@link MainThreadEvents}. */
export function toWorkletRef(worklet: string | WorkletHandle<never>, bgCallbackId: string): WorkletRef {
  if (typeof worklet === 'string') return { _wkltId: worklet, _bgCallbackId: bgCallbackId };
  const params = (worklet as Partial<BoundWorklet<unknown>>)._params;
  return params === undefined
    ? { _wkltId: worklet._wkltId, _bgCallbackId: bgCallbackId }
    : { _wkltId: worklet._wkltId, _bgCallbackId: bgCallbackId, _params: params };
}

/**
 * Bind native events on an element to main-thread worklets.
 *
 * @example
 * ```html
 * <view
 *   [lynxMainThread]="{ tap: 'onTapMT', scroll: 'onScrollMT' }"
 *   (mainThreadCallback)="onWorkletMessage($event)">
 * </view>
 * ```
 * The worklets `onTapMT` / `onScrollMT` must be registered on the Main Thread
 * with `registerWorklet(id, fn)`. From inside a worklet, `ctx.runOnBackground(x)`
 * routes `x` to `(mainThreadCallback)`. A new value for the input rebinds the events.
 *
 * @public
 */
@Directive({
  selector: '[lynxMainThread]',
  standalone: true,
})
export class LynxMainThread implements OnChanges, OnDestroy {
  @Input('lynxMainThread') events: MainThreadEvents = {};

  /** Receives values passed to `ctx.runOnBackground(...)` from a worklet. */
  @Output('mainThreadCallback') readonly mainThreadCallback = new EventEmitter<unknown>();

  // `inject()` rather than a constructor param: constructor DI needs decorator
  // metadata, which some bundlers (e.g. esbuild) don't emit.
  private readonly elRef = inject(ElementRef);
  private bgCallbackId: string | undefined;

  ngOnChanges(changes: SimpleChanges): void {
    const el = this.elRef.nativeElement as ShadowElement;
    this.bgCallbackId ??= register((data) => this.mainThreadCallback.emit(data));
    const previous = (changes['events']?.previousValue ?? {}) as MainThreadEvents;
    for (const event of Object.keys(previous)) {
      if (!(event in this.events)) pushOp(OP.REMOVE_EVENT, el.id, 'bindEvent', event);
    }
    for (const [event, worklet] of Object.entries(this.events)) {
      if (previous[event] !== worklet) {
        pushOp(OP.SET_WORKLET_EVENT, el.id, 'bindEvent', event, toWorkletRef(worklet, this.bgCallbackId));
      }
    }
    scheduleFlush();
  }

  ngOnDestroy(): void {
    if (this.bgCallbackId !== undefined) unregister(this.bgCallbackId);
  }
}

/**
 * Bind an element to a **main-thread ref** (from `defineMainThreadRef`) so a
 * worklet can reach it imperatively — e.g. tap one element, mutate another.
 *
 * @example
 * ```html
 * <view [lynxMainThreadRef]="card">…</view>            <!-- the ref target -->
 * <view [lynxMainThread]="{ tap: fadeCard }">Tap</view> <!-- worklet uses card.current -->
 * ```
 * @public
 */
@Directive({
  selector: '[lynxMainThreadRef]',
  standalone: true,
})
export class LynxMainThreadRef implements OnChanges, OnDestroy {
  /** A ref from `mainThreadRef()` or `defineMainThreadRef` (only its `_refId` is read here). */
  @Input('lynxMainThreadRef') ref!: { readonly _refId: string };

  private readonly elRef = inject(ElementRef);

  ngOnChanges(changes: SimpleChanges): void {
    const id = (this.elRef.nativeElement as ShadowElement).id;
    const previous = changes['ref']?.previousValue as { readonly _refId: string } | undefined;
    if (previous) pushOp(OP.SET_REF, -id, previous._refId);
    pushOp(OP.SET_REF, id, this.ref._refId);
    scheduleFlush();
  }

  ngOnDestroy(): void {
    pushOp(OP.SET_REF, -(this.elRef.nativeElement as ShadowElement).id, this.ref._refId);
    scheduleFlush();
  }
}
