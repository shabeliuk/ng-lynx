/**
 * First-screen snapshot (IFR) — paint the first frame on the Main Thread,
 * before the Background Thread has even booted Angular.
 *
 * ReactLynx gets its instant first frame by rendering components on the Main
 * Thread inside `renderPage()`. Angular can't run on Lepus — but its first
 * render is (normally) deterministic, so ng-lynx closes the gap with a
 * **build-time snapshot**:
 *
 *  1. **Capture** — `captureFirstScreenOps()` (ng-lynx/testing) runs the
 *     app headlessly in Node and records the exact serialized string of the
 *     first ops batch the renderer ships to the Main Thread.
 *  2. **Embed** — `pluginAngularLynx({ firstScreen })` bundles a tiny module
 *     into the Main-Thread bundle that calls {@link setFirstScreenOps} with
 *     that string.
 *  3. **Replay** — `renderPage()` applies the snapshot synchronously via
 *     {@link applyFirstScreen}: the native UI paints in the very first flush,
 *     with zero Background-Thread involvement.
 *  4. **Hydrate** — when the real Angular app boots and flushes its first
 *     batch, {@link consumeFirstScreenBatch} compares it **byte-for-byte**
 *     with the snapshot:
 *     - *identical* (the common case — element ids and event signs are
 *       deterministic counters reset per boot, so the same app produces the
 *       same string): the batch is dropped. Every id the Background Thread
 *       will ever reference already maps to a live element, and every event
 *       sign the snapshot registered natively has a Background handler under
 *       the same name. Adoption for free.
 *     - *different* (nondeterministic first render — host `initData` in the
 *       template, dates, randomness): the snapshot's elements are torn down
 *       and the real batch applies normally. Graceful fallback to today's
 *       behavior; correctness never depends on determinism.
 *
 * The snapshot string is **bundle-lifetime** (set at module load, like worklet
 * registrations); the expecting/teardown bookkeeping is **page-lifetime**
 * (reset by `renderPage`).
 */
import { decodeOps, FIRST_SCREEN_RESOLVED_EVENT, OP, PAGE_ROOT_ID, resolveInterned } from 'ng-lynx/internal/ops';

import { elements } from './element-registry.js';
import { applyOps } from './ops-apply.js';

let snapshotString: string | null = null;

let expecting = false;
let snapshotElementIds: number[] = [];
let snapshotRootIds: number[] = [];

/**
 * Install the captured first-screen ops (the serialized string produced by
 * `captureFirstScreenOps`). Called at Main-Thread bundle load by the module
 * `pluginAngularLynx({ firstScreen })` generates.
 *
 * @public
 */
export function setFirstScreenOps(ops: string): void {
  snapshotString = ops;
}

/** Reset the page-lifetime state. Called by `renderPage` before applying. */
export function resetFirstScreenPageState(): void {
  expecting = false;
  snapshotElementIds = [];
  snapshotRootIds = [];
}

/**
 * Apply the snapshot (if one is installed) onto the freshly-created page.
 * Called synchronously inside `renderPage`, after the page root is registered.
 * Records which elements the snapshot created (and which are direct children
 * of the page) so a mismatching real batch can tear them down.
 */
export function applyFirstScreen(): void {
  if (!snapshotString) return;
  let flat: unknown[];
  try {
    // Normalize a possibly string-table-compressed snapshot to the plain
    // flat form before this function's own CREATE/INSERT scan below (and the
    // `applyOps` call, which would otherwise resolve it a second time —
    // harmless, since resolveInterned is idempotent on an already-plain
    // array, but doing it once here keeps both uses consistent).
    flat = resolveInterned(JSON.parse(snapshotString) as unknown[]);
  } catch {
    if (__DEV__) console.log('[ng-lynx] first-screen snapshot is not valid JSON — ignored');
    snapshotString = null;
    return;
  }
  for (const record of decodeOps(flat)) {
    if (record.code === OP.CREATE || record.code === OP.CREATE_TEXT) {
      snapshotElementIds.push(record.args[0] as number);
    } else if (record.code === OP.INSERT && record.args[0] === PAGE_ROOT_ID) {
      snapshotRootIds.push(record.args[1] as number);
    }
  }
  applyOps(flat);
  expecting = true;
}

/**
 * Called with the raw `data` string of every `ngPatchUpdate` batch, before it
 * is parsed. Returns `true` when the batch was the Background Thread's first
 * batch and matched the snapshot byte-for-byte — the caller must then skip
 * applying it. On a mismatch the snapshot's elements are removed first and
 * `false` is returned so the real batch applies onto a clean page.
 */
export function consumeFirstScreenBatch(data: string): boolean {
  if (!expecting) return false;
  expecting = false;
  const matched = data === snapshotString;
  // Tell the Background Thread whether it's safe to replay any
  // `publishEvent` calls that arrived — via a real native tap on the
  // snapshot-painted UI — before the real app had registered its handlers
  // (event-registry.ts buffers those; see docs/20-first-screen.md). Only
  // reached when a snapshot was actually in play (the `!expecting` guard
  // above), so an app that never configures `firstScreen` never sends this.
  lynx?.getJSContext?.()?.dispatchEvent({
    type: FIRST_SCREEN_RESOLVED_EVENT,
    data: { matched },
  });
  if (matched) {
    if (__DEV__) {
      console.log('[ng-lynx] first-screen snapshot matched — hydrated in place');
    }
    return true;
  }
  if (__DEV__) {
    console.log(
      '[ng-lynx] first-screen snapshot did NOT match the real first render — '
        + 'tearing it down and re-rendering (is the first render nondeterministic, '
        + 'e.g. host initData in the template?)',
    );
  }
  teardownSnapshot();
  return false;
}

function teardownSnapshot(): void {
  const page = elements.get(PAGE_ROOT_ID);
  for (const id of snapshotRootIds) {
    const el = elements.get(id);
    if (page && el) __RemoveElement(page, el);
  }
  for (const id of snapshotElementIds) {
    elements.delete(id);
  }
  snapshotRootIds = [];
  snapshotElementIds = [];
}

/**
 * `__DEV__` is replaced at build time by the bundler `define`. Declared here so
 * the source type-checks standalone.
 */
declare const __DEV__: boolean;
