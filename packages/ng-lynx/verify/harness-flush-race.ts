/**
 * Headless regression test for a `whenFlushed()` concurrency bug found while
 * building `examples/ui-gallery`.
 *
 * `flush.ts` used to track exactly one in-flight batch via a single shared
 * `resolve` slot: `flushOps()` created `pendingAckPromise`/`pendingAckResolve`
 * for the batch it was about to send, and the Main-Thread ack callback closed
 * over the *variable*, not a snapshot. If a second batch was sent before the
 * first one's ack arrived, the second `flushOps()` call overwrote that shared
 * slot — so when the first batch's ack finally landed, it resolved the
 * *second* batch's promise instead, orphaning the first one forever. Any
 * `whenFlushed()` caller who captured that first promise (e.g. a
 * `fields()` read in `afterNextRender`) would hang indefinitely.
 *
 * The other 47 harnesses never caught this because the mock PAPI's
 * `callLepusMethod` acks **synchronously**, in the same tick as the send —
 * two batches can never overlap that way. This harness patches the mock to
 * ack asynchronously (a real `setTimeout`, like the actual cross-thread
 * round-trip), then deliberately sends a second batch while the first is
 * still in flight, and asserts `whenFlushed()` still resolves instead of
 * hanging. See docs/10-element-queries.md and examples/ui-gallery's
 * swiper-demo/draggable-demo doc comments for the full live-preview story.
 *
 * Run with: `npm run verify:flush-race`.
 */
import '@angular/compiler';

import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  signal,
} from '@angular/core';

import { bootstrapLynxApplication, whenFlushed } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';

import { assert, findByClass, getPage, installMockPapi, tick } from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <text class="a">{{ a() }}</text>
    <text class="b">{{ b() }}</text>
    <view class="toggle-a" (tap)="a.set(a() + 1)"></view>
    <view class="toggle-b" (tap)="b.set(b() + 1)"></view>
  `,
})
class RaceComponent {
  readonly a = signal(0);
  readonly b = signal(0);
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>).renderPage({});

  // Make every ack land on its own async timer instead of the mock's default
  // same-tick callback, so batches sent close together genuinely overlap —
  // ops still apply synchronously (via the real callLepusMethod, `cb`
  // withheld), only the acknowledgement is delayed.
  const g = globalThis as Record<string, any>;
  const realGetNativeApp = g.lynx.getNativeApp;
  g.lynx.getNativeApp = () => {
    const real = realGetNativeApp();
    return {
      ...real,
      callLepusMethod: (method: string, params: unknown, cb?: () => void) => {
        real.callLepusMethod(method, params, undefined);
        setTimeout(() => cb?.(), 20);
      },
    };
  };

  await bootstrapLynxApplication(RaceComponent);
  await tick();

  const page = getPage();
  const toggleASign = findByClass(page, 'toggle-a')!.events['tap']!.sign;
  const toggleBSign = findByClass(page, 'toggle-b')!.events['tap']!.sign;

  // Batch A: tap toggles `a` → CD → flushOps() sends it, ack ~20ms out.
  publishEvent(toggleASign, { type: 'tap' });
  await tick();

  // Capture a `whenFlushed()` waiter while batch A (at least) is still
  // in flight — this is the promise the old single-slot code would orphan.
  const waiter = whenFlushed();

  // Batch B: tap toggles `b` *before* batch A's ack has landed — a second,
  // overlapping in-flight batch, sent while `waiter` is still pending.
  publishEvent(toggleBSign, { type: 'tap' });
  await tick();

  let resolved = false;
  await Promise.race([waiter.then(() => { resolved = true; }), delay(500)]);

  console.log('\n=== Assertions: whenFlushed() survives overlapping flush batches ===');
  assert(
    resolved,
    'whenFlushed() called while a batch was in flight resolved once all in-flight batches acked (not orphaned by a later, overlapping flush)',
  );

  console.log('\n✅ Overlapping-flush regression covered — whenFlushed() no longer hangs.\n');
}

main().catch((err) => {
  console.error('\n❌ Flush-race verification failed:\n', err);
  process.exit(1);
});
