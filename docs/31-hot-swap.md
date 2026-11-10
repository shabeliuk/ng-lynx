# 31 — Full HMR: state-preserving component hot-swap

**Save a template edit and watch it apply live** — on the `web` preview, the
dev loop now hot-swaps changed components in place: no reload, and component
state (signals, fields, injected services, input values) survives the save.
Verified end-to-end: bump `examples/hot-swap`'s counter to 3, save a template
edit, and the preview re-renders the new template still showing 3.

Two halves make that work: a runtime primitive (`hotSwapComponent`) and a
dev-loop transport that drives it on save. Both are described below.

## The primitive: `hotSwapComponent(type, next)`

Replaces the compiled definition of a **live** component class and rebuilds
every rendered view of it in place — keeping the component instances. It is
usable directly (that's the runtime half of full HMR, and how the transport
applies updates):

```ts
import { hotSwapComponent } from 'angular-lynx';

// CounterCard is live on screen with count() === 3.
hotSwapComponent(CounterCard, CounterCardV2);
// → every <counter-card> view rebuilds with V2's template,
//   still showing 3. No reload, no lost state.
```

Try it: `examples/hot-swap` (`npm run dev`, open the web preview, bump the
counter, tap "Swap to v2"). Headless proof: `npm run verify:hmr`.

## Under the hood: Angular ships its own HMR runtime

Since Angular 19, `@angular/core` publicly exports
**`ɵɵreplaceMetadata`** — the same runtime function Angular CLI's dev server
uses to hot-apply template/style edits without a page reload. Given a live
class and an `applyMetadata` function that installs a new compiled definition
on it, it:

1. **merges the new definition into the old one in place**, keeping the
   original `type`, `setInput`, and the already-resolved
   `directiveDefs`/`pipeDefs`;
2. walks every tracked **root** view, finds each `LView` whose `tView` came
   from the old definition, and **recreates it around the existing component
   instance** — `lView[CONTEXT]` (the instance) is passed straight into the
   replacement `createLView`, which is precisely why state survives;
3. renders the replacement through the environment's `RendererFactory2`.

Everything in that path is renderer-agnostic:

- The one DOM-touching branch (`host.cloneNode`/`replaceWith`) is
  ShadowDom-encapsulation-only — Lynx never uses it.
- Root-view tracking (`attachPatchData(hostElement, rootLView)`) is
  **unconditional**, so it works with the `ngDevMode: false` define our Lynx
  bundles require (verified: the whole flow runs under `ngDevMode: false`
  both in the harness build and in the AOT web preview).
- Teardown + rebuild go through the Lynx renderer, so they reach the Main
  Thread as ordinary `REMOVE`/`DESTROY` + `CREATE`/`INSERT` ops in one flush
  batch. **The Main Thread needs no HMR support at all.**

`hotSwapComponent` (`runtime/src/hot-swap.ts`) is a thin wrapper: it reads
`next`'s compiled definition and passes an `applyMetadata` that assigns a
copy of it (with `tView: null`) onto `type`. Assignment — not
`Object.defineProperty` — on purpose: an AOT definition is a writable static
field and a JIT definition is an accessor **with a setter**, so assignment
works in both, while `defineProperty` throws on the JIT accessor whenever
`ngDevMode` is false (it's defined `configurable: !!ngDevMode`).

## Semantics (inherited from Angular's own HMR)

- **Template-level changes only.** The instance is not re-constructed and the
  definition keeps the original resolved `directiveDefs`/`pipeDefs` — a new
  template may only use dependencies the original already imported. Logic
  changes (constructor, methods, providers, new imports) need a full reload —
  the same rule Angular CLI's HMR applies (it falls back to a page reload for
  those).
- The old view's `ngOnDestroy`-registered cleanup for *view-local* things
  (embedded views, directives declared in the old template) runs as part of
  the teardown; the component's own instance is untouched.
- Swaps are repeatable — edit → save → edit → save keeps working against the
  same (merged-in-place) definition. Verified explicitly by the harness.
