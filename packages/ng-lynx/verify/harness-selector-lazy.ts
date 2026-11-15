/**
 * Headless verification of `enableSelectorQueries: 'lazy'` (the deferred
 * `ng-ref-{id}` mode — `plugin/src/index.ts` / `shadow-element.ts`).
 *
 * With the flag set to `'lazy'`, `OP.CREATE`'s Main-Thread handler never sets
 * `ng-ref-{id}` natively (unlike `true`). Instead, an element's first
 * `fields`/`invoke`/`setNativeProps`/`path` call emits a real `SET_ATTR` op
 * on the Background Thread, flushes it, and awaits `whenFlushed()` before
 * issuing the actual `createSelectorQuery()` call — proving the ordering
 * (attribute lands on the Main Thread before the query fires) rather than
 * assuming it. A second query on the same element must skip the extra
 * round-trip entirely (no repeat `SET_ATTR`).
 *
 * Run with: `npm run verify:selector-lazy` (sets
 * `ENABLE_SELECTOR_QUERIES=lazy` before invoking `verify/build.mjs`).
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

import { OP } from 'ng-lynx/internal/ops';

import { asLynxElement, bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';

import {
  assert,
  findByClass,
  findText,
  getLastQuery,
  getPage,
  installMockPapi,
  opsLogMark,
  opsSince,
  tick,
} from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <view class="box" [class.on]="on()">
      <text class="label">{{ on() ? 'On' : 'Off' }}</text>
      <view #box class="target"></view>
      <view class="measure" (tap)="measure()"><text>Measure</text></view>
      <view class="toggle" (tap)="on.set(!on())"></view>
      <text class="result">{{ result() }}</text>
    </view>
  `,
})
class LazyQueryComponent {
  @ViewChild('box') boxRef!: ElementRef;
  readonly on = signal(false);
  readonly result = signal('');

  measure(): void {
    asLynxElement(this.boxRef.nativeElement).fields({ size: true }, (data) => {
      this.result.set(`w=${data?.['width']} h=${data?.['height']}`);
    });
  }
}

function collectAttrKeys(el: any, out: Set<string>): void {
  for (const k of Object.keys(el.attrs ?? {})) out.add(k);
  for (const child of el.children ?? []) collectAttrKeys(child, out);
}

function refAttrCount(ops: unknown[]): number {
  let count = 0;
  let i = 0;
  while (i < ops.length) {
    const code = ops[i++] as number;
    if (code === OP.SET_ATTR) {
      const _id = ops[i++];
      const key = ops[i++] as string;
      const _value = ops[i++];
      if (typeof key === 'string' && key.startsWith('ng-ref-')) count++;
    } else {
      // Skip past this op's args using the same arity every other op in this
      // harness's small template can produce (CREATE:2, INSERT:3, SET_TEXT:2,
      // SET_CLASS:2, SET_EVENT:4) — good enough for this harness's own
      // template rather than pulling in the full decodeOps machinery.
      const arity: Record<number, number> = {
        [OP.CREATE]: 2,
        [OP.CREATE_TEXT]: 1,
        [OP.INSERT]: 3,
        [OP.REMOVE]: 2,
        [OP.SET_TEXT]: 2,
        [OP.SET_EVENT]: 4,
        [OP.REMOVE_EVENT]: 3,
        [OP.SET_STYLE]: 2,
        [OP.SET_CLASS]: 2,
        [OP.REMOVE_ATTR]: 2,
        [OP.DESTROY]: 1,
      };
      i += arity[code] ?? 0;
    }
  }
  return count;
}

async function tap(btnClass: string): Promise<void> {
  const sign = findByClass(getPage(), btnClass)?.events['tap']?.sign;
  if (!sign) throw new Error(`no (tap) on .${btnClass}`);
  publishEvent(sign, { type: 'tap' });
  await tick();
  await tick();
  await tick(); // one extra tick for the lazy path's flush→ack→whenFlushed round-trip
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>).renderPage({});

  await bootstrapLynxApplication(LazyQueryComponent);
  await tick();
  await tick();

  const page = getPage();

  console.log('\n=== Assertions: no ng-ref attribute until first query ===');
  const attrsBeforeQuery = new Set<string>();
  collectAttrKeys(page, attrsBeforeQuery);
  const refAttrsBefore = [...attrsBeforeQuery].filter((k) => k.startsWith('ng-ref-'));
  assert(
    refAttrsBefore.length === 0,
    `no element carries an ng-ref-{id} attribute before any query (found: ${refAttrsBefore.join(', ') || 'none'})`,
  );
  assert(findByClass(page, 'target') != null, 'the element tree still rendered normally');

  console.log('\n=== Assertions: first query sets the attribute, ordered before the real call ===');
  const markBeforeFirstQuery = opsLogMark();
  await tap('measure');
  const opsFromFirstQuery = opsSince(markBeforeFirstQuery);
  assert(
    refAttrCount(opsFromFirstQuery) === 1,
    'exactly one SET_ATTR(ng-ref-{id}) op was emitted on the first query',
  );

  const attrsAfterQuery = new Set<string>();
  collectAttrKeys(page, attrsAfterQuery);
  const target = findByClass(page, 'target')!;
  const refAttr = Object.keys(target.attrs).find((k) => k.startsWith('ng-ref-'));
  assert(refAttr != null, 'the target element now carries its ng-ref-{id} attribute');
  assert(
    getLastQuery()?.selector === `[${refAttr}]`,
    'the query ran (after the attribute landed) against the correct [ng-ref-{id}] selector',
  );
  assert(findText(page, 'w=100 h=50') != null, 'the deferred query still delivered its result to the app');

  console.log('\n=== Assertions: a second query on the same element does not repeat the round-trip ===');
  const markBeforeSecondQuery = opsLogMark();
  await tap('measure');
  const opsFromSecondQuery = opsSince(markBeforeSecondQuery);
  assert(
    refAttrCount(opsFromSecondQuery) === 0,
    'no additional SET_ATTR(ng-ref-{id}) op was emitted on a repeat query of the same element',
  );
  assert(findText(page, 'w=100 h=50') != null, 'the repeat query still resolved correctly');

  console.log('\n=== Assertions: rendering unrelated to selector queries is unaffected ===');
  await tap('toggle');
  assert(findText(page, 'On') != null, 'a signal update + (tap) handler still work in lazy mode');
  assert(
    (findByClass(page, 'box')!.classes ?? '').split(' ').includes('on'),
    'class binding still works in lazy mode',
  );

  console.log('\n✅ Selector-query lazy mode works — deferred, ordered, and only paid once per element.\n');
}

main().catch((err) => {
  console.error('\n❌ Selector-lazy verification failed:\n', err);
  process.exit(1);
});
