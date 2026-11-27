/**
 * Headless verification of `LynxLazyFor` (docs/30-virtual-list.md): a `<list>`
 * that knows all of its 10,000 rows while only a window of them is built.
 *
 * Runs the real renderer and Main-Thread executor against `virtualizingList`, an
 * imitation of a native list that virtualizes (it asks only for the cells on
 * screen, lets go of the ones that leave, and asks again for a cell an
 * `updateAction` refreshes), and proves:
 *  - the first batch builds 20 rows, and tells the list about all 10,000;
 *  - a jump far down shows empty cells, moves the window there, and fills them;
 *  - small scrolls inside the window build nothing; the window stays bounded;
 *  - prepending and removing rows keep the list's keys equal to the data's;
 *  - a sort of every row, and a search that removes the rows on screen, never
 *    take an element off the list while the list still holds its cell (what
 *    crashed Lynx Explorer 4.2: the engine reads it as it lets go);
 *  - the list asking for thousands of cells at once builds a capped window, which
 *    shrinks back once the list keeps only a screen;
 *  - removing the directive empties the list, and adding it back works;
 *  - the web preview builds every row;
 *  - nothing a device would reject (duplicate keys, malformed actions).
 *
 * Run with: `npm run verify:lazy-list`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal, ViewChild } from '@angular/core';

import { bootstrapLynxApplication, LynxLazyFor } from 'ng-lynx';
import { decodeOps, LAZY_ROWS_ATTR, OP } from 'ng-lynx/internal/ops';
import 'ng-lynx/main-thread';

// The same module instance the Main-Thread entry uses: esbuild bundles it once.
import { listStateSizes } from '../main-thread/src/list-apply.js';

import {
  assert,
  driveList,
  findAllByClass,
  findByType,
  getOpsLog,
  getPage,
  installMockPapi,
  type MockEl,
  opsLogMark,
  opsSince,
  tick,
  virtualizingList,
} from './mock-papi.js';

interface Row {
  id: number;
  name: string;
}

const ROW_COUNT = 10_000;

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: i, name: `row ${i}` }));
}

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [LynxLazyFor],
  template: `
    <list class="lazy" list-type="single" span-count="1" scroll-orientation="vertical">
      @if (show()) {
        <list-item
          *lynxLazyFor="let row of items(); trackBy: trackById; estimatedSize: 44; buffer: 10; initialCount: 20; let i = index"
        >
          <text>{{ row.name }} #{{ i }}</text>
        </list-item>
      }
    </list>
    @if (showWeb()) {
      <list class="web" list-type="single" span-count="1" scroll-orientation="vertical">
        <list-item *lynxLazyFor="let row of small(); trackBy: trackById">
          <text>{{ row.name }}</text>
        </list-item>
      </list>
    }
  `,
})
export class TestComponent {
  @ViewChild(LynxLazyFor) lazy?: LynxLazyFor<Row>;

  readonly show = signal(true);
  readonly showWeb = signal(false);
  readonly items = signal<Row[]>(makeRows(ROW_COUNT));
  readonly small = signal<Row[]>(makeRows(50));

  trackById = (_index: number, row: Row): number => row.id;
}

function countCreates(ops: unknown[], type: string): number {
  return decodeOps(ops).filter((r) => r.code === OP.CREATE && r.args[1] === type).length;
}

function textOf(el: MockEl | undefined): string {
  if (!el) return '';
  let text = el.text ?? '';
  for (const child of el.children) text += textOf(child);
  return text;
}

/**
 * Let the range report (a Main-Thread timer), the throttle (50 ms by default), the
 * Background reply and its flush all happen.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await tick();
  await new Promise((resolve) => setTimeout(resolve, 70));
  for (let i = 0; i < 4; i++) await tick();
}

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>)['renderPage']({});
  const bootMark = opsLogMark();
  const appRef = await bootstrapLynxApplication(TestComponent);
  const app = (appRef as { components: Array<{ instance: TestComponent }> }).components[0]!.instance;
  await settle();
  const page = getPage();
  const listEl = findAllByClass(page, 'lazy')[0] ?? (findByType(page, 'list') as MockEl);
  assert(!!listEl && listEl.type === 'list', 'sanity: the lazy <list> was created');
  const lazy = app.lazy!;
  assert(!!lazy, 'sanity: the LynxLazyFor instance is reachable');

  console.log('\n=== the first batch builds 20 rows and tells the list about all 10,000 ===');
  const bootOps = opsSince(bootMark);
  assert(countCreates(bootOps, 'list-item') === 20, `20 <list-item> CREATEs (got ${countCreates(bootOps, 'list-item')})`);
  const updates = (listEl.listUpdates ?? []) as { insertAction: Record<string, unknown>[] }[];
  const inserted = updates.flatMap((u) => u.insertAction);
  assert(inserted.length === ROW_COUNT, `the list was told about ${ROW_COUNT} rows (got ${inserted.length})`);
  assert(
    inserted.every((a, i) => a['item-key'] === String(i) && a['estimated-main-axis-size-px'] === 44 && a['type'] === 'list-item'),
    'each row arrives with its item-key, its estimated size and a type',
  );
  assert(!(LAZY_ROWS_ATTR in listEl.attrs), 'the row list stays on the Main Thread: it is never set on the element');

  const native = virtualizingList(listEl);
  native.layout(0, 9);
  assert(native.keys.length === ROW_COUNT, `the native list holds ${ROW_COUNT} keys (got ${native.keys.length})`);
  assert(native.emptyCells().length === 0, `the first screen is filled from the first batch (empty: ${native.emptyCells().join(',')})`);
  assert(textOf(native.cell(0)) === 'row 0 #0', `cell 0 shows row 0 (got "${textOf(native.cell(0))}")`);
  await settle();
  assert(lazy.builtRange.start === 0 && lazy.builtRange.end === 20, `still [0, 20) at rest (got [${lazy.builtRange.start}, ${lazy.builtRange.end}))`);

  console.log('\n=== a jump far down: empty cells, then the window moves and fills them ===');
  let mark = opsLogMark();
  native.layout(5000, 5009);
  assert(native.emptyCells().length === 10, `cells 5000-5009 are empty until their rows arrive (empty: ${native.emptyCells().length})`);
  await settle();
  assert(lazy.builtRange.start === 4990 && lazy.builtRange.end === 5020, `window moved to [4990, 5020) (got [${lazy.builtRange.start}, ${lazy.builtRange.end}))`);
  assert(countCreates(opsSince(mark), 'list-item') === 30, `30 rows built for it (got ${countCreates(opsSince(mark), 'list-item')})`);
  native.layout(5000, 5009);
  assert(native.emptyCells().length === 0, `the refreshed cells are filled (empty: ${native.emptyCells().join(',')})`);
  assert(textOf(native.cell(5000)) === 'row 5000 #5000', `cell 5000 shows row 5000 (got "${textOf(native.cell(5000))}")`);
  assert(textOf(native.cell(5009)) === 'row 5009 #5009', `cell 5009 shows row 5009 (got "${textOf(native.cell(5009))}")`);

  console.log('\n=== scrolling inside the window builds nothing ===');
  mark = opsLogMark();
  native.layout(5003, 5012);
  await settle();
  assert(countCreates(opsSince(mark), 'list-item') === 0, `no rows built (got ${countCreates(opsSince(mark), 'list-item')})`);
  assert(native.emptyCells().length === 0, 'no empty cells');

  console.log('\n=== scrolling past the margin moves the window in one step ===');
  native.layout(5012, 5021);
  await settle();
  native.layout(5012, 5021);
  assert(native.emptyCells().length === 0, `no empty cells after the step (empty: ${native.emptyCells().join(',')})`);
  const size = lazy.builtRange.end - lazy.builtRange.start;
  assert(size <= 30, `the window stays bounded: ${size} rows built, for 10 on screen and a buffer of 10`);

  console.log('\n=== prepending a row shifts every index, and the list follows ===');
  app.items.update((rows) => [{ id: -1, name: 'row -1' }, ...rows]);
  await settle();
  native.layout(5013, 5022);
  await settle();
  native.layout(5013, 5022);
  assert(native.keys.length === ROW_COUNT + 1 && native.keys[0] === '-1', `the list has ${ROW_COUNT + 1} keys, "-1" first (got ${native.keys.length}, "${native.keys[0]}")`);
  assert(native.emptyCells().length === 0, `no empty cells (empty: ${native.emptyCells().join(',')})`);
  assert(textOf(native.cell(5013)) === 'row 5012 #5013', `cell 5013 shows row 5012 at its new index (got "${textOf(native.cell(5013))}")`);

  console.log('\n=== removing a row on screen ===');
  app.items.update((rows) => rows.filter((row) => row.id !== 5015));
  await settle();
  native.layout(5013, 5022);
  await settle();
  native.layout(5013, 5022);
  assert(native.keys.length === ROW_COUNT && !native.keys.includes('5015'), 'row 5015 is gone from the list');
  assert(native.keys.every((key, i) => key === String(app.items()[i]!.id)), "the list's keys equal the data's, in order");
  assert(native.emptyCells().length === 0, `no empty cells (empty: ${native.emptyCells().join(',')})`);

  console.log('\n=== a fling to the end ===');
  native.layout(9990, 9999);
  await settle();
  native.layout(9990, 9999);
  assert(native.emptyCells().length === 0, `the last screen is filled (empty: ${native.emptyCells().join(',')})`);
  assert(textOf(native.cell(9999)) === 'row 9999 #9999', `the last cell shows row 9999 (got "${textOf(native.cell(9999))}")`);
  assert(lazy.builtRange.end === ROW_COUNT, `the window reaches the end (got ${lazy.builtRange.end})`);

  console.log('\n=== the list only ever asked for cells on screen ===');
  const asked = new Set(native.requests);
  assert(asked.size < 120, `${asked.size} distinct cells asked for, of ${ROW_COUNT}`);
  assert(native.errors.length === 0, `nothing a device would reject (got: ${native.errors.join('; ')})`);

  console.log('\n=== a very hard fling doesn\'t flood the Main Thread with batches ===');
  // The engine warns (code 20401) at 800 calls of one method in 5 s, 160 a second.
  // A fling moves the list 10 rows per step, a turn of the event loop apart, which is
  // faster than any thumb. Every window move is a batch of creates and destroys.
  const flingBatches = getOpsLog().length;
  const flingStarted = Date.now();
  for (let step = 0; step < 300; step++) {
    native.layout(1000 + step * 10, 1009 + step * 10);
    await tick();
  }
  await settle();
  native.layout(1000 + 299 * 10, 1009 + 299 * 10);
  await settle();
  const flingMs = Date.now() - flingStarted;
  const sent = getOpsLog().length - flingBatches;
  const perSecond = Math.round((sent / flingMs) * 1000);
  console.log(`    ${sent} batches in ${flingMs} ms: ${perSecond} a second`);
  assert(perSecond < 60, `under 60 batches a second, a third of the engine's limit (got ${perSecond})`);
  assert(native.emptyCells().length === 0, `and the screen the fling ended on is filled (empty: ${native.emptyCells().join(',')})`);
  assert(native.errors.length === 0, `nothing a device would reject (got: ${native.errors.join('; ')})`);

  // What crashed Lynx Explorer 4.2 in a real app (MyAssets): the engine's list
  // recycled a cell whose element had been taken off the list, and freed.
  console.log('\n=== a sort reorders every row while the list holds cells ===');
  const saved = app.items();
  native.layout(2990, 2999);
  await settle();
  native.layout(2990, 2999);
  mark = opsLogMark();
  app.items.update((rows) => [...rows].reverse());
  await settle();
  // The rows the list held moved to about index 7000; the list itself is still at
  // 2990. Wanting them back where they went moved the window there (on a device,
  // where the list went to the top, it built the 5,000 rows in between).
  assert(
    lazy.builtRange.start <= 2990 && lazy.builtRange.end >= 3000,
    `the window stays on the cells on screen (got [${lazy.builtRange.start}, ${lazy.builtRange.end}))`,
  );
  native.layout(2990, 2999);
  await settle();
  native.layout(2990, 2999);
  assert(native.keys.every((key, i) => key === String(app.items()[i]!.id)), "the list's keys follow the new order");
  assert(native.emptyCells().length === 0, `no empty cells (empty: ${native.emptyCells().join(',')})`);
  assert(textOf(native.cell(2990)) === `${app.items()[2990]!.name} #2990`, `cell 2990 shows the row now there (got "${textOf(native.cell(2990))}")`);
  assert(native.errors.length === 0, `no cell recycled after its element left the list (got: ${native.errors.join('; ')})`);
  const sorted = countCreates(opsSince(mark), 'list-item');
  assert(sorted <= 30, `the sort built one window of rows, not two (got ${sorted})`);

  console.log('\n=== the list asks for thousands of cells at once, then keeps a screen ===');
  // What the C++ list container did on a device after a sort moved every row: it
  // asked for every cell from the top down to its old scroll position.
  mark = opsLogMark();
  native.layout(0, 4000);
  native.layout(0, 9);
  await settle();
  native.layout(0, 9);
  await settle();
  native.layout(0, 9);
  const askedMany = countCreates(opsSince(mark), 'list-item');
  assert(askedMany <= 250, `one report builds at most a capped window, not 4,000 rows (built ${askedMany})`);
  assert(native.emptyCells().length === 0, `the screen it kept is filled (empty: ${native.emptyCells().join(',')})`);
  const settled = lazy.builtRange.end - lazy.builtRange.start;
  assert(settled <= 30, `and the window shrinks back to the screen and a buffer: ${settled} rows built`);
  assert(native.errors.length === 0, `nothing a device would reject (got: ${native.errors.join('; ')})`);

  console.log('\n=== a search removes most rows, the ones on screen included ===');
  app.items.update((rows) => rows.filter((row) => row.id % 1000 === 7));
  await settle();
  native.layout(0, 9);
  await settle();
  native.layout(0, 9);
  assert(native.keys.length === 10, `ten rows match (got ${native.keys.length})`);
  assert(native.emptyCells().length === 0, `the matches are shown (empty: ${native.emptyCells().join(',')})`);
  assert(native.errors.length === 0, `no cell recycled after its element left the list (got: ${native.errors.join('; ')})`);
  await settle();
  assert(listStateSizes()['retiring'] === 0, `the rows the list let go of left it (retiring: ${listStateSizes()['retiring']})`);
  app.items.set(saved);
  await settle();
  native.layout(0, 9);
  await settle();
  native.layout(0, 9);

  console.log('\n=== removing the directive empties the list; adding it back fills it ===');
  app.show.set(false);
  await settle();
  native.layout(0, 9);
  assert(native.keys.length === 0, `the list has no rows (got ${native.keys.length})`);
  app.show.set(true);
  await settle();
  native.layout(0, 9);
  assert(native.keys.length === ROW_COUNT, `all ${ROW_COUNT} rows are back (got ${native.keys.length})`);
  assert(native.emptyCells().length === 0, `the first screen is filled again (empty: ${native.emptyCells().join(',')})`);
  // The data still starts with the prepended row -1.
  assert(
    range(0, 9).every((i) => textOf(native.cell(i)) === `${app.items()[i]!.name} #${i}`),
    'cells 0-9 show the first ten rows of the data',
  );
  assert(native.errors.length === 0, `still nothing a device would reject (got: ${native.errors.join('; ')})`);

  console.log('\n=== the web preview builds every row ===');
  const g = globalThis as { SystemInfo?: Record<string, unknown> };
  g.SystemInfo = { ...(g.SystemInfo ?? {}), platform: 'web' };
  mark = opsLogMark();
  app.showWeb.set(true);
  await settle();
  assert(countCreates(opsSince(mark), 'list-item') === 50, `all 50 rows built (got ${countCreates(opsSince(mark), 'list-item')})`);
  const webList = findAllByClass(page, 'web')[0]!;
  driveList(webList);
  assert(webList.children.length === 50, `web-core attaches all 50 (got ${webList.children.length})`);

  console.log('\n=== nothing stays behind on the Main Thread ===');
  app.showWeb.set(false);
  app.show.set(false);
  await settle();
  // The list lets go of the cells it still held, and the rows retire.
  native.layout(0, 9);
  await settle();
  const sizes = listStateSizes();
  assert(sizes['lists'] === 1, `only the lazy <list> element is still tracked (got ${sizes['lists']})`);
  for (const name of ['lazyLists', 'lazySigns', 'lazyDetach', 'retiring', 'pendingReports', 'childEls', 'itemKeys', 'appended']) {
    assert(sizes[name] === 0, `${name} is empty (got ${sizes[name]})`);
  }

  console.log('\n✅ All LynxLazyFor assertions passed.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ LynxLazyFor verification failed:\n', err);
  process.exit(1);
});
