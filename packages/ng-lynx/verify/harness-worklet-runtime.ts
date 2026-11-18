/**
 * Unit tests for ng-lynx's Main-Thread worklet runtime
 * (main-thread/src/worklet-runtime), on its own: no Angular, no renderer. The
 * contract it implements is in docs/42-worklet-runtime.md; each section below is
 * one part of it.
 *
 * Run with: `npm run verify:worklet-runtime`.
 */
import { PAGE_ROOT_ID } from 'ng-lynx/internal/ops';
import { clearWorklets, installWorkletRuntime } from 'ng-lynx/internal/worklet-runtime';

import { elements } from '../main-thread/src/element-registry.js';
import { MainThreadElementImpl, MainThreadEventTargetImpl, queryPage } from '../main-thread/src/worklet-runtime/element.js';
import { MAX_EVENT_DEPTH } from '../main-thread/src/worklet-runtime/event-targets.js';
import { isWorkletRuntimeInstalled } from '../main-thread/src/worklet-runtime/registry.js';
import { EventResult, RunWorkletSource } from '../main-thread/src/worklet-runtime/types.js';

import { assert, installMockPapi, type MockEl } from './mock-papi.js';

type AnyFn = (...args: unknown[]) => unknown;
const g = globalThis as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const runWorklet = (ctx: unknown, params?: unknown, options?: unknown): unknown =>
  (g['runWorklet'] as AnyFn)(ctx, params, options);
const register = (id: string, fn: AnyFn): void => (g['registerWorkletInternal'] as AnyFn)('main-thread', id, fn) as void;
const view = (id?: string): MockEl => {
  const el = g['__CreateView'](0) as MockEl;
  if (id) el.attrs['id'] = id;
  return el;
};
const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function assertThrows(fn: () => unknown, pattern: RegExp, msg: string): void {
  let error: unknown;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  assert(error instanceof Error && pattern.test(error.message), `${msg} (threw: ${String((error as Error)?.message)})`);
}

function installAndRegistry(): void {
  console.log('\n=== Install and registry ===');
  installMockPapi();
  assert(typeof g['runWorklet'] === 'function', 'installs runWorklet');
  assert(typeof g['registerWorkletInternal'] === 'function' && typeof g['registerWorklet'] === 'function', 'installs both registration names');
  assert(typeof g['lynxWorkletImpl'] === 'object' && typeof g['lynxWorkletImpl']._workletMap === 'object', 'installs lynxWorkletImpl._workletMap');
  assert(isWorkletRuntimeInstalled(), 'marks the runtime installed in this bundle');

  const a = (): string => 'a';
  const b = (): string => 'b';
  register('a', a);
  (g['registerWorklet'] as AnyFn)('main-thread', 'b', b);
  assert(g['lynxWorkletImpl']._workletMap['a'] === a, 'registerWorkletInternal stores the function under its id');
  assert(g['lynxWorkletImpl']._workletMap['b'] === b, 'registerWorklet is the same registration');
  assert(Object.getPrototypeOf(g['lynxWorkletImpl']._workletMap) === null, 'the map has no prototype');
  assertThrows(() => runWorklet({ _wkltId: 'toString' }, []), /no main-thread worklet "toString"/, 'an id from Object.prototype is not registered');

  const replacement = (): string => 'a2';
  register('a', replacement);
  assert(runWorklet({ _wkltId: 'a' }, []) === 'a2', 'registering an id again replaces it (hot reload)');

  installWorkletRuntime();
  assert(runWorklet({ _wkltId: 'b' }, []) === 'b', 'installing again keeps what was registered');

  clearWorklets();
  assert(g['lynxWorkletImpl']._workletMap['b'] === undefined, 'clearWorklets forgets every registration');
  assertThrows(() => runWorklet({ _wkltId: 'b' }, []), /no main-thread worklet "b"/, 'and runWorklet no longer finds them');
}

function ctxChecks(): void {
  console.log('\n=== Step 1: checking ctx ===');
  installMockPapi();
  for (const [label, ctx] of [
    ['undefined', undefined],
    ['null', null],
    ['a string', 'w'],
    ['an object without _wkltId', {}],
    ['a numeric _wkltId', { _wkltId: 5 }],
  ] as const) {
    assert(runWorklet(ctx, [{}], { source: 1 }) === undefined, `${label} is not a worklet ctx: undefined, no error`);
  }
  assertThrows(
    () => runWorklet({ _wkltId: 'missingMT' }, [{}]),
    /no main-thread worklet "missingMT".*mainThreadModules/,
    'an unregistered id throws, naming the id and mainThreadModules',
  );
}

