/**
 * Main-thread worklets (Main-Thread side).
 *
 * Worklets are plain functions registered by string id with {@link registerWorklet}
 * from a Main-Thread module. When a native event bound via `[lynxMainThread]`
 * fires, the runtime runs the worklet here on the Main Thread — synchronously,
 * with no Background round-trip — passing a {@link WorkletContext} for reading
 * the event, mutating the element, and (optionally) calling back to the
 * Background Thread.
 *
 * @remarks
 * **This integrates with Lynx's real worklet runtime — it is not a from-scratch
 * mechanism.** An earlier version of this file passed a raw JS function as
 * `__AddEvent`'s 4th argument; that's silently a no-op on a real engine (web or
 * native): `__AddEvent` only routes a `string` (cross-thread sign →
 * `publishEvent`) or an `object` (→ the native worklet runtime) — never a
 * function. Confirmed by reading both `@lynx-js/web-core`'s real `__AddEvent`
 * (the `typeof` dispatch) and `@lynx-js/react`'s real worklet-runtime
 * (`runtime/worklet-runtime/main.js`, bundled into the Main-Thread entry by
 * `pluginAngularLynx` — see `plugin/src/index.ts`).
 *
 * The real runtime's contract (traced directly from that source):
 *   1. `__AddEvent(el, type, name, { type: 'worklet', value: ctx })`, where
 *      `ctx` carries `_wkltId` (and `_workletType: 'main-thread'`).
 *   2. On fire, the native side round-trips back into JS and calls
 *      `globalThis.runWorklet(ctx, [nativeEvent])`, which resolves
 *      `lynxWorkletImpl._workletMap[ctx._wkltId]`, **binds it to a copy of
 *      `ctx` as `this`**, and calls it with the event as the argument.
 *   3. `globalThis.registerWorkletInternal(type, id, fn)` is just
 *      `lynxWorkletImpl._workletMap[id] = fn` — generic storage. The
 *      surrounding machinery (`_c`/`_jsFn` closure capture, the SWC
 *      `'main thread'` extraction transform) only matters for inline closures
 *      that capture component-scope variables; our explicit, hand-authored
 *      top-level functions don't need any of it.
 *
 * `ctx` is **our own data** beyond the two required keys, so it carries the
 * bound element's BG id (`_elId`) and the Background-callback sign
 * (`_bgCallbackId`) — recovered via `this` inside the registered dispatcher —
 * to build the same ergonomic {@link WorkletContext} (`setStyle`/`setAttribute`/
 * `runOnBackground`) this package has always exposed publicly. The real
 * runtime has no equivalent shortcut for "mutate the element the event fired
 * on" — ReactLynx users reach for an explicit ref even for that — so this
 * remains a deliberate ergonomic improvement, not a compatibility shim.
 *
 * Main-thread refs (`defineMainThreadRef` / `[lynxMainThreadRef]` / `SET_REF`
 * below) needed **no changes** for this fix: `applySetRef` never calls
 * `__AddEvent` — it's pure bookkeeping (an id→id map), so it was never subject
 * to the typeof-dispatch problem above.
 */
import {
  BACKGROUND_CALL_EVENT,
  BACKGROUND_RESULT_EVENT,
  type BackgroundFunctionHandle,
  bindWorklet,
  type BoundWorklet,
  MAIN_THREAD_RESULT_EVENT,
  type MainThreadFunctionHandle,
  type MainThreadRef,
  type MainThreadRefHandle,
  PAGE_ROOT_ID,
  RUN_ON_BACKGROUND_EVENT,
  type ToMainThread,
  type WorkletHandle,
} from 'angular-lynx/internal/ops';

import { type LynxDataProcessorDefinition, registerDataProcessors } from './data-processors.js';
import { elements } from './element-registry.js';

export type { LynxDataProcessor, LynxDataProcessorDefinition } from './data-processors.js';

export {
  bindWorklet,
  type BackgroundFunctionHandle,
  type BoundWorklet,
  type MainThreadFunctionHandle,
  type MainThreadRef,
  type MainThreadRefHandle,
  type ToMainThread,
  type WorkletHandle,
};

/** Serialized worklet reference received from the Background Thread. */
interface WorkletRef {
  _wkltId: string;
  _bgCallbackId?: string;
  _params?: unknown;
}

/**
 * The wire shape `__AddEvent`'s real worklet path expects as its 4th
 * argument's `value`. `_wkltId` and `_workletType` are what the engine itself
 * requires; `_elId` / `_bgCallbackId` are angular-lynx's own extra fields,
 * recovered via `this` inside the registered dispatcher (see
 * {@link makeDispatcher}) — the real runtime tolerates arbitrary extra keys.
 */
interface WireWorkletCtx {
  _wkltId: string;
  _workletType: 'main-thread';
  _elId: number;
  _bgCallbackId?: string;
  _params?: unknown;
  /** `_params` with its handles made live, on first use. */
  _liveParams?: unknown;
  /** The detector this is a phase of, for a `[lynxGesture]` callback. */
  _gestureId?: number;
}

/**
 * The engine's second argument to a gesture callback: its state manager.
 * `__SetGestureState(element, gestureId, 1 | 2 | 3)` (active, fail, end) is what
 * `@lynx-js/gesture-runtime` calls. Explorer 4.2 on iOS has no `active`/`fail`/`end`
 * methods on it, so those threw "not a function" (measured 2026-11-10); they're
 * only a fallback now.
 */
