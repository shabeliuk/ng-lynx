/**
 * Dev client for **both** targets — the `web` preview (`@lynx-js/web-core`)
 * and `lynx` (device/simulator): **full HMR** — state-preserving component
 * hot-swap on save — with a target-appropriate fallback for changes that
 * can't be hot-applied (a DevTool-driven reload on device, a console notice
 * on web, where no reload is reachable).
 *
 * History (see docs/05-build-integration.md for the complete writeup):
 * rsbuild's own dev client crashes inside the Background Worker (its reload
 * path needs `location`, its HMR apply path needs `lynx.requireModuleAsync`,
 * which `@lynx-js/web-core` doesn't implement), so `web`'s `dev.hmr`/
 * `dev.liveReload` are kept `false` and this module replaces it. It speaks
 * the same `/rsbuild-hmr` websocket protocol (message shapes and the
 * `lastHash !== __webpack_hash__` guard taken from `@rsbuild/core`'s client
 * source). A full automatic *reload* remains unreachable from any thread our
 * code runs on **on web** in this web-core version (`lynx.reload()` is a
 * no-op for new code; no reachable `window.location` anywhere) — but it IS
 * reachable on device, see {@link requestDeviceReload}.
 *
 * **Why the same client serves the `lynx` target too** (this used to be
 * assumed to need a separate, CDP-based transport — it doesn't):
 * `@lynx-js/rspeedy`'s dev plugin points the `lynx` environment's dev client
 * at the *same* `/rsbuild-hmr` endpoint over a plain **WebSocket**
 * (`protocol=ws`), providing a real `WebSocket` global for it via a
 * `ProvidePlugin` binding to `@lynx-js/websocket` (a native-module-backed
 * implementation; needs Lynx >= 2.16). The CDP transport in
 * `@lynx-js/webpack-dev-transport` is only the *fallback* used when
 * rspeedy's own `__webpack_dev_server_client__` isn't injected — and rspeedy
 * always injects it. Everything else the hot-apply path needs is likewise
 * already configured for `lynx`: `HotModuleReplacementPlugin` is on by
 * rsbuild default (so update assets are emitted), and dev `publicPath` is
 * the absolute dev-server URL, so the device fetches them from your machine
 * exactly as it already does for lazy chunks. The one piece that was
 * missing was nothing more than importing a client at all — rspeedy leaves
 * that to the framework plugin (ReactLynx and vue-lynx both prepend
 * `@lynx-js/webpack-dev-transport/client` to their Background entry;
 * `pluginAngularLynx` prepends *this* module instead, for both targets).
 *
 * How the socket reaches this module on `lynx`, confirmed by reading the
 * emitted bundle rather than assumed: rspeedy's `ProvidePlugin` sees the
 * free-variable `WebSocket` in the `new WebSocket(...)` expression below and
 * injects a module-scoped binding for it —
 * `var WebSocket = __webpack_require__('…/@lynx-js/websocket/lib/index.js').default`
 * — so the bare identifier resolves to the native-module-backed polyfill,
 * with the whole implementation pulled into the bundle. On `web` no such
 * plugin applies and the same identifier is the Worker's real global. One
 * code path, two sources.
 *
 * The `new` call is wrapped in try/catch rather than guarded by
 * `typeof WebSocket === 'undefined'`. Both work here (the injected binding
 * makes `typeof` report `'function'` too, since the `new` expression is what
 * triggers the injection either way), but the try/catch doesn't depend on
 * that interaction being true, and covers an engine that genuinely has no
 * WebSocket at all.
 *
 * What replaced the old "reload manually" dead end: the plugin enables
 * rspack's `HotModuleReplacementPlugin` for `web` dev builds — **emission
 * only**, rsbuild's client stays uninjected — so every rebuild produces
 * standard hot-update assets containing exactly the changed module
 * factories. On each rebuild notification this client:
 *
 *   1. fetches `__webpack_require__.p + hmrF()` (the update manifest named
 *      by the *running* bundle's hash) and each listed chunk's
 *      `.hu(chunkId)` update file — plain `fetch`, bypassing the
 *      `module.hot.apply()` chunk-loading path that needed
 *      `lynx.requireModuleAsync`;
 *   2. evaluates each update chunk to get its `{ modules, runtime }`. On
 *      `lynx` the runtime-wrapper plugin wraps the chunk, so only the engine's
 *      `lynx.requireModuleAsync` can evaluate it (see {@link loadWrappedChunk});
 *   3. for every changed module already in the live module cache whose old
 *      exports include component classes, evaluates the new factory against
 *      the live `__webpack_require__` (so `@angular/core` etc. resolve to
 *      the loaded instances) and calls {@link hotSwapComponent} for each
 *      matching component export — live views rebuild in place, instances
 *      and signal state preserved (docs/31-hot-swap.md);
 *   4. runs the update's runtime patch (advances `__webpack_require__.h()`
 *      so the *next* save's manifest name resolves), and prints what was
 *      swapped — or the manual-reload notice for anything unswappable
 *      (logic-only modules, removed modules, structural changes).
 *
 * Semantics inherited from the swap primitive: template-level edits apply
 * live; class-body/logic changes still need a manual reload (the old
 * instances keep their prototypes) — the fallback notice says so.
 */
