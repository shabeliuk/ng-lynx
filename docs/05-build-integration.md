# Build integration

`pluginAngularLynx` builds an Angular app into a Lynx dual-thread bundle with
rspeedy/rspack. **It works today** — the hello-world example builds and runs as a
real Angular app on the **iOS simulator** (via Lynx Explorer) and the **web
preview**. Validated against `@lynx-js/rspeedy@0.18`, `rspack@2.2`, Angular 21.2
— the toolchain that pairs with **Lynx engine 4.2**. Bundles still declare
engine version 3.2 (`engineVersion`, formerly `targetSdkVersion`; the template
plugin's default, which ng-lynx does not override), so they load on any
engine from 3.2 up, 4.1 and 4.2 included; see
[40 — Lynx 4.2 upgrade](40-lynx-4-2.md) and [39 — Lynx 4.1 upgrade](39-lynx-4-1.md).

Two compilation modes, **both validated on-device**:

- **AOT** (default): `ngtsc` precompiles templates at build time via
  `@ngtools/webpack` — no compiler shipped, ~56% smaller bundle (hello-world:
  ~395 kB vs ~888 kB), and initializer APIs (`viewChild()`, `input()`, …) work.
  See [AOT](#aot-ngtsc-under-rspack) below.
- **JIT** (`pluginAngularLynx({ aot: false })`): `@angular/compiler` is bundled
  into the Background Thread and compiles templates at runtime. Simplest setup,
  but larger and no initializer APIs.

## Run it

```bash
# from the workspace root (pnpm workspace)
pnpm install
pnpm --filter ng-lynx build          # build the package to dist/
cd examples/hello-world
pnpm rspeedy dev                          # serves lynx + web bundles + web preview
```

The dev server prints three URLs:

- **Web preview** — open `http://localhost:3000/__web_preview?casename=main.web.bundle`
  in a browser.
- **Lynx bundle** — `http://localhost:3000/main.lynx.bundle?fullscreen=true`, for
  a device. On the **iOS simulator** there's no camera, so open Lynx Explorer →
  "Enter Card URL" and paste that URL (the simulator shares the Mac's
  `localhost`). On a physical device, scan the QR code.
- `pnpm rspeedy build` writes `dist/main.lynx.bundle` + `dist/main.web.bundle`.

> The web preview's console shows a banner, a sandbox-iframe warning and a few
> other lines from `@lynx-js/web-core` itself; they aren't from your app.

## What the plugin does

`pluginAngularLynx()` returns an rspeedy/rsbuild plugin that:

- Configures **only the environments your config declares**. With the usual
  `environments: { lynx: {}, web: {} }` (or none), both are set up. A
  Lynx-only config (`{ lynx: {} }`, e.g. a native app built through
  Sparkling) builds just the Lynx bundle. Before, the plugin's own `web`
  settings *created* a `web` environment and shipped a web bundle inside the
  app.

- Sets `define`s: `__DEV__` (from `NODE_ENV`), **`ngDevMode: false`**,
  `ngServerMode: false`, `ngJitMode` (`false` under AOT). (`ngDevMode` **must** be
  a literal — see gotchas.)
- **Forces ES2019 downleveling** via `tools.swc.env.include` (rspeedy forbids
  `jsc.target`), and compiles `node_modules` JS too. Under `aot: false` it also
  configures SWC for Angular's legacy decorators.
- For each entry, creates two bundles using webpack **layers**
  ([`layers.ts`](../packages/ng-lynx/plugin/src/layers.ts)):
  - **Background** (`angular:background`): `ng-lynx/entry-background`
    (PrimJS polyfills + event bootstrap), plus `@angular/compiler` under JIT,
    prepended to your app code (Angular + `LynxRenderer2`).
  - **Main thread** (`angular:main-thread`): `ng-lynx/main-thread` (the
    PAPI executor) + ng-lynx's worklet runtime (`ng-lynx/worklet-runtime`:
    `[lynxMainThread]` and gesture callbacks never run without it, see
    [42 — The worklet runtime](42-worklet-runtime.md)) + any `mainThreadModules`
    (worklet registrations), **in that order**. The executor's top-level code
    sets `globalThis.SystemInfo` and assigns `renderPage`/`processData`, and the
    worklet modules call `registerWorklet`, which needs the runtime in place.
    The runtime (about 4 kB minified) is only bundled when `mainThreadModules`
    is non-empty or the app has [inline `'main thread'` functions](11-worklets.md#inline-main-thread-functions),
    whose registrations come last, so an app with no worklets doesn't pay for them.
- Marks the main-thread asset `lynx:main-thread: true` and forces its startup so
  the MT bundle actually executes (`AngularMarkMainThreadPlugin`).
- Packs both with `@lynx-js/template-webpack-plugin`, wraps the background bundle
  with `RuntimeWrapperWebpackPlugin`, and encodes for `lynx` / `web`.
- Controls dynamic `import()` via the `asyncChunks` option: eager-bundled by
  default (single self-contained bundle), or real async chunks loaded through
  `lynx.requireModuleAsync` when enabled — with the `web` env's chunks renamed
  (`.web.` infix) so the two environments' same-named chunk emissions can't
  collide on the shared dev server. Full story in
  [15 — Routing](15-routing.md#lazy-routes-loadcomponent--loadchildren).
- Disables the dev-client error overlay for the `lynx` environment only
  (`environments.lynx.dev.client.overlay: false`) — it's a DOM-rendered `<div>`
  with nothing to render into on the Background Thread (no `document`); the
  `web` preview keeps it, since that one's a real browser tab.
- Disables HMR **and** live-reload for the `web` environment only
  (`environments.web.dev.hmr: false, liveReload: false`) — both crash on every
  change. HMR: `TypeError: lynx.requireModuleAsync is not a function` — note
  this is a fact about **where rsbuild's client code runs**, not about the
  primitive: the Background worker's `lynx` implements `requireModuleAsync`
  just fine (it's what powers real code splitting, `asyncChunks` —
  [15 — Routing](15-routing.md#lazy-routes-loadcomponent--loadchildren));
  the injected client hit a context whose `lynx` object is a different,
  minimal one. Live-reload (the fallback once HMR is
  off): `web-core` runs the Background-Thread bundle in an actual Web Worker
  (mirroring the real dual-thread engine even in the browser), and rsbuild's
  live-reload client — injected into *that* bundle too, since it also needs
  hot-update notifications — calls a bare `location.reload()`; inside the
  worker that's `TypeError: Cannot read properties of undefined (reading
  'reload')`. Both keys are in rsbuild's `AllowedEnvironmentDevKeys`, so this
  is scoped to `web` only — the `lynx` environment's `dev.hmr` stays at its
  default (`true`), which is what keeps `HotModuleReplacementPlugin` emitting
  the update assets its own dev client consumes.
- In place of rsbuild's disabled client, prepends a small custom one
  (`runtime/src/dev-reload-client.ts`) to the Background bundle of **both**
  environments, dev builds only — see [Dev-loop: what the `web` preview can
  and can't do
  automatically](#dev-loop-what-the-web-preview-can-and-cant-do-automatically)
  below for what it actually does and why, and
  [31 — Hot-swap](31-hot-swap.md) for the `lynx` half.

The dual-thread packaging reuses Lynx's own webpack plugins verbatim, because the
packaging is framework-agnostic. Only the *compiler* is Angular's.

## Dev-loop: what the `web` preview can and can't do automatically

Saving a file always rebuilds both bundles server-side — confirmed repeatedly,
build times are ~0.3–0.4s. The gap is entirely on the client side: does the
already-open web preview *pick up* that new build without a manual refresh?

A real automatic reload was investigated in depth and found to be unreachable
from *any* thread our code runs on (measured on `@lynx-js/web-core` 0.21; worth
re-checking on newer versions):

- **`lynx.reload()`** — the engine's own documented Background-Thread
  primitive (traced through `web-core`'s compiled output: it RPCs to the Main
  Thread, which calls `parentDom.reload()`) — is a confirmed **no-op** for
  picking up new code. Calling it directly on the `<lynx-view>` element, even
  from the real page, produced no re-render and no new asset fetch.
- The **Main-Thread bundle isn't a real page context** either, so
  `location.reload()` isn't an option there: `web-core` executes it somewhere
  with no `window` at all, and a `location` that reports `about:srcdoc` with
  an empty host/port (confirmed by logging `location.href` from inside it —
  constructing a `WebSocket` from that empty host/port throws
  `SyntaxError: ... The URL '...' is invalid`).
- The **Background bundle** *does* have a real `WebSocket` (it's a genuine Web
  Worker) and can open a websocket to the dev server's `/rsbuild-hmr`
  endpoint fine — confirmed by driving the exact same URL/token from the real
  page context, where it correctly received `hash`/`warnings` messages. But
  there's nothing reachable from a Worker that reloads the outer browser tab.

So `applyEntry` prepends `runtime/src/dev-reload-client.ts` to `web`'s
Background bundle (dev builds only) — it speaks the same `/rsbuild-hmr`
protocol rsbuild's own client does (message shapes and the `lastHash !==
__webpack_hash__` guard, taken from `@rsbuild/core`'s own client source,
scoped to `web`'s own messages via its per-environment `webSocketToken`), but
instead of reloading, it prints a clear, actionable console warning —
*"A new build is ready — reload the web preview to see it"* — visible in
Chrome DevTools even from a Worker context. That's strictly better than
today's silence (a stale preview with no signal anything changed), and
honest about not being able to do more right now. Verified headlessly (the
message-handling logic, not the real websocket) by `npm run verify:dev-reload`.

For the **`lynx` (device/simulator) target**, an earlier version of this
section claimed the investigation above "doesn't apply" because that target
already had a working dev client of its own (Lynx's CDP-based
`LynxTransportClient`), and so was "likely never the roughest edge."
**Both halves of that were wrong**, and the correction is in
[31 — Hot-swap](31-hot-swap.md#the-lynx-devicesimulator-target--the-same-client-not-a-different-one):
that environment's client is a plain WebSocket to the *same* `/rsbuild-hmr`
endpoint (CDP is only an uninjected fallback), and it wasn't degrading
gracefully — it wasn't there at all, because rspeedy leaves the client
*import* to the framework plugin and `pluginAngularLynx` never added one.
The same custom client now serves both targets; on `lynx` an unswappable
change additionally triggers a real `Page.reload` through
`NativeModules.LynxDevToolSetModule.invokeCdp` (reachable there, unlike on
`web`) instead of the manual-reload notice.

True state-preserving hot-swap (Angular components re-rendering in place with
existing signal state intact) turned out to be fully buildable — the "Angular
has no built-in HMR runtime" assumption this section originally made was
wrong. Since Angular 19, `@angular/core` ships `ɵɵreplaceMetadata` (the
primitive Angular CLI's own dev-server HMR uses), it's renderer-agnostic, and
it works on Lynx. The `web` dev loop now does **full save-to-swap HMR**: the
plugin enables rspack's hot-update *emission* (rsbuild's broken client stays
uninjected), and this same dev client fetches each rebuild's update chunks
over HTTP, re-evaluates the changed component modules against the live module
graph, and hot-swaps exactly the components whose compiled templates changed
— live views rebuild in place with state intact. Logic-only edits and
anything else unswappable still get the console notice above. See
[31 — Hot-swap](31-hot-swap.md) for the full design, semantics, and
verification.

## PrimJS gotchas (the things that made it actually run)

Lynx's Background-Thread engine (PrimJS) lacks some Web globals and some newer
language built-ins. Getting Angular to load and run surfaced these, all handled
by the plugin/runtime now — keep them in mind if you change the build:

> **`URL` and `URLSearchParams` are replaced when they don't work.** Lynx's Background
> Thread has a `URL` whose `origin` and `pathname` are `undefined`, which silently broke
> Angular 22's router ([15 — Routing](15-routing.md)). So `es-polyfills.ts` tests what's
> there instead of checking that it exists.

> **Newer built-ins are polyfilled, from a measured list.** The build
> transpiles *syntax* down to ES2019; missing *methods* only fail at runtime,
> on a device (`Array.prototype.at` crashed examples/genui with
> `… .at is not a function`, while the web preview's browser had it).
> `runtime/src/es-polyfills.ts` installs what PrimJS 3.8 lacks, read from its
> own source (`quickjs.cc` has no function definition for them):
> `at` (arrays, strings, typed arrays), `findLast`/`findLastIndex`,
> `toReversed`/`toSorted`/`toSpliced`/`with`, `String.prototype.replaceAll`,
> `Object.groupBy`/`Map.groupBy` and `Promise.withResolvers`. Everything up to
> ES2020 is native (`flat`, `matchAll`, `Promise.allSettled`/`any`, …).
> Confirmed on a PrimJS engine (the genui Sparkling app, Lynx 3.9): each one
> was missing natively and works with the polyfill, while `flat` stayed
> native. Each install is guarded, so engines that have the method (iOS
> Explorer's JavaScriptCore, the browser) keep theirs. Not covered:
> `Array.fromAsync`, `isWellFormed`/`toWellFormed`, the ES2023 copying methods
> on typed arrays, and Main-Thread code. `verify:polyfills` checks each one
> against the spec with Node's own copy removed.

1. **`ngDevMode` must be a literal, not an expression.** Angular assigns
   properties to it (`ngDevMode.x = …`); defining it as
   `process.env.NODE_ENV !== 'production'` yields `(a !== b) = …` → a load-time
   `SyntaxError: Left hand side of operator '=' must be a reference`. Use
   `ngDevMode: false`.
2. **The package ships partial Ivy + is linked at app-build.** `runtime` is
   compiled with `ngc` in **partial** mode (`runtime/tsconfig.ngc.json` →
   `ɵɵngDeclare*`), and the plugin runs the **Angular linker** to finalize it to
   full Ivy (`ɵfac`/`ɵprov`/`ɵdir`) against the app's Angular version — so the
   package isn't pinned to one release. Plain `tsc` would emit only decorators →
   JIT errors on "Standard Angular field decorators…", and AOT errors on "JIT
   compiler unavailable". (See the linker section.)
3. **Polyfill `performance`, `queueMicrotask`, and `Object.hasOwn`.** PrimJS has
   none of these. `performance`/`queueMicrotask`: Angular's
   `provideZonelessChangeDetection` calls `performance.mark`, and the flush
   scheduler batches via `queueMicrotask`. `Object.hasOwn` (ES2022) is the
   surprising one: it's not *our* code that calls it — `@angular/forms`'s own
   compiled output calls it from `ɵɵInheritDefinitionFeature` while *defining*
   one of its built-in directives, at module-load time, before any template
   runs. Confirmed on device via `TypeError: Object.hasOwn is not a function`
   thrown from inside `forms.mjs`, crashing `loadCard` before the app ever
   rendered — the acorn gate below didn't catch it because it's a missing
   *runtime API*, not invalid syntax (`Object.hasOwn(...)` parses fine at any
   ES target). All three installed at the top of `entry-background.ts`,
   verified by `npm run verify:polyfills` (which deletes each global first,
   simulating PrimJS, since Node already has all three natively).
4. **Downlevel to ES2019** via `tools.swc.env.include` (logical-assignment,
   optional-chaining, nullish-coalescing, class-properties) — not `jsc.target`.
5. **Verify locally** with the acorn ES2019 parse gate
   ([07 — Verifying](07-verifying.md)) — it catches PrimJS-incompatible syntax in
   the built bundles without a device, but **not** a missing runtime API like
   `Object.hasOwn` above — that needs either a real device or a targeted test
   like `verify:polyfills`.

## Other Angular specifics

- **Import `LYNX_ELEMENTS`** on components using Lynx tags
  ([18 — Typed templates](18-typed-templates.md)). `NO_ERRORS_SCHEMA` also works,
  and turns template checking off.
- **Standalone + zoneless only.** No `BrowserModule` / `@angular/platform-browser`.
- **Use decorator-based queries/inputs** (`@ViewChild`, `@Input`) under JIT — the
  initializer APIs (`viewChild()`, `input()`) need AOT. See
  [10 — Element queries](10-element-queries.md).
- **Bootstrap provider set** (root injector scope, `ErrorHandler`, `APP_ID`,
  internal application error handler) is baked into `provideLynx()` — full audit
  in [07 — Verifying](07-verifying.md#bootstrap-provider-audit-results).
- **No SSR / hydration** on Lynx.

## ReactLynx options ng-lynx doesn't take

`pluginAngularLynx` takes the same options as `pluginReactLynx` wherever the option
reaches Lynx itself (`enableCSSSelector`, `engineVersion`, `enableNewGesture`, …).
Three ReactLynx options configure ReactLynx's own compiler or runtime instead, and
have nothing to act on in an Angular app:

- **`globalPropsMode`.** In ReactLynx's default `'reactive'` mode, a host's
  `updateGlobalProps` re-renders the whole tree; `'event'` mode updates only the
  components that read global props. ng-lynx always works the second way:
  `lynxGlobalProps()` is a signal, replaced copy-on-write on every update, so only
  the components that read it are checked, and `onGlobalPropsChanged` is emitted
  either way. See [17 — Host data](17-host-data.md#reading-global-props).
- **`extractStr`.** ReactLynx compiles the same component code into both threads,
  so the same string literals ship twice; `extractStr` moves them into one array
  that the Main Thread receives through init data. In ng-lynx your components run
  on the Background Thread only. The Main Thread bundle is ng-lynx's executor plus
  your worklet modules, so there are no duplicated app strings to merge.
- **`enableUiSourceMap`.** It's produced by ReactLynx's Main Thread JSX transform,
  which maps each element to the JSX that created it, for Lynx DevTool. ng-lynx has
  its own option for the same result, `templateSourceMap`, on by default in a
  development build: see [26 — Debugging](26-debugging.md#from-an-element-to-its-template).

Passing one of these to `pluginAngularLynx` is a type error.

## AOT (ngtsc under rspack)

AOT precompiles templates at build time and ships **no** `@angular/compiler` —
~56% smaller bundles and faster startup. It's the **default**, so there's
nothing to switch on:

```ts
// lynx.config.ts
pluginAngularLynx()                 // AOT (default)
pluginAngularLynx({ aot: false })  // opt out → JIT
pluginAngularLynx({ tsconfig: 'tsconfig.app.json' })  // custom tsconfig for ngtsc
```

Requires `@ngtools/webpack` + `@angular/compiler-cli` (matching your Angular
version) installed in the app, and a `tsconfig.json` with `angularCompilerOptions`.

What the plugin wires up for AOT (`applyAngularCompiler`):

- Registers `@ngtools/webpack`'s `AngularWebpackPlugin({ tsconfig, jitMode: false })`
  and its loader on `.ts` as a **pre-loader**, so rspeedy's SWC still downlevels
  the ngtsc output to ES2019.
- Sets `ngJitMode: false` and drops the `@angular/compiler` prepend from the
  Background bundle.

### What makes AOT work under rspack/Lynx

**An rspack resolver shim.** `AngularWebpackPlugin` registers
`compiler.resolverFactory.hooks.resolveOptions` (a webpack HookMap rspack doesn't
expose) to add tsconfig-`paths` resolution, which rspack does natively. A tiny
`RspackResolverCompatPlugin` stubs that hook so the plugin's `apply()` doesn't
crash. It's the only rspack-compat shim needed.

`CUSTOM_ELEMENTS_SCHEMA` doesn't help with Lynx's tags: ngtsc only treats *dashed*
tags as custom elements, so it won't whitelist `view`/`text`/`image`.

### The package is a partial-Ivy library, linked at app-build

For AOT to use the renderer's `@Injectable`/`@Directive` classes without a JIT
compiler, the **package itself** is compiled with `ngc` in **partial** mode
(`runtime/tsconfig.ngc.json` → `ɵɵngDeclare*`), wired into the package `build`
script. Shipping partial keeps the package **version-independent**: at app-build
the plugin runs the **Angular linker** (`@angular/compiler-cli/linker/babel` as
an `enforce: 'pre'` `babel-loader`) to finalize the partial declarations to full
`ɵfac`/`ɵprov`/`ɵdir` against the app's own Angular version. The same pass links
the partial declarations `@angular/*` ships in its fesm bundles. (Plain `tsc`
would emit only decorators → "JIT compiler unavailable" under AOT.)

The linker needs `@babel/core` + `babel-loader` (shipped as package deps) and the
app's `@angular/compiler-cli` (a peer dep). It matches partial declarations by
**callee name** (`x.ɵɵngDeclareComponent`), so it's robust to SWC renaming the
`@angular/core` import. If `@babel/core`/`babel-loader` aren't resolvable the
loader silently no-ops and `ɵɵngDeclare` survives into the bundle (→ "JIT
compiler unavailable" at runtime) — that was the one gotcha.

> Initializer APIs (`viewChild()`, `input()`, `model()`) work under **AOT** but
> not JIT — see [10 — Element queries](10-element-queries.md).

### How inline `'main thread'` functions get through AOT

ReactLynx lets you write a worklet *inline*, marked with a `'main thread'`
directive as the first statement of a closure: a build-time SWC transform extracts
the closure (capturing the outer variables it reads into a `_c` object), moves it
into the Main-Thread bundle, and leaves a small descriptor in the Background bundle.
ng-lynx does the same ([11 — Worklets](11-worklets.md#inline-main-thread-functions)),
which takes two things under AOT:

1. **Getting the rewritten source to ngtsc.** `AngularWebpackPlugin` doesn't read
   component sources through rspack's loaders: whatever an `enforce: 'pre'` loader
   returns for a file is discarded for AOT's own read. But that read goes through a
   TypeScript system `@ngtools/webpack` builds on `compiler.inputFileSystem`
   (`createWebpackSystem`, in its `thisCompilation` hook). `pluginAngularLynx`
   registers a plugin just before it that wraps `readFileSync` there: a `.ts` file
   with the directive comes back with each function rewritten as
   `ɵinlineMainThread(id, () => ({ …captured }), <the function>)`. ngtsc compiles and
   type-checks that, lines unchanged. In a JIT build the same rewrite is a loader.
2. **Putting the function in the other bundle.** Each file with the directive has a
   Main-Thread half, `file.ts?ng-lynx-main-thread`, which a loader writes from the same
   source: the functions, unchanged and on their own lines, registered by id, and the
   imports they use. One generated index module imports every half, and goes into the
   Main-Thread entry after the worklet runtime. Both halves come from one analysis of
   the file (`plugin/src/inline-main-thread.cts`, with a TypeScript checker for that
   file alone, to tell where each name is declared), so they agree on the ids:
   `__ngInline:<file>:<line>:<column>`. The ngtools loader skips the `?ng-lynx-main-thread`
   modules.

Up to 1.0 this page said inline worklets weren't possible under AOT. The first point
is why: it was found by testing the loader route, which doesn't work. The input file
system was there the whole time.

Next: [07 — Verifying](07-verifying.md).
