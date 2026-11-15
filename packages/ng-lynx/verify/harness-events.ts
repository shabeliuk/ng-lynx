/**
 * Headless verification of global events + the `(confirm)` input event.
 *
 *  - `(window:…)` / `(document:…)` / `(body:…)` bind to Lynx's app-level
 *    GlobalEventEmitter; emitting one runs the handler and updates the view.
 *  - `(confirm)` (Lynx's submit-on-enter) fires with the final text in
 *    `event.detail.value`.
 *
 * Run with: `npm run verify:events`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';

import {
  assert,
  emitGlobalEvent,
  findByClass,
  findText,
  getPage,
  installMockPapi,
  tick,
} from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app" (window:ngTest)="onGlobal($event)">
      <text class="msg">{{ msg() }}</text>
      <input class="field" placeholder="x" (confirm)="onConfirm($event)" />
      <text class="confirmed">{{ confirmed() }}</text>
    </view>
  `,
})
export class TestComponent {
  readonly msg = signal('waiting');
  readonly confirmed = signal('none');

  onGlobal(event: { detail?: unknown } | unknown): void {
    const detail = (event as { detail?: unknown })?.detail ?? event;
    this.msg.set(`global:${String(detail)}`);
  }

  onConfirm(event: { detail?: { value?: string } }): void {
    this.confirmed.set(`confirmed:${event?.detail?.value ?? ''}`);
  }
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  await bootstrapLynxApplication(TestComponent);
  await tick();
  await tick();
  const page = getPage();

  console.log('\n=== Assertions: initial ===');
  assert(findText(page, 'waiting') != null, 'initial global message');
  assert(findText(page, 'none') != null, 'initial confirm message');

  console.log('\n=== Global event (window:ngTest) ===');
  emitGlobalEvent('ngTest', { detail: 'hello' });
  await tick();
  await tick();
  assert(findText(page, 'global:hello') != null, 'global event handler ran + view updated');

  console.log('\n=== (confirm) — submit on enter ===');
  const field = findByClass(page, 'field');
  const sign = field?.events['confirm']?.sign;
  assert(!!sign, '(confirm) listener registered on the <input>');
  publishEvent(sign as string, { detail: { value: 'Ada' } });
  await tick();
  await tick();
  assert(findText(page, 'confirmed:Ada') != null, '(confirm) handler read detail.value');

  console.log('\n✅ All event assertions passed — global events + (confirm) work.\n');
}

main().catch((err) => {
  console.error('\n❌ Events verification failed:\n', err);
  process.exit(1);
});
