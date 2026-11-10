/**
 * `lynx.reload()` for an Angular app.
 *
 * The engine reloads a page in three steps (template_assembler.cc,
 * `ReloadFromJS`): the Main Thread's `removeComponents` drops the old tree, the
 * JS core calls `tt.onAppReload(initData)` on the Background Thread, and the
 * Main Thread's `updatePage` gets `reloadTemplate: true`. ReactLynx re-renders
 * its root here; an Angular app is destroyed and bootstrapped again, with the
 * new init data merged into `lynxInitData()`. Without these hooks the engine
 * threw `removeComponents is not a function` and nothing reloaded.
 */
import { flushOps, resumeFlushing } from './flush.js';
import { mergeReloadInitData } from './host-data.js';
import { destroyApplications } from './page-destroy.js';

type Bootstrap = () => Promise<unknown>;

const bootstraps: Bootstrap[] = [];
let reloading = false;

/** Called by `bootstrapLynxApplication`, so a reload can run the same calls again. */
export function recordBootstrap(bootstrap: Bootstrap): void {
  if (!reloading) bootstraps.push(bootstrap);
}

/** Installed as `tt.onAppReload` by entry-background.ts. */
export async function reloadApplications(initData?: Record<string, unknown>): Promise<void> {
  // The old tree is already gone on the Main Thread: the teardown's ops have
  // nowhere to go. Drop them now, before flushing starts again.
  destroyApplications();
  flushOps();
  resumeFlushing();
  mergeReloadInitData(initData);
  reloading = true;
  try {
    for (const bootstrap of bootstraps) await bootstrap();
  } catch (err) {
    console.error('[angular-lynx] error while bootstrapping the application again after lynx.reload()', err);
  } finally {
    reloading = false;
  }
}

/** Reset module state — for testing only. @internal */
export function resetReloadState(): void {
  bootstraps.length = 0;
  reloading = false;
}
