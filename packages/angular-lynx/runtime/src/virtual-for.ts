/**
 * `LynxVirtualFor` — a windowed alternative to `@for` for huge lists inside
 * `<list>`.
 *
 * **Why this exists.** Native `<list>` is virtualized on the Main Thread —
 * `componentAtIndex(list, listID, cellIndex, …)` only *attaches* a cell when
 * it's needed — but that's not the whole cost. Reading `list-apply.ts`
 * (`insertListItem`) shows every `<list-item>` still gets a **real native
 * element created up front**, the moment Angular's `@for` instantiates that
 * row; `componentAtIndex` just `__AppendElement`s an element that already
 * exists. For 10k+ rows that means 10k live Angular embedded views, 10k
 * `ShadowElement`s, and 10k Main-Thread elements all at once, even though
 * only ~20 are ever on screen.
 *
 * **Why it can't lazily create the Main-Thread element on demand instead**
 * (which is how this package would ideally close the gap): reading
 * `@lynx-js/react`'s actual list implementation
 * (`runtime/lib/snapshot/list/list.js`) shows `componentAtIndex` there calls
 * `childCtx.ensureElements()` **synchronously, on the Main Thread**, using
 * render data that already lives there. That's only possible because
 * ReactLynx can run part of its rendering on the Main Thread (Lepus /
 * "Main Thread Script"). Angular cannot run on Lepus at all (see
 * [20 — First-screen snapshot](20-first-screen.md)) — there is no Angular
 * data resident on the Main Thread that a synchronous callback could
 * materialize from. `componentAtIndex` must already have a real element
 * to hand back the instant it's called; there is no cross-thread round-trip
 * available inside it.
 *
 * **So the realistic fix is windowing the Background-Thread side**: keep
 * only a `[windowStart, windowEnd)` range of rows materialized (real
 * embedded views, `ShadowElement`s, and Main-Thread elements) at all — sized
 * around the range `<list>` reports as attached, plus a buffer — and shift
 * that window as the user scrolls, via an explicit `updateVisibleRange()`
 * call fed from the list's own `(scroll)` event
 * (`$event.detail.attachedCells`). A cell requested outside the
 * currently-materialized window returns `undefined` from `componentAtIndex`
 * (already-supported, pre-existing behavior — see `list-apply.ts`) and
 * renders as a temporary gap; keeping the buffer ahead of normal scroll
 * speed is what keeps that rare in practice. See
 * [30 — Virtual lists](30-virtual-list.md) for usage.
 */
import {
  Directive,
  type DoCheck,
  inject,
  Input,
  type IterableDiffer,
  IterableDiffers,
  type NgIterable,
  type OnDestroy,
  TemplateRef,
  type TrackByFunction,
  ViewContainerRef,
} from '@angular/core';

/** Template context for `*lynxVirtualFor` — mirrors `NgForOf`'s shape. @public */
export class LynxVirtualForContext<T> {
  constructor(
    public $implicit: T,
    public index: number,
    public count: number,
  ) {}
  get first(): boolean {
    return this.index === 0;
  }
  get last(): boolean {
    return this.index === this.count - 1;
  }
  get even(): boolean {
    return this.index % 2 === 0;
  }
  get odd(): boolean {
    return !this.even;
  }
}

interface MaterializedEntry<T> {
  index: number;
  context: LynxVirtualForContext<T>;
  view: import('@angular/core').EmbeddedViewRef<LynxVirtualForContext<T>>;
}

function defaultTrackBy<T>(_index: number, item: T): unknown {
  return item;
}

/**
 * Windowed structural directive: `*lynxVirtualFor="let item of items; trackBy: fn"`
 * inside a `<list>`. Only materializes embedded views (and therefore
 * `ShadowElement`s and Main-Thread `<list-item>` elements) for a
 * `[windowStart, windowEnd)` range of the array — call
 * {@link LynxVirtualFor.updateVisibleRange} from the parent `<list>`'s
 * `(scroll)` handler to shift it. See the module doc for why this is
 * windowed rather than truly lazy.
 *
 * @example
 * ```html
 * <list (scroll)="onScroll($event, rows)">
 *   <ng-template
 *     lynxVirtualFor
 *     #rows="lynxVirtualFor"
 *     [lynxVirtualForOf]="items()"
 *     [lynxVirtualForTrackBy]="trackById"
 *   >
 *     <list-item [attr.item-key]="trackById($index, $item)">
 *       <text>{{ $item.name }}</text>
 *     </list-item>
 *   </ng-template>
 * </list>
 * ```
 * ```ts
 * onScroll(event: LynxListScrollEvent, rows: LynxVirtualFor<Item>): void {
 *   const cells = event.detail.attachedCells;
 *   if (cells?.length) {
 *     rows.updateVisibleRange(cells[0].index, cells[cells.length - 1].index);
 *   }
 * }
 * ```
 * @public
 */
@Directive({
  selector: '[lynxVirtualFor][lynxVirtualForOf]',
  standalone: true,
  exportAs: 'lynxVirtualFor',
})
export class LynxVirtualFor<T> implements DoCheck, OnDestroy {
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly template = inject(TemplateRef<LynxVirtualForContext<T>>);
  private readonly differs = inject(IterableDiffers);

  private differ?: IterableDiffer<T>;
  private items: T[] = [];
  private initialized = false;
  private windowStart = 0;
  private windowEnd = 0;

  /** trackBy key → materialized entry, for cells currently inside the window. */
  private readonly materialized = new Map<unknown, MaterializedEntry<T>>();

  /** The full backing array/iterable — same contract as `*ngFor`'s `of`. */
  @Input({ required: true }) lynxVirtualForOf: NgIterable<T> | null | undefined;

