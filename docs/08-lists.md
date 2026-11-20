# Lists (`<list>`)

Lynx's `<list>` is a **virtualized** scroller — it only materialises the cells
near the viewport. That makes it the right tool for long, scrollable content, but
it has a different contract from a plain `<view>` full of children. ng-lynx
bridges Angular's `@for` to that contract.

See the runnable example in [`examples/list`](../examples/list) and the
verification in `verify/harness-list.ts` (`npm run verify:list`) and
`verify/harness-list-scroll.ts` (`npm run verify:list-scroll`).

## Usage

```html
<list list-type="single" span-count="1" scroll-orientation="vertical">
  @for (c of contacts(); track c.id) {
    <list-item [attr.item-key]="c.id" estimated-main-axis-size-px="64">
      <text>{{ c.name }}</text>
    </list-item>
  }
</list>
```

### Rules

1. **Direct children of `<list>` must be `<list-item>` elements.** Angular's
   `@for` also emits comment anchor nodes between items; the renderer
   never sends comments to the Main Thread, skips text children of a `<list>`
   too, and resolves insert anchors forward to the next real `<list-item>`, so
   you don't have to think about them. But your own markup must put `<list-item>` directly under
   `<list>`.
2. **Every `<list-item>` needs a stable `item-key`.** Bind it with
   `[attr.item-key]="…"`. Keep it aligned with your `@for` `track` expression.
3. **`<list>` config** (`list-type`, `span-count`, `scroll-orientation`, …) are
   normal attributes on the `<list>` element.
4. **Give the list a size.** Like any scroller it needs bounds (e.g.
   `flex: 1`) to scroll.

### Platform-info attributes

These attributes describe a cell's placement/recycling and are handled specially
(see below) — set them on the `<list-item>`:

`item-key`, `estimated-main-axis-size-px`, `estimated-height-px`,
`estimated-height`, `reuse-identifier`, `full-span`, `sticky-top`,
`sticky-bottom`, `recyclable`.

## How it works

A `<list>` is **not** built by appending children. On the Main Thread it is
created with `__CreateList(...)` and a set of callbacks. The native runtime calls
`componentAtIndex(list, listID, cellIndex, operationID)` only when it needs a
cell on screen.

So ng-lynx does this:

1. **Renderer (BG thread)** — when Angular inserts a `<list-item>` into a
   `<list>`, the item is recorded in the shadow tree and an `INSERT` op is sent,
   but comment/text anchors from `@for` are filtered out
   ([renderer.ts](../packages/ng-lynx/runtime/src/renderer.ts), `emitInsert`).
2. **Main Thread** — `INSERT` into a list parent doesn't `__AppendElement`;
   instead the item is **collected**
   ([list-apply.ts](../packages/ng-lynx/main-thread/src/list-apply.ts),
   `insertListItem`). Platform-info attributes are collected too, not applied via
   `__SetAttribute`.
3. **After each ops batch** — `flushListUpdates()` diffs the current item order
   against what was last announced and updates the native list through the
   `update-list-info` attribute (`{ insertAction, removeAction, updateAction }`),
   carrying each cell's `item-key` and platform info:
   - **Append** (the common infinite-scroll case) → a minimal `insertAction` for
     just the new tail items.
   - **Removal or reorder** → a minimal keyed diff, see below. **`removeAction`
     is an array of ascending plain position numbers** (`[0, 1, 2, …]`), *not*
     `{ position }` objects: the native list (and web-core) iterate it as
     `children[position - i]`, deleting as they go. Objects or descending order
     remove nothing, and the new item-keys collide with the old ones — the native
     list aborts with `duplicated list item-key` (error `2202` / `220208`).
4. **On demand** — when the list scrolls, native calls `componentAtIndex`, which
   returns the requested item element and flushes just that cell.

This mirrors ReactLynx's list handling; no new wire-protocol op
codes were needed — the Main Thread distinguishes a list by element type and a
platform-info attribute by name. The order-diff is verified by
`npm run verify:list` (add / remove / reverse).

## Reorder = minimal keyed diff

