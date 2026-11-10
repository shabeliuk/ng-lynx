/**
 * Headless verification that Angular's **declarative `i18n="..."` template
 * attribute** renders on this custom renderer.
 *
 * It used not to. `docs/35-i18n.md` documented — from a live web-preview
 * session — that a template using `i18n="@@id"` rendered *only* the
 * i18n-attributed element (empty, no text) and **nothing after it**, with no
 * error logged anywhere, and the rule of thumb became "never use the `i18n`
 * template attribute, use `$localize` fields instead."
 *
 * The root cause turned out to be a missing global rather than anything
 * about this renderer: Angular's i18n runtime (`ɵɵi18nStart` →
 * `applyCreateOpCodes` → `applyMutableOpCodes`) reads the numeric node-type
 * constants off the bare DOM global `Node` (`Node.TEXT_NODE`, …). Neither
 * PrimJS nor a Web Worker has a DOM, so that read throws
 * `ReferenceError: Node is not defined` mid-render. `entry-background.ts`
 * now polyfills the constants (see its `Node` block for why a class, and why
 * adding it changes no other behavior).
 *
 * This harness is the regression test for that fix, and asserts the two
 * things the original bug got wrong: the i18n element renders its **text**,
 * and template content **after** it still renders.
 *
 * Run with: `npm run verify:i18n-attr`.
 */
import '@angular/compiler';
// Installs `globalThis.$localize`, which the compiled `i18n` attribute calls.
// A real app gets this from the i18n build pipeline (docs/35-i18n.md).
import '@angular/localize/init';

import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication, publishEvent } from 'angular-lynx';
import 'angular-lynx/entry-background'; // the polyfill under test
import 'angular-lynx/main-thread';

import { assert, findByClass, findText, getPage, installMockPapi, tick } from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <view class="wrap">
      <text class="title" i18n="@@harnessTitle">Translated title</text>
      <text class="after">Content after the i18n element</text>
      <text class="interpolated" i18n="@@harnessCount">Count is {{ count() }}</text>
      <view class="bump" (tap)="bump()"><text>Bump</text></view>
    </view>
  `,
})
class I18nAttrComponent {
  readonly count = signal(0);
  bump(): void {
    this.count.update((n) => n + 1);
  }
}

async function main(): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  // Node.js has no DOM either, so this is already the on-device situation —
  // asserted rather than assumed, since the whole point is that the polyfill
  // (not an ambient global) is what makes this work.
  assert(
    typeof g['Node'] === 'function',
    'entry-background installed the Node constants polyfill (Node.js has no DOM global of its own)',
  );
  assert(
    (g['Node'] as { TEXT_NODE: number }).TEXT_NODE === 3
      && (g['Node'] as { ELEMENT_NODE: number }).ELEMENT_NODE === 1
      && (g['Node'] as { COMMENT_NODE: number }).COMMENT_NODE === 8,
    'the node-type constants Angular reads have their standard DOM values',
  );

  installMockPapi();
  (globalThis as Record<string, any>).renderPage({});

  await bootstrapLynxApplication(I18nAttrComponent);
  await tick();
  await tick();

  const page = getPage();

  console.log('\n=== The i18n-attributed element renders (it used to come out empty) ===');
  assert(findByClass(page, 'title') != null, 'the i18n-attributed element exists');
  assert(
    findText(page, 'Translated title') != null,
    'it has its text content — the op-code path completed instead of throwing',
  );

  console.log('\n=== Template content AFTER it renders (the render used to stop dead here) ===');
  assert(
    findText(page, 'Content after the i18n element') != null,
    'the sibling after the i18n element rendered',
  );
  assert(findByClass(page, 'bump') != null, 'so did everything else in the template');

  console.log('\n=== An i18n block with interpolation stays reactive ===');
  assert(findText(page, 'Count is 0') != null, 'the interpolated i18n text rendered its initial value');
  const sign = findByClass(page, 'bump')?.events['tap']?.sign;
  assert(typeof sign === 'string', 'the (tap) inside the same template bound normally');
  publishEvent(sign as string, { type: 'tap' });
  await tick();
  await tick();
  assert(
    findText(page, 'Count is 1') != null,
    'a signal write re-rendered through the i18n block — i18nApply updates work, not just first render',
  );

  console.log('\n✅ The declarative i18n attribute renders correctly.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ i18n-attribute verification failed:\n', err);
  process.exit(1);
});
