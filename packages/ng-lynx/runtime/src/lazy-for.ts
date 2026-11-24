/**
 * `LynxLazyFor` — a `<list>` whose rows are built only when the list asks for
 * them. See docs/30-virtual-list.md.
 *
 * The directive tells the native `<list>` about every row up front: its
 * `item-key` and estimated size, through {@link LAZY_ROWS_ATTR}. So the list
 * knows its full extent and scrolls all of it. Only a window of rows is built
 * (Angular views, `ShadowElement`s, Main-Thread elements). When the list asks for
 * a row outside it, the Main Thread answers with an empty cell and reports which
 * rows the list holds ({@link LAZY_LIST_RANGE_EVENT}); the window moves there,
 * and the Main Thread refreshes the cell once its row arrives
 * (main-thread/src/list-apply.ts).
 *
 * `LynxVirtualFor` builds a window too, but the list only knows the built rows,
 * so a fling stops at the window's edge, and the app has to move the window from
 * `(scroll)`. Here the list itself drives it.
 *
 * The web preview's list isn't virtualized: it asks for every row at once and
 * never asks again. There, every row is built.
 */
import {
  Directive,
  type DoCheck,
  type EmbeddedViewRef,
  inject,
  Input,
  type IterableDiffer,
  IterableDiffers,
  type NgIterable,
  type OnDestroy,
  Renderer2,
  TemplateRef,
  type TrackByFunction,
  ViewContainerRef,
} from '@angular/core';

import {
  LAZY_LIST_RANGE_EVENT,
  LAZY_ROWS_ATTR,
  type LazyListRange,
  type LazyRows,
} from 'ng-lynx/internal/ops';

import type { ShadowElement } from './shadow-element.js';
import { isWebPlatform } from './system-info.js';

declare const __DEV__: boolean;

// eslint-disable-next-line no-var
declare var lynx:
  | {
      getCoreContext?(): {
        addEventListener(type: string, listener: (event: { data: unknown }) => void): void;
      };
    }
  | null
  | undefined;