import { hotSwapComponent } from './hot-swap.js';

declare var __webpack_hash__: string;

// Injected by the bundle wrapper as a bare identifier, not a `globalThis` property.
// eslint-disable-next-line no-var
declare var lynx:
  | { requireModuleAsync?(url: string, callback: (error: unknown, exports: unknown) => void): void }
  | undefined;

/**
 * The Lynx DevTool's CDP entry point, exposed as a native module on the
 * Background Thread. Present on device/simulator when a DevTool session is
 * attached; absent on the web preview.
 */
interface LynxDevToolSetModule {
  invokeCdp?: (message: string, callback?: (result: string) => void) => void;
}

// `NativeModules` is injected by the Lynx bundle wrapper as a bare identifier
// (like `lynx` / `lynxCoreInject`), not a `globalThis` property — same
// declaration pattern as native-modules.ts.
// eslint-disable-next-line no-var
declare var NativeModules: Record<string, LynxDevToolSetModule | undefined> | undefined;

/**
 * Ask the Lynx DevTool to reload the card — the device/simulator equivalent
 * of the browser page reload that is **not** reachable on the web preview
 * (see this module's doc). Returns `true` when a reload was actually
 * requested, so callers can fall back to a console notice when it wasn't.
 *
 * The mechanism is the one `@lynx-js/webpack-dev-transport`'s own
 * `reloadApp` uses: a `Page.reload` CDP command through
 * `NativeModules.LynxDevToolSetModule.invokeCdp`. Both spellings of the
 * module name are probed because upstream probes both — engine builds differ
 * on the capitalization of "DevTool"/"Devtool".
 *
 * **Whether it reloads depends on Explorer's DevTool switch, not on the desktop
 * app.** With Settings → Lynx DevTool Switches → Lynx DevTool on, the command is
 * answered and the page re-downloads and reloads, with no DevTool app running.
 * With the switch off, `invokeCdp` is still there but never calls back, and
 * nothing happens (both measured on Explorer 4.2, iOS simulator, 2026-11-10). So
 * `onUnanswered` runs when no answer has come after {@link CDP_ANSWER_TIMEOUT_MS}:
 * a reloaded page never gets that far.
 *
 * @public
 */
export function requestDeviceReload(onUnanswered?: () => void): boolean {
  const modules = typeof NativeModules !== 'undefined' ? NativeModules : undefined;
  const devtool = modules?.['LynxDevToolSetModule'] ?? modules?.['LynxDevtoolSetModule'];
  if (typeof devtool?.invokeCdp !== 'function') return false;
  let answered = false;
  try {
    devtool.invokeCdp(
      JSON.stringify({ method: 'Page.reload', params: { ignoreCache: true } }),
      (result: string) => {
        answered = true;
        if (!result) return;
        try {
          const { error } = JSON.parse(result) as { error?: { message?: string } };
          if (error) console.error('[ng-lynx] DevTool reload failed:', error.message);
        } catch {
          // A non-JSON ack is not an error worth surfacing.
        }
      },
    );
    if (onUnanswered) {
      setTimeout(() => {
        if (!answered) onUnanswered();
      }, CDP_ANSWER_TIMEOUT_MS);
    }
    return true;
  } catch {
    return false;
  }
}

