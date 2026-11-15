/**
 * Headless verification of `hotSwapComponent` — state-preserving component
 * hot-swap on the Lynx renderer (docs/31-hot-swap.md, the part
 * previously believed impossible: "no Angular HMR runtime to build on").
 *
 * Proves, against the mock PAPI:
 *  - swapping a live component's definition rebuilds its view with the new
 *    template while **preserving the component instance** — a signal set to 5
 *    before the swap renders as 5 through the brand-new template;
 *  - the old view's elements are destroyed and the new ones created as
 *    ordinary wire ops (the Main Thread needs no special HMR support);
 *  - change detection keeps working through the replacement view (post-swap
 *    signal writes re-render);
 *  - swaps are repeatable (the merged-in-place definition can be swapped
 *    again), matching the edit → save → edit → save dev loop.
 *
 * Run with: `npm run verify:hmr`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication, hotSwapComponent } from 'ng-lynx';
import { OP } from 'ng-lynx/internal/ops';
import 'ng-lynx/main-thread';

import {
  assert,
  findText,
  getPage,
  installMockPapi,
  opsLogMark,
  opsSince,
  tick,
} from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="card">
      <text class="label">count: {{ count() }}</text>
      <text class="version">version one</text>
    </view>
  `,
})
export class TestComponent {
  readonly count = signal(0);
}

/**
 * The "edited" component: same class shape (same fields the template binds
 * to), new template. In a real dev loop this definition would come from the
 * rebuilt bundle; here JIT compiles it like any other component.
 */
@Component({
  selector: 'app-root-v2',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="card v2">
      <text class="label">V2 count -> {{ count() }}!</text>
    </view>
  `,
})
export class TestComponentV2 {
  readonly count = signal(0);
}

/** A second edit, structurally different again (two bound texts). */
@Component({
  selector: 'app-root-v3',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view>
      <text>V3 sees {{ count() }}</text>
      <text>and doubled {{ count() * 2 }}</text>
    </view>
  `,
})
export class TestComponentV3 {
  readonly count = signal(0);
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

  console.log('\n=== v1 renders and reacts normally ===');
  assert(findText(page, 'count: 0') != null, 'v1 initial render shows count: 0');
  assert(findText(page, 'version one') != null, 'v1 marker text present');

  app.count.set(5);
  await tick();
  await tick();
  assert(findText(page, 'count: 5') != null, 'signal write re-renders (count: 5)');

  console.log('\n=== hot-swap to v2: new template, SAME instance — state survives ===');
  const swapMark = opsLogMark();
  hotSwapComponent(TestComponent, TestComponentV2);
  await tick();
  await tick();
  assert(findText(page, 'V2 count -> 5!') != null, 'v2 template renders with the PRE-SWAP signal value 5 — state preserved');
  assert(findText(page, 'version one') == null, 'old v1 view is gone');
  assert(findText(page, 'count: 5') == null, 'old v1 binding text is gone');
  assert(
    (appRef as { components: Array<{ instance: unknown }> }).components[0]!.instance === app,
    'the component instance is the same object across the swap',
  );
  const swapOps = opsSince(swapMark);
  assert(countDestroys(swapOps) > 0, `old view torn down via ordinary DESTROY ops (got ${countDestroys(swapOps)})`);
  assert(countCreates(swapOps, 'text') >= 1, `new view built via ordinary CREATE ops (got ${countCreates(swapOps, 'text')} text creates)`);

  console.log('\n=== change detection keeps working through the replacement view ===');
  app.count.set(7);
  await tick();
  await tick();
  assert(findText(page, 'V2 count -> 7!') != null, 'post-swap signal write re-renders through the v2 template');

  console.log('\n=== swaps are repeatable (edit -> save -> edit -> save) ===');
  hotSwapComponent(TestComponent, TestComponentV3);
  await tick();
  await tick();
  assert(findText(page, 'V3 sees 7') != null, 'second swap renders v3 with preserved state');
  assert(findText(page, 'and doubled 14') != null, 'v3 second binding evaluates against the same instance');
  assert(findText(page, 'V2 count -> 7!') == null, 'v2 view is gone after the second swap');

  app.count.set(9);
  await tick();
  await tick();
  assert(findText(page, 'V3 sees 9') != null, 'reactivity intact after two swaps');
  assert(findText(page, 'and doubled 18') != null, 'both v3 bindings track the signal');

  console.log('\n✅ All hot-swap assertions passed.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Hot-swap verification failed:\n', err);
  process.exit(1);
});
