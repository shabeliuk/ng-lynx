# Imperative element access (selector queries)

Sometimes you need to reach a native element directly — measure its size, scroll
it into view, or push a property without a re-render. Lynx exposes this through
`lynx.createSelectorQuery()`. ng-lynx surfaces it on the element you already
have: `ElementRef.nativeElement` **is** a Lynx element (`ShadowElement`), so a
template ref gives you the query methods.

See the verification in `verify/harness-query.ts` (`npm run verify:query`).

## Usage

```ts
import { Component, ViewChild, ElementRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { asLynxElement } from 'ng-lynx';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view #box class="box"></view>
    <view (tap)="measure()"><text>Measure</text></view>
  `,
})
export class AppComponent {
  @ViewChild('box') boxRef!: ElementRef;

  measure(): void {
    asLynxElement(this.boxRef.nativeElement).fields(
      { size: true, rect: true },
      (data) => console.log('box size', data),
    );
  }
}
```

`asLynxElement(...)` is just a typed cast (Angular types `nativeElement` as
`any`); it returns the `ShadowElement` so the query methods are visible.

> **⚠️ Web-preview limitation.** `fields(...)` throws `TypeError:
> nativeApp.getFields is not a function` on the **web preview**: `@lynx-js/web-core`
> (checked up to 0.26.6) has no `getFields`. Catch the exception (or avoid the
> read) if the same component needs to render in the web preview — see `examples/ui-gallery/src/components/swiper-demo.component.ts` and
> `draggable-demo.component.ts` for two worked examples (a CSS `calc()`
> percentage transform instead of a measured pixel width, and dropping a
> clamp that can't be computed instead of guessing at it).

> **⚠️ It wasn't usable on iOS either.** Running `examples/ng-forms` on an iOS
> simulator (Explorer on engine 3.7; the same on 4.2, re-measured 2026-11-10),
> `select().fields({ size: true })` came back **empty**. The query
> itself executes — the native log shows `LYNX App get -> getFields` resolving
> the selector (`SelectNode: [ng-ref-80]`) — and asking for
> `{ rect, size, id, dataset }` returns `{ id, dataset }`, so the pipeline is
> healthy and **`size`/`rect` are specifically unimplemented**. Re-measuring
> after layout returns the same, so it isn't a first-paint timing race.
>
> **So `fields()` cannot measure anything on either target available here.**
> That silently broke `LynxSlider`, which guarded on `trackWidth > 0`: the
> guard never opened and dragging did nothing at all, with no error.

## ✅ To measure an element, use `invoke('boundingClientRect')`

`invoke({ method: 'boundingClientRect' })` **is** implemented where
`fields({ size })` is not, and on the native engine it returns a true layout
rect:

```ts
asLynxElement(this.boxRef.nativeElement).invoke({
  method: 'boundingClientRect',
  params: {},
  success: (res) => {
    const { left, top, width, height } = res as Record<string, number>;
  },
  fail: () => {
    /* engine without this UI method — keep any previous measurement */
  },
});
```

Measured on both targets (iOS Explorer on engines 3.7 and 4.2, web-core 0.21). On 4.2,
`fields({ size: true, rect: true, id: true })` on a 123×45 box returned only `{ id }`, and
`boundingClientRect` returned its true rect:

| | `fields({size:true})` | `invoke('boundingClientRect')` |
| --- | --- | --- |
| Web preview | throws `getFields is not a function` | returns a **style-derived** rect — a layout-sized (`flex: 1`) element reports `width: 0` |
| iOS | resolves, returns empty | returns a **true layout rect** ✅ |

Two practical consequences:

- **Treat a measurement as optional, not guaranteed.** Keep the last good
  value rather than zeroing it on a failed read, so one bad measurement can't
  kill an in-flight gesture.
- **In the web preview, only an explicitly-sized element measures correctly.**
  If a component must work there, either give it an explicit CSS `width` or
  design so no size read is required at all — the two `ui-gallery` demos above
  do the latter deliberately, which is why they worked on-device first try.

`LynxSlider` now uses `invoke('boundingClientRect')` and works on device; see
[09 — Forms](09-forms.md#measuring-the-track--why-fields-isnt-used) for the
full write-up, including the touch-coordinate details that go with it.

## Methods

All target the element by its unique `[ng-ref-{id}]` attribute (set on the Main
Thread at creation) and deliver results asynchronously via callbacks.

| Method | Use |
| --- | --- |
| `fields(fields, cb)` | Read layout/info (`{ size, rect, scrollOffset, … }`). |
| `invoke({ method, params?, success?, fail? })` | Call a native UI method (e.g. `scrollIntoView`, `focus`, `autoScroll`). |
| `setNativeProps(props)` | Set native props imperatively, bypassing a render. |
| `path(cb)` | Query the path from this element up to the page root. |

`path()` is verified alongside the other platform-API wrappers in
`npm run verify:platform` — see [29 — Platform APIs](29-platform-apis.md).

### Typed `invoke()`

Give `asLynxElement` the element's tag, and `invoke()` accepts only that
element's methods, each with its own `params` and `success` result:

```ts
asLynxElement<'video'>(this.video().nativeElement).invoke({ method: 'seek', params: { position: 5 } });