/** How long {@link requestDeviceReload} waits for the DevTool to answer. @internal */
export const CDP_ANSWER_TIMEOUT_MS = 1500;

/** The slice of webpack/rspack's runtime this client leans on (all provided
 * by the HMR runtime the plugin enables for `web` dev builds). */
interface WebpackRequireLike {
  (id: string): unknown;
  /** public path — absolute (`http://host:port/`) in rsbuild dev builds. */
  p?: string;
  /** current full hash (patched forward by each applied update's runtime). */
  h?: () => string;
  /** update-manifest filename for the current hash. */
  hmrF?: () => string;
  /** update-chunk filename for a chunk id at the current hash. */
  hu?: (chunkId: string) => string;
  /** module cache: id → { exports }. */
  c?: Record<string, { exports: Record<string, unknown> } | undefined>;
  /** module factories: id → factory. */
  m?: Record<string, ModuleFactory>;
}

/** Module factory signature used by rspack's emitted update chunks. */
export type ModuleFactory = (
  module: { id: string; exports: Record<string, unknown> },
  exports: Record<string, unknown>,
  require: unknown,
) => void;

interface HotUpdateChunk {
  ids?: string[];
  modules?: Record<string, ModuleFactory>;
  runtime?: (wr: unknown) => void;
}

interface HotUpdateManifest {
  c?: string[];
  r?: string[];
  m?: string[];
}

// The free variable is bound to the real runtime when this file is bundled by
// rspack; absent (undefined/throwing) in any other context (headless tests).
declare const __webpack_require__: WebpackRequireLike | undefined;

function getWebpackRequire(): WebpackRequireLike | undefined {
  try {
    return typeof __webpack_require__ === 'function' ? __webpack_require__ : undefined;
  } catch {
    return undefined;
  }
}

function isComponentClass(value: unknown): value is import('@angular/core').Type<unknown> {
  return typeof value === 'function' && 'ɵcmp' in (value as object);
}

/**
 * Resolve the websocket URL to actually connect to, preferring the **origin
 * the running bundle was itself served from** (`__webpack_require__.p`, the
 * absolute dev `publicPath` rspeedy configures) over the one baked in at
 * build time, keeping only the path + query (`/rsbuild-hmr?token=…`) from the
 * baked URL.
 *
 * This matters on **device**: the plugin normalizes an all-interfaces bind
 * address (`0.0.0.0`/`::`) to `localhost` when baking the URL, which is
 * correct for the web preview (same machine) but points a phone at *itself*.
 * `publicPath` is the LAN address rspeedy resolved (`http://192.168.1.x:port/`)
 * — by definition reachable from the device, since that's where it fetches
 * the bundle and its chunks from.
 *
 * Deliberately string-based rather than using `URL`: the Lynx Background
 * engine (PrimJS) isn't guaranteed to provide that constructor, and this runs
 * before anything would polyfill one. Falls back to `bakedUrl` unchanged
 * whenever the public path isn't an absolute http(s) URL (e.g. the headless
 * harness, or a relative publicPath).
 */
export function resolveSocketUrl(bakedUrl: string, publicPath: string | undefined): string {
  if (typeof publicPath !== 'string') return bakedUrl;
  const origin = /^(https?):\/\/([^/]+)/.exec(publicPath);
  if (!origin) return bakedUrl;
  const protocol = origin[1] === 'https' ? 'wss' : 'ws';
  // Path + query of the baked URL: everything from the first `/` that follows
  // its own `scheme://host` prefix.
  const schemeEnd = bakedUrl.indexOf('://');
  if (schemeEnd < 0) return bakedUrl;
  const pathStart = bakedUrl.indexOf('/', schemeEnd + 3);
  const pathAndQuery = pathStart < 0 ? '/rsbuild-hmr' : bakedUrl.slice(pathStart);
  return `${protocol}://${origin[2]}${pathAndQuery}`;
}

