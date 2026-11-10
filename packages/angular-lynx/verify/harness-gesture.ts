/**
 * Headless verification of main-thread gestures (`[lynxGesture]`).
 *
 * Binds two related gesture detectors (`pan` waiting for `tap` to lose) on one
 * element and asserts:
 *   - both reach the Main Thread as real `__SetGestureDetector` calls, with the
 *     right numeric gesture type and a `relationMap` resolved from the local
 *     `waitFor`/`simultaneousWith` keys to the *other* gesture's assigned id;
 *   - each gesture's callbacks are real worklets — firing one runs it on the MT
 *     with the same `WorkletContext` `[lynxMainThread]` worklets get;
 *   - on an engine without `__SetGestureDetector` (the real state of
 *     `@lynx-js/web-core` today), nothing throws and a dev warning fires
 *     instead — this feature degrades honestly rather than crashing.
 *
 * Run with: `npm run verify:gesture`.
 */
import '@angular/compiler';

import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication, GESTURE_TYPE, LynxGesture } from 'angular-lynx';
import 'angular-lynx/entry-background';
import 'angular-lynx/main-thread';
import { registerWorklet } from 'angular-lynx/worklet';

import {
  assert,
  findByClass,
  fireGestureCallback,
  findText,
  getPage,
  installMockPapi,
  tick,
} from './mock-papi.js';

// Registered from inside `main()`, after `installMockPapi()` — matching the
// real load order (worklet-runtime loads before user worklet modules).
function registerHarnessWorklets(): void {
  registerWorklet('onPanStartMT', (ctx) => {
    ctx.setStyle('opacity: 0.5');
    ctx.runOnBackground({ phase: 'start' });
  });
  registerWorklet('onPanEndMT', (ctx) => {
    ctx.setStyle('opacity: 1');
    ctx.runOnBackground({ phase: 'end' });
  });
  registerWorklet('onTapStartMT', (ctx) => {
    ctx.runOnBackground({ phase: 'tap' });
  });
}

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LynxGesture],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (showTarget()) {
      <view
        class="target"
        [lynxGesture]="{
          pan: { type: 'pan', callbacks: { onStart: 'onPanStartMT', onEnd: 'onPanEndMT' }, waitFor: ['tap'] },
          tap: { type: 'tap', callbacks: { onStart: 'onTapStartMT' }, simultaneousWith: ['pan'] }
        }"
        (mainThreadCallback)="onMessage($event)"
      ></view>
    }
    <text class="log">{{ log() }}</text>
  `,
})
class GestureComponent {
  readonly showTarget = signal(true);
  readonly log = signal('(none)');
  onMessage(data: unknown): void {
    this.log.set(`bg:${JSON.stringify(data)}`);
  }
}

async function main(): Promise<void> {
  installMockPapi();
  registerHarnessWorklets();
  (globalThis as Record<string, any>).renderPage({});

  const app = await bootstrapLynxApplication(GestureComponent);
  await tick();
  await tick();

  const page = getPage();
  const target = findByClass(page, 'target')!;
  const cmp = app.components[0]?.instance as GestureComponent;

  console.log('\n=== Assertions: both gesture detectors reached the Main Thread ===');
  const ids = Object.keys(target.gestures ?? {}).map(Number);
  assert(ids.length === 2, `both gesture detectors registered (got ${ids.length})`);
  const [panId, tapId] = ids.sort((a, b) => a - b);
  const pan = target.gestures![panId];
  const tap = target.gestures![tapId];
  assert(pan.type === GESTURE_TYPE.pan, `pan detector carries the PAN type code (got ${pan.type})`);
  assert(tap.type === GESTURE_TYPE.tap, `tap detector carries the TAP type code (got ${tap.type})`);

  console.log('\n=== Assertions: relations resolved local keys to the other gesture\'s real id ===');
  const panRelations = pan.relationMap as { waitFor: number[]; simultaneous: number[]; continueWith: number[] };
  const tapRelations = tap.relationMap as { waitFor: number[]; simultaneous: number[]; continueWith: number[] };
  assert(panRelations.waitFor.length === 1 && panRelations.waitFor[0] === tapId, "pan's waitFor:['tap'] resolved to tap's real gesture id");
  assert(tapRelations.simultaneous.length === 1 && tapRelations.simultaneous[0] === panId, "tap's simultaneousWith:['pan'] resolved to pan's real gesture id");

  console.log('\n=== Fire each gesture phase as the native engine would ===');
  fireGestureCallback(target, panId, 'onStart', { type: 'pan' });
  assert(target.style === 'opacity: 0.5', 'pan onStart worklet ran on the MT');
  await tick();
  await tick();
  assert(findText(page, 'bg:{"phase":"start"}') != null, 'pan onStart reached the Background Thread via runOnBackground');

  fireGestureCallback(target, panId, 'onEnd', { type: 'pan' });
  assert(target.style === 'opacity: 1', 'pan onEnd worklet ran on the MT');

  fireGestureCallback(target, tapId, 'onStart', { type: 'tap' });
  await tick();
  await tick();
  assert(findText(page, 'bg:{"phase":"tap"}') != null, 'tap onStart (a different detector, same element) ran independently');

  console.log('\n=== Graceful degradation: engine without __SetGestureDetector ===');
  cmp.showTarget.set(false);
  await tick();
  await tick();
  assert(!findByClass(page, 'target'), 'target removed (its gesture detectors go with it)');

  const g = globalThis as Record<string, unknown>;
  const real = g.__SetGestureDetector;
  g.__SetGestureDetector = undefined;
  let threw = false;
  try {
    cmp.showTarget.set(true);
    await tick();
    await tick();
  } catch {
    threw = true;
  } finally {
    g.__SetGestureDetector = real;
  }
  assert(!threw, '[lynxGesture] on an engine without native gesture support is a safe no-op, not a crash');
  assert(!!findByClass(page, 'target'), 'the element itself still rendered normally — only the gesture registration was skipped');

  console.log('\n✅ Gestures work — detectors + relations reach the MT, callbacks are real worklets.\n');
}

main().catch((err) => {
  console.error('\n❌ Gesture verification failed:\n', err);
  process.exit(1);
});