asLynxElement<'scroll-view'>(this.scroller().nativeElement).invoke({
  method: 'scrollTo',
  params: { offset: 120, smooth: true },
  success: () => this.status.set('scrolled'),
});
```

A misspelt method or a wrong param type is a compile error. The map comes from
`@lynx-js/types` (a dependency), so it tracks the engine: `video`,
`scroll-view`, `list`, `input`, `textarea`, `text`, `image`, `refresh`,
`viewpager`, `scroll-coordinator`, `webview` and `markdown`. Without a tag,
`asLynxElement(el).invoke(...)` takes any method, as before.

One correction to the upstream types: `<list>`'s `scrollToPosition` accepts
`position` as well as `index`. The types only list `index`, but iOS's light
list reads `position` and ignores `index`; `position` works on every list.

`npm run verify:invoke-types` checks both: the valid calls compile, and the
wrong ones don't.

## The page root and an event's target — `lynxSelectRoot`, `lynxSelectUniqueID`

Two single-node queries for elements you don't hold an `ElementRef` to. Each
returns `fields` / `invoke` / `setNativeProps` / `path`:

```ts
import { lynxSelectRoot, lynxSelectUniqueID } from 'ng-lynx';

// The <page> itself: page-wide effects.
lynxSelectRoot().setNativeProps({ filter: 'grayscale(100%)' });

