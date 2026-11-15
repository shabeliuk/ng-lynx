# Routing (`@angular/router`)

`ng-lynx/router` makes `@angular/router` work on Lynx: real route config,
`<router-outlet>`, route params, guards, resolvers, lazy loading — everything
`@angular/router` ships, running on an in-memory location instead of
`window.history`.

See the runnable [`examples/router`](../examples/router) (Home → Users →
`/users/:id`, with a `Location.back()` button), verified by
`npm run verify:router`.

## Using it

```ts
// routes.ts
import type { Routes } from '@angular/router';
import { HomeComponent } from './home.component.js';
import { UsersComponent } from './users.component.js';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'users', component: UsersComponent },
];
```

```ts
// index.ts
import { bootstrapLynxApplication } from 'ng-lynx';
import { provideLynxRouter } from 'ng-lynx/router';
import { AppComponent } from './app.component.js';
import { routes } from './routes.js';

bootstrapLynxApplication(AppComponent, {
  providers: [provideLynxRouter(routes)],
});
```

```ts
// app.component.ts
import { Component, inject, NO_ERRORS_SCHEMA } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [RouterOutlet],
  template: `
    <view (tap)="go('/users')"><text>Users</text></view>
    <router-outlet></router-outlet>
  `,
})
export class AppComponent {
  private readonly router = inject(Router);
  go(path: string): void {
    this.router.navigateByUrl(path);
  }
}
```

`provideLynxRouter(routes, options?, ...features)` takes an optional
Lynx-specific `options` object (deep links / back button — see below) between
the route config and any router features (`withComponentInputBinding()`,
`withPreloading(...)`, …); omitted, it's a drop-in replacement for
`provideRouter`.

## Navigate imperatively — there's no `<a>`/`click` on Lynx

`RouterLink` binds a `click` host listener; Lynx has no `click` event for it to
catch. Don't reach for `RouterLink` — inject `Router` and call
`navigateByUrl()` / `navigate()` from a `(tap)` handler instead (as in
`AppComponent` above and `examples/router/src/users.component.ts`). Angular doesn't
need a wrapper component for this, since calling a method from
a template event binding is already idiomatic.

Everything else is unaffected: `routerLink`-free navigation still goes through
`Router`/`Location`, so guards, resolvers, and route data all run normally.

## How it works

`provideRouter()` assumes the browser platform in exactly two places, both
**eager** — resolved as soon as `Router` is constructed, not lazily when a
particular API is called:

1. **`LocationStrategy`** (`PathLocationStrategy` by default) is built on
   `PlatformLocation`, which `providedIn: 'platform'`-defaults to
   `BrowserPlatformLocation` — a thin wrapper over `window.history` /
   `window.location`. Neither exists on Lynx's Background Thread.
2. **`TitleStrategy`** (`DefaultTitleStrategy` by default) constructor-injects
   `Title` (`@angular/platform-browser`), whose constructor constructor-injects
   `DOCUMENT` — a bare reference to the global `document`. Confirmed by reading
   `@angular/router`'s source: this is the *only* unconditional
   `@angular/platform-browser` touch in its core chunk, and the *only* other
   unguarded `DOCUMENT` read (in `createViewTransition`) sits behind the opt-in
   `withViewTransitions()` feature, never invoked by the base providers.

`provideLynxRouter()` overrides both, then delegates everything else straight
to `provideRouter()`:

```ts
export function provideLynxRouter(
  routes: Route[],
  options: LynxRouterOptions = {},
  ...features: RouterFeatures[]
) {
  return makeEnvironmentProviders([
    { provide: PlatformLocation, useFactory: () => /* seeds options.initialUrl, see below */ },
    { provide: TitleStrategy, useClass: NoopTitleStrategy },
    provideRouter(routes, ...features),
    provideEnvironmentInitializer(() => { /* wires options.backButtonEvent, see below */ }),
  ]);
}
```

