/**
 * Headless verification of host data — `initData` / `updateData` / `globalProps`.
 *
 *  - `lynxInitData()` reads the data the host loaded the card with
 *    (`lynx.__initData`) and updates when the engine calls
 *    `tt.updateCardData(newData, options?)` (shallow merge; `type: 1` resets).
 *  - a `__lynx_timing_flag` key in a push is stripped, mirroring ReactLynx.
 *  - `lynxGlobalProps()` reads `lynx.__globalProps` and updates on
 *    `tt.updateGlobalProps(newData)`.
 *  - both pushes emit the ReactLynx-parity GlobalEventEmitter events, so
 *    `(window:onDataChanged)` template bindings fire too.
 *
 * Run with: `npm run verify:hostdata`.
 */
import '@angular/compiler';

import { Component, computed, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import {
  bootstrapLynxApplication,
  lynxGlobalProps,
  lynxInitData,
} from 'ng-lynx';
import {
  installHostData,
  resetHostDataState,
} from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';

import { assert, findText, getPage, installMockPapi, tick } from './mock-papi.js';

interface CardData {
  title?: string;
  n?: number;
  __lynx_timing_flag?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app" (window:onDataChanged)="onDataChanged($event)">
      <text class="title">{{ data().title }}</text>
      <text class="n">{{ nText() }}</text>
      <text class="theme">theme:{{ props().theme }}</text>
      <text class="changed">{{ changed() }}</text>
    </view>
  `,
})
export class TestComponent {
  readonly data = lynxInitData<CardData>();
  readonly props = lynxGlobalProps<{ theme?: string }>();
  readonly nText = computed(() => `n:${this.data().n ?? '-'}`);
  readonly changed = signal('changed:none');

  onDataChanged(event: unknown): void {
    this.changed.set(`changed:${Object.keys((event as object) ?? {}).join(',')}`);
  }
}

async function main(): Promise<void> {
  installMockPapi();
  const g = globalThis as Record<string, any>;

  // What the web runtime provides before the Background bundle runs: initial data
  // and global props on `lynx`, plus the `tt` object the handlers install onto. A
  // native engine doesn't set `__initData`: see the last section.
  g.lynx.__initData = { title: 'hello', n: 7 };
  g.lynx.__globalProps = { theme: 'light' };
  g.lynxCoreInject = { tt: {} };
  installHostData(); // entry-background does this at bundle start on a real engine

  g.renderPage({});
  await bootstrapLynxApplication(TestComponent);
  await tick();
  await tick();
  const page = getPage();
  const tt = g.lynxCoreInject.tt as {
    updateCardData(newData: Record<string, unknown>, options?: { type?: number }): void;
    updateGlobalProps(newData: Record<string, unknown>): void;
  };

  console.log('\n=== Assertions: initial host data ===');
  assert(typeof tt.updateCardData === 'function', 'installHostData wired tt.updateCardData');
  assert(typeof tt.updateGlobalProps === 'function', 'installHostData wired tt.updateGlobalProps');
  assert(findText(page, 'hello') != null, 'initData title rendered');
  assert(findText(page, 'n:7') != null, 'initData number rendered');
  assert(findText(page, 'theme:light') != null, 'globalProps theme rendered');

  console.log('\n=== updateData: shallow merge ===');
  tt.updateCardData({ title: 'updated' });
  await tick();
  await tick();
  assert(findText(page, 'updated') != null, 'pushed title rendered (signal triggered CD)');
  assert(findText(page, 'n:7') != null, 'unmentioned key survived the merge');
  assert(g.lynx.__initData.title === 'updated', 'lynx.__initData kept in sync (COW merge)');
  assert(
    findText(page, 'changed:title') != null,
    '(window:onDataChanged) fired with the changed subset',
  );

  console.log('\n=== updateData: __lynx_timing_flag stripped ===');
  tt.updateCardData({ __lynx_timing_flag: 'x', title: 'timed' });
  await tick();
  await tick();
  assert(findText(page, 'timed') != null, 'payload beside the flag applied');
  assert(
    g.lynx.__initData.__lynx_timing_flag === undefined,
    'timing flag never entered initData',
  );

  console.log('\n=== updateData: RESET (type 1) replaces instead of merging ===');
  tt.updateCardData({ title: 'fresh' }, { type: 1 });
  await tick();
  await tick();
  assert(findText(page, 'fresh') != null, 'reset title rendered');
  assert(findText(page, 'n:-') != null, 'previous keys dropped by RESET');

  console.log('\n=== updateGlobalProps ===');
  tt.updateGlobalProps({ theme: 'dark' });
  await tick();
  await tick();
  assert(findText(page, 'theme:dark') != null, 'pushed globalProps rendered');
  assert(g.lynx.__globalProps.theme === 'dark', 'lynx.__globalProps kept in sync');

  console.log('\n=== A native engine hands init data to the app, not to `lynx` ===');
  delete g.lynx.__initData;
  g.lynx.getApp = () => ({ _params: { initData: { title: 'native', n: 1 }, updateData: { n: 2 } } });
  resetHostDataState();
  const native = lynxInitData<{ title?: string; n?: number }>();
  assert(native().title === 'native', 'lynxInitData() reads `lynx.getApp()._params.initData`');
  assert(native().n === 2, 'updateData is merged over initData, as in ReactLynx');
  assert(g.lynx.__initData.title === 'native', 'lynx.__initData is set for the rest of the app');
  tt.updateCardData({ title: 'pushed' });
  assert(native().title === 'pushed' && native().n === 2, 'a push merges over what was read');
  delete g.lynx.__initData;
  delete g.lynx.getApp;
  resetHostDataState();
  assert(Object.keys(lynxInitData()()).length === 0, 'no host data at all reads as empty');

  console.log('\n=== lynx.registerDataProcessors on the Background Thread ===');
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message: string) => void warnings.push(message);
  g.lynx.registerDataProcessors({});
  console.warn = warn;
  assert(
    warnings.some((message) => message.includes('mainThreadLynx.registerDataProcessors')),
    'says where to call it, instead of throwing or doing nothing silently',
  );

  console.log('\n✅ All host-data assertions passed — initData / updateData / globalProps work.\n');
}

main().catch((err) => {
  console.error('\n❌ Host-data verification failed:\n', err);
  process.exit(1);
});
