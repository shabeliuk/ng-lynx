# Changelog

Both packages, `ng-lynx` and `create-ng-lynx`, share one version and one changelog.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/). What a release promises, and
which parts are experimental and may change in a minor release, is in
[docs/43-stability.md](docs/43-stability.md).

## [Unreleased]

## [1.1.0] - 2026-11-27

Everything since 1.0.1, including the HttpClient fix prepared as 1.0.2, which was never
published on its own. That fix was found by MyAssets, a real app built from the published
packages, querying HM Land Registry's SPARQL endpoint from Lynx Explorer 4.2.

### Added

- **A2UI v1.0 in `ng-lynx/genui` (experimental).** `[messageHandler]` on `<a2ui-surface>` is the
  transport for everything the renderer sends the agent (upstream's `onMessage`): actions, protocol
  errors, `callAgentFunction` for functions a catalog declares without an implementation, and
  `rendererFunctionResponse`, with the data model of `sendDataModel` surfaces. `@checks` with
  ValidationResult messages (`ctx.checks()`, and TextField shows the first failure);
  `@accessibility` as Lynx accessibility attributes through the `a2uiA11y` directive;
  catalog-schema coercion of resolved props; `serializeA2uiCatalog` for the agent handshake;
  `[messageStore]="null"`, and swapping stores for a fresh session. Checked on Lynx Explorer 4.2
  on the iOS simulator (the `genui` example's A2UI tab). docs/28, harness `verify:genui-a2ui`.
- **`lynxEnter` / `lynxLeave` (experimental).** Enter and leave animations from CSS classes, what
  Angular's `animate.enter` / `animate.leave` do on the web (they compile, but do nothing on Lynx:
  Angular turns them on only with a DOM). `lynxEnter` puts classes on a new element and takes them
  off at its own `animationend` or `transitionend`; `lynxLeave` puts classes on a removed element
  and keeps it on screen until its animation ends, then removes and destroys it. Each has a timeout,
  2 s by default. `examples/hello-world`'s list animates its items in and out. docs/33, harness
  `verify:transition`, and the `transition` device flow.
- **Element-to-template source mapping.** In a development build (`templateSourceMap`, on by
  default outside production, AOT only), each element carries the place in its template that
  created it. Angular's compiler records it (the flag the Angular CLI's dev server sets), the
  element gets it as `data-ng-source-location`, which Lynx DevTool's Elements panel and the web
  preview's browser DevTools show, and it is created with a `nodeIndex` the engine keeps for
  DevTool. Each index's file, line and column go into the `uiSourceMap` of `debug-metadata.json`,
  the format ReactLynx's `enableUiSourceMap` produces. Checked on Explorer 4.2 on the iOS
  simulator: a tap's `event.target.nodeIndex` came back as the index `debug-metadata.json` maps to
  the tapped element's line. docs/26, harnesses `verify:template-source-map` and
  `verify:template-source-map-off`.
- **`lynx.fetchBundle` (experimental).** `fetchBundle(url, { sync?, timeout? })` is the Promise
  form of the engine's loader (engine 3.9, the one ReactLynx's own lazy bundles use): it resolves
  once the bundle is in the engine's cache, caches a success and not a failure, and rejects with a
  `LynxBundleError` carrying the engine's `code` and message. `loadBundleScript` and
  `hasFetchBundle` go with it. `loadDynamicComponent(source, { fetcher: 'fetch-bundle' })` loads a
  component packaged with the new plugin option `dynamicComponentFetcher: 'fetch-bundle'`, which
  encodes the bundle as named sections. The default, `'query-component'`, is unchanged. Neither engine applies a
  dynamic bundle's own CSS to the host's page (measured on Explorer 4.2, both packagings), so
  `loadDynamicComponent` adopts the bundle's `CSS` section from the Main Thread before the component is
  created, as ReactLynx's loader does (`bundle.adoptStyleSheet()`); the `query-component` packaging now carries
  that section too, next to its style info. The async
  form has a `timeout` (30 s by default): Explorer 4.2 on Android never calls back for a 404.
  docs/38, a "Load it with fetchBundle" button in `examples/dynamic-component`, harness
  `verify:fetch-bundle`, the packaging checks in `verify:dynamic-component-build`, and the `bundle` and
  `bundle-query` device flows on the iOS simulator and the Android emulator.