- Component `styles` are not re-registered (Lynx CSS lives in the template
  bundle's CSS system) — template markup/bindings swap; style-sheet edits are
  a rebuild concern.

## One executor fix this required

Angular's `recreateLView` destroys the old view **before** detaching it —
the reverse of every normal teardown path (`ViewContainerRef.remove` etc.,
which detach first). On the wire that means the old subtree's `DESTROY` ops
arrive *before* the root `REMOVE` in the same batch, and `REMOVE` still needs
to resolve both ids. `ops-apply.ts` now frees DESTROYed ids **after the whole
batch has applied** instead of immediately. Ids are never reused within a
session (they're monotonic; a different session is dropped by the
[epoch guard](04-wire-protocol.md#replay-guard-epoch)), so the deferral is
always safe.

## The transport half: save → swap on the `web` preview

Angular CLI's official flow is **Vite-coupled** end to end: the compiler
(under its `enableHmr` option) emits, per component, an initializer that
listens on `import.meta.hot.on('angular:component-update')` and
dynamic-`import()`s `/@ng/component?c=<id>&t=<ts>` — a URL Angular's Vite
middleware serves with a freshly compiled `Cmp_UpdateMetadata` module. None
of that machinery exists (or can run) in the Background Thread: there's no
`import.meta.hot`, no dynamic URL `import()`, and our AOT builds go through
`@ngtools/webpack`, which has no `enableHmr` plumbing.

The transport that ships instead reuses **rspack's own HMR emission** with a
**custom apply path** (the emission was never the broken part — the *apply*
path was):

1. **Server side** (`plugin/src/index.ts`): `web` dev builds get rspack's
   `HotModuleReplacementPlugin` — while `dev.hmr` stays `false`, so
   rsbuild's crashing dev client is never injected. Each rebuild emits
   standard update assets, renamed
   (`[runtime].[fullhash].web.hot-update.json` /
   `[id].[fullhash].web.hot-update.js`) so they can't collide with the
   `lynx` env's same-named chunks. The update chunk contains exactly the
   changed module factories, compiled by the normal AOT pipeline.
2. **Client side** (`runtime/src/dev-reload-client.ts`): on each rebuild
   notification over the existing `/rsbuild-hmr` websocket, the client
   `fetch`es the manifest (`__webpack_require__.p + hmrF()`) and update
   chunks (`.hu(chunkId)`) directly, bypassing `module.hot.apply()`. Each
   changed module whose live exports include component classes is
   re-evaluated as a **donor** against the live `__webpack_require__` (so
   `@angular/core` resolves to the loaded instance), and matching component
   exports go through `hotSwapComponent` — live views rebuild in place,
   state preserved. The update's runtime patch is applied afterwards
   (advancing `__webpack_require__.h()`), so consecutive saves chain.
3. **Only what actually changed is swapped.** Each component's compiled
   definition is fingerprinted (template-function source + consts + vars +
   decls + styles) and swapped only when the fingerprint differs. This
   matters because a rebuilt module re-emits *every* class in the file:
   without the gate, an unchanged parent in the same file would be swapped
   too, pointlessly rebuilding its view and recreating its children — losing
   *their* state (observed empirically; the fingerprint gate is what makes
   the counter survive when its parent lives in the same file). The same
   check doubles as template-vs-logic detection: a changed component module
   none of whose fingerprints changed is a logic-only edit, which a swap
   can't apply (live instances keep their old prototypes) — it falls through
   to the notice.
4. **Fallback**: anything unswappable — logic-only edits, service modules,
   removed modules, main-thread-layer changes, any fetch/eval error — falls
   back to the honest "new build ready — reload manually" notice
   ([05 — Build integration](05-build-integration.md#dev-loop-what-the-web-preview-can-and-cant-do-automatically)).
   Angular CLI handles the same cases with a full page reload; a reload
   isn't reachable from our threads (same doc), hence the notice.

## The `lynx` (device/simulator) target — the same client, not a different one

Reading the resolved dev config for the `lynx` environment (`rspeedy inspect --mode development`) plus rspeedy's own dev
plugin shows:

- **The channel is a plain WebSocket to the same `/rsbuild-hmr` endpoint the
  web client already speaks.** rspeedy aliases the dev-transport client with
  `?…&pathname=/rsbuild-hmr&protocol=ws`, injects
  `__webpack_dev_server_client__` = its own `WebSocketClient` (literally
  `new WebSocket(url)`), and provides a real `WebSocket` global for the
  environment via a `ProvidePlugin` binding to **`@lynx-js/websocket`** (a
  native-module-backed implementation; needs Lynx >= 2.16). The CDP
  `LynxTransportClient` in `@lynx-js/webpack-dev-transport` is only the
  *fallback* for when that client isn't injected — and rspeedy always
  injects it, so CDP is the path **not** taken.
- **Everything else was already configured and going unused**:
  `HotModuleReplacementPlugin` is on for `lynx` by rsbuild default (so update
  assets are already emitted), and dev `publicPath` is already the absolute
  LAN dev-server URL, so the device fetches them from your machine exactly as
  it already does for lazy chunks.
- **The only thing missing was importing a client at all.** rspeedy sets up
  aliases and ProvidePlugins but never adds a client to an entry — it leaves
  that to the framework plugin (ReactLynx's plugin
  prepends `@lynx-js/webpack-dev-transport/client` to their Background entry).
  `pluginAngularLynx` didn't, so the built `lynx` bundle's module graph
  contained **no dev-client modules at all** (verified by inspecting it):
  the device had no hot swap, no reload, and not even a notice — silently
  nothing, exactly like `web` before this work.

So `pluginAngularLynx` now prepends **this same client** to the Background
entry of both environments, and the ProvidePlugin binding resolves the socket
for it — confirmed in the emitted bundle, which contains
`/* provided dependency */ var WebSocket = __webpack_require__('…/@lynx-js/websocket/lib/index.js').default`
alongside the client's own `new WebSocket(...)`. The apply logic
(`applyModuleUpdates`/`evaluateUpdateChunk`/`hotSwapComponent`) is shared
unchanged.

Two device-specific differences from the web path:

- **The websocket host is resolved at runtime, not baked in.** The plugin
  normalizes an all-interfaces bind address to `localhost` when baking the
  URL — right for the web preview, but on a phone `localhost` is the phone.
  `resolveSocketUrl` therefore prefers the origin the running bundle was
  actually served from (`__webpack_require__.p`, the LAN `publicPath`),
  keeping only the baked path + query. It's string-based rather than using
  `URL`, which PrimJS isn't guaranteed to provide.
- **An unswappable change reloads instead of nagging.** A full reload is
  genuinely reachable on device (unlike web, where it was investigated and
  found unreachable from any thread our code runs on): `requestDeviceReload`
  issues a `Page.reload` CDP command through
  `NativeModules.LynxDevToolSetModule.invokeCdp` — the same mechanism
  `@lynx-js/webpack-dev-transport`'s own `reloadApp` uses, probing both
  capitalizations of the module name as upstream does. So logic-only edits,
  service changes, and structural rebuilds auto-reload on device and fall
  back to the console notice only on web.

**What's measured on a device,** on Explorer 4.2 with Angular 22:

- **Saving a template edit swaps it in place on the Android emulator and the iOS
  simulator.** The text changes without a reload, the count survives, and a second
  save chains. This didn't work before: the `lynx` target's update chunks come out
  of the runtime-wrapper plugin, so evaluating their source returned no modules, and
  the client swapped nothing and reported nothing. They now go through
  `lynx.requireModuleAsync`, as lazy routes do.
- **A logic-only edit reloads the page when Explorer's DevTool switch is on.** That's
  Settings → Lynx DevTool Switches → Lynx DevTool, then restart Explorer. The desktop
  DevTool app doesn't need to be running. Measured on `ng-forms` with the app attached
  (2026-11-09), and on `device-tests` with no app running (2026-11-10): a class-body edit
  made Explorer show "Start to download & reload…", and the page came back with the new
  code. A second edit reloaded again.
- **With the switch off, nothing reloads.** `invokeCdp` is still there, but the
  `Page.reload` command is never answered. After 1.5 s with no answer the client warns on
  the console: reopen the page, or turn the switch on. With the switch on, Explorer runs
  the Background Thread on PrimJS instead of JavaScriptCore (see
  [docs/26](26-debugging.md#lynx-devtool)).
- **Explorer's own module can't stand in.** `ExplorerModule.openSchema(url)` opens a fresh
  copy, but on top of the old page, which keeps its own dev client, so every later edit
  would stack another page. Calling `navigateBack()` first closes the page before the open
  runs. `lynx.reload()` re-runs the old code, since it doesn't fetch the bundle again.

## Verification

- `npm run verify:hmr` — headless (mock PAPI, JIT, `ngDevMode: false` build):
  state survives the swap (a signal set to 5 pre-swap renders as 5 through
  the new template), the same instance object remains, old elements are
  destroyed / new ones created via ordinary wire ops, post-swap signal writes
  re-render through the replacement view, and a second swap works.
- `npm run verify:dev-reload` — headless: the websocket protocol + notice
  fallback, both hot-update chunk formats, donor evaluation against a fake
  module graph, the fingerprint gate (unchanged sibling not swapped;
  logic-only edit skipped), and added-module installation. Plus the
  device-channel pieces: `resolveSocketUrl` preferring the served LAN origin
  over the baked `localhost` (and upgrading to `wss` for an https public
  path, and leaving the baked URL alone when there's no absolute origin to
  take), `requestDeviceReload` issuing a `Page.reload` CDP command under both
  spellings of the DevTool module and reporting `false` when it isn't
  registered, and an unswappable rebuild reloading via the DevTool instead of
  printing the manual-reload notice.
- `examples/hot-swap` — live in the real dual-thread web preview (AOT,
  `ngDevMode: false`, Background Thread in a Worker), both ways:
  - **programmatic**: bump → tap "Swap to v2" → count preserved → still
    tappable → swap back;
  - **the real dev loop**: bump the counter to 3, edit `CounterCard`'s
    template in `src/app.component.ts`, save — the preview re-renders the
    new template still showing 3, no reload (page-context marker confirmed
    the page never reloaded), the counter still taps, and a second save
    chains correctly. Re-verified end-to-end after the device-channel work
    landed, since that touched the shared client.
- The `lynx` wiring itself — the client reaching that bundle at all, and
  rspeedy's `ProvidePlugin` resolving its `WebSocket` to
  `@lynx-js/websocket` — was verified by inspecting the **emitted** `lynx`
  background bundle.