function binding(): void {
  console.log('\n=== Step 2: binding the function ===');
  installMockPapi();
  const seen: { self: Record<string, unknown>; args: unknown[] }[] = [];
  register('countMT', function (this: Record<string, unknown>, ...args: unknown[]) {
    this['count'] = ((this['count'] as number | undefined) ?? 0) + 1;
    seen.push({ self: this, args });
    return this['count'];
  });

  const ctx = { _wkltId: 'countMT', _elId: 7, _params: { x: 1 } };
  runWorklet(ctx, ['first', 2]);
  runWorklet(ctx, ['second']);
  assert(seen[0]!.self !== ctx, '`this` is a copy of ctx, not ctx itself');
  assert(seen[0]!.self['_elId'] === 7 && seen[0]!.self['_params'] === ctx._params, 'the copy has ctx\'s fields');
  assert(seen[1]!.self === seen[0]!.self && seen[1]!.self['count'] === 2, 'the same ctx object gets the same `this`, so state lasts between events');
  assert(!('count' in ctx), 'what the worklet stores on `this` stays off ctx');
  assert(JSON.stringify(seen[0]!.args) === '["first",2]' && JSON.stringify(seen[1]!.args) === '["second"]', 'params are passed as arguments');

  runWorklet({ ...ctx }, []);
  assert(seen[2]!.self !== seen[0]!.self && seen[2]!.self['count'] === 1, 'another ctx object, even with the same id, gets its own `this`');

  runWorklet(ctx, undefined);
  runWorklet(ctx, 'not an array' as unknown as unknown[]);
  assert(seen[3]!.args.length === 0 && seen[4]!.args.length === 0, 'missing or non-array params call the worklet with no arguments');

  let reloaded: Record<string, unknown> | undefined;
  register('countMT', function (this: Record<string, unknown>) {
    reloaded = this;
  });
  runWorklet(ctx, []);
  assert(reloaded !== undefined && reloaded !== seen[0]!.self && !('count' in reloaded), 'registering the id again (hot reload) runs the new function for a ctx seen before, with a new `this`');

  register('throwMT', () => {
    throw new Error('worklet failed');
  });
  assertThrows(() => runWorklet({ _wkltId: 'throwMT' }, [{}], { source: 1 }), /^worklet failed$/, "a worklet's own error reaches the engine");
}

function eventResult(): void {
  console.log('\n=== Step 4: the event result ===');
  installMockPapi();
  register('stopMT', (event: unknown, how: unknown) => {
    const ev = event as { stopPropagation?(): void; stopImmediatePropagation?(): void };
    if (how === 'stop' || how === 'both') ev.stopPropagation?.();
    if (how === 'immediate' || how === 'both') ev.stopImmediatePropagation?.();
    return `ret:${String(how)}`;
  });
  const ctx = { _wkltId: 'stopMT' };
  const event = (): Record<string, unknown> => ({ type: 'tap' });

  const none = runWorklet(ctx, [event(), 'none'], { source: RunWorkletSource.EVENT }) as Record<string, unknown>;
  assert(none['returnValue'] === 'ret:none' && none['eventReturnResult'] === EventResult.DEFAULT, 'a native event gets { returnValue, eventReturnResult: 0 }');
  const stop = runWorklet(ctx, [event(), 'stop'], { source: 1 }) as Record<string, unknown>;
  assert(stop['eventReturnResult'] === 0x1, 'stopPropagation() sets bit 0x1');
  const immediate = runWorklet(ctx, [event(), 'immediate'], { source: 1 }) as Record<string, unknown>;
  assert(immediate['eventReturnResult'] === 0x2, 'stopImmediatePropagation() sets bit 0x2');
  const both = runWorklet(ctx, [event(), 'both'], { source: 1 }) as Record<string, unknown>;
  assert(both['eventReturnResult'] === 0x3 && both['returnValue'] === 'ret:both', 'both set both bits, and the return value comes through');

  const gestureEvent = event();
  assert(runWorklet(ctx, [gestureEvent, 'stop'], { source: RunWorkletSource.GESTURE }) === 'ret:stop', 'a gesture gets the worklet\'s own return value');
  assert(!('stopPropagation' in gestureEvent), 'and no event methods');
  const webEvent = event();
  assert(runWorklet(ctx, [webEvent, 'stop']) === 'ret:stop' && !('stopPropagation' in webEvent), 'the web preview (no options) likewise');
  assert(runWorklet(ctx, [42, 'none'], { source: 1 }) === 'ret:none', 'a non-object first param gets the plain return value');
}

