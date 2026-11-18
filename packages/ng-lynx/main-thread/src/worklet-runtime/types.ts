/**
 * The shapes the engine passes to the worklet runtime, and expects back.
 *
 * Read from `lynx-family/lynx` (`core/renderer/events/touch_event_handler.{h,cc}`)
 * and `@lynx-js/web-core` (`WASMJSBinding.runWorklet`). See docs/42-worklet-runtime.md.
 */

/**
 * The object given to `__AddEvent(el, type, name, { type: 'worklet', value })`, or
 * listed in a gesture's callbacks. The engine hands it back to `runWorklet` as is.
 * Only `_wkltId` means anything to the runtime; the rest is the caller's own data,
 * which the worklet reads from `this`.
 */
export interface WorkletCtx {
  /** The id the function was registered under. */
  readonly _wkltId: string;
  readonly [key: string]: unknown;
}

/** The function stored under an id. `this` is a copy of the {@link WorkletCtx}. */
export type WorkletFunction = (this: Record<string, unknown>, ...params: unknown[]) => unknown;

/** Who is calling `runWorklet`: `RunWorkletType` in the engine. */
export const RunWorkletSource = {
  /** Not given: the web preview passes no options. */
  NONE: 0,
  /** An event bound with `__AddEvent`. The engine reads {@link EventResult} back. */
  EVENT: 1,
  /** A gesture detector's callback. The second param is the gesture's state manager. */
  GESTURE: 2,
} as const;

export type RunWorkletSource = (typeof RunWorkletSource)[keyof typeof RunWorkletSource];

/** `runWorklet`'s third argument. Only the native engine passes it. */
export interface RunWorkletOptions {
  readonly source?: RunWorkletSource;
}

/** The bits of `eventReturnResult`: `EventResult` in the engine. */
export const EventResult = {
  DEFAULT: 0x0,
  STOP_PROPAGATION: 0x1,
  STOP_IMMEDIATE_PROPAGATION: 0x2,
} as const;

/** What `runWorklet` returns for a native event, so the engine can read the bits. */
export interface EventWorkletResult {
  readonly returnValue: unknown;
  readonly eventReturnResult: number;
}
