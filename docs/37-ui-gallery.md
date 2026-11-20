# UI gallery — `@lynx-js/lynx-ui` patterns

`examples/ui-gallery` recreates six patterns from
[`@lynx-js/lynx-ui`](https://lynxjs.org/next/ui/components/) for ng-lynx:
Draggable, Swiper, Sheet, SwipeAction, Sortable, FeedList.

`@lynx-js/lynx-ui` is a **React** component library — every one of these is a
headless React component built on Lynx's native gesture system and
main-thread transforms, with no corresponding built-in `<tag>`. There's
nothing to "port": this gallery reimplements the *interaction pattern* each
component demonstrates, as plain Angular components using primitives
ng-lynx already has: signals, typed touch events, and Main-Thread worklets and
refs for the drags.

Run it: `cd examples/ui-gallery && npm run dev`.

## Shared design decisions

**The drags run on the Main Thread.** Draggable, Swiper, Sheet, SwipeAction and
Sortable bind their touch events to worklets (`[lynxMainThread]`, with
`bindWorklet` params), each demo's in a `.mt.ts` file listed in
`mainThreadModules`. The worklets move elements with `setStyleProperty` and
animate snaps with `lynxTween`, so a drag never waits for the Background
Thread, however busy it is. Angular hears only results, through a
`backgroundFunction`: the box's position for Draggable's label, the page for
Swiper's dots, "close" for Sheet, the new order for Sortable. This is the
pattern of [`examples/product-detail`](../examples/product-detail), from the
official tutorial; see [11 — Worklets](11-worklets.md).

The demos used to send every `touchmove` to the Background Thread, update a
signal there, and send the new `transform` back: a round trip per move, which
showed on real phones.

**Angular never binds what a worklet moves.** A `[style.transform]` binding
and a worklet writing the same property fight: a late Background render puts
the element back mid-drag. So the moving elements have no transform binding,
except Sortable's items: their binding is the slot from the last drop, which
the worklets have already set when it lands, so it writes the same value.

**Touch-driven, not gesture-detector-driven.** The real components drive
dragging through Lynx's native gesture detector (`[lynxGesture]`), which fires on
a device only (see [32 — Gestures](32-gestures.md)). These use touch events,
which work the same in the web preview. Synthetic mouse drags from browser
automation don't reach Lynx's touch pipeline, so the drags themselves are
checked on the simulator and emulator.

**Touch worklets bind to a static element, and use page coordinates.** Each
demo binds its worklets to an element that doesn't move (Draggable's field,
Swiper's viewport, SwipeAction's row, Sortable's handle, Sheet's handle row) and
reads `touches[0].clientX`/`clientY`. Only deltas matter, so every reading is in
one frame.

**The page stops scrolling under a drag, from the Main Thread.** A native
`<scroll-view>` recognizes its own pan, so neither `catch` events nor
`pan-intercept-*` kept the page still on a real iPhone. The app binds a
`mainThreadRef` to its `<scroll-view>` (`page-lock.ts`), and each drag's
`touchstart` worklet sets its `enable-scroll` to false, with a counter, until
`touchend` or `touchcancel`. That happens on the touch that starts the drag;
the old version switched `[enable-scroll]` through a signal, a round trip later.

**No measured pixel sizes.** `ShadowElement.fields({ size: true })` throws
`TypeError: nativeApp.getFields is not a function` on the web preview (see
[10 — Element queries](10-element-queries.md)), so:

- **Swiper** keeps its position in pages and writes it as a percentage:
  `translateX(-150%)` is halfway between the second and third slide. Each slide
  is `flex-shrink: 0; width: 100%`, so the track stays one viewport wide and a
  percentage of it is a percentage of the viewport. Only turning the finger's
  pixels into pages needs the width, which `(layoutchange)` gives as a
  `bindWorklet` param.
- **Draggable** clamps vertically against `.draggable-field`'s fixed CSS height,
  and not horizontally: the field stretches with the screen, and its
  `overflow: hidden` clips a box dragged past the edge.
- **Sortable** places its items absolutely, in slots of its fixed item height.

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
| **Draggable** | Free-form drag within a bounding field | The worklets move the box and, with "Reset on release" on, tween it back. The label hears the position through a `backgroundFunction`. |
| **Swiper** | Paged carousel with drag + pagination dots | The worklets drag and snap the track (`lynxTween`) and report the page, for the dots. A dot or autoplay calls `runOnMainThread(swiperGoTo)`, which waits for a drag to end. |
| **Sheet** | Bottom sheet with backdrop + drag-to-dismiss | `position: fixed` overlay (Lynx has no native `<dialog>`/portal — the same technique `LynxSelect`'s dropdown uses, [09 — Forms](09-forms.md)). A short drag springs back on the Main Thread; a long one calls `close()`. `(tap.self)` on the backdrop closes it too. |
| **SwipeAction** | Swipe a row to reveal a hidden action | A `<swipe-row>` component per row, for its own refs. Opening a row closes the open one on the Main Thread, through a `mainThreadRef` every row shares. |
| **Sortable** | Drag a handle to reorder a list | Items sit in absolute slots, so a reorder moves transforms, not elements. While the finger is down the worklets keep their own copy of the order; the items the dragged one passes step into their new slots. The new order reaches Angular on release. |
| **FeedList** | Scrolling feed with pull-to-refresh + load-more | No touch tracking at all — `<scroll-view>`'s native `scrolltoupper`/`scrolltolower` events (already typed on `LynxScrollView`) directly give "reached the top" / "reached the bottom". |

**Found on iOS: no `z-index` on Sortable's items.** Raising the dragged item
with `z-index`, so it passes over the others, drew it about 20px to the left
and far from its slot on the iOS simulator (Explorer 4.2): an absolutely
placed element with a `z-index` seemed to be laid out against another parent.
The dragged item is dimmed instead, and the items it passes step aside at the
halfway point.

## A zoneless change-detection gotcha found along the way

`computed()` only reacts to **signal reads** inside its function body —
reading a plain mutable class field doesn't register a dependency, so
updating that field later won't invalidate the computed; the template keeps
showing its first cached value (until some *other* tracked signal happens to
force a re-evaluation, which can mask the bug by coincidentally re-reading
the field's now-current value). This bit both the first, Background-Thread versions of `SortableDemoComponent`
(`draggingId`/`visualOffset` were plain fields read directly in the
template) and `SwiperDemoComponent` (`viewportWidth` was a plain field read
inside a `computed()`) during development — fixed by converting both to
`signal()`. Worth knowing generally: any state read *inside* a `computed()`
or effect must be a signal, not a plain field, or the reactive graph simply
won't see it change.
