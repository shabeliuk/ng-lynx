/**
 * Native `<list>` management for the Main-Thread ops executor.
 *
 * Lynx's `<list>` is virtualized: it is created via `__CreateList` with
 * callbacks, and the native side calls `componentAtIndex(list, listID,
 * cellIndex, operationID)` only when it needs to materialise a cell. We keep the
 * ordered set of child elements per list and hand them back through that
 * callback.
 *
 * Items are never appended directly. After each ops batch we diff the current
 * order against what was last announced and describe the change to the native
 * list via the `update-list-info` attribute, as a **minimal keyed diff**:
 *
 *   - items whose relative order is unchanged (the longest increasing
 *     subsequence of survivors by their new index) are left in place;
 *   - vanished keys → `removeAction`; new or genuinely-moved keys →
 *     `removeAction` (from their old slot) + `insertAction` (at the new slot).
 *
 * This keeps append incremental (no removes) and removal cheap (one remove, no
 * re-insert), and — crucially — avoids re-inserting every cell with the same
 * key on a reorder, which the native virtualizer mishandles (gaps / a lone
 * surviving item) even though web-core tolerates it.
 *
 * Item "platform info" attributes (`item-key`, `estimated-*`, `sticky-*`, …)
 * travel ONLY inside `update-list-info`, never via `__SetAttribute`.
 *
 * > The `update-list-info` action shape matches `@lynx-js/web-core`'s handler:
 * > `removeAction` is ascending plain position numbers (walked as
 * > `children[position - i]`), `insertAction` carries `{ position, item-key, … }`.
 * > The order-diff logic is what ng-lynx owns; both are covered by
 * > `npm run verify:list`, whose mock mirrors that handler exactly.
 *
 * **Lazy lists** (`LynxLazyFor`, docs/30-virtual-list.md). The Background Thread
 * announces every row's item-key with {@link LAZY_ROWS_ATTR}, built or not, and the
 * list is told about all of them, so it scrolls the whole extent. The rows built so
 * far are matched to their slot by item-key. When the list asks for a row that
 * isn't built, `componentAtIndex` answers with nothing and the Main Thread tells
 * the Background Thread which rows the list holds or wants
 * ({@link LAZY_LIST_RANGE_EVENT}). Once the row arrives, an `updateAction` with
 * `flush: true` makes the list ask for that cell again: the iOS collection list
 * reloads a visible cell, the C++ list container marks its holder dirty and binds
 * it again. `enqueueComponent` says which cells the list let go of, so the range
 * follows what's on screen.
 */
import {
  APPEND_ANCHOR,
  LAZY_LIST_RANGE_EVENT,
  type LazyListRange,
  type LazyRows,
} from 'ng-lynx/internal/ops';

import { elements, pageUniqueId } from './element-registry.js';

declare const __DEV__: boolean;
declare function setTimeout(callback: () => void, ms: number): number;

/** BG ids that are `<list>` elements. */
const listElementIds = new Set<number>();
/** listBgId → ordered child bg ids (mirrors the shadow tree order). */
const listOrder = new Map<number, number[]>();
/** childBgId → native element handle. */
const listChildEls = new Map<number, LynxElement>();
/** childBgId → item-key. */
const itemKeyMap = new Map<number, string>();
/** childBgId → collected platform-info attributes. */
const listItemPlatformInfo = new Map<number, Record<string, unknown>>();
/** listBgId → item-keys last announced (to diff against). */
const listPrevKeys = new Map<number, string[]>();
/**
 * childBgIds removed this batch whose item-key / platform-info deletion is
 * deferred until the post-batch flush. A reorder arrives as REMOVE + INSERT of
 * the same childId; cancelling the deferral on re-insert keeps the item-key
 * across the move (Angular won't re-emit an unchanged `[attr.item-key]`).
 */
const pendingItemCleanup = new Set<number>();
/**
 * childBgIds already appended to their list's element. The native list asks for a
 * cell again whenever it scrolls back into view or moves, but the element never
 * left: removal only goes through `update-list-info`. Appending it again makes the
 * engine log "FiberElement re-insert node" and detach and re-attach it.
 */
const appendedItems = new Set<number>();