interface LepusGesture {
  __SetGestureState?(element: LynxElement, gestureId: number, state: 1 | 2 | 3): void;
  active?(gestureId: number): void;
  fail?(gestureId: number): void;
  end?(gestureId: number): void;
  scrollBy(deltaX: number, deltaY: number): MainThreadScrollResult;
}

const GESTURE_STATE = { active: 1, fail: 2, end: 3 } as const;

/** Move a detector to `state`, the way the engine's own gesture runtime does. */
function setGestureState(
  gesture: LepusGesture,
  el: LynxElement,
  gestureId: number,
  state: keyof typeof GESTURE_STATE,
): void {
  if (typeof gesture.__SetGestureState === 'function') {
    gesture.__SetGestureState(el, gestureId, GESTURE_STATE[state]);
  } else {
    gesture[state]?.(gestureId);
  }
}

/**
 * `registerWorkletInternal` from `@lynx-js/react`'s worklet-runtime, bundled
 * into the Main-Thread entry by `pluginAngularLynx` (see `plugin/src/index.ts`).
 * Declared loosely here rather than imported — it's a `globalThis` side effect
 * of that bundled module, not something this file imports directly.
 */
declare const registerWorkletInternal:
  | ((type: string, id: string, fn: (this: WireWorkletCtx, ...args: unknown[]) => unknown) => void)
  | undefined;

/** The element an event carries as `target`/`currentTarget`: Lynx's `MainThread.Element`. */
export type MainThreadEventTarget = Omit<MainThreadElement, 'setStyle' | 'getComputedStyleProperty'> & {
  readonly dataset?: Record<string, unknown>;
  readonly id?: string;
  readonly uid?: number;
};

/** One finger of a {@link MainThreadTouchEvent}. @public */
export interface MainThreadTouch {
  readonly identifier: number;
  /** Relative to the element the listener is on. */
  readonly x: number;
  readonly y: number;
  readonly pageX: number;
  readonly pageY: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** What {@link MainThreadGesture.scrollBy} reports. @public */
export interface MainThreadScrollResult {
  consumedX: number;
  consumedY: number;
  unconsumedX: number;
  unconsumedY: number;
}

/**
 * `ctx.gesture` in a `[lynxGesture]` phase: this detector's standing in the engine's
 * gesture arena. A pan activates by itself once the finger has moved. Use these to end
 * it early, or to give the touch to the next candidate.
 *
 * @public
 */
export interface MainThreadGesture {
  /** Activate this gesture. */
  active(): void;
  /** Give up, so the next gesture in the arena gets the touch. */
  fail(): void;
  /** End this gesture, for the rest of the touch. */
  end(): void;
  /** Scroll the element the gesture is on. */
  scrollBy(deltaX: number, deltaY: number): MainThreadScrollResult;
}

/** What a worklet gets as `ctx.event`. @public */
export interface MainThreadEvent {
  readonly type: string;
  readonly timestamp: number;
  readonly target: MainThreadEventTarget;
  readonly currentTarget: MainThreadEventTarget;
  readonly detail: Record<string, unknown>;
  stopPropagation?(): void;
  stopImmediatePropagation?(): void;
  preventDefault?(): void;
}

/** `ctx.event` for a touch event: `WorkletContext<MainThreadTouchEvent>`. @public */
export interface MainThreadTouchEvent extends MainThreadEvent {
  readonly touches: readonly MainThreadTouch[];
  readonly changedTouches: readonly MainThreadTouch[];
}

/** `ctx.event` in a `[lynxGesture]` phase: `WorkletContext<MainThreadGestureEvent>`. @public */
export interface MainThreadGestureEvent extends MainThreadEvent {
  /** Where the finger is, in logical pixels, and the element's scroll state. */
  readonly params: {
    readonly clientX: number;
    readonly clientY: number;
    readonly pageX: number;
    readonly pageY: number;
    /** Relative to the element the gesture is on. */
    readonly x: number;
    readonly y: number;
    readonly scrollX: number;
    readonly scrollY: number;
    readonly isAtStart: boolean;
    readonly isAtEnd: boolean;
  };
}

/**
 * What a worklet receives when it runs on the Main Thread. `E` types `ctx.event`,
 * and `P` types `ctx.params`, the values {@link bindWorklet} gave this binding.
 */
export interface WorkletContext<E = MainThreadEvent, P = unknown> {
  /** The native event object. */
  readonly event: E;
  /** The element the worklet is bound to. */
  readonly element: MainThreadElement;
  /** The values this binding got from {@link bindWorklet}. */
  readonly params: P;
  /** This detector's state, in a `[lynxGesture]` phase. `undefined` in any other event. */
  readonly gesture: MainThreadGesture | undefined;
  /** Set inline styles on the bound element (synchronous, on the MT). */
  setStyle(css: string): void;
  /** Set an attribute on the bound element (synchronous, on the MT). */
  setAttribute(key: string, value: unknown): void;
  /**
   * Read a resolved (computed) style value off the bound element, synchronously
   * on the MT — e.g. `ctx.getComputedStyleProperty('opacity')` to animate from
   * the current value.
   */
  getComputedStyleProperty(name: string): string;
  /** Send a value back to the Background Thread's `(mainThreadCallback)`. */
  runOnBackground(data: unknown): void;
}

/** A worklet body. */
export type Worklet<E = MainThreadEvent, P = unknown> = (ctx: WorkletContext<E, P>) => void;

/**
 * Build the function actually handed to `registerWorkletInternal`. The real
 * runtime calls this with `this` bound to a **copy of the wire ctx** (see the
 * module doc) — so `this._elId` / `this._bgCallbackId` recover what
 * `applySetWorkletEvent` stashed there, letting us build the same
 * {@link WorkletContext} the public API has always exposed, regardless of how
 * the real runtime resolved and invoked this function.
 */
function makeDispatcher(fn: Worklet<never, never>): (this: WireWorkletCtx, event: unknown, gesture: unknown) => void {
  return function (event, gesture): void {
    const el = elements.get(this._elId);
    if (!el) return;
    if (this._params !== undefined && this._liveParams === undefined) {
      this._liveParams = fromWire(this._params);
    }
    (fn as Worklet<unknown, unknown>)(
      new WorkletContextImpl(event, el, this._bgCallbackId, this._liveParams, gesture as LepusGesture | undefined, this._gestureId),
    );
  };
}

/** One per event, so a class rather than a dozen closures per `touchmove`. */
class WorkletContextImpl implements WorkletContext<unknown, unknown> {
  readonly element: MainThreadElement;
  readonly gesture: MainThreadGesture | undefined;

