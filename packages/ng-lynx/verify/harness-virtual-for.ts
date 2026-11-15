/**
 * Headless verification of `LynxVirtualFor` — windowed materialization for
 * huge lists (`docs/30-virtual-list.md`).
 *
 * Renders 1000 rows inside a `<list>` via `*lynxVirtualFor` and proves:
 *  - only `lynxVirtualForInitialCount` rows get real ops/elements at first —
 *    not all 1000;
 *  - `updateVisibleRange()` shifts the window: rows entering it get CREATE
 *    ops, rows leaving it get DESTROY ops, in exactly the expected counts;
 *  - rows that stay in the window across a shift are **not** destroyed and
 *    recreated (trackBy identity preserved — the same guarantee `<list>`'s
 *    own item-key handling already depends on, see `docs/08-lists.md`);
 *  - `<list>`'s own `update-list-info`/`componentAtIndex` machinery only
 *    ever gets asked about windowed rows (via `driveList`), proving the
 *    native side never sees more than the window at once.
 *
 * Run with: `npm run verify:virtual-for`.
 */
import '@angular/compiler';

import { Component, type ElementRef, NO_ERRORS_SCHEMA, signal, ViewChild } from '@angular/core';

import { bootstrapLynxApplication, LynxVirtualFor } from 'ng-lynx';
import { OP } from 'ng-lynx/internal/ops';
import 'ng-lynx/main-thread';

import {
  assert,
  driveList,
  findByType,
  findText,
  getLastOps,
  getPage,
  installMockPapi,
  type MockEl,
  opsLogMark,
  opsSince,
  tick,
} from './mock-papi.js';

interface Row {
  id: number;
  name: string;
}

const ROW_COUNT = 1000;

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [LynxVirtualFor],
  template: `
    <list list-type="single" span-count="1" scroll-orientation="vertical">
      <ng-template
        lynxVirtualFor
        let-row
        #rows="lynxVirtualFor"
        [lynxVirtualForOf]="items()"
        [lynxVirtualForTrackBy]="trackById"
        [lynxVirtualForInitialCount]="20"
        [lynxVirtualForBufferSize]="5"
      >
        <list-item [attr.item-key]="row.id" estimated-main-axis-size-px="44">
          <text class="label">{{ row.name }}</text>
        </list-item>
      </ng-template>
    </list>
  `,
})
export class TestComponent {
  @ViewChild('rows') rows!: LynxVirtualFor<Row>;

  readonly items = signal<Row[]>(
    Array.from({ length: ROW_COUNT }, (_, i) => ({ id: i, name: `row ${i}` })),
  );

  trackById = (_index: number, row: Row): number => row.id;
}

const OP_ARITY: Record<number, number> = {
  [OP.CREATE]: 2, [OP.CREATE_TEXT]: 1, [OP.INSERT]: 3, [OP.REMOVE]: 2,
  [OP.SET_ATTR]: 3, [OP.SET_TEXT]: 2, [OP.SET_EVENT]: 4, [OP.REMOVE_EVENT]: 3,
  [OP.SET_STYLE]: 2, [OP.SET_CLASS]: 2, [OP.REMOVE_ATTR]: 2,
  [OP.SET_WORKLET_EVENT]: 4, [OP.DESTROY]: 1, [OP.SET_REF]: 2,
};

function decode(ops: unknown[]): unknown[][] {
  const records: unknown[][] = [];
  let i = 0;
  while (i < ops.length) {
    const code = ops[i] as number;
    const n = OP_ARITY[code] ?? 0;
    records.push(ops.slice(i, i + 1 + n));
    i += 1 + n;
  }
  return records;
}

function countCreates(ops: unknown[], type: string): number {
  return decode(ops).filter((r) => r[0] === OP.CREATE && r[2] === type).length;
}

