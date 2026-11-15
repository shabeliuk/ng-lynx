/**
 * Headless verification of deferred style/class serialization
 * (pending-style.ts).
 *
 * Several style + class bindings on one element are driven by one signal.
 * Toggling it makes Angular call setStyle/removeStyle/addClass/removeClass many
 * times in a single change-detection pass. Previously each call re-serialized
 * the element's *entire* style string / class list (O(N²) BG work), then the
 * flush's coalescing threw all but the last away. Now the element is marked
 * dirty and serialized **once** at flush — the batch must carry exactly one
 * SET_STYLE and one SET_CLASS for the element, each with the final value.
 *
 * Run with: `npm run verify:style`.
 */
import '@angular/compiler';

import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  signal,
} from '@angular/core';

import { bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import { decodeOps, OP } from 'ng-lynx/internal/ops';
import 'ng-lynx/main-thread';

import { assert, findByClass, getLastOps, getPage, installMockPapi, tick } from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <view
      class="box"
      [class.on]="on()"
      [style.width.px]="on() ? 100 : 0"
      [style.height.px]="on() ? 50 : 0"
      [style.opacity]="on() ? 1 : 0"
      [style.background-color]="on() ? 'red' : 'blue'"
    ></view>
    <view class="toggle" (tap)="on.set(!on())"></view>
  `,
})
class StyleComponent {
  readonly on = signal(false);
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>).renderPage({});

  await bootstrapLynxApplication(StyleComponent);
  await tick();
  await tick();

  const page = getPage();
  const box = findByClass(page, 'box')!;
  const refAttr = Object.keys(box.attrs).find((k) => k.startsWith('ng-ref-'))!;
  const boxId = Number(refAttr.slice('ng-ref-'.length));

  // Flip all four style bindings + the class binding in one CD pass.
  const toggleSign = findByClass(page, 'toggle')!.events['tap']!.sign;
  publishEvent(toggleSign, { type: 'tap' });
  await tick();
  await tick();

  const batch = decodeOps(getLastOps());
  const setStyle = batch.filter((r) => r.code === OP.SET_STYLE && r.args[0] === boxId);
  const setClass = batch.filter((r) => r.code === OP.SET_CLASS && r.args[0] === boxId);

  console.log('\n=== Assertions: deferred style/class serialization ===');
  console.log(`  SET_STYLE ops for box: ${setStyle.length}; SET_CLASS ops: ${setClass.length}`);
  assert(setStyle.length === 1, 'four style writes in one CD pass produced exactly one SET_STYLE');
  assert(setClass.length === 1, 'the class write produced exactly one SET_CLASS');

  const css = setStyle[0].args[1] as string;
  assert(css.includes('width: 100px'), 'final width present');
  assert(css.includes('height: 50px'), 'final height present');
  assert(css.includes('opacity: 1'), 'final opacity present');
  assert(css.includes('background-color: red'), 'final background-color present (dash-cased)');
  assert(setClass[0].args[1] === 'box on', 'final class value correct');

  // The materialized value on the mock element matches too.
  assert(box.classes === 'box on', 'element class state correct');
  assert(String(box.style).includes('opacity: 1'), 'element inline style state correct');

  console.log('\n✅ Deferred serialization works — one SET_STYLE/SET_CLASS per element per flush.\n');
}

main().catch((err) => {
  console.error('\n❌ Style-flush verification failed:\n', err);
  process.exit(1);
});
