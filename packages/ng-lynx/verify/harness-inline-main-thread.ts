/**
 * Headless verification of inline `'main thread'` functions
 * (docs/11-worklets.md#inline-main-thread-functions).
 *
 * `fixtures/inline-main-thread/app.component.ts` goes through pluginAngularLynx's
 * two transforms (verify/build.mjs applies them): the component is compiled from
 * its Background form, and its Main-Thread half registers the functions. Then,
 * against the real renderer, executor and worklet runtime with the PAPI mocked:
 *
 *  - a function bound with `[lynxMainThread]` runs on the Main Thread, reading
 *    a module const, a ref and a Background function through `this`, a
 *    module-level 'main thread' function, and an import (`percent`, and
 *    `runOnBackground` from 'ng-lynx/worklet');
 *  - what it captures is read when it's bound, so a field declared after it works;
 *  - two instances of a component each get their own captures;
 *  - a method marked 'main thread' becomes a function `runOnMainThread` can call;
 *  - a 'main thread' function passed as an argument arrives callable;
 *  - a `[lynxGesture]` callback can be one;
 *  - on the Background Thread the stand-in throws when called;
 *  - a dev build names a captured signal, which can't cross.
 *
 * Run with: `npm run verify:inline-main-thread`.
 */
import '@angular/compiler';

import { bootstrapLynxApplication, runOnMainThread } from 'ng-lynx';
import 'ng-lynx/entry-background';
import 'ng-lynx/main-thread';

import { AppComponent, CounterComponent } from './fixtures/inline-main-thread/app.component.js';
import { assert, findAllByClass, findByClass, fireGestureCallback, fireWorklet, getPage, installMockPapi, tick } from './mock-papi.js';

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await tick();
}

async function main(): Promise<void> {
  installMockPapi();
  // The Main-Thread half registers worklets, so it loads once the runtime is in,
  // as the Main-Thread bundle orders it.
  await import('./fixtures/inline-main-thread/app.component.ts?ng-lynx-main-thread');

  const errors: string[] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };

  (globalThis as { renderPage?: (d: unknown) => void }).renderPage?.({});
  const appRef = await bootstrapLynxApplication(AppComponent);
  const app = appRef.components[0]!.instance as AppComponent;
  await settle();
  const page = getPage();
  const el = (cls: string) => {
    const found = findByClass(page, cls);
    if (!found) throw new Error(`no element .${cls}`);
    return found;
  };

  console.log('\n=== a bound function runs on the Main Thread, with what it captured ===');
  fireWorklet(el('tapper'), 'tap', {});
  await settle();
  assert((await runOnMainThread(app.readCount)()) === 2, 'the ref, read through this.count, went from 0 to 2 (STEP)');
  assert(app.reported() === 2, 'runOnBackground called the Background function captured as this.report');
  assert(String(el('tapper').style ?? '').includes('opacity: 40%'), `the imported helper formatted the style (got ${String(el('tapper').style)})`);
  fireWorklet(el('tapper'), 'tap', {});
  fireWorklet(el('tapper'), 'tap', {});
  await settle();
  assert((await runOnMainThread(app.readCount)()) === 5, 'the module-level clamp() held it at LIMIT');
  assert(app.reported() === 5, 'and reported 5');

  console.log('\n=== each instance captures its own fields ===');
  const counters = findAllByClass(page, 'counter');
  assert(counters.length === 2, 'two counters');
  fireWorklet(counters[1]!, 'tap', {});
  fireWorklet(counters[0]!, 'tap', {});
  await settle();
  const instances = CounterComponent.instances;
  assert(instances.length === 2, 'sanity: both counter instances found');
  assert(instances[0]!.seen() === 101 && instances[1]!.seen() === 201, `start 100 → 101 and 200 → 201 (got ${instances.map((c) => c.seen()).join(', ')})`);

  console.log('\n=== a method marked \'main thread\' runs through runOnMainThread ===');
  assert((await runOnMainThread(app.triple)(14)) === 42, 'triple(14) with this.factor = 3 is 42');

  console.log('\n=== a \'main thread\' function passed as an argument arrives callable ===');
  assert((await runOnMainThread(app.applyPlusOne)(app.triple, 2)) === 7, 'applyPlusOne(triple, 2) is 7');

  console.log('\n=== a gesture callback can be one ===');
  const gesture = el('gesture');
  const gestureId = Number(Object.keys(gesture.gestures ?? {})[0]);
  fireGestureCallback(gesture, gestureId, 'onStart', {});
  assert((await runOnMainThread(app.readGestureMarks)()) === 'start:params', 'onStart ran, with its captures as ctx.params');

  console.log('\n=== on the Background Thread the stand-in throws ===');
  let thrown = '';
  try {
    app.triple(1);
  } catch (err) {
    thrown = (err as Error).message;
  }
  assert(thrown.includes('runs on the Main Thread'), `calling it directly throws (got "${thrown}")`);

  console.log('\n=== a dev build names a captured value that can\'t cross ===');
  console.error = consoleError;
  assert(
    errors.some((e) => e.includes('`this.reported`') && e.includes('A signal?')),
    `the captured signal is named (got: ${errors.join(' | ') || 'nothing'})`,
  );
  assert(errors.filter((e) => !e.includes('this.reported')).length === 0, `nothing else was reported (got: ${errors.join(' | ')})`);

  console.log('\n✅ All inline main-thread assertions passed.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Inline main-thread verification failed:\n', err);
  process.exit(1);
});
