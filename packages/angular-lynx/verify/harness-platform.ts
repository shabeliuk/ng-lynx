/**
 * Headless verification of platform-API wrappers added to close gaps found
 * auditing lynxjs.org's full API reference against this package:
 *
 *  - `injectSystemInfo()` — typed `SystemInfo` (platform/screen metrics).
 *  - `LynxErrorHandler` — the default `ErrorHandler` forwards to
 *    `lynx.reportError()` in addition to `console.error`.
 *  - `LynxSessionStorage` — `get`/`set`/`subscribe` over
 *    `lynx.*SessionStorage*`, the cross-LynxView storage mechanism.
 *  - `LynxExposure` — `resumeExposure()`/`stopExposure()`/
 *    `setObserverFrameRate()`, the app-wide exposure-detection controls
 *    (distinct from `LynxIntersectionObserver`).
 *  - `ShadowElement.path()` — the 4th SelectorQuery/NodesRef method
 *    (`fields`/`invoke`/`setNativeProps` were already wrapped).
 *  - `LynxObject` — `getElementById()` (+ the handle's `animate()`),
 *    `getTextInfo()`, `addFont()`, `requestResourcePrefetch()`/
 *    `cancelResourcePrefetch()`, `registerModule()`/`getJSModule()`,
 *    `accessibilityAnnounce()`, `beforePublishEvent`.
 *
 * Run with: `npm run verify:platform`.
 */
import '@angular/compiler';

import {
  Component,
  type ElementRef,
  ErrorHandler,
  inject,
  NO_ERRORS_SCHEMA,
  signal,
  ViewChild,
} from '@angular/core';

import {
  asLynxElement,
  bootstrapLynxApplication,
  injectSystemInfo,
  LynxExposure,
  LynxObject,
  LynxSessionStorage,
} from 'angular-lynx';
import 'angular-lynx/main-thread';

