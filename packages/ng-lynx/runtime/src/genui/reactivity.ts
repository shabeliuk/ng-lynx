/**
 * A signals `effect()` on the genui store's own signals runtime.
 *
 * The genui store keeps its data model, and the results of asynchronous
 * function calls, in `@preact/signals` (through `@lynx-js/react-signals`).
 * Upstream's renderer re-resolves a component's props inside an `effect()`,
 * so a change to any signal read along the way (a binding, a value read
 * inside a function implementation, an agent function's result arriving)
 * re-renders it.
 *
 * ng-lynx can't import `effect` itself: `@lynx-js/react-signals` isn't its
 * dependency, and a second copy of the signals runtime would never see writes
 * made through the store's copy. Every signal instance carries the runtime it
 * came from, though: preact's `Signal.prototype.subscribe(fn)` is
 * `effect(() => { const v = this.value; untracked(() => fn(v)); })`. Calling it
 * with a `this` whose `value` getter runs our code makes that code the body
 * of a real effect on the store's runtime. Every signal it reads is tracked,
 * and the effect re-runs when one changes, batched like any other effect.
 */
import type { Surface } from '@lynx-js/genui/a2ui/store';

type Subscribe = (this: { readonly value: unknown }, fn: (value: unknown) => void) => () => void;

const noop = (): void => {};

/**
 * Run `body` now, and again whenever a store signal it read changes. Returns
 * the disposer.
 *
 * @experimental
 */
export function trackA2uiSignals(surface: Surface, body: () => void): () => void {
  const probe = surface.store.getSignal('/');
  const subscribe = (Object.getPrototypeOf(probe) as { subscribe?: Subscribe }).subscribe;
  if (typeof subscribe !== 'function') {
    // Not a preact signal: run once, without tracking.
    body();
    return noop;
  }
  return subscribe.call(
    {
      get value() {
        body();
        return undefined;
      },
    },
    noop,
  );
}
