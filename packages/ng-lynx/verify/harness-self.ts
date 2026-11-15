/**
 * Headless verification of the `.self` event modifier.
 *
 * `(tap.self)` fires only when the event originated on the bound element, not
 * when it bubbled from a descendant — compared via the Lynx event's
 * `target.uid` / `currentTarget.uid`. A plain `(tap)` on the same element fires
 * for both. Confirms Angular passes the `.self` name through to the renderer and
 * that `.self` + plain share one native listener.
 *
 * Run with: `npm run verify:self`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';

import { assert, findByClass, getPage, installMockPapi, tick } from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="parent" (tap.self)="onSelf()" (tap)="onAny()">
      <text class="child">child</text>
    </view>
  `,
})
export class TestComponent {
  readonly selfCount = signal(0);
  readonly anyCount = signal(0);
  onSelf(): void {
    this.selfCount.update((n) => n + 1);
  }
  onAny(): void {
    this.anyCount.update((n) => n + 1);
  }
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent);
  await tick();
  await tick();
  const cmp = app.components[0]?.instance as TestComponent;
  const page = getPage();

  const parent = findByClass(page, 'parent');
  const sign = parent?.events['tap']?.sign as string | undefined;
  assert(!!sign, '(tap.self) + (tap) registered one native `tap` listener');

  console.log('\n=== Direct tap on the element (target === currentTarget) ===');
  publishEvent(sign!, { type: 'tap', target: { uid: 5 }, currentTarget: { uid: 5 } });
  await tick();
  assert(cmp.selfCount() === 1, '.self handler fired on a direct tap');
  assert(cmp.anyCount() === 1, 'plain handler fired on a direct tap');

  console.log('\n=== Bubbled tap from a child (target !== currentTarget) ===');
  publishEvent(sign!, { type: 'tap', target: { uid: 9 }, currentTarget: { uid: 5 } });
  await tick();
  assert(cmp.selfCount() === 1, '.self handler did NOT fire for a bubbled event');
  assert(cmp.anyCount() === 2, 'plain handler fired for the bubbled event');

  console.log('\n✅ All .self assertions passed — modifier filters bubbled events.\n');
}

main().catch((err) => {
  console.error('\n❌ .self verification failed:\n', err);
  process.exit(1);
});