/**
 * A comparable fingerprint of a component's *compiled template*: the
 * generated template function's source plus the definition's consts/vars/
 * decls/styles. Two builds of an unchanged component produce identical
 * fingerprints; a template edit changes it. Used to swap **only the
 * component that was actually edited** — a module usually exports (or a
 * rebuild re-emits) more classes than the one that changed, and swapping an
 * unchanged parent would pointlessly rebuild its view, recreating child
 * components and losing THEIR state. A changed module none of whose
 * component fingerprints changed is a logic-only edit — not hot-swappable
 * (the live instances keep their old prototypes), so it's reported for the
 * manual-reload notice instead.
 */
function defFingerprint(cls: import('@angular/core').Type<unknown>): string {
  const def = (cls as unknown as Record<string, unknown>)['ɵcmp'] as
    | { template?: unknown; consts?: unknown; vars?: unknown; decls?: unknown; styles?: unknown }
    | undefined;
  if (!def) return 'no-def';
  return JSON.stringify(
    { t: def.template, c: def.consts, v: def.vars, d: def.decls, s: def.styles },
    (_key, value: unknown) => (typeof value === 'function' ? String(value) : value),
  );
}

/**
 * Evaluate one fetched hot-update chunk. rspack's `require`-style chunk
 * format assigns onto a CommonJS `exports` (`exports.ids/.modules/.runtime`);
 * the older jsonp style calls a `self["webpackHotUpdate<name>"]` global —
 * both are handled.
 */
