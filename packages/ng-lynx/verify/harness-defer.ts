/**
 * Headless verification of visibility detection:
 *   - the `globalThis.IntersectionObserver` polyfill over Lynx's native
 *     observer (backs `@defer (on viewport)`),
 *   - Angular's `@defer (on viewport)` end-to-end,
 *   - the `LynxIntersectionObserver` injectable wrapper.
 *
 * The mock `lynx.createIntersectionObserver` records observed selectors; the
 * harness drives visibility with `fireIntersection(selector, isIntersecting)`.
 *
 * Real Lynx finds an observer's target **by id only** (native and web-core
 * alike), so the assertions below insist that what reaches `observe()` is an
 * `#id` selector and that the element actually carries that id. The mock
 * itself accepts any selector, which is how the attribute-selector version
 * passed here for so long while observing nothing in the web preview.
 *
 * Run with: `npm run verify:defer`.
 */
import '@angular/compiler';

import { Component, ElementRef, inject, NO_ERRORS_SCHEMA, signal, ViewChild } from '@angular/core';

import {
  bootstrapLynxApplication,
  LynxIntersectionObserver,
} from 'ng-lynx';
import {
  installIntersectionObserver,
  publishEvent,
} from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';

import {
  assert,
  findByClass,
  findText,
  fireIntersection,
  getPage,
  installMockPapi,
  observedSelectors,
  tick,
} from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      @defer (on viewport) {
        <text class="loaded">Loaded content</text>
      } @placeholder {
        <text class="ph">Placeholder</text>
      }
    </view>
  `,
})
export class DeferComponent {}

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      @defer (on interaction) {
        <text class="loaded">Loaded content</text>
      } @placeholder {
        <text class="ph">Placeholder</text>
      }
    </view>
  `,
})
export class DeferInteractionComponent {}

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      @defer (on hover) {
        <text class="loaded">Loaded content</text>
      } @placeholder {
        <text class="ph">Placeholder</text>
      }
    </view>
  `,
})
export class DeferHoverComponent {}

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<view class="target" #target><text>{{ state() }}</text></view>`,
})
export class ServiceComponent {
  // `@ViewChild` (decorator) rather than `viewChild()` (initializer): the JIT
  // verify build doesn't wire up initializer queries — see docs/19-testing.md.
  @ViewChild('target', { read: ElementRef }) target!: ElementRef;
  private readonly visibility = inject(LynxIntersectionObserver);
  readonly state = signal('hidden');
  observe(): () => void {
    return this.visibility.observe(
      this.target.nativeElement,
      (e) => {
        this.state.set(e.isIntersecting ? `visible@${e.intersectionRatio}` : 'hidden');
      },
      { thresholds: [0.5] },
    );
  }
}

async function testPolyfillUnit(): Promise<void> {
  console.log('\n=== IntersectionObserver polyfill (unit) ===');
  installMockPapi();
  installIntersectionObserver();
  const IO = (globalThis as Record<string, any>).IntersectionObserver;
  assert(typeof IO === 'function', 'globalThis.IntersectionObserver was installed');

  const seen: { isIntersecting: boolean; target: unknown }[] = [];
  const target = { selector: '[ng-ref-99]' };
  const io = new IO((entries: { isIntersecting: boolean; target: unknown }[]) => {
    for (const e of entries) seen.push({ isIntersecting: e.isIntersecting, target: e.target });
  });
  io.observe(target);
  await tick();
  assert(observedSelectors().includes('[ng-ref-99]'), 'observe() registered the selector of a non-ShadowElement target as-is');

  fireIntersection('[ng-ref-99]', true);
  assert(seen.length === 1, 'callback fired once');
  assert(seen[0].isIntersecting === true, 'entry.isIntersecting propagated');
  assert(seen[0].target === target, 'entry.target === the observed element (identity preserved for Angular)');

  io.unobserve(target);
  assert(!observedSelectors().includes('[ng-ref-99]'), 'unobserve() disconnected the native observer');
  fireIntersection('[ng-ref-99]', true);
  assert(seen.length === 1, 'no callback after unobserve');
}

async function testDefer(): Promise<void> {
  console.log('\n=== @defer (on viewport) end-to-end ===');
  installMockPapi();
  installIntersectionObserver();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  await bootstrapLynxApplication(DeferComponent);
  await tick();
  await tick();
  const page = getPage();

  assert(findText(page, 'Placeholder') != null, 'placeholder rendered initially');
  assert(findText(page, 'Loaded content') == null, 'deferred content not yet rendered');

  const selectors = observedSelectors();
  assert(selectors.length === 1, 'exactly one element (the placeholder trigger) is observed');
  assert(selectors[0].startsWith('#'), `the trigger is observed by id, as Lynx requires (got ${selectors[0]})`);
  assert(
    findByClass(page, 'ph')?.attrs['id'] === selectors[0].slice(1),
    'the placeholder trigger element was given that id on the Main Thread',
  );

  fireIntersection(selectors[0], true);
  await tick();
  await tick();
  await tick();
  assert(findText(page, 'Loaded content') != null, 'deferred content rendered after entering the viewport');
  assert(findText(page, 'Placeholder') == null, 'placeholder replaced by the loaded content');
}

