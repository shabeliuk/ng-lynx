/**
 * Headless verification of `<list>` scroll events and imperative scroll
 * methods.
 *
 * Neither needed new renderer/Main-Thread code: scroll events (`scroll`,
 * `scrolltolower`, `scrolltoupper`, …) bind through the same generic
 * `LynxRenderer2.listen()` every other event uses, and imperative scroll
 * methods (`scrollToPosition`, `scrollBy`, `getVisibleCells`, `autoScroll`) go
 * through the same `invoke()` selector-query path as any other element method
 * (`docs/10-element-queries.md`) — `<list>` already gets an `ng-ref-{id}`
 * selector attribute like any other element (`ops-apply.ts`). This harness
 * proves both against the real `examples/list` component.
 *
 * Run with: `npm run verify:list-scroll`.
 */
import '@angular/compiler';

import { bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';

import { AppComponent } from '../../../examples/list/src/app.component.js';
import {
  assert,
  driveList,
  findByClass,
  findByType,
  getLastQuery,
  getPage,
  installMockPapi,
  type MockEl,
  tick,
} from './mock-papi.js';

async function tap(btnClass: string): Promise<void> {
  const sign = findByClass(getPage(), btnClass)?.events['tap']?.sign;
  if (!sign) throw new Error(`no (tap) handler on .${btnClass}`);
  publishEvent(sign, { type: 'tap' });
  await tick();
  await tick();
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>).renderPage({});

  const app = await bootstrapLynxApplication(AppComponent);
  await tick();
  await tick();
  const cmp = app.components[0]?.instance as AppComponent;

  const listEl = findByType(getPage(), 'list')! as MockEl;
  driveList(listEl);

  console.log('\n=== Assertions: scroll events bind generically ===');
  assert(!!listEl.events['scroll']?.sign, '(scroll) registered a native listener on <list>');
  assert(!!listEl.events['scrolltolower']?.sign, '(scrolltolower) registered a native listener on <list>');
  assert(!!listEl.events['scrolltoupper']?.sign, '(scrolltoupper) registered a native listener on <list>');

  console.log('\n=== Simulating scroll / scrolltolower / scrolltoupper ===');
  publishEvent(listEl.events['scroll']!.sign as string, { type: 'scroll', detail: { scrollTop: 120 } });
  await tick();
  assert(cmp.status() === 'scrollTop=120', '(scroll) handler read event.detail.scrollTop');

  publishEvent(listEl.events['scrolltolower']!.sign as string, { type: 'scrolltolower' });
  await tick();
  assert(cmp.status() === 'reached the bottom', '(scrolltolower) fired independently of (scroll)');

  publishEvent(listEl.events['scrolltoupper']!.sign as string, { type: 'scrolltoupper' });
  await tick();
  assert(cmp.status() === 'reached the top', '(scrolltoupper) fired independently of the others');

  console.log('\n=== Assertions: imperative scrollToPosition via invoke() ===');
  const refAttr = Object.keys(listEl.attrs).find((k) => k.startsWith('ng-ref-'));
  assert(!!refAttr, '<list> got an ng-ref-{id} selector attribute like any other element');
  await tap('btn-top');
  const q = getLastQuery();
  assert(q?.selector === `[${refAttr}]`, 'invoke() targeted the <list> element selector, not a list item');
  assert(q?.['method'] === 'scrollToPosition', 'invoke() called the native "scrollToPosition" method');
  assert(
    JSON.stringify(q?.['params']) === JSON.stringify({ position: 0, smooth: true }),
    'invoke() passed the expected params (position, smooth)',
  );
  assert(cmp.status() === 'scrolled to top', "invoke()'s success callback ran");

  console.log('\n✅ All list-scroll assertions passed — scroll events + scrollToPosition work end-to-end.\n');
}

main().catch((err) => {
  console.error('\n❌ List-scroll verification failed:\n', err);
  process.exit(1);
});