**`LynxPlatformLocation`** (`runtime/src/router.ts`) is a `PlatformLocation`
backed by a plain in-memory array — a stack of `{ pathname, search, hash, state }`
entries plus an index, with `pushState`/`replaceState`/`back`/`forward`/`historyGo`
mutating it and firing the registered `popstate`/`hashchange` callbacks.
`PathLocationStrategy` (Router's default `LocationStrategy`) is built entirely
on `PlatformLocation`, so this one override is what makes the rest of the
location/navigation stack (`Location`, `Router`, `ActivatedRoute`, …) work with
no DOM at all.

Angular doesn't ship a production in-memory location (only a
testing-only `MockPlatformLocation` in `@angular/common/testing`, which
`LynxPlatformLocation` is modeled on), so this package provides one.

**`NoopTitleStrategy`** skips `updateTitle()` entirely — Lynx has no document
title to set — which avoids ever touching `Title`/`DOCUMENT`/`@angular/platform-browser`
at runtime. A route's `title` property is simply inert.

> **Angular 22 needs a working `URL`.** Its `DefaultUrlSerializer` checks every URL with
> `new URL(url, base).origin`. Lynx's Background Thread has a `URL`, but its `origin` and
> `pathname` are `undefined`, so every route serialized to `/` and the router skipped the
> navigation, with no error. `runtime/src/es-polyfills.ts` replaces it when it doesn't work.
> `verify:router` runs against an imitation of the engine's `URL`.

## Lazy routes (`loadComponent` / `loadChildren`)

Lazy routes work — with one Lynx-specific twist handled by the build plugin.

```ts
export const routes: Routes = [
  { path: '', component: HomeComponent },
  {
    path: 'lazy',
    loadComponent: () => import('./lazy.component.js').then((m) => m.LazyComponent),
  },
];
```

The plugin supports two modes, chosen by the `asyncChunks` option:

### Default: eager bundling (single self-contained file)

By default `pluginAngularLynx` forces rspack's
`module.parser.javascript.dynamicImportMode: 'eager'`: `import()` keeps its
semantics (deferred evaluation, promise of the module namespace — Angular's
route-level code separation still works), but the module is bundled into its
importer. The app ships as one `.lynx.bundle` that needs **no network at
navigation time** — the right default for offline-capable cards.

### `asyncChunks: true`: real code splitting

```ts
pluginAngularLynx({ asyncChunks: true })
```

Each dynamic `import()` now emits a real **async chunk**
(`dist/static/js/async/…`) alongside the bundle, loaded on first navigation
through Lynx's own chunk-loading runtime: rspeedy applies
`@lynx-js/chunk-loading-webpack-plugin` (`chunkLoading: 'lynx'`,
`chunkFormat: 'commonjs'`) to every environment, under which
`__webpack_require__.e(chunkId)` resolves the chunk via
**`lynx.requireModuleAsync(publicPath + chunkFile)`**. The lazy code's
download and parse cost moves off the critical startup path.

That primitive is real on both targets:

- **Device (`lynx` env)**: the engine's native async loader. The chunk file
  is wrapped by `RuntimeWrapperWebpackPlugin` (`define("<chunk file>", …)`)
  — exactly the format `requireModuleAsync` executes.
- **Web preview (`web` env)**: `@lynx-js/web-core`'s Background worker
  implements the full chain (`lynx.requireModuleAsync` →
  `nativeApp.loadScriptAsync` → fetch + evaluate with `module`/`exports` in
  scope — `createChunkLoading.js`). An earlier version of this page claimed
  web-core lacks the primitive; that error actually came from **rsbuild's dev
  client** running in a context whose `lynx` object is a different, minimal
  one — the Background Thread's `lynx` has it, verified live.

Two constraints to know about:

- **Chunks are not packed into the `.lynx.bundle`.** The template's manifest
  only takes the entrypoint's initial chunks, so async chunks are sibling
  files that must stay fetchable at `publicPath`. The dev server serves them
  automatically (dev `publicPath` is the absolute dev-server URL, so the
  device fetches from your machine, same as ReactLynx code splitting). A
  production deploy must host the `static/js/async/` files next to the bundle
  (set `output.assetPrefix` to the hosting base). If the app must work fully
  offline from one file, keep the default eager mode.