  constructor(
    readonly event: unknown,
    el: LynxElement,
    private readonly bgCallbackId: string | undefined,
    readonly params: unknown,
    gesture: LepusGesture | undefined,
    gestureId: number | undefined,
  ) {
    this.element = new MainThreadElementImpl(el);
    if (gesture && gestureId !== undefined) {
      this.gesture = {
        active: () => setGestureState(gesture, el, gestureId, 'active'),
        fail: () => setGestureState(gesture, el, gestureId, 'fail'),
        end: () => setGestureState(gesture, el, gestureId, 'end'),
        scrollBy: (deltaX, deltaY) => gesture.scrollBy(deltaX, deltaY),
      };
    }
  }

  setStyle(css: string): void {
    this.element.setStyle(css);
  }

  setAttribute(key: string, value: unknown): void {
    this.element.setAttribute(key, value);
  }

  getComputedStyleProperty(name: string): string {
    return this.element.getComputedStyleProperty(name);
  }

  runOnBackground(data: unknown): void {
    if (this.bgCallbackId === undefined) return;
    // BG and MT don't share a `globalThis` on a real engine (confirmed
    // on-device — an earlier version of this bridge assumed they did and
    // silently did nothing). Send via the real cross-thread event channel
    // instead: `lynx.getJSContext().dispatchEvent({type, data})` here is
    // received by the Background Thread's
    // `lynx.getCoreContext().addEventListener(type, …)` (entry-background.ts)
    // — the same generic pub/sub primitive the worklet-runtime itself uses
    // internally. Confirmed against `@lynx-js/web-core`'s real
    // `LynxCrossThreadContext`.
    lynx?.getJSContext?.()?.dispatchEvent({
      type: RUN_ON_BACKGROUND_EVENT,
      data: { sign: this.bgCallbackId, value: data },
    });
  }
}

/**
 * Resolve the `(id, fn)` overloads `registerWorklet`/`defineWorklet` share: a
 * bare `fn` derives its id from `fn.name`; an explicit `id` always wins (for
 * an anonymous function, or to pick a different id than the function's own
 * name). Throws on an empty derived id — that's a real bug, not a corner
 * case to tolerate: an anonymous arrow function (`(ctx) => {...}`) has
 * `fn.name === ''` even when assigned to a `const`, because name inference
 * from an assignment only applies when the function is the assignment's
 * *direct* right-hand side, not when it's passed as a call argument (which is
 * exactly what happens here) — so silently falling back to `''` would make
 * every anonymous worklet collide on the same `_workletMap['']` entry.
 */
function resolveIdAndFn<F extends { name: string }>(idOrFn: string | F, maybeFn: F | undefined): { id: string; fn: F } {
  const fn = typeof idOrFn === 'string' ? maybeFn! : idOrFn;
  const id = typeof idOrFn === 'string' ? idOrFn : idOrFn.name;
  if (!id) {
    throw new Error(
      "angular-lynx: can't derive a worklet id from an anonymous function — name it "
        + "(`function pressFade(ctx) { ... }`, not `(ctx) => { ... }`) so its `.name` "
        + "is available, or pass an explicit id (`defineWorklet('pressFade', fn)`).",
    );
  }
  return { id, fn };
}

/**
 * Register a main-thread worklet, via the real worklet-runtime's
 * `registerWorkletInternal` (`lynxWorkletImpl._workletMap[id] = …` — generic
 * storage, see the module doc). Call this from a module included in the
 * Main-Thread bundle.
 *
 * The id is derived from `fn.name` — give it a name
 * (`function pressFadeMT(ctx) { ... }`, not an anonymous arrow — see
 * {@link resolveIdAndFn} for why) — or pass an explicit id as the first
 * argument, the same as before. Either way it must be unique across your
 * whole Main-Thread bundle; nothing detects a collision (same as the
 * explicit-id form already had no such check).
 *
 * @public
 */
export function registerWorklet<E = MainThreadEvent, P = unknown>(fn: Worklet<E, P>): void;
export function registerWorklet<E = MainThreadEvent, P = unknown>(id: string, fn: Worklet<E, P>): void;
export function registerWorklet(idOrFn: string | Worklet<never, never>, maybeFn?: Worklet<never, never>): void {
  const { id, fn } = resolveIdAndFn(idOrFn, maybeFn);
  if (typeof registerWorkletInternal === 'undefined') {
    // Expected and harmless if this is the Background Thread's copy of a
    // worklet module: importing a typed `WorkletHandle` reference for a
    // template binding (`import { pressFade } from './worklets.js'`) pulls
    // the whole module into the BG bundle too, where the worklet-runtime was
    // never bundled (by design — see plugin/src/index.ts) and never will be.
    // `__FlushElementTree` (a Main-Thread-only PAPI global) distinguishes a
    // genuine misconfiguration — the runtime missing on the *actual* Main
    // Thread — from this normal case, so only the former warns.
    if (__DEV__ && typeof __FlushElementTree !== 'undefined') {
      console.warn(
        `[angular-lynx] registerWorklet('${id}') called before the worklet-runtime loaded — `
          + 'is the Main-Thread entry missing it? pluginAngularLynx bundles it automatically; '
          + 'a custom build setup needs to include `@lynx-js/react/worklet-runtime` itself.',
      );
    }
    return;
  }
  registerWorkletInternal('main-thread', id, makeDispatcher(fn));
}

/**
 * Register a worklet and return a **typed reference** to bind directly,
 * instead of a magic string. Author it in a Main-Thread module and import the
 * reference into your component:
 *
 * ```ts
 * // gestures.mt.ts  (a Main-Thread module, listed in `mainThreadModules`)
 * function pressFadeMT(ctx: WorkletContext): void {
 *   ctx.setStyle('opacity: 0.5');
 * }
 * export const pressFade = defineWorklet(pressFadeMT);
 *
 * // component
 * import { pressFade } from './gestures.mt';
 * // template: [lynxMainThread]="{ tap: pressFade }"
 * ```
 *
 * The id (the registry key) is derived from `fn.name` — name the function
 * (not an anonymous arrow); see {@link registerWorklet}. Pass an explicit id
 * as the first argument instead if you need one (an anonymous function, or a
 * different id than the function's own name) — `defineWorklet('pressFade', fn)`
 * still works, unchanged. Equivalent to `registerWorklet(fn)` plus returning
 * `{ _wkltId: id }`.
 *
 * @public
 */
export function defineWorklet<E = MainThreadEvent, P = unknown>(fn: Worklet<E, P>): WorkletHandle<P>;
export function defineWorklet<E = MainThreadEvent, P = unknown>(id: string, fn: Worklet<E, P>): WorkletHandle<P>;
export function defineWorklet(idOrFn: string | Worklet<never, never>, maybeFn?: Worklet<never, never>): WorkletHandle<never> {
  const { id, fn } = resolveIdAndFn(idOrFn, maybeFn);
  registerWorklet(id, fn);
  return { _wkltId: id };
}

/** Returned by {@link MainThreadElement.animate}. @public */
export interface MainThreadAnimation {
  cancel(): void;
  pause(): void;
  play(): void;
}

/** Options for {@link MainThreadElement.animate}: a duration in ms, or these. @public */
export interface MainThreadAnimationOptions {
  name?: string;
  duration?: number;
  delay?: number;
  iterations?: number;
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  easing?: string;
  fill?: 'none' | 'forwards' | 'backwards' | 'both';
}

/**
 * An element on the Main Thread: Lynx's `MainThread.Element`
 * (https://lynxjs.org/api/lynx-api/main-thread/main-thread-element), plus
 * {@link MainThreadElement.setStyle}. Used by `ctx`, by refs and by
 * {@link mainThreadLynx}. Reads and writes are synchronous.
 *
 * An inline style set here lasts until a `[style.x]` binding on the same element
 * next changes, because the Background Thread writes its whole inline style.
 *
 * @public
 */
export interface MainThreadElement {
  /** Replace the element's whole inline style with a CSS string. */
  setStyle(css: string): void;
  /** Set one inline style property, keeping the others. */
  setStyleProperty(name: string, value: string): void;
  /** Set several inline style properties, keeping the others. */
  setStyleProperties(styles: Record<string, string>): void;
  /** Set an attribute on the element (synchronous, on the MT). */
  setAttribute(key: string, value: unknown): void;
  /** Read an attribute, `undefined` if the element doesn't have it. */
  getAttribute(name: string): unknown;
  getAttributeNames(): string[];
  /** The first descendant matching a CSS selector. Needs `enableCSSSelector`. */
  querySelector(selector: string): MainThreadElement | null;
  /** Every descendant matching a CSS selector. Needs `enableCSSSelector`. */
  querySelectorAll(selector: string): MainThreadElement[];
  /** Call a UI method, such as `scrollTo` on a `<scroll-view>`. Rejects if it fails. */
  invoke(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Run a native animation. `options` is a duration in ms, or {@link MainThreadAnimationOptions}. */
  animate(keyframes: Record<string, number | string>[], options?: number | MainThreadAnimationOptions): MainThreadAnimation;
  /**
   * Read a single resolved (computed) style value off the element,
   * synchronously on the MT — e.g. `getComputedStyleProperty('opacity')`. The
   * read counterpart to `setStyle`, handy for a worklet that animates *from*
   * the current value. Returns the value as a string (as the engine reports
   * it).
   */
  getComputedStyleProperty(name: string): string;
}

/**
 * Defer to a microtask, coalescing same-tick mutations into one flush — module
 * scoped (not per element), since `__FlushElementTree` commits *all* pending
 * changes regardless of which element (or none) it's called with.
 *
 * Required, not just an optimization: the worklet that's mutating the element
 * is itself running inside a call from the native engine into its WASM
 * context (web target) — calling `__FlushElementTree` synchronously from in
 * there re-enters that same context while it's still on the stack, and
 * wasm-bindgen's borrow guard panics ("recursive use of an object detected
 * which would lead to unsafe aliasing in rust"). Confirmed via the web
 * preview's console. A microtask runs after the current call stack (including
 * that WASM frame) has unwound. Mirrors `@lynx-js/react`'s real
 * `Element.flushElementTree` (`runtime/worklet-runtime/main.js`), which defers
 * the exact same way.
 */
let flushScheduled = false;
function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  Promise.resolve().then(() => {
    flushScheduled = false;
    __FlushElementTree();
  });
}

// ---------------------------------------------------------------------------
// lynxAnimate — a tiny declarative tween over the existing worklet machinery.
//
// `@angular/animations` is DOM/WAAPI-bound and doesn't apply here (see
// docs/33-animations.md). This drives `ctx.setStyle`/`ref.current.setStyle`
// from a fixed-interval `setTimeout` loop — no new PAPI, no CSS-engine
// involvement.
//
// **Not `requestAnimationFrame`, despite it existing here too** — a real bug
// found by testing this live, not assumed: `@lynx-js/react`'s bundled
// worklet-runtime (`pluginAngularLynx` bundles it into every Main-Thread
// entry — see docs/11-worklets.md) does install a real `requestAnimationFrame`
// on both targets, confirmed by reading `runtime/lib/worklet-runtime/api/
// lynxApi.js`. But on the web preview, `@lynx-js/web-core` runs the Main
// Thread inside a **`display: none` iframe** (confirmed via its
// `contentWindow.document.visibilityState === 'hidden'`) — and browsers never
// fire `requestAnimationFrame` callbacks for a hidden document. The callback
// registers (the call itself doesn't throw) but simply never runs — a
// first-tap-does-nothing failure with no error anywhere, only caught by
// clicking the live demo, not by the headless harness (whose mock has no
// concept of document visibility) or by reading source alone. `setTimeout`,
// confirmed by the same live test, fires normally regardless of the iframe's
// visibility — so this uses a fixed-interval `setTimeout` loop instead,
// tracking elapsed time as a self-maintained counter (one tick = one
// `FRAME_INTERVAL_MS`) rather than reading a real clock, so timing is exactly
// reproducible in tests and has no wall-clock dependency at all.
//
// **Web-preview caveat, also found live, not assumed:** a hidden document is
// exactly the case browsers throttle nested `setTimeout` chains for (Chrome
// clamps repeated nested timeouts in a backgrounded/hidden context to on the
// order of ~1s apart after the first few) — so on the web preview a `lynxAnimate`
// call still *completes correctly* (settles on exactly `to`, still calls
// `onFinish`), but its real-world wall-clock duration can run many times
// longer than the `duration` you asked for. Confirmed live: a `duration: 400`
// tween visibly took several seconds to settle in the web preview, while
// reaching the exact right final value throughout. On-device, the Main
// Thread isn't a hidden document, so this throttling doesn't apply — the web
// preview is the one target where this helper's *timing* (not its
// *correctness*) is honestly degraded.
// ---------------------------------------------------------------------------

declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(handle: number): void;

/** Assumed frame cadence for the `setTimeout` loop (~60fps). */
const FRAME_INTERVAL_MS = 16;

/** Options for {@link lynxAnimate}. */
export interface LynxAnimateOptions {
  /** Start value. */
  from: number;
  /** End value. */
  to: number;
  /** Milliseconds. */
  duration: number;
  /** Maps `[0, 1]` progress to `[0, 1]` — default linear (`t => t`). */
  easing?: (t: number) => number;
  /** Called once the animation reaches `to` — not called if cancelled. */
  onFinish?: () => void;
}

/** Options for {@link lynxTween}. */
export interface LynxTweenOptions extends LynxAnimateOptions {
  /** Called with the current value on every tick, the first one synchronously. */
  onUpdate: (value: number) => void;
}

/** Returned by {@link lynxAnimate} and {@link lynxTween}. */
export interface LynxAnimationHandle {
  /** Stop early, holding whatever value was last set. `onFinish` will not run. */
  cancel(): void;
}

/**
 * Tween a single number over time, calling `toStyle(value)` on every tick and
 * applying the result via `el.setStyle`. Covers the common case — fading,
 * sliding, scaling a single property — by design: multi-property animation is
 * just multiple `lynxAnimate` calls, or format several component values into
 * one `toStyle` string yourself. The first tick (the `from` value) applies
 * synchronously, before this call returns.
 *
 * Call from inside a worklet (`ctx` itself satisfies `{ setStyle }`) or with a
 * main-thread ref's `.current`:
 *
 * ```ts
 * function fadeOutMT(ctx: WorkletContext): void {
 *   lynxAnimate(ctx, (v) => `opacity: ${v};`, { from: 1, to: 0, duration: 250 });
 * }
 * export const fadeOut = defineWorklet(fadeOutMT);
 * ```
 *
 * @public
 */
export function lynxAnimate(
  el: Pick<MainThreadElement, 'setStyle'>,
  toStyle: (value: number) => string,
  options: LynxAnimateOptions,
): LynxAnimationHandle {
  return lynxTween({ ...options, onUpdate: (value) => el.setStyle(toStyle(value)) });
}

/**
 * Tween a single number over time and hand each value to `onUpdate`. The general
 * form of {@link lynxAnimate}, for when a value drives more than one style: a
 * carousel settling on a page, say.
 *
 * ```ts
 * lynxTween({ from: offset, to: page * width, duration: 300, onUpdate: applyOffset });
 * ```
 *
 * @public
 */
export function lynxTween(options: LynxTweenOptions): LynxAnimationHandle {
  const { from, to, duration, easing = (t: number) => t, onUpdate, onFinish } = options;
  let elapsed = 0;
  let timerId: number | undefined;
  let cancelled = false;

  function tick(): void {
    if (cancelled) return;
    const t = duration <= 0 ? 1 : Math.min(1, elapsed / duration);
    onUpdate(from + (to - from) * easing(t));
    if (t < 1) {
      elapsed += FRAME_INTERVAL_MS;
      timerId = setTimeout(tick, FRAME_INTERVAL_MS);
    } else {
      onFinish?.();
    }
  }
  tick();

  return {
    cancel(): void {
      cancelled = true;
      if (timerId !== undefined) clearTimeout(timerId);
    },
  };
}

const ANIMATION_START = 0;
const ANIMATION_PLAY = 1;
const ANIMATION_PAUSE = 2;
const ANIMATION_CANCEL = 3;
let nextAnimationId = 0;

/**
 * Same calls as the `Element` class in `@lynx-js/react`'s worklet-runtime
 * (Apache-2.0, The Lynx Authors), which isn't exported. Writes defer their flush:
 * see {@link scheduleFlush}.
 */
class MainThreadElementImpl implements MainThreadElement {
  constructor(private readonly el: LynxElement) {}

