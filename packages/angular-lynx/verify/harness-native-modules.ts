/**
 * Headless verification of typed native-module access.
 *
 *  - `provideLynxNativeModules(fakes)` overrides the registry so
 *    `injectNativeModule<T>(name)` returns a typed, mockable module.
 *  - a module method call reaches the fake; results drive zoneless CD.
 *  - `injectNativeBridge()` returns the generic bridge.
 *  - a missing module returns `undefined` (no throw).
 *
 * Run with: `npm run verify:native-modules`.
 */
import '@angular/compiler';

import { Component, inject, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import {
  bootstrapLynxApplication,
  injectNativeBridge,
  injectNativeModule,
  provideLynxNativeModules,
} from 'angular-lynx';
import 'angular-lynx/main-thread';

import { assert, findText, getPage, installMockPapi, tick } from './mock-papi.js';

interface StorageModule {
  getItem(key: string): string | undefined;
  setItem(key: string, value: string): void;
}

// A fake host registry the harness controls.
const store: Record<string, string> = { theme: 'dark' };
const bridgeCalls: { name: string; params: unknown }[] = [];
const fakeModules = {
  StorageModule: {
    getItem: (k: string) => store[k],
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  } satisfies StorageModule,
  bridge: {
    call: (name: string, params: Record<string, unknown>, cb: (...a: unknown[]) => void) => {
      bridgeCalls.push({ name, params });
      cb({ ok: true });
    },
    on: () => {},
  },
};

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<text class="theme">theme:{{ theme() }}</text>`,
})
export class TestComponent {
  private readonly storage = injectNativeModule<StorageModule>('StorageModule');
  private readonly missing = injectNativeModule('NopeModule');
  private readonly bridge = injectNativeBridge();
  readonly theme = signal('?');

  constructor() {
    // Read through the typed module.
    this.theme.set(this.storage?.getItem('theme') ?? 'none');
    // Missing module resolves to undefined (no throw).
    (globalThis as Record<string, unknown>).__MISSING__ = this.missing;
    // Generic bridge call.
    this.bridge?.call('haptics', { style: 'light' }, () => {});
  }

  write(): void {
    this.storage?.setItem('theme', 'light');
    this.theme.set(this.storage?.getItem('theme') ?? 'none');
  }
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent, {
    providers: [provideLynxNativeModules(fakeModules)],
  });
  await tick();
  await tick();
  const page = getPage();
  const cmp = app.components[0].instance as TestComponent;

  console.log('\n=== injectNativeModule returns the provided fake ===');
  assert(findText(page, 'theme:dark') != null, 'typed module read reached the fake and rendered');
  assert((globalThis as Record<string, unknown>).__MISSING__ === undefined, 'a missing module resolves to undefined');

  console.log('\n=== injectNativeBridge ===');
  assert(bridgeCalls.length === 1 && bridgeCalls[0].name === 'haptics', 'bridge.call reached the fake with the name');

  console.log('\n=== module methods mutate + re-render (zoneless CD) ===');
  cmp.write();
  await tick();
  await tick();
  assert(findText(page, 'theme:light') != null, 'setItem via the module + signal write updated the view');
  assert(store['theme'] === 'light', 'the fake module actually received the write');

  console.log('\n✅ All native-module assertions passed — injectNativeModule works.\n');
}

main().catch((err) => {
  console.error('\n❌ Native-module verification failed:\n', err);
  process.exit(1);
});