- **Inline `'main thread'` functions (experimental).** Write a worklet or a main-thread
  function in the component, with `'main thread'` as the first statement of its body,
  and `pluginAngularLynx` moves the body to the Main-Thread bundle: no Main-Thread
  module, `defineWorklet` or `bindWorklet`. Bind it with `[lynxMainThread]` or
  `[lynxGesture]`, call it with `runOnMainThread`, or pass it to another one. Imports
  it uses are imported again on the Main Thread; other names from the file, and
  `this.name`, are captured when it's bound or called, and cross like `bindWorklet`
  params. The build rejects what can't work (assigning to `this.x`, a plain helper
  function, an import from `ng-lynx` or `@angular/*`), pointing at the line. Under AOT
  the plugin wraps the input file system ngtsc reads through, which docs/05 used to
  say made this impossible. On by default; `inlineMainThread: false` turns it off.
  docs/11, a demo in `examples/worklet`, harnesses `verify:inline-main-thread`,
  `-transform` and `-build`, and the `main-thread` device flow.
- **`LynxLazyFor` (experimental): a `<list>` that builds only the rows it asks for.** Put
  `*lynxLazyFor="let row of rows(); trackBy: trackById; estimatedSize: 48"` on the
  `<list-item>`. The list is told every row's `item-key` and estimated size, so it scrolls
  its whole length, and the Main Thread tells the Background Thread which rows the list
  holds, so only those and a buffer are built. Unlike `LynxVirtualFor` there's no
  `(scroll)` wiring and no edge for a fling to stop at. A row the list asks for before it's
  built shows as an empty cell until it arrives; an `updateAction` then makes the list ask
  for it again. The web preview's list isn't virtualized, so there every row is built.
  docs/30, harness `verify:lazy-list`, device flow `lazy-list`.

### Changed

- **GenUI speaks A2UI v1.0 (breaking for A2UI streams; GenUI is experimental).** `ng-lynx/genui`
  needs `@lynx-js/genui` 0.8.1 or later, below 0.9 (was 0.7), whose store accepts only A2UI v1.0,
  the version the spec marks current. Agents must send `version: '1.0'` on every message,
  `{ '@path' }` bindings, `{ '@call' }` function calls, `@checks` / `@catalogId` / `@metadata` /
  `@accessibility`, and a `catalogId` in `createSurface`; older messages are rejected with
  `UNSUPPORTED_VERSION`. The renderer sends `{ version: '1.0', action }` instead of `userAction`;
  `(action)` emits the same `UserActionPayload` as before. `<a2ui-surface>` registers its catalog
  under `[catalogId]` (default `A2UI_DEFAULT_CATALOG_ID`), and a surface renders only from the
  catalog it names. Custom components read `ctx.checks()` for `@checks`, and `ctx.sendAction()`
  returns a promise. `ResolvedProps.touchedPaths` is gone. Migration table in docs/28.
- **GenUI props re-resolve on every signal they read.** Props and `@checks` resolve inside a
  signals effect on the store's own runtime (`trackA2uiSignals`), as upstream's `effect()` does, so
  a value read inside a function implementation, or an agent function's answer, re-renders the
  component. Before, only the bindings the props named directly did.
- `mainThreadRef()` returns a `MainThreadRef<T>`, so `current` is typed inside a
  `'main thread'` function. Reading it on the Background Thread throws, rather than
  being `undefined`. It's still a `MainThreadRefHandle<T>`, so existing code compiles.
- `runOnMainThread` and `ToMainThread` accept a `'main thread'` function wherever they
  took a `defineMainThreadFunction` handle.
- **`@lynx-js/rspeedy` 0.19 is supported.** The peer range is `>=0.18.0 <0.20.0`, so 0.18 keeps
  working. The workspace builds with 0.19 (Rsbuild 2.3.3), and new apps from `create-ng-lynx` get
  rspeedy `^0.19.0` with `@lynx-js/qrcode-rsbuild-plugin` `^0.7.4`, the first one that accepts 0.19.