  setStyle(css: string): void {
    __SetInlineStyles(this.el, css);
    scheduleFlush();
  }

  setStyleProperty(name: string, value: string): void {
    __AddInlineStyle(this.el, name, value);
    scheduleFlush();
  }

  setStyleProperties(styles: Record<string, string>): void {
    for (const name of Object.keys(styles)) __AddInlineStyle(this.el, name, styles[name]!);
    scheduleFlush();
  }

  setAttribute(key: string, value: unknown): void {
    __SetAttribute(this.el, key, value);
    scheduleFlush();
  }

  getAttribute(name: string): unknown {
    return __GetAttributeByName(this.el, name);
  }

  getAttributeNames(): string[] {
    return __GetAttributeNames(this.el);
  }

  getComputedStyleProperty(name: string): string {
    return __GetComputedStyleByKey(this.el, name);
  }

  querySelector(selector: string): MainThreadElement | null {
    const found = __QuerySelector(this.el, selector, {});
    return found ? new MainThreadElementImpl(found) : null;
  }

  querySelectorAll(selector: string): MainThreadElement[] {
    return __QuerySelectorAll(this.el, selector, {}).map((found) => new MainThreadElementImpl(found));
  }

  invoke(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      __InvokeUIMethod(this.el, method, params, (result) => {
        if (result.code === 0) resolve(result.data);
        else reject(new Error(`UI method ${method}: ${JSON.stringify(result)}`));
      });
      scheduleFlush();
    });
  }

  animate(keyframes: Record<string, number | string>[], options?: number | MainThreadAnimationOptions): MainThreadAnimation {
    const el = this.el;
    const id = `__ng-main-thread-animation-${nextAnimationId++}`;
    __ElementAnimate(el, [ANIMATION_START, id, keyframes, typeof options === 'number' ? { duration: options } : (options ?? {})]);
    return {
      cancel: () => void __ElementAnimate(el, [ANIMATION_CANCEL, id]),
      pause: () => void __ElementAnimate(el, [ANIMATION_PAUSE, id]),
      play: () => void __ElementAnimate(el, [ANIMATION_PLAY, id]),
    };
  }
}