/** Template context for `*lynxLazyFor`, shaped like `@for`'s. @experimental */
export class LynxLazyForContext<T> {
  constructor(
    /** The row. */
    public $implicit: T,
    /** The row's index in the whole array, not among the built rows. */
    public index: number,
    /** How many rows there are, built or not. */
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

interface BuiltRow<T> {
  context: LynxLazyForContext<T>;
  view: EmbeddedViewRef<LynxLazyForContext<T>>;
}

/** The directive driving each lazy `<list>`, by the list's element id. */
const lazyLists = new Map<number, LynxLazyFor<unknown>>();

let channelInstalled = false;

function installChannel(): void {
  if (channelInstalled) return;
  const context = lynx?.getCoreContext?.();
  if (!context) return;
  channelInstalled = true;
  context.addEventListener(LAZY_LIST_RANGE_EVENT, (event) => {
    const range = event.data as LazyListRange;
    lazyLists.get(range.list)?.onListRange(range);
  });
}

function indexTrackBy(index: number): number {
  return index;
}

function collect<T>(iterable: NgIterable<T>): T[] {
  return Array.isArray(iterable) ? iterable.slice() : Array.from(iterable);
}

/**
 * Structural directive for the rows of a `<list>`, built only when the list
 * needs them: `*lynxLazyFor="let row of rows(); trackBy: trackById"`. Put it on
 * the `<list-item>`, the list's only content.
 *
 * Each row's `item-key` is `String(trackBy(index, row))`, and the directive sets
 * it: don't bind `[attr.item-key]`. Give `estimatedSize` (a number, or a function
 * of the row) so the list can place rows it hasn't built.
 *
 * @example
 * ```html
 * <list list-type="single" [span-count]="1" scroll-orientation="vertical">
 *   <list-item *lynxLazyFor="let row of rows(); trackBy: trackById; estimatedSize: 48">
 *     <text>{{ row.name }}</text>
 *   </list-item>
 * </list>
 * ```
 * @experimental
 */
@Directive({
  selector: '[lynxLazyFor][lynxLazyForOf]',
  standalone: true,
  exportAs: 'lynxLazyFor',
})
export class LynxLazyFor<T> implements DoCheck, OnDestroy {
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly template = inject(TemplateRef<LynxLazyForContext<T>>);
  private readonly differs = inject(IterableDiffers);
  private readonly renderer = inject(Renderer2);

  /** The rows: an array or other iterable, as for `@for`. */
  @Input({ required: true }) lynxLazyForOf: NgIterable<T> | null | undefined;

  /**
   * Each row's identity, which also becomes its `item-key`. Defaults to the index,
   * which only suits rows that never move: give one for anything else.
   */
  @Input() lynxLazyForTrackBy: TrackByFunction<T> = indexTrackBy;

  /**
   * Each row's `estimated-main-axis-size-px`: one number for every row, or a
   * function of the row. The list sizes rows it hasn't built with it.
   */
  @Input() lynxLazyForEstimatedSize: number | ((index: number, row: T) => number) | undefined;

  /** Rows kept built beyond those the list holds, on each side. */
  @Input() lynxLazyForBuffer = 20;

  /** Rows built for the first frame, before the list has asked for any. */
  @Input() lynxLazyForInitialCount = 20;

  private differ?: IterableDiffer<T>;
  private items: T[] = [];
  private keys: string[] = [];
  private list: ShadowElement | null = null;
  /** Whether the list drives the window. Not in the web preview, or outside a `<list>`. */
  private lazy = false;
  private attached = false;
  private version = 0;
  private sentSize: unknown;
  private windowStart = 0;
  private windowEnd = 0;
  private readonly built = new Map<string, BuiltRow<T>>();

  static ngTemplateContextGuard<T>(_dir: LynxLazyFor<T>, ctx: unknown): ctx is LynxLazyForContext<T> {
    return true;
  }

  /** The rows built right now, as `[start, end)` indices — for a status readout or a test. */
  get builtRange(): { start: number; end: number } {
    return { start: this.windowStart, end: this.windowEnd };
  }

  ngDoCheck(): void {
    if (!this.attached) this.attach();

    const iterable = this.lynxLazyForOf ?? [];
    if (!this.differ) this.differ = this.differs.find(iterable).create(this.lynxLazyForTrackBy);
    const first = this.version === 0;
    const changes = this.differ.diff(iterable);
    const sizeChanged = this.lynxLazyForEstimatedSize !== this.sentSize;
    if (!first && !changes && !sizeChanged) return;

    if (first || changes) {
      this.items = collect(iterable);
      this.keys = this.items.map((row, i) => String(this.lynxLazyForTrackBy(i, row)));
      if (__DEV__) this.checkKeys();
    }
    const count = this.items.length;
    if (!this.lazy) {
      this.windowStart = 0;
      this.windowEnd = count;
    } else if (first) {
      this.windowStart = 0;
      this.windowEnd = Math.min(count, this.lynxLazyForInitialCount);
    } else {
      this.windowEnd = Math.min(this.windowEnd, count);
      this.windowStart = Math.min(this.windowStart, this.windowEnd);
    }
    this.sentSize = this.lynxLazyForEstimatedSize;
    if (this.lazy) this.announce();
    else this.version++;
    this.applyWindow(false);
  }

  /**
   * The Main Thread's report of which rows the list holds or asked for. Moves the
   * window once those rows come within half a buffer of its edge, so it moves in
   * steps rather than a row at a time.
   */
  onListRange(range: LazyListRange): void {
    if (range.version !== this.version) return;
    const count = this.items.length;
    const start = Math.max(0, Math.min(range.start, range.end));
    const end = Math.min(count - 1, Math.max(range.start, range.end));
    if (end < start) return;
    const buffer = Math.max(0, this.lynxLazyForBuffer);
    const margin = Math.floor(buffer / 2);
    const lowOk = this.windowStart === 0 ? start >= 0 : start >= this.windowStart + margin;
    const highOk = this.windowEnd === count ? end < count : end < this.windowEnd - margin;
    if (lowOk && highOk) return;
    this.windowStart = Math.max(0, start - buffer);
    this.windowEnd = Math.min(count, end + 1 + buffer);
    this.applyWindow(true);
  }

  private attach(): void {
    const anchor = this.viewContainer.element.nativeElement as ShadowElement;
    const parent = this.renderer.parentNode(anchor) as ShadowElement | null;
    this.attached = true;
    if (parent?.type !== 'list') {
      if (__DEV__) {
        console.warn(
          '[ng-lynx] lynxLazyFor only builds rows lazily as the direct content of a <list>; '
            + 'here it builds every row.',
        );
      }
      return;
    }
    this.list = parent;
    if (isWebPlatform()) return;
    this.lazy = true;
    installChannel();
    lazyLists.set(parent.id, this as LynxLazyFor<unknown>);
  }

  /** Tell the Main Thread every row's key and size. */
  private announce(): void {
    const size = this.lynxLazyForEstimatedSize;
    const rows: LazyRows = { version: ++this.version, keys: this.keys };
    if (typeof size === 'number') rows.sizes = size;
    else if (typeof size === 'function') rows.sizes = this.items.map((row, i) => size(i, row));
    this.renderer.setProperty(this.list, LAZY_ROWS_ATTR, rows);
  }

  private checkKeys(): void {
    const seen = new Set<string>();
    for (const key of this.keys) {
      if (seen.has(key)) {
        console.warn(
          `[ng-lynx] lynxLazyFor: two rows have the item-key "${key}". The native <list> rejects `
            + 'duplicate keys; give lynxLazyForTrackBy a unique value per row.',
        );
        return;
      }
      seen.add(key);
    }
  }

  /**
   * Build the rows in the window and drop the rest. In a lazy list the Main
   * Thread places rows by key, so new rows are just appended and nothing moves.
   * Outside change detection (a range report), new rows are checked here so their
   * bindings go out in the same batch as their elements.
   */
  private applyWindow(outsideChangeDetection: boolean): void {
    const wanted = new Set<string>();
    for (let index = this.windowStart; index < this.windowEnd; index++) wanted.add(this.keys[index]!);

    for (const [key, row] of this.built) {
      if (wanted.has(key)) continue;
      const position = this.viewContainer.indexOf(row.view);
      if (position !== -1) this.viewContainer.remove(position);
      this.built.delete(key);
    }

    const count = this.items.length;
    for (let index = this.windowStart; index < this.windowEnd; index++) {
      const key = this.keys[index]!;
      const item = this.items[index] as T;
      const row = this.built.get(key);
      if (row) {
        row.context.$implicit = item;
        row.context.index = index;
        row.context.count = count;
        if (!this.lazy) {
          const position = index - this.windowStart;
          if (this.viewContainer.indexOf(row.view) !== position) this.viewContainer.move(row.view, position);
        }
        continue;
      }
      const context = new LynxLazyForContext<T>(item, index, count);
      const view = this.viewContainer.createEmbeddedView(
        this.template,
        context,
        this.lazy ? undefined : { index: index - this.windowStart },
      );
      this.tagRow(view, key);
      if (outsideChangeDetection) view.detectChanges();
      this.built.set(key, { context, view });
    }
  }

  /** Set the row's `item-key`, which is how the Main Thread matches it to its slot. */
  private tagRow(view: EmbeddedViewRef<LynxLazyForContext<T>>, key: string): void {
    const root = (view.rootNodes as ShadowElement[]).find((node) => node.kind === 'element');
    if (!root) return;
    if (__DEV__ && this.lazy && root.type !== 'list-item') {
      console.warn(`[ng-lynx] lynxLazyFor's rows must be <list-item> elements, not <${root.type}>.`);
    }
    this.renderer.setAttribute(root, 'item-key', key);
  }

  ngOnDestroy(): void {
    this.built.clear();
    if (!this.list || !this.lazy) return;
    if (lazyLists.get(this.list.id) === (this as LynxLazyFor<unknown>)) lazyLists.delete(this.list.id);
    this.renderer.removeAttribute(this.list, LAZY_ROWS_ATTR);
  }
}
