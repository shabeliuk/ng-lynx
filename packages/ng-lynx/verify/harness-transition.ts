/**
 * Headless verification of `lynxEnter` / `lynxLeave` (runtime/src/transition.ts):
 * classes on while an element animates in, and a removed element kept on screen,
 * with its leave classes, until its own `animationend` or `transitionend` (or
 * the timeout), and only then removed and destroyed on the Main Thread.
 *
 * The mock engine doesn't animate, so the harness fires the end events the way
 * Lynx does: on the element, with `target` and `currentTarget`.
 *
 * Run with `npm run verify:transition`.
 */
import '@angular/compiler';

import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';

import { decodeOps, OP } from 'ng-lynx/internal/ops';

import { bootstrapLynxApplication, LynxEnter, LynxLeave } from 'ng-lynx';
import { elementListenerCount, publishEvent, registeredSignCount } from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';

import { assert, findByClass, getPage, installMockPapi, type MockEl, opsLogMark, opsSince, tick } from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [LynxEnter, LynxLeave],
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <view class="root">
      @if (open()) {
        <view class="panel" lynxEnter="fade-in slide-in" lynxLeave="fade-out" [lynxLeaveTimeout]="leaveTimeout()" (animationend)="ends.set(ends() + 1)">
          <text class="panel-text">Panel</text>
        </view>
      }
      @if (plain()) {
        <view class="plain" (transitionend)="ends.set(ends() + 1)"></view>
      }
      <view class="after"></view>
    </view>
  `,
})
class TransitionComponent {
  readonly open = signal(true);
  readonly plain = signal(true);
  readonly leaveTimeout = signal(60_000);
  readonly ends = signal(0);
}

let app!: TransitionComponent;

function classes(el: MockEl | undefined): string[] {
  return (el?.classes ?? '').split(/\s+/).filter(Boolean);
}

function panels(): MockEl[] {
  return findByClass(getPage(), 'root')!.children.filter((c) => classes(c).includes('panel'));
}

/** Fire an end event on `el`, as the engine does; `fromChild` makes it one bubbled up from a child. */
async function fireEnd(el: MockEl, name: 'animationend' | 'transitionend', fromChild?: MockEl): Promise<void> {
  const sign = el.events[name]?.sign;
  if (typeof sign !== 'string') throw new Error(`no ${name} listener on .${classes(el).join('.')}`);
  publishEvent(sign, { type: name, target: { uid: (fromChild ?? el).uid }, currentTarget: { uid: el.uid } });
  await tick();
  await tick();
}

function destroyedIds(mark: number): number[] {
  return decodeOps(opsSince(mark)).filter((r) => r.code === OP.DESTROY).map((r) => r.args[0] as number);
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>).renderPage({});
  const ref = await bootstrapLynxApplication(TransitionComponent);
  app = (ref as { components: { instance: TransitionComponent }[] }).components[0]!.instance;
  await tick();
  await tick();

  // The page without the panel: what's registered once it's gone again.
  app.leaveTimeout.set(0);
  await tick();
  app.open.set(false);
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await tick();
  const baseListeners = elementListenerCount();
  const baseSigns = registeredSignCount();
  app.leaveTimeout.set(60_000);
  app.open.set(true);
  await tick();
  await tick();

  console.log('\n=== lynxEnter ===');
  const panel = panels()[0]!;
  assert(classes(panel).includes('fade-in') && classes(panel).includes('slide-in'), 'the enter classes go on with the element');
  assert(
    panel.events['animationend'] !== undefined && panel.events['transitionend'] !== undefined,
    'and it listens for animationend and transitionend',
  );
  await fireEnd(panel, 'animationend', findByClass(panel, 'panel-text'));
  assert(classes(panel).includes('fade-in'), 'an end event bubbled up from a child doesn\'t end it');
  await fireEnd(panel, 'animationend');
  assert(
    !classes(panel).includes('fade-in') && !classes(panel).includes('slide-in') && classes(panel).includes('panel'),
    'its own animationend takes the enter classes off, and leaves its other classes',
  );
  assert(panel.events['transitionend'] === undefined, 'and stops listening (transitionend: only the enter listened for it)');

  console.log('\n=== lynxLeave ===');
  let mark = opsLogMark();
  app.open.set(false);
  await tick();
  await tick();
  assert(panels().length === 1 && panels()[0] === panel, 'removed by Angular, the element is still on screen');
  assert(classes(panel).includes('fade-out'), 'with the leave class on');
  assert(destroyedIds(mark).length === 0, 'nothing of it is destroyed yet');
  assert(findByClass(panel, 'panel-text') !== undefined, 'its children are still there');

  const endsBefore = app.ends();
  await fireEnd(panel, 'animationend');
  assert(panels().length === 0, 'its own animationend removes it');
  assert(
    app.ends() === endsBefore + 1,
    'the panel\'s own (animationend) handler saw the leave end too, as on the web: Angular keeps animation listeners for that',
  );
  assert(
    elementListenerCount() === baseListeners && registeredSignCount() === baseSigns,
    `and nothing of it stays registered (${elementListenerCount()} listeners, ${registeredSignCount()} signs, as before it came)`,
  );
  const destroyed = destroyedIds(mark);
  assert(destroyed.length === 3, `and destroys it and its subtree (${destroyed.length} nodes: view, text, raw text)`);

  console.log('\n=== Without lynxLeave nothing waits ===');
  const listenersWithPlain = elementListenerCount();
  app.plain.set(false);
  await tick();
  await tick();
  assert(findByClass(getPage(), 'plain') === undefined, 'an element with no leave goes at once');
  assert(
    elementListenerCount() === listenersWithPlain - 1,
    'and its (transitionend) listener goes with it, which Angular never unlistens itself',
  );

  console.log('\n=== The timeout ends a leave with no event ===');
  app.leaveTimeout.set(40);
  app.open.set(true);
  await tick();
  await tick();
  const second = panels()[0]!;
  mark = opsLogMark();
  app.open.set(false);
  await tick();
  await tick();
  assert(panels().length === 1, 'still on screen right after the removal');
  await new Promise((resolve) => setTimeout(resolve, 80));
  await tick();
  assert(
    panels().length === 0 && !panels().includes(second) && destroyedIds(mark).length === 3,
    'removed and destroyed after the timeout, with no end event',
  );

  console.log('\n=== Back in while the old one is still leaving ===');
  app.leaveTimeout.set(60_000);
  app.open.set(true);
  await tick();
  await tick();
  const third = panels()[0]!;
  app.open.set(false);
  await tick();
  await tick();
  app.open.set(true);
  await tick();
  await tick();
  const both = panels();
  assert(both.length === 2 && both.includes(third), 'the new element comes in beside the leaving one');
  const root = findByClass(getPage(), 'root')!;
  const after = root.children.findIndex((c) => classes(c).includes('after'));
  assert(
    both.every((p) => root.children.indexOf(p) < after),
    'both sit where the @if puts them, before the element after it',
  );
  await fireEnd(third, 'animationend');
  const remaining = panels();
  assert(remaining.length === 1 && remaining[0] !== third, 'the leaving one goes when it ends, the new one stays');

  console.log('\n✅ lynxEnter / lynxLeave verified.\n');
}

main().catch((err) => {
  console.error('\n❌ Transition verification failed:\n', err);
  process.exit(1);
});