/** A lazy list's rows, and what the native list holds of them. */
interface LazyList {
  version: number;
  /** Every row's item-key, in order: what the native list is told about. */
  keys: string[];
  sizes: number | number[] | undefined;
  /** item-key → row index. */
  rowOf: Map<string, number>;
  /** item-key → childBgId, for the rows built so far. Rebuilt on every flush. */
  built: Map<string, number>;
  /** item-keys the native list holds a cell for. */
  bound: Set<string>;
  /** item-keys the list asked for before their row was built: refreshed once it is. */
  missed: Set<string>;
  /** Misses since the last range report: part of the next one, then forgotten. */
  freshMisses: Set<string>;
  /** `version:start:end` of the last range report, to skip repeats. */
  reported: string;
  /** A dev warning about a stray item-key was already logged. */
  warnedStrayKey?: boolean;
}

/** listBgId → lazy state, for lists a `LynxLazyFor` drives. */
const lazyLists = new Map<number, LazyList>();
/** Element sign → the lazy list cell it was handed out for, so `enqueueComponent` can find it. */
const lazySigns = new Map<number, { list: number; key: string }>();
/**
 * Rows removed from a lazy list this batch. Their slot stays, so no `removeAction`
 * takes their element off the list: the flush detaches it, unless the same batch
 * put it back (a move).
 */
const lazyDetach = new Map<number, { list: number; el: LynxElement }>();
/** Lazy lists with a range report waiting for the timer. */
const pendingReports = new Set<number>();
let reportTimerSet = false;

const PLATFORM_INFO_ATTRS = new Set([
  'item-key',
  'estimated-main-axis-size-px',
  'estimated-height-px',
  'estimated-height',
  'reuse-identifier',
  'full-span',
  'sticky-top',
  'sticky-bottom',
  'recyclable',
]);

function appendOnce(list: LynxElement, childBgId: number, item: LynxElement): void {
  if (appendedItems.has(childBgId)) return;
  appendedItems.add(childBgId);
  __AppendElement(list, item);
}

function itemKeyOf(childBgId: number): string {
  return itemKeyMap.get(childBgId) ?? String(childBgId);
}

/**
 * The element for `cellIndex`, or nothing yet. For a lazy list this is where a
 * miss is recorded and a bound cell remembered.
 */
function cellAt(listBgId: number, cellIndex: number): { childBgId: number; item: LynxElement } | undefined {
  const lazy = lazyLists.get(listBgId);
  if (!lazy) {
    const childBgId = listOrder.get(listBgId)?.[cellIndex];
    const item = childBgId != null ? listChildEls.get(childBgId) : undefined;
    return item ? { childBgId: childBgId!, item } : undefined;
  }
  const key = lazy.keys[cellIndex];
  if (key === undefined) return undefined;
  const childBgId = lazy.built.get(key);
  const item = childBgId !== undefined ? listChildEls.get(childBgId) : undefined;
  if (!item) {
    lazy.missed.add(key);
    lazy.freshMisses.add(key);
    scheduleRangeReport(listBgId);
    return undefined;
  }
  lazy.missed.delete(key);
  if (!lazy.bound.has(key)) {
    lazy.bound.add(key);
    scheduleRangeReport(listBgId);
  }
  lazySigns.set(__GetElementUniqueID(item), { list: listBgId, key });
  return { childBgId: childBgId!, item };
}

function createListCallbacks(listBgId: number): {
  componentAtIndex: (list: LynxElement, listID: number, cellIndex: number, op: number) => number | undefined;
  enqueueComponent: (list: LynxElement, listID: number, sign: number) => void;
  componentAtIndexes: (list: LynxElement, listID: number, cellIndexes: number[], ops: number[]) => void;
} {
  const componentAtIndex = (
    list: LynxElement,
    listID: number,
    cellIndex: number,
    operationID: number,
  ): number | undefined => {
    const cell = cellAt(listBgId, cellIndex);
    // -1 is the engine's own "no cell" (`list::kInvalidIndex`).
    if (!cell) return lazyLists.has(listBgId) ? -1 : undefined;
    appendOnce(list, cell.childBgId, cell.item);
    const sign = __GetElementUniqueID(cell.item);
    __FlushElementTree(cell.item, { triggerLayout: true, operationID, elementID: sign, listID });
    return sign;
  };

  const componentAtIndexes = (
    list: LynxElement,
    listID: number,
    cellIndexes: number[],
    operationIDs: number[],
  ): void => {
    const elementIDs: number[] = [];
    for (const cellIndex of cellIndexes) {
      const cell = cellAt(listBgId, cellIndex);
      if (!cell) {
        elementIDs.push(-1);
        continue;
      }
      appendOnce(list, cell.childBgId, cell.item);
      elementIDs.push(__GetElementUniqueID(cell.item));
    }
    __FlushElementTree(list, { triggerLayout: true, operationIDs, elementIDs, listID });
  };

  // The list let go of a cell (it scrolled away, or is about to be bound again).
  // Angular owns the elements, so there's nothing to recycle: a lazy list only
  // stops counting the cell as held.
  const enqueueComponent = (_list: LynxElement, _listID: number, sign: number): void => {
    const cell = lazySigns.get(sign);
    if (!cell) return;
    lazySigns.delete(sign);
    const lazy = lazyLists.get(cell.list);
    if (lazy?.bound.delete(cell.key)) scheduleRangeReport(cell.list);
  };

  return { componentAtIndex, enqueueComponent, componentAtIndexes };
}

