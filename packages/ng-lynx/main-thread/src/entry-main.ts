/**
 * Main Thread (Lepus) bootstrap entry.
 *
 * The build plugin makes this the entry of the main-thread bundle. It installs
 * the globals the Lynx Lepus runtime expects, creates the page root, and exposes
 * the patch method that the Background Thread calls to ship render ops.
 */
import {
  ADOPT_STYLE_SHEET_METHOD,
  PAGE_ROOT_ID,
  PATCH_METHOD,
  RELEASE_MAIN_THREAD_REF_METHOD,
  RUN_ON_MAIN_THREAD_METHOD,
} from 'ng-lynx/internal/ops';

import { processData } from './data-processors.js';
import { elements, setPageUniqueId } from './element-registry.js';
import {
  applyFirstScreen,
  consumeFirstScreenBatch,
  resetFirstScreenPageState,
  setFirstScreenOps,
} from './first-screen.js';
import { applyOps, clearPageForReload, resetMainThreadState } from './ops-apply.js';
import { applyAdoptStyleSheet } from './style-sheet.js';
import { applyReleaseMainThreadRef, applyRunOnMainThread } from './worklet-apply.js';

// Public API of the Main-Thread entry: install a build-time first-screen
// snapshot (see first-screen.ts). Re-exported so the module the plugin
// generates (and tests) can `import { setFirstScreenOps } from
// 'ng-lynx/main-thread'`.
export { setFirstScreenOps };

const g = globalThis as Record<string, unknown>;

// Expose SystemInfo on globalThis (consumed by parts of the Lynx runtime).
g['SystemInfo'] = (typeof lynx !== 'undefined' && lynx.SystemInfo) ?? {};

// Lepus requires a data processor. It passes data through unless the app registers one.
g['processData'] = processData;

// Lynx calls renderPage on the Main Thread before the Background JS runs.
// Create the page root and store it as id=1 so background INSERT ops targeting
// the root resolve correctly.
g['renderPage'] = function (_data: unknown): void {
  // Clear state from any previous page (matters for hot reload and tests).
  resetMainThreadState();
  resetFirstScreenPageState();
  const page = __CreatePage('0', 0);
  // Global CSS scope so the page's style-sheet manager is populated.
  __SetCSSId([page], 0);
  setPageUniqueId(__GetElementUniqueID(page));
  elements.set(PAGE_ROOT_ID, page);
  // If a build-time first-screen snapshot is installed, paint it now —
  // synchronously, before the Background Thread has booted Angular. The same
  // in-renderPage flush pattern ReactLynx IFR uses.
  applyFirstScreen();
  __FlushElementTree(page);
};

// `lynx.reload()`, step 1: the engine asks the Main Thread to drop the old
// page. Then the Background Thread bootstraps the app again (`tt.onAppReload`)
// and sends a fresh first batch onto the empty page.
g['removeComponents'] = function (): void {
  clearPageForReload();
  const page = elements.get(PAGE_ROOT_ID);
  if (page) __FlushElementTree(page);
};

// No Main-Thread data binding: the Background Thread owns the data. A reload's
// `updatePage` (`reloadTemplate`) only has to close the engine's pipeline.
g['updatePage'] = function (_data: unknown, options?: Record<string, unknown>): void {
  if (!options?.['reloadTemplate']) return;
  const page = elements.get(PAGE_ROOT_ID);
  if (page) __FlushElementTree(page, options);
};
g['updateGlobalProps'] = function (_data: unknown): void {};

// Called by the Background Thread via
// callLepusMethod(PATCH_METHOD, { data, epoch }).
g[PATCH_METHOD] = function (
  { data, epoch, plain, locations }: { data: string; epoch?: string; plain?: string; locations?: string },
): void {
  // With a first-screen snapshot painted, the Background Thread's first batch
  // is compared byte-for-byte: identical → already on screen, drop it
  // (element ids and event signs line up by determinism); different → the
  // snapshot was torn down and this batch applies onto a clean page. A
  // development build's first batch carries a `plain` form without template
  // source mapping, which is what the snapshot was captured as; on a match the
  // snapshot's elements still get their source locations.
  if (consumeFirstScreenBatch(plain ?? data)) {
    if (locations) applyOps(JSON.parse(locations) as unknown[], epoch);
    return;
  }
  applyOps(JSON.parse(data) as unknown[], epoch);
};

// `runOnMainThread` and `mainThreadRef()`'s cleanup, from the Background Thread.
g[RUN_ON_MAIN_THREAD_METHOD] = applyRunOnMainThread;
g[RELEASE_MAIN_THREAD_REF_METHOD] = applyReleaseMainThreadRef;
// `fetchBundle`'s stylesheet, adopted once a bundle's component is about to mount.
g[ADOPT_STYLE_SHEET_METHOD] = applyAdoptStyleSheet;
