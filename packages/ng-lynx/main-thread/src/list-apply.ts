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
 */
import { APPEND_ANCHOR } from 'ng-lynx/internal/ops';

import { elements, pageUniqueId } from './element-registry.js';

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

// biome-ignore lint/suspicious/noEmptyBlockStatements: Angular manages items; no native recycling.
function enqueueComponentNoop(): void {}

function appendOnce(list: LynxElement, childBgId: number, item: LynxElement): void {
  if (appendedItems.has(childBgId)) return;
  appendedItems.add(childBgId);
  __AppendElement(list, item);
}

function itemKeyOf(childBgId: number): string {
  return itemKeyMap.get(childBgId) ?? String(childBgId);
}

function createListCallbacks(listBgId: number): {
  componentAtIndex: (list: LynxElement, listID: number, cellIndex: number, op: number) => number | undefined;
  enqueueComponent: () => void;
  componentAtIndexes: (list: LynxElement, listID: number, cellIndexes: number[], ops: number[]) => void;
} {
  const componentAtIndex = (
    list: LynxElement,
    listID: number,
    cellIndex: number,
    operationID: number,
  ): number | undefined => {
    const order = listOrder.get(listBgId);
    const childBgId = order?.[cellIndex];
    const item = childBgId != null ? listChildEls.get(childBgId) : undefined;
    if (!item) return undefined;
    appendOnce(list, childBgId!, item);
    const sign = __GetElementUniqueID(item);
    __FlushElementTree(item, { triggerLayout: true, operationID, elementID: sign, listID });
    return sign;
  };

  const componentAtIndexes = (
    list: LynxElement,
    listID: number,
    cellIndexes: number[],
    operationIDs: number[],
  ): void => {
    const order = listOrder.get(listBgId);
    const elementIDs: number[] = [];
    for (const cellIndex of cellIndexes) {
      const childBgId = order?.[cellIndex];
      const item = childBgId != null ? listChildEls.get(childBgId) : undefined;
      if (!item) {
        elementIDs.push(-1);
        continue;
      }
      appendOnce(list, childBgId!, item);
      elementIDs.push(__GetElementUniqueID(item));
    }
    __FlushElementTree(list, { triggerLayout: true, operationIDs, elementIDs, listID });
  };

  return { componentAtIndex, enqueueComponent: enqueueComponentNoop, componentAtIndexes };
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
 * Post-ops: announce order changes to each list via `update-list-info`.
 * Append-only changes send a minimal `insertAction`; any removal or reorder
 * sends a full resync (`removeAction` for the old cells + `insertAction` for the
 * new order).
 */
export function flushListUpdates(): void {
  for (const [listBgId, order] of listOrder) {
    const listEl = elements.get(listBgId);
    if (!listEl) continue;

    const currentKeys = order.map(itemKeyOf);
    const prevKeys = listPrevKeys.get(listBgId) ?? [];
    if (arraysEqual(currentKeys, prevKeys)) continue;

    // Minimal keyed diff. Keep the items whose relative order is already correct
    // (the longest increasing subsequence of the survivors by their *new* index)
    // untouched; only remove + re-insert the ones that actually moved, drop
    // vanished keys, and add new ones. This avoids the "remove every cell, then
    // re-insert every cell with the same key" churn of a full resync — which the
    // native <list> virtualizer mishandles on reorder (cells land in the wrong
    // slots, leaving gaps / a lone item) even though web-core tolerates it.
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
    // insertAction: new or moved keys, at their final positions (ascending).
    const insertAction: Record<string, unknown>[] = [];
    currentKeys.forEach((k, i) => {
      if (!keep.has(k)) insertAction.push(makeInsertAction(order[i]!, i));
    });

    __SetAttribute(listEl, 'update-list-info', {
      insertAction,
      removeAction,
      updateAction: [],
    });
    listPrevKeys.set(listBgId, currentKeys);
  }

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
}
