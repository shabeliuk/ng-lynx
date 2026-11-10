/**
 * Headless verification of the main-thread API: what the official Product Detail
 * tutorial needs, and more of `MainThread.Element` than `setStyle`.
 *
 *  - `runOnMainThread` returns values and errors, and sees the ops sent before it;
 *  - `runOnBackground(handle)` does the same in the other direction, and a released
 *    function resolves instead of hanging;
 *  - `bindWorklet` gives each binding its own `ctx.params`, with live refs and
 *    callable functions, so two instances of a component don't share state;
 *  - `mainThreadRef` holds an element or a value, and refs are freed;
 *  - the `MainThread.Element` methods reach the right PAPI calls;
 *  - `[lynxMainThread]` rebinds when its value changes, and releases on destroy.
 *
 * Run with: `npm run verify:main-thread-api`.
 */
import '@angular/compiler';

import {
  Component,
  createEnvironmentInjector,
  CUSTOM_ELEMENTS_SCHEMA,
  Input,
  runInInjectionContext,
  signal,
} from '@angular/core';

import {
  backgroundFunction,
  bindWorklet,
  bootstrapLynxApplication,
  LynxGesture,
  type LynxGestures,
  LynxMainThread,
  LynxMainThreadRef,
  mainThreadRef,
  runOnMainThread,
} from 'angular-lynx';
import 'angular-lynx/entry-background';
import 'angular-lynx/main-thread';
import {
  defineMainThreadFunction,
  defineMainThreadRef,
  defineWorklet,
  lynxTween,
  mainThreadLynx,
  type BackgroundFunctionHandle,
  type MainThreadAnimation,
  type MainThreadElement,
  type MainThreadFunctionHandle,
  type MainThreadRef,
  runOnBackground,
  type WorkletContext,
} from 'angular-lynx/worklet';

import { assert, fireGestureCallback, findAllByClass, findByClass, fireWorklet, getPage, installMockPapi, tick } from './mock-papi.js';

const g = globalThis as unknown as {
  __MT_INVOKE_LOG__?: { method: string; params: unknown }[];
  __ANIMATE_LOG__?: { args: unknown[] }[];
};

interface TapState {
  count: MainThreadRef<number>;
  element: MainThreadRef<MainThreadElement | null>;
  double: (n: number) => number;
  report: BackgroundFunctionHandle<[number], string>;
}

/** What the worklets saw, for the assertions. */
const seen: Record<string, unknown> = {};

let double: MainThreadFunctionHandle<[number], number>;
let boom: MainThreadFunctionHandle<[], void>;
let later: MainThreadFunctionHandle<[string], Promise<string>>;
let readElementClasses: MainThreadFunctionHandle<[MainThreadRef<MainThreadElement | null>], unknown>;
let addTo: MainThreadFunctionHandle<[MainThreadRef<number>, number], number>;
let callBack: MainThreadFunctionHandle<[BackgroundFunctionHandle<[number], number>, number], Promise<number>>;
let elementApi: ReturnType<typeof defineWorklet>;
let countTap: ReturnType<typeof defineWorklet<WorkletContext['event'], TapState>>;
let otherTap: ReturnType<typeof defineWorklet>;
let gestureStart: ReturnType<typeof defineWorklet<WorkletContext['event'], { marker: string }>>;