/** Is this BG parent id a `<list>`? */
export function isListParent(parentId: number): boolean {
  return listElementIds.has(parentId);
}

/** Is this a list-item placement attribute? */
export function isPlatformInfoAttr(key: string): boolean {
  return PLATFORM_INFO_ATTRS.has(key);
}

/** CREATE: make a native `<list>` and set up its tracking state. */
export function createListElement(id: number): LynxElement {
  listElementIds.add(id);
  listOrder.set(id, []);
  listPrevKeys.set(id, []);
  const cbs = createListCallbacks(id);
  const el = __CreateList(
    pageUniqueId,
    cbs.componentAtIndex,
    cbs.enqueueComponent,
    {},
    cbs.componentAtIndexes,
  );
  __SetCSSId([el], 0);
  return el;
}

/**
 * INSERT: place a child element into its `<list>` parent's order. Handles moves
 * (re-inserting an existing child relocates it) and anchored inserts (anchorId
 * is the next sibling's bg id, or APPEND_ANCHOR to append).
 */
export function insertListItem(
  listBgId: number,
  childId: number,
  childEl: LynxElement,
  anchorId: number,
): void {
  listChildEls.set(childId, childEl);
  // Re-inserting an id means this was a move, not a removal — keep its metadata.
  pendingItemCleanup.delete(childId);
  lazyDetach.delete(childId);
  const order = listOrder.get(listBgId);
  if (!order) return;

  const existing = order.indexOf(childId);
  if (existing >= 0) order.splice(existing, 1); // move: drop old position first

  if (anchorId === APPEND_ANCHOR) {
    order.push(childId);
  } else {
    const idx = order.indexOf(anchorId);
    if (idx >= 0) order.splice(idx, 0, childId);
    else order.push(childId);
  }
}

/** REMOVE: drop a child from its `<list>` parent's order. */
export function removeListItem(listBgId: number, childId: number): void {
  const order = listOrder.get(listBgId);
  if (order) {
    const idx = order.indexOf(childId);
    if (idx >= 0) order.splice(idx, 1);
  }
  const el = listChildEls.get(childId);
  if (el && lazyLists.has(listBgId)) lazyDetach.set(childId, { list: listBgId, el });
  listChildEls.delete(childId);
  // Defer dropping the item-key / platform-info: a reorder is REMOVE + INSERT of
  // the same childId, and re-emitting an unchanged `[attr.item-key]` is not
  // something Angular does — so deleting now would make the moved cell fall back
  // to `String(childBgId)` (see itemKeyOf), silently changing its key. The
  // native <list> reads a changed key as "cell replaced" and mis-renders the
  // reorder. flushListUpdates finalises cleanup for ids that were NOT re-inserted.
  pendingItemCleanup.add(childId);
}

/** SET_ATTR: stash a platform-info attribute for a list item. */
export function setPlatformInfoProp(id: number, key: string, value: unknown): void {
  const info = listItemPlatformInfo.get(id);
  if (info) info[key] = value;
  else listItemPlatformInfo.set(id, { [key]: value });
  if (key === 'item-key') itemKeyMap.set(id, String(value));
}

/**
 * SET_ATTR / REMOVE_ATTR of {@link LAZY_ROWS_ATTR}: the rows of a lazy list, or
 * `undefined` to make it an ordinary list again. Applied at the next flush.
 */
