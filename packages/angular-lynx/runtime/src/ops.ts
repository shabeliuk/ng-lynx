/**
 * The Background-Thread ops buffer.
 *
 * Every LynxRenderer2 mutation appends primitives here via `pushOp`. The flush
 * scheduler drains the buffer with `takeOps` and ships it to the Main Thread.
 *
 * Keeping this as a flat array (rather than an array of tuples) avoids
 * per-op allocation and makes the JSON payload as small as possible.
 */
export { OP } from 'angular-lynx/internal/ops';

let buffer: unknown[] = [];

export function pushOp(...args: unknown[]): void {
  for (const arg of args) {
    buffer.push(arg);
  }
}

export function takeOps(): unknown[] {
  const b = buffer;
  buffer = [];
  return b;
}

/** Reset module state — for testing only. */
export function resetOpsState(): void {
  buffer = [];
}
