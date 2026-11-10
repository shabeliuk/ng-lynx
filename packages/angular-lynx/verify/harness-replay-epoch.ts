/**
 * Headless verification of the replay-guard epoch (`docs/04-wire-protocol.md`): `flush.ts` generates one `SESSION_EPOCH` per Background-Thread
 * script evaluation and ships it as a sibling field alongside `data`;
 * `ops-apply.ts` commits to the first epoch it sees for a page and drops any
 * later batch carrying a *different* one — replacing the old heuristic that
 * inferred a duplicate session from whether a batch's first op happened to be
 * a `CREATE` targeting an already-registered id.
 *
 * This proves a real improvement over that heuristic, not just parity: a
 * crafted stale-epoch batch is dropped whether or not its first op is a
 * `CREATE` — the old check only ever looked at the first op's shape.
 *
 * Run with: `npm run verify:replay-epoch`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication } from 'angular-lynx';
import { OP, PATCH_METHOD } from 'angular-lynx/internal/ops';
import 'angular-lynx/main-thread';

import {
  assert,
  findText,
  getLastEpoch,
  getPage,
  installMockPapi,
  tick,
} from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<view (tap)="inc()"><text class="count">{{ count() }}</text></view>`,
})
export class TestComponent {
  readonly count = signal(0);
  inc(): void {
    this.count.update((n) => n + 1);
  }
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>)['renderPage']({});
  const appRef = await bootstrapLynxApplication(TestComponent);
  const app = (appRef as { components: Array<{ instance: TestComponent }> }).components[0]!.instance;
  await tick();
  const page = getPage();

  console.log('\n=== a real session ships one stable epoch across multiple flushes ===');
  const epochAfterFirstRender = getLastEpoch();
  assert(typeof epochAfterFirstRender === 'string' && epochAfterFirstRender.length > 0, 'the first flush carried a real, non-empty epoch');

  app.count.set(1);
  await tick();
  const epochAfterUpdate = getLastEpoch();
  assert(epochAfterUpdate === epochAfterFirstRender, 'a later flush in the same session carries the SAME epoch');
  assert(findText(page, '1') != null, 'sanity: the update actually applied');

  const tapSign = (() => {
    // Grab the tap listener's sign so we know a real element id to target below.
    function findFirstView(el: any): any {
      if (el.type === 'view') return el;
      for (const c of el.children) {
        const found = findFirstView(c);
        if (found) return found;
      }
      return undefined;
    }
    return findFirstView(page)?.uid as number;
  })();
  assert(typeof tapSign === 'number', 'sanity: found the counter view\'s element id');

  console.log('\n=== a stale-epoch batch is dropped, even when its first op IS a colliding CREATE ===');
  // Calling the PATCH_METHOD global directly (bypassing callLepusMethod)
  // simulates a batch arriving from a different BG-thread execution — the
  // mock's epoch recording only observes real flushes, so it isn't checked
  // here; the page-content assertions below are what actually prove the drop.
  const staleCreateBatch = JSON.stringify([OP.CREATE, tapSign, 'view']);
  (globalThis as Record<string, any>)[PATCH_METHOD]({ data: staleCreateBatch, epoch: 'stale-epoch-A' });
  await tick();
  assert(findText(page, '1') != null, 'page content unchanged — the stale CREATE batch never applied');

  console.log('\n=== a stale-epoch batch is ALSO dropped when its first op is NOT a CREATE ===');
  console.log('    (the old heuristic only checked `ops[0] === CREATE` — this is the real improvement)');
  const staleSetTextBatch = JSON.stringify([OP.SET_TEXT, tapSign, 'HIJACKED']);
  (globalThis as Record<string, any>)[PATCH_METHOD]({ data: staleSetTextBatch, epoch: 'stale-epoch-B' });
  await tick();
  assert(findText(page, 'HIJACKED') == null, 'the stale SET_TEXT batch never applied — dropped by epoch, not by op shape');
  assert(findText(page, '1') != null, 'original content is still there, untouched by the stale batch');

  console.log('\n=== a batch carrying the ORIGINAL epoch still applies normally after the stale ones were dropped ===');
  app.count.set(2);
  await tick();
  assert(findText(page, '2') != null, 'the real session keeps applying updates — dropping stale epochs did not wedge it');
  assert(getLastEpoch() === epochAfterFirstRender, 'the real update still carries the original session epoch');

  console.log('\n✅ All replay-guard epoch assertions passed.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Replay-guard epoch verification failed:\n', err);
  process.exit(1);
});
