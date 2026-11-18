/**
 * Worklet functions by id, and whether the runtime is installed on this thread.
 *
 * The map is a plain object with no prototype, so an id like `toString` can't
 * resolve to something nobody registered. The same object is exposed as
 * `lynxWorkletImpl._workletMap` (see index.ts).
 */
import type { WorkletFunction } from './types.js';

let worklets: Record<string, WorkletFunction> = Object.create(null) as Record<string, WorkletFunction>;
let installed = false;

/** Store `fn` under `id`, replacing whatever was there: hot reload registers again. */
export function registerWorkletFunction(id: string, fn: WorkletFunction): void {
  worklets[id] = fn;
}

/** The function registered under `id`, if any. */
export function getWorkletFunction(id: string): WorkletFunction | undefined {
  return worklets[id];
}

/** The map itself, for `lynxWorkletImpl._workletMap`. */
export function workletMap(): Record<string, WorkletFunction> {
  return worklets;
}

/** Forget every registration. For tests. */
export function clearWorkletFunctions(): void {
  worklets = Object.create(null) as Record<string, WorkletFunction>;
}

/**
 * Whether `installWorkletRuntime` ran in this bundle. On the Background Thread it
 * never does: a worklet module imported there (for its `WorkletHandle`) registers
 * nothing.
 */
export function isWorkletRuntimeInstalled(): boolean {
  return installed;
}

export function markWorkletRuntimeInstalled(): void {
  installed = true;
}
