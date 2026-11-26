# ng-lynx

**Build native iOS and Android apps with Angular.** ng-lynx is an Angular renderer for
[Lynx](https://lynxjs.org), the cross-platform engine from ByteDance: your components,
signals, router and forms render as real native views, not inside a WebView. The same
app also runs on the web.

It runs a real, zoneless, signals-based Angular application on Lynx's dual-thread
engine, with no DOM and no Zone.js.

```bash
npm create ng-lynx@latest my-app
cd my-app && npm install && npm run dev   # scan the QR code with Lynx Explorer
```

## Who it's for

- **Angular teams going mobile.** Keep Angular, TypeScript, DI, signals,
  `@angular/router` and `@angular/forms`, and ship an iOS and Android app instead of
  rewriting it in another framework.
- **Web-to-mobile projects that want native UI.** Hybrid apps (a web app in a
  WebView) are quick to start but feel like a web page. On Lynx, every `<view>`,
  `<text>` and `<list>` is a native view, and UI work runs on its own thread, so
  scrolling and gestures don't wait for your app code.
- **Apps with AI inside.** Let an LLM or agent build parts of your screens at run
  time, from components you trust (see [below](#ai-inside-your-app-generative-ui)).
- **One codebase, several targets.** iOS, Android and the web from the same build.
  (Lynx also targets HarmonyOS; ng-lynx's support there is experimental and not yet
  run.)

## How it looks

```ts
import { bootstrapLynxApplication } from 'ng-lynx';
import { AppComponent } from './app.component.js';

bootstrapLynxApplication(AppComponent);
```

```ts
// lynx.config.ts
import { defineConfig } from '@lynx-js/rspeedy';
import { pluginAngularLynx } from 'ng-lynx/plugin';

export default defineConfig({
  environments: { lynx: {}, web: {} },
  plugins: [pluginAngularLynx()],
});
```

## What you get

- **A real Angular app on Lynx** — standalone components, signals, zoneless
  change detection, `@if`/`@for`, `@defer`, and the DI system, rendered onto
  Lynx's native element tree through a custom `Renderer2`.
- **Typed Lynx elements** (`ng-lynx/elements`) — `<view>`/`<text>`/
  `<image>`/`<scroll-view>`/`<list>` and the rest, fully type-checked under
  `strictTemplates`, with typed events.
- **Forms** (`ng-lynx/forms`) — `@angular/forms` `ngModel`/reactive forms,
  plus a headless control kit (checkbox, radio, toggle, select, date/time
  pickers, autocomplete, slider, stepper, segmented control).
- **Router** (`ng-lynx/router`) — `@angular/router` with deep links and the
  Android back button; lazy routes via `loadComponent`/`loadChildren`.
- **HttpClient** (`ng-lynx/http`) — `provideLynxHttpClient()` over `fetch`.
- **Platform APIs** — `SystemInfo`, error reporting, session storage, exposure/
  `@defer (on viewport)`, performance timing, native modules, worklet-driven
  animations, accessibility attributes, i18n via `$localize`, and gestures
  (experimental).
- **GenUI** (`ng-lynx/genui`) — AI-generated UI: Angular renderers for A2UI
  (protocol v1.0) and OpenUI, with the full A2UI basic catalog.
- **Testing** (`ng-lynx/testing`) — a headless mock-PAPI environment with a
  `renderLynxComponent()` fixture.
- **AOT by default** via `@ngtools/webpack`; the package itself ships
  partial-Ivy declarations linked against your app's Angular version, so it
  works across its peer range (Angular 21 and 22).

## AI inside your app: generative UI

`ng-lynx/genui` lets an AI agent describe UI, and your app render it as native
screens from a catalog of Angular components you control. The agent never sends code,
only a description of which components to show, with what data.

- **A2UI v1.0**, the agent-to-UI protocol: the agent streams JSON messages;
  `<a2ui-surface>` renders them with the 20 basic-catalog components (text, buttons,
  forms, lists, tabs, date pickers, charts) or your own. Taps and form input go back
  to the agent as actions.
- **OpenUI**: the model writes a compact UI language that renders as it streams in,
  so a screen builds up while the answer is still arriving.
- Both come with prompt builders, so the model knows your catalog, and both run on
  [`@lynx-js/genui`](https://lynxjs.org/next/api/genui/index.html).

```html
<a2ui-surface [messageStore]="store" [catalog]="catalog" (action)="sendToAgent($event)" />
```

The repository's
[`examples/genui`](https://github.com/shabeliuk/ng-lynx/tree/main/examples/genui) is a
retirement planner where a real LLM (Gemini, or any OpenAI-compatible model) holds the
conversation and generates the forms and charts on the phone. GenUI is experimental.
Guide: [docs/28](https://github.com/shabeliuk/ng-lynx/blob/main/docs/28-genui.md).

## Entry points

| Import | For | Covered by semver |
| --- | --- | --- |
| `ng-lynx` | bootstrap, renderer, worklets, gestures, host data, platform APIs | yes |
| `ng-lynx/elements`, `/forms`, `/forms/theme.css`, `/router`, `/http`, `/genui` | the features above | yes |
| `ng-lynx/worklet` | authoring Main Thread worklets | yes |
| `ng-lynx/plugin` | `pluginAngularLynx()` in `lynx.config.ts` | yes |
| `ng-lynx/testing` | `renderLynxComponent()` and queries | yes |
| `ng-lynx/main-thread` | the Main Thread runtime; tests import it once in their setup | yes, as a side-effect import |
| `ng-lynx/worklet-runtime` | the worklet runtime; the plugin adds it, a build without the plugin imports it first among its Main Thread modules | yes, as a side-effect import |
| `ng-lynx/entry-background` | added to your build by the plugin; don't import it | no, internal |
| `ng-lynx/internal/ops`, `ng-lynx/internal/runtime`, `ng-lynx/internal/worklet-runtime` | the wire protocol, and test hooks for the runtime and the worklet runtime | no, internal |

Gestures, dynamic components, GenUI, HarmonyOS and the desktop-only elements are
experimental: they work, but their API may still change in a minor release. Their
declarations carry `@experimental`, so your editor shows it. See
[docs/43](https://github.com/shabeliuk/ng-lynx/blob/main/docs/43-stability.md).

## Tested on

Lynx Explorer 4.1 and 4.2 on the iOS simulator and the Android emulator, and on a real
iPhone for several features. **Android has only been tested on the emulator, not on a
real phone.**

## Documentation

Full documentation lives in the [repository `docs/`
tree](https://github.com/shabeliuk/ng-lynx/tree/main/docs) — start with
`docs/01-architecture.md` and `docs/02-getting-started.md`.

## Requirements

- Angular 21 or 22: `@angular/core`, `@angular/compiler`,
  `@angular/compiler-cli`, and `@ngtools/webpack` for the default AOT build.
- `@lynx-js/rspeedy` 0.18 and TypeScript 5.9 (Angular 21) or 6.0 (Angular 22).
- Node 22.12 or later.
- To run: a Lynx engine. Lynx Explorer 4.1 or 4.2 for development.

## License

Apache-2.0. Code derived from other open-source projects is credited in `NOTICE`.
ng-lynx is an independent project, not affiliated with the Lynx project or the Angular team.