function eventTargets(): void {
  console.log('\n=== Step 3: live elements in the event ===');
  installMockPapi();
  let received: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  let extra: unknown;
  register('targetMT', (event: unknown, second: unknown) => {
    received = event as Record<string, unknown>;
    extra = second;
  });
  const ctx = { _wkltId: 'targetMT' };
  const targetEl = view('t');
  const currentEl = view('c');
  const listEl = view();
  const event = {
    type: 'tap',
    target: { id: 't', uid: 3, dataset: { kind: 'chip' }, elementRefptr: targetEl },
    currentTarget: { id: 'c', uid: 4, dataset: {}, elementRefptr: currentEl, animate: 'from the engine' },
    detail: { items: [{ elementRefptr: listEl, index: 0 }] },
    touches: [{ identifier: 1, x: 2, y: 3 }],
  };
  const gestureManager = { elementRefptr: listEl, scrollBy: () => undefined };
  runWorklet(ctx, [event, gestureManager], { source: 1 });

  assert(received['target'] instanceof MainThreadEventTargetImpl, 'event.target is a live element');
  assert(received['target'].id === 't' && received['target'].uid === 3 && received['target'].dataset.kind === 'chip', 'keeping id, uid and dataset');
  received['target'].setStyle('opacity: 0.5');
  assert(targetEl.style === 'opacity: 0.5' && currentEl.style === undefined, 'setStyle writes the element the target names');
  assert(received['currentTarget'] instanceof MainThreadElementImpl && received['currentTarget'].uid === 4, 'event.currentTarget is live too');
  assert(typeof received['currentTarget'].animate === 'function', 'a field named like a method does not hide the method');
  assert(received['detail'].items[0] instanceof MainThreadElementImpl && received['detail'].items[0].index === 0, 'an element object deeper in the event is live too');
  assert(received['touches'][0].x === 2 && !(received['touches'][0] instanceof MainThreadElementImpl), 'plain objects are left as they are');
  assert(extra === gestureManager && !('setStyle' in gestureManager), 'params after the event are passed as they came');

  assert(JSON.stringify(received['target']) === '{"id":"t","uid":3,"dataset":{"kind":"chip"}}', 'JSON of a target is its fields, nothing native');
  assert(!JSON.stringify(received).includes('elementRefptr') && Object.keys(received['target']).join() === 'id,uid,dataset', 'the native element is not enumerable');

  const first = received['target'];
  runWorklet(ctx, [event], { source: 1 });
  assert(received['target'] === first, 'an event seen twice keeps its live elements, not wrapped again');

  let deep: Record<string, unknown> = { elementRefptr: listEl };
  for (let i = 0; i < MAX_EVENT_DEPTH + 2; i++) deep = { child: deep };
  const cyclic: Record<string, unknown> = { type: 'tap', deep };
  cyclic['self'] = cyclic;
  runWorklet(ctx, [cyclic], { source: 1 });
  let bottom = received['deep'] as Record<string, unknown>;
  while (bottom['child']) bottom = bottom['child'] as Record<string, unknown>;
  assert(!(bottom instanceof MainThreadElementImpl), `the walk stops ${MAX_EVENT_DEPTH} levels down, so a cyclic event doesn't overflow the stack`);
}

