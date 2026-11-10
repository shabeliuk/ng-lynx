/**
 * Headless verification of `enableSelectorQueries: false` (the
 * `ng-ref-{id}` opt-out — `plugin/src/index.ts` / `ops-apply.ts`).
 *
 * With the flag off, `OP.CREATE`'s Main-Thread handler skips the
 * `__SetAttribute(el, 'ng-ref-{id}', 1)` call entirely — no element in the
 * tree should carry one, and everything else (classes, text, `(tap)`-driven
 * updates) must keep working exactly as before, since the attribute is only
 * ever read by selector queries, nothing else.
 *
 * Run with: `npm run verify:selector-opt-out` (sets
 * `ENABLE_SELECTOR_QUERIES=false` before invoking `verify/build.mjs`, the
 * same env-var → esbuild-`define` path `__DEV__` etc. already use).
 *
 * Not covered here: what an actual `fields()`/`invoke()` call does once the
 * attribute is gone. The mock PAPI's single-element `select(...).fields(...)`
 * doesn't validate that the selector matches anything in the mock tree (only
 * `selectAll` does, via `findAllByClass`) — it always feeds back a canned
 * result — so it can't reproduce the real "selector matches nothing, the
 * callback simply never fires" behavior documented as the trade-off of this
 * flag. That's a genuine (and correctly non-obvious) mock-vs-real gap, not
 * something this harness can paper over.
 */
import '@angular/compiler';

import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication, publishEvent } from 'angular-lynx';
import 'angular-lynx/main-thread';

import { assert, findByClass, findText, getPage, installMockPapi, tick } from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <view class="box" [class.on]="on()">
      <text class="label">{{ on() ? 'On' : 'Off' }}</text>
      <view class="item"></view>
      <view class="item"></view>
      <view class="toggle" (tap)="on.set(!on())"></view>
    </view>
  `,
})
class OptOutComponent {
  readonly on = signal(false);
}

function collectAttrKeys(el: any, out: Set<string>): void {
  for (const k of Object.keys(el.attrs ?? {})) out.add(k);
  for (const child of el.children ?? []) collectAttrKeys(child, out);
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>).renderPage({});

  await bootstrapLynxApplication(OptOutComponent);
  await tick();
  await tick();

  const page = getPage();
  const allAttrKeys = new Set<string>();
  collectAttrKeys(page, allAttrKeys);
  const refAttrs = [...allAttrKeys].filter((k) => k.startsWith('ng-ref-'));

  console.log('\n=== Assertions: enableSelectorQueries: false ===');
  assert(refAttrs.length === 0, `no element in the tree carries an ng-ref-{id} attribute (found: ${refAttrs.join(', ') || 'none'})`);
  assert(findByClass(page, 'box') != null, 'the element tree still rendered normally');
  assert(findText(page, 'Off') != null, 'initial text binding still works');

  const toggleSign = findByClass(page, 'toggle')!.events['tap']!.sign;
  publishEvent(toggleSign, { type: 'tap' });
  await tick();
  await tick();

  assert(findText(page, 'On') != null, 'a signal update + (tap) handler still work with the attribute disabled');
  assert(
    (findByClass(page, 'box')!.classes ?? '').split(' ').includes('on'),
    'class binding still works with the attribute disabled',
  );

  console.log('\n✅ Selector-query opt-out works — no ng-ref attributes, everything else unaffected.\n');
}

main().catch((err) => {
  console.error('\n❌ Selector-opt-out verification failed:\n', err);
  process.exit(1);
});
