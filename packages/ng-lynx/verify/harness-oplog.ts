/**
 * Headless verification of the dev op-stream logger.
 *
 *  - `enableLynxOpLogging({ sink })` captures each flush's decoded ops as
 *    readable lines (CREATE/INSERT/SET_TEXT/SET_CLASS/…).
 *  - the header reports the op count; ops are formatted with element ids.
 *  - `disableLynxOpLogging()` stops capture (no lines on the next flush).
 *
 * Run with: `npm run verify:oplog`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import {
  bootstrapLynxApplication,
  disableLynxOpLogging,
  enableLynxOpLogging,
} from 'ng-lynx';
import {
  publishEvent,
} from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';

import { assert, findByClass, findText, getPage, installMockPapi, tick } from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      <text class="label">Count: {{ count() }}</text>
      <view class="btn" (tap)="inc()"></view>
    </view>
  `,
})
export class TestComponent {
  readonly count = signal(0);
  inc(): void {
    this.count.update((n) => n + 1);
  }
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const lines: string[] = [];
  enableLynxOpLogging({ sink: (line) => lines.push(line) });

  await bootstrapLynxApplication(TestComponent);
  await tick();
  await tick();

  console.log('\n=== Initial render logged ===');
  assert(lines.length > 0, 'the initial flush produced log lines');
  assert(
    lines.some((l) => /^\[ng-lynx\] flush \(\d+ ops\)$/.test(l)),
    'a flush header with an op count was logged',
  );
  assert(lines.some((l) => l.includes('CREATE') && l.includes('view')), 'a CREATE view op was logged');
  assert(lines.some((l) => l.includes('SET_TEXT') && l.includes('Count: 0')), 'the SET_TEXT op shows the text');
  assert(lines.some((l) => l.includes('INSERT') && l.includes('→')), 'an INSERT op shows parent/child');
  assert(lines.some((l) => l.includes('SET_EVENT') && l.includes('tap')), 'the (tap) SET_EVENT op was logged');

  console.log('\n=== Update flush logged ===');
  lines.length = 0;
  const sign = findByClass(getPage(), 'btn')!.events['tap']!.sign;
  publishEvent(sign, { type: 'tap' });
  await tick();
  await tick();
  assert(lines.some((l) => l.includes('SET_TEXT') && l.includes('Count: 1')), 'the update flush logged the new text');

  console.log('\n=== Disable stops logging ===');
  disableLynxOpLogging();
  lines.length = 0;
  publishEvent(sign, { type: 'tap' });
  await tick();
  await tick();
  assert(lines.length === 0, 'no lines captured after disableLynxOpLogging()');
  assert(findText(getPage(), 'Count: 2') != null, 'rendering still works (logging is passive)');

  console.log('\n✅ Op-stream logger works — decoded ops per flush, toggleable.\n');
}

main().catch((err) => {
  console.error('\n❌ Op-log verification failed:\n', err);
  process.exit(1);
});
