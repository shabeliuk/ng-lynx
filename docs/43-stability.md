# 43 — Stability and supported versions

What a release of ng-lynx promises, what it leaves out, and what it runs on.

> **Draft for 1.0.** Until `1.0.0`, ng-lynx is `0.x`: a minor release (`0.1` → `0.2`) may
> still break things, as SemVer allows for `0.x`. Every break is in the CHANGELOG.

## What 1.0 promises

From `1.0.0` on, ng-lynx follows [Semantic Versioning](https://semver.org):

- **Patch** (`1.0.x`): fixes only.
- **Minor** (`1.x.0`): new features. Code that built and ran on `1.0` still does.
- **Major** (`x.0.0`): anything that can break an app. The CHANGELOG says what to change.

A deprecated API keeps working until the next major. It carries `@deprecated` in its type,
which editors show struck through, and the CHANGELOG names its replacement.
`targetSdkVersion`, the old name of `engineVersion`, is an example.

## What it covers

The promise covers the entries marked "yes" in the package README's entry table:

| Import | Covered |
| --- | --- |
| `ng-lynx`, `ng-lynx/elements`, `/forms`, `/forms/theme.css`, `/router`, `/http`, `/genui` | yes, except the experimental parts below |
| `ng-lynx/worklet` | yes |
| `ng-lynx/plugin`: `pluginAngularLynx()` and its options | yes, except the experimental options |
| `ng-lynx/testing` | yes |
| `ng-lynx/main-thread`, `ng-lynx/worklet-runtime` | yes, as side-effect imports |
| `ng-lynx/entry-background` | no: the plugin adds it to your build |
| `ng-lynx/internal/*` | no: internal |

Covered means the exported names, their types, and the behaviour their docs describe.

It doesn't cover:

- **The wire protocol between the threads** ([04](04-wire-protocol.md)). Both halves ship in
  the same package version, so it can change in any release.
- **Bundle output.** Chunk names, the size of a bundle, and the order of the ops a render
  sends.
- **Error and warning text.** Messages can be reworded. Don't match on them.
- **The engine itself.** What a Lynx element does on a given engine is Lynx's behaviour.
  ng-lynx types it and documents what was seen.

## Experimental

These work and are tested, but their API can still change in a **minor** release. Their
declarations carry `@experimental` in the types, so editors show it when you hover them.

| Part | Where | Why |
| --- | --- | --- |
| Native gestures | `LynxGesture`, `GESTURE_TYPE`, the gesture event types, `enableNewGesture` | pinch and rotation never fire on either engine; no web support ([32](32-gestures.md)) |
| Dynamic components | `loadDynamicComponent`, the shared-runtime exports, `dynamicComponent`, `dynamicComponentHost`, `sharedModules` | Lynx's own mechanism is young ([38](38-dynamic-component.md)) |
| GenUI | all of `ng-lynx/genui` | follows `@lynx-js/genui`, which is `0.x` and moves to a2ui protocol v1.0 in 0.8 ([28](28-genui.md)) |
| Desktop-only elements | `LynxTitleBarView` (`<title-bar-view>`) | never run: Clay desktop only |
| HarmonyOS | — | never run anywhere |

When a part leaves experimental, its tag goes and the CHANGELOG says so.

## Supported versions

| Dependency | Supported | Notes |
| --- | --- | --- |
| Angular | 21 and 22 | `@angular/*` peers `>=21 <23`. CI builds and tests both |
| TypeScript | 5.9 (Angular 21), 6.0 (Angular 22) | |
| `@lynx-js/rspeedy` | 0.18 | |
| Node | 22.12 or later | for the build only |
| RxJS | 6.5.3+ or 7.4+ | as Angular itself needs |
| `@lynx-js/genui` | 0.7 | optional: only for `/genui` |

**Angular majors.** A new Angular major is added in a minor release, once CI passes on it.
Dropping one is a major release.

### Engines

| Where | Status |
| --- | --- |
| iOS: Lynx Explorer 4.1 and 4.2 | simulator and a real iPhone |
| Android: Lynx Explorer 4.1 and 4.2 | **emulator only, not yet a real phone** |
| Web preview: `@lynx-js/web-core` 0.26 | runs; gestures and `getTextInfo` are missing ([41](41-device-testing.md)) |
| Native iOS app through Sparkling | `genui`, Lynx 3.9 pods, iOS simulator; not yet on 4.2 or Android |
| HarmonyOS | never run |

Bundles are stamped with `engineVersion: '3.2'` by default ([39](39-lynx-4-1.md)), so they load
on 3.2 and every later engine. Features that need a newer engine say so in their docs, for
example `<overlay>` 3.5+, `<viewpager>` 3.9+, `<webview>` 4.0+ and `<video>` 4.1+. Tested means
the engines above. Older engines run what they have, but nothing here has been run on them.

What has been run where, example by example, is in [41 — Device testing](41-device-testing.md).
