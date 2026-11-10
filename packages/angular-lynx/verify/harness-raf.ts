/**
 * Headless verification of the portable frame scheduler
 * (`lynxRequestAnimationFrame` / `lynxCancelAnimationFrame`).
 *
 * Two paths:
 *   1. **Fallback** — Node has no global `requestAnimationFrame`, so the
 *      wrapper degrades to `setTimeout`: a scheduled callback fires, and a
 *      cancelled one does not.
 *   2. **Delegation** — with a spy `globalThis.requestAnimationFrame` installed,
 *      the wrapper uses it (and `cancelAnimationFrame`) instead of the timer.
 *
 * Run with: `npm run verify:raf`.
 */
import { lynxCancelAnimationFrame, lynxRequestAnimationFrame } from 'angular-lynx';

import { assert } from './mock-papi.js';

const g = globalThis as Record<string, unknown>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  // --- 1. Fallback (no native rAF) ---------------------------------------
  console.log('\n=== Fallback path (setTimeout, no native rAF) ===');
  assert(typeof g['requestAnimationFrame'] === 'undefined', 'sanity: Node has no global requestAnimationFrame');

  let firedTime: number | undefined;
  lynxRequestAnimationFrame((t) => {
    firedTime = t;
  });
  await sleep(40);
  assert(firedTime !== undefined, 'a scheduled callback fired via the setTimeout fallback');
  assert(typeof firedTime === 'number', 'the callback received a numeric timestamp');

  let cancelledRan = false;
  const handle = lynxRequestAnimationFrame(() => {
    cancelledRan = true;
  });
  lynxCancelAnimationFrame(handle);
  await sleep(40);
  assert(cancelledRan === false, 'a cancelled callback never fired (fallback clearTimeout)');

  // --- 2. Delegation (native rAF present) --------------------------------
  console.log('\n=== Delegation path (native rAF present) ===');
  let rafCalledWith: ((t: number) => void) | undefined;
  let cancelledId: number | undefined;
  g['requestAnimationFrame'] = (cb: (t: number) => void): number => {
    rafCalledWith = cb;
    return 4242;
  };
  g['cancelAnimationFrame'] = (id: number): void => {
    cancelledId = id;
  };
  try {
    const id = lynxRequestAnimationFrame(() => {});
    assert(id === 4242, 'lynxRequestAnimationFrame delegated to the native rAF (returned its handle)');
    assert(typeof rafCalledWith === 'function', 'native rAF received the callback');

    lynxCancelAnimationFrame(id);
    assert(cancelledId === 4242, 'lynxCancelAnimationFrame delegated to the native cancelAnimationFrame');
  } finally {
    delete g['requestAnimationFrame'];
    delete g['cancelAnimationFrame'];
  }

  console.log('\n✅ Frame-scheduler wrapper works — native rAF when present, setTimeout fallback otherwise.\n');
}

main().catch((err) => {
  console.error('\n❌ rAF verification failed:\n', err);
  process.exit(1);
});