/**
 * The main-thread `lynx` API, for a Main-Thread module
 * (https://lynxjs.org/api/lynx-api/main-thread). The queries search the whole page,
 * so a worklet can reach any element, not only its own and its refs.
 *
 * @public
 */
export const mainThreadLynx = {
  /** The first element in the page matching a CSS selector. Needs `enableCSSSelector`. */
  querySelector(selector: string): MainThreadElement | null {
    const page = elements.get(PAGE_ROOT_ID);
    return page === undefined ? null : new MainThreadElementImpl(page).querySelector(selector);
  },
  /** Every element in the page matching a CSS selector. Needs `enableCSSSelector`. */
  querySelectorAll(selector: string): MainThreadElement[] {
    const page = elements.get(PAGE_ROOT_ID);
    return page === undefined ? [] : new MainThreadElementImpl(page).querySelectorAll(selector);
  },
  /**
   * Runs before the next frame. It never fires in the web preview, whose Main
   * Thread is a hidden iframe: use {@link lynxTween} for anything that has to run
   * there too.
   */
  requestAnimationFrame(callback: (time: number) => void): number {
    return lynx!.requestAnimationFrame!(callback);
  },
  cancelAnimationFrame(handle: number): void {
    lynx?.cancelAnimationFrame?.(handle);
  },
  /** Measure text without rendering it. `fontSize` is required. */
  getTextInfo(text: string, info: { fontSize: string; fontFamily?: string; maxWidth?: string; maxLine?: number }): { width: number; content?: string[] } {
    return lynx!.getTextInfo!(text, info);
  },
  /** The host's global props, as `lynxGlobalProps()` gives them on the Background Thread. */
  get globalProps(): Record<string, unknown> {
    return lynx?.__globalProps ?? {};
  },
  stopExposure(options?: { sendEvent?: boolean }): void {
    lynx?.stopExposure?.(options);
  },
  resumeExposure(): void {
    lynx?.resumeExposure?.();
  },
  getSessionStorageItem(key: string): Promise<unknown> {
    return new Promise((resolve) => lynx!.getSessionStorageItem!(key, resolve));
  },
  setSessionStorageItem(key: string, value: unknown): void {
    lynx?.setSessionStorageItem?.(key, value);
  },
  /** Returns an id for {@link mainThreadLynx.unsubscribeSessionStorage}. */
  subscribeSessionStorage(key: string, listener: (value: unknown) => void): number {
    return lynx!.subscribeSessionStorage!(key, listener);
  },
  unsubscribeSessionStorage(key: string, id: number): void {
    lynx?.unsubscribeSessionStorage?.(key, id);
  },
  /**
   * Normalise what the host passes before the app sees it, as `lynx.registerDataProcessors`
   * does in Lynx's guide. Call it from a module in `mainThreadModules`, at its top level, so
   * it's in place before the engine processes init data. See docs/17-host-data.md.
   */
  registerDataProcessors(definition: LynxDataProcessorDefinition): void {
    registerDataProcessors(definition);
  },
};

