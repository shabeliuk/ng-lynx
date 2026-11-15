# UI gallery — `@lynx-js/lynx-ui` patterns

`examples/ui-gallery` recreates six patterns from
[`@lynx-js/lynx-ui`](https://lynxjs.org/next/ui/components/) for ng-lynx:
Draggable, Swiper, Sheet, SwipeAction, Sortable, FeedList.

`@lynx-js/lynx-ui` is a **React** component library — every one of these is a
headless React component built on Lynx's native gesture system and
main-thread transforms, with no corresponding built-in `<tag>`. There's
nothing to "port": this gallery reimplements the *interaction pattern* each
component demonstrates, as plain Angular components using primitives
ng-lynx already has (signals, `computed()`, typed touch events, CSS
transforms/transitions).

Run it: `cd examples/ui-gallery && npm run dev`.

## Shared design decisions

**Touch-driven, not gesture-detector-driven.** The real components drive
dragging through Lynx's native gesture detector (`[lynxGesture]`), which fires on
a device only (see [32 — Gestures](32-gestures.md)). Every draggable demo here instead uses
plain `(touchstart)`/`(touchmove)`/`(touchend)` — Lynx's basic touch-event
catalog, which *is* implemented in the web preview — the same trade-off
`LynxSlider` makes (`runtime/src/slider.ts`). This means structure and logic
are testable in the web preview; a real drag itself still needs a device,
since synthetic mouse-drag from browser automation tooling doesn't reach
Lynx's touch pipeline (confirmed empirically — `left_click_drag` produces no
`touchstart`/`touchmove`/`touchend`, only real single-tap `(tap)` bindings via
`left_click` work reliably in this project's tooling).

**Touch listeners bind to the static container, not the moving element.**
`detail.x`/`detail.y` on a Lynx touch event are relative to whatever element
the listener is bound to. Binding to an element that's itself being
`translate()`d would report coordinates in a constantly-shifting frame, so
every demo binds its listener to a **static** ancestor (Draggable's field,
Swiper's viewport, SwipeAction's row, Sortable's handle) and tracks the drag
offset separately in component state.

**No measured pixel sizes.** The natural design for Draggable/Swiper reads a
container's pixel size via `ShadowElement.fields({ size: true })` to clamp a
drag or compute a `translateX`. Found live while building this gallery:
`fields()` throws `TypeError: nativeApp.getFields is not a function` on the
web preview (see [10 — Element queries](10-element-queries.md)). Rather than depend on a read that can't
work here:

- **Swiper** expresses its base (non-dragging) position as a CSS
  **percentage** instead of a measured pixel width — each slide is
  `flex-shrink: 0; width: 100%` so the track's own border-box stays exactly
  one viewport-width regardless of slide count, and `transform: translateX()`
  percentages resolve against that box, so `-100% * activeIndex` lands on the
  right slide with zero JS measurement. `calc()` combines that percentage
  base with the live pixel drag offset in one `transform`.
- **Draggable** clamps vertically against `.draggable-field`'s CSS height
  (a fixed constant, so no measurement is needed) and drops horizontal
  clamping entirely — the field's width isn't a fixed constant (it stretches
  to the card's content width), so instead of guessing at it, the field has
  `overflow: hidden` and simply clips a box dragged past the true edge.

This also led to a real ng-lynx bug fix: chasing why `fields()`'s
callback never fired surfaced that `whenFlushed()` could hang forever when
two ops batches overlapped (a single shared resolver got clobbered by a
later batch) — fixed in `runtime/src/flush.ts`, see
[03 — Renderer internals](03-renderer-internals.md) and
`verify/harness-flush-race.ts`. That fix is unrelated to the `getFields` gap
above (which no fix on the ng-lynx side can work around) but was found
in the course of debugging it.

## The six components

| Component | Pattern demonstrated | Notes |
| --- | --- | --- |
| **Draggable** | Free-form drag within a bounding field | `translate()` tracks a signal-held `(tx, ty)`; see the clamping note above. |
| **Swiper** | Paged carousel with drag + pagination dots | CSS `calc()` transform (see above); `transition` toggles off during an active drag so it tracks the finger 1:1, and back on for the release-snap. |
| **Sheet** | Bottom sheet with backdrop + drag-to-dismiss | `position: fixed` overlay (Lynx has no native `<dialog>`/portal — the same technique `LynxSelect`'s dropdown uses, [09 — Forms](09-forms.md)); `(tap.self)` on the backdrop closes it. |
| **SwipeAction** | Swipe a row to reveal a hidden action | Each row is a `displayArea` stacked over an `actionArea`; opening one row closes any other (the common swipe-list convention). |
| **Sortable** | Drag a handle to reorder a list | Recomputes the desired index from scratch on every move (`startIndex + round(totalDy / itemHeight)`), reordering the backing array in discrete item-height steps while the dragged item's visual offset absorbs the remainder. |
| **FeedList** | Scrolling feed with pull-to-refresh + load-more | No touch tracking at all — `<scroll-view>`'s native `scrolltoupper`/`scrolltolower` events (already typed on `LynxScrollView`) directly give "reached the top" / "reached the bottom". |

## A zoneless change-detection gotcha found along the way

`computed()` only reacts to **signal reads** inside its function body —
reading a plain mutable class field doesn't register a dependency, so
updating that field later won't invalidate the computed; the template keeps
showing its first cached value (until some *other* tracked signal happens to
force a re-evaluation, which can mask the bug by coincidentally re-reading
the field's now-current value). This bit both `SortableDemoComponent`
(`draggingId`/`visualOffset` were plain fields read directly in the
template) and `SwiperDemoComponent` (`viewportWidth` was a plain field read
inside a `computed()`) during development — fixed by converting both to
`signal()`. Worth knowing generally: any state read *inside* a `computed()`
or effect must be a signal, not a plain field, or the reactive graph simply
won't see it change.
