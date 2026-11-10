/**
 * Headless verification of the first-screen snapshot (IFR).
 *
 * Simulates the full device lifecycle in-process:
 *
 *  1. **Capture** — `captureFirstScreenOps()` records the app's first ops
 *     batch string.
 *  2. **First frame without the Background Thread** — a fresh "engine boot":
 *     `setFirstScreenOps()` + `renderPage()` paint the UI with **no Angular
 *     app running at all**.
 *  3. **Hydration (match)** — the real app boots; its first batch is
 *     byte-identical (deterministic ids/signs), gets dropped, and the page
 *     shows exactly one instance of everything. A native tap then proves the
 *     snapshot's event signs line up with the live handlers.
 *  4. **Fallback (mismatch)** — a *different* component boots against the
 *     snapshot; the snapshot is torn down and the real UI renders once.
 *
 * Run with: `npm run verify:ifr`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication, flushOps, publishEvent } from 'angular-lynx';
import 'angular-lynx/entry-background'; // installs the FIRST_SCREEN_RESOLVED_EVENT bridge (pre-boot event queueing)
import { setFirstScreenOps } from 'angular-lynx/main-thread';
import {
  assert,
  captureFirstScreenOps,
  findAllByClass,
  findByClass,
  findText,
  getPage,
  setupLynxTestEnvironment,
  tick,
} from 'angular-lynx/testing';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      <view class="btn" (tap)="inc()">
        <text class="count">Count: {{ count() }}</text>
      </view>
    </view>
  `,
})
export class CounterComponent {
  readonly count = signal(0);
  inc(): void {
    this.count.update((n) => n + 1);
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<view class="other"><text>Other page</text></view>`,
})
export class OtherComponent {}

// A mismatching app that (unlike OtherComponent) *does* register a (tap)
// handler, on the exact same fresh event-registry counter as CounterComponent
// (both reset per `setupLynxTestEnvironment()`) — so its own first `(tap)`
// binding gets assigned the identical sign string the Counter snapshot used
// for its button. This is what makes the mismatch-discard assertion below a
// real test of the collision risk (event-registry.ts's module doc), not just
// "nothing happened because nothing could have".
@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<view class="other" (tap)="hit.set(true)"><text>{{ hit() ? 'Other page (hit)' : 'Other page' }}</text></view>`,
})
export class MismatchTapComponent {
  readonly hit = signal(false);
}

async function main(): Promise<void> {
  console.log('\n=== 1. Capture the first-screen snapshot ===');
  const snapshot = await captureFirstScreenOps(CounterComponent);
  assert(snapshot.length > 0, 'capture produced a serialized ops batch');
  assert(snapshot.includes('view'), 'snapshot contains element creation ops');

  console.log('\n=== 2. First frame with NO Background Thread ===');
  setFirstScreenOps(snapshot);
  setupLynxTestEnvironment(); // fresh engine boot: renderPage applies the snapshot
  const page = getPage();
  assert(
    findText(page, 'Count: 0') != null,
    'UI painted synchronously in renderPage — no Angular app is running',
  );
  const btn = findByClass(page, 'btn');
  assert(typeof btn?.events['tap']?.sign === 'string', "snapshot registered the (tap) listener natively");

  console.log('\n=== 3. Hydration: the real app boots and matches ===');
  const app = await bootstrapLynxApplication(CounterComponent);
  await tick();
  await tick();
  assert(findAllByClass(page, 'count').length === 1, 'no duplicate UI — the matching first batch was dropped');
  assert(findText(page, 'Count: 0') != null, 'content unchanged by hydration');

  publishEvent(btn?.events['tap']?.sign as string, { detail: { x: 1, y: 1 } });
  await tick();
  await tick();
  assert(
    findText(page, 'Count: 1') != null,
    "tap on a snapshot-registered sign reached the live app's handler (signs align)",
  );

  console.log('\n=== 4. Fallback: a mismatching app boots against the snapshot ===');
  app.destroy();
  flushOps();
  setFirstScreenOps(snapshot); // Counter snapshot…
  setupLynxTestEnvironment();
  const page2 = getPage();
  assert(findText(page2, 'Count: 0') != null, 'snapshot painted again on the fresh page');
  await bootstrapLynxApplication(OtherComponent); // …but a different app boots
  await tick();
  await tick();
  assert(findText(page2, 'Other page') != null, 'the real UI rendered');
  assert(findText(page2, 'Count: 0') == null, 'the stale snapshot was torn down');
  assert(findAllByClass(page2, 'other').length === 1, 'exactly one instance after the fallback');

  console.log('\n=== 5. Pre-boot event queueing: a tap before the app boots reaches the handler after hydration ===');
  flushOps();
  setFirstScreenOps(snapshot);
  setupLynxTestEnvironment();
  const page3 = getPage();
  const btn3 = findByClass(page3, 'btn')!;
  const preBootSign = btn3.events['tap']!.sign as string;
  // Simulate a real native tap on the snapshot's UI, before the Background
  // Thread has even started executing — publishEvent for a sign nothing has
  // registered a handler for yet.
  publishEvent(preBootSign, { detail: { x: 1, y: 1 } });
  assert(
    findText(page3, 'Count: 0') != null,
    'the pre-boot tap did not fire yet — no handler is registered, it was buffered instead of dropped',
  );
  const app3 = await bootstrapLynxApplication(CounterComponent);
  await tick();
  await tick();
  assert(
    findText(page3, 'Count: 1') != null,
    'the queued pre-boot tap was replayed exactly once, once hydration matched — signs aligned, so it reached the live handler',
  );
  app3.destroy();
  flushOps();

  console.log('\n=== 6. Pre-boot event queueing: a mismatch discards, rather than replays, the queued tap ===');
  setFirstScreenOps(snapshot); // Counter snapshot again…
  setupLynxTestEnvironment();
  const page4 = getPage();
  const btn4 = findByClass(page4, 'btn')!;
  const preBootSign2 = btn4.events['tap']!.sign as string;
  publishEvent(preBootSign2, { detail: { x: 1, y: 1 } }); // queued, handler not registered yet
  await bootstrapLynxApplication(MismatchTapComponent); // …but a different app boots — same first sign, different meaning
  await tick();
  await tick();
  assert(findText(page4, 'Other page') != null, 'the real (mismatching) UI rendered');
  assert(
    findText(page4, 'Other page (hit)') == null,
    "the queued pre-boot tap was discarded on mismatch — it did NOT misfire onto the new tree's unrelated handler under the same sign",
  );

  console.log('\n✅ All IFR assertions passed — first-screen snapshot works.\n');
}

main().catch((err) => {
  console.error('\n❌ IFR verification failed:\n', err);
  process.exit(1);
});