// ---------------------------------------------------------------------------
// Main-thread refs
//
// A worklet's `ctx` only reaches the element the event fired on. A *main-thread
// ref* lets a worklet imperatively access ANOTHER element (e.g. tap a button →
// animate a card). Bind it on the element with `[lynxMainThreadRef]` on the
// Background Thread (→ SET_REF op); read `ref.current` inside a worklet on the MT.
// The registry maps refId → element id, so `ref.current` resolves through the
// live `elements` map and auto-nulls once that element is destroyed. A ref with no
// element bound holds a value instead.
// ---------------------------------------------------------------------------

const REF_REGISTRY_KEY = '__ANGULAR_LYNX_MT_REFS__';
type RefGlobal = typeof globalThis & { __ANGULAR_LYNX_MT_REFS__?: Map<string, number> };
function refRegistry(): Map<string, number> {
  const g = globalThis as RefGlobal;
  let m = g[REF_REGISTRY_KEY];
  if (!m) {
    m = new Map<string, number>();
    Object.defineProperty(g, REF_REGISTRY_KEY, {
      value: m,
      configurable: true,
      enumerable: false,
      writable: true,
    });
  }
  return m;
}

class LiveRef<T> implements MainThreadRef<T> {
  private value: T;

  constructor(readonly _refId: string, private readonly initial: T) {
    this.value = initial;
  }