async function elementHandles(): Promise<void> {
  console.log('\n=== Element handles ===');
  installMockPapi();
  let flushes = 0;
  g['__FlushElementTree'] = () => void flushes++;
  const el = view('e');
  const handle = new MainThreadElementImpl(el);

  handle.setStyle('color: red');
  handle.setStyleProperty('opacity', '0.5');
  handle.setStyleProperties({ width: '10px', height: '20px' });
  handle.setAttribute('value', 'x');
  assert(flushes === 0, 'writes apply synchronously and defer the flush');
  await flushMicrotasks();
  assert(flushes === 1, 'four writes, one flush');
  assert(el.style === 'color: red; opacity: 0.5; width: 10px; height: 20px' && el.attrs['value'] === 'x', 'each write reached the element');
  assert(handle.getAttribute('value') === 'x' && handle.getAttributeNames().includes('id'), 'attribute reads');

  new MainThreadElementImpl(view()).setStyle('a: b');
  handle.setStyle('c: d');
  await flushMicrotasks();
  assert(flushes === 2, 'writes to different elements share one flush');

  assert((await handle.invoke('scrollTo', { offset: 1 }) as { method: string }).method === 'scrollTo', 'invoke resolves with the result data');
  let rejected: unknown;
  await handle.invoke('fail').catch((err: unknown) => {
    rejected = err;
  });
  assert(rejected instanceof Error && /UI method fail/.test(rejected.message), 'invoke rejects when the method fails');

  g['__ANIMATE_LOG__'] = [];
  const animation = handle.animate([{ opacity: 0 }, { opacity: 1 }], 300);
  animation.pause();
  animation.play();
  animation.cancel();
  const ops = (g['__ANIMATE_LOG__'] as { args: unknown[] }[]).map((entry) => entry.args);
  assert(ops[0]![0] === 0 && JSON.stringify(ops[0]![3]) === '{"duration":300}', 'animate starts with a duration');
  assert(ops.slice(1).map((args) => args[0]).join() === '2,1,3' && ops.every((args) => args[1] === ops[0]![1]), 'pause, play and cancel the same animation');

  handle.setStyle('opacity: 0.5');
  assert(handle.getComputedStyleProperty('opacity') === '0.5', 'getComputedStyleProperty reads the engine');
  const getComputed = g['__GetComputedStyleByKey'];
  delete g['__GetComputedStyleByKey'];
  assertThrows(() => handle.getComputedStyleProperty('opacity'), /needs Lynx 3\.5/, 'getComputedStyleProperty on an engine without it says what it needs');
  g['__GetComputedStyleByKey'] = getComputed;

  assert(JSON.stringify(handle) === '{}' && Object.keys(handle).length === 0, 'a handle serializes to nothing native');
}

function apiEnv(): void {
  console.log('\n=== Timers, frames and lynx.querySelector ===');
  installMockPapi();
  const saved = Object.fromEntries(
    ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'].map((name) => [name, g[name]]),
  );
  const calls: [string, unknown][] = [];
  // Like the browser's own timers, which the web preview's `lynx` hands out as
  // they are: called with any `this` but the global, they throw.
  const spy = (name: string) =>
    function (this: unknown, ...args: unknown[]) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      calls.push([name, this]);
      return args.length;
    };
  const lynxObject = g['lynx'] as Record<string, unknown>;
  Object.assign(lynxObject, {
    setTimeout: spy('setTimeout'),
    clearTimeout: spy('clearTimeout'),
    clearTimeInterval: spy('clearTimeInterval'),
    requestAnimationFrame: spy('requestAnimationFrame'),
    cancelAnimationFrame: spy('cancelAnimationFrame'),
  });
  try {
    installWorkletRuntime();
    (g['setTimeout'] as AnyFn)(() => undefined, 1);
    (g['clearInterval'] as AnyFn)(1);
    (g['requestAnimationFrame'] as AnyFn)(() => undefined);
    (g['cancelAnimationFrame'] as AnyFn)(1);
    assert(calls.map(([name]) => name).join() === 'setTimeout,clearTimeInterval,requestAnimationFrame,cancelAnimationFrame', 'globals call lynx\'s timers and frames');
    assert(g['setTimeout'] === lynxObject['setTimeout'], 'as they are, not bound to lynx: a browser timer called with `this` as lynx throws');
    assert(g['setInterval'] === saved['setInterval'], 'a timer lynx lacks is left as it was, not set to undefined');
  } finally {
    Object.assign(g, saved);
  }

  assert(typeof lynxObject['querySelector'] === 'function' && typeof lynxObject['querySelectorAll'] === 'function', 'installs lynx.querySelector and querySelectorAll');
  const query = lynxObject['querySelector'] as (selector: string) => MainThreadElementImpl | null;
  const queryAll = lynxObject['querySelectorAll'] as (selector: string) => MainThreadElementImpl[];
  assert(query('#x') === null && queryAll('#x').length === 0, 'before the page exists, they find nothing');
  const page = view();
  const found = view('x');
  g['__AppendElement'](page, found);
  elements.set(PAGE_ROOT_ID, page);
  try {
    const hit = query('#x');
    assert(hit instanceof MainThreadElementImpl && queryAll('#x').length === 1, 'they search the page, returning live elements');
    hit!.setStyle('top: 1px');
    assert(found.style === 'top: 1px', 'for the element found');
    assert(query('#nothing') === null && queryPage('#x') !== null, 'no match is null; mainThreadLynx uses the same query');
  } finally {
    elements.delete(PAGE_ROOT_ID);
  }
}

async function main(): Promise<void> {
  installAndRegistry();
  ctxChecks();
  binding();
  eventResult();
  eventTargets();
  await elementHandles();
  apiEnv();
  console.log('\n✅ Worklet runtime: registry, dispatch, event targets, event result, element handles, timers and queries.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
