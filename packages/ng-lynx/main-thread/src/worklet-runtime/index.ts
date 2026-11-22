/**
 * ng-lynx's Main-Thread worklet runtime: the functions the engine calls to run a
 * worklet, and the globals a Main-Thread script expects next to them. It replaces
 * `@lynx-js/react/worklet-runtime`, keeping the same engine contract.
 * See docs/42-worklet-runtime.md.
 *
 * Internal: `ng-lynx/internal/worklet-runtime`. `pluginAngularLynx` bundles
 * `init.ts`, which calls {@link installWorkletRuntime}.
 */
import { registerControlWorklets } from '../controls.js';
import { installQueries, installTimers } from './api-env.js';
import { clearWorkletFunctions, markWorkletRuntimeInstalled, registerWorkletFunction, workletMap } from './registry.js';
import { runWorklet } from './run-worklet.js';
import type { WorkletFunction } from './types.js';

/** `registerWorkletInternal(type, id, fn)`: the type is always `'main-thread'` now, and unused. */
function registerWorkletGlobal(_type: string, id: string, fn: WorkletFunction): void {
  registerWorkletFunction(id, fn);
}

/**
 * Install the runtime on this thread's `globalThis`: `runWorklet`,
 * `registerWorkletInternal` and `registerWorklet`, `lynxWorkletImpl`, the timers
 * and frames from `lynx`, and `lynx.querySelector(All)`.
 *
 * Installs every time it's called. Hot reload evaluates the Main-Thread bundle
 * again, and the globals must then reach the new bundle's registry. Registered
 * worklets stay registered.
 */
export function installWorkletRuntime(): void {
  const g = globalThis as Record<string, unknown>;
  g['runWorklet'] = runWorklet;
  g['registerWorkletInternal'] = registerWorkletGlobal;
  g['registerWorklet'] = registerWorkletGlobal;
  g['lynxWorkletImpl'] = { _workletMap: workletMap() };
  const lynxObject = typeof lynx === 'object' && lynx !== null ? (lynx as unknown as Record<string, unknown>) : undefined;
  if (lynxObject) {
    installTimers(lynxObject);
    installQueries(lynxObject);
  }
  markWorkletRuntimeInstalled();
  registerControlWorklets();
}

/** Forget every registered worklet. For tests: `installMockPapi()` calls it. */
export function clearWorklets(): void {
  clearWorkletFunctions();
  const impl = (globalThis as Record<string, unknown>)['lynxWorkletImpl'] as { _workletMap?: unknown } | undefined;
  if (impl) impl._workletMap = workletMap();
  // ng-lynx's own controls stay: they're part of the runtime, not the app.
  registerControlWorklets();
}