// Registered after `installMockPapi()`, as worklet-apply expects on a real engine.
function defineMainThreadCode(): void {
  double = defineMainThreadFunction('double', (n: number) => n * 2);
  boom = defineMainThreadFunction('boom', () => {
    throw new Error('it broke');
  });
  later = defineMainThreadFunction('later', async (s: string) => `${s}!`);
  readElementClasses = defineMainThreadFunction('readElementClasses', (ref) => ref.current?.getAttribute('kind'));
  addTo = defineMainThreadFunction('addTo', (ref, n) => (ref.current += n));
  callBack = defineMainThreadFunction('callBack', (fn, n) => runOnBackground(fn)(n));

  elementApi = defineWorklet('elementApi', async (ctx) => {
    const el = ctx.element;
    seen['noGesture'] = ctx.gesture;
    el.setStyle('color: red');
    el.setStyleProperty('opacity', '0.5');
    el.setStyleProperties({ width: '10px', opacity: '0.7' });
    el.setAttribute('data-x', 'y');
    seen['attr'] = el.getAttribute('data-x');
    seen['names'] = el.getAttributeNames();
    seen['computed'] = el.getComputedStyleProperty('color');
    seen['child'] = el.querySelector('.api-child')?.getAttribute('kind');
    seen['children'] = el.querySelectorAll('.api-child').length;
    seen['noMatch'] = el.querySelector('.nothing');
    seen['pageWide'] = mainThreadLynx.querySelectorAll('.tap-target').length;
    seen['invoked'] = await el.invoke('scrollTo', { offset: 10 });
    seen['invokedDefault'] = await el.invoke('autoScroll');
    seen['failed'] = await el.invoke('fail').catch((err: Error) => err.message);
    const byDuration = el.animate([{ opacity: 0 }, { opacity: 1 }], 200);
    const byOptions = el.animate([{ opacity: 1 }], { duration: 300, iterations: 2 });
    seen['animations'] = [byDuration, byOptions] satisfies MainThreadAnimation[];
    byOptions.pause();
    byOptions.play();
    byOptions.cancel();
  });

  countTap = defineWorklet<WorkletContext['event'], TapState>('countTap', (ctx) => {
    const { count, element, double: dbl, report } = ctx.params;
    count.current += 1;
    element.current?.setAttribute('data-count', dbl(count.current));
    seen['report'] = runOnBackground(report)(count.current);
  });

  otherTap = defineWorklet('otherTap', () => {
    seen['other'] = true;
  });

  gestureStart = defineWorklet<WorkletContext['event'], { marker: string }>('gestureStart', (ctx) => {
    seen['gestureMarker'] = ctx.params.marker;
    ctx.gesture?.end();
    seen['gestureScroll'] = ctx.gesture?.scrollBy(1, 2);
  });
}

