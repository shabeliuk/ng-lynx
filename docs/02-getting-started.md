# Getting started

> **Shortcut:** `npm create ng-lynx@latest my-app` scaffolds all of the
> below (templates: minimal / router / forms) — see
> [21 — Scaffolding](21-scaffolding.md). The rest of this page is the manual
> setup.

> See [05 — Build integration](05-build-integration.md) for what the build does
> and the PrimJS details.

## 1. Install

**Node 22.12 or later** (Angular 22 asks for 22.22 or later). Lynx's own
[quick start] allows Node 20.19, but on Node 20 the `web` environment's build
fails inside Rspack (`WebAssembly.instantiate(): Unknown heap type -14`). The
`lynx` bundle does build there, but the web preview is half the dev loop. See
[36 — CI](36-ci.md).

```jsonc
// package.json
{
  "type": "module",
  "dependencies": {
    "@angular/core": "^21.0.0",
    "@angular/compiler": "^21.0.0",
    "ng-lynx": "^0.1.0-rc.0"
  },
  "devDependencies": {
    "@angular/compiler-cli": "^21.0.0",
    "@ngtools/webpack": "^21.0.0",
    "@lynx-js/rspeedy": "^0.18.4",
    "@lynx-js/qrcode-rsbuild-plugin": "^0.7.3",
    "typescript": "~5.9.0"
  }
}
```

Angular 21 and 22 are supported. Angular 21 needs TypeScript 5.9, and 22 needs 6.0.
`@angular/compiler-cli` and `@ngtools/webpack` do the AOT compile, and rspeedy
and the QR plugin move together: the plugin's peer range follows rspeedy's minor.

Types for what the build handles (`import './app.css'`, `import logo from
'./logo.png'`) come from rspeedy. TypeScript 6 fails the build without them:

```ts
// src/rspeedy-env.d.ts
/// <reference types="@lynx-js/rspeedy/client" />
```

## 1b. Get Lynx Explorer (to run on a simulator or phone)

Lynx Explorer is the pre-built sandbox app that loads a bundle by URL — no
native toolchain needed. Follow Lynx's [quick start] for the full flow; the
short version for an iOS simulator:

1. Install Xcode, then **Xcode → Open Developer Tool → Simulator**.
2. Download `LynxExplorer-arm64.app.tar.gz` (or `-x86_64` on an Intel Mac) from
   a [Lynx release](https://github.com/lynx-family/lynx/releases), extract it,
   and drag the `.app` into the running simulator.
3. Paste the bundle URL into "Enter Card URL" (see [§5 Run](#5-run)).

> **Which release?** Lynx's quick start may still link older downloads.
> Explorer **4.2.0** is the newest tagged release (assets on the GitHub
> release), and this repo is validated on it and on 4.1. The version matters:
> `<video>` is `version_added: 4.1`, and several elements this repo exercises
> behave differently between releases. See
> [40 — The Lynx 4.2 upgrade](40-lynx-4-2.md),
> [39 — The Lynx 4.1 upgrade](39-lynx-4-1.md) and
> [41 — Device testing](41-device-testing.md).

[quick start]: https://lynxjs.org/guide/start/quick-start.html

## 2. Configure the build

```ts
// lynx.config.ts
import { defineConfig } from '@lynx-js/rspeedy';
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginAngularLynx } from 'ng-lynx/plugin';

export default defineConfig({
  source: { entry: { main: './src/index.ts' } },
  environments: { lynx: {}, web: {} },
  plugins: [
    pluginQRCode({ schema: (url) => `${url}?fullscreen=true` }),
    pluginAngularLynx({ enableCSSSelector: true, enableCSSInheritance: true }),
  ],
});
```

## 3. Write the entry

```ts
// src/index.ts
import { bootstrapLynxApplication } from 'ng-lynx';
import './app.css';                 // global CSS, applied via the Lynx CSS engine
import { AppComponent } from './app.component';

bootstrapLynxApplication(AppComponent);
```

`bootstrapLynxApplication` is the Lynx analog of `bootstrapApplication`. It wires
zoneless change detection and the Lynx renderer factory, then mounts your root
component onto the single Lynx page root (no host-selector lookup).

Pass app providers as the second argument:

```ts
bootstrapLynxApplication(AppComponent, {
  providers: [/* provideRouter(routes), your services, … */],
});
```

## 4. Write components

```ts
// src/app.component.ts
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],      // typed Lynx tags: <view>, <text>, …
  template: `
    <view class="card" (tap)="inc()">
      <text class="label">Tapped {{ count() }} times</text>
    </view>
  `,
})
export class AppComponent {
  count = signal(0);
  inc() { this.count.update((n) => n + 1); }
}
```

### Rules to internalize

- **Use Lynx tags, not HTML.** `view`, `text`, `image`, `scroll-view`, ….
  Import `LYNX_ELEMENTS` so the template compiler knows them and type-checks
  their attributes and `$event` ([18 — Typed templates](18-typed-templates.md)).
- **Text must live inside `<text>`.** A bare `{{ x }}` under a `<view>` won't
  render (the same constraint as in ReactLynx).
- **Use native events.** `(tap)`, `(touchstart)`, `(scroll)` — not `(click)`.
  Prefix with `catch` to stop native bubbling, e.g. `(catchtap)`.
- **State is signals.** Zoneless CD only reacts to signals,
  `markForCheck()`, async pipe, and a few other explicit triggers. Plain mutated
  fields won't refresh the view.
- **`OnPush` everywhere.** It's the right default for signal components.
- **Styling is class-based.** Put styles in a CSS file imported from the entry.
  Component `styles: [...]` can't reach Lynx's CSS engine (you'll get a dev
  warning); see [13 — Styling](13-styling.md).
- **Two-way input** uses [`[(lynxModel)]`](09-forms.md), or `[(ngModel)]` and
  reactive forms with `LynxValueAccessor`.

## 5. Run

```bash
npm run dev            # rspeedy dev
```

The dev server serves both a **web preview** and a **Lynx bundle**:

- **Web:** open `http://localhost:3000/__web_preview?casename=main.web.bundle`.
- **iOS simulator:** in **Lynx Explorer**, "Enter Card URL" → paste
  `http://localhost:3000/main.lynx.bundle?fullscreen=true` (the simulator has no
  camera, so paste rather than scan). A physical device can scan the QR code.

To run this repo's own examples, build the package first: `pnpm install`,
`pnpm --filter ng-lynx build`, then `cd examples/hello-world && npm run dev`.
For the build internals and PrimJS gotchas, see
[05 — Build integration](05-build-integration.md); for the verification ladder,
[07 — Verifying](07-verifying.md).

Next: [03 — Renderer internals](03-renderer-internals.md).
