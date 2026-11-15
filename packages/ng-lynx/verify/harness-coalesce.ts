/**
 * Headless verification of op coalescing.
 *
 * A single element has three class bindings driven by one signal. Toggling the
 * signal makes Angular call addClass/removeClass three times in one CD pass,
 * which would emit three SET_CLASS ops. The flush coalesces them to one (the
 * last write), so the batch should contain exactly one SET_CLASS for that
 * element — with the correct final value.
 *
 * Run with: `npm run verify:coalesce`.
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
import { OP, decodeOps } from 'ng-lynx/internal/ops';
import 'ng-lynx/main-thread';

import {
  assert,
  findByClass,
  getLastOps,
  getPage,
  installMockPapi,
  tick,
} from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <view
      class="box"
      [class.a]="on()"
      [class.b]="on()"
      [class.c]="on()"
    ></view>
    <view class="toggle" (tap)="on.set(!on())"></view>
  `,
})
class CoalesceComponent {
  readonly on = signal(false);
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>).renderPage({});

  await bootstrapLynxApplication(CoalesceComponent);
  await tick();
  await tick();

  const page = getPage();
  const box = findByClass(page, 'box')!;
  const refAttr = Object.keys(box.attrs).find((k) => k.startsWith('ng-ref-'))!;
  const boxId = Number(refAttr.slice('ng-ref-'.length));

  // Toggle the three class bindings in one change-detection pass.
  const toggleSign = findByClass(page, 'toggle')!.events['tap']!.sign;
  publishEvent(toggleSign, { type: 'tap' });
  await tick();
  await tick();

  const setClassForBox = decodeOps(getLastOps()).filter(
    (r) => r.code === OP.SET_CLASS && r.args[0] === boxId,
  );

  console.log('\n=== Assertions: op coalescing ===');
  console.log(`  SET_CLASS ops for box in the batch: ${setClassForBox.length}`);
  assert(setClassForBox.length === 1, 'three class-binding writes coalesced into one SET_CLASS');
  assert(box.classes === 'box a b c', 'final class value is correct after coalescing');

  console.log('\n✅ Coalescing works — redundant set ops collapsed.\n');
}

main().catch((err) => {
  console.error('\n❌ Coalesce verification failed:\n', err);
  process.exit(1);
});
