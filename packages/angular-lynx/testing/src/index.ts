/**
 * angular-lynx/testing — headless component testing for Angular-on-Lynx.
 *
 * Runs entirely in Node (Vitest, Jest, plain scripts): the Lynx element PAPI
 * is mocked with an in-memory tree, the real Main-Thread executor replays the
 * real ops the renderer emits, and events are fired through the real sign
 * registry. This is the exact environment angular-lynx's own 18 verification
 * harnesses run on — packaged as a public API.
 *
 * @example
 * ```ts
 * import '@angular/compiler'; // JIT — required once per test entry
 * import { renderLynxComponent } from 'angular-lynx/testing';
 *
 * it('increments on tap', async () => {
 *   const fixture = await renderLynxComponent(CounterComponent);
 *   fixture.getByText('Count: 0');
 *
 *   await fixture.fire(fixture.getByText('Increment'), 'tap'); // bubbles to the button
 *   fixture.getByText('Count: 1');
 *
 *   fixture.destroy();
 * });
 * ```
 *
 * Notes:
 *  - Tests use **JIT** (`import '@angular/compiler'` first; the test runner's
 *    TS transform needs `experimentalDecorators` + `useDefineForClassFields:
 *    false`). Initializer APIs (`input()`, `viewChild()`) need AOT and don't
 *    wire up under JIT — use decorator forms in components you unit-test, or
 *    keep those components to on-device verification.
 *  - One rendered app per test file is the safe pattern (module state is
 *    per-process; Vitest isolates files by default). `renderLynxComponent`
 *    resets the environment, so sequential renders in one file also work.
 */
import type { ApplicationRef, EnvironmentProviders, Provider, Type } from '@angular/core';

import {
  bootstrapLynxApplication,
  flushOps,
  publishEvent,
  resetAppEventsState,
  resetEventRegistry,
  resetGestureState,
  resetHostDataState,
  resetOpLogger,
  resetPendingStyleClass,
  resetShadowTreeState,
  whenFlushed,
} from 'angular-lynx';

import {
  findText,
  fireIntersection,
  getFirstOpsString,
  getPage,
  installMockPapi,
  type MockEl,
  observedSelectors,
  printTree,
  tick,
} from './mock-papi.js';
import { type LynxQueries, within } from './queries.js';

export { textContent, within, type LynxQueries, type LynxTextMatch, type LynxTextMatchOptions } from './queries.js';

// Everything low-level stays available for advanced tests.
export {
  assert,
  driveList,
  emitGlobalEvent,
  findAllByClass,
  findByClass,
  findByType,
  findEventSign,
  findText,
  fireGestureCallback,
  fireIntersection,
  firePerformanceEntry,
  fireWorklet,
  getFirstOpsString,
  getLastOps,
  getLastQuery,
  getPage,
  installMockPapi,
  type MockEl,
  observedSelectors,
  performanceObservedTypes,
  performanceTrace,
  printTree,
  registerDynamicComponent,
  tick,
} from './mock-papi.js';

/**
 * Install the mock PAPI and create the page root — the state a real engine
 * has before the Background bundle runs. Called automatically by
 * {@link renderLynxComponent}; call it directly only for low-level tests.
 *
 * @public
 */
export function setupLynxTestEnvironment(): void {
  // Drain any ops still buffered from a previous app in this process (e.g. a
  // deferred destroy flush) into the *previous* environment. The root
  // component's host is the page root (id 1), so a destroy batch contains
  // DESTROY(1) — if it landed after the new renderPage() below, it would
  // delete the fresh page mapping and every INSERT into the page would
  // silently no-op (found by harness-testing's sequential-render check).
  flushOps();
  // Reset the Background-Thread counters and trees so every render is
  // deterministic: same component ⇒ byte-identical first ops batch (element
  // ids restart at 2, event signs at ng:0, fresh page root). This is what
  // makes `captureFirstScreenOps` snapshots reproducible — and it isolates
  // sequential renders from each other. (Destroy the previous fixture first;
  // an app that is still alive would be left pointing at stale state.)
  resetShadowTreeState();
  resetEventRegistry();
  resetHostDataState();
  resetAppEventsState();
  resetPendingStyleClass();
  resetOpLogger();
  resetGestureState();
  installMockPapi();
  const g = globalThis as Record<string, unknown> & { renderPage?: (d: unknown) => void };
  if (typeof g.renderPage !== 'function') {
    throw new Error(
      "[angular-lynx/testing] the Main-Thread executor isn't loaded — add "
        + "`import 'angular-lynx/main-thread'` to your test entry.",
    );
  }
  g.renderPage({});
}

