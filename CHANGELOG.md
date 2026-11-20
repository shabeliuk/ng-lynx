# Changelog

Both packages, `ng-lynx` and `create-ng-lynx`, share one version and one changelog.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor
release may change the API; experimental features may change in any release.

## [Unreleased]

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

[Unreleased]: https://github.com/shabeliuk/ng-lynx/compare/v0.1.0-rc.0...HEAD
[0.1.0-rc.0]: https://github.com/shabeliuk/ng-lynx/releases/tag/v0.1.0-rc.0