export function setLazyRows(listBgId: number, rows: LazyRows | undefined): void {
  if (!listElementIds.has(listBgId)) return;
  if (!rows) {
    lazyLists.delete(listBgId);
    pendingReports.delete(listBgId);
    for (const [sign, cell] of lazySigns) if (cell.list === listBgId) lazySigns.delete(sign);
    return;
  }
  const rowOf = new Map<string, number>();
  rows.keys.forEach((key, i) => rowOf.set(key, i));
  const previous = lazyLists.get(listBgId);
  const keep = (keys: Set<string> | undefined): Set<string> =>
    new Set([...(keys ?? [])].filter((key) => rowOf.has(key)));
  lazyLists.set(listBgId, {
    version: rows.version,
    keys: rows.keys,
    sizes: rows.sizes,
    rowOf,
    built: previous?.built ?? new Map(),
    bound: keep(previous?.bound),
    missed: keep(previous?.missed),
    freshMisses: keep(previous?.freshMisses),
    reported: '',
  });
  // The Background Thread drops ranges from an older version: tell it again.
  scheduleRangeReport(listBgId);
}

function scheduleRangeReport(listBgId: number): void {
  pendingReports.add(listBgId);
  if (reportTimerSet) return;
  reportTimerSet = true;
  // A timer, so the cells one layout pass asks for go out as one report.
  setTimeout(sendRangeReports, 0);
}

function sendRangeReports(): void {
  reportTimerSet = false;
  const lists = [...pendingReports];
  pendingReports.clear();
  for (const listBgId of lists) {
    const lazy = lazyLists.get(listBgId);
    if (!lazy) continue;
    let start = Number.POSITIVE_INFINITY;
    let end = -1;
    const widen = (key: string): void => {
      const row = lazy.rowOf.get(key);
      if (row === undefined) return;
      if (row < start) start = row;
      if (row > end) end = row;
    };
    lazy.bound.forEach(widen);
    lazy.freshMisses.forEach(widen);
    const hadMisses = lazy.freshMisses.size > 0;
    lazy.freshMisses.clear();
    if (end < 0) continue;
    const id = `${lazy.version}:${start}:${end}`;
    // A miss always goes out: the list is showing an empty cell.
    if (id === lazy.reported && !hadMisses) continue;
    lazy.reported = id;
    const range: LazyListRange = { list: listBgId, version: lazy.version, start, end };
    lynx?.getJSContext?.()?.dispatchEvent({ type: LAZY_LIST_RANGE_EVENT, data: range });
  }
}

function makeInsertAction(childBgId: number, position: number): Record<string, unknown> {
  const action: Record<string, unknown> = {
    position,
    type: 'list-item',
    'item-key': itemKeyOf(childBgId),
  };
  const pInfo = listItemPlatformInfo.get(childBgId);
  if (pInfo) Object.assign(action, pInfo);
  return action;
}

/**
 * A lazy row's platform info: its estimated size from the Background Thread,
 * overlaid with the attributes of its element if it's built.
 */
function lazyRowInfo(lazy: LazyList, key: string, row: number): Record<string, unknown> {
  const info: Record<string, unknown> = { type: 'list-item', 'item-key': key };
  const size = typeof lazy.sizes === 'number' ? lazy.sizes : lazy.sizes?.[row];
  if (size !== undefined) info['estimated-main-axis-size-px'] = size;
  const childBgId = lazy.built.get(key);
  const pInfo = childBgId !== undefined ? listItemPlatformInfo.get(childBgId) : undefined;
  if (pInfo) Object.assign(info, pInfo);
  // The slot's key wins over a mismatched binding: it's what the list was told.
  info['item-key'] = key;
  return info;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Indices into `seq` that form a longest strictly-increasing subsequence
 * (patience sorting, O(n log n)). In `flushListUpdates` these mark the list
 * items whose relative order is already correct, so they can stay put across a
 * reorder while only the genuinely-moved items are removed and re-inserted.
 */
function lisIndices(seq: number[]): Set<number> {
  const n = seq.length;
  const keep = new Set<number>();
  if (n === 0) return keep;
  const parent = new Array<number>(n).fill(-1);
  const piles: number[] = []; // piles[k] = seq-index of the smallest tail of a length-(k+1) run
  for (let i = 0; i < n; i++) {
    const x = seq[i]!;
    let lo = 0;
    let hi = piles.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[piles[mid]!]! < x) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) parent[i] = piles[lo - 1]!;
    piles[lo] = i;
  }
  let k = piles[piles.length - 1]!;
  while (k !== -1) {
    keep.add(k);
    k = parent[k]!;
  }
  return keep;
}

