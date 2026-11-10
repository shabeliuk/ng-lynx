import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  type OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';

import { asLynxElement, LynxVirtualFor } from 'angular-lynx';
import {
  LYNX_ELEMENTS,
  type LynxListScrollEvent,
  type LynxListScrollStateChangeEvent,
} from 'angular-lynx/elements';

interface Row {
  id: number;
  name: string;
}

const ROW_COUNT = 5000;
/** Row height in px — must match `estimated-main-axis-size-px` on the list-item below. */
const ROW_HEIGHT = 48;

/**
 * Extra rows materialized **ahead, in the direction of travel**, on top of
 * `lynxVirtualForBufferSize`.
 *
 * A native `<list>` can only scroll as far as the rows that actually exist —
 * materialized content *is* its scrollable extent. So the materialized edge
 * is a hard wall a fling cannot cross, and the symmetric
 * `lynxVirtualForBufferSize` (60) put that wall only ~60 rows past the last
 * visible row, while a single hard fling covers roughly 200. Measured on
 * device: the fling pinned at row 241. Pinned, the list doesn't move, so no
 * `scroll` event fires and nothing asks for more rows.
 *
 * 250 gives a hard fling room to land without hitting the wall. It's
 * deliberately asymmetric — extending only the way the finger is going —
 * so the cost is one fling's worth of rows, not two. They stay while the list
 * rests: settling once took them away, and then any gap between `scroll` events
 * destroyed 250 rows and the next event built them again, even on a slow scroll
 * (a real iPhone showed the window flipping between `[0, 105)` and `[0, 355)`).
 */
const DIRECTIONAL_LOOKAHEAD_ROWS = 250;

/**
 * `scrolltolower` and `scrolltoupper` fire when fewer than this many rows are
 * left, so the window can grow before a fling reaches its edge. `scroll` alone
 * isn't enough: the list throttles it to one every 200 ms. With a tiny runway on
 * an iOS simulator, this doubled how far each fling got. A 50 ms
 * `scroll-event-throttle` made no difference, so it stays at the default.
 */
const EDGE_THRESHOLD_ROWS = 100;

/**
 * How many rows the top of the screen has to move back before that counts as turning
 * around, so a wobble doesn't swap the runway to the other side.
 */
const DIRECTION_SLOP_ROWS = 3;

/**
 * An edge of the window moves only once it would move this far. `attachedCells` and
 * `getVisibleCells` can disagree by a row, and without this that alone flips the window.
 */
const WINDOW_SLACK_ROWS = 20;

type AttachedCell = { itemKey?: string | number | null };

/**
 * The first and last row on screen, from `attachedCells`. A cell's row is its
 * `item-key` (the row id), not its `index`: `index` counts the `<list-item>`s
 * the list holds, so once the window has slid away from row 0 it no longer
 * matches the row. The web preview reports no `itemKey` (item keys reach the
 * list in its update info, not as attributes), so there this finds nothing
 * and the window doesn't slide.
 */
function rowRange(cells: readonly AttachedCell[] | undefined): [number, number] | undefined {
  const rows = (cells ?? [])
    .map((c) => (c.itemKey == null || c.itemKey === '' ? NaN : Number(c.itemKey)))
    .filter((row) => Number.isInteger(row));
  return rows.length ? [Math.min(...rows), Math.max(...rows)] : undefined;
}