  reset(): void {
    this.value = this.initial;
  }

  get current(): T {
    const elId = refRegistry().get(this._refId);
    if (elId === undefined) return this.value;
    const el = elements.get(elId);
    return (el ? new MainThreadElementImpl(el) : null) as T;
  }

  set current(value: T) {
    this.value = value;
  }

  /** What `JSON.stringify` sends, so a ref can travel to the Background Thread and back. */
  toJSON(): MainThreadRefHandle<T> {
    return { _refId: this._refId };
  }
}

/** Every live ref by id: one object per id, however many bindings mention it. */
const liveRefs = new Map<string, LiveRef<unknown>>();

function liveRef<T>(id: string, initial: T): LiveRef<T> {
  let ref = liveRefs.get(id) as LiveRef<T> | undefined;
  if (!ref) {
    ref = new LiveRef(id, initial);
    liveRefs.set(id, ref as LiveRef<unknown>);
  }
  return ref;
}

/**
 * Create a main-thread ref. Author it in a Main-Thread module. For an element, bind
 * it with `[lynxMainThreadRef]="ref"` and read `ref.current` from a worklet:
 *
 * ```ts
 * // gestures.mt.ts
 * export const card = defineMainThreadRef('card');
 * export const fade = defineWorklet('fade', () => { card.current?.setStyle('opacity: 0.3'); });
 *
 * // component
 * //   <view [lynxMainThreadRef]="card">…</view>
 * //   <view [lynxMainThread]="{ tap: fade }">tap</view>
 * ```
 *
 * Or give it a starting value, and it holds whatever you store in `current`, which
 * stays on the Main Thread:
 *
 * ```ts
 * export const startX = defineMainThreadRef('startX', 0);
 * ```
 *
 * One ref has one id, so several instances of a component would share it. For state
 * per instance, use `mainThreadRef()` from `angular-lynx` and {@link bindWorklet}.
 *
 * @public
 */
export function defineMainThreadRef(id: string): MainThreadRef<MainThreadElement | null>;
export function defineMainThreadRef<T>(id: string, initial: T): MainThreadRef<T>;
export function defineMainThreadRef(id: string, initial: unknown = null): MainThreadRef<unknown> {
  return liveRef(id, initial);
}

/** Turn handles from the Background Thread into what the Main Thread works with. */
function fromWire(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(fromWire);
  if ('_refId' in value) {
    const handle = value as MainThreadRefHandle;
    return liveRef(handle._refId, handle._init ?? null);
  }
  if ('_mtFnId' in value) return mainThreadFunction((value as MainThreadFunctionHandle)._mtFnId);
  if ('_bgFnId' in value) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = fromWire((value as Record<string, unknown>)[key]);
  return out;
}

// ---------------------------------------------------------------------------
// Calls between the threads
// ---------------------------------------------------------------------------

type AnyFunction = (...args: never[]) => unknown;

const mainThreadFunctions = new Map<string, AnyFunction>();

function mainThreadFunction(id: string): AnyFunction {
  const fn = mainThreadFunctions.get(id);
  if (!fn) throw new Error(`angular-lynx: no main-thread function "${id}". Is its module in mainThreadModules?`);
  return fn;
}

/**
 * Define a function the Background Thread can call on the Main Thread with
 * `runOnMainThread` from `angular-lynx`, and worklets can receive through
 * {@link bindWorklet}. Author it in a Main-Thread module. Refs and functions in
 * its arguments arrive live, like `ctx.params`.
 *
 * ```ts
 * // swiper.mt.ts
 * export const goToPage = defineMainThreadFunction(function goToPageMT(track: MainThreadRef<MainThreadElement | null>, x: number) {
 *   track.current?.setStyleProperty('transform', `translateX(${x}px)`);
 *   return x;
 * });
 *
 * // component
 * const x = await runOnMainThread(goToPage)(this.track, 320);
 * ```
 *
 * Name the function, as with {@link defineWorklet}, or pass an id first.
 *
 * @public
 */
