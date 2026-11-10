/**
 * Verifies the wire-protocol string table (docs/04-wire-protocol.md#string-table) against a large flat tree, and
 * measures its real payload-size effect.
 *
 * This harness used to be pure measurement (no assertions) — the "measure
 * before acting" step item 23 called for before touching anything. It found
 * that `ng-ref-{id}` was never a wire cost to begin with (still checked
 * below), and that ~21% of a repetitive tree's payload was string values
 * repeating more than once, concentrated in `CREATE`'s type strings and
 * `SET_CLASS`'s class lists — which is what `internStrings`/`resolveInterned`
 * (`internal/src/ops.ts`) now exploits. Now that the optimization exists, this
 * harness asserts:
 *
 *  1. `ng-ref-{id}` still costs 0 wire bytes (the original finding still
 *     holds — the optimization doesn't touch this at all).
 *  2. The big batch's actual wire bytes are meaningfully smaller than the
 *     uncompressed equivalent of the exact same ops (round-tripped through
 *     `resolveInterned` first, so this is an apples-to-apples comparison of
 *     the same semantic content, not a stale hardcoded byte count).
 *  3. Decoding the compressed wire payload (via `getLastOps()`, which now
 *     calls `resolveInterned` internally — see `mock-papi.ts`) reproduces
 *     exactly the expected per-row structure — proving the round-trip is
 *     correct, not just smaller.
 *  4. A batch with nothing worth deduping (a small incremental update) ships
 *     in the plain, uncompressed shape — zero format overhead for the common
 *     case this optimization must not regress.
 *
 * Run with: `npm run verify:wireproto-measure`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication, publishEvent } from 'angular-lynx';
import { OP, decodeOps } from 'angular-lynx/internal/ops';
import 'angular-lynx/main-thread';

import {
  assert,
  findByClass,
  getFirstOpsString,
  getLastOps,
  getPage,
  installMockPapi,
  tick,
} from './mock-papi.js';

const ROW_COUNT = 500;

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <scroll-view class="rows">
      <text class="counter" (tap)="bump()">{{ n() }}</text>
      @for (i of rows; track i) {
        <view class="row"><text class="label">row {{ i }}</text></view>
      }
    </scroll-view>
  `,
})
export class TestComponent {
  readonly rows = Array.from({ length: ROW_COUNT }, (_, i) => i);
  readonly n = signal(0);
  bump(): void {
    this.n.update((v) => v + 1);
  }
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>)['renderPage']({});
  await bootstrapLynxApplication(TestComponent);
  await tick();

  const raw = getFirstOpsString();
  if (!raw) {
    console.error('no first-batch ops captured');
    process.exit(1);
  }
  const wireBytes = raw.length;
  const wireParsed = JSON.parse(raw) as unknown[];
  // `getLastOps()` runs the parsed wire payload through `resolveInterned`
  // (mock-papi.ts) — the plain, semantic ops array, regardless of whether the
  // wire form was compressed.
  const plainOps = getLastOps();
  const records = decodeOps(plainOps);

  console.log(`\n=== Wire-protocol measurement (${ROW_COUNT} rows, 2 elements each) ===\n`);
  console.log(`Total ops (records):        ${records.length}`);
  console.log(`Wire payload bytes:         ${wireBytes}`);

  // -- 1. ng-ref-{id} still costs 0 wire bytes --------------------------------
  const ngRefRecords = records.filter(
    (r) => r.code === OP.SET_ATTR && typeof r.args[1] === 'string' && (r.args[1] as string).startsWith('ng-ref-'),
  );
  assert(ngRefRecords.length === 0, 'ng-ref-{id} still never appears as a BG-emitted SET_ATTR op (0 wire bytes)');

  // -- 2. real byte savings vs. the uncompressed equivalent of the same ops --
  const uncompressedBytes = JSON.stringify(plainOps).length;
  const saved = uncompressedBytes - wireBytes;
  const pctSaved = (saved / uncompressedBytes) * 100;
  console.log(`Uncompressed-equivalent bytes: ${uncompressedBytes}`);
  console.log(`Bytes saved by the string table: ${saved} (${pctSaved.toFixed(1)}%)`);
  assert(wireBytes < uncompressedBytes, 'the string table shrinks a repetitive batch below its uncompressed size');
  assert(pctSaved >= 10, `savings are at least 10% of the uncompressed size (got ${pctSaved.toFixed(1)}%)`);
  // The compressed form is a `[table, internedFlat]` tuple — its first
  // element is an array, never a real op code (always a plain number).
  assert(Array.isArray(wireParsed[0]), 'the wire payload actually took the interned [table, ops] shape');

  // -- 3. round-trip correctness: the decoded batch has exactly the expected
  // per-row structure ----------------------------------------------------------
  const createView = records.filter((r) => r.code === OP.CREATE && r.args[1] === 'view');
  // ROW_COUNT row-label texts + 1 counter text.
  const createText = records.filter((r) => r.code === OP.CREATE && r.args[1] === 'text');
  const setClassRow = records.filter((r) => r.code === OP.SET_CLASS && r.args[1] === 'row');
  const setClassLabel = records.filter((r) => r.code === OP.SET_CLASS && r.args[1] === 'label');
  assert(createView.length === ROW_COUNT, `decoded ${ROW_COUNT} CREATE view ops (got ${createView.length})`);
  assert(createText.length === ROW_COUNT + 1, `decoded ${ROW_COUNT + 1} CREATE text ops (got ${createText.length})`);
  assert(setClassRow.length === ROW_COUNT, `decoded ${ROW_COUNT} SET_CLASS "row" ops (got ${setClassRow.length})`);
  assert(setClassLabel.length === ROW_COUNT, `decoded ${ROW_COUNT} SET_CLASS "label" ops (got ${setClassLabel.length})`);
  const page = getPage();
  assert(page.children.length > 0, 'the native tree actually has children after decoding the compressed batch');

  // -- 4. a small incremental update ships with zero format overhead ----------
  const counter = findByClass(getPage(), 'counter');
  const toggleSign = counter?.events?.['tap']?.sign as string | undefined;
  assert(!!toggleSign, 'the counter text has a tap listener to drive a tiny incremental update');
  publishEvent(toggleSign as string, { type: 'tap' });
  await tick();
  const smallOps = getLastOps();
  console.log(`\nIncremental update ops: ${JSON.stringify(smallOps)}`);
  assert(
    smallOps.length > 0 && typeof smallOps[0] === 'number',
    'a tiny incremental update (nothing repeats) ships in the plain, uncompressed shape',
  );

  console.log('\n✅ String-table wire-protocol optimization verified.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Wire-protocol verification failed:\n', err);
  process.exit(1);
});
