/**
 * The Background-Thread ops buffer.
 *
 * Every LynxRenderer2 mutation appends primitives here via `pushOp`. The flush
 * scheduler drains the buffer with `takeOps` and ships it to the Main Thread.
 *
 * Keeping this as a flat array (rather than an array of tuples) avoids
 * per-op allocation and makes the JSON payload as small as possible.
 */
import { OP } from 'ng-lynx/internal/ops';

export { OP };

let buffer: unknown[] = [];

/**
 * `templateSourceMap` builds only: where each element created in this batch has
 * its `CREATE_MAPPED` op's `nodeIndex` slot. Angular sets an element's source
 * location after creating it, in the same pass, so the renderer fills the slot
 * in before the batch leaves (see `LynxRenderer2.setAttribute`). Cleared with
 * the batch: by then the element exists on the Main Thread, and its index can't
 * change.
 */
let nodeIndexSlots: Map<object, number> | undefined;

/** Push a `CREATE_MAPPED` op for `el`, with its `nodeIndex` slot left at 0 to fill in. */
export function pushMappedCreate(el: object, id: number, type: string): void {
  buffer.push(OP.CREATE_MAPPED, id, type, 0);
  (nodeIndexSlots ??= new Map()).set(el, buffer.length - 1);
}

/**
 * Fill in the `nodeIndex` of `el`'s `CREATE_MAPPED` op, if that op is still in
 * the unsent batch. Returns whether it was.
 */
export function setPendingNodeIndex(el: object, nodeIndex: number): boolean {
  const slot = nodeIndexSlots?.get(el);
  if (slot === undefined) return false;
  buffer[slot] = nodeIndex;
  nodeIndexSlots!.delete(el);
  return true;
}

export function pushOp(...args: unknown[]): void {
  for (const arg of args) {
    buffer.push(arg);
  }
}

export function takeOps(): unknown[] {
  const b = buffer;
  buffer = [];
  nodeIndexSlots?.clear();
  return b;
}

/** Reset module state — for testing only. */
export function resetOpsState(): void {
  buffer = [];
  nodeIndexSlots = undefined;
}
