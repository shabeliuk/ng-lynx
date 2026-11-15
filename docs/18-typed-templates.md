# Typed templates — `ng-lynx/elements`

Without help, Angular's template compiler only knows the DOM vocabulary, so a
Lynx template needs `schemas: [NO_ERRORS_SCHEMA]` — which turns *all* template
checking off: tag typos compile, attribute typos compile, and `$event` is
untyped (or wrongly typed when a Lynx event name collides with a DOM one — the
`(scroll)` gotcha in [12 — Events](12-events.md)).

`ng-lynx/elements` fixes this with a set of **typed element directives**
covering Lynx's built-in elements (`view`, `text`, `image`,
`scroll-view`, `list`, `list-item`, `input`, `textarea`, `video`, `svg`,
`frame`, `overlay`, `refresh`, `refresh-header`, `title-bar-view`,
`viewpager`, `viewpager-item`, `scroll-coordinator` and its 4 children,
`blur-view`, `webview`). Import them and drop the schema:

```ts
import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS, type LynxTouchEvent } from 'ng-lynx/elements';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [LYNX_ELEMENTS],          // ← no NO_ERRORS_SCHEMA
  template: `
    <view class="counter" (tap)="onTap($event)">
      <text text-maxline="2">{{ count() }}</text>
      <image src="a.png" mode="aspectFit" [auto-size]="true" />
    </view>
  `,
})
export class AppComponent {
  readonly count = signal(0);
  onTap(e: LynxTouchEvent): void {   // $event fully typed
    this.count.update((n) => n + 1);
  }
}
```

What you get under `strictTemplates` (all verified against real ngc 21.2):

| Check | Example | Diagnostic |
| --- | --- | --- |
| Unknown tags still error | `<viwe>` | NG8001 (only *matched* tags become known) |
| Attribute typos | `[srcc]="x"` on `<image>` | NG8002 |
| Attribute value types | `[mode]="'stretch'"` | TS2322 (not in the enum) |
| `$event` payload types | `(tap)="onScroll($event)"` | TS2345 |
| DOM-collision events fixed | `(scroll)` on `<scroll-view>` | typed `LynxScrollEvent`, not DOM `Event` |

The attribute and event surfaces are curated from `@lynx-js/types`, the same
typings ReactLynx's JSX uses, and aren't complete yet. Individual directives can be
imported instead of the whole `LYNX_ELEMENTS` array.

## Design: why outputs are "type-only"

When a template binds `(tap)` on an element, Angular registers a listener **on
the element itself** (through `LynxRenderer2.listen()` — exactly the path
untyped bindings use) *and additionally* subscribes to any same-named directive
output. During development the directives forwarded native events through their
emitters — and every handler ran **twice** (`verify:elements` now asserts
single delivery precisely because of this).

So the outputs are lazily-created **inert** `EventEmitter`s: they exist to give
the compiler the payload type and to mark the event name as "claimed" (which is
also what makes the checker skip the DOM typing for collision names like
`scroll` / `input`), but they never emit — delivery stays 100% on the
renderer's native path, with multiplexing, `.self`, and unlisten-on-destroy
unchanged.

Two practical consequences:

- **Subscribe in the template, not programmatically.** A
  `viewChild(LynxImage).load.subscribe(...)` will never fire — bind `(load)`
  in the template instead.
- **Unbound events cost nothing.** Angular only reads output properties the
  template binds; each is a getter that allocates its emitter on first read.
  An element with no event bindings registers no listener and allocates no
  emitters (asserted by `verify:elements`).

## Pointer & keyboard events (PC / desktop targets)