Removals and reorders use a **minimal keyed diff**, not a full resync: items whose relative
order is unchanged (the longest increasing subsequence of survivors by their new
index) are left untouched, and only the genuinely-moved items are removed from
their old slot and re-inserted at the new one. Removal of a key is a single
`removeAction` with no re-insert; append adds only the tail. This matters on a
device: re-inserting *every* cell with the same item-key (the old full-resync
approach) confused the native virtualizer on reorder — cells landed in the wrong
slots, leaving gaps or a single surviving row — even though web-core tolerated
it. The diff is verified by `npm run verify:list` and on web (reverse ×N + add /
remove, no drift).

**Item-keys are preserved across moves.** A reorder reaches the Main Thread as a
REMOVE + INSERT of the *same* element, and Angular does not re-emit an unchanged
`[attr.item-key]` on the re-insert. So the renderer **defers** dropping a cell's
item-key (and platform info) on REMOVE and cancels that on the matching INSERT —
otherwise a moved cell would fall back to `String(childBgId)`, silently changing
its key. A changed keyset is exactly what the native `<list>` cannot reconcile
(it sees every key as new), so without this the first reorder drops cells. Keep
your `[attr.item-key]` stable per item (e.g. a record id) — the renderer keeps it
stable across position changes for you.

## Scroll events & methods

`<list>`'s scroll events and imperative scroll methods need **no special
support** — they go through the same generic mechanisms every other event and
element method already use, so there's nothing ng-lynx-specific to learn
beyond the two patterns below. Verified by `npm run verify:list-scroll` and
demoed in `examples/list` (the "Scroll to top" button + status line).

**Events** — bind like any other event (`LynxRenderer2.listen()` doesn't
special-case event names):

```html
<list
  (scroll)="onScroll($event)"
  (scrolltolower)="onLower()"
  (scrolltoupper)="onUpper()"
>
```

| Event | Fires when |
| --- | --- |
| `scroll` | During scrolling. `$event.detail` has `scrollLeft`/`scrollTop`/`scrollWidth`/`scrollHeight`/`deltaX`/`deltaY`, plus `attachedCells` only with `[need-visible-item-info]="true"` (see [30 — Virtual lists](30-virtual-list.md)). |
| `scrolltolower` | Scrolled within `lower-threshold-item-count` items of the end — the usual infinite-scroll trigger. |
| `scrolltoupper` | Scrolled within `upper-threshold-item-count` items of the start. |
| `scrollstatechange` | Scroll state changes; `$event.detail.state` (1 stationary, 2 dragging, 3 decelerating, 4 animating). |
| `snap` | Before pagination scrolling settles. |

`scroll` is a recognized DOM event name, which trips a strict-template typing
gotcha — see [12 — Events](12-events.md#a-typing-gotcha-event-names-that-collide-with-the-dom).
`scrolltolower` / `scrolltoupper` / etc. aren't DOM event names, so they don't
have this problem.

**Methods** — call them through the same `invoke()` selector-query path as any
other imperative element method (see
[10 — Element queries](10-element-queries.md)); `<list>` gets an `ng-ref-{id}`
selector attribute like any other element, so no list-specific plumbing was
needed:

```ts
@ViewChild('listRef') listRef!: ElementRef;

scrollToTop(): void {
  asLynxElement(this.listRef.nativeElement).invoke({
    method: 'scrollToPosition',
    params: { position: 0, smooth: true },
  });
}
```

| Method | Params |
| --- | --- |
| `scrollToPosition` | `position` (index), optional `offset`, `alignTo` (`'top'`\|`'bottom'`\|`'middle'`), `itemKey`, `smooth` |
| `scrollBy` | `offset` (px) — returns consumed/unconsumed distance |
| `getVisibleCells` | none — returns the currently visible cells |
| `autoScroll` | `rate` (e.g. `'100px'`), `start`, `autoStop` |

## Current limitations

- **The `update-list-info` action shape** matches `@lynx-js/web-core`'s
  `update-list-info` handler — the harness's simulated native runtime mirrors it
  exactly, including the `removeAction` `position - i` semantics. This is what
  fixes the native `duplicated list item-key` error (`2202` / `220208`) on
  removal/reorder.
- **A plain `@for` over the full array still builds a real Main-Thread
  element for every row up front**, not just the visible ones — native
  `<list>` only virtualizes which elements get *attached*, not which get
  *created* (confirmed by reading `list-apply.ts`). For huge lists (10k+
  rows), use [`LynxVirtualFor`](30-virtual-list.md) instead, which windows
  both the Background-Thread and Main-Thread sides.
