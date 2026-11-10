/**
 * Headless verification of `lynxAnimate` — the tiny `setTimeout`-driven tween
 * helper built over the existing worklet machinery (see docs/33-animations.md).
 *
 * A worklet starts a `lynxAnimate` tween on tap. Node has real `setTimeout`, so
 * this drives the loop with real (short) timers rather than a fake clock —
 * assertions use generous windows rather than exact per-tick values, since
 * real timer jitter makes tick-exact assertions unreliable. Asserts:
 *   - the first tick (the `from` value) applies synchronously, before the tap
 *     handler even returns;
 *   - the animation progresses and reaches exactly `to` when finished, calling
 *     `onFinish`;
 *   - `cancel()` freezes the value and skips `onFinish`.
 *
 * Run with: `npm run verify:animate`.
 */
import '@angular/compiler';

import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication, LynxMainThread } from 'angular-lynx';
import 'angular-lynx/entry-background';
import 'angular-lynx/main-thread';
import { lynxAnimate, registerWorklet, type LynxAnimationHandle } from 'angular-lynx/worklet';

import { assert, findByClass, findText, fireWorklet, getPage, installMockPapi, tick } from './mock-papi.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let cancelHandle: LynxAnimationHandle | undefined;
let finished = false;

function registerHarnessWorklets(): void {
  registerWorklet('fadeOutMT', (ctx) => {
    lynxAnimate(ctx, (v) => `opacity: ${v};`, {
      from: 1,
      to: 0,
      duration: 50,
      onFinish: () => ctx.runOnBackground({ done: true }),
    });
  });
  registerWorklet('cancellableMT', (ctx) => {
    finished = false;
    cancelHandle = lynxAnimate(ctx, (v) => `opacity: ${v};`, {
      from: 0,
      to: 1,
      duration: 5000,
      onFinish: () => {
        finished = true;
      },
    });
  });
}

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LynxMainThread],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <view class="fade" [lynxMainThread]="{ tap: 'fadeOutMT' }" (mainThreadCallback)="onMessage($event)"></view>
    <view class="cancellable" [lynxMainThread]="{ tap: 'cancellableMT' }"></view>
    <text class="log">{{ log() }}</text>
  `,
})
class AnimateComponent {
  readonly log = signal('(none)');
  onMessage(data: unknown): void {
    this.log.set(`bg:${JSON.stringify(data)}`);
  }
}

async function main(): Promise<void> {
  installMockPapi();
  registerHarnessWorklets();
  (globalThis as Record<string, any>).renderPage({});

  await bootstrapLynxApplication(AnimateComponent);
  await tick();
  await tick();

  const page = getPage();
  const fadeEl = findByClass(page, 'fade')!;
  const cancelEl = findByClass(page, 'cancellable')!;

  console.log('\n=== Fade animation: first tick is synchronous, then progresses ===');
  fireWorklet(fadeEl, 'tap', { type: 'tap' });
  assert(fadeEl.style === 'opacity: 1;', `the "from" value applies synchronously, before the tap handler returns (got ${fadeEl.style})`);

  await sleep(200); // well past duration:50 (a handful of 16ms ticks)
  assert(fadeEl.style === 'opacity: 0;', `settles exactly on "to" once finished (got ${fadeEl.style})`);

  console.log('\n=== onFinish fires exactly once, after the animation completes ===');
  await tick();
  await tick();
  assert(findText(page, 'bg:{"done":true}') != null, 'onFinish ran and reached the Background Thread');

  console.log('\n=== cancel() freezes the value and skips onFinish ===');
  fireWorklet(cancelEl, 'tap', { type: 'tap' });
  assert(cancelEl.style === 'opacity: 0;', 'cancellable animation also applies "from" synchronously');
  await sleep(50); // a few ticks into a 5000ms animation — nowhere near done
  const midStyle = cancelEl.style;
  assert(midStyle !== 'opacity: 0;' && midStyle !== 'opacity: 1;', `progressed partway before cancel (got ${midStyle})`);
  cancelHandle!.cancel();
  await sleep(100); // long enough that, uncancelled, more ticks would have landed
  assert(cancelEl.style === midStyle, `no further ticks applied after cancel() (still ${cancelEl.style})`);
  assert(!finished, 'onFinish did NOT run for a cancelled animation');

  console.log('\n✅ lynxAnimate works — real setTimeout-driven interpolation, completion, and cancellation.\n');
}

main().catch((err) => {
  console.error('\n❌ lynxAnimate verification failed:\n', err);
  process.exit(1);
});