  /** Identity function for materialized-view reuse — align with your `[attr.item-key]`. */
  @Input() lynxVirtualForTrackBy: TrackByFunction<T> = defaultTrackBy;

  /** Extra rows kept materialized beyond the last reported visible range, each side. */
  @Input() lynxVirtualForBufferSize = 10;

  /** Rows materialized before any real visible range has been reported. */
  @Input() lynxVirtualForInitialCount = 20;

  ngDoCheck(): void {
    const iterable = this.lynxVirtualForOf;
    if (iterable == null) {
      this.items = [];
      this.windowStart = 0;
      this.windowEnd = 0;
      this.applyWindow();
      this.differ = undefined;
      this.initialized = true;
      return;
    }

    if (!this.differ) {
      this.differ = this.differs.find(iterable).create(this.lynxVirtualForTrackBy);
    }
    const changes = this.differ.diff(iterable);

    if (!this.initialized) {
      this.initialized = true;
      this.items = collect(iterable);
      this.windowStart = 0;
      this.windowEnd = Math.min(this.items.length, this.lynxVirtualForInitialCount);
      this.applyWindow();
      return;
    }

    if (changes) {
      this.items = collect(iterable);
      this.windowEnd = Math.min(this.windowEnd, this.items.length);
      if (this.windowStart > this.windowEnd) this.windowStart = this.windowEnd;
      this.applyWindow();
    }
  }

  /**
   * Shift the materialized window around `[start, end]` (inclusive), sized
   * with {@link lynxVirtualForBufferSize} on each side. Call this from the
   * parent `<list>`'s `(scroll)` handler with the current
   * `attachedCells` range. A no-op if the resulting window is unchanged.
   *
   * `shrink: false` unions the newly-computed range with the *current*
   * window instead of replacing it — the window only ever grows, rows already
   * materialized are never removed. Found necessary on a real device: calling
   * this with `shrink: true` (the default) while the native `<list>` is still
   * actively flinging removes off-screen `<list-item>`s mid-animation, which
   * appears to interrupt the native scroll-view's own momentum/position
   * tracking — each fling that triggered a shrink travelled measurably less
   * far than the one before it (a real device reported 182 → 160 → 152 across
   * three successive flings). Pass `shrink: false` while a scroll gesture is
   * still in progress (e.g. `<list>`'s `scrollstatechange` reporting anything
   * other than stationary) and let a later `shrink: true` call — once the
   * gesture has genuinely settled — reclaim the now-unneeded rows.
   *
   * `minChange` leaves an edge alone until it would move by at least that many
   * rows, or reach the end of the array. Changing the window makes the native list
   * answer with events, and its `scroll` and `getVisibleCells` can differ by a row,
   * so without this two callers can flip the window between two values forever.
   * Keep it smaller than {@link lynxVirtualForBufferSize}, so what's on screen stays
   * inside the window.
   */
  updateVisibleRange(start: number, end: number, options?: { shrink?: boolean; minChange?: number }): void {
    const buffer = this.lynxVirtualForBufferSize;
    let newStart = Math.max(0, Math.min(start, end) - buffer);
    let newEnd = Math.min(this.items.length, Math.max(start, end) + 1 + buffer);
    if (options?.shrink === false) {
      newStart = Math.min(newStart, this.windowStart);
      newEnd = Math.max(newEnd, this.windowEnd);
    }
    const minChange = options?.minChange ?? 0;
    if (newStart !== 0 && Math.abs(newStart - this.windowStart) < minChange) newStart = this.windowStart;
    if (newEnd !== this.items.length && Math.abs(newEnd - this.windowEnd) < minChange) newEnd = this.windowEnd;
    if (newStart === this.windowStart && newEnd === this.windowEnd) return;
    this.windowStart = newStart;
    this.windowEnd = newEnd;
    this.applyWindow();
  }

  /** The range of indices currently materialized — for tests/inspection. */
  get materializedRange(): { start: number; end: number } {
    return { start: this.windowStart, end: this.windowEnd };
  }

  private applyWindow(): void {
    const desiredKeys = new Set<unknown>();
    for (let index = this.windowStart; index < this.windowEnd; index++) {
      desiredKeys.add(this.lynxVirtualForTrackBy(index, this.items[index] as T));
    }

    // Drop materialized rows that fell out of the window.
    for (const [key, entry] of [...this.materialized]) {
      if (!desiredKeys.has(key)) {
        const viewIndex = this.viewContainer.indexOf(entry.view);
        if (viewIndex !== -1) this.viewContainer.remove(viewIndex);
        this.materialized.delete(key);
      }
    }

    // Create/move/update rows in the window, in order, so the container's
    // (and therefore the native <list>'s) child order matches array order.
    for (let index = this.windowStart, position = 0; index < this.windowEnd; index++, position++) {
      const item = this.items[index] as T;
      const key = this.lynxVirtualForTrackBy(index, item);
      let entry = this.materialized.get(key);
      if (!entry) {
        const context = new LynxVirtualForContext<T>(item, index, this.items.length);
        const view = this.viewContainer.createEmbeddedView(this.template, context, { index: position });
        entry = { index, context, view };
        this.materialized.set(key, entry);
      } else {
        const currentPosition = this.viewContainer.indexOf(entry.view);
        if (currentPosition !== position) this.viewContainer.move(entry.view, position);
        entry.context.$implicit = item;
        entry.context.index = index;
        entry.context.count = this.items.length;
        entry.index = index;
      }
    }
  }

  ngOnDestroy(): void {
    this.materialized.clear();
  }
}

function collect<T>(iterable: NgIterable<T>): T[] {
  return Array.isArray(iterable) ? iterable.slice() : Array.from(iterable);
}