export function evaluateUpdateChunk(source: string): HotUpdateChunk {
  const globalHook = source.match(/(?:self|globalThis)\[["'](webpackHotUpdate[^"']*)["']\]/);
  if (!globalHook) {
    const moduleShim: { id: string; exports: HotUpdateChunk } = { id: '', exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('exports', 'module', source)(moduleShim.exports, moduleShim);
    return moduleShim.exports;
  }
  let captured: HotUpdateChunk = {};
  const g = globalThis as Record<string, unknown>;
  const name = globalHook[1] as string;
  const previous = g[name];
  g[name] = (_chunkId: unknown, modules: HotUpdateChunk['modules'], runtime: HotUpdateChunk['runtime']) => {
    captured = { modules, runtime };
  };
  try {
    // `self` is passed explicitly: it's the worker global in the real BG
    // thread, but absent in Node (the headless harness).
    // eslint-disable-next-line no-new-func
    new Function('self', source)(globalThis);
  } finally {
    if (previous === undefined) delete g[name];
    else g[name] = previous;
  }
  return captured;
}

/**
 * Whether a chunk came out of the runtime-wrapper plugin, as every chunk of the
 * `lynx` environment does. Evaluating that source only registers it with the
 * engine (`tt.define`) and exports nothing, so {@link evaluateUpdateChunk} would
 * return an empty update.
 */
export function isRuntimeWrappedChunk(source: string): boolean {
  return source.includes('tt.define(');
}

/** Evaluate a wrapped chunk with the engine's own module loader, as lazy routes do. */
export function loadWrappedChunk(url: string): Promise<HotUpdateChunk> {
  return new Promise((resolve, reject) => {
    if (typeof lynx === 'undefined' || typeof lynx?.requireModuleAsync !== 'function') {
      reject(new Error('lynx.requireModuleAsync is not available'));
      return;
    }
    lynx.requireModuleAsync(url, (error, exports) => {
      if (error) reject(error);
      else resolve(exports as HotUpdateChunk);
    });
  });
}

/**
 * Apply one update's changed module factories against the live module graph.
 *
 *  - a changed module **not in the cache** is newly added: its factory is
 *    installed into `require.m` (nothing referenced it before, so this is
 *    side-effect free) so donor evaluation below can import it;
 *  - a changed module whose old exports include component classes is
 *    re-evaluated as a **donor** (fresh module object, live `require`), and
 *    each component export present in both old and new is hot-swapped —
 *    live views rebuild in place around the existing instances;
 *  - anything else (services, css shims, main-thread-layer modules) can't be
 *    hot-applied and is reported in `skipped`.
 *
 * Exported for the verify harness; `swap` is injectable for the same reason.
 */
export function applyModuleUpdates(
  modules: Record<string, ModuleFactory>,
  requireLike: WebpackRequireLike,
  swap: (type: import('@angular/core').Type<unknown>, next: import('@angular/core').Type<unknown>) => void = hotSwapComponent,
): { swapped: string[]; skipped: string[] } {
  const swapped: string[] = [];
  const skipped: string[] = [];
  const cache = requireLike.c ?? {};

  for (const [id, factory] of Object.entries(modules)) {
    const oldModule = cache[id];
    if (!oldModule) {
      if (requireLike.m) requireLike.m[id] = factory;
      continue;
    }
    const oldComponents = Object.entries(oldModule.exports).filter(([, v]) => isComponentClass(v));
    if (oldComponents.length === 0) {
      skipped.push(id);
      continue;
    }
    const fresh: { id: string; exports: Record<string, unknown> } = { id, exports: {} };
    factory(fresh, fresh.exports, requireLike);
    let swappedAny = false;
    for (const [name, next] of Object.entries(fresh.exports)) {
      if (!isComponentClass(next)) continue;
      const prev = oldModule.exports[name];
      if (
        isComponentClass(prev)
        && prev !== next
        && defFingerprint(prev) !== defFingerprint(next)
      ) {
        swap(prev, next);
        swapped.push(name);
        swappedAny = true;
      }
    }
    // A component module rebuilt with every fingerprint unchanged means the
    // edit was logic-only — the one thing a swap can't apply.
    if (!swappedAny) skipped.push(id);
  }
  return { swapped, skipped };
}

/**
 * Fetch and apply the pending hot update (manifest + chunks) for the running
 * bundle. Resolves `true` when everything relevant was hot-swapped (no
 * notice needed), `false` when the caller should fall back to the
 * reload-manually notice. Never throws.
 */
async function tryHotApply(): Promise<boolean> {
  const wr = getWebpackRequire();
  if (!wr?.hmrF || !wr.hu || !wr.c || typeof fetch !== 'function') return false;
  const base = wr.p ?? '/';
  try {
    const manifestRes = await fetch(base + wr.hmrF());
    if (!manifestRes.ok) return false;
    const manifest = (await manifestRes.json()) as HotUpdateManifest;
    // Removed chunks/modules = structural change beyond a swap's reach.
    if ((manifest.r?.length ?? 0) > 0 || (manifest.m?.length ?? 0) > 0) return false;

    const updates: HotUpdateChunk[] = [];
    for (const chunkId of manifest.c ?? []) {
      const chunkUrl = base + wr.hu(chunkId);
      const chunkRes = await fetch(chunkUrl);
      if (!chunkRes.ok) return false;
      const source = await chunkRes.text();
      const update = isRuntimeWrappedChunk(source)
        ? await loadWrappedChunk(chunkUrl)
        : evaluateUpdateChunk(source);
      // An update with no modules would swap nothing and report nothing, so the
      // edit would just vanish. A reload at least shows it.
      if (!update.modules) return false;
      updates.push(update);
    }

    const swapped: string[] = [];
    const skipped: string[] = [];
    for (const update of updates) {
      const result = applyModuleUpdates(update.modules ?? {}, wr);
      swapped.push(...result.swapped);
      skipped.push(...result.skipped);
    }
    // Advance the runtime (notably __webpack_require__.h()) so the NEXT
    // rebuild's manifest name resolves from here.
    for (const update of updates) {
      if (typeof update.runtime === 'function') update.runtime(wr);
    }

    if (swapped.length > 0) {
      console.info(
        `[ng-lynx] Hot-swapped ${swapped.join(', ')} — views rebuilt in place, state preserved.`,
      );
    }
    if (skipped.length > 0) {
      console.warn(
        `[ng-lynx] Some changed modules can't be hot-swapped (${skipped.join(', ')}) — `
          + 'logic/service/main-thread changes need a manual reload.',
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[ng-lynx] Hot update failed — falling back to manual reload.', err);
    return false;
  }
}

interface DevServerMessage {
  type: string;
  data?: unknown;
}

/**
 * Connect to the dev server's HMR websocket. On each rebuild, attempt a
 * state-preserving hot-swap of the changed components; print the
 * reload-manually notice when (and only when) the change couldn't be
 * hot-applied. Reconnects (capped backoff) on drop; never throws.
 */
export function installDevReloadClient(wsUrl: string): void {
  // On `lynx` the constructor referenced below arrives via rspeedy's
  // ProvidePlugin (`@lynx-js/websocket`); on `web` it's the Worker's own
  // global. `connect()` catches the case where there is neither. See this
  // module's doc.
  let lastHash: string | undefined;
  let lastProcessedHash: string | undefined;
  let reconnectAttempt = 0;
  let socket: WebSocket | undefined;
  let pingId: ReturnType<typeof setInterval> | undefined;
  let applying = false;

  const shouldUpdate = (): boolean => lastHash !== __webpack_hash__;

  const notify = (): void => {
    // On device/simulator the DevTool can reload the page (the web preview has
    // no such path), but only with Explorer's DevTool switch on: otherwise the
    // command goes unanswered and nothing happens. Say so only then.
    const asked = requestDeviceReload(() => {
      console.warn(
        '[ng-lynx] This change couldn’t be hot-swapped, and the page can’t reload itself: '
          + 'the Lynx DevTool didn’t answer. Reopen the page, or turn on Settings → Lynx DevTool '
          + 'Switches → Lynx DevTool in Lynx Explorer and restart it, and later edits will reload '
          + 'by themselves (no DevTool app needed). See docs/31-hot-swap.md.',
      );
    });
    if (asked) return;
    console.warn(
      '[ng-lynx] A new build is ready — reload the web preview to see it '
        + '(this change couldn’t be hot-swapped; see docs/31-hot-swap.md).',
    );
  };

  const onRebuilt = (): void => {
    // One attempt (and at most one notice) per reported build — a re-sent
    // `ok` for a hash that already failed to hot-apply stays quiet.
    if (!shouldUpdate() || applying || lastHash === lastProcessedHash) return;
    lastProcessedHash = lastHash;
    applying = true;
    void tryHotApply()
      .then((fullyApplied) => {
        if (!fullyApplied) notify();
        // On success h() has advanced to the new hash, so shouldUpdate() is
        // false again until the next real rebuild. On failure it stays true —
        // later rebuilds will retry (and, failing that, notify again).
      })
      .finally(() => {
        applying = false;
      });
  };

  const onMessage = (event: MessageEvent): void => {
    let message: DevServerMessage;
    try {
      message = JSON.parse(event.data as string) as DevServerMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case 'hash':
        lastHash = message.data as string;
        break;
      case 'ok':
      case 'warnings':
        onRebuilt();
        break;
      case 'static-changed':
      case 'full-reload':
        notify();
        break;
      default:
        break;
    }
  };

  const onOpen = (): void => {
    reconnectAttempt = 0;
    pingId = setInterval(() => {
      if (socket?.readyState === socket?.OPEN) socket?.send(JSON.stringify({ type: 'ping' }));
    }, 30000);
  };

  const onClose = (): void => {
    if (pingId !== undefined) clearInterval(pingId);
    socket = undefined;
    reconnectAttempt++;
    setTimeout(connect, Math.min(1000 * 1.5 ** reconnectAttempt, 10000));
  };

  // Prefer the origin the bundle was actually served from (correct on device,
  // where the baked `localhost` fallback would mean the phone itself).
  const resolvedUrl = resolveSocketUrl(wsUrl, getWebpackRequire()?.p);

  function connect(): void {
    try {
      socket = new WebSocket(resolvedUrl);
    } catch {
      // No WebSocket in this environment at all (see the `typeof` note in
      // this module's doc) — nothing further this client can do.
      return;
    }
    socket.addEventListener('open', onOpen);
    socket.addEventListener('close', onClose);
    socket.addEventListener('message', onMessage);
  }

  connect();
}
