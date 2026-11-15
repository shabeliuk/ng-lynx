/**
 * `loadDynamicComponent` — load a component bundle the *native host* points
 * to at runtime, not one the app's own build graph knows about (unlike
 * `loadComponent()` / `asyncChunks`, which resolve against webpack's own
 * async-chunk manifest — see docs/15-routing.md). This is the
 * Background-Thread half of Lynx's "dynamic component" mechanism (ReactLynx's
 * `loadLazyBundle` + `<DynamicComponent>`), used for cross-app embedding: a
 * card built and shipped independently of the host app that's loading it.
 *
 * The contract below is confirmed against `lynx-family/lynx`'s own source
 * (the ground truth for real on-device PAPI behavior — see this repo's own
 * `lynx-family/lynx` reference), not assumed from ReactLynx's public API
 * alone:
 *
 *   - `js_libraries/lynx-core/src/lynx/lynx.ts`'s `QueryComponent` wrapper —
 *     on success (already loaded, or the native layer reports the bundle
 *     ready) calls back with
 *     `{ code: 0, data: { url, sync, error_message, mode }, detail: { schema,
 *     cache, errMsg } }`; any other `code` is a failure.
 *   - `js_libraries/lynx-core/src/appManager.ts`'s `loadDynamicComponent` —
 *     evaluates the bundle's already-fetched source via
 *     `tt.lynx.requireModule(APP_SERVICE_NAME, componentUrl)` (the *same*
 *     conventional module name — `'app-service.js'` — every Lynx bundle's own
 *     Background-Thread code registers itself under) and saves the result as
 *     that url's exports.
 *   - `js_libraries/type-element-api/types/element-api.d.ts`'s
 *     `DynamicComponentResult` — the versioned type source for the callback
 *     shape above.
 *
 * So a "dynamic component" bundle is architecturally an ordinary
 * Background-Thread bundle (the same shape `pluginAngularLynx` already
 * produces) — evaluated into the *same* JS realm as the host app via the
 * engine's own module cache, not a separate isolated context. Once resolved,
 * its exports are read back via `lynxCoreInject.tt.getDynamicComponentExports
 * (schema)`.
 *
 * **A real constraint, empirically confirmed (not just theorized) — this
 * function does not, and cannot, solve it itself; the *build* of the loaded
 * bundle must.** Because the loaded bundle shares the host's JS realm, its
 * Angular component class needs to come from the *exact same*
 * `@angular/core` module instance the host's own change-detection and DI are
 * running — not just a "compatible version". Tested directly (two isolated
 * esbuild bundles, one dynamically `import()`ing the other at runtime, no
 * static bundling across them):
 *
 *   - **Bundling a separate `@angular/core` into the loaded component fails
 *     — even at the exact same version as the host.** Two variants both
 *     threw: a producer whose own `@Component` never re-registered
 *     `@angular/compiler` crashed inside `compileComponentFromMetadata`
 *     (`Cannot read properties of undefined (reading 'passThroughInput')`);
 *     a producer that *did* re-register its own compiler got past that and
 *     crashed instead with `NG0203` inside
 *     `ViewContainerRef.createComponent()`'s `getStandaloneInjector()` path —
 *     Angular's DI "current injector" tracking is module-instance-scoped, so
 *     the host's injector machinery calling into the loaded bundle's own
 *     factory functions (or vice versa) can't agree on an active injection
 *     context. This reproduced identically with a *same-version* (21.2.17)
 *     duplicate bundle, and passing an explicit `environmentInjector`/
 *     `injector` to `createComponent()` didn't help — `getStandaloneInjector`
 *     still runs for any `standalone: true` component regardless. So this
 *     isn't a version-skew problem specifically; it's that **any** separately
 *     bundled `@angular/core` — even byte-identical — breaks this.
 *   - **Treating `@angular/core` (and `@angular/compiler`) as *external*,
 *     shared dependencies that resolve to the host's already-loaded instance
 *     works completely** — `createComponent()` succeeded, the loaded
 *     component's own template rendered, and a `(tap)` inside it correctly
 *     updated its own signal and re-rendered. The loaded component didn't
 *     even need to import `ng-lynx` itself: its Lynx element tags
 *     compile to `Renderer2` calls resolved via DI from the *host's* already-
 *     running `LynxRendererFactory2`, not a static import.
 *
 * **The actionable conclusion:** build a dynamic-component bundle with
 * `@angular/core` / `@angular/compiler` marked `external` (not `bundle:
 * true`) — the standard micro-frontend "shared singleton dependency"
 * pattern — so it resolves, via the engine's own `requireModule` cache
 * (confirmed above to be shared across everything evaluated into one BG
 * realm), to the *same* instance the host already loaded. This also means
 * the dynamic bundle is implicitly pinned to whatever Angular version the
 * host happens to have loaded — there's no meaningful "compatible major
 * version" story independent of that, since sharing one instance forces
 * exact identity, not just compatibility. `pluginAngularLynx` doesn't yet
 * have a build mode that produces this shape (see docs/38-dynamic-component.md);
 * this function assumes whatever's loaded already satisfies it.
 *
 * This is also, like gestures and `@defer (on viewport)`, verified only
 * against a mock for the actual `lynx.QueryComponent`/
 * `getDynamicComponentExports` wiring — `web-core`'s own implementations
 * exist (confirmed by reading their source), but there's no device in this
 * environment to exercise the real fetch-and-evaluate path end to end. The
 * cross-instance finding above, though, used real `@angular/core` builds and
 * a real `ViewContainerRef.createComponent()` call — not mocked.
 */