export function defineMainThreadFunction<A extends unknown[], R>(fn: (...args: A) => R): MainThreadFunctionHandle<A, R>;
export function defineMainThreadFunction<A extends unknown[], R>(id: string, fn: (...args: A) => R): MainThreadFunctionHandle<A, R>;
export function defineMainThreadFunction(idOrFn: string | AnyFunction, maybeFn?: AnyFunction): MainThreadFunctionHandle<never[], unknown> {
  const { id, fn } = resolveIdAndFn(idOrFn, maybeFn);
  mainThreadFunctions.set(id, fn);
  return { _mtFnId: id };
}

/** JSON or nothing: a value can't cross the threads otherwise. */
function toJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/** Runs a `runOnMainThread` call. See `entry-main.ts`. */
export function applyRunOnMainThread(call: { id: string; args: string; callId: number }): void {
  const reply = (value: unknown, error?: string): void => {
    lynx?.getJSContext?.()?.dispatchEvent({
      type: MAIN_THREAD_RESULT_EVENT,
      data: { callId: call.callId, value: toJson(value), error },
    });
  };
  const fail = (err: unknown): void => reply(undefined, err instanceof Error ? err.message : String(err));
  try {
    const args = fromWire(JSON.parse(call.args)) as never[];
    const result = mainThreadFunction(call.id)(...args);
    if (result instanceof Promise) result.then((value) => reply(value), fail);
    else reply(result);
  } catch (err) {
    fail(err);
  }
}

/** Frees a `mainThreadRef()` whose owner is gone. See `entry-main.ts`. */
export function applyReleaseMainThreadRef({ id }: { id: string }): void {
  refRegistry().delete(id);
  liveRefs.delete(id);
}

let nextBackgroundCallId = 0;
const backgroundCalls = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
let listeningForBackgroundResults = false;

/**
 * Call a Background-Thread function from the Main Thread: what ReactLynx's
 * `runOnBackground(fn)(...args)` does. Get the handle from `backgroundFunction(fn)`
 * in `angular-lynx`, through {@link bindWorklet} or an argument. Arguments have to be
 * JSON-serializable. Resolves with what the function returned, or `undefined` if its
 * owner has been destroyed.
 *
 * ```ts
 * runOnBackground(ctx.params.onIndexChange)(index);
 * ```
 *
 * @public
 */
export function runOnBackground<A extends unknown[], R>(handle: BackgroundFunctionHandle<A, R>): (...args: A) => Promise<Awaited<R>> {
  return (...args) =>
    new Promise((resolve, reject) => {
      const context = lynx?.getJSContext?.();
      if (!context) {
        reject(new Error('angular-lynx: runOnBackground called off the Main Thread.'));
        return;
      }
      if (!listeningForBackgroundResults) {
        listeningForBackgroundResults = true;
        context.addEventListener(BACKGROUND_RESULT_EVENT, (event) => {
          const { callId, value, error } = event.data as { callId: number; value?: string; error?: string };
          const call = backgroundCalls.get(callId);
          if (!call) return;
          backgroundCalls.delete(callId);
          if (error !== undefined) call.reject(new Error(error));
          else call.resolve(value === undefined ? undefined : JSON.parse(value));
        });
      }
      const callId = ++nextBackgroundCallId;
      backgroundCalls.set(callId, { resolve: resolve as (value: unknown) => void, reject });
      context.dispatchEvent({
        type: BACKGROUND_CALL_EVENT,
        data: { id: handle._bgFnId, args: JSON.stringify(args), callId },
      });
    });
}

/**
 * Apply a SET_REF op: bind an element id to a main-thread ref id. A negative id
 * unbinds that element, and only that element: when a ref moves, the new element can
 * bind it before the old one is torn down.
 */
export function applySetRef(elId: number, refId: string): void {
  if (elId >= 0) refRegistry().set(refId, elId);
  else if (refRegistry().get(refId) === -elId) refRegistry().delete(refId);
}

/** Apply a SET_WORKLET_EVENT op: bind a native event to run a worklet on the MT. */
export function applySetWorkletEvent(
  elId: number,
  eventType: string,
  eventName: string,
  ref: WorkletRef,
): void {
  const el = elements.get(elId);
  if (!el) return;
  const ctx: WireWorkletCtx = {
    _wkltId: ref._wkltId,
    _workletType: 'main-thread',
    _elId: elId,
    _bgCallbackId: ref._bgCallbackId,
    _params: ref._params,
  };
  __AddEvent(el, eventType, eventName, { type: 'worklet', value: ctx });
}

/**
 * Reset the main-thread-ref registry — for testing / hot reload. Worklet
 * registrations themselves now live in `lynxWorkletImpl._workletMap` (owned
 * by the real worklet-runtime, not this module), and re-registering the same
 * id just overwrites the old entry — nothing to clear on our side.
 */
export function resetWorkletState(): void {
  refRegistry().clear();
  for (const ref of liveRefs.values()) ref.reset();
  backgroundCalls.clear();
}

/**
 * `__DEV__` is replaced at build time by the bundler `define`. Declared here so
 * the source type-checks standalone (matches the same declaration in renderer.ts).
 */
declare const __DEV__: boolean;