- Both packages are at 1.1.0, and the templates require `ng-lynx@^1.1.0`.

### Fixed

- **`HttpClient` sent `Content-Type: text/plain` on every request on a device**, a GET
  without a body included, and strict servers refuse that (Land Registry answers 415).
  Lynx's own `Request` adds it whenever the headers lack a `Content-Type` in that exact
  spelling, and nothing a caller passes avoids it. A `content-type` in another spelling
  got a second header beside it: iOS could send Lynx's instead, and Android sent both.
  Seen on Explorer 4.2 on the iOS simulator and the Android emulator. During each engine
  fetch, `provideLynxHttpClient()` now puts a `Request` on `globalThis` that drops the
  made-up header. It keeps the header the standard sets for a string or
  `URLSearchParams` body. `verify:http` fakes the engine's `Request`.
- **`examples/genui`: the keyboard covered the planner's message box** on a phone. The planner pads
  its bottom by the height `keyboardstatuschanged` reports, so the box sits above the keyboard.
- **`examples/genui`'s iOS app didn't build with Xcode 27**, which supports iOS 15.0 and up: the
  pods declared iOS 8 to 12. The Podfile targets 15.0 and raises every pod below it.
- **Animation and transition listeners leaked.** Angular never unlistens a template's
  `(animationend)`, `(transitionend)` or other `animation*` / `transition*` listener when it destroys
  the view: on the web the browser drops it with the element. On Lynx each stayed in the event registry
  for good. The renderer now drops an element's listeners when it destroys the element.
- **`LynxLazyFor` sent one batch per row it built when the window moved**, because Angular
  flushes the renderer after every `detectChanges()`. In a very hard fling the engine
  warned "CallLepusMethod called too frequently" (code 20401, `ngPatchUpdate`). A move is
  one batch now (`holdFlushes()` in the runtime), and moves are throttled to one per
  `lynxLazyForThrottle` (50 ms). `verify:lazy-list` flings 3,000 rows in half a second:
  5,945 batches a second before, 17 after; the engine's limit is 160.
- **A destroyed `<list>` kept its rows on the Main Thread.** Angular removes only the list,
  not each row from it, so every row's element, `item-key` and platform info stayed in the
  list registries for the rest of the session, and every later batch walked every list ever
  created. Each visit to a list screen added to it. They're freed with the list now, and
  `verify:lazy-list` checks the registries are empty afterwards.

### Security

- **zod 4 in the workspace** (GHSA-mrhx-c7xc-m3w5, high, zod < 4.6.6). ng-lynx's dev dependency and
  `examples/genui` move from zod 3.25 to 4.6.7. The peer range (`>=3.25.0`) is unchanged, and the
  code already imported `zod/v4`.
- **minimatch 11 through an override** (GHSA-g3hv-75wg-m249, moderate). typedoc, which
  `@lynx-js/genui`'s catalog extractor uses, asks for minimatch ^10 with no fixed 10.x;
  `pnpm-workspace.yaml` overrides it to 11. `verify:genui-tools` runs the extractor on it.
- **`examples/genui`'s iOS tooling:** activesupport 7.2.4 (GHSA-2j26-frm8-cmj9, GHSA-89vf-4333-qx8v,
  GHSA-cg4j-q9v8-6v38). GHSA-8474-xrp6-wh69 has no 7.2 fix, and CocoaPods needs activesupport < 8,
  so it stays until CocoaPods moves; it needs untrusted input to `safe_constantize`, which
  CocoaPods doesn't take.

### Documentation

- docs/22: the made-up Content-Type, where it comes from, and the form-POST workaround
  for 1.0.1.

### Tests

- The mock PAPI has `virtualizingList()`, a native list that virtualizes the way the iOS
  collection list and the C++ list container do: it asks only for the cells on screen, lets
  go of the ones that leave with `enqueueComponent`, asks again for a cell an `updateAction`
  refreshes, and records what a device rejects. The mock's `<list>` now keeps
  `enqueueComponent` and every `update-list-info` in order.
