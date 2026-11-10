/**
 * Headless verification that `examples/virtual-list`'s window goes quiet when the list does.
 *
 * Changing the window changes the native list, and the native list answers with events.
 * Removing rows above the screen lowers `scrollTop` while the same rows stay on screen, and
 * fires `scroll` and maybe `scrolltoupper`. Reading that as the user scrolling up grew the
 * window back, the next settle trimmed it, and on a real iPhone the window flipped between
 * two values forever with nobody touching the screen.
 *
 * This runs the real component against an imitation of those answers, and asserts that the
 * window stops changing, keeps the runway, and still reaches both ends of the array.
 *
 * Run with: `npm run verify:virtual-list-idle`.
 */
import '@angular/compiler';

import { bootstrapLynxApplication } from 'angular-lynx';
import 'angular-lynx/main-thread';

import { AppComponent } from '../../../examples/virtual-list/src/app.component.js';
import { assert, installMockPapi } from './mock-papi.js';

const ROW_HEIGHT = 48;
const ROWS_ON_SCREEN = 15;
const ROW_COUNT = 5000;
/** `EDGE_THRESHOLD_ROWS` in the example. */
const EDGE_THRESHOLD = 100;
/** Longer than the example's 200 ms settle debounce. */
const SETTLE_MS = 400;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

installMockPapi();
(globalThis as unknown as { renderPage(data: object): void }).renderPage({});
const appRef = await bootstrapLynxApplication(AppComponent);
const app = appRef.components[0]!.instance as unknown as {
  virtualRows: {
    materializedRange: { start: number; end: number };
    updateVisibleRange(start: number, end: number, options?: object): void;
  };
  listRef: unknown;
  onScroll(event: unknown): void;
};

/** The row at the top of the screen. Only the user moves it: changing the window doesn't. */
let topRow = 0;
const rowsFrom = (first: number, count: number): { itemKey: string }[] =>
  Array.from({ length: count }, (_, i) => ({ itemKey: String(first + i) }));
/** `scroll` reports the attached cells, a row wider than what `getVisibleCells` reports. */
const event = (): unknown => {
  const { start } = app.virtualRows.materializedRange;
  return {
    detail: {
      // Counts what's materialized above, so it moves when the window does.
      scrollTop: (topRow - start) * ROW_HEIGHT,
      listHeight: ROWS_ON_SCREEN * ROW_HEIGHT,
      attachedCells: rowsFrom(Math.max(0, topRow - 1), ROWS_ON_SCREEN + 2),
    },
  };
};
app.listRef = {
  nativeElement: {
    invoke: (options: { success(res: unknown): void }) =>
      options.success({ attachedCells: rowsFrom(topRow, ROWS_ON_SCREEN) }),
  },
};

const windowOf = (): string => {
  const { start, end } = app.virtualRows.materializedRange;
  return `[${start}, ${end})`;
};

/** What the native list does some time after its rows change, with nobody touching it. */
function answerFromNativeList(): void {
  const { start, end } = app.virtualRows.materializedRange;
  app.onScroll(event());
  if (topRow - start < EDGE_THRESHOLD) app.onScroll(event()); // scrolltoupper
  if (end - (topRow + ROWS_ON_SCREEN) < EDGE_THRESHOLD) app.onScroll(event()); // scrolltolower
}

let changes = 0;
const update = app.virtualRows.updateVisibleRange.bind(app.virtualRows);
app.virtualRows.updateVisibleRange = (...args) => {
  const before = windowOf();
  update(...args);
  if (windowOf() !== before) {
    changes += 1;
    setTimeout(answerFromNativeList, 5);
  }
};

/** Nobody touches the list for this long. Returns how many times the window changed. */
async function idle(ms: number): Promise<number> {
  const before = changes;
  await sleep(ms);
  return changes - before;
}

async function scrollTo(row: number, step: number): Promise<void> {
  while (topRow !== row) {
    topRow = step > 0 ? Math.min(row, topRow + step) : Math.max(row, topRow + step);
    app.onScroll(event());
    await sleep(1);
  }
}

console.log('\n=== Scrolled down, then left alone ===');
await scrollTo(400, 20);
await idle(SETTLE_MS);
const settled = windowOf();
console.log(`settled at ${settled}`);
assert((await idle(1500)) === 0, 'the window stops changing when nobody touches the list');
assert(windowOf() === settled, 'and stays where it settled');
{
  const { start, end } = app.virtualRows.materializedRange;
  assert(start <= topRow && end >= topRow + ROWS_ON_SCREEN, 'what is on screen stays materialized');
  assert(end - (topRow + ROWS_ON_SCREEN) >= 250, 'the runway ahead survives settling');
  assert(topRow - start <= 100, 'what fell far behind is trimmed');
}

console.log('\n=== A wobble of a row or two is not a change of direction ===');
const beforeWobble = windowOf();
topRow -= 1;
app.onScroll(event());
await idle(SETTLE_MS);
topRow += 1;
app.onScroll(event());
await idle(SETTLE_MS);
assert(windowOf() === beforeWobble, `the window didn't move: ${windowOf()}`);

console.log('\n=== Scrolling back up moves the runway to the other side ===');
await scrollTo(topRow - 100, -20);
await idle(SETTLE_MS);
console.log(`settled at ${windowOf()}`);
assert((await idle(1000)) === 0, 'the window stops changing after turning around');
{
  const { start, end } = app.virtualRows.materializedRange;
  assert(topRow - start >= 250, 'the runway is now above');
  assert(end <= topRow + ROWS_ON_SCREEN + 100, 'and what was ahead is trimmed');
}

console.log('\n=== Both ends of the array stay reachable ===');
await scrollTo(ROW_COUNT - ROWS_ON_SCREEN, 400);
await idle(SETTLE_MS);
assert(app.virtualRows.materializedRange.end === ROW_COUNT, `the last row is materialized: ${windowOf()}`);
assert((await idle(1000)) === 0, 'and the window is quiet there');
await scrollTo(0, -400);
await idle(SETTLE_MS);
assert(app.virtualRows.materializedRange.start === 0, `the first row is materialized: ${windowOf()}`);
assert((await idle(1000)) === 0, 'and the window is quiet there too');

console.log('\n✅ All virtual-list idle assertions passed.\n');
process.exit(0);