@Component({
  selector: 'tap-counter',
  standalone: true,
  imports: [LynxMainThread, LynxMainThreadRef],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <view class="tap-target" [lynxMainThreadRef]="element" [lynxMainThread]="events"></view>
  `,
})
class TapCounter {
  @Input({ required: true }) name!: string;
  readonly element = mainThreadRef();
  readonly count = mainThreadRef(0);
  readonly reports: number[] = [];
  readonly report = backgroundFunction((n: number) => {
    this.reports.push(n);
    return `${this.name}:${n}`;
  });
  readonly events = {
    tap: bindWorklet(countTap, { count: this.count, element: this.element, double, report: this.report }),
  };
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [TapCounter, LynxMainThread, LynxMainThreadRef, LynxGesture],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <tap-counter class="a" name="a" />
    @if (showSecond()) {
      <tap-counter name="b" />
    }

    <view class="api" [lynxMainThread]="{ tap: elementApi }">
      <view class="api-child" kind="first"></view>
      <view class="api-child" kind="second"></view>
    </view>

    <view class="rebind" [lynxMainThread]="rebindEvents()"></view>
    <view class="gesture" [lynxGesture]="gesture"></view>

    @if (showRefTarget()) {
      <view class="ref-target" kind="target" [lynxMainThreadRef]="sharedRef"></view>
    }
    @if (!showRefTarget()) {
      <view class="ref-other" kind="other" [lynxMainThreadRef]="sharedRef"></view>
    }
  `,
})
class App {
  readonly elementApi = elementApi;
  readonly showSecond = signal(true);
  readonly showRefTarget = signal(true);
  readonly rebindEvents = signal<Record<string, typeof otherTap>>({ tap: otherTap, longpress: otherTap });
  readonly sharedRef = mainThreadRef();
  readonly gesture: LynxGestures = {
    pan: { type: 'pan', callbacks: { onStart: bindWorklet(gestureStart, { marker: 'per-binding' }) } },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await tick();
}

async function main(): Promise<void> {
  installMockPapi();
  defineMainThreadCode();
  (globalThis as { renderPage?: (d: unknown) => void }).renderPage?.({});
  const app = await bootstrapLynxApplication(App);
  const instance = app.components[0]!.instance as App;
  await settle();
  const page = getPage();
  const el = (cls: string) => {
    const found = findByClass(page, cls);
    if (!found) throw new Error(`no element .${cls}`);
    return found;
  };

  console.log('\n=== runOnMainThread ===');
  assert((await runOnMainThread(double)(21)) === 42, 'returns the function\'s result');
  assert((await runOnMainThread(later)('hi')) === 'hi!', 'waits for an async function');
  const failure = await runOnMainThread(boom)().catch((err: Error) => err.message);
  assert(failure === 'it broke', 'a throw rejects, with the message');
  const unknown = await runOnMainThread({ _mtFnId: 'nope' } as typeof boom)().catch((err: Error) => err.message);
  assert(String(unknown).includes('"nope"'), 'an unknown function rejects, and names it');

  console.log('\n=== runOnMainThread sees the ops sent before it ===');
  instance.showRefTarget.set(false);
  // No tick, so the new view's ops are still buffered... except that change
  // detection hasn't run either. Run it, leaving the flush pending.
  app.tick();
  assert((await runOnMainThread(readElementClasses)(instance.sharedRef)) === 'other', 'an element bound this tick is reachable');
  await settle();
  assert((await runOnMainThread(readElementClasses)(instance.sharedRef)) === 'other', 'teardown of the old element doesn\'t unbind the new one');
  instance.showRefTarget.set(true);
  await settle();
  assert((await runOnMainThread(readElementClasses)(instance.sharedRef)) === 'target', 'the ref moves back, whichever order the views change in');

  console.log('\n=== bindWorklet: per-binding params, live refs and functions ===');
  const [targetA, targetB] = findAllByClass(page, 'tap-target');
  fireWorklet(targetA!, 'tap', {});
  fireWorklet(targetA!, 'tap', {});
  fireWorklet(targetB!, 'tap', {});
  assert(targetA!.attrs['data-count'] === 4, 'a ref keeps its value between events, and a function arrives callable');
  assert(targetB!.attrs['data-count'] === 2, 'another instance has its own state');
  assert((await seen['report']) === 'b:1', 'runOnBackground(handle) returns the function\'s result');
  await settle();

  console.log('\n=== runOnBackground ===');
  const increment = backgroundFunction((n: number) => n + 1);
  assert((await runOnMainThread(callBack)(increment, 1)) === 2, 'a handle can travel as an argument, and call back');
  const throwing = backgroundFunction((_: number): number => {
    throw new Error('background broke');
  });
  const backgroundFailure = await runOnMainThread(callBack)(throwing, 1).catch((err: Error) => err.message);
  assert(backgroundFailure === 'background broke', 'a throw on the Background Thread rejects on the Main Thread');
  const asyncBackground = backgroundFunction(async (n: number) => n * 10);
  assert((await runOnMainThread(callBack)(asyncBackground, 2)) === 20, 'an async Background function is awaited');

  console.log('\n=== Released on destroy ===');
  const countBefore = targetB!.attrs['data-count'];
  instance.showSecond.set(false);
  await settle();
  fireWorklet(targetB!, 'tap', {});
  assert(targetB!.attrs['data-count'] === countBefore, 'a worklet doesn\'t run for a destroyed element');

  const owner = createEnvironmentInjector([], app.injector);
  const owned = runInInjectionContext(owner, () => backgroundFunction((n: number) => n));
  const ownedRef = runInInjectionContext(owner, () => mainThreadRef(5));
  assert((await runOnMainThread(callBack)(owned, 1)) === 1, 'an owned function works while its owner lives');
  assert((await runOnMainThread(addTo)(ownedRef, 1)) === 6, 'and so does an owned ref');
  owner.destroy();
  assert((await runOnMainThread(callBack)(owned, 1)) === undefined, 'a released function resolves undefined, so nothing hangs');
  assert((await runOnMainThread(addTo)(ownedRef, 1)) === 6, 'a released ref is freed: it starts over');

  console.log('\n=== Main-thread refs ===');
  const handle = mainThreadRef(5);
  assert(handle._init === 5, 'mainThreadRef(value) sends its starting value');
  assert((await runOnMainThread(addTo)(handle, 2)) === 7, 'a value ref arrives live, with its starting value');
  assert((await runOnMainThread(addTo)(handle, 2)) === 9, 'and keeps it between calls');
  const defined = defineMainThreadRef('defined', 100);
  assert((await runOnMainThread(addTo)(defined as unknown as typeof handle, 1)) === 101, 'a defineMainThreadRef value is the same ref on both sides');
  assert(defined.current === 101, 'so the module\'s own ref sees the write');
  const notBound = defineMainThreadRef('not-bound');
  assert(notBound.current === null, 'a ref with no element and no value is null');

  console.log('\n=== MainThread.Element ===');
  fireWorklet(el('api'), 'tap', {});
  await settle();
  assert(el('api').style === 'color: red; width: 10px; opacity: 0.7', 'setStyle, setStyleProperty and setStyleProperties compose');
  assert(seen['attr'] === 'y', 'getAttribute reads what setAttribute wrote');
  assert((seen['names'] as string[]).includes('data-x'), 'getAttributeNames lists it');
  assert(seen['computed'] === 'red', 'getComputedStyleProperty reads the style');
  assert(seen['child'] === 'first', 'querySelector finds the first match, as an element');
  assert(seen['children'] === 2, 'querySelectorAll finds them all');
  assert(seen['noMatch'] === null, 'querySelector with no match gives null');
  assert(seen['pageWide'] === 1, 'mainThreadLynx.querySelectorAll searches the page');
  const invoked = g.__MT_INVOKE_LOG__!.find((call) => call.method === 'scrollTo');
  assert(JSON.stringify(invoked?.params) === '{"offset":10}', 'invoke passes its params to the UI method');
  assert(JSON.stringify(seen['invoked']) === '{"method":"scrollTo","params":{"offset":10}}', 'invoke resolves with the result\'s data');
  assert(JSON.stringify(g.__MT_INVOKE_LOG__!.find((call) => call.method === 'autoScroll')?.params) === '{}', 'invoke without params sends an empty object');
  assert(String(seen['failed']).includes('fail'), 'invoke rejects when the code isn\'t 0');
  const animations = g.__ANIMATE_LOG__!.map((call) => call.args);
  assert(animations[0]![0] === 0 && JSON.stringify(animations[0]![3]) === '{"duration":200}', 'animate(keyframes, ms) starts with a duration');
  assert(JSON.stringify(animations[1]![3]) === '{"duration":300,"iterations":2}', 'animate(keyframes, options) passes them on');
  assert(animations[0]![1] !== animations[1]![1], 'each animation has its own id');
  assert(
    JSON.stringify(animations.slice(2).map((args) => args[0])) === '[2,1,3]' && animations[2]![1] === animations[1]![1],
    'pause, play and cancel reach that animation',
  );

  console.log('\n=== lynxTween ===');
  const values: number[] = [];
  await new Promise<void>((resolve) => {
    lynxTween({ from: 0, to: 10, duration: 32, easing: (t) => t, onUpdate: (v) => values.push(v), onFinish: resolve });
  });
  assert(values[0] === 0, 'the first value is immediate');
  assert(values.at(-1) === 10, 'it ends on the target');
  const cancelled: number[] = [];
  lynxTween({ from: 0, to: 1, duration: 1000, onUpdate: (v) => cancelled.push(v) }).cancel();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert(cancelled.length === 1, 'cancel stops the loop');

  console.log('\n=== [lynxMainThread] rebinds ===');
  const rebind = el('rebind');
  const firstHandler = rebind.events['tap']?.sign;
  assert(firstHandler !== undefined && rebind.events['longpress'] !== undefined, 'both events are bound');
  instance.rebindEvents.set({ tap: otherTap, longpress: otherTap });
  await settle();
  assert(rebind.events['tap']?.sign === firstHandler, 'the same worklet isn\'t bound again');
  instance.rebindEvents.set({ tap: elementApi });
  await settle();
  assert(rebind.events['tap']?.sign !== firstHandler, 'a changed worklet is bound');
  assert(rebind.events['longpress'] === undefined, 'a removed event is unbound');

  console.log('\n=== [lynxGesture] takes bindWorklet ===');
  const gestureId = Number(Object.keys(el('gesture').gestures!)[0]);
  fireGestureCallback(el('gesture'), gestureId, 'onStart', {});
  assert(seen['gestureMarker'] === 'per-binding', 'a gesture phase gets ctx.params');
  const stateLog = (globalThis as unknown as { __GESTURE_STATE_LOG__: unknown[] }).__GESTURE_STATE_LOG__;
  assert(
    JSON.stringify(stateLog[0]) === JSON.stringify(['end', gestureId, 'this element']),
    'ctx.gesture.end() sets this detector\'s state on its own element, through __SetGestureState',
  );
  assert((seen['gestureScroll'] as { consumedY: number }).consumedY === 2, 'ctx.gesture.scrollBy returns the result');
  assert(el('gesture').attrs['flatten'] === false, 'a gesture\'s element isn\'t flattened');
  fireWorklet(el('api'), 'tap', {});
  assert(seen['noGesture'] === undefined, 'any other event has no ctx.gesture');

  console.log('\n✅ All main-thread API assertions passed.\n');
  app.destroy();
}

main().catch((err) => {
  console.error('\n❌ Main-thread API verification failed:\n', err);
  process.exit(1);
});