- The device `network` flow sends `HttpClient` requests to a server endpoint that
  echoes the Content-Type each one arrived with. The screen shows it, and `run.mjs`
  fails the run when it's wrong. The screen scrolls, since on CI's 320x640 emulator the
  last line is below the fold. The device-tests app now uses `provideLynxHttpClient()`.

## [1.0.1] - 2026-11-22

Fixes found by building a real app, MyAssets (live crypto prices and charts), from the
published 1.0.0 packages and running it in Lynx Explorer 4.2 on the iOS simulator. Each one
worked in the web preview, which is why the harnesses didn't catch them.

### Fixed

- **`HttpClient` failed on every request on a device.** There's no `globalThis.fetch` on the
  Background Thread (Lynx passes `fetch` to the bundle as a wrapper parameter), and
  Angular's fetch backend calls `globalThis.fetch`. Then Lynx's responses have no stream,
  and reading their `body` uses the body up. `provideLynxHttpClient()` now installs
  `lynx.fetch` as the global and reads every engine response through `text()`, never
  `.body`. `verify:http` fakes that engine.
- **No `WebSocket` in release builds.** rspeedy provides `@lynx-js/websocket` only for
  `rspeedy dev`. `pluginAngularLynx` now provides it for every lynx build; new harness
  `verify:websocket-build`. `ng-lynx` depends on `@lynx-js/websocket`.

### Documentation

- docs/08: `span-count` and `estimated-main-axis-size-px` are numbers, so the examples
  bind them (`[span-count]="1"`); the string form fails strict template checking.
- docs/12: how touch events behave on iOS (one finger per event, unstable `identifier`,
  `x`/`y` relative to the element touched).
- docs/13: CSS variables work from stylesheets, not inline; `<text>` keeps whitespace.
- docs/14: a component's host element has no size; give it a class.
- docs/22: what failed on a device, and how it's fixed.
- docs/29: `WebSocket` on a device.

### Changed

- The templates require `ng-lynx@^1.0.1`.

### Tests

- **The weekly Android device run failed on `main-thread`.** CI's emulator is 320x640 (no
  device profile), which nothing local had matched: the slider sat just above Android's
  navigation handle, the system took the swipe, and the slider got `touchcancel`. The page
  now scrolls, the flow centres the slider first, and the slider is narrow enough for
  Maestro's swipes to pass both its ends. `run.mjs` now runs Android at CI's screen size
  by default (`--screen device` keeps the device's). At that size two more flows failed
  locally and are fixed: `gesture` couldn't see its link on the home screen (every flow
  now scrolls to its link first), and the keyboard covered `input`'s model line (now
  above its field).
- The iOS device jobs run one at a time. Both waiting on the small `xcode-27` runner pool
  left one never given a runner, and it was cancelled without running.

## [1.0.0] - 2026-11-22

The first stable release. From here on, a breaking change to the covered API needs a major
release ([docs/43](docs/43-stability.md)). The changes below are since `0.1.0-rc.0`.

### Supported

- Angular 21 and 22, with TypeScript 5.9 and 6.0. Node 22.12 or later, `@lynx-js/rspeedy`
  0.18.
- Lynx engines 4.1 and 4.2, tested in Lynx Explorer on the iOS simulator and the Android
  emulator, and on a real iPhone. Android has not been tested on a real phone.

### Experimental

Native gestures, dynamic components (with the shared-runtime exports), GenUI, HarmonyOS and
the desktop-only elements. They work and are tested, but their API may still change in a
minor release; their types say `@experimental`.

### Changed

- `enableSelectorQueries` now defaults to `'lazy'`: an element gets its `[ng-ref-{id}]`
  attribute on its first query, instead of every element paying a native call at
  creation. The first query on an element waits one extra round trip to the Main
  Thread. Set `enableSelectorQueries: true` for the old behaviour.
- Encoding a batch for the Main Thread is about 3 times faster: coalescing and the
  string table run in one walk over the batch, and the Main Thread resolves the table
  in place.
- Bundles are about 10 kB smaller: `ng-lynx` now declares its `sideEffects`.
- A commit that changes no native element tells the engine so (`emptyPatch`), as
  ReactLynx does.