/**
 * A rendered component plus queries over the reconstructed native tree.
 * @public
 */
export interface LynxTestFixture<T> extends LynxQueries {
  /** The running application. */
  readonly app: ApplicationRef;
  /** The root component instance. */
  readonly instance: T;
  /** The mock native page root (walk `children`, read `attrs`/`text`/`events`). */
  readonly page: MockEl;

  /** First raw-text whose content includes `text`. Prefer {@link LynxQueries.getByText}, which returns the element. */
  findText(text: string): string | undefined;
  /** The tree, printable — great in failure messages. */
  tree(): string;

  /**
   * Fire a native event on an element the way the engine would (through the
   * sign registry), then wait for the update to render. Like a real tap, it
   * bubbles: the nearest element, from `el` up, with a listener for `event`
   * gets it. Throws if none has one.
   */
  fire(el: MockEl | undefined, event: string, payload?: unknown): Promise<void>;

  /** Resolve once pending change detection + ops flushes have applied. */
  stable(): Promise<void>;

  /** Destroy the application (runs Angular's destroy pass). */
  destroy(): void;
}

/** Options for {@link renderLynxComponent}. @public */
export interface RenderLynxComponentOptions {
  /** Application-level providers (router, your services, …). */
  providers?: (Provider | EnvironmentProviders)[];
}

/**
 * Bootstrap `component` onto a fresh mock Lynx page and return a fixture with
 * tree queries and event firing. The real renderer, wire protocol, and
 * Main-Thread executor all run — only the element PAPI is mocked.
 *
 * @public
 */
export async function renderLynxComponent<T>(
  component: Type<T>,
  options: RenderLynxComponentOptions = {},
): Promise<LynxTestFixture<T>> {
  setupLynxTestEnvironment();
  const app = await bootstrapLynxApplication(component, { providers: options.providers });
  const stable = async (): Promise<void> => {
    await tick();
    await whenFlushed();
    await tick();
  };
  await stable();
  const page = getPage();

  return {
    app,
    instance: app.components[0].instance as T,
    page,
    ...within(page),
    findText: (text) => findText(page, text),
    tree: () => printTree(page).join('\n'),
    fire: async (el, event, payload = {}) => {
      let target = el;
      while (target && typeof target.events[event]?.sign !== 'string') target = target.parent;
      const sign = target?.events[event]?.sign;
      if (typeof sign !== 'string') {
        throw new Error(
          `[angular-lynx/testing] no '${event}' listener bound on <${el?.type ?? '?'}> or above it` +
            (el ? '' : ' (element is undefined)'),
        );
      }
      publishEvent(sign, payload);
      await stable();
    },
    stable,
    destroy: () => {
      app.destroy();
      // Deliver the destroy batch now, while this fixture's environment is
      // still installed — see setupLynxTestEnvironment for why.
      flushOps();
    },
  };
}

/**
 * Run `component`'s first render headlessly and return the **exact serialized
 * string** of the first ops batch the renderer ships to the Main Thread — a
 * first-screen snapshot.
 *
 * Feed the string to `pluginAngularLynx({ firstScreen })` (via a JSON file)
 * and the Main Thread paints it synchronously inside `renderPage()`, before
 * the Background Thread boots — see
 * `main-thread/src/first-screen.ts` / docs/20-first-screen.md. Because
 * {@link setupLynxTestEnvironment} resets the id and event-sign counters, the
 * same component produces a byte-identical batch on-device and hydrates in
 * place; if the app's first render is nondeterministic the device falls back
 * to a teardown + re-render.
 *
 * The snapshot renders with **no host data** (empty `initData`, like
 * ReactLynx IFR's default-data constraint) — pass `providers` to control
 * anything else the first render reads.
 *
 * @public
 */
export async function captureFirstScreenOps<T>(
  component: Type<T>,
  options: RenderLynxComponentOptions = {},
): Promise<string> {
  const fixture = await renderLynxComponent(component, options);
  const first = getFirstOpsString();
  fixture.destroy();
  if (!first) {
    throw new Error(
      '[angular-lynx/testing] the bootstrap flushed no ops batch — nothing to snapshot.',
    );
  }
  return first;
}