async function testDeferOnInteraction(): Promise<void> {
  console.log('\n=== @defer (on interaction) end-to-end (click → tap mapping) ===');
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  await bootstrapLynxApplication(DeferInteractionComponent);
  await tick();
  await tick();
  const page = getPage();

  assert(findText(page, 'Placeholder') != null, 'placeholder rendered initially');
  assert(findText(page, 'Loaded content') == null, 'deferred content not yet rendered');

  const trigger = findByClass(page, 'ph');
  const sign = trigger?.events['tap']?.sign as string | undefined;
  assert(
    !!sign,
    "the placeholder trigger registered a native 'tap' listener — ShadowElement.addEventListener('click', …) mapped to Lynx's real tap gesture",
  );

  publishEvent(sign!, { type: 'tap' });
  await tick();
  await tick();
  await tick();
  assert(findText(page, 'Loaded content') != null, 'deferred content rendered after a tap on the trigger');
  assert(findText(page, 'Placeholder') == null, 'placeholder replaced by the loaded content');
}

async function testDeferOnHover(): Promise<void> {
  console.log('\n=== @defer (on hover) — intentionally inert on Lynx ===');
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  await bootstrapLynxApplication(DeferHoverComponent);
  await tick();
  await tick();
  const page = getPage();

  assert(findText(page, 'Placeholder') != null, 'placeholder rendered initially');
  const trigger = findByClass(page, 'ph');
  // `on hover` listens for mouseenter/mouseover/focusin — none have a native
  // Lynx equivalent (no mouse, no generic keyboard-focus model), so
  // `addEventListener` silently no-ops for all three and nothing is
  // registered. This is the documented, intentional behavior — see
  // docs/24-visibility.md — not a bug: without a device mouse, the block
  // has no way to fire and correctly stays on its placeholder forever.
  assert(
    Object.keys(trigger?.events ?? {}).length === 0,
    "on hover registers no native listener at all (mouseenter/mouseover/focusin have no Lynx equivalent)",
  );
}

async function testService(): Promise<void> {
  console.log('\n=== LynxIntersectionObserver (injectable) ===');
  installMockPapi();
  installIntersectionObserver();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(ServiceComponent);
  await tick();
  await tick();
  const page = getPage();
  const cmp = app.components[0].instance as ServiceComponent;

  assert(findText(page, 'hidden') != null, 'starts hidden');
  const dispose = cmp.observe();
  await tick();
  const selectors = observedSelectors();
  assert(selectors.length === 1, 'service registered one observer');
  assert(selectors[0].startsWith('#'), `the service observes by id, as Lynx requires (got ${selectors[0]})`);
  assert(findByClass(page, 'target')?.attrs['id'] === selectors[0].slice(1), 'the observed element was given that id');

  fireIntersection(selectors[0], true, 0.75);
  await tick();
  await tick();
  assert(findText(page, 'visible@0.75') != null, 'service callback delivered isIntersecting + ratio, CD ran');

  dispose();
  assert(observedSelectors().length === 0, 'dispose() disconnected the observer');
  app.destroy();
}

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="banner" exposure-id="b1" (uiappear)="onAppear()" (uidisappear)="onDisappear()">
      <text>{{ visible() ? 'visible' : 'hidden' }}</text>
    </view>
  `,
})
export class ExposureComponent {
  readonly visible = signal(false);
  onAppear(): void {
    this.visible.set(true);
  }
  onDisappear(): void {
    this.visible.set(false);
  }
}

async function testExposure(): Promise<void> {
  console.log('\n=== Exposure events (uiappear / uidisappear) ===');
  installMockPapi();
  installIntersectionObserver();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(ExposureComponent);
  await tick();
  await tick();
  const page = getPage();
  const banner = findByClass(page, 'banner');

  assert(findText(page, 'hidden') != null, 'starts hidden');
  assert(banner?.attrs['exposure-id'] === 'b1', 'exposure-id attribute reached the element');
  const appearSign = banner?.events['uiappear']?.sign as string | undefined;
  const disappearSign = banner?.events['uidisappear']?.sign as string | undefined;
  assert(!!appearSign && !!disappearSign, 'uiappear/uidisappear listeners registered natively');

  // The native exposure system fires uiappear when the element enters view.
  publishEvent(appearSign!, { type: 'uiappear' });
  await tick();
  await tick();
  assert(findText(page, 'visible') != null, 'uiappear handler ran, view updated (CD)');

  publishEvent(disappearSign!, { type: 'uidisappear' });
  await tick();
  await tick();
  assert(findText(page, 'hidden') != null, 'uidisappear handler ran');
  app.destroy();
}

async function main(): Promise<void> {
  await testPolyfillUnit();
  await testDefer();
  await testDeferOnInteraction();
  await testDeferOnHover();
  await testService();
  await testExposure();
  console.log('\n✅ All visibility assertions passed — IntersectionObserver + @defer + exposure work.\n');
}

main().catch((err) => {
  console.error('\n❌ Visibility verification failed:\n', err);
  process.exit(1);
});
