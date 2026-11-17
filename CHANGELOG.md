# Changelog

Both packages, `ng-lynx` and `create-ng-lynx`, share one version and one changelog.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor
release may change the API; experimental features may change in any release.

## [Unreleased]

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
