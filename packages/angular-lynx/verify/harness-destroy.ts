/**
 * Headless verification of node disposal (`destroyNode` → DESTROY op).
 *
 * Toggling `@if` repeatedly creates and destroys a subtree. Without disposal the
 * Main Thread's `elements` registry grows every cycle (a leak). This asserts the
 * destroyed subtree is freed from the registry and the map size is stable across
 * cycles — and that the element is removed from the native tree.
 *
 * Run with: `npm run verify:destroy`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication } from 'angular-lynx';
import 'angular-lynx/main-thread';

import { elements } from '../main-thread/src/element-registry.js';
import { assert, findByClass, getPage, installMockPapi, tick } from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="root">
      @if (show()) {
        <view class="sub">
          <text class="leaf">{{ label() }}</text>
        </view>
      }
    </view>
  `,
})
export class TestComponent {
  readonly show = signal(true);
  readonly label = signal('leaf');
}

async function toggle(cmp: TestComponent, on: boolean): Promise<void> {
  cmp.show.set(on);
  await tick();
  await tick();
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent);
  await tick();
  await tick();
  const cmp = app.components[0]?.instance as TestComponent;
  const page = getPage();

  console.log('\n=== Assertions: initial render ===');
  assert(!!findByClass(page, 'sub'), '@if subtree rendered (show = true)');
  const sizeWithSub = elements.size;

  console.log('\n=== Destroy the subtree (show = false) ===');
  await toggle(cmp, false);
  assert(!findByClass(page, 'sub'), 'subtree removed from the native tree');
  const sizeAfterDestroy = elements.size;
  assert(
    sizeAfterDestroy < sizeWithSub,
    `MT registry shrank after destroy (${sizeWithSub} -> ${sizeAfterDestroy})`,
  );

  console.log('\n=== No leak across create/destroy cycles ===');
  await toggle(cmp, true);
  await toggle(cmp, false);
  const sizeCycle2 = elements.size;
  await toggle(cmp, true);
  await toggle(cmp, false);
  const sizeCycle3 = elements.size;
  assert(
    sizeAfterDestroy === sizeCycle2 && sizeCycle2 === sizeCycle3,
    `registry size stable across cycles — no leak (${sizeAfterDestroy} / ${sizeCycle2} / ${sizeCycle3})`,
  );

  console.log('\n=== Re-create works after disposal ===');
  await toggle(cmp, true);
  assert(!!findByClass(page, 'sub'), 'subtree re-created after being destroyed');

  console.log('\n✅ All disposal assertions passed — destroyed nodes freed, no registry leak.\n');
}

main().catch((err) => {
  console.error('\n❌ Disposal verification failed:\n', err);
  process.exit(1);
});