- **Every lazy `import()` MUST carry a `webpackChunkName` magic comment.**
  This inverts the advice this page gave before the Lynx 4.1 toolchain bump,
  because the upstream default flipped:

  ```ts
  loadComponent: () =>
    import(/* webpackChunkName: "lazy-route" */ './lazy.component.js')
      .then((m) => m.LazyComponent),
  ```

  Up to `@lynx-js/template-webpack-plugin@0.12`, naming a chunk was what
  *opted in* to lazy-bundle routing, and an anonymous `import()` stayed an
  ordinary async JS chunk. Since 0.13 (lynx-stack#2961, the lazy-bundle dedup
  change) an **unnamed** chunk group is named from its resolved modules
  instead, so every anonymous `import()` became a Lynx lazy bundle: the JS
  chunk is renamed into the per-bundle intermediate directory and
  `LynxEncodePlugin` force-inlines a lazy bundle's whole manifest and deletes
  the inlined assets. Measured on `examples/router`: production `dist/` gained
  `lazy-bundle/<name>.<hash>.bundle` and **lost**
  `static/js/async/<chunk>.js` entirely, while the app-service still asked for
  that path — so the route 404s at navigation time. Dev builds hide it (the
  delete is gated on `!isDev`), which makes it a production-only failure.

  `pluginAngularLynx` restores the old behavior by tapping the template
  plugin's own public `asyncChunkName` hook and returning `''` — but that hook
  only runs for chunk groups that *have* a name, hence the magic comment. An
  unnamed `import()` under `asyncChunks: true` now **fails the build** with an
  error naming the offending import, rather than silently shipping a broken
  production bundle.

  **Naming the chunk does not turn it into a lazy bundle** — it keeps it out
  of that path. The Lynx lazy-bundle mechanism is still reachable, just
  explicitly: `loadDynamicComponent(source)` (`ng-lynx`) is a
  manually-called runtime API over the same
  `lynx.QueryComponent`/`getDynamicComponentExports` primitives, for loading a
  bundle by a runtime-computed source string the app's own build graph doesn't
  know about (a cross-app-embedding use case `import()`, named or not, can't
  cover at all, since it always resolves against a build-time-known chunk
  graph). See [38 — Dynamic components](38-dynamic-component.md).

Two ng-lynx-specific fixes were needed, both for the same underlying
reason — one `rspeedy build` compiles the `lynx` and `web` environments **in
parallel into the same `dist/`**, so any output they name identically is a
race:

- **The async chunks.** Both environments emitted them at the same default
  path (in dev, with no contenthash), and on the shared dev server the `lynx`
  env's runtime-wrapped copy won the URL — the web worker then evaluated a
  wrapped chunk to an empty `module.exports` and the lazy route hung silently
  (observed live). The plugin renames the `web` env's chunks with a `.web.`
  infix (`lazy-route.<hash>.web.js`), the same fix as the `.web.hot-update`
  rename in [31 — Hot-swap](31-hot-swap.md); `__webpack_require__.u()` is
  generated from the filename template, so the runtime follows automatically.
- **The intermediate entry chunks** (`.rspeedy/<entry>/background.js` and
  `main-thread.js`) collided the same way. The shipped bundles were never
  affected — each environment's `LynxTemplatePlugin` packs the assets it holds
  in memory, not what's on disk — but anything that *reads* the intermediates
  does see it, and `verify:dynamic-component-build` started failing
  intermittently with `SyntaxError: Unexpected token 'if'` from a torn
  `background.js` once the Lynx 4.1 toolchain bump shifted the two builds'
  timings. They carry the same `.web` infix now.

### Verification

- `npm run verify:router` drives a `loadComponent` navigation headlessly
  (eager path).
- `npm run verify:lazy-chunks` production-builds `examples/router`
  (`asyncChunks: true`) and asserts the split is real: one async chunk per
  environment at distinct paths, lazy code present in the chunks and absent
  from both bundles, device chunk runtime-wrapped **and** ES2019-clean (the
  acorn gate), web chunk executable exactly the way web-core's worker
  evaluates it (yields `{ids, modules}` with function factories), and both
  app-services carrying the `requireModuleAsync` ensure-chunk handler.
