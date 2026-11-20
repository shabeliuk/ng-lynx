/**
 * Headless verification of `loadDynamicComponent` (runtime/src/dynamic-component.ts)
 * — loading a component bundle by a runtime-supplied source/schema string the
 * app's own build graph doesn't know about, the way a real native host would
 * point an app at an independently-built card. `registerDynamicComponent`
 * (mock-papi.ts) simulates the native host having already fetched and cached
 * the bundle; `lynx.QueryComponent` / `lynxCoreInject.tt
 * .getDynamicComponentExports` are mocked to mirror the real contract
 * confirmed against `lynx-family/lynx`'s own source (see
 * dynamic-component.ts's module doc).
 *
 * Run with: `npm run verify:dynamic-component`.
 */
import '@angular/compiler';

import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  signal,
  ViewChild,
  ViewContainerRef,
} from '@angular/core';

import { bootstrapLynxApplication, loadDynamicComponent } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';

import {
  assert,
  findByClass,
  findText,
  getPage,
  installMockPapi,
  registerDynamicComponent,
  tick,
} from './mock-papi.js';

@Component({
  selector: 'app-dynamic-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view class="card"><text>Dynamic card loaded</text></view>`,
})
class DynamicCardComponent {}

let lastError = '';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <view class="load" (tap)="load()"><text>Load</text></view>
    <view class="load-missing" (tap)="loadMissing()"><text>Load missing</text></view>
    <text class="status">{{ status() }}</text>
    <view #anchor></view>
  `,
})
class HostComponent {
  // biome-ignore lint/style/useReadonlyClassProperties: assigned by Angular's ViewChild
  @ViewChild('anchor', { read: ViewContainerRef }) anchor!: ViewContainerRef;
  readonly status = signal('idle');

  async load(): Promise<void> {
    try {
      const mod = await loadDynamicComponent<DynamicCardComponent>('dynamic://card-a');
      // biome-ignore lint/suspicious/noExplicitAny: the loaded type is only known at runtime
      this.anchor.createComponent(mod.default as any);
      this.status.set('loaded');
    } catch (err) {
      this.status.set(`error: ${(err as Error).message}`);
    }
  }

  async loadMissing(): Promise<void> {
    try {
      await loadDynamicComponent('dynamic://never-registered');
      this.status.set('should not resolve');
    } catch (err) {
      lastError = (err as Error).message;
      this.status.set('rejected');
    }
  }
}

async function tap(btnClass: string): Promise<void> {
  const sign = findByClass(getPage(), btnClass)?.events['tap']?.sign;
  if (!sign) throw new Error(`no (tap) on .${btnClass}`);
  publishEvent(sign, { type: 'tap' });
  await tick();
  await tick();
  await tick();
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>).renderPage({});

  await bootstrapLynxApplication(HostComponent);
  await tick();
  await tick();

  const page = getPage();

  console.log('\n=== Assertions: an unregistered source rejects, not silently hangs ===');
  await tap('load-missing');
  assert(
    findText(page, 'rejected') != null,
    'loadDynamicComponent rejected for a source the native host never registered (code !== 0 → reject, not a silent no-op)',
  );
  assert(
    lastError.startsWith(
      '[ng-lynx] loadDynamicComponent(dynamic://never-registered) failed: Load lazy bundle failed, the error message is: not registered. Engine result: {"code":160101',
    ),
    `the error leads with the engine's own message, then the raw result (got: ${lastError})`,
  );

  console.log('\n=== Assertions: a registered source resolves and mounts ===');
  registerDynamicComponent('dynamic://card-a', { default: DynamicCardComponent });
  assert(findByClass(page, 'card') == null, 'the dynamic component is not in the tree before loading');
  await tap('load');
  assert(findText(page, 'loaded') != null, 'loadDynamicComponent resolved once the native host "had" the bundle');
  assert(findByClass(page, 'card') != null, 'the dynamically-loaded component mounted into the live tree');
  assert(findText(page, 'Dynamic card loaded') != null, "the loaded component's own content rendered and updates normally");

  console.log('\n✅ Dynamic-component loading works — resolves registered sources, rejects unregistered ones.\n');
}

main().catch((err) => {
  console.error('\n❌ Dynamic-component verification failed:\n', err);
  process.exit(1);
});