/**
 * The minimal keyed diff from `prevKeys` to `currentKeys`: `removeAction` as
 * ascending old positions, and the positions in `currentKeys` to insert. Keys in
 * `reinsert` are removed and inserted again even if they kept their place.
 */
function diffKeys(
  prevKeys: string[],
  currentKeys: string[],
  reinsert?: Set<string>,
): { removeAction: number[]; insertPositions: number[] } {
  // Keep the items whose relative order is already correct (the longest
  // increasing subsequence of the survivors by their *new* index) untouched;
  // only remove + re-insert the ones that actually moved, drop vanished keys,
  // and add new ones. This avoids the "remove every cell, then re-insert every
  // cell with the same key" churn of a full resync — which the native <list>
  // virtualizer mishandles on reorder (cells land in the wrong slots, leaving
  // gaps / a lone item) even though web-core tolerates it.
  const curPos = new Map<string, number>();
  currentKeys.forEach((k, i) => curPos.set(k, i));

  // Survivors = prev keys still present, in prev order, tagged with new index.
  const survivors: { curIdx: number; key: string }[] = [];
  for (const k of prevKeys) {
    const ci = curPos.get(k);
    if (ci !== undefined) survivors.push({ curIdx: ci, key: k });
  }
  const lis = lisIndices(survivors.map((s) => s.curIdx));
  const keep = new Set<string>();
  lis.forEach((idx) => keep.add(survivors[idx]!.key));
  reinsert?.forEach((k) => keep.delete(k));

  // removeAction: **ascending** prev positions of keys that vanished or must
  // move. The native <list> (and web-core) walk it as `children[position - i]`,
  // deleting as they go — so positions must be bare ascending numbers, NOT
  // `{ position }` objects and NOT descending, or no cells are removed and the
  // new item-keys collide with the old ones ("duplicated list item-key",
  // error 2202/220208).
  const removeAction: number[] = [];
  prevKeys.forEach((k, prevPos) => {
    if (!curPos.has(k) || !keep.has(k)) removeAction.push(prevPos);
  });
  // Inserts: new or moved keys, at their final positions (ascending).
  const insertPositions: number[] = [];
  currentKeys.forEach((k, i) => {
    if (!keep.has(k)) insertPositions.push(i);
  });
  return { removeAction, insertPositions };
}

/** Post-ops for a list a `LynxLazyFor` drives. See the module doc. */
function flushLazyList(listBgId: number, listEl: LynxElement, order: number[], lazy: LazyList): void {
  // Rows the Background Thread dropped: their slot stays, so take the element off
  // the list here. One the list still showed is wanted back.
  for (const [childId, detach] of lazyDetach) {
    if (detach.list !== listBgId) continue;
    lazyDetach.delete(childId);
    if (appendedItems.delete(childId)) __RemoveElement(listEl, detach.el);
    lazySigns.delete(__GetElementUniqueID(detach.el));
    const key = itemKeyOf(childId);
    // A row that left the data, rather than the window, isn't wanted back.
    if (lazy.bound.delete(key) && lazy.rowOf.has(key)) {
      lazy.missed.add(key);
      lazy.freshMisses.add(key);
      scheduleRangeReport(listBgId);
    }
  }

  lazy.built = new Map();
  for (const childBgId of order) {
    const key = itemKeyOf(childBgId);
    lazy.built.set(key, childBgId);
    if (__DEV__ && !lazy.warnedStrayKey && !lazy.rowOf.has(key)) {
      lazy.warnedStrayKey = true;
      console.warn(
        `[ng-lynx] A <list-item> in a lynxLazyFor list has item-key "${key}", which isn't one of the `
          + 'list\'s rows, so the list never shows it. lynxLazyFor sets each row\'s item-key from '
          + 'lynxLazyForTrackBy: drop any [attr.item-key] binding, and keep other <list-item>s out of the list.',
      );
    }
  }

  // Rows the list asked for too early, now built: refresh their cells.
  const refresh = new Set<string>();
  lazy.missed.forEach((key) => {
    if (lazy.built.has(key)) refresh.add(key);
  });
  refresh.forEach((key) => lazy.missed.delete(key));

  const currentKeys = lazy.keys;
  const prevKeys = listPrevKeys.get(listBgId) ?? [];
  if (arraysEqual(currentKeys, prevKeys)) {
    if (refresh.size === 0) return;
    const updateAction: Record<string, unknown>[] = [];
    refresh.forEach((key) => {
      const row = lazy.rowOf.get(key)!;
      updateAction.push({ ...lazyRowInfo(lazy, key, row), from: row, to: row, flush: true });
    });
    updateAction.sort((a, b) => (a['from'] as number) - (b['from'] as number));
    __SetAttribute(listEl, 'update-list-info', { insertAction: [], removeAction: [], updateAction });
    return;
  }

  // The rows changed too. A refresh then rides along as a remove and an insert, so
  // no update has to say which positions it means.
  const { removeAction, insertPositions } = diffKeys(prevKeys, currentKeys, refresh);
  const insertAction = insertPositions.map((position) => ({
    ...lazyRowInfo(lazy, currentKeys[position]!, position),
    position,
  }));
  __SetAttribute(listEl, 'update-list-info', { insertAction, removeAction, updateAction: [] });
  listPrevKeys.set(listBgId, currentKeys);
}

