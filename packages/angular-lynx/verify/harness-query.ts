/**
 * Headless verification of imperative element access (Lynx selector queries).
 *
 * A component grabs an element via `viewChild` and calls `fields(...)` /
 * `invoke(...)` on it (through `asLynxElement`). The harness mocks
 * `lynx.createSelectorQuery()` and asserts the right element selector was used
 * and the async result flowed back into a signal.
 *
 * Run with: `npm run verify:query`.
 */
import '@angular/compiler';

import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  type ElementRef,
  signal,
  ViewChild,
} from '@angular/core';

import { asLynxElement, bootstrapLynxApplication, lynxSelectAll, publishEvent } from 'angular-lynx';
import 'angular-lynx/main-thread';

import {
  assert,
  findByClass,
  findText,
  getLastQuery,
  getPage,
  installMockPapi,
  tick,
} from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <view>
      <view #box class="box"></view>
      <view class="item"></view>
      <view class="item"></view>
      <view class="item"></view>
      <view class="measure" (tap)="measure()"><text>Measure</text></view>
      <view class="focus" (tap)="focus()"><text>Focus</text></view>
      <view class="measure-all" (tap)="measureAll()"><text>Measure all</text></view>
      <text class="result">{{ result() }}</text>
    </view>
  `,
})
class QueryComponent {
  // Decorator-based query: works under JIT (initializer-based viewChild() needs AOT).
  @ViewChild('box') boxRef!: ElementRef;
  readonly result = signal('');

  measure(): void {
    asLynxElement(this.boxRef.nativeElement).fields({ size: true }, (data) => {
      this.result.set(`w=${data?.['width']} h=${data?.['height']}`);
    });
  }

  focus(): void {
    asLynxElement(this.boxRef.nativeElement).invoke({
      method: 'focus',
      success: () => this.result.set('focused'),
    });
  }

  measureAll(): void {
    lynxSelectAll('.item').fields({ size: true }, (results) => {
      this.result.set(`count=${results?.length ?? 'null'} top2=${results?.[2]?.['top']}`);
    });
  }
}

async function tap(btnClass: string): Promise<void> {
  const sign = findByClass(getPage(), btnClass)?.events['tap']?.sign;
  if (!sign) throw new Error(`no (tap) on .${btnClass}`);
  publishEvent(sign, { type: 'tap' });
  await tick();
  await tick();
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>).renderPage({});

  await bootstrapLynxApplication(QueryComponent);
  await tick();
  await tick();

  const page = getPage();
  const box = findByClass(page, 'box')!;
  // The ng-ref-{id} attribute the MT assigned, used by the selector query.
  const boxRefAttr = Object.keys(box.attrs).find((k) => k.startsWith('ng-ref-'));
  const expectedSelector = `[${boxRefAttr}]`;

  console.log('\n=== Assertions: fields() ===');
  await tap('measure');
  assert(getLastQuery()?.selector === expectedSelector, 'fields() targeted the #box element selector');
  assert(findText(page, 'w=100 h=50') != null, 'async field result flowed back into the signal');

  console.log('\n=== Assertions: invoke() ===');
  await tap('focus');
  assert(getLastQuery()?.['method'] === 'focus', 'invoke() called the native "focus" method on #box');
  assert(getLastQuery()?.selector === expectedSelector, 'invoke() targeted the #box element selector');
  assert(findText(page, 'focused') != null, 'invoke() success callback updated the signal');

  console.log('\n=== Assertions: lynxSelectAll() (multi-element) ===');
  await tap('measure-all');
  assert(getLastQuery()?.selector === '.item', 'selectAll() used the raw ".item" class selector (not [ng-ref-])');
  assert(getLastQuery()?.['all'] === true, 'the query was a selectAll (multi), not a single select');
  // 3 .item elements in the template → fields() callback got a 3-entry array.
  assert(findText(page, 'count=3 top2=100') != null, 'selectAll fields() returned one result per matched element (3), stacked tops');

  console.log('\n✅ All query assertions passed — imperative element access works.\n');
}

main().catch((err) => {
  console.error('\n❌ Query verification failed:\n', err);
  process.exit(1);
});
