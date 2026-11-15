# Visibility detection — exposure, IntersectionObserver, `@defer` triggers

Lynx has two visibility systems, and ng-lynx surfaces both — plus a
generic event-listener bridge that makes `@defer (on interaction)` work too.

## 1. Exposure events (works everywhere, incl. the web preview)

Give any element an `exposure-id` and it fires `uiappear` / `uidisappear` as
it enters / leaves the viewport — delivered as ordinary element events:

```ts
@Component({
  imports: [LYNX_ELEMENTS],
  template: `
    <view exposure-id="hero" (uiappear)="seen()" (uidisappear)="hidden()">…</view>
  `,
})
```

`uiappear` / `uidisappear` are typed on the element directives
([18 — Typed templates](18-typed-templates.md)); the payload carries
`exposure-id` / `exposure-scene`. App-wide **global** exposure events
(`exposure` / `disexposure`, batched) arrive on the GlobalEventEmitter — read
them via `LynxGlobalEvents` ([23 — App events](23-app-events.md)). Tune
detection with the `exposure-screen-margin-*` / `exposure-area` attributes.

`LynxExposure` (`resumeExposure()` / `stopExposure()`) is the app-wide toggle
for this same detection system — pause it during a heavy transition, then
resume it. See [29 — Platform APIs](29-platform-apis.md#lynxexposure--resumeexposure--stopexposure).

This path is backed by Lynx's exposure engine, which `@lynx-js/web-core`
implements — so it's **verified live on the web preview** (`examples/router`'s
home banner reports `uiappear fired: yes`).

## 2. `@defer (on viewport)` and `LynxIntersectionObserver`

Angular's `@defer (on viewport)` loads a block when its placeholder scrolls
into view. It's powered by the global `IntersectionObserver` constructor,
which Lynx's Background-Thread engine lacks — so the runtime installs a
polyfill over `lynx.createIntersectionObserver` at bundle start
(`installIntersectionObserver`, guarded). The trigger `ShadowElement` is
observed by `#id` (Lynx's observer finds targets by id only; see below), and
the polyfill maps Lynx's `{ isIntersecting, intersectionRatio }` callbacks to
DOM-shaped entries (with `target` identity preserved, which Angular requires).

```ts
@Component({
  template: `
    @defer (on viewport) { <expensive-thing /> }
    @placeholder { <view class="skeleton" /> }
  `,
})
```

For imperative use there's `LynxIntersectionObserver` — a DI wrapper over the
native API with its full fidelity (thresholds, element-relative roots) the DOM
shim can't express:

```ts
private readonly visibility = inject(LynxIntersectionObserver);
ngAfterViewInit() {
  this.visibility.observe(this.card().nativeElement, (e) => {
    if (e.isIntersecting) this.trackImpression();
  }, { thresholds: [0.5] });
}
```

Other `@defer` triggers need nothing extra: `on timer` uses `setTimeout`,
`on idle` falls back to `setTimeout` when `requestIdleCallback` is absent —
both **verified on the web preview**.

### Observed by id: why it didn't fire in the web preview

`@defer (on viewport)` and `LynxIntersectionObserver` sit on
`lynx.createIntersectionObserver`, and **its `observe()` finds the target by
`id` only**. Lynx's reference says so ("the target node is specified
according to `id`"), and `@lynx-js/web-core`'s implementation resolves `#id`
(or a numeric element id) and returns nothing for any other selector. The
runtime used to observe by the `[ng-ref-{id}]` attribute selector, which
`createSelectorQuery` handles fine. So the observer was created, observed
nothing, and the block stayed on its placeholder.

**Fixed:** the element is now observed through `ShadowElement.idSelector()`.
That gives it an `id` (`ng-io-{n}`) if the app hasn't set one, waits for the
Main Thread to apply it, then calls `observe('#…')`. An id you set yourself is
reused. Verified **live in the web preview**: `examples/router`'s Home page
has a `@defer (on viewport)` card below a tall spacer. It stays on "Waiting to
scroll into view" until scrolled to, then loads. `verify:defer` now asserts
the `#id` form and that the element carries the id; its mock accepts any
selector, which is how the old form passed there.

On-device it's the same API with the same id rule, and it works there too:
on Lynx Explorer 4.1 (iOS simulator), the same router card loads when
scrolled into view.

**Also covered headlessly:** the polyfill logic, the `@defer (on viewport)`
integration, and the `LynxIntersectionObserver` service, against a mock
observer (`npm run verify:defer`). The mock exercises the create →
`relativeToViewport` → `observe('#id', cb)` → callback chain and asserts
`target` identity, hydration, and disposal.

## 3. `@defer (on interaction)` — and why `on hover` stays unsupported

Angular's `on interaction` / `on hover` triggers don't go through `Renderer2`
at all — the compiled runtime (`@angular/core`'s `onInteraction`/`onHover`)
calls `trigger.addEventListener(name, …)` **directly on the trigger node**,
for a fixed set of DOM event names: `click`/`keydown` for interaction,
`mouseenter`/`mouseover`/`focusin` for hover. `ShadowElement` now implements
`addEventListener`/`removeEventListener` to satisfy that call — but what
those DOM names actually *do* depends entirely on whether Lynx has a matching
native event, and reading the trigger source made that concrete: **`click`
is the only one that does.**

```ts
@Component({
  template: `
    @defer (on interaction) { <expensive-thing /> }
    @placeholder { <view class="card">Tap to load</view> }
  `,
})
```

`ShadowElement.addEventListener('click', …)` maps to Lynx's own primary
interaction gesture, `tap` (`bindEvent 'tap'`, the same registration a
template `(tap)` binding produces — routed through the same shared
multiplexing table, `element-events.ts`, so a trigger that *also* has its own
`(tap)` handler doesn't clobber it). `keydown` has no Lynx equivalent (no
generic physical-keyboard event on a touch UI) and silently no-ops — which is
fine, since `on interaction` only needs *one* of its two events to fire.
Verified **live** in the web preview (`examples/router`'s Home page — the
"Tap to load" card) and headlessly (`npm run verify:defer`): tapping the
placeholder loads the deferred content.

`on hover`, though, has **no real Lynx equivalent for any of its three
events** — Lynx is a touchscreen-first engine with no mouse and no generic
keyboard-focus model for arbitrary elements (the one relevant native
signal, a `focus` event, exists only on `<input>`/`<textarea>`, a distinct
"gained text-input focus" semantic that would misrepresent "hover" if
force-mapped onto it for other elements). So `addEventListener` registers
**nothing** for `mouseenter`/`mouseover`/`focusin` — an `on hover` block
correctly stays on its placeholder forever on Lynx, verified headlessly
(`npm run verify:defer` asserts zero native listeners are registered for it).
This isn't a missing-plumbing gap to close later; it's a conceptual mismatch
with the platform, and the honest behavior is to do nothing rather than fake
a hover state that can't exist. Prefer `on interaction` (or `on viewport`)
for content you'd otherwise gate on hover.

## Verifying

`npm run verify:defer` covers: the IntersectionObserver polyfill unit
(observe/unobserve, `target` identity), `@defer (on viewport)` end-to-end
(placeholder → intersect → loaded), `@defer (on interaction)` end-to-end
(placeholder → tap → loaded, via the `click`→`tap` mapping), `@defer (on
hover)` (asserts zero native listeners registered — the intentional-no-op
path), `LynxIntersectionObserver` (thresholds, disposal), and exposure
`uiappear`/`uidisappear` driving zoneless CD. Exposure and `on interaction`
are additionally validated live in `examples/router` (the Home page's banner
and "Tap to load" card).
