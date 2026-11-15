# Styling

Lynx has its own CSS engine that compiles styles **at build time** — there is no
runtime stylesheet injection. So the way you style an ng-lynx app is with
**CSS files**, the same model ReactLynx uses.

## The supported path: CSS files

Write a `.css` file and `import` it (a side-effect import). rspeedy compiles it
into the Lynx stylesheet, and the renderer applies it via class selectors.

```ts
// app.component.ts (or index.ts)
import './app.component.css';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<view class="card"><text class="card-title">Hi</text></view>`,
})
export class AppComponent {}
```

```css
/* app.component.css */
.card { padding: 16px; background-color: #1f2a44; }
.card-title { font-size: 18px; color: #fff; }
```

You can co-locate one `.css` per component and import it from that component's
`.ts` — keep the file next to the component and `import` it there. There's no
encapsulation, so **namespace your class names** (e.g. a component prefix like
`card-…`, or BEM) to avoid collisions across components.

## What's NOT supported: `@Component({ styles / styleUrls })`

Inline `styles` and `styleUrls` in the `@Component` decorator are **ignored** on
Lynx (you'll get a dev-time warning). Two hard constraints make them impossible
to project automatically:

- **No runtime CSS injection.** Angular's `ViewEncapsulation.Emulated` (the
  default) injects component CSS into the document at runtime. Lynx's element
  PAPI has no equivalent — only per-element inline styles (`__SetInlineStyles`)
  and a build-time stylesheet-scope id (`__SetCSSId`). CSS *rules* can't be added
  at runtime.
- **The AOT compiler reads sources from disk.** `@ngtools/webpack`
  (`AngularWebpackPlugin`, used for the AOT default) compiles components from its
  own TypeScript host and loads styles directly from disk — bypassing the build's
  loader chain — so there's no hook to extract/rewrite component styles into the
  Lynx stylesheet either.

So put your styles in a `.css` file as shown above.

## What the Lynx CSS engine supports

Verified on the web engine (and the supported model on-device):

| Selector | Supported | Notes |
| --- | --- | --- |
| Class `.box` | ✅ | the primary tool — use classes for everything |
| Compound class `.box.active` | ✅ | combine classes on one element |
| Descendant `.list .row` | ✅ | needs `enableCSSSelector: true` (the examples set it); following a class that changes after the element exists needs `enableCSSInvalidation`, which `pluginAngularLynx` turns on — see below |
| Attribute `[data-x]` | ❌ | **not supported** — don't rely on attribute selectors |
| `inset` shorthand (`top`/`right`/`bottom`/`left` collapsed) | ❌ | **not supported** — see gotcha below |

Other Lynx CSS facts worth knowing:

- **Don't rely on a default `display`/`flex-direction`.** Lynx's own docs say
  a plain `<view>` defaults to `linear` layout (vertical), not flex — and even
  where flex *is* in effect, relying on an assumed default direction is how a
  real bug shipped here: a trigger row had `align-items: center` but no
  `display: flex; flex-direction: row`, and the text rendered pinned to the
  top edge instead of vertically centered (see
  [09 — Forms](09-forms.md#richer-controls)).
  Set **both** `display: flex` and `flex-direction` explicitly on every
  container — never rely on the default. A root view that must fill the
  screen also needs a definite height — use `height: 100%` (the page root is
  `display:block` on web). See [08 — Lists](08-lists.md) for the list-height
  gotcha.
- **`inset` gotcha.** Don't write `top: 0; right: 0; bottom: 0; left: 0;` to
  size a `position: fixed` element to the full screen — the build's CSS
  minifier collapses that into the shorthand `inset: 0`, which Lynx's CSS
  encoder doesn't support and **silently drops** (a real build warning:
  *"Unsupported property 'inset' was removed during template encode"* — the
  element loses its sizing entirely, not just the shorthand). Use
  `top: 0; left: 0; width: 100%; height: 100%;` instead — same result,
  doesn't collapse into the unsupported shorthand.
- **A parent-state class restyles its descendants only with
  `enableCSSInvalidation`, which `pluginAngularLynx` turns on.** The idiom is
  standard on the web:

  ```css
  .lynx-toggle-on .lynx-toggle-track { background-color: red; }
  ```

  Without the flag, Lynx matches a combinator (descendant, sibling) only
  against the classes an element had when it was created, and doesn't
  re-match a subtree when an ancestor's class changes later. Angular applies
  `[class.x]` bindings as an update after creation, so on a device such a rule
  never fired: on iOS not even when the state was `true` from the first
  render, and on Android (Explorer 4.1) not after a change.

  `enableCSSInvalidation` is the template flag
  [Lynx documents](https://lynxjs.org/api/rspeedy/react-rsbuild-plugin.pluginreactlynxoptions.enablecssinvalidation)
  for this. ReactLynx turns it on by default; `@lynx-js/template-webpack-plugin`,
  which ng-lynx builds with, defaults it to `false`, so until
  `pluginAngularLynx` set it, ng-lynx apps had it off. Measured on
  Explorer 4.1 (Android emulator and iOS simulator): `examples/styling`'s
  switch restyles its children at first render and on every tap. Built with
  `enableCSSInvalidation: false`, the same switch reproduces the old failure.
  Lynx's note on the cost: collecting the affected nodes slows style
  matching, so an app that never changes an ancestor's class can turn it off.

  The original diagnosis, three measurements on an iOS simulator (Lynx
  Explorer 4.0.0, engine 3.7) with the flag off:

  1. A direct rule on the same element (`.lynx-toggle-on { opacity: .35 }`)
     **did** apply on tap — so the class genuinely lands, and the tap fires.
  2. The descendant rule keyed on that same class did **not** apply.
  3. A *static* descendant rule (`.lynx-toggle .lynx-toggle-thumb`, where the
     ancestor class is present at creation) **did** apply.

  That's why `LynxToggle` had *no* visible on-state on a device, and why
  `LynxCheckbox`'s box never turned its checked colour (its ✓ is `@if`-mounted,
  which masked it). The fix then was to put the state class on the element
  being styled, and the controls in `ng-lynx/forms` keep it: it works
  with the flag on or off, so the controls work in an app that turns it off.
  `npm run verify:controls` asserts those classes.

  ```html
  <!-- not `.parent-on .track`, but a class on the track itself -->
  <view class="lynx-toggle-track" [class.lynx-toggle-track-on]="checked()">
  ```
- **⚠️ `display: none` on text still paints the text (engines 4.1 and 4.2).** On Lynx
  Explorer 4.1 and 4.2 (iOS simulator, last checked 2026-11-10), a `<text>` with
  `display: none` leaves the layout, but its text is still drawn at the parent's
  top-left corner, over whatever is there. Hiding the `<view>` around it does the same. Seen with
  plain rules and inside `@media`, with and without `enableCSSRule`.
  ng-lynx creates text the way ReactLynx does (`__CreateRawText` plus a
  `text` attribute), so it looks like an engine issue, not yet confirmed
  against ReactLynx. To hide text, remove it with `@if`, or collapse a
  wrapping `<view>` (`height: 0; overflow: hidden`), as
  `examples/responsive` does.
- **Explicit units.** Dimensions need units (`16px`, not `16`).
- **`[class.x]` / `[style.prop]` bindings work** — they go through the renderer
  as class/inline-style mutations, independent of the CSS engine.
- **`enableCSSSelector` / `enableCSSInheritance` / `enableCSSInvalidation`**
  are plugin options (`pluginAngularLynx({ enableCSSSelector: true, … })`) —
  the examples enable the selector engine so descendant/compound selectors
  match. `enableCSSInvalidation` defaults to on (see above).

## Media queries

`@media` works on **engine 4.0+**, on every native platform, and needs
nothing ng-lynx-specific. Measured on Lynx Explorer 4.1, on the iOS
simulator and the Android emulator: orientation, width and resolution
queries all evaluate, and the page's fallback note disappears under
`@media all`. What rotating the device does differs, on Explorer 4.2: on
Android the page is recreated, so landscape and `width ≥ 600px` match and the
layout goes to three columns, but the app's state resets. On iOS the page keeps
its state and resizes, and the queries **aren't reliably re-evaluated**: they
kept their old result on a real iPhone and in one simulator run, and updated in
a later one. For layout that has to follow rotation, read the size instead:
`(layoutchange)` on the page element fires at each new size, and
`examples/responsive` sets its columns from it. A page opened in landscape matches correctly on both. A plain `.css` file with `@media` blocks
compiles like any other. The web preview drops `@media` by design, because
Lynx's web runtime has no rule kind for a conditional group. See
[`examples/responsive`](../examples/responsive).

Two settings, and both fail silently or badly when missing:

```ts
// lynx.config.ts
import { pluginLynxConfig } from '@lynx-js/config-rsbuild-plugin';

plugins: [
  pluginLynxConfig({ enableCSSRule: true }),
  pluginAngularLynx({ engineVersion: '3.9' }),
],
```

- **`enableCSSRule: true`.** Without it the build leaves every `@media`
  block out of the bundle; no warning, the rules just aren't there. Measured
  by building the same stylesheet both ways: only the flagged build carries
  the queries.
- **`engineVersion: '3.9'`** (formerly `targetSdkVersion`, still accepted).
  `enableCSSRule` changes how the whole
  stylesheet is encoded, and an engine older than 4.0 can't read it. It
  doesn't degrade, it **crashes**: on Lynx Explorer with engine 3.7 the
  template reader logs `unknown Decode Error` over and over and the app
  aborts (SIGABRT). At the default floor (3.2) every old engine tries. 4.0
  would be the right floor, but the encoder in this toolchain
  (`@lynx-js/tasm` 0.0.49, still pinned by `@lynx-js/template-webpack-plugin`
  0.16.6) fails the build above 3.9, so 3.9 is as high as it goes. tasm
  0.0.51 accepts up to 4.2; the floor can move to 4.0 once the template
  plugin adopts it. With it, engine 3.7 refuses the bundle with a readable error
  instead (`version check miss … engine version: 3.9, lynx sdk version: 3.7`,
  LynxError 10204) and the app keeps running. A 3.9 engine still passes the
  check; how it handles the stylesheet is unmeasured. The build warns when
  `enableCSSRule` is on with a lower floor.

Because of that floor, `@media` belongs in an app that targets 4.0, not in a
stylesheet shared with apps that must load on 3.x. That's why
`examples/styling` doesn't use it.

What Lynx evaluates (a subset of Media Queries Level 4, per
[Lynx's reference](https://lynxjs.org/api/css/media-query)): `width`,
`height`, `aspect-ratio` and `resolution`, with `min-`/`max-` and the range
syntax; `orientation`; and `prefers-color-scheme`. That last one is `light`
until the host app reports the system scheme. Lynx Explorer 4.1 doesn't, on
iOS or Android, so there it stays `light` even with the device in dark mode,
on a cold start as well. (Explorer's `develop` branch, after 4.2.0, now
reports it, so a later release should.) What Explorer 4.1 does send, on both
platforms, is the system scheme as a global prop, `theme: 'Light' | 'Dark'`.
Lynx's [theming guide](https://lynxjs.org/guide/styling/custom-theming) has
the host pass the theme that way, so a page can read it with
`lynxGlobalProps()` and set a class. `examples/responsive` does both, and its
notes have the measurements. `hover` and `pointer` never
match, since the host provides no values, and `print` never matches. Two
habits make a stylesheet work everywhere:

- **Write the base styles as the complete fallback**, then override inside
  `@media`. The base is what the web preview, and any engine without
  `@media`, shows.
- **Put the rule on the element it styles.** That's what
  `examples/responsive` does and what was measured on rotation. A descendant
  rule follows an ancestor's class change with `enableCSSInvalidation` (see
  above), but whether one inside `@media` re-matches when the device rotates
  hasn't been measured.

`@supports` and `@layer` are parsed and encoded the same way; neither is
exercised here yet.

## Sass

Sass works — verified end-to-end (`examples/styling`). Add
[`@rsbuild/plugin-sass`](https://rsbuild.rs/plugins/list/plugin-sass) to the
`plugins` array; rspeedy accepts Rsbuild plugins directly. That's the whole
setup — nothing ng-lynx-specific:

```ts
// lynx.config.ts
import { pluginSass } from '@rsbuild/plugin-sass';
import { pluginAngularLynx } from 'ng-lynx/plugin';

export default defineConfig({
  plugins: [
    pluginSass(),
    pluginAngularLynx({ enableCSSSelector: true, enableCSSInheritance: true }),
  ],
});
```

```ts
// index.ts — side-effect import, same shape as a .css
import './styles.scss';
```

**Why it "just works":** every Sass feature compiles to plain CSS *before*
Lynx's CSS engine ever runs, so none of Lynx's own CSS constraints apply to
the Sass layer — only to the CSS it emits. Confirmed in the example's live
render (and by reading the built bundle): variables resolve to literal values
(`$card-bg` → `rgb(27, 34, 51)`), nesting flattens to descendant selectors
(`.card { .card-title {} }` → `.card .card-title`, which needs
`enableCSSSelector: true` to match — see the table above), `@mixin`/`@include`
expand inline, `color.adjust(...)` computes a literal hex at build time, and
arithmetic (`$space * 3`) resolves to a fixed `px`. A mixin is the natural way
to stop repeating the mandatory `display: flex; flex-direction: …` pair (the
gotcha above). Less works the same way via `@rsbuild/plugin-less`.

The Lynx-CSS constraints from the table still apply to the *output*: don't
write `top/right/bottom/left: 0` in Sass either (it still minifies to the
unsupported `inset`), and attribute selectors still don't work.

## Tailwind

Tailwind works via Lynx's own preset — verified end-to-end
(`examples/tailwind`). Use **Tailwind v3** with
[`@lynx-js/tailwind-preset`](https://www.npmjs.com/package/@lynx-js/tailwind-preset)
(the preset targets `tailwindcss@^3.4`) and
[`rsbuild-plugin-tailwindcss`](https://www.npmjs.com/package/rsbuild-plugin-tailwindcss):

```ts
// tailwind.config.ts — keep it plain (see the gotcha below)
import preset from '@lynx-js/tailwind-preset';

const config = {
  // Angular templates are inline `template:` strings in the .ts, so that's
  // where Tailwind finds class names. Add './src/**/*.html' if you use
  // external templateUrl files.
  content: ['./src/**/*.ts'],
  presets: [preset],
};
export default config;
```

```ts
// lynx.config.ts
import { pluginTailwindCSS } from 'rsbuild-plugin-tailwindcss';
import { pluginAngularLynx } from 'ng-lynx/plugin';

export default defineConfig({
  plugins: [
    pluginTailwindCSS({ config: 'tailwind.config.ts' }),
    pluginAngularLynx({ enableCSSSelector: true, enableCSSInheritance: true }),
  ],
});
```

```css
/* tailwind.css — imported from index.ts */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

The preset is **the reason it fits Lynx**: it ships only the utilities Lynx's
CSS engine supports and reimagines a few for Lynx's rendering model, so you
don't have to hand-avoid the unsupported-property traps above. Confirmed in the
example's live render + computed styles: `bg-slate-900`/`bg-red-500` colors,
`rounded-full` (→ `9999px`), `flex flex-col gap-4` layout (→
`flex-direction: column`), and `text-xl`/`font-bold`/`text-slate-400`
typography all render correctly, and `(tap)` interaction works.

Two things to know:

- **Keep `tailwind.config.ts` plain.** Tailwind v3 loads the config through its
  own jiti/sucrase transform, which throws `SyntaxError: Unexpected token` on
  newer TS-only syntax — `satisfies Config` and `import type` both trip it.
  Use a plain `const config = { … }; export default config;` (a `.js`/`.cjs`
  config avoids the transform entirely). This is a Tailwind-v3-loader quirk,
  not an ng-lynx one.
- **The preset is experimental.** Its own README flags it as still-evolving
  ("exploring the best DX to write Tailwind upon Lynx"), so treat the exact
  utility set as a moving target and verify against your Lynx engine version.

## Dynamic styles

For per-element dynamic styling, use Angular's class/style bindings (these don't
depend on the CSS engine and always work):

```html
<view [class.active]="isActive()" [style.opacity]="fade() ? '0.5' : '1'">…</view>
```
