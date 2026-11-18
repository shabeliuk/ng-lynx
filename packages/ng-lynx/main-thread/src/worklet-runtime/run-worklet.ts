/**
 * `runWorklet(ctx, params, options)`: what the engine calls when a worklet-bound
 * event or gesture fires. The steps are in docs/42-worklet-runtime.md#how-runworklet-runs-a-worklet.
 */
import { hydrateEventTargets } from './event-targets.js';
import { getWorkletFunction } from './registry.js';
import {
  EventResult,
  type EventWorkletResult,
  type RunWorkletOptions,
  RunWorkletSource,
  type WorkletCtx,
  type WorkletFunction,
} from './types.js';

interface Binding {
  /** What was registered when this binding was made. */
  readonly registered: WorkletFunction;
  readonly fn: (...params: unknown[]) => unknown;
}

/**
 * The registered function, bound to a copy of `ctx`, by `ctx` object. Bound once,
 * so what a worklet stores on `this` is there on the next event, until the id is
 * registered again (hot reload): then the new function runs, with a new copy.
 *
 * The value mustn't point back at its key: PrimJS keeps a `WeakMap` value alive
 * while it does, and the entry would never go. That's why the copy is bound, not
 * `ctx`.
 */
const bindings = new WeakMap<object, Binding>();

/** Step 1: an object carrying a string `_wkltId`. */
export function isWorkletCtx(value: unknown): value is WorkletCtx {
  return typeof value === 'object' && value !== null && typeof (value as { _wkltId?: unknown })._wkltId === 'string';
}

/** Step 2. Throws if nothing is registered under the id. */
function bindWorkletCtx(ctx: WorkletCtx): (...params: unknown[]) => unknown {
  const registered = getWorkletFunction(ctx._wkltId);
  if (!registered) {
    throw new Error(
      `ng-lynx: no main-thread worklet "${ctx._wkltId}" is registered. Register it with `
        + 'defineWorklet or registerWorklet in a module listed in mainThreadModules.',
    );
  }
  const cached = bindings.get(ctx);
  if (cached?.registered === registered) return cached.fn;
  const fn = registered.bind({ ...ctx });
  bindings.set(ctx, { registered, fn });
  return fn;
}

/**
 * Step 4: for a native event, `stopPropagation` and `stopImmediatePropagation` on
 * the event, setting the bits the engine reads back. Returns the bits' holder.
 */
function addEventMethods(event: Record<string, unknown>): { bits: number } {
  const result = { bits: EventResult.DEFAULT as number };
  event['stopPropagation'] = (): void => {
    result.bits |= EventResult.STOP_PROPAGATION;
  };
  event['stopImmediatePropagation'] = (): void => {
    result.bits |= EventResult.STOP_IMMEDIATE_PROPAGATION;
  };
  return result;
}

/**
 * Run the worklet `ctx` names with `params`. Returns `undefined` for anything that
 * isn't a worklet ctx; throws for an id nothing registered, and lets the worklet's
 * own errors through, for the engine to report.
 */
export function runWorklet(ctx: unknown, params?: unknown[], options?: RunWorkletOptions): unknown {
  if (!isWorkletCtx(ctx)) return undefined;
  const fn = bindWorkletCtx(ctx);
  const args = Array.isArray(params) ? params : [];
  const event = args[0];
  if (typeof event !== 'object' || event === null) return fn(...args);

  hydrateEventTargets(event);
  if (options?.source !== RunWorkletSource.EVENT) return fn(...args);

  const result = addEventMethods(event as Record<string, unknown>);
  const returnValue = fn(...args);
  return { returnValue, eventReturnResult: result.bits } satisfies EventWorkletResult;
}
