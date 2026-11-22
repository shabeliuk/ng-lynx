# ng-lynx

**Angular for [Lynx](https://lynxjs.org/), built around Lynx's two threads.**

Lynx runs an app on two threads: a **Background Thread** for JavaScript logic and a
**Main Thread** that owns the native UI. ng-lynx is designed around that split:

- **Angular runs on the Background Thread.** Components, signals, change detection, the
  router, forms and HTTP all live there, so app logic never blocks the thread that draws.
- **The UI lives on the Main Thread.** Each change-detection pass becomes one small batch
  of ops, which the Main Thread applies to real native elements.
- **What has to react within a frame runs on the Main Thread too.** Worklets, native
  gestures and animations follow a finger without a round trip to Angular, and a
  build-time snapshot paints the first screen before Angular has started.

Everything else here, from typed templates to lists, forms and the dev loop, is built on
that split.

```
 Background Thread                                Main Thread
 ─────────────────                                ───────────
 your components, signals,                        native elements
 change detection          ── batch of ops ──▶    (__CreateView, __SetAttribute, …)
 LynxRenderer2 + shadow tree

 your event handlers       ◀──── events ─────     taps, input, scroll

 runOnBackground() result  ◀───────────────────   worklets, gestures, animations
                                                  first-screen snapshot
```

## On the Background Thread: plain Angular

Standalone, zoneless components with signals, no Zone.js:

```ts
import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { bootstrapLynxApplication } from 'ng-lynx';
import { LYNX_ELEMENTS, type LynxTouchEvent } from 'ng-lynx/elements';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS], // typed Lynx tags — no NO_ERRORS_SCHEMA
  template: `
    <view class="box" (tap)="inc($event)">
      <text>Count: {{ count() }}</text>
    </view>
  `,
})
export class AppComponent {
  count = signal(0);
  inc(e: LynxTouchEvent) { this.count.update((n) => n + 1); }
}

bootstrapLynxApplication(AppComponent);
```

A custom [`Renderer2`](https://angular.dev/api/core/Renderer2) mirrors the view as a
small shadow tree instead of a DOM, and records every change as a compact op. The ops of
one change-detection pass are sent to the Main Thread together, which replays them with
Lynx's element API. See [01 — Architecture](docs/01-architecture.md).

## On the Main Thread: worklets

For work that can't wait for a message to cross threads, write a worklet in a module the
build loads on the Main Thread, and bind it on an element:

```ts
// worklets.ts, listed in pluginAngularLynx({ mainThreadModules: ['./src/worklets.ts'] })
import { defineWorklet, type WorkletContext } from 'ng-lynx/worklet';

function pressFadeMT(ctx: WorkletContext): void {
  ctx.setStyle('opacity: 0.6'); // applied on the Main Thread, in the same frame
  ctx.runOnBackground('pressed'); // and tell Angular about it
}
export const pressFade = defineWorklet(pressFadeMT);
```

```html
<view [lynxMainThread]="{ tap: pressFade }" (mainThreadCallback)="onPressed($event)"></view>
```

The same model drives `[lynxGesture]`, `runOnMainThread()`, `MainThread.Element` and
`lynxAnimate`. See [11 — Main-thread worklets](docs/11-worklets.md).

## Status

**Pre-release.** It will be published as `ng-lynx`, with the starter `create-ng-lynx`
(`npm create ng-lynx`). Both names are reserved on npm, and the first release
candidate isn't out yet.

It builds and runs on Lynx Explorer 4.1 and 4.2 on the iOS simulator and the Android
emulator, in the web preview, and as a native iOS app through Sparkling. Several examples
have also passed on a real iPhone.

> **Android has only been tested on the emulator, not on a real phone.**

What has been run where is in [41 — Device testing](docs/41-device-testing.md).

| Area | What you get | Docs |
| --- | --- | --- |
| Rendering | `Renderer2` over the element PAPI, flat ops wire protocol, zoneless + signals | [01](docs/01-architecture.md), [03](docs/03-renderer-internals.md), [04](docs/04-wire-protocol.md) |
| Build | `pluginAngularLynx`: dual-thread split, AOT (default) or JIT, partial-Ivy linking | [05](docs/05-build-integration.md) |
| Typed templates | `LYNX_ELEMENTS`: every built-in element, typed attributes and `$event` | [18](docs/18-typed-templates.md) |
| Events | `(tap)`, `(catchtap)`, `(capture-bindtap)`, `(global-bindtap)`, `(tap.self)`, `(window:x)` | [12](docs/12-events.md) |
| Lists | Native `<list>` through `@for`; `LynxVirtualFor` for huge lists | [08](docs/08-lists.md), [30](docs/30-virtual-list.md) |
| Forms | `[(lynxModel)]`, `[(ngModel)]`, reactive forms, ten headless controls, optional theme | [09](docs/09-forms.md) |
| Router & HTTP | `provideLynxRouter` (deep links, back button, lazy routes), `provideLynxHttpClient` | [15](docs/15-routing.md), [22](docs/22-http.md) |
| Main thread | Worklets, `runOnMainThread`, `runOnBackground`, per-instance refs, `MainThread.Element`, gestures, `lynxAnimate` | [11](docs/11-worklets.md), [32](docs/32-gestures.md), [33](docs/33-animations.md) |
| Host integration | `lynxInitData()`, `lynxGlobalProps()`, `LynxGlobalEvents`, `lynxForeground()`, native modules | [17](docs/17-host-data.md), [23](docs/23-app-events.md), [27](docs/27-native-modules.md) |
| Platform APIs | Selector queries, exposure, `@defer` triggers, performance, session storage, `lynx.*` | [10](docs/10-element-queries.md), [24](docs/24-visibility.md), [25](docs/25-performance.md), [29](docs/29-platform-apis.md) |
| Styling | CSS files, Sass, Tailwind, `@media`, parent-state rules | [13](docs/13-styling.md) |
| First screen | Build-time snapshot, painted before Angular boots | [20](docs/20-first-screen.md) |
| Dev loop | State-preserving hot swap, op-stream logger | [31](docs/31-hot-swap.md), [26](docs/26-debugging.md) |
| Dynamic components | Load separately built bundles at runtime, sharing the host's Angular | [38](docs/38-dynamic-component.md) |
| i18n, accessibility | `$localize` per-locale builds and extraction; typed `accessibility-*` | [35](docs/35-i18n.md), [34](docs/34-accessibility.md) |
| GenUI | Angular renderers for A2UI and OpenUI | [28](docs/28-genui.md) |
| Testing & tooling | `renderLynxComponent` under Vitest, `create-ng-lynx`, `ng add` | [19](docs/19-testing.md), [21](docs/21-scaffolding.md) |

**Experimental in 1.0:** native gestures, dynamic components, GenUI, HarmonyOS and the
desktop-only elements. They work, but their API may still change; their types say
`@experimental`. What 1.0 promises is in [43 — Stability](docs/43-stability.md).

Angular 21 and 22 are supported, on Node 22.12 or later. 71 headless harnesses
(`npm run verify:all`) drive the real runtime against a mock engine, and
`scripts/verify-consumer.mjs` packs the tarball and builds real apps from it. See
[07 — Verifying](docs/07-verifying.md).

## Try it

```bash
pnpm install
pnpm --filter ng-lynx build
cd examples/hello-world && npm run dev
```

Then open `http://localhost:3000/__web_preview?casename=main.web.bundle`, or load the
printed bundle URL in [Lynx Explorer](docs/02-getting-started.md#1b-get-lynx-explorer-to-run-on-a-simulator-or-phone).

## Repository layout

```
packages/ng-lynx/
  internal/      # ops.ts — the BG↔MT wire protocol (shared)
  runtime/       # Background Thread: LynxRenderer2, bootstrap, shadow tree, flush, events
  main-thread/   # Main Thread (Lepus): ops executor + page bootstrap + first-screen snapshot
  plugin/        # rspeedy/rsbuild plugin: dual-thread build + JIT/AOT + Lynx packaging
  testing/       # headless TestBed: mock PAPI + renderLynxComponent fixture
  schematics/    # ng add + ng generate
  bin/           # ng-lynx-capture, ng-lynx-extract-i18n
  verify/        # the headless harnesses
packages/create-ng-lynx/
  index.mjs      # the scaffolding CLI (zero deps)
  templates/     # minimal / router / forms app templates
packages/device-tests/
  src/           # a small test app (private, not published)
  flows/         # Maestro flows it runs on a real engine; docs/41 explains them
examples/        # 25 runnable apps, one per feature; docs/41 lists them
docs/            # the guides below
scripts/         # CI helpers
```

## Docs

**Start here**

- [01 — Architecture](docs/01-architecture.md)
- [02 — Getting started](docs/02-getting-started.md)
- [21 — Scaffolding](docs/21-scaffolding.md)
- [18 — Typed templates](docs/18-typed-templates.md)

**Building an app**

- [12 — Events](docs/12-events.md)
- [13 — Styling](docs/13-styling.md)
- [08 — Lists](docs/08-lists.md)
- [30 — Virtual lists](docs/30-virtual-list.md)
- [09 — Forms & input](docs/09-forms.md)
- [14 — Content projection](docs/14-content-projection.md)
- [15 — Routing](docs/15-routing.md)
- [22 — HttpClient](docs/22-http.md)
- [35 — i18n](docs/35-i18n.md)
- [34 — Accessibility](docs/34-accessibility.md)
- [37 — UI gallery example](docs/37-ui-gallery.md)
- [28 — GenUI](docs/28-genui.md)

**Main thread & motion**

- [11 — Main-thread worklets](docs/11-worklets.md)
- [32 — Gestures](docs/32-gestures.md)
- [33 — Animations](docs/33-animations.md)

**Host & platform**

- [17 — Host data](docs/17-host-data.md)
- [23 — App events & lifecycle](docs/23-app-events.md)
- [27 — Native modules](docs/27-native-modules.md)
- [29 — Platform APIs](docs/29-platform-apis.md)
- [10 — Element queries](docs/10-element-queries.md)
- [24 — Visibility](docs/24-visibility.md)
- [25 — Performance API](docs/25-performance.md)
- [38 — Dynamic components](docs/38-dynamic-component.md)

**Tooling & internals**

- [05 — Build integration](docs/05-build-integration.md)
- [42 — The worklet runtime](docs/42-worklet-runtime.md)
- [43 — Stability and supported versions](docs/43-stability.md)
- [19 — Testing](docs/19-testing.md)
- [20 — First-screen snapshot](docs/20-first-screen.md)
- [26 — Debugging](docs/26-debugging.md)
- [31 — Hot-swap / HMR](docs/31-hot-swap.md)
- [03 — Renderer internals](docs/03-renderer-internals.md)
- [04 — Wire protocol](docs/04-wire-protocol.md)
- [07 — Verifying](docs/07-verifying.md)
- [36 — CI & publishing](docs/36-ci.md)
- [41 — Device testing](docs/41-device-testing.md)
- [39 — The Lynx 4.1 upgrade](docs/39-lynx-4-1.md)
- [40 — The Lynx 4.2 upgrade](docs/40-lynx-4-2.md)

## License

[Apache-2.0](LICENSE), the same licence as Lynx, ReactLynx and GenUI. This project
exists because of them, and of Angular (MIT).

Code derived from other open-source projects is credited in [`NOTICE`](NOTICE), and in a comment at the
top of each derived file. [`THIRD-PARTY.md`](THIRD-PARTY.md) lists every dependency's licence,
what an app built with ng-lynx has to carry, and where the examples' media comes from.

ng-lynx is an independent project, not affiliated with the Lynx project or the Angular team.
