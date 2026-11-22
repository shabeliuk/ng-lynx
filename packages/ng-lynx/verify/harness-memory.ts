/**
 * Mount and destroy a screen 1,000 times, and check that nothing it registered
 * stays behind on either thread: the Main Thread's element registry, refs and
 * pending calls, and the Background Thread's event signs, element listeners,
 * Background functions and calls.
 *
 * The screen has what an app screen has: a `@for` of rows with an `@if` in
 * each, `(tap)` handlers, a worklet bound with `bindWorklet` and its own
 * `mainThreadRef`s and `backgroundFunction`, a `<lynx-slider>` (which has the
 * same, on the Main-Thread path) and a form control. Native memory is measured
 * on the simulator and the emulator separately (docs/41-device-testing.md).
 *
 * Run with: `npm run verify:memory`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  backgroundFunction,
  bindWorklet,
  bootstrapLynxApplication,
  LynxMainThread,
  LynxMainThreadRef,
  mainThreadRef,
  type WorkletHandle,
} from 'ng-lynx';
import 'ng-lynx/entry-background';
import { LynxCheckbox, LynxSlider } from 'ng-lynx/forms';
import { elementListenerCount, publishEvent, registeredSignCount, threadCallSizes } from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';
import {
  type BackgroundFunctionHandle,
  defineWorklet,
  type MainThreadElement,
  type MainThreadRef,
  runOnBackground,
} from 'ng-lynx/worklet';

import { elements } from '../main-thread/src/element-registry.js';
import { workletStateSizes } from '../main-thread/src/worklet-apply.js';
import { assert, findAllByClass, fireWorklet, getPage, installMockPapi, type MockEl, tick } from './mock-papi.js';

function tap(el: MockEl): void {
  const sign = el.events['tap']?.sign;
  if (typeof sign !== 'string') throw new Error('no (tap) sign');
  publishEvent(sign, { type: 'tap' });
}

interface CardParams {
  card: MainThreadRef<MainThreadElement | null>;
  taps: MainThreadRef<number>;
  report: BackgroundFunctionHandle<[number], void>;
}

let cardTap: WorkletHandle<CardParams>;

@Component({
  selector: 'app-screen',
  standalone: true,
  imports: [FormsModule, LynxCheckbox, LynxMainThread, LynxMainThreadRef, LynxSlider],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="screen">
      @for (row of rows; track row) {
        <view class="row" (tap)="tapped(row)">
          <text>Row {{ row }}</text>
          @if (row % 2 === 0) {
            <text class="even">even</text>
          }
        </view>
      }
      <view class="card" [lynxMainThreadRef]="card" [lynxMainThread]="{ tap: bound }"></view>
      <lynx-slider [min]="0" [max]="10" [(ngModel)]="volume" />
      <lynx-checkbox [(ngModel)]="agreed">Agree</lynx-checkbox>
    </view>
  `,
})
export class ScreenComponent {
  readonly rows = Array.from({ length: 20 }, (_, i) => i);
  readonly card = mainThreadRef<MainThreadElement | null>();
  private readonly taps = mainThreadRef(0);
  private readonly report = backgroundFunction((n: number) => {
    reported = n;
  });
  readonly bound = bindWorklet(cardTap, { card: this.card, taps: this.taps, report: this.report });
  volume = 3;
  agreed = false;
  tapped(_: number): void {}
}

let reported = 0;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ScreenComponent],
  template: `<view class="app">@if (shown()) { <app-screen /> }</view>`,
})
export class RootComponent {
  readonly shown = signal(false);
}

interface Sizes {
  mtElements: number;
  mtBoundRefs: number;
  mtLiveRefs: number;
  mtBackgroundCalls: number;
  bgSigns: number;
  bgListeners: number;
  bgFunctions: number;
  bgPendingCalls: number;
}

function sizes(): Sizes {
  const mt = workletStateSizes();
  const bg = threadCallSizes();
  return {
    mtElements: elements.size,
    mtBoundRefs: mt.boundRefs,
    mtLiveRefs: mt.liveRefs,
    mtBackgroundCalls: mt.backgroundCalls,
    bgSigns: registeredSignCount(),
    bgListeners: elementListenerCount(),
    bgFunctions: bg.backgroundFunctions,
    bgPendingCalls: bg.pendingCalls,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await tick();
}

const CYCLES = 1000;

async function main(): Promise<void> {
  installMockPapi();
  cardTap = defineWorklet<never, CardParams>('memoryCardTap', function memoryCardTapMT(ctx) {
    const p = ctx.params;
    p.taps.current += 1;
    p.card.current?.setStyleProperty('opacity', '0.5');
    void runOnBackground(p.report)(p.taps.current);
  });
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});
  const app = await bootstrapLynxApplication(RootComponent);
  await settle();
  const root = app.components[0]?.instance as RootComponent;
  const page = getPage();
  const baseline = sizes();
  console.log('baseline', JSON.stringify(baseline));

  console.log('\n=== One mount: the screen registers what it should ===');
  root.shown.set(true);
  await settle();
  const mounted = sizes();
  console.log('mounted ', JSON.stringify(mounted));
  assert(findAllByClass(page, 'row').length === 20, 'the screen rendered its 20 rows');
  assert(mounted.mtElements > baseline.mtElements + 60, `the Main Thread holds its elements (${mounted.mtElements})`);
  assert(mounted.bgSigns > baseline.bgSigns && mounted.mtBoundRefs > baseline.mtBoundRefs, 'and its signs and bound refs');
  const card = findAllByClass(page, 'card')[0]!;
  fireWorklet(card, 'tap', {});
  await settle();
  assert(reported === 1, 'the worklet ran and called back');
  tap(findAllByClass(page, 'row')[3]!);
  root.shown.set(false);
  await settle();
  const once = sizes();
  assert(JSON.stringify(once) === JSON.stringify(baseline), `one unmount returns every registry to its baseline: ${JSON.stringify(once)}`);

  console.log(`\n=== ${CYCLES} mounts and unmounts ===`);
  const started = Date.now();
  for (let i = 0; i < CYCLES; i++) {
    root.shown.set(true);
    await settle();
    if (i % 100 === 0) {
      fireWorklet(findAllByClass(page, 'card')[0]!, 'tap', {});
      await settle();
    }
    root.shown.set(false);
    await settle();
  }
  const after = sizes();
  console.log('after   ', JSON.stringify(after), `(${((Date.now() - started) / 1000).toFixed(1)}s)`);
  for (const key of Object.keys(baseline) as (keyof Sizes)[]) {
    assert(after[key] === baseline[key], `${key}: ${baseline[key]} → ${after[key]}`);
  }
  assert(page.children.length === 1 && findAllByClass(page, 'row').length === 0, 'the native tree is back to the empty app');

  console.log(`\n✅ ${CYCLES} mounts leave nothing behind on either thread.\n`);
}

main().catch((err) => {
  console.error('\n❌ Memory verification failed:\n', err);
  process.exit(1);
});
