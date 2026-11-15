/**
 * `lynxRequestAnimationFrame` / `lynxCancelAnimationFrame` — a thin, portable
 * wrapper over the platform's frame scheduler.
 *
 * Lynx exposes a global `requestAnimationFrame` on the Background Thread
 * on-device (per the Lynx API reference). But it is **not present everywhere
 * ng-lynx runs**: `@lynx-js/web-core` runs the Background Thread in a Web
 * **Worker**, which has no `requestAnimationFrame` at all (rAF is a `window`
 * API) — the same reason `lynxAnimate`'s Main-Thread tween loop uses
 * `setTimeout` (see docs/33-animations.md). So this wrapper uses the real rAF
 * when it exists and otherwise **degrades to a ~60fps `setTimeout` timer**,
 * so a frame callback fires everywhere — the web preview included — rather
 * than silently never running.
 *
 * Most Angular code shouldn't reach for this at all: signals + zoneless change
 * detection already batch UI updates, and `lynxAnimate` covers worklet-driven
 * animation. It's here for the occasional hand-rolled frame loop that wants a
 * platform-appropriate scheduler with one honest fallback.
 */

// Read the globals as ambients — they resolve against `globalThis` at runtime
// (whatever the current thread provides), so the harness can install a spy.
// eslint-disable-next-line no-var
declare var requestAnimationFrame: ((cb: (time: number) => void) => number) | undefined;
// eslint-disable-next-line no-var
declare var cancelAnimationFrame: ((handle: number) => void) | undefined;

/**
 * Schedule `callback` for the next frame. Returns a handle for
 * {@link lynxCancelAnimationFrame}. Uses the native `requestAnimationFrame`
 * when available, else a `setTimeout(…, 16)` fallback (see the module doc).
 *
 * @public
 */
export function lynxRequestAnimationFrame(callback: (time: number) => void): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(Date.now()), 16) as unknown as number;
}

/**
 * Cancel a frame callback scheduled by {@link lynxRequestAnimationFrame}.
 *
 * @public
 */
export function lynxCancelAnimationFrame(handle: number): void {
  // Mirror the request path: availability of `requestAnimationFrame` is stable
  // within a runtime, so request and cancel always agree on which scheduler a
  // handle came from.
  if (typeof requestAnimationFrame === 'function') {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  } else {
    clearTimeout(handle);
  }
}
