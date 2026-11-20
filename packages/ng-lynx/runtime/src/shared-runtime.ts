/**
 * Shared-runtime registry — how a **dynamic-component bundle** (built with
 * `pluginAngularLynx({ dynamicComponent: true })`) gets the *same*
 * `@angular/core` instance the host app is already running, instead of
 * bundling a second copy of its own.
 *
 * ## Why this has to exist at all
 *
 * A dynamic component is evaluated into the **same Background-Thread JS
 * realm** as its host (confirmed in `lynx-family/lynx`'s own
 * `appManager.ts`: `loadDynamicComponent` evaluates the fetched bundle via
 * `tt.lynx.requireModule(APP_SERVICE_NAME, url)`, the same module cache the
 * host's own code came from), and the host then mounts the loaded component
 * into *its* view tree with `ViewContainerRef.createComponent`.
 *
 * That only works if both sides share one Angular. Tested directly — two
 * isolated bundles, one dynamically importing the other, a real
 * `createComponent()` call (see docs/38-dynamic-component.md):
 *
 * - A dynamic bundle carrying its **own** bundled `@angular/core` fails,
 *   **even at the byte-identical same version** as the host: `NG0203`, from
 *   `getStandaloneInjector()` — Angular's "current injector" DI-context
 *   tracking is module-instance-scoped, so the host's injector machinery and
 *   the loaded bundle's factory functions can't agree on an active injection
 *   context. Passing an explicit `environmentInjector` doesn't help.
 * - Sharing one instance works completely, including a `(tap)` inside the
 *   loaded component updating its own signal and re-rendering.
 *
 * So this is not a version-compatibility knob — it's a hard requirement that
 * exactly one `@angular/core` exists in the realm.
 *
 * ## The mechanism (deliberately modelled on ReactLynx's)
 *
 * `@lynx-js/react` solves the identical problem for its own lazy bundles,
 * and this mirrors its design rather than inventing one: it keeps a registry
 * of module namespaces on a well-known global under
 * `Symbol.for('__REACT_LYNX_EXPORTS__(<module id>)')`, reached via
 * `target = __LEPUS__ ? globalThis : lynx` — i.e. on the Background Thread
 * the registry lives on the **`lynx` object**, not `globalThis` (BG and MT
 * don't share a `globalThis` on a real engine). Its `lazy`
 * package-export condition then swaps every runtime import for a shim that
 * re-exports out of that registry (`runtime/lazy/react.js`:
 * `export const { Component, … } = target[sExportsReact]`).
 *
 * ng-lynx does the same thing with the same shape, one namespace per
 * shared module id:
 *
 * - **Host** (`pluginAngularLynx({ dynamicComponentHost: true })`) — a
 *   generated module prepended to the Background entry imports each shared
 *   module and calls {@link publishSharedModule}.
 * - **Producer** (`pluginAngularLynx({ dynamicComponent: true })`) — those
 *   same module ids become webpack **externals** resolving to
 *   {@link sharedModuleExpression}, so the dynamic bundle contains no copy of
 *   them at all and reads the host's namespace at runtime.
 *
 * A module id that the host never published resolves to `undefined` and
 * fails at first use rather than silently rendering wrong, so
 * {@link readSharedModule} throws a message naming the missing id and the
 * option that fixes it.
 */

/** The Background Thread's shared-registry object (see this module's doc). */
interface SharedRegistryTarget {
  [key: symbol]: unknown;
}

// `lynx` is injected by the Lynx runtime wrapper as a parameter of the
// bundle's AMD-style callback — not a `globalThis` property (see flush.ts).
// eslint-disable-next-line no-var
declare var lynx: SharedRegistryTarget | undefined;

/**
 * Where the registry lives on this thread. Matches ReactLynx's
 * `target = __LEPUS__ ? globalThis : lynx`: on the Background Thread (the
 * only place Angular runs) that's the `lynx` object. Falls back to
 * `globalThis` when `lynx` isn't in scope — the headless harness, and any
 * engine that doesn't inject it.
 */
function registryTarget(): SharedRegistryTarget {
  return typeof lynx !== 'undefined' && lynx ? lynx : (globalThis as SharedRegistryTarget);
}

/**
 * The registry key for a module id. Mirrors ReactLynx's
 * `Symbol.for('__REACT_LYNX_EXPORTS__(@lynx-js/react)')` convention —
 * `Symbol.for` (not `Symbol`) so both bundles, compiled separately, resolve
 * the identical symbol from the runtime-wide symbol registry.
 *
 * @experimental
 */