import {
  addedFonts,
  animateCalls,
  announcedMessages,
  assert,
  exposureCalls,
  findText,
  fireBeforePublishEvent,
  getPage,
  installMockPapi,
  prefetchCalls,
  reportedErrors,
  tick,
} from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view #box id="my-box" class="box">
      <text class="platform">{{ system.platform }}</text>
    </view>
  `,
})
export class TestComponent {
  @ViewChild('box') box?: ElementRef;

  readonly system = injectSystemInfo();
  readonly exposure = inject(LynxExposure);
  readonly sessionStorage = inject(LynxSessionStorage);
  readonly errorHandler = inject(ErrorHandler);
  readonly lynxObject = inject(LynxObject);

  readonly draft = signal<string | undefined>(undefined);
  readonly subscribedValue = signal<string | undefined>(undefined);
  readonly pathResult = signal<unknown[] | null | undefined>(undefined);
  readonly beforePublishFired = signal(0);

  triggerError(): void {
    this.errorHandler.handleError(new Error('boom'));
  }

  queryPath(): void {
    if (!this.box) return;
    asLynxElement(this.box.nativeElement).path((res) => this.pathResult.set(res));
  }

  onBeforePublishTap = (): void => {
    this.beforePublishFired.update((n) => n + 1);
  };
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>)['renderPage']({});
  const appRef = await bootstrapLynxApplication(TestComponent);
  const app = (appRef as { components: Array<{ instance: TestComponent }> }).components[0]!.instance;
  await tick();
  const page = getPage();

  console.log('\n=== injectSystemInfo() ===');
  assert(app.system.platform === 'headless', 'platform field reached typed app code');
  assert(app.system.pixelRatio === 3, 'pixelRatio field reached typed app code');
  assert(app.system.runtimeType === 'quickjs', 'BG-only runtimeType field is present');

  console.log('\n=== LynxErrorHandler → lynx.reportError() ===');
  assert(reportedErrors().length === 0, 'no errors reported yet');
  app.triggerError();
  assert(reportedErrors().length === 1, 'handleError forwarded to lynx.reportError exactly once');
  assert(
    (reportedErrors()[0]!.error as Error).message === 'boom',
    'the actual Error instance (not a stringified copy) reached reportError',
  );
  assert(reportedErrors()[0]!.options?.level === 'error', 'reported at "error" level');

  console.log('\n=== LynxSessionStorage ===');
  const before = await app.sessionStorage.get('draft');
  assert(before === undefined, 'unset key resolves undefined');
  app.sessionStorage.set('draft', 'hello');
  const after = await app.sessionStorage.get('draft');
  assert(after === 'hello', 'set() then get() round-trips the value');

  const unsubscribe = app.sessionStorage.subscribe<string>('draft', (v) => app.subscribedValue.set(v));
  app.sessionStorage.set('draft', 'world');
  assert(app.subscribedValue() === 'world', 'subscribe() fired on a write after subscribing');
  unsubscribe();
  app.sessionStorage.set('draft', 'ignored-after-unsubscribe');
  assert(app.subscribedValue() === 'world', 'unsubscribe() actually stopped delivery');

  console.log('\n=== LynxExposure ===');
  assert(exposureCalls().length === 0, 'no exposure calls yet');
  app.exposure.stopExposure();
  app.exposure.resumeExposure();
  app.exposure.setObserverFrameRate({ forExposureCheck: 10 });
  assert(
    exposureCalls().length === 2 && exposureCalls()[0] === 'stop' && exposureCalls()[1] === 'resume',
    'stopExposure/resumeExposure reached the real PAPI in order',
  );

  console.log('\n=== ShadowElement.path() ===');
  app.queryPath();
  await tick();
  assert(Array.isArray(app.pathResult()), 'path() delivered a result array asynchronously');
  assert((app.pathResult() as unknown[]).length === 2, 'path() returned the full root-path chain');

  console.log('\n=== LynxObject.getElementById() + handle.animate() ===');
  const handle = app.lynxObject.getElementById('my-box');
  assert(handle !== null, 'getElementById found the element by its id attribute');
  assert(app.lynxObject.getElementById('nope') === null, 'a missing id resolves null');
  handle!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  assert(animateCalls().length === 1, 'animate() reached the real PAPI');
  assert(animateCalls()[0]!.id === 'my-box', 'animate() targeted the right handle');

  console.log('\n=== LynxObject.getTextInfo() ===');
  const metrics = app.lynxObject.getTextInfo('hello', { fontSize: '16px' });
  assert(metrics?.width === 40, 'getTextInfo returned real measured width');

  console.log('\n=== LynxObject.addFont() ===');
  app.lynxObject.addFont({ 'font-family': 'Custom', src: 'https://example.com/custom.ttf' });
  assert(addedFonts().length === 1 && addedFonts()[0]!['font-family'] === 'Custom', 'addFont reached the real PAPI');

  console.log('\n=== LynxObject.requestResourcePrefetch() / cancelResourcePrefetch() ===');
  const prefetchRequest = { data: [{ uri: 'https://example.com/a.png', type: 'image' as const }] };
  const prefetchResult = await app.lynxObject.requestResourcePrefetch(prefetchRequest);
  assert(prefetchResult.code === 0, 'requestResourcePrefetch resolved success');
  await app.lynxObject.cancelResourcePrefetch(prefetchRequest);
  assert(
    prefetchCalls().length === 2
      && prefetchCalls()[0]!.action === 'request'
      && prefetchCalls()[1]!.action === 'cancel',
    'both calls reached the real PAPI in order',
  );

  console.log('\n=== LynxObject.registerModule() / getJSModule() ===');
  app.lynxObject.registerModule('MyModule', { greet: () => 'hi' });
  const mod = app.lynxObject.getJSModule<{ greet(): string }>('MyModule');
  assert(mod?.greet() === 'hi', 'registerModule + getJSModule round-tripped a real value');

  console.log('\n=== LynxObject.accessibilityAnnounce() ===');
  app.lynxObject.accessibilityAnnounce('Item added to cart');
  assert(announcedMessages().length === 1 && announcedMessages()[0] === 'Item added to cart', 'accessibilityAnnounce reached the real PAPI');

  console.log('\n=== LynxObject.beforePublishEvent ===');
  app.lynxObject.beforePublishEvent.add('tap', app.onBeforePublishTap);
  fireBeforePublishEvent('tap');
  assert(app.beforePublishFired() === 1, 'beforePublishEvent.add wired a real handler');
  app.lynxObject.beforePublishEvent.remove('tap', app.onBeforePublishTap);
  fireBeforePublishEvent('tap');
  assert(app.beforePublishFired() === 1, 'beforePublishEvent.remove actually stopped delivery');

  assert(findText(page, 'headless') != null, 'sanity: the component actually rendered');

  console.log('\n✅ All platform-API assertions passed.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Platform-API verification failed:\n', err);
  process.exit(1);
});
