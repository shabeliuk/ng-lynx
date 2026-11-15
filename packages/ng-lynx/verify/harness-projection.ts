/**
 * Headless verification of content projection (`<ng-content>`).
 *
 * Ivy compiles `<ng-content>` to a `ɵɵprojection` instruction that resolves
 * matching nodes (by `select` CSS selector, computed via `ɵɵprojectionDef`) and
 * inserts them at the placeholder's position using the same `Renderer2.insertBefore`
 * / `appendChild` calls as any other node. Since `LynxRenderer2` already
 * implements those generically, projection should work with no renderer changes —
 * this harness proves it, including a named slot and a reactive update to
 * projected content.
 *
 * Run with: `npm run verify:projection`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';

import { assert, findByClass, findText, getPage, installMockPapi, printTree, tick } from './mock-papi.js';

@Component({
  selector: 'app-card',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="card">
      <view class="card-header"><ng-content select="[header]"></ng-content></view>
      <view class="card-body"><ng-content></ng-content></view>
    </view>
  `,
})
class CardComponent {}

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [CardComponent],
  template: `
    <app-card>
      <text header>Title</text>
      <text class="count">Body {{ count() }}</text>
      <text class="footer" (tap)="onFooterTap()">Footer</text>
    </app-card>
  `,
})
class TestComponent {
  readonly count = signal(0);
  readonly footerTaps = signal(0);
  onFooterTap(): void {
    this.footerTaps.update((n) => n + 1);
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

  console.log('\n=== Reconstructed native tree (after initial render) ===');
  console.log(printTree(page).join('\n'));

  console.log('\n=== Assertions: initial projection ===');
  const header = findByClass(page, 'card-header')!;
  const body = findByClass(page, 'card-body')!;
  assert(findText(header, 'Title') != null, 'named-slot content ("[header]") projected into .card-header');
  assert(findText(body, 'Body 0') != null, 'default-slot content projected into .card-body');
  assert(findText(body, 'Footer') != null, 'second default-slot sibling also projected into .card-body');
  assert(body.children.length === 2, '.card-body has both default-slot siblings, in source order');
  assert(findText(header, 'Body') == null, 'default content did NOT leak into the named slot');

  console.log('\n=== Bumping the projected signal ===');
  cmp.count.update((n) => n + 1);
  await tick();
  await tick();

  console.log('\n=== Assertions: projected content stays reactive ===');
  assert(findText(body, 'Body 1') != null, 'projected interpolation updated in place');

  console.log('\n=== Tapping an event bound inside projected content ===');
  const footerSign = findByClass(page, 'footer')?.events['tap']?.sign as string | undefined;
  assert(!!footerSign, '(tap) on projected content registered a native listener');
  publishEvent(footerSign!, { type: 'tap' });
  await tick();
  assert(cmp.footerTaps() === 1, "the consumer's handler fired for a tap on its own projected node");

  console.log('\n✅ All projection assertions passed — <ng-content> works end-to-end.\n');
}

main().catch((err) => {
  console.error('\n❌ Projection verification failed:\n', err);
  process.exit(1);
});