function countDestroys(ops: unknown[]): number {
  return decode(ops).filter((r) => r[0] === OP.DESTROY).length;
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>)['renderPage']({});
  const appRef = await bootstrapLynxApplication(TestComponent);
  const app = (appRef as { components: Array<{ instance: TestComponent }> }).components[0]!.instance;
  await tick();
  await tick();
  const page = getPage();
  const listEl = findByType(page, 'list') as MockEl;
  assert(!!listEl, 'sanity: the <list> element was created');

  console.log('\n=== initial render only materializes the window, not all 1000 rows ===');
  assert(app.rows.materializedRange.start === 0 && app.rows.materializedRange.end === 20, `initial window is [0, 20), got [${app.rows.materializedRange.start}, ${app.rows.materializedRange.end})`);
  const initialCreates = countCreates(getLastOps(), 'list-item');
  assert(initialCreates === 20, `exactly 20 <list-item> CREATE ops on first render (got ${initialCreates}) — not 1000`);

  driveList(listEl);
  assert(listEl.children.length === 20, `native <list> only ever asked for 20 cells (got ${listEl.children.length})`);
  assert(findText(page, 'row 0') != null, 'row 0 is materialized and attached');
  assert(findText(page, 'row 999') == null, 'row 999 is nowhere near materialized');

  console.log('\n=== scrolling forward shifts the window: old rows destroyed, new rows created ===');
  // buffer=5: updateVisibleRange(30, 40) -> [max(0,25), min(1000,46)) = [25, 46).
  // No overlap with [0, 20) -> a full swap: 21 new rows, 20 old rows gone.
  //
  // Called directly (not from a signal write), this work happens outside an
  // active change-detection walk: the bare CREATE/INSERT ops flush
  // immediately, but the new views' bindings (item-key, text) are only
  // evaluated once Angular's zoneless scheduler runs their first CD pass —
  // a *separate* flush. opsSince(mark) sees both; getLastOps() would only
  // see whichever happened to flush last.
  const shiftMark = opsLogMark();
  app.rows.updateVisibleRange(30, 40);
  await tick();
  await tick();
  assert(app.rows.materializedRange.start === 25 && app.rows.materializedRange.end === 46, `window shifted to [25, 46), got [${app.rows.materializedRange.start}, ${app.rows.materializedRange.end})`);
  const shiftOps = opsSince(shiftMark);
  assert(countCreates(shiftOps, 'list-item') === 21, `21 new <list-item> CREATE ops for the shift (got ${countCreates(shiftOps, 'list-item')})`);
  // destroyNode walks the whole subtree per row (list-item + text + raw-text
  // = 3 nodes), so 20 departed rows means 60 DESTROY ops, not 20.
  assert(countDestroys(shiftOps) === 60, `60 DESTROY ops for the 20 rows that left the window, 3 nodes each (got ${countDestroys(shiftOps)})`);

  console.log('\n=== a range shift that narrows fully inside the current window creates nothing, only trims ===');
  // buffer=5: updateVisibleRange(35, 35) -> [30, 41), a strict subset of the
  // current [25, 46) — rows 25-29 and 41-45 (10 total) leave, 0 are new.
  const narrowMark = opsLogMark();
  app.rows.updateVisibleRange(35, 35);
  await tick();
  await tick();
  assert(app.rows.materializedRange.start === 30 && app.rows.materializedRange.end === 41, `window narrowed to [30, 41), got [${app.rows.materializedRange.start}, ${app.rows.materializedRange.end})`);
  const narrowOps = opsSince(narrowMark);
  assert(countCreates(narrowOps, 'list-item') === 0, `no new <list-item> CREATE ops — every surviving row is reused, not recreated (got ${countCreates(narrowOps, 'list-item')})`);
  assert(countDestroys(narrowOps) === 30, `30 DESTROY ops for the 10 trimmed-edge rows, 3 nodes each (got ${countDestroys(narrowOps)})`);

  console.log('\n=== shrink: false unions with the current window instead of replacing it — nothing is destroyed ===');
  // Current window [30, 41). buffer=5: updateVisibleRange(200, 200) alone
  // would compute [195, 206) and replace the window outright. shrink:false
  // unions that with the current window instead: [min(195,30), max(206,41))
  // = [30, 206) — the old rows stay materialized alongside the new ones.
  const growMark = opsLogMark();
  app.rows.updateVisibleRange(200, 200, { shrink: false });
  await tick();
  await tick();
  assert(app.rows.materializedRange.start === 30 && app.rows.materializedRange.end === 206, `grow-only window is [30, 206), got [${app.rows.materializedRange.start}, ${app.rows.materializedRange.end})`);
  const growOps = opsSince(growMark);
  assert(countCreates(growOps, 'list-item') === 165, `165 new <list-item> CREATE ops for the newly-covered rows (got ${countCreates(growOps, 'list-item')})`);
  assert(countDestroys(growOps) === 0, `shrink: false destroys nothing — the old rows stay materialized too (got ${countDestroys(growOps)} DESTROY ops)`);

  console.log('\n=== a later shrink: true call reclaims the rows the grow-only call kept around ===');
  const shrinkMark = opsLogMark();
  app.rows.updateVisibleRange(200, 200);
  await tick();
  await tick();
  assert(app.rows.materializedRange.start === 195 && app.rows.materializedRange.end === 206, `shrunk back to [195, 206), got [${app.rows.materializedRange.start}, ${app.rows.materializedRange.end})`);
  const shrinkOps = opsSince(shrinkMark);
  assert(countCreates(shrinkOps, 'list-item') === 0, `no new creates on the shrink pass — every surviving row is reused (got ${countCreates(shrinkOps, 'list-item')})`);
  // 195-30=165 rows leave from the start, 206 is unchanged at the end -> 165
  // rows x 3 nodes each (list-item + text + raw-text) = 495 DESTROY ops.
  assert(countDestroys(shrinkOps) === 495, `495 DESTROY ops for the 165 rows reclaimed on shrink, 3 nodes each (got ${countDestroys(shrinkOps)})`);

  console.log('\n=== the window is clamped to the array bounds near the end ===');
  app.rows.updateVisibleRange(995, 999);
  await tick();
  await tick();
  assert(app.rows.materializedRange.end === 1000, `window end clamps to array length 1000, got ${app.rows.materializedRange.end}`);
  // driveList attaches whatever the native list has been told about via
  // update-list-info — needed again here since the last driveList() call
  // was right after the initial render, before any of these shifts.
  driveList(listEl);
  assert(findText(page, 'row 999') != null, 'the last row is materialized once scrolled to');

  console.log('\n✅ All LynxVirtualFor assertions passed.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ LynxVirtualFor verification failed:\n', err);
  process.exit(1);
});