- ng-lynx no longer depends on `@lynx-js/react`, a 24 MB install with a Preact fork and
  an `@types/react` peer. It used only its Main-Thread worklet runtime, and now has its
  own: the same engine contract, about 4 kB instead of 13 kB minified, with its own
  tests. See docs/42-worklet-runtime.md. `ng-lynx/genui` users still install
  `@lynx-js/react`, as `@lynx-js/genui`'s own peer.
- In a worklet, `ctx.event.target` and `ctx.event.currentTarget` are `MainThreadElement`s,
  with `setStyle` and `getComputedStyleProperty`, and keep the `id`, `uid` and `dataset`
  the engine sent. Printing an event or sending it to the Background Thread no longer
  reaches the native element.
- Angular's comment anchors no longer become native nodes. Each `@if`, `@switch`, `@for`,
  `<ng-container>` and `*ngIf`, and each block inside a `@for` row, made an empty raw-text
  element on the Main Thread, with its own create and insert calls. They now stay on the
  Background Thread, as they already did under `<list>`.
- `<lynx-slider>` drags on the Main Thread in a build that has the worklet runtime
  (`mainThreadModules`): the thumb follows the finger without a round trip to the
  Background Thread on each move, and the model hears only of values that change. It
  is marked touched when the finger lifts. Without the runtime it works as before.
- `examples/ui-gallery`'s Draggable, Swiper, Sheet, SwipeAction and Sortable drag on the Main
  Thread, with worklets, as `examples/product-detail` does, instead of a round trip to the
  Background Thread on each move. The page stops scrolling on the touch that starts a drag.
- `ng add ng-lynx` writes `lynx/lynx.config.mts`, so Node no longer warns that the config
  "doesn't parse as CommonJS" in an Angular CLI workspace. A `"type": "module"` workspace
  still gets `lynx.config.ts`.
- `loadDynamicComponent`'s error starts with the engine's own reason, such as "The network
  connection was lost", before the raw result.
- `mainThreadLynx.getTextInfo` says the engine has no text measurement, on the web
  preview, instead of `lynx.getTextInfo is not a function`.

### Removed

- From `ng-lynx/worklet`: `applySetRef`, `applySetWorkletEvent`, `applyRunOnMainThread`,
  `applyReleaseMainThreadRef` and `resetWorkletState`, the Main-Thread executor's own op
  handlers, which the entry exported by mistake. From `ng-lynx`: the `WorkletRef` type,
  the wire form of a worklet binding.

### Added

- Typed attributes and events from `@lynx-js/types` 4.4 that templates could only bind
  with `NO_ERRORS_SCHEMA`: on every element `consume-slide-event`,
  `block-native-event-areas`, `event-through-active-regions`, `native-interaction-enabled`,
  `ios-enable-simultaneous-touch`, `enable-touch-pseudo-propagation`, `focusable`,
  `hardware-layer` and three accessibility attributes; `<list>` `scroll-event-throttle`,
  `item-snap`, `bounces` and the `listanimation*` events; `<image>` `image-config`,
  `cap-insets-scale`, `defer-src-invalidation` and the animated-image events; and more
  on `<input>`, `<textarea>`, `<text>`, `<overlay>`, `<scroll-coordinator>`, `<blur-view>`
  and `<webview>`. `verify:element-templates` compiles them with `strictTemplates`.
- `examples/gallery`: the official Gallery tutorial in Angular, a waterfall `<list>` that
  scrolls itself, with a Background-Thread and a Main-Thread scrollbar side by side.
- `verify:memory`: 1,000 mounts of a screen leave every registry on both threads at its
  baseline. The device tests' `memory` flow runs the same churn on an engine (docs/41).
- `ng-lynx/worklet-runtime`, for a build that doesn't use `pluginAngularLynx`: import it
  first among the Main-Thread modules.
- `@experimental` in the types on gestures, dynamic components, GenUI and
  `<title-bar-view>`, so editors show it. These were already experimental in the README.
- docs/43-stability.md: what 1.0 promises, what's experimental, and the supported Angular,
  TypeScript, Node and engine versions.