- Live on the web preview: from Home, tapping "Lazy" fetches
  `static/js/async/…web.js` on demand and renders the route — the component
  code exists *only* in that chunk, so the render is proof the runtime fetch
  worked. Booting directly on `/lazy` (via `initialUrl`) exercises the same
  path during bootstrap.
- On-device network fetch (dev-server `publicPath`) follows the same
  contract ReactLynx code splitting uses but hasn't been exercised on real
  hardware from this repo — no device on hand; noted honestly here.

## Deep links & the hardware back button

A real card doesn't always start at `/` — the host often hands it an entry
URL, and Android hosts commonly forward the hardware back button. Both are
`provideLynxRouter` options:

```ts
import { lynxInitData } from 'ng-lynx';
import { provideLynxRouter } from 'ng-lynx/router';

provideLynxRouter(routes, {
  // Seed the starting route from init data instead of always '/'.
  initialUrl: () => lynxInitData<{ url?: string }>()().url,
  // Forward the host's back-button event to Location.back().
  backButtonEvent: 'onBackPressed', // whatever event name YOUR host emits
})
```

**`initialUrl`** — a literal string or a function (evaluated once, at
`PlatformLocation` construction, before Router or anything else reads the
current location — no ordering race). There's no fixed Lynx-wide convention
for which init-data key carries the entry URL, so this is deliberately a
function you write rather than a hardcoded key name — read whatever key your
host integration actually sends via [`lynxInitData()`](17-host-data.md). A
falsy return (or the option omitted) falls back to the default `/`.

**`backButtonEvent`** — the `GlobalEventEmitter` event name your host
dispatches for the hardware/gesture back button. **There's no single
Lynx-wide event name for this** — it's whatever your native host integration
is built to emit — so there's intentionally no default; pass the name your
host actually uses. When set, ng-lynx listens for it (through
[`LynxGlobalEvents`](23-app-events.md)) and calls `Location.back()`. If the
in-memory history is already at its root, `back()` is a no-op
(`LynxPlatformLocation` bounds-checks its stack index) — check
`Location.path()` afterward if you need to fall through to letting the host
close the card.

Verified by `npm run verify:router-deeplink`: a literal `initialUrl` boots
straight into that route (no navigation call), the function form correctly
reads a value seeded through `lynxInitData()`, a falsy return falls back to
the default root, and a simulated host back-button event pops the in-memory
history with `Router`'s own state agreeing afterward.

## Notes & limitations

- **Constructor DI vs `inject()`.** The example and verify harness use
  `private readonly router = inject(Router);` rather than
  `constructor(private router: Router)`. Both work under **AOT** (the
  default build); only the headless JIT verify harnesses
  (`verify/build.mjs`, esbuild + `@angular/compiler`'s JIT facade, no
  `emitDecoratorMetadata`) need `inject()` to resolve constructor parameter
  types without TypeScript's reflection metadata. `inject()` works in both
  modes, so it's the safer default to reach for either way.
- **`<router-outlet>` is a real host element**, same as any nested component
  (see [14 — Content projection](14-content-projection.md#nesting-components-creates-a-real-host-element))
  — the active route's component renders as its *sibling*, not its child,
  identical to the DOM. On Lynx it's synthesized as a plain `<view>` (not a
  real `__CreateElement('router-outlet', …)`) — confirmed on-device that the
  native engine throws for unrecognized tags, unlike the web target.
- **No scroll restoration / view transitions.** `withInMemoryScrolling()` and
  `withViewTransitions()` are browser-coupled (`ViewportScroller`,
  `document.startViewTransition`) and untested here — don't enable them.
  Everything else (`withComponentInputBinding()`, `withPreloading(...)`,
  guards, resolvers) is plain `@angular/router` logic with no DOM dependency
  and should work unchanged; lazy `loadComponent`/`loadChildren` is verified —
  see the section above.
