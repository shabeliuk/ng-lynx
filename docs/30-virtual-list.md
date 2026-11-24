# Virtual lists — `LynxLazyFor` and `LynxVirtualFor`

Native `<list>` virtualizes Main-Thread elements, but a plain `@for` over a huge array still builds a Background-Thread
shadow node — and, reading `main-thread/src/list-apply.ts` closely, a **real
native element** — for every row the moment Angular renders it, not just the
visible ones. For a 10,000-row list that's 10,000 live embedded views,
`ShadowElement`s, and Main-Thread elements at once, even though only ~20 are
ever on screen.

Two directives build only some of the rows:

- **`LynxLazyFor`** (experimental) tells the list about every row, and builds the
  ones the list asks for. Nothing to wire, and the list scrolls its whole length.
  Use it for new code.
- **`LynxVirtualFor`** builds a window that your `(scroll)` handler moves. The list
  only knows the built rows, so a fling stops at the window's edge. Below, from
  [its own section](#lynxvirtualfor-a-window-you-move) on.

## `LynxLazyFor`: the list asks for the rows

```html
<list list-type="single" [span-count]="1" scroll-orientation="vertical">
  <list-item *lynxLazyFor="let row of rows(); trackBy: trackById; estimatedSize: 48">
    <text>{{ row.name }}</text>
  </list-item>
</list>
```

```ts
import { LynxLazyFor } from 'ng-lynx';

@Component({ imports: [LynxLazyFor], … })
export class ContactsComponent {
  readonly rows = signal<Contact[]>([]);
  trackById = (_index: number, row: Contact): number => row.id;
}
```

That's all: no `(scroll)` handler, no `need-visible-item-info`, no tuning. The rows
are typed (`row` is a `Contact`), and the context has `index`, `count`, `first`,
`last`, `even` and `odd`, where `index` is the row's place in the whole array.

### Rules

1. **The rows are the list's only content.** Put `*lynxLazyFor` on the
   `<list-item>`, directly in the `<list>` (an `@if` around it is fine). Any other
   `<list-item>` in that list is never shown, and a dev build warns.
2. **Don't bind `[attr.item-key]`.** Each row's `item-key` is
   `String(trackBy(index, row))`, and the directive sets it. That key is how the
   Main Thread matches a built row to its place in the list, so it must be unique: a
   dev build warns about duplicates, which the native list rejects.
3. **Give `estimatedSize`.** The list places rows it hasn't built from their
   estimated size: a number for every row, or a function `(index, row) => number`.
   A row's own `[estimated-main-axis-size-px]`, once built, takes over from it.
4. **Give a `trackBy`.** The default is the index, which is only right for rows that
   never move: insert one at the top and every row's key changes.

### Inputs

| Input | Microsyntax | Default | Meaning |
| --- | --- | --- | --- |
| `lynxLazyForOf` | `of` | — (required) | The rows: an array or other iterable. |
| `lynxLazyForTrackBy` | `trackBy` | the index | Each row's identity, and its `item-key`. |
| `lynxLazyForEstimatedSize` | `estimatedSize` | none | `estimated-main-axis-size-px` for rows not built yet. |
| `lynxLazyForBuffer` | `buffer` | `20` | Rows kept built beyond those the list holds, on each side. |
| `lynxLazyForInitialCount` | `initialCount` | `20` | Rows built for the first frame, before the list has asked for any. |

`builtRange` (`{ start, end }`, end exclusive) says which rows are built right now:
useful for a status line or a test.

### How it works

1. **The list knows every row.** The directive sends every row's key and size to the
   Main Thread as one attribute on the `<list>` (`__ngLazyRows`), which the Main
   Thread keeps rather than setting. Its `update-list-info` then announces all of
   them, built or not, so the list's scroll extent is the whole array.
2. **A window of rows is built:** the first `initialCount`, so the first frame is
   filled in the same batch.
3. **The list asks for cells** with `componentAtIndex` as they come into view. A
   built row is matched to the cell by its `item-key` and handed over. A row that
   isn't built answers with `-1`, the engine's own "no cell", and the cell stays
   empty for now.
4. **The Main Thread reports what the list holds.** It counts a cell as held from
   `componentAtIndex` until `enqueueComponent` (the list letting go of it as it
   scrolls away), adds the cells it couldn't fill, and sends the Background
   Thread the range of rows they span, at most once per Main-Thread task.
5. **The window follows.** Once that range comes within half a buffer of the
   window's edge, the window becomes the range plus a buffer on each side: rows
   leaving it are destroyed, rows entering it are built, in one batch.
6. **The empty cells are filled.** When a row the list asked for arrives, the Main
   Thread sends an `updateAction` with `flush: true` for it, and the list asks for
   that cell again: the iOS collection list reloads a visible cell, and the C++ list
   container marks the cell dirty and binds it again (both read in the engine
   source). If the rows changed in the same batch, the refresh rides along as a
   remove and an insert instead, so no update has to say which positions it means.

A dropped row's slot stays in the list, so its element is taken off the list on the
Main Thread instead. If the list was still showing it (a race with the window
moving), the Main Thread asks for it back and refreshes the cell.

So the cost is bounded by what's on screen: about the cells the list holds plus two
buffers, built at a time, wherever you are in the list. What a fling can show is an
empty cell for a moment, until its row arrives, never a wall.

### The web preview

Web-core's list isn't virtualized: it asks for every announced cell at once and
never asks again, and it ignores `updateAction`. So in the web preview
`LynxLazyFor` builds every row, like `@for`. Keep huge lists to a device, or expect
the web preview to be slow with them.

### What's verified

`npm run verify:lazy-list` runs the real renderer and Main-Thread executor against
`virtualizingList` (in `testing/src/mock-papi.ts`), which imitates a native list that
virtualizes: it keeps every key it's told, asks only for the cells on screen, lets go
of the ones that leave, asks again for a cell an `updateAction` names, and records
what a device rejects (duplicate keys, an action with no `item-key` or `type`, an
update that names the wrong key). With 10,000 rows it checks that:

- the first batch builds 20 rows and announces 10,000, each with its key and size;
- a jump to row 5000 shows ten empty cells, moves the window to `[4990, 5020)`, and
  fills them;
- scrolling inside the window builds nothing, and the window stays at 30 rows;
- prepending a row and removing one on screen keep the list's keys equal to the
  data's, in order, with no empty cell;
- a fling to the end fills the last screen;
- the list asks for 43 distinct cells in all;
- removing the directive empties the list, adding it back fills it, and every
  list registry on the Main Thread is empty afterwards;
- the web preview builds every row.

Breaking the refresh, or ignoring `enqueueComponent`, fails it.

On a real engine, the device flow `lazy-list` opens 10,000 rows, flings six times,
jumps to row 5000, checks fewer than 100 rows are built, and scrolls back up past the
window's edge to row 4950. It passes on the iOS simulator and the Android emulator
(Explorer 4.2, 2026-11-24). At row 5000, 50 rows are built: the ten on screen, the
cells the list keeps ready around them, and the buffers. Explorer 4.2 runs the C++
list container on both platforms (its log says `enable_native_list=true`), so that's
the path the flow covers. The iOS collection list, which a host gets with the native
list turned off, is covered only by reading its source. Not yet run on a phone.

## `LynxVirtualFor`: a window you move

`LynxVirtualFor` is a windowed alternative to `@for` that keeps only a
`[start, end)` slice of the array materialized, and the app moves the slice. It was
the first answer to the cost above, before `LynxLazyFor`.

### Why it's windowed

The ideal fix would make `componentAtIndex` — the callback native `<list>`
calls when it needs a cell — create that row's element **on demand**, right
then. Reading `@lynx-js/react`'s actual list implementation
(`node_modules/@lynx-js/react/runtime/lib/snapshot/list/list.js`,
`componentAtChildCtx`) shows this is exactly what ReactLynx does:
`childCtx.ensureElements()` runs **synchronously, on the Main Thread**, using
render data (`childCtx`) that already lives there.

That's only possible because ReactLynx can run part of its rendering *on the
Main Thread* (Lepus / "Main Thread Script"). Angular cannot run on Lepus at
all (see [20 — First-screen snapshot](20-first-screen.md)) — there is no
Angular-produced data resident on the Main Thread that a synchronous callback
could materialize an element from. `componentAtIndex` can't build a row there and
then; `LynxLazyFor` answers with an empty cell and has the row built across the
threads, which the list allows because it can be told to ask again.

`LynxVirtualFor` instead keeps a **window** of rows materialized — sized around
whatever `<list>` reports as currently attached, plus a buffer — and the app shifts
that window as the user scrolls. The list is told only about the window, so
scrolling faster than the window can be told to follow (a hard fling, or simply
never wiring the range update) means the list can't scroll past whatever's
currently materialized — confirmed directly while building this (see "What's
verified" below).

### Usage

```html
<list list-type="single" [span-count]="1" scroll-orientation="vertical"
      [need-visible-item-info]="true" (scroll)="onScroll($event)">
  <ng-template
    lynxVirtualFor
    let-row
    #virtualRows="lynxVirtualFor"
    [lynxVirtualForOf]="items()"
    [lynxVirtualForTrackBy]="trackById"
    [lynxVirtualForInitialCount]="30"
    [lynxVirtualForBufferSize]="15"
  >
    <list-item [attr.item-key]="row.id" [estimated-main-axis-size-px]="48">
      <text>{{ row.name }}</text>
    </list-item>
  </ng-template>
</list>
```

```ts
@ViewChild('virtualRows') virtualRows!: LynxVirtualFor<Row>;

onScroll(event: LynxListScrollEvent): void {
  // The row is the cell's item-key (here the row id is its position), not its
  // `index`: `index` counts only the rendered <list-item>s.
  const rows = (event.detail.attachedCells ?? [])
    .filter((c) => c.itemKey != null && c.itemKey !== '')
    .map((c) => Number(c.itemKey));
  if (!rows.length) return;
  this.virtualRows.updateVisibleRange(Math.min(...rows), Math.max(...rows));
}
```

`attachedCells` is only in the payload with `[need-visible-item-info]="true"`
(off by default, on every platform). See below for what each platform sends.

`<ng-template>` needs an explicit `let-row` (there is no implicit `$implicit`
binding without one) — everything else reads like `*ngFor`. Align
`lynxVirtualForTrackBy` with `[attr.item-key]`, the same rule `@for` +
`<list>` already follows (see [08 — Lists](08-lists.md)).

#### Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `lynxVirtualForOf` | — (required) | The full backing array/iterable. |
| `lynxVirtualForTrackBy` | identity | `(index, item) => key` — align with `[attr.item-key]`. |
| `lynxVirtualForInitialCount` | `20` | Rows materialized before any real range is reported. |
| `lynxVirtualForBufferSize` | `10` | Extra rows kept on each side of the last reported visible range. |

#### `updateVisibleRange(start, end, options?)`

Call this from the parent `<list>`'s `(scroll)` handler with the rows the
current `attachedCells` cover (inclusive), read from each cell's `itemKey`. It's a no-op if the resulting window
(range ± buffer, clamped to the array) is unchanged from the current one.

`materializedRange` (a `{ start, end }` getter) reports the current window —
useful for a status readout or a test.

### What's verified

Headlessly (`npm run verify:virtual-for`, 12 assertions, all against the real
renderer + Main-Thread executor with only the PAPI mocked):

- the initial render materializes exactly `lynxVirtualForInitialCount` rows
  out of 1,000 — not 1,000 `CREATE` ops;
- `updateVisibleRange` shifting to a non-overlapping range destroys every row
  that left the window and creates every row that entered it, in the exact
  expected counts (including that `DESTROY` walks the whole per-row subtree —
  3 nodes per `<list-item>` here — not one op per row);
- a range shift that lands **inside** the current window creates nothing and
  only trims the edges — rows that stay materialized across a shift are
  **not** destroyed and recreated (the same trackBy-identity guarantee
  `<list>`'s own reorder handling already depends on);
- the window clamps to the array's bounds near the end;
- native `<list>`'s own `update-list-info`/`componentAtIndex` never gets
  asked about anything outside the current window (via the same `driveList`
  simulation `verify:list` uses).

Live, in `examples/virtual-list`'s web preview: the initial render genuinely
shows a bounded window (`materialized: [0, 30) — 30 of 5000 rows`, confirmed
on screen — not 5,000 real rows), and a real drag gesture does scroll the
list using native `<list>`'s own virtualization.

### The materialized edge is a scroll wall

The materialized content *is* the native `<list>`'s scrollable extent: it can't
scroll to a row that doesn't exist yet, so the window's leading edge stops a fling.
Measured on a real iPhone, a very fast fling pinned at row 1649, and scrolling back up
a little released the next chunk.

**Nothing asks for more rows while the list is pinned.** It isn't moving, so no `scroll`
event fires. Scrolling back fires one, which is the only reason that released it. On top
of that, `<list>` throttles `scroll` to one every 200 ms by default (`scroll-event-throttle`),
so a fling can reach the edge without a single useful event. New rows do reach a pinned
list: it extends and carries on without scrolling back.

`examples/virtual-list` does three things about it:

- **A runway ahead:** it keeps 250 extra rows in the direction of travel, while scrolling
  and at rest. A window that shrinks at rest and grows on the next event destroys and
  rebuilds those rows on every pause, even on a slow scroll: a real iPhone showed it
  flipping between `[0, 105)` and `[0, 355)`.
- **Growing before the edge:** `[lower-threshold-item-count]` and `[upper-threshold-item-count]`
  make `scrolltolower` and `scrolltoupper` fire with 100 rows to go, and they carry
  `attachedCells` too. With a tiny runway on an iOS simulator, this doubled how far each fling
  got. A 50 ms `scroll-event-throttle` made no difference.
- **Settling:** about 200 ms after scrolling stops, it asks for the same range around what's on
  screen and allows it to shrink. That trims what's behind, and extends the window from a pinned
  edge, so the next fling carries on.

**The window has to depend only on which rows are on screen.** Every change to it makes the native
list answer with events, so anything else in that calculation can feed back into itself:

- **Take the direction from the rows, never from `scrollTop`.** `scrollTop` counts only what's
  materialized above, so removing rows there lowers it while the same rows stay on screen. Read as
  scrolling up, that grew the window back, the next settle trimmed it, and on a real iPhone it flipped
  between two values forever with nobody touching the screen.
- **Pass `minChange` to `updateVisibleRange`.** `attachedCells` and `getVisibleCells` can disagree by a
  row, which is enough to flip the window on its own. With `minChange`, an edge stays put until it
  would move that many rows or reach the end of the array. Keep it smaller than the buffer.

`npm run verify:virtual-list-idle` runs the example against an imitation of those answers, and fails
if the window keeps changing once nobody is touching the list. On a real iPhone, the window no longer
flips and fast flings carry on.

Expect about 385 rows at rest, and over 300 as soon as the page loads, because the first
threshold event fires straight away. Tune `DIRECTIONAL_LOOKAHEAD_ROWS` to your own rows' cost.

It's still a ceiling: a fling faster than the window can follow stops at the edge and loses its
momentum, though the next one continues. The complete fix is for `<list>` to know the full row
count while `componentAtIndex` answers with no cell for rows that aren't materialized: that's
[`LynxLazyFor`](#lynxlazyfor-the-list-asks-for-the-rows).

### `attachedCells` needs `need-visible-item-info` — resolved on device

This section previously recorded an open question: whether `(scroll)`'s
`attachedCells` fires from a *synthetic* drag in the headless browser tool (it
didn't), and guessed that was a tooling gap rather than a real defect. **A real
device pass settled it, and the guess was wrong.**

Run on an iOS simulator (Lynx Explorer, real touch input), the list scrolled
and then **hard-stopped at row 29** — it could not move past the initially
materialized window, silently, with no error. Probing the live event object
showed why:

```
detail keys = [scrollLeft, scrollTop, scrollWidth, scrollHeight,
               listWidth, listHeight, deltaX, deltaY, eventSource]
attachedCells = (absent)
```

`(scroll)` fires correctly and *does* reach the Angular handler — the native
log confirms dispatch, and sibling events (`scrolltolower`/`scrolltoupper`)
drive their handlers fine. But the `scroll` payload had **no `attachedCells`
field at all**, on Android as well (Explorer 4.1). So the obvious
implementation — read `attachedCells`, map to indices — bailed at
`if (!cells?.length) return;` on every event and never shifted the window.

**Why: `attachedCells` is opt-in.** Lynx's `<list>` reference documents
`need-visible-item-info` (boolean, default `false`): only with it do
`scroll`, `scrolltoupper` and `scrolltolower` carry `attachedCells`. The web
preview gates it the same way (`@lynx-js/web-elements` 0.12). With
`[need-visible-item-info]="true"`, measured on Explorer 4.1 (Android emulator
and iOS simulator), every `scroll` carries it, and each cell has `itemKey`,
`index`, `top`/`bottom`/`left`/`right` and `position`. Three details matter
for windowing:

- **Read the row from `itemKey`, not `index`.** `index` counts the
  `<list-item>`s the list holds. Once the window has slid, the list's first
  item is no longer row 0: with the window starting at row 60, row 125 came
  back as `index: 65` (Android).
- **The web preview has no `itemKey`.** ng-lynx sends item keys to the
  list in its `update-list-info`, not as attributes, and the web list reads
  them from attributes. So there the cells carry only `index`, and the demo's
  window stays at its first 30 rows, as it always has in the web preview.
- **Android's `getVisibleCells` has no identity.** It answers with a bare
  array whose cells carry geometry only (`itemKey: null`, `index: -1`). The
  demo's settle pass falls back to the last `scroll` event's cells there.

**Keep a geometry fallback too.** `scrollTop` + `listHeight` are in every
native payload:

```ts
first = Math.floor(scrollTop / ROW_HEIGHT);
last  = Math.ceil((scrollTop + listHeight) / ROW_HEIGHT);
```

One trap worth naming, because it looks right and isn't: **don't derive row
height from `scrollHeight / itemCount`.** On a virtualized list `scrollHeight`
covers only the *materialized* content, not all 5,000 rows, so that
under-estimates row height → over-estimates the visible range → materializes
more rows → grows `scrollHeight` again. Measured on device, that feedback loop
ratcheted the window from 30 up to 146 rows and climbing — quietly destroying
the bounded-window property the whole directive exists for. Use the row height
you already declare to `estimated-main-axis-size-px`.

With that fix, on-device behaviour is what the design intends: scrolling to
row ~58 reports `materialized: [12, 59) — 47 of 5000 rows` — the window
**slides** rather than growing, and stays bounded. With
`need-visible-item-info` and `itemKey` (Explorer 4.2, iOS simulator), the window
settles at about 385 rows, e.g. `[97, 482)` with row 157 at the top, and follows
flings back up to row 0 without gaps. See `examples/virtual-list/src/app.component.ts`.