### Fixed

- `lynxTween` and `lynxAnimate` time an animation by the clock, not by counting 16 ms frames.
  When the Main Thread's timers fired late, as on the iOS simulator, a 240 ms snap took twice
  as long or more; it now ends after its `duration`, in fewer steps. On the web preview, whose
  timers are throttled to about a second, an animation now ends on time instead of crawling.
- The `ng-lynx/forms/theme.css` default theme had no rules for the option list that
  `<lynx-select>`, `<lynx-date-picker>` and `<lynx-time-picker>` open, so the options were
  black on the dark sheet, and its backdrop wasn't fixed, so the sheet opened inside the
  form. Both are styled now.
- `<lynx-select>` shows its placeholder for a value of `''` that no option has, as
  `FormControl('')` and `name = ''` start, instead of an empty trigger.
- `create-ng-lynx` and `ng add`: the page background now fills the screen; the `router`
  template's nav is a row, as meant; the `forms` template imports the default theme, so
  its select, checkbox and toggle are visible, and its placeholder is readable. Found by
  running each template from npm on the iOS simulator and the Android emulator.
- `lynxEventSource()` turned a character split between two network chunks into
  `U+FFFD`s, on both platforms: neither engine has a `TextDecoder`, and the polyfill
  ignored `stream: true`. The polyfill is now the WHATWG UTF-8 decoder, and about 3.5
  times faster on large bodies.
- `LynxIntersectionObserver`'s `relativeTo` finds the ancestor by id, so it works with
  lazy selector queries.
- A lazy route whose chunk failed to load, on a dropped network, stayed broken until the
  app restarted: Lynx's chunk-loading runtime kept the rejected promise, so every later
  navigation failed at once without a request. `pluginAngularLynx` patches the runtime
  so the next navigation fetches the chunk again.

## [0.1.0-rc.0]

The first release candidate.

### Supported

- Angular 21 and 22, Node 22.12 or later, `@lynx-js/rspeedy` 0.18.
- Lynx engines 4.1 and 4.2, tested in Lynx Explorer on the iOS simulator, the Android
  emulator and a real iPhone. Android has not been tested on a real phone.

### Added

- `ng-lynx`: a custom `Renderer2` that runs Angular on Lynx's Background Thread and
  applies the UI on the Main Thread, with zoneless change detection and signals.
- `ng-lynx/plugin`: `pluginAngularLynx()` for rspeedy, with AOT by default (JIT
  optional), a first-screen snapshot, i18n builds and hot swap during development.
- `ng-lynx/elements`: typed templates for every built-in Lynx element.
- `ng-lynx/forms`, `ng-lynx/router`, `ng-lynx/http`: `@angular/forms`,
  `@angular/router` and `HttpClient` on Lynx, plus ten headless form controls.
- Main Thread worklets (`ng-lynx/worklet`), `runOnMainThread`, `runOnBackground`,
  per-instance refs, `MainThread.Element` and `lynxAnimate`.
- Host data, app events, native modules, selector queries, exposure, `@defer`
  triggers, performance timing and session storage.
- `ng-lynx/testing`: `renderLynxComponent()` with text queries, under Vitest or Jest.
- `create-ng-lynx`: `npm create ng-lynx` with `minimal`, `router` and `forms`
  templates, and `ng add ng-lynx` for an existing Angular CLI workspace.

### Experimental

Native gestures (`[lynxGesture]`), dynamic components, GenUI (`ng-lynx/genui`),
HarmonyOS and the desktop-only elements.

Gestures: pan, tap, long press and fling run on iOS and Android. Lynx's engines have no
recognizer for `pinch` or `rotation`, so those never fire, and a dev build warns when you
bind one. A fling's event is typed as `MainThreadFlingGestureEvent`.

[Unreleased]: https://github.com/shabeliuk/ng-lynx/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/shabeliuk/ng-lynx/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/shabeliuk/ng-lynx/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/shabeliuk/ng-lynx/compare/v0.1.0-rc.0...v1.0.0
[0.1.0-rc.0]: https://github.com/shabeliuk/ng-lynx/releases/tag/v0.1.0-rc.0