// The exact child a tap landed on, from a handler on its parent.
onRowTap(event: LynxTouchEvent): void {
  lynxSelectUniqueID(event.target.uid).setNativeProps({ 'background-color': 'red' });
}
```

Both ran on the iOS simulator (Explorer 4.2, 2026-11-09) in the device-tests
`platform` flow.

## Opting out — `enableSelectorQueries: false`

The `[ng-ref-{id}]` attribute every method above targets costs one extra
native `__SetAttribute` call per element on the Main Thread (set in
`ops-apply.ts`'s `CREATE` handler) — not a wire-protocol cost, since it's
never a Background-Thread-emitted op. An app that provably never calls
`fields`/`invoke`/`setNativeProps`/`path`/`lynxSelectAll` anywhere can skip
that call entirely:

```ts
// lynx.config.ts
pluginAngularLynx({ enableSelectorQueries: false });
```

With it off, **no element in the tree carries an `ng-ref-{id}` attribute at
all** — every selector query silently matches nothing (the callback simply
never fires, no error) once this is set, so it's a footgun for any component
that does use one, including ones imported from elsewhere in your dependency
tree. Everything unrelated to selector queries — rendering, classes, styles,
events — is completely unaffected. Verified by
`npm run verify:selector-opt-out` (builds with `ENABLE_SELECTOR_QUERIES=false`
and asserts both: no `ng-ref-` attribute anywhere, and normal rendering/
`(tap)`-driven updates still work identically).

## Deferring per-element — `enableSelectorQueries: 'lazy'`

A middle ground between `true` (every element pays the native call) and
`false` (no element ever can be queried): with `'lazy'`, `CREATE` skips the
native call entirely, and an element only gets its `ng-ref-{id}` attribute
the **first time it's actually queried** — worthwhile for a tree where most
elements are never queried but a few (e.g. one measured slider track) are.

```ts
// lynx.config.ts
pluginAngularLynx({ enableSelectorQueries: 'lazy' });
```

This used to be considered unimplementable: `fields`/`invoke`/
`setNativeProps`/`path` call `lynx.createSelectorQuery()` **directly and
synchronously** on the Background Thread — a channel entirely separate from
the buffered ops/flush pipeline the attribute itself would need to travel
over, so nothing guaranteed the attribute would land on the Main Thread
*before* that synchronous call ran. It's implementable now because the
ordering can be made explicit rather than assumed: `shadow-element.ts`'s
`ShadowElement.runQuery()` emits the attribute as an ordinary `SET_ATTR` op
(instead of a native call), flushes it, and defers the real
`createSelectorQuery()` call until `whenFlushed()` resolves — which only
happens once the Main Thread has actually applied that batch (see
[03 — Renderer internals](03-renderer-internals.md)'s `whenFlushed()`
section), so by the time the query runs the attribute is guaranteed present,
not just likely present. A second query on the same element skips straight to
the real call — no repeat round-trip — so an element queried repeatedly (e.g.
`setNativeProps` on every touch-move) only ever pays this once, on its first
query. `lynxSelectAll(...)` is unaffected by any of the three modes — it
resolves an arbitrary CSS selector against the whole tree, not `ng-ref-{id}`.

Trade-off: an element's *first* query now waits one extra Main-Thread
round-trip (a flush + ack) before it resolves, instead of firing immediately.
Verified by `npm run verify:selector-lazy` (`ENABLE_SELECTOR_QUERIES=lazy`):
no `ng-ref-` attribute exists before any query; the first query emits exactly
one `SET_ATTR(ng-ref-{id})` op, and the query itself only runs (and resolves
correctly) after that op has landed; a second query on the same element emits
no further `SET_ATTR`; rendering unrelated to selector queries — classes,
`(tap)`-driven updates — is unaffected.

## Querying many elements — `lynxSelectAll`

The methods above are **element-scoped** (each targets one element you already
hold). To batch-measure or batch-update **every** element matching a CSS
selector in one round-trip, use `lynxSelectAll(selector)` — Lynx's native
`selectorQuery.selectAll(...)`:

```ts
import { lynxSelectAll } from 'ng-lynx';

// Measure every .item at once — one query, one callback with an array.
lynxSelectAll('.item').fields({ size: true }, (rects) => {
  // rects: one { width, height, … } per matched .item, in document order
});
```

It returns a small query with `fields` / `invoke` / `setNativeProps` — the same
verbs as the single-element handle, but `fields`' callback receives an
**array** (one entry per match). Class/tag selectors resolve on the native
engine with `enableCSSSelector` on (the examples set it). Reach for this when
`@ViewChildren` gives you the Angular refs but you need native layout for all
of them together; for a single element, the `ShadowElement` methods above are
simpler.

> **⚠️ Web-preview limitation.** `lynxSelectAll(...)` is
> wired correctly and verified headlessly (`npm run verify:query`), but on the
> **web preview** its `.fields(...)` throws
> `TypeError: nativeApp.getFields is not a function` — the same `getFields`
> gap called out above for the single-element case, since both go through the
> identical `nativeApp.getFields(...)` call internally (see the callout right
> after "Usage"). `setNativeProps` on a multi-select (a write, no read-back)
> is unaffected, and `invoke()` on a multi-select is separately rejected by
> web-core.

## ⚠️ Initializer APIs need AOT

The Angular *AOT* compiler (`ngtsc`) is what transforms **initializer-based
APIs** — `viewChild()`, `contentChild()`, `input()`, `model()`, `output()`. So:

- **AOT build** (the default): they work — use them freely.
- **JIT build** (`pluginAngularLynx({ aot: false })`): they're **not** wired up (a
  `viewChild()` query silently never resolves → `NG0951`). Use the **decorator**
  forms instead:

| JIT-safe (works in both modes) | Needs AOT |
| --- | --- |
| `@ViewChild('box') box!: ElementRef;` | `box = viewChild<ElementRef>('box');` |
| `@Input() value;` | `value = input<string>();` |
| `@Output() change = new EventEmitter();` | `change = output<…>();` |

The decorator forms work under **both** JIT and AOT, so they're the safe default
if you want to switch modes freely. Plain signals (`signal()`, `computed()`) are
runtime APIs and work everywhere. See [05 — Build integration](05-build-integration.md).