/**
 * `LynxVirtualFor` demo: 5,000 rows inside a `<list>`, but only a small
 * window around what's actually attached is ever materialized as real
 * Angular views / Main-Thread elements — the status line's "materialized"
 * count stays bounded near `initialCount`/`bufferSize` while scrolling
 * through all 5,000, never anywhere close to the full row count.
 *
 * `(scroll)`'s `$event.detail.attachedCells` is what native `<list>` reports
 * as currently on screen; `updateVisibleRange` re-centers the materialized
 * window around it. See docs/30-virtual-list.md for why this is windowed
 * rather than truly lazy (the trick ReactLynx's own list virtualization
 * uses needs Main-Thread Script, which Angular can't run).
 *
 * **A hard/fast fling on a real device got stuck at the initial 30 rows —
 * a real device finding, not reproducible via injected scrolling.** Slow,
 * finger-driven scrolling worked and kept advancing the window; a fast fling
 * did not move it at all. The `scroll` event firing densely enough to keep
 * `updateVisibleRange` current is an assumption this whole windowing scheme
 * depends on, and it doesn't hold under fast native momentum scrolling — most
 * likely the event simply doesn't dispatch across the bridge as often (or at
 * all) while the native side is driving a high-velocity fling, rather than
 * `updateVisibleRange` itself failing (its window math takes an arbitrary
 * `[start, end]` directly, with no assumption that consecutive calls are
 * close together — a single very-out-of-date call jumping straight from row 5
 * to row 800 would recenter correctly if it *fired* at all).
 *
 * Two changes address this, from different angles:
 * - `lynxVirtualForBufferSize` raised from 15 to 60: a bigger materialized
 *   window survives more scroll-event silence before the visible edge runs
 *   past materialized content into a gap.
 * - `(scrollstatechange)` (`state` 1 = stationary) triggers a correction
 *   pass: `invoke({ method: 'getVisibleCells' })` asks the native `<list>`
 *   directly for what's actually on screen *right now*, independent of
 *   whatever `scroll` events did or didn't arrive during the fling, and
 *   forces the window to catch up once scrolling settles — automating what
 *   was otherwise a manual "scroll slowly afterward and it catches up" fix.
 *
 * **That combination reached further, but introduced a *worse* symptom on a
 * real device: each successive fast fling reached a *shorter* distance than
 * the one before it** (182 → 160 → 152 across three flings). Root cause:
 * shrinking the window (removing off-screen `<list-item>`s) while the native
 * `<list>` is still actively flinging appears to interrupt the native
 * scroll-view's own momentum/position tracking — every `onScroll` call was
 * calling `updateVisibleRange` with its default shrink-and-replace behavior,
 * mid-gesture, on *every* scroll event that landed during a fling, not just
 * the final correction. First fix: gate `{ shrink: false }` (grow-only — see
 * `LynxVirtualFor.updateVisibleRange`'s doc comment) on `scrollstatechange`
 * reporting anything other than stationary, and only shrink once it reports
 * genuinely stationary.
 *
 * **That in turn produced a third symptom: rapid, back-to-back
 * scroll/scroll-back testing left the window growing without bound** — `[0,
 * 293)`, then `[0, 341)`, then `[0, 676)`, `windowStart` never moving off 0.
 * Root cause: gating shrink on `scrollstatechange` reporting state `1`
 * assumes that event reliably fires "stationary" between gestures, but rapid
 * back-to-back interaction apparently doesn't give it the chance to — so
 * shrink stayed permanently `false` and the window only ever grew. **Fixed
 * by not depending on `scrollstatechange`'s semantics for this at all**:
 * every `onScroll` is now unconditionally grow-only, and a **debounce timer**
 * (reset on every `scroll` event, firing 200ms after the *last* one) is what
 * triggers the shrink-and-replace correction — "scrolling has been quiet for
 * a bit" needs no interpretation of native state values, just the absence of
 * new events. `scrollstatechange`'s stationary state is kept as a second,
 * faster trigger for the same correction (harmless if it also fires — a
 * second identical correction is a no-op), not the sole one.
 *
 * That fixed the unbounded growth, and then exposed what all three earlier
 * symptoms were really masking: **the materialized edge is a hard wall the
 * native `<list>` cannot scroll past, because materialized content *is* its
 * scrollable extent.** Measured on device: a fling pinned at row 241 and
 * would not go further no matter how hard, until a scroll back up released the
 * next chunk (to 438), which then became the new wall. Pinned, the list doesn't
 * move, so no `scroll` event fires and nothing asks for more rows. Scrolling
 * back fires one, which is why that released it. With a symmetric
 * `lynxVirtualForBufferSize` of 60 the wall sat only ~60 rows past the last
 * visible row, while a single hard fling covers roughly 200 — so every fling
 * ended against it.
 *
 * The fix is {@link DIRECTIONAL_LOOKAHEAD_ROWS}: extend the window far ahead
 * *in the direction of travel* (250 rows, see `trackDirection()`), so
 * a fling has runway. Combined with the grow-only-while-scrolling rule above,
 * the window grows during a fling, and `correctWindow()` trims the rows left
 * behind ~200ms after scrolling stops. At rest it holds the buffer behind, what's
 * on screen, and the buffer and runway ahead: about 385 rows. A fling that does
 * reach the edge loses its momentum, but settling extends the window from there,
 * so the next one carries on without scrolling back.
 *
 * **This is a ceiling, not a cure.** Any background-thread windowing scheme
 * has it: you cannot scroll to a row that does not exist yet, so a fling
 * hard enough to cross 250 rows will still stop early. The architecturally
 * complete fix is for `<list>` to know the *full* row count while
 * `componentAtIndex` returns `undefined` for unmaterialized indices (already
 * a supported native behavior — see `LynxVirtualFor`'s module doc, which
 * describes exactly that as the intended gap-rendering path). That needs the
 * renderer's `update-list-info` to report the full count rather than the
 * materialized child count, which is a change well below this example.
 * Recorded as the real fix rather than pretending the lookahead is one.
 *
 * **Measured on Explorer 4.2** (iOS 26 simulator, injected flings, not a real
 * finger): at rest the window settles at about 385 rows, e.g. `[97, 482)` with
 * row 157 at the top, and it follows flings back up to row 0 without gaps.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, LynxVirtualFor],
  template: `
    <view class="app">
      <text class="title">LynxVirtualFor — {{ rowCount }} rows</text>
      <text class="status">
        materialized: [{{ windowStart() }}, {{ windowEnd() }}) — {{ materializedCount() }} of {{ rowCount }} rows
      </text>

      <list
        #listRef
        class="list"
        list-type="single"
        [span-count]="1"
        scroll-orientation="vertical"
        [need-visible-item-info]="true"
        [upper-threshold-item-count]="EDGE_THRESHOLD_ROWS"
        [lower-threshold-item-count]="EDGE_THRESHOLD_ROWS"
        (scroll)="onScroll($event)"
        (scrolltoupper)="onScroll($event)"
        (scrolltolower)="onScroll($event)"
        (scrollstatechange)="onScrollStateChange($event)"
      >
        <ng-template
          lynxVirtualFor
          let-row
          #virtualRows="lynxVirtualFor"
          [lynxVirtualForOf]="rows"
          [lynxVirtualForTrackBy]="trackById"
          [lynxVirtualForInitialCount]="30"
          [lynxVirtualForBufferSize]="60"
        >
          <list-item [attr.item-key]="row.id" [estimated-main-axis-size-px]="ROW_HEIGHT">
            <text class="row-label">#{{ row.id }} — {{ row.name }}</text>
          </list-item>
        </ng-template>
      </list>
    </view>
  `,
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('virtualRows') virtualRows!: LynxVirtualFor<Row>;
  @ViewChild('listRef') listRef!: ElementRef;

  readonly rowCount = ROW_COUNT;
  protected readonly ROW_HEIGHT = ROW_HEIGHT;
  protected readonly EDGE_THRESHOLD_ROWS = EDGE_THRESHOLD_ROWS;
  readonly rows: Row[] = Array.from({ length: ROW_COUNT }, (_, i) => ({
    id: i,
    name: `item ${i}`,
  }));

  readonly windowStart = signal(0);
  readonly windowEnd = signal(0);
  readonly materializedCount = computed(() => this.windowEnd() - this.windowStart());

  /** How long a gap in `scroll` events counts as "scrolling has stopped" — see the class doc comment. */
  private static readonly SETTLE_DEBOUNCE_MS = 200;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;

  /** Which way the list last travelled, which is where the runway goes. */
  private goingDown = true;

  /** The furthest the top of the screen got in that direction. */
  private furthestRow = 0;

  /** First and last row on screen at the last `scroll` event, from its `attachedCells`. */
  private lastRows: [number, number] | undefined;

  trackById = (_index: number, row: Row): number => row.id;

  ngOnDestroy(): void {
    clearTimeout(this.settleTimer);
  }

  ngAfterViewInit(): void {
    this.windowStart.set(this.virtualRows.materializedRange.start);
    this.windowEnd.set(this.virtualRows.materializedRange.end);
  }

  /**
   * Re-centre the materialized window on whatever is now on screen.
   *
   * **`attachedCells` is only there with `need-visible-item-info`.** Lynx
   * documents it as off by default, and without it a `scroll` payload carries
   * `scrollLeft, scrollTop, scrollWidth, scrollHeight, listWidth, listHeight,
   * deltaX, deltaY, eventSource` and nothing else (probed on an iOS simulator
   * and an Android emulator before the attribute was set here). The code then
   * hit `if (!cells?.length) return;` on *every* event and never shifted the
   * window: the list silently refused to scroll past its initial 30 rows, with
   * no error anywhere.
   *
   * So the template sets `[need-visible-item-info]="true"`, and the geometry
   * that's always present stays as the fallback: scroll offset over row height
   * gives the first visible index, and the viewport height gives how many
   * follow.
   *
   * Row height is the declared {@link ROW_HEIGHT}, **not** `scrollHeight /
   * rowCount`. That derivation is the tempting one and it's wrong here: on a
   * virtualized list `scrollHeight` describes only the *materialized* content,
   * not all 5,000 rows, so dividing by the full count under-estimates row
   * height, which over-estimates the visible range, which materializes more
   * rows, which grows `scrollHeight` again — a feedback loop. Measured on
   * device it ratcheted the window from 30 up to 146 rows and climbing,
   * quietly defeating the bounded-window property this example exists to show.
   */
  onScroll(event: LynxListScrollEvent): void {
    if (!this.virtualRows) return;

    const d = event.detail as unknown as { scrollTop?: number; listHeight?: number };
    const scrollTop = d.scrollTop ?? 0;

    let first: number;
    let last: number;
    const rows = rowRange(event.detail.attachedCells);
    if (rows) {
      this.lastRows = rows;
      [first, last] = rows;
    } else {
      // Guard against the pre-layout frame where the viewport is still 0-high.
      const listHeight = d.listHeight ?? 0;
      if (listHeight <= 0) return;
      first = Math.floor(scrollTop / ROW_HEIGHT);
      last = Math.ceil((scrollTop + listHeight) / ROW_HEIGHT);
    }

    this.trackDirection(first);
    this.applyRange(first, last, false);

    // Every `scroll` event pushes the correction back out — it only actually
    // runs once events stop arriving for SETTLE_DEBOUNCE_MS, i.e. scrolling
    // has genuinely gone quiet. See the class doc comment for why this
    // doesn't rely on `scrollstatechange` reporting stationary reliably.
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.correctWindow(), AppComponent.SETTLE_DEBOUNCE_MS);
  }

  /**
   * A second, faster trigger for the same correction as the debounce timer —
   * harmless if both fire for the same settle (the second call is a no-op:
   * `updateVisibleRange` only touches the DOM when the computed window
   * actually differs from the current one). `state === 1` is "stationary"
   * (docs/08-lists.md).
   */
  protected onScrollStateChange(event: LynxListScrollStateChangeEvent): void {
    if (event.detail.state === 1) this.correctWindow();
  }

  /**
   * Ask the native `<list>` directly for what's attached *right now* and
   * shrink-and-replace the window to match — safe here because scrolling has
   * (by construction of the two callers above) actually stopped, unlike
   * every `onScroll` call, which only ever grows.
   *
   * Android (Explorer 4.1) answers with a bare array of cells that carry
   * geometry only (`itemKey: null`, `index: -1`), so there the rows come from
   * the last `scroll` event's `attachedCells` instead. Without that fallback
   * the window never shrank on Android.
   */
  private correctWindow(): void {
    if (!this.virtualRows || !this.listRef) return;
    const settle = (rows: [number, number] | undefined) => {
      if (rows) this.applyRange(rows[0], rows[1], true);
    };
    asLynxElement(this.listRef.nativeElement).invoke({
      method: 'getVisibleCells',
      fail: () => settle(this.lastRows),
      success: (res) => {
        const cells = Array.isArray(res) ? res : (res as { attachedCells?: AttachedCell[] } | undefined)?.attachedCells;
        settle(rowRange(cells as AttachedCell[] | undefined) ?? this.lastRows);
      },
    });
  }

  /**
   * Which way the list is travelling, from the rows on screen. Not from `scrollTop`:
   * it counts only what's materialized above, so removing rows there lowers it while
   * the same rows stay on screen. Read as scrolling up, that grew the window back, the
   * next settle trimmed it, and it flipped between two values with nobody touching the
   * screen. The same rows now always give the same window, so nothing the list says
   * about our own changes can move it.
   */
  private trackDirection(first: number): void {
    const moved = first - this.furthestRow;
    if (this.goingDown ? moved > 0 : moved < 0) {
      this.furthestRow = first;
    } else if (Math.abs(moved) >= DIRECTION_SLOP_ROWS) {
      this.goingDown = !this.goingDown;
      this.furthestRow = first;
    }
  }

  /**
   * The window around the rows on screen, with the runway ahead in the direction
   * of travel — see DIRECTIONAL_LOOKAHEAD_ROWS. `updateVisibleRange` clamps to the
   * array bounds, so a negative start or an end past the last row is fine.
   *
   * `shrink` is only true from `correctWindow`: see the class doc comment for why
   * removing off-screen rows mid-gesture regressed how far a fling could travel.
   * Both ask for the same range, so settling only trims what's behind.
   */
  private applyRange(first: number, last: number, shrink: boolean): void {
    this.virtualRows.updateVisibleRange(
      this.goingDown ? first : first - DIRECTIONAL_LOOKAHEAD_ROWS,
      this.goingDown ? last + DIRECTIONAL_LOOKAHEAD_ROWS : last,
      { shrink, minChange: WINDOW_SLACK_ROWS },
    );
    this.windowStart.set(this.virtualRows.materializedRange.start);
    this.windowEnd.set(this.virtualRows.materializedRange.end);
  }
}
