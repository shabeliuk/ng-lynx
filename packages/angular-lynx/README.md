# angular-lynx

An Angular custom renderer for building [Lynx](https://lynxjs.org) apps — run a
real, zoneless, signals-based Angular application on Lynx's dual-thread native
engine, with no DOM and no Zone.js.

```ts
import { bootstrapLynxApplication } from 'angular-lynx';
import { AppComponent } from './app.component.js';

bootstrapLynxApplication(AppComponent);
```

```ts
// lynx.config.ts
import { defineConfig } from '@lynx-js/rspeedy';
import { pluginAngularLynx } from 'angular-lynx/plugin';

export default defineConfig({
  environments: { lynx: {}, web: {} },
  plugins: [pluginAngularLynx()],
});
```

## What you get

- **A real Angular app on Lynx** — standalone components, signals, zoneless
  change detection, `@if`/`@for`, `@defer`, and the DI system, rendered onto
  Lynx's native element tree through a custom `Renderer2`.
- **Typed Lynx elements** (`angular-lynx/elements`) — `<view>`/`<text>`/
  `<image>`/`<scroll-view>`/`<list>` and the rest, fully type-checked under
  `strictTemplates`, with typed events.
- **Forms** (`angular-lynx/forms`) — `@angular/forms` `ngModel`/reactive forms,
  plus a headless control kit (checkbox, radio, toggle, select, date/time
  pickers, autocomplete, slider, stepper, segmented control).
- **Router** (`angular-lynx/router`) — `@angular/router` with deep links and the
  Android back button; lazy routes via `loadComponent`/`loadChildren`.
- **HttpClient** (`angular-lynx/http`) — `provideLynxHttpClient()` over `fetch`.
- **Platform APIs** — `SystemInfo`, error reporting, session storage, exposure/
  `@defer (on viewport)`, performance timing, native modules, worklet-driven
  animations, accessibility attributes, i18n via `$localize`, and gestures
  (experimental).
- **GenUI** (`angular-lynx/genui`) — Angular renderers for the a2ui and openui
  catalogs.
- **Testing** (`angular-lynx/testing`) — a headless mock-PAPI environment with a
  `renderLynxComponent()` fixture.
- **AOT by default** via `@ngtools/webpack`; the package itself ships
  partial-Ivy declarations linked against your app's Angular version, so it
  works across its peer range (Angular 21 and 22).

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
angular-lynx is an independent project, not affiliated with the Lynx project or the Angular team.