/** The callback result shape `lynx.QueryComponent` / `getNativeLynx().QueryComponent` deliver. */
interface DynamicComponentQueryResult {
  code: number;
  data?: { url: string; sync?: boolean; error_message?: string; mode?: string };
  detail?: { schema: string; cache?: boolean; errMsg?: string };
}

// `lynx` is injected by the Lynx runtime wrapper as a parameter of the
// bundle's AMD-style callback — not on `globalThis` (see flush.ts). Declared
// module-scoped, minimally, so this file type-checks standalone.
// eslint-disable-next-line no-var
declare var lynx:
  | {
      QueryComponent?: (source: string, callback: (result: DynamicComponentQueryResult) => void) => void;
      getNativeLynx?: () => {
        QueryComponent?: (source: string, callback: (result: DynamicComponentQueryResult) => void) => void;
      } | undefined;
    }
  | undefined;

// `lynxCoreInject` is likewise injected, not on `globalThis` — same pattern
// as entry-background.ts / host-data.ts / app-events.ts.
// eslint-disable-next-line no-var
declare var lynxCoreInject:
  | { tt?: { getDynamicComponentExports?: (schema: string) => unknown } | null }
  | null
  | undefined;

/**
 * Load a dynamic-component bundle by `source` (a URL or bundle id — resolved
 * by the native host, not this package) and resolve its module exports.
 *
 * For an ng-lynx dynamic component, the resolved value is expected to be
 * shaped `{ default: SomeComponentType }` — mount it with
 * `ViewContainerRef.createComponent(resolved.default)`, same as any other
 * dynamic component creation.
 *
 * @public
 */
export function loadDynamicComponent<T = unknown>(source: string): Promise<{ default: T }> {
  return new Promise((resolve, reject) => {
    const query = lynx?.QueryComponent ?? lynx?.getNativeLynx?.()?.QueryComponent;
    if (!query) {
      reject(
        new Error(
          '[ng-lynx] loadDynamicComponent: lynx.QueryComponent is not available on this engine.',
        ),
      );
      return;
    }
    query(source, (result) => {
      if (result?.code !== 0) {
        const raw = JSON.stringify(result);
        const hint = notABundleHint(result?.code, raw);
        reject(
          new Error(`[ng-lynx] loadDynamicComponent(${source}) failed: ${hint ? `${hint} Engine result: ` : ''}${raw}`),
        );
        return;
      }
      const schema = result.detail?.schema ?? source;
      const exports = lynxCoreInject?.tt?.getDynamicComponentExports?.(schema);
      if (!exports) {
        reject(
          new Error(
            `[ng-lynx] loadDynamicComponent(${source}): resolved but no exports were found for schema "${schema}".`,
          ),
        );
        return;
      }
      resolve(exports as { default: T });
    });
  });
}

/**
 * The engines don't say "not found": a response that isn't a bundle comes
 * back as a broken one. Measured on iOS: a non-empty body (the dev server's
 * 28-byte 404 page) fails with code 160103 and "Decode error", while the
 * LynxError says "bundle file is broken. The expected size is 1936287828",
 * which is the body's first four bytes, "This", read as a number. An empty
 * body fails with "template binary is empty". The web preview says "Invalid
 * Magic Header", for a 404 or for the native packaging. Say what they mean.
 */
function notABundleHint(code: number | undefined, raw: string): string {
  const notABundle =
    code === 160103 || /Decode error|bundle file is broken|template binary is empty|Invalid Magic Header/i.test(raw);
  if (!notABundle) return '';
  return (
    'the URL did not return a bundle for this platform. Check that it is served (a 404 page is ' +
    'reported this way), and that it is the .lynx bundle on a device and the .web one in the web preview.'
  );
}
