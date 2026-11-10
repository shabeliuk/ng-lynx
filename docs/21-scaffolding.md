# Scaffolding — new apps, existing workspaces, and generators

Three ways to get Lynx-flavored Angular code, depending on where you're
starting from:

| Starting point | Use |
| --- | --- |
| Nothing yet | `npm create angular-lynx@latest my-app` (see the note below) |
| An existing Angular CLI workspace | `ng add angular-lynx` |
| Adding one more component to either | `ng generate angular-lynx:lynx-component <name>` |

## New app: `create-angular-lynx`

> ⚠️ **Not published yet.** The starter will be published as `create-ng-lynx`.
> `create-angular-lynx` on npm is a different project, so don't run these commands until
> the rename lands. Until then, run the CLI from this repo:
> `node packages/create-angular-lynx/index.mjs my-app`.

```bash
npm create angular-lynx@latest my-app
cd my-app
npm install
npm run dev
```

Then open the web preview at
`http://localhost:3000/__web_preview?casename=main.web.bundle`, or scan the
printed QR code with [Lynx Explorer](https://lynxjs.org/guide/start/quick-start)
on a device/simulator.

### Templates

```bash
npm create angular-lynx@latest my-app -- --template <name>
```

| Template | What you get |
| --- | --- |
| `minimal` (default) | Signals counter with the typed Lynx elements (`LYNX_ELEMENTS`, no `NO_ERRORS_SCHEMA`), CSS-file styling. |
| `router` | `@angular/router` via `provideLynxRouter` — tap-driven nav, three routes including a lazy `loadComponent` one. |
| `forms` | `@angular/forms` — `[(ngModel)]` on Lynx `<input>` via `LynxValueAccessor`, plus `lynx-select` / `lynx-checkbox` / `lynx-toggle` from the headless control kit. |

Every template ships: `lynx.config.ts` (dual `lynx`/`web` environments, QR-code
plugin, `pluginAngularLynx` with AOT), a strict `tsconfig.json`
(`strictTemplates` on — the typed element directives make that painless),
`src/index.ts` bootstrap with the CSS import, `src/rspeedy-env.d.ts` for asset
and CSS imports, and a README with the run instructions.

`scripts/verify-consumer.mjs` scaffolds all three outside this workspace,
installs the packed tarball and builds them; CI runs it on Angular 21 and 22.

### What the generated app assumes

- **Node ≥ 22.12**, any package manager.
- Angular is pinned to `^21.0.0` (the templates carry
  `@angular/compiler-cli` + `@ngtools/webpack` in devDependencies — the AOT
  toolchain the default build needs; they're optional peers of angular-lynx,
  so package managers won't auto-install them).
- Styling lives in CSS files imported from `src/index.ts` — see
  [13 — Styling](13-styling.md).

### Implementation notes

The CLI (`packages/create-angular-lynx`) is dependency-free: it copies
`templates/base` + `templates/<name>`, substitutes `__APP_NAME__` (sanitized
from the target directory name), and renames `gitignore` → `.gitignore`
(npm strips real dotfiles when publishing). Adding a template = adding a
directory.

## Existing workspace: `ng add angular-lynx`

```bash
ng add angular-lynx
# or, to use a directory other than the default `lynx/`:
ng add angular-lynx --directory mobile
```

`ng add` first installs the `angular-lynx` package, then runs its `ng-add`
schematic (`packages/angular-lynx/schematics/ng-add`), which:

1. Scaffolds a **new, self-contained Lynx entry point** at `<directory>/`
   (default `lynx/`) — `lynx.config.ts`, `tsconfig.json`, and a
   `src/` with the same signals-counter shell as `create-angular-lynx`'s
   `minimal` template (its banner text picks up the workspace's own
   `package.json` `name`).
2. Adds the devDependencies the AOT build needs — `@lynx-js/rspeedy`,
   `@lynx-js/qrcode-rsbuild-plugin`, `@angular/compiler-cli`,
   `@ngtools/webpack` (the last two version-aligned to whatever
   `@angular/core` the workspace already uses) — without touching any
   version already pinned (safe to run again after editing pins by hand).
3. Adds two npm scripts, `lynx:dev` / `lynx:build`, and appends
   `<directory>/dist/` + `<directory>/.rspeedy/` to `.gitignore`.

```bash
npm install
npm run lynx:dev
```

**What it deliberately does *not* do:** wire a custom `angular.json` architect
builder, or port the workspace's existing root component. Lynx apps build
through `@lynx-js/rspeedy` — its own CLI, not an Angular CLI builder — so the
added target is plain npm scripts, the same thing a `create-angular-lynx`
app's `package.json` has. And the existing web app's root component is
DOM-bound (`BrowserModule`, `RouterOutlet` wired to browser `location`, …),
none of which runs on Lynx's dual-thread engine — so `ng add` generates a
fresh entry point rather than pretending to reuse one that can't run there.
Share business-logic components into it afterward, same as adding any other
new platform target.

### Two rspeedy path-resolution gotchas, handled for you

Both scripts pass `--root <directory>`, **not** a `<directory>/`-prefixed
`--config` path — confirmed empirically (`verify:schematics`' real build
step): once `--root` is given, rspeedy resolves `--config` *relative to that
root*, so `--config <directory>/lynx.config.ts --root <directory>` silently
double-joins into `<directory>/<directory>/lynx.config.ts` and fails to find
the config at all. The generated scripts are `rspeedy build --root
<directory> --config lynx.config.ts`.

Separately, `pluginAngularLynx`'s own `tsconfig` option is **not**
root-aware — it resolves against `process.cwd()` (the actual OS-level
cwd, which for an `npm run` script is always the workspace root, `--root`
notwithstanding). The generated `lynx.config.ts` therefore pins
`tsconfig: '<directory>/tsconfig.json'` explicitly; without it, AOT would
silently pick up the *workspace's* root tsconfig instead of the Lynx
target's, and `@ngtools/webpack` fails with "is missing from the TypeScript
compilation."

## Generator: `ng generate angular-lynx:lynx-component`

```bash
ng generate angular-lynx:lynx-component product-card
# aliases: ng g angular-lynx:component product-card
#          ng g angular-lynx:c product-card
```

Generates a standalone, `OnPush`, typed-Lynx-elements component:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

import './product-card.component.css';

@Component({
  selector: 'product-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="product-card">
      <text>ProductCardComponent works!</text>
    </view>
  `,
})
export class ProductCardComponent {}
```

plus a companion `product-card.component.css` (Lynx CSS lives in files
imported from the entry point, not component `styles: [...]` —
[13 — Styling](13-styling.md)).

| Option | Default | |
| --- | --- | --- |
| `--path <dir>` | `src` | Directory to create the component in. |
| `--flat` | `true` | `false` nests it in its own `<path>/<name>/` subfolder instead of directly in `--path`. |
| `--skip-css` | `false` | Skip the companion `.css` file (and its import line) for components with no unique styles. |

No selector prefix is assumed (no `angular.json` `prefix` convention is read
or enforced) — the selector is the bare dasherized name.

## Verification

- `npm run verify:schematics` — `@angular-devkit/schematics/testing`'s
  `SchematicTestRunner` against a fixture workspace tree: both schematics'
  file generation, `ng-add`'s package.json merge (idempotent, preserves
  existing scripts/dep pins, aligns `@angular/compiler-cli` to the
  workspace's `@angular/core`), `.gitignore` handling, `--directory`/`--path`/
  `--flat`/`--skip-css` options, and every error path (missing
  `package.json`, a directory/name that already exists, an escaping
  `--directory`). Then a **real** `rspeedy build` — the schematic's generated
  files materialized into a scratch folder inside `examples/router` (already
  `pnpm install`ed) and built for real, which is how the two path-resolution
  gotchas above were actually found.
- `node scripts/verify-consumer.mjs` — the three `create-angular-lynx` templates,
  against the packed tarball.

Continue to [02 — Getting started](02-getting-started.md).