Beyond the touch-first set (`tap`/`longtap`/`touchstart`/…), every element also
types Lynx's **PC/desktop** events — mouse, wheel, and physical keyboard —
curated from the reference's event shapes
([lynxjs.org/api/lynx-api/event](https://lynxjs.org/next/api/lynx-api/event/)):

| Event(s) | `$event` type | Key fields |
| --- | --- | --- |
| `keydown` / `keyup` | `LynxKeyEvent` | `key`, `repeat`, `altKey`/`ctrlKey`/`metaKey`/`shiftKey` |
| `mousedown` / `mouseup` / `mousemove` / `mouseenter` / `mouseover` / `mouseleave` | `LynxMouseEvent` | `button`, `buttons`, `x`/`y`, `pageX`/`pageY`, `clientX`/`clientY` |
| `wheel` | `LynxWheelEvent` (extends `LynxMouseEvent`) | `deltaX`, `deltaY` |

```ts
<view (keydown)="onKey($event)" (wheel)="onWheel($event)"></view>
// onKey(e: LynxKeyEvent) → e.key, e.shiftKey (fully typed)
// onWheel(e: LynxWheelEvent) → e.deltaY
```

These fields sit at the **top level** of the event object (like `touches` on
`LynxTouchEvent`), not in `detail`. On a **mobile** target they simply never
fire — they're for the PC/desktop targets where Lynx surfaces a mouse and
keyboard. Wired and payload-typed the same way as every other event (asserted
by `verify:elements`); the exact on-device firing is per Lynx's platform notes.

## Design: inputs forward as attribute ops

Each typed input is a setter forwarding to the element as a normal attribute op
(`SET_ATTR` via `Renderer2.setProperty`), so the wire protocol and Main-Thread
executor are untouched:

- raw values are preserved — `[maxlength]="10"` ships the number `10`,
  `[auto-size]="true"` ships a boolean (same as ReactLynx);
- unset inputs never emit an op;
- setting an input back to `undefined`/`null` removes the attribute (only if
  the directive had set it);
- `item-key` on `<list-item>` flows through the same platform-info routing as
  before ([08 — Lists](08-lists.md)).

Attributes **not** declared on a directive can still be written as static
attributes (`<view weird-attr="x">` — static attributes are never
schema-checked). For *bindings* outside the typed surface, either add
`NO_ERRORS_SCHEMA` back (the directives still improve everything they cover)
or open an issue — the surface is easy to extend.

## `<video>`

`LynxVideo` types Lynx's [`<video>` element](https://lynxjs.org/next/api/elements/built-in/video.html)
(`src`, `loop`, `volume`, `muted`, `speed`, `object-fit`, `mode`,
`timeupdate-interval`; events `firstframe`/`playing`/`paused`/`stopped`/
`timeupdate`/`ended`/`looped`/`error`/`buffering`). It needs engine 4.1 and has no
`autoplay`: start it with `invoke({ method: 'play' })`. It fires `paused`, not
HTML's `pause`. Measured on Explorer 4.1 on the iOS simulator and the Android
emulator (`examples/media`).

To autoplay, call `play` from `(firstframe)` (`LynxVideoFirstFrameEvent`,
`{ duration }`), which fires once each time a source loads. Sending `play`
along with a new `src` doesn't work, because both engines cancel queued
methods when the source changes. To load the same file again, change the URL
(a query string will do): iOS ignores a `src` equal to the current one.

Because `<video>` is also a real DOM tag name, Angular's template parser
applies normal HTML self-closing rules to it: write `<video src="…"></video>`,
not the self-closing `<video src="…" />` other Lynx tags allow.

The same "it's a real tag name" rule has a second, nastier consequence: **never
write a literal `<video>` inside an interpolation**. Angular tokenizes the
template as HTML *before* evaluating `{{ }}`, so the tag in a string like

```html
<!-- DON'T: silently breaks this component's AOT compilation -->
<text>{{ mounted() ? 'Unmount <video>' : 'Mount <video>' }}</text>
```

is parsed as a real element. This does **not** produce a build error — the
build reports success, and the component instead fails at runtime with
`Error: JIT compiler unavailable` at bootstrap, because no AOT definition was
generated for it. Hit for real while editing `examples/primitives`; the fix is
to keep tag names out of interpolated strings (`'Unmount the video element'`),
or escape them as `&lt;video&gt;` in static text.

```html
<video [src]="clipUrl()" loop muted object-fit="cover" (playing)="onPlaying($event)"></video>
```

## `<svg>` and `<frame>`

`LynxSvg` types [`<svg>`](https://lynxjs.org/next/api/elements/built-in/svg.html)
(`src`, `content`, `current-color`; event `load`) — it renders as a single
native view built from the `content`/`src` XML rather than one node per shape,
the same mechanism `ng-lynx/genui`'s `LineChart`/`PieChart` components use.
`LynxFrame` types [`<frame>`](https://lynxjs.org/next/api/elements/built-in/frame.html),
Lynx's `<iframe>` equivalent for embedding a nested Lynx page (`src`, `data`,
`global-props`, `auto-width`/`auto-height`, `preset-width`/`preset-height`,
`enable-multi-async-thread`; events `load`, `loadmetrics`).

Both are **confirmed working in the web preview**, verified by loading `examples/hello-world` with a
real `<svg>` (rendered as a real `x-svg` custom element) and a real
`<frame src="…">` (which mounted a genuine nested `<lynx-view>` that loaded
and ran the target bundle — pointing one at its own bundle produced the
expected recursive embedding). `<svg>` is confirmed on-device too.

> **⚠️ `<svg src>` on iOS ignores fills declared in a `<style>` block.**
> Measured on a real iPhone across three files that differ only in how they
> colour their shapes. Path **geometry always renders**; what varies is fill:
>
> | How the file colours shapes | Result |
> | --- | --- |
> | `<defs><style>.fur { fill: #d9a066 }</style></defs>` + `class="fur"` | ❌ ignored — every path falls back to the SVG default, so the artwork draws as a correct but **entirely black** silhouette |
> | `fill="#d9a066"` presentation attribute | ✅ correct colour |
> | `fill="rgb(84.3%, 93.1%, 98.1%)"` (percentage notation) | ✅ correct colour |
>
> So it's specifically the CSS-cascade path that the native SVG renderer
> doesn't apply — not fills in general, and not percentage notation. Both
> files render identically and correctly in a browser, which is what makes
> this easy to miss.
>
> **An XML comment draws nothing at all.** On iOS (Explorer 4.2, simulator,
> 2026-11-09), a file with `<!-- … -->` between the `<?xml?>` declaration and
> `<svg>` was fetched and then drew nothing, in any colour. The same file
> without the comment drew fully. Strip comments when you ship an asset (SVGO's
> default `removeComments` does).
>
> **A failed `src` download leaves the element stuck (iOS).** If fetching the
> file fails (server down, 404), Lynx's iOS `<svg>` fires no `error` event,
> keeps the previous picture, and ignores every later `src`. `LynxSVGView`
> sets a "rendering" flag when it starts and clears it only after a successful
> draw (still so on upstream `develop`, 2026-11-09). If `src` can change, give
> each value its own element, so a stuck one is replaced:
>
> ```html
> @for (src of [svgSrc()]; track src) {
>   <svg [src]="src"></svg>
> }
> ```
>
> `examples/primitives` does this. A failed load then shows an empty box
> rather than a stale picture, and the next `src` loads normally.
>
> **Remedy:** flatten `<style>` rules into presentation attributes before
> shipping the asset — SVGO's `inlineStyles` + `convertStyleToAttrs` plugins
> do exactly this, and most exporters can be told to emit presentation
> attributes rather than a stylesheet. Inline `content` (rather than `src`)
> also paints CSS-class colours correctly if you'd rather not preprocess.
> `examples/primitives` keeps one file of each kind side by side so the
> difference stays visible; its black lynx is the deliberate control, not
> a regression.

> **⚠️ `<frame src>` does not load on-device without host-app support — and
> that is by design, not a bug here.** Running `examples/primitives` on an iOS
> simulator, the frame lays out but the nested page never appears; the native
> log shows only
> `LynxFrameView: propsDidUpdate failed, bundle not loaded or render is null`,
> and — the decisive detail — **no network request for the nested bundle is
> ever made**.
>
> The engine source explains why. On iOS `LynxFrameView`'s setter is just
> `- (void)setUrl:(NSString *)url { _url = url; }` — it stores the URL and
> fetches nothing. The bundle arrives separately through
> `setAppBundle:(LynxTemplateBundle *)`, i.e. **already constructed by the host
> app**; only then does `_isBundleLoad` become `YES` and `propsDidUpdate`
> proceed. Android is the same shape: `loadBundle(TemplateBundle bundle)` takes
> the bundle as a *parameter*. So **`<frame>` never resolves its own `src` on
> either native platform** — the embedder is responsible for turning that URL
> into a `TemplateBundle` and handing it over. Stock Lynx Explorer doesn't, so
> the element is inert there.
>
> This is the same category as the native-only elements in the next section:
> it needs a host app wired for it, not merely "a real device". Note it is
> **not** the relative-URL problem — an absolute URL via `lynxAssetUrl()`
> changes nothing here, because nothing ever fetches. The web preview works
> precisely because `@lynx-js/web-core` implements `<frame>` by fetching the
> URL itself; the two targets genuinely divide the responsibility differently.

## The newer elements

The remaining directives are all typed and registered in `KNOWN_LYNX_TAGS` the
same way. They render in the web preview since web-core 0.26, and need the engine
version below on a device. Measured on Explorer 4.1 and 4.2:
[41 — Device testing](41-device-testing.md).

| Element | Docs | Notes |
| --- | --- | --- |
| `LynxOverlay` (`<overlay>`) | [overlay](https://lynxjs.org/next/api/elements/built-in/overlay.html) | Engine 3.5. Detached rendering layer for dialogs/modals; one direct child only, `position: fixed`. |
| `LynxRefresh` / `LynxRefreshHeader` (`<refresh>`, `<refresh-header>`) | [refresh](https://lynxjs.org/next/api/elements/built-in/refresh.html) | Engine 3.8. Pull-to-refresh; vertical only. |
| `LynxTitleBarView` (`<title-bar-view>`) | [title-bar-view](https://lynxjs.org/next/api/elements/built-in/title-bar-view.html) | Clay Windows/macOS window-chrome dragging only. Mobile raises LynxError 990200, and the app keeps running. |
| `LynxViewpager` / `LynxViewpagerItem` (`<viewpager>`, `<viewpager-item>`) | [viewpager](https://lynxjs.org/next/api/elements/built-in/viewpager.html) | Engine 3.9. Horizontally swipeable paging; children must be `<viewpager-item>`. |
| `LynxScrollCoordinator` + 4 children (`<scroll-coordinator>`, `-header`, `-slot`, `-slot-drag`, `-toolbar`) | [scroll-coordinator](https://lynxjs.org/next/api/elements/built-in/scroll-coordinator.html) | Engine 3.9. Nested scroll coordination for sticky-header layouts. Inside another scroller, Android needs `android-nested-scroll-as-child`. |
| `LynxBlurView` (`<blur-view>`) | [blur-view](https://lynxjs.org/next/api/elements/built-in/blur-view.html) | Engine 4.0. Backdrop blur; on Android its parent needs `[flatten]="false"`. |
| `LynxWebview` (`<webview>`) | [webview](https://lynxjs.org/next/api/elements/built-in/webview.html) | Engine 4.0. Embeds a web page; needs fixed width/height, can't nest inside a scrollable. |

### `ui not found`, and native elements of your own

An engine older than the element throws `LynxCreateUIException: <tag> ui not found
when create UI` (error `9901`/`990100`). The engine resolves a tag to a
natively registered UI class.

A host app can register its own, per Lynx's
[Custom Element guide](https://lynxjs.org/guide/custom-native-component.html):

| Platform | Global | Per-`LynxView` |
| --- | --- | --- |
| iOS | `LYNX_LAZY_REGISTER_UI("video")` in a `LynxUI` subclass | `[builder.config registerUI:[MyVideoUI class] withName:@"video"]` |
| Android | `LynxEnv.inst().addBehavior(new Behavior("video") {…})` | `lynxViewBuilder.addBehavior(new Behavior("video") {…})` |
| HarmonyOS | `BehaviorRegistryMap` | `behaviors` param of the `LynxView` constructor |

Then tell the build about the tag, because any other unknown tag becomes a plain
`<view>` (that's what a component selector needs):

```ts
pluginAngularLynx({ nativeElements: ['map-view'] })
```

Use it in a template with `schemas: [CUSTOM_ELEMENTS_SCHEMA]` (dashed names) or
`NO_ERRORS_SCHEMA`. No host app has been run with this yet.

## Accessibility attributes

All ten `accessibility-*` / `ios-platform-accessibility-id` attributes on
`StandardProps` are typed on `LynxStandardElement` (so every element gets
them) — see [34 — Accessibility](34-accessibility.md) for the full reference.

## What isn't typed yet

- **`capture-*` and `global-bind` events, and most `catch*` variants.** They work
  through the renderer ([12 — Events](12-events.md)); only the `catch*` touch and
  tap events are declared as outputs.
- **`<page>`.** The engine creates it; apps never write it.

`<markdown>`, `<filter-image>`, `<inline-image>`, `<inline-text>`,
`<inline-truncation>` and `<list-row>` are typed (`LynxMarkdown`, `LynxFilterImage`,
…, all in `LYNX_ELEMENTS`). `<markdown>` has its 24 attributes and 9 events, with
typed payloads such as `(link)="open($event.detail.url)"`; its methods are typed
through `asLynxElement<'markdown'>` ([10](10-element-queries.md#typed-invoke)). All six
render on the iOS simulator in the device-tests `attributes` flow, where
`(drawEnd)` and `<filter-image>`'s `(load)` fire.

## Verifying

- `npm run verify:elements` — runtime behavior: lazy outputs (no listener for
  unbound events), **single** delivery of bound events, raw-typed attribute
  forwarding, updates and removal.
- `npm run verify:video` / `npm run verify:primitives` — same wire-protocol
  checks for the elements above (real `__CreateElement(tag, …)`, every typed
  attr/event). They can't prove visual behaviour.
- Compile-time behavior was verified against the real `ngc` with
  `strictTemplates`: the positive template above compiles clean, and the typo
  / wrong-enum / wrong-`$event` cases produce NG8002 / TS2322 / TS2345 (NG8001
  for unmatched tags).
- End-to-end: `examples/hello-world` now imports `LYNX_ELEMENTS` with no
  schema and builds through the full AOT pipeline (`rspeedy build`, lynx + web
  targets); both bundles pass the ES2019 parse gate
  ([07 — Verifying](07-verifying.md#level-3--es2019-parse-gate-catches-primjs-issues-locally)).
- **`examples/primitives`** — a manual test bed for every element on this
  page: `npm run dev` there opens it in the web preview, and its QR code loads it
  on a device. Two rspeedy entries: `main` (the demo) and a
  tiny separate `nested` page that its `<frame>` section embeds — its own
  bundle, not `main`, so it can never recurse into itself. Confirmed live:
  `<svg>`'s `content` updates and re-fires `(load)` on tap; `<frame>` mounts a
  real nested `<lynx-view>` running the `nested` bundle independently (its own
  ticking counter proves it, not a static snapshot); every other element
  mounts without crashing and fires no console errors.
