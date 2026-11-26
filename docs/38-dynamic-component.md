# Dynamic components (cross-app embedding)

`loadComponent()` / `loadChildren()` (with `asyncChunks: true`, see
[15 — Routing](15-routing.md#lazy-routes-loadcomponent--loadchildren)) load
code the **app's own build graph knows about** — a chunk webpack produced from
this app's own source, fetched at navigation time. `loadDynamicComponent`
solves a different problem: loading a component bundle the **native host**
points an already-running app at, by a URL/id chosen at runtime — a card built
and shipped independently of the app loading it. This is the Background-Thread
half of Lynx's "dynamic component" mechanism (ReactLynx's `loadLazyBundle` +
`<DynamicComponent>`).

## Usage

```ts
import { Component, ViewChild, ViewContainerRef } from '@angular/core';
import { loadDynamicComponent } from 'ng-lynx';

@Component({
  selector: 'app-root',
  standalone: true,
  template: `<view #anchor></view>`,
})
export class AppComponent {
  @ViewChild('anchor', { read: ViewContainerRef }) anchor!: ViewContainerRef;

  async loadCard(source: string): Promise<void> {
    // `source` is whatever URL/id convention your native host's
    // dynamic-component provider uses — not a build-time-known chunk path.
    const mod = await loadDynamicComponent<SomeCardComponent>(source);
    this.anchor.createComponent(mod.default);
  }
}
```

`loadDynamicComponent<T>(source)` resolves `{ default: T }` — mount it with
`ViewContainerRef.createComponent(mod.default)`, the same primitive Angular
already provides for any component type not known at template-compile time
(the same one `@angular/router`'s `<router-outlet>` uses internally, already
proven in this renderer by `verify:router`).

## The confirmed contract

Rather than guess at ReactLynx's public `loadLazyBundle`/`<DynamicComponent>`
surface, this was traced to `lynx-family/lynx`'s own source — the ground truth
for real on-device PAPI behavior:

- `js_libraries/lynx-core/src/lynx/lynx.ts`'s `QueryComponent` wrapper — on
  success (the bundle is already loaded, or the native layer reports it
  ready) calls back with `{ code: 0, data: { url, sync, error_message, mode },
  detail: { schema, cache, errMsg } }`; any other `code` is a failure, not a
  "still loading, retry" state.
- `js_libraries/lynx-core/src/appManager.ts`'s `loadDynamicComponent` —
  evaluates the bundle's already-fetched source via
  `tt.lynx.requireModule(APP_SERVICE_NAME, componentUrl)`, where
  `APP_SERVICE_NAME` (`'app-service.js'`,
  `js_libraries/lynx-core/src/common/constants.ts`) is the **same**
  conventional module name every Lynx bundle's own Background-Thread code
  registers itself under. So a "dynamic component" bundle is architecturally
  an ordinary Background-Thread bundle — the same shape `pluginAngularLynx`
  already produces — evaluated into the **same JS realm** as the host app via
  the engine's own module cache, not a separate isolated context.
- `js_libraries/type-element-api/types/element-api.d.ts`'s
  `DynamicComponentResult` — the versioned type source confirming the
  callback shape above (a separate, Main-Thread-only `__QueryComponent`
  global also exists, used by frameworks that render on Lepus during first
  screen — not relevant here, since Angular never runs on the Main Thread).
- Once resolved, the exports are read back via
  `lynxCoreInject.tt.getDynamicComponentExports(schema)` — populated by
  whichever of the two loading paths above actually ran.

`loadDynamicComponent` (`runtime/src/dynamic-component.ts`) wires exactly this:
`lynx.QueryComponent(source, callback)` (falling back to
`lynx.getNativeLynx().QueryComponent`, the same fallback `loadLazyBundle`
itself uses), reject on any non-zero `code`, resolve
`getDynamicComponentExports(schema)` otherwise.

## ⚠️ The real constraint — empirically tested, not just theorized

Because the loaded bundle evaluates into the **same** Background-Thread JS
realm as the host app (confirmed above — not a separate worker or isolate),
its Angular component class needs a `@angular/core` instance the host's own
change-detection and DI can actually work with. Rather than leave this as a
guess, it was tested directly: two isolated esbuild bundles (each its own
`npm install`, no shared `node_modules`), one dynamically `import()`ing the
other at runtime — a real `ViewContainerRef.createComponent()` call, not
mocked.

**Bundling a separate `@angular/core` into the loaded component fails —
even at the exact same version as the host.** Two variants, both broken:

- A producer that never re-registered its own `@angular/compiler` crashed
  inside Angular's JIT compiler (`compileComponentFromMetadata`:
  `Cannot read properties of undefined (reading 'passThroughInput')`) — its
  lazy `ɵcmp` getter resolved the **host's** globally-registered compiler
  facade (compiler-facade registration turned out to be a global, not
  scoped per module instance) and fed it metadata shaped by a different
  Angular version's decorator.
- A producer that *did* re-register its own compiler got past that, but then
  crashed with `NG0203` inside `ViewContainerRef.createComponent()`'s
  `getStandaloneInjector()` path — Angular's "current injector" DI-context
  tracking is module-instance-scoped, so the host's injector machinery
  calling into the loaded bundle's own factory functions (or vice versa)
  can't agree on an active injection context. **This reproduced identically
  with a same-version (21.2.17 host, 21.2.17 producer) duplicate bundle** —
  so this isn't a version-skew problem specifically, it's that *any*
  separately bundled `@angular/core` breaks this, byte-identical or not.
  Passing an explicit `environmentInjector`/`injector` to `createComponent()`
  didn't help either — `getStandaloneInjector` still runs for any
  `standalone: true` component regardless of what parent injector you pass.

**Treating `@angular/core` (and `@angular/compiler`) as *external*, shared
dependencies — resolving to the host's already-loaded instance instead of a
separately bundled copy — works completely.** Built the producer with
`external: ['@angular/core', '@angular/compiler']` (not `bundle: true` for
those two) instead: `createComponent()` succeeded, the loaded component's own
template rendered correctly, and a `(tap)` inside it correctly updated its
own signal and re-rendered — full interactivity, not just a static mount. The
loaded component didn't even need to import `ng-lynx` itself: its Lynx
element tags compile to `Renderer2` calls resolved via DI from the *host's*
already-running `LynxRendererFactory2`, not a static import — so the only
package that needs to be shared this way is Angular itself.

**The actionable conclusion:** a real dynamic-component bundle needs to be
built with `@angular/core` / `@angular/compiler` marked `external`, resolving
at evaluation time to the exact same instance the host already loaded — the
standard micro-frontend "shared singleton dependency" pattern, now confirmed
to apply here too. Given `js_libraries/lynx-core/src/appManager.ts`'s
`loadDynamicComponent` evaluates the bundle via the **same** `requireModule`
cache the host's own code shares (confirmed above), this is architecturally
plausible on a real engine, not just in this Node experiment — but it wasn't
tested against the real engine's actual module-cache semantics, only
simulated via Node's own module resolution. This also reframes what
"compatible version" even means here: since sharing forces exact identity,
not just compatibility, **the dynamic bundle is implicitly pinned to
whatever Angular version the host happens to have loaded** — there's no
independent "Angular major version" story once you commit to this
architecture. `pluginAngularLynx` builds this shape: see
[Producing a loadable bundle](#producing-a-loadable-bundle).

**Confirmed working live in the web preview.**
`web-core`'s `QueryComponent` really does perform a real `fetch` + binary
decode of the given `source` — confirmed by pointing the host at a bundle
that doesn't match the current environment's encoding first:
`REMOTE_SOURCE = 'remote.lynx.bundle'` (the example's default, meant for a
real device) produces a genuine, loud console error under the web preview —
`Error decoding bundle remote.lynx.bundle: Invalid Magic Header` — because
the web preview's decoder expects the **web**-encoded packaging, not the
native one. Serve each host the bundle encoded for it. Pointing the same host at `remote.web.bundle` instead (built by
the same `npm run build:producer`, just the `web` output alongside the
`lynx` one) makes the whole path succeed for real: `QueryComponent` fetches
and decodes it, `getDynamicComponentExports` returns the module,
`ViewContainerRef.createComponent(mod.default)` mounts it, and a `(tap)`
inside the loaded card updates its own signal and re-renders — live, in a
real browser, not simulated.

The one piece of plumbing: `rspeedy dev` only serves the entries it compiles
(the host's `main`), and a dynamic bundle is a separate build. So in
`examples/dynamic-component`, `npm run dev` and `npm run build` run
`npm run build:producer` first, which writes `remote.*.bundle` into
`dist-remote/`. The host's `lynx.config.ts` adds that folder to rsbuild's
`server.publicDir`, through a small plugin since rspeedy's config doesn't
expose it: the dev server serves it next to the host's own bundle, from the
same origin, and a production build copies it into `dist/`. The host picks
`remote.web.bundle` in the web preview and `remote.lynx.bundle` on a device.
Rerun `npm run build:producer` after editing the remote: the running dev
server serves the new file.

**When the bundle isn't there, no engine says so.** Before this was wired up,
`npm run dev` answered the device's request with its 28-byte 404 page, and a
real iPhone reported LynxError 160103, `bundle file is broken. The expected
size is 1936287828. Actual size is 28`: the "expected size" is the page's
first four bytes, `This`, read as a number. An empty 404 body is `template
binary is empty`, and the web preview says `Invalid Magic Header`.
`loadDynamicComponent` now starts its error with what these mean.

**On a bad network the engine does say so.** A cut connection fails with code 160101 and
`Load lazy bundle failed, the error message is: …` (iOS: "The network connection was lost";
Android: "unexpected end of stream"), and `loadDynamicComponent`'s error starts with that. The
failure isn't cached: calling it again fetches the bundle again, so a retry button is enough
(iOS simulator and Android emulator, Explorer 4.2, 2026-11-19).

## Loading with `lynx.fetchBundle`

`loadDynamicComponent` goes through `lynx.QueryComponent` by default. From engine 3.9 there is a
second mechanism, and it is the one ReactLynx's own lazy bundles use (`@lynx-js/react`'s
`core/lynx/lazy-bundle.ts`): `lynx.fetchBundle` downloads a bundle into the engine's cache, and
`lynx.loadScript(section, { bundleName })` evaluates one **named section** of it. The bundle is
packaged differently, so the two sides have to agree:

```ts
// lynx.config.producer.ts: the bundle is a set of sections
pluginAngularLynx({ dynamicComponent: true, dynamicComponentFetcher: 'fetch-bundle', engineVersion: '3.9' });
```

```ts
// the host
const mod = await loadDynamicComponent<Type<unknown>>(source, { fetcher: 'fetch-bundle' });
this.slot.createComponent(mod.default);
```

A bundle built one way doesn't load the other way. With `'fetch-bundle'` the template plugin
encodes the bundle's `background` and `main-thread` chunks (and the CSS, when there is any) as
custom sections, and `loadDynamicComponent` reads `background`, which is the module
`QueryComponent` reads as `app-service.js`. The Main-Thread section is the same inert stub as
before, so nothing is re-registered on the host's executor.

### The Promise API underneath

`fetchBundle(url, options)` is the Promise form of `lynx.fetchBundle`, for when what you want is
a bundle's other sections, such as a shared library:

```ts
import { fetchBundle, LynxBundleError } from 'ng-lynx';

