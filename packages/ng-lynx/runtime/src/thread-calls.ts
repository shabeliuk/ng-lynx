/**
 * Calls between the threads, from the Background Thread's side: `runOnMainThread`,
 * `backgroundFunction` and `mainThreadRef`. The Main Thread's side is in
 * `main-thread/src/worklet-apply.ts`. See docs/11-worklets.md.
 */
import { DestroyRef, inject } from '@angular/core';

import {
  BACKGROUND_CALL_EVENT,
  BACKGROUND_RESULT_EVENT,
  type BackgroundFunctionHandle,
  MAIN_THREAD_RESULT_EVENT,
  type MainThreadFunctionHandle,
  type MainThreadRef,
  RELEASE_MAIN_THREAD_REF_METHOD,
  RUN_ON_MAIN_THREAD_METHOD,
  type ToMainThread,
} from 'ng-lynx/internal/ops';

import { flushOps } from './flush.js';
import { inlineCaptures, isInlineMainThread } from './inline-main-thread.js';

interface CrossThreadContext {
  addEventListener(type: string, listener: (event: { data: unknown }) => void): void;
  dispatchEvent(event: { type: string; data?: unknown }): void;
}

// eslint-disable-next-line no-var
declare var lynx:
  | {
      getCoreContext?(): CrossThreadContext;
      getNativeApp?(): { callLepusMethod?(method: string, params: unknown, callback: () => void): void } | null | undefined;
    }
  | null
  | undefined;

/**
 * `__DEV__` is replaced at build time by the bundler `define`. Declared here so
 * the source type-checks standalone.
 */
declare const __DEV__: boolean;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

let nextCallId = 0;
const pendingCalls = new Map<number, PendingCall>();

/** Run `callback` when the injection context this is called in, if any, goes away. */
function onContextDestroy(callback: () => void): void {
  let destroyRef: DestroyRef | undefined;
  try {
    destroyRef = inject(DestroyRef);
  } catch {
    // No injection context, so it lives as long as the page.
  }
  destroyRef?.onDestroy(callback);
}

/**
 * Call a function on the Main Thread and get its result: what ReactLynx's
 * `runOnMainThread(fn)(...args)` does. Define it with `defineMainThreadFunction`
 * in a Main-Thread module. Refs and functions in the arguments arrive live, and the
 * rest has to be JSON-serializable. Rejects if the function throws.
 *
 * Render ops already buffered are sent first, so the function sees the elements and
 * refs this tick created.
 *
 * ```ts
 * import { runOnMainThread } from 'ng-lynx';
 * import { goToPage } from './swiper.mt';
 *
 * const x = await runOnMainThread(goToPage)(this.track, 320);
 * ```
 *
 * @public
 */
export function runOnMainThread<A extends unknown[], R>(
  fn: MainThreadFunctionHandle<A, R>,
): (...args: ToMainThread<A>) => Promise<Awaited<R>>;
/**
 * Call a function marked `'main thread'` on the Main Thread and get its result.
 * What it captured is read now and sent along. See docs/11-worklets.md.
 */
export function runOnMainThread<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: ToMainThread<A>) => Promise<Awaited<R>>;
export function runOnMainThread(
  fn: MainThreadFunctionHandle<unknown[], unknown> | ((...args: never[]) => unknown),
): (...args: unknown[]) => Promise<unknown> {
  if (typeof fn === 'function' && !isInlineMainThread(fn)) {
    throw new Error(
      '[ng-lynx] runOnMainThread takes a function from defineMainThreadFunction, or one marked \'main thread\' '
        + 'and compiled by pluginAngularLynx. See docs/11-worklets.md.',
    );
  }
  const id = (fn as MainThreadFunctionHandle<unknown[], unknown>)._mtFnId;
  return (...callArgs) =>
    new Promise((resolve, reject) => {
      const app = typeof lynx !== 'undefined' ? lynx?.getNativeApp?.() : undefined;
      if (!app?.callLepusMethod) {
        reject(new Error('ng-lynx: runOnMainThread needs a Lynx engine.'));
        return;
      }
      flushOps();
      const callId = ++nextCallId;
      pendingCalls.set(callId, { resolve: resolve as (value: unknown) => void, reject });
      // An inline function is registered as a factory of what it captured.
      const args = isInlineMainThread(fn) ? [inlineCaptures(fn), ...callArgs] : callArgs;
      app.callLepusMethod(RUN_ON_MAIN_THREAD_METHOD, { id, args: JSON.stringify(args), callId }, () => {});
    });
}