/**
 * Forget a destroyed `<list>` and its rows. Angular removes only the list, not
 * each row from it, so nothing else frees them.
 */
function dropList(listBgId: number, order: number[]): void {
  for (const childBgId of order) {
    listChildEls.delete(childBgId);
    itemKeyMap.delete(childBgId);
    listItemPlatformInfo.delete(childBgId);
    appendedItems.delete(childBgId);
    pendingItemCleanup.delete(childBgId);
  }
  listElementIds.delete(listBgId);
  listOrder.delete(listBgId);
  listPrevKeys.delete(listBgId);
  lazyLists.delete(listBgId);
  pendingReports.delete(listBgId);
  for (const [sign, cell] of lazySigns) if (cell.list === listBgId) lazySigns.delete(sign);
  for (const [childId, detach] of lazyDetach) if (detach.list === listBgId) lazyDetach.delete(childId);
}

/**
 * Post-ops: announce order changes to each list via `update-list-info`.
 * Append-only changes send a minimal `insertAction`; any removal or reorder
 * sends the minimal keyed diff (see `diffKeys`).
 */
export function flushListUpdates(): void {
  for (const [listBgId, order] of listOrder) {
    const listEl = elements.get(listBgId);
    if (!listEl) {
      dropList(listBgId, order);
      continue;
    }

    const lazy = lazyLists.get(listBgId);
    if (lazy) {
      flushLazyList(listBgId, listEl, order, lazy);
      continue;
    }

    const currentKeys = order.map(itemKeyOf);
    const prevKeys = listPrevKeys.get(listBgId) ?? [];
    if (arraysEqual(currentKeys, prevKeys)) continue;

    const { removeAction, insertPositions } = diffKeys(prevKeys, currentKeys);
    const insertAction = insertPositions.map((i) => makeInsertAction(order[i]!, i));

    __SetAttribute(listEl, 'update-list-info', {
      insertAction,
      removeAction,
      updateAction: [],
    });
    listPrevKeys.set(listBgId, currentKeys);
  }

  // Rows that left a list no longer drawn as lazy (its LynxLazyFor went away).
  lazyDetach.clear();

  // Finalise deferred removals: any id still pending was NOT re-inserted this
  // batch, so it is a genuine removal — drop its item-key / platform info now.
  if (pendingItemCleanup.size > 0) {
    for (const id of pendingItemCleanup) {
      itemKeyMap.delete(id);
      listItemPlatformInfo.delete(id);
      appendedItems.delete(id);
    }
    pendingItemCleanup.clear();
  }
}

/** How much each list registry holds — for leak checks in the harnesses. */
export function listStateSizes(): Record<string, number> {
  return {
    lists: listElementIds.size,
    lazyLists: lazyLists.size,
    lazySigns: lazySigns.size,
    lazyDetach: lazyDetach.size,
    pendingReports: pendingReports.size,
    childEls: listChildEls.size,
    itemKeys: itemKeyMap.size,
    appended: appendedItems.size,
  };
}

/** Reset all list state — for testing / hot reload. */
export function resetListState(): void {
  listElementIds.clear();
  listOrder.clear();
  listChildEls.clear();
  itemKeyMap.clear();
  listItemPlatformInfo.clear();
  listPrevKeys.clear();
  pendingItemCleanup.clear();
  appendedItems.clear();
  lazyLists.clear();
  lazySigns.clear();
  lazyDetach.clear();
  pendingReports.clear();
}