try {
  const bundle = await fetchBundle(url); // fetched once; a second call is free
  const exports = bundle.loadScript<{ default: unknown }>('background');
} catch (error) {
  if (error instanceof LynxBundleError) console.warn(error.code, error.message);
}
```

- **What the engines return.** On a device, `lynx.fetchBundle` returns a handler, not a Promise:
  `then(callback)` takes one callback and returns nothing, and `wait(seconds)` blocks. The result is
  `{ url, code, error_msg }`, and `code` is `0` on success. The web preview returns a real Promise of
  `{ url, code, errorMsg }`, with `-1` for a failure and no `wait`. Neither rejects. `fetchBundle`
  turns a failure into a `LynxBundleError` with the `code`, the `bundleUrl` and the engine's words.
- **`{ sync: true }`** blocks the thread until the bundle is there (`timeout` seconds, 5 by
  default), through `wait`. Only on a device: the web preview rejects, saying so.
- **`timeout` also limits the asynchronous form (30 seconds by default, `0` for no limit).** The
  Android engine (Explorer 4.2) never calls back for a bundle the server answers with a 404: the
  request is made, and nothing else ever happens, not even after a minute. iOS answers at once with
  an error (`template binary is empty`, code `-1`). Without a limit the Promise would never settle, so
  the limit is what reports it, with code `-1`.
- **Success is remembered, failure isn't.** A URL is fetched once, and two calls at the same time
  share one request. A failed fetch is forgotten, so calling again retries.
- `bundle.adoptStyleSheet()` applies the bundle's own CSS to the page ([below](#the-bundles-own-css)).
- `hasFetchBundle()` says whether the engine has `lynx.fetchBundle`. `loadBundleScript(section,
  bundleName)` is `lynx.loadScript` with a clear error when the engine doesn't have it (3.7).
  Both `fetchBundle` and `loadBundleScript` are `@experimental`.

### What was checked

Engine 4.2 on the iOS simulator and the Android emulator, the `bundle` device flow: the card loads
and its own `(tap)` and signal stay live, a synchronous fetch reads the `background` section's
exports with `lynx.loadScript`, and a fetch of a bundle that isn't there fails with the engine's
message (iOS) or by the limit (Android). The web preview loads and runs the same card
(`examples/dynamic-component`, "Load it with fetchBundle"). Headless, `verify:fetch-bundle` covers
both engine shapes, the caching, the limits and `loadDynamicComponent`'s error messages, and
`verify:dynamic-component-build` checks the two packagings, so the sections and the old
`app-service.js` path can't be mixed up.

Not covered: `lynx.fetchBundle`'s `options` (the types declare `{}`, and ReactLynx's loader passes
`{}`, so `fetchBundle` does too), and a real phone.

### The bundle's own CSS

A component that imports CSS (`import './card.css'`) puts its rules in the bundle, not in the
`background` code. **Neither engine applies them to the host's page when it loads the bundle**, in
either packaging. Measured on Explorer 4.2: a card whose stylesheet hides one of its texts showed that
text, loaded through `fetchBundle` (iOS simulator) and through `QueryComponent` (iOS simulator and
Android emulator). The engine applies a bundle's styles to components it renders itself; here the
host's Main-Thread executor creates the elements.

ReactLynx's loader applies the rules from the Main Thread, with `__LoadStyleSheet('CSS', bundleName)`
and `__AdoptStyleSheet(sheet)`, which read a custom section named `CSS`. ng-lynx does the same, for
both packagings:

- **`fetch-bundle`** already carries the rules as a `CSS` section.
- **`query-component`** carries them in the template's style info, as it always did, and now also as
  a `CSS` section next to it (a small plugin tap on the template plugin's `beforeEncode` hook, only
  for a `dynamicComponent` build, and only when there is CSS). The bundle loads as before.
- `loadDynamicComponent` calls the adopt step before it resolves, so the component is created
  styled: `bundle.adoptStyleSheet()` for the first, and the same call under the bundle's schema for
  the second. Call `bundle.adoptStyleSheet()` yourself when you read other sections with
  `fetchBundle`. It's one `ngAdoptStyleSheet` call to the Main Thread on the same channel as the render
  ops, once per bundle.
- A bundle with no CSS has no section, which `__LoadStyleSheet` answers with `null`: nothing is adopted.
- The rules are adopted **for the page**, not scoped to the component: use class names that can't
  collide with the host's, as with any global CSS here (`enableCSSSelector`).

**The web preview differs, and only for `query-component`.** There an engine without the two calls
leaves the adopt step alone, and web-core applies a `fetchBundle` bundle's styles by itself (a
temporary rule on the example card turned its title magenta over the host's colour). It scopes a
`QueryComponent` bundle's styles to the bundle, which ng-lynx's elements are not part of, so they don't
apply: that card keeps the host's styles. That's why `examples/dynamic-component` keeps the card's base
styles in the host's CSS and adds the green edge and note in `remote-card.css`: on a device both
buttons show them, and in the web preview only "Load it with fetchBundle" does.

The device flows `bundle` and `bundle-query` each load a card with its own stylesheet that hides a
text and colours another. Each failed before the Main-Thread call (`bundle` on iOS only; `bundle-query`
on both) and passes after it, on iOS and Android. They are separate flows, on separate launches,
because an adopted stylesheet is global and would style the other card too.

## Producing a loadable bundle

The consuming half above needs something to load. `pluginAngularLynx` builds
it: `dynamicComponent: true` turns a build into a **standalone
dynamic-component bundle** instead of an app, and `dynamicComponentHost: true`
prepares the app that will load it. They're separate builds — see
`examples/dynamic-component`, which has both.

**The dynamic component's entry only exports; it never bootstraps:**

```ts
// src/remote-entry.ts
export { RemoteCardComponent, default } from './remote-card.component.js';
```

```ts
// lynx.config.producer.ts — its own build, run separately
export default defineConfig({
  source: { entry: { remote: './src/remote-entry.ts' } },
  output: { distPath: { root: 'dist-remote' } },
  environments: { lynx: {}, web: {} },
  plugins: [pluginAngularLynx({ dynamicComponent: true, tsconfig: 'tsconfig.producer.json' })],
});
```

Give each build its own tsconfig. The host never imports the remote's files,
so with one tsconfig covering `src/`, every host build warns they're "part of
the TypeScript compilation but unused". The example's `tsconfig.json` excludes
them, and `tsconfig.producer.json` includes only `remote-entry.ts`.

```ts
// lynx.config.ts — the host that loads it
plugins: [pluginAngularLynx({ dynamicComponentHost: true })],
```

`npm run build:producer` emits `remote.lynx.bundle` into `dist-remote/`; the
host fetches it by name through `loadDynamicComponent`.

### What the producer mode changes

- **Packages a lazy bundle, not a card** — it sets `LynxTemplatePlugin`'s
  `experimental_isLazyBundle`, which flips the template's `appType` to
  `'DynamicComponent'`. That's the same switch ReactLynx's own
  `experimental_isLazyBundle` sets, and it's what `LynxEncodePlugin` keys its
  lazy-bundle encoding off (read from the plugin's source). It's marked
  `@alpha` upstream.
- **Externalizes the shared framework** so the bundle carries no second copy
  of Angular — the hard requirement established above. Each shared id becomes
  a `var`-type webpack external resolving to
  `lynx[Symbol.for('__ANGULAR_LYNX_EXPORTS__(<id>)')]`, the registry the host
  publishes into.
- **Stubs out the Main-Thread part.** A dynamic component renders through its
  *host's* Main-Thread executor, so its own Lepus chunk is a deliberate no-op:
  shipping the real `entry-main.js` would re-register
  `renderPage`/`ngPatchUpdate` over the host's live ones the moment the bundle
  evaluates.
- **Skips the Background bootstrap** for the same reason —
  `entry-background.ts` installs the event pipeline, host-data channels and
  polyfills that the host already owns.
- **Adds a `CSS` section** with the component's own stylesheet, when it has one, for the host to
  adopt (see [The bundle's own CSS](#the-bundles-own-css)).
- **Exposes the entry's exports** as the bundle's module exports (a
  `commonjs` library), which is what `getDynamicComponentExports` hands back.

### The shared-module registry

Modelled directly on how `@lynx-js/react` solves the identical problem for
its own lazy bundles, rather than invented: it keeps module namespaces on a
well-known global under
`Symbol.for('__REACT_LYNX_EXPORTS__(<id>)')`, reached via
`target = __LEPUS__ ? globalThis : lynx` — i.e. on the Background Thread the
registry lives on the **`lynx` object** (BG and MT don't share a `globalThis`
on a real engine). Its `lazy` package-export condition then swaps every
runtime import for a shim reading out of that registry. ng-lynx uses the
same shape, one namespace per module id, via
[`runtime/src/shared-runtime.ts`](../packages/ng-lynx/runtime/src/shared-runtime.ts).

**`sharedModules` defaults to the minimal identity-critical set** —
`@angular/core`, `ng-lynx`, `ng-lynx/elements` — all of which any
ng-lynx app already contains, so publishing them costs a host nothing.
Matching is on the **exact request string**, so subpaths need their own
entries (`ng-lynx` does *not* cover `ng-lynx/elements` — found by
building a real component and seeing the elements package bundled into it).

Larger packages (`@angular/common`, `@angular/forms`, `@angular/router`,
`ng-lynx/forms`, …) are deliberately **not** shared by default: a host
must import a shared module's whole namespace, which defeats tree-shaking and
would pull e.g. the router into hosts that never use it. Add what your
components need to `sharedModules` on **both** sides. A module the producer
externalizes but the host never published throws an error naming it at first
use, rather than failing obscurely.

### Verifying

`npm run verify:dynamic-component-build` runs the **real** `rspeedy build` for
both configs and asserts on the actual artifacts: that the plugin's and
runtime's copies of the sharing convention still agree (they can't import
each other across the build boundary, so drift would silently produce a
bundle resolving `undefined` for Angular); that the produced chunk reads the
shared ids through the registry and contains **none** of Angular's own
implementation (`R3Injector`, `createInjector`, `ApplicationRef` all absent)
while still containing the component's own template; that the Main-Thread
part registers no `renderPage`/`ngPatchUpdate`; that the host publishes
exactly what the producer externalizes; and that the packaged bundle is
~60 kB rather than the several hundred kB an app carrying its own Angular
weighs.

Then it **loads the artifact for real**: `harness-dynamic-component-load.ts`
evaluates the built, runtime-wrapped chunk exactly as the engine does (calling
the `tt.define` factory with `(require, module, exports, …injected globals)`,
`lynx` among them), mounts the resulting component into a live host app with
`ViewContainerRef.createComponent`, and taps it — asserting its own signal
updates and re-renders through the *host's* change detection. That is the
end-to-end proof that the mode produces something genuinely loadable, not
merely something that compiles.

**On a device:** measured on the iOS simulator (Explorer on engine 3.7), the host
fetched `remote.lynx.bundle` through the native `QueryComponent`, mounted the
component, and tapping its button updated its own signal through the host's shared
`@angular/core`. Android and engine 4.x haven't been run.

## Verifying

`npm run verify:dynamic-component`: `registerDynamicComponent(schema,
exports)` (`ng-lynx/testing`) simulates the native host having already
fetched and cached a bundle, mirroring `loadedDynamicComponentsSet`'s
already-loaded fast path; `lynx.QueryComponent` and
`lynxCoreInject.tt.getDynamicComponentExports` are mocked to the confirmed
shapes above. Asserts: a source nothing registered rejects the promise (not a
silent hang); a registered source resolves, `ViewContainerRef.createComponent`
mounts it into the live tree, and its own content renders and updates
normally like any other component.