export function sharedModuleKey(moduleId: string): symbol {
  return Symbol.for(`__ANGULAR_LYNX_EXPORTS__(${moduleId})`);
}

/**
 * The JS **source expression** a dynamic bundle uses to reach a shared
 * module — emitted by the plugin as a webpack `var`-type external, so
 * `import { Component } from '@angular/core'` becomes a property read off
 * the host's namespace object with no copy bundled.
 *
 * Kept here, next to {@link sharedModuleKey}, so the two halves of the
 * convention can't drift apart. Guarded for `lynx` being out of scope for
 * the same reason {@link registryTarget} is.
 *
 * @experimental
 */
export function sharedModuleExpression(moduleId: string): string {
  const target = "(typeof lynx !== 'undefined' && lynx ? lynx : globalThis)";
  return `${target}[Symbol.for(${JSON.stringify(`__ANGULAR_LYNX_EXPORTS__(${moduleId})`)})]`;
}

/**
 * Publish a module namespace for dynamic components to consume. Called by
 * the generated host module (see this module's doc); idempotent, and a
 * second publish of the same id is ignored rather than overwriting — the
 * host owns the instance, and a dynamic bundle must never replace it.
 *
 * @experimental
 */
export function publishSharedModule(moduleId: string, namespace: unknown): void {
  const target = registryTarget();
  const key = sharedModuleKey(moduleId);
  if (target[key] !== undefined) return;
  Object.defineProperty(target, key, {
    value: namespace,
    enumerable: false,
    writable: false,
    configurable: true,
  });
}

/**
 * Read a shared module namespace, throwing a message that names the missing
 * module id when the host never published it — the alternative being a
 * `Cannot read properties of undefined` from deep inside Angular, which says
 * nothing about the actual cause.
 *
 * @experimental
 */
export function readSharedModule(moduleId: string): unknown {
  const namespace = registryTarget()[sharedModuleKey(moduleId)];
  if (namespace === undefined) {
    throw new Error(
      `[ng-lynx] The dynamic component needs "${moduleId}" from its host, but the host `
        + 'never published it. Build the host with pluginAngularLynx({ dynamicComponentHost: '
        + `true }) — and make sure "${moduleId}" is in the shared module list of BOTH the host `
        + 'and this bundle. See docs/38-dynamic-component.md.',
    );
  }
  return namespace;
}

/**
 * Whether a shared module has been published — for a host that wants to
 * check its own wiring, and for tests.
 *
 * @experimental
 */
export function hasSharedModule(moduleId: string): boolean {
  return registryTarget()[sharedModuleKey(moduleId)] !== undefined;
}

/**
 * The module ids shared by default — deliberately **minimal**.
 *
 * Externals are matched on the exact request string, so a subpath like
 * `ng-lynx/elements` needs its own entry (a bare `ng-lynx` does
 * not cover it — found by building a real dynamic component and seeing the
 * elements package bundled into it).
 *
 * Why only these three:
 *
 * - `@angular/core` is the genuinely load-bearing one — the `NG0203` failure
 *   documented above is entirely about it.
 * - `ng-lynx` carries the renderer's own DI tokens and directives,
 *   whose identities the host's injector has to recognize.
 * - `ng-lynx/elements` is the typed-template package essentially every
 *   component imports, so a duplicate copy is both wasteful and an identity
 *   risk.
 *
 * All three are already in any ng-lynx app, so publishing them costs a
 * host essentially nothing. The larger framework packages (`@angular/common`,
 * `@angular/forms`, `@angular/router`, `ng-lynx/forms`, …) are
 * **deliberately not** here: sharing a module means the host must import its
 * whole namespace, which defeats tree-shaking and would pull e.g. the router
 * into hosts that never use it. Add the ones your dynamic components
 * actually need to `sharedModules` on **both** sides — a module the producer
 * externalizes but the host never published fails loudly at first use (see
 * {@link readSharedModule}), not silently.
 *
 * `@angular/compiler` is absent for a different reason: it only matters for
 * JIT, and dynamic-component builds are AOT.
 *
 * @experimental
 */
export const DEFAULT_SHARED_MODULES: readonly string[] = [
  '@angular/core',
  'ng-lynx',
  'ng-lynx/elements',
];