let nextFunctionId = 0;
const backgroundFunctions = new Map<string, (...args: never[]) => unknown>();

/**
 * Expose a Background-Thread function to the Main Thread: pass the handle to a worklet
 * through `bindWorklet` or an argument, and call it there with `runOnBackground`. In a
 * component or service field it's released with its owner, and otherwise lives until the
 * page does.
 *
 * ```ts
 * readonly onIndexChange = backgroundFunction((index: number) => this.current.set(index));
 * ```
 *
 * @public
 */
export function backgroundFunction<A extends unknown[], R>(fn: (...args: A) => R): BackgroundFunctionHandle<A, R> {
  const id = `ng-bg:${++nextFunctionId}`;
  backgroundFunctions.set(id, fn as (...args: never[]) => unknown);
  onContextDestroy(() => backgroundFunctions.delete(id));
  return { _bgFnId: id };
}

/** How many Background functions and calls this thread holds. For leak checks (verify:memory). */
export function threadCallSizes(): { backgroundFunctions: number; pendingCalls: number } {
  return { backgroundFunctions: backgroundFunctions.size, pendingCalls: pendingCalls.size };
}

let nextRefId = 0;

/**
 * Create a main-thread ref from the Background Thread, one per call, so each instance
 * of a component gets its own: what `useMainThreadRef` gives a ReactLynx component.
 * Bind it to an element with `[lynxMainThreadRef]`, or give it a starting value and use
 * it to hold state. Pass it to a worklet through `bindWorklet`, or to a function through
 * `runOnMainThread`, or read it in a `'main thread'` function. Its `current` exists on
 * the Main Thread only: it's typed, for those functions, and reading it on the
 * Background Thread throws. In a component or service field it's released with its owner.
 *
 * ```ts
 * readonly track = mainThreadRef();
 * readonly startX = mainThreadRef(0);
 * ```
 *
 * @public
 */
export function mainThreadRef<T = unknown>(initial?: T): MainThreadRef<T> {
  const id = `ng-ref:${++nextRefId}`;
  onContextDestroy(() => {
    const app = typeof lynx !== 'undefined' ? lynx?.getNativeApp?.() : undefined;
    app?.callLepusMethod?.(RELEASE_MAIN_THREAD_REF_METHOD, { id }, () => {});
  });
  const handle = initial === undefined ? { _refId: id } : { _refId: id, _init: initial };
  // Not enumerable, so the handle still crosses the threads as `_refId` and `_init`.
  const mainThreadOnly = (): never => {
    throw new Error(
      `[ng-lynx] ${id}: a mainThreadRef's current lives on the Main Thread. Read it in a worklet or a 'main thread' function.`,
    );
  };
  Object.defineProperty(handle, 'current', { get: mainThreadOnly, set: mainThreadOnly, enumerable: false });
  return handle as MainThreadRef<T>;
}

/** Listen for the Main Thread's half of these calls. Called by entry-background. */
export function installThreadCalls(context: CrossThreadContext | undefined): void {
  context?.addEventListener(MAIN_THREAD_RESULT_EVENT, (event) => {
    const { callId, value, error } = event.data as { callId: number; value?: string; error?: string };
    const call = pendingCalls.get(callId);
    if (!call) return;
    pendingCalls.delete(callId);
    if (error !== undefined) call.reject(new Error(error));
    else call.resolve(value === undefined ? undefined : JSON.parse(value));
  });

  context?.addEventListener(BACKGROUND_CALL_EVENT, (event) => {
    const { id, args, callId } = event.data as { id: string; args: string; callId: number };
    const reply = (value: unknown, error?: string): void =>
      context.dispatchEvent({
        type: BACKGROUND_RESULT_EVENT,
        data: { callId, value: value === undefined ? undefined : JSON.stringify(value), error },
      });
    const fail = (err: unknown): void => reply(undefined, err instanceof Error ? err.message : String(err));
    const fn = backgroundFunctions.get(id);
    if (!fn) {
      // A call in flight as its component was destroyed: normal, so not an error.
      if (__DEV__) console.warn(`[ng-lynx] runOnBackground: "${id}" has been released.`);
      reply(undefined);
      return;
    }
    try {
      const result = fn(...(JSON.parse(args) as never[]));
      if (result instanceof Promise) result.then((value) => reply(value), fail);
      else reply(result);
    } catch (err) {
      fail(err);
    }
  });
}
