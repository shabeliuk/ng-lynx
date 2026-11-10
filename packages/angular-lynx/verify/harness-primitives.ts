/**
 * Headless verification of the typed directives added for the rest of
 * Lynx's built-in "UI Primitives" list (`angular-lynx/elements`):
 * `<svg>`, `<frame>`, `<overlay>`, `<refresh>`/`<refresh-header>`,
 * `<title-bar-view>`, `<viewpager>`/`<viewpager-item>`,
 * `<scroll-coordinator>` and its 4 children, `<blur-view>`, `<webview>`.
 *
 * **What this proves, and what it can't.** Every one of these tags is
 * registered in `KNOWN_LYNX_TAGS` (`main-thread/src/ops-apply.ts`), so this
 * harness proves the wire protocol: the Main Thread calls the real, typed
 * `__CreateElement(tag, …)` PAPI (not the `<view>` fallback unregistered tags
 * get), every typed attribute reaches it as a `SET_ATTR` op with its raw
 * type preserved, and every typed event wires a listener with the right
 * payload shape. Confirmed empirically (via the real web preview, not just
 * this mock) that `<svg>` and `<frame>` additionally render correctly as
 * real `x-svg` / nested `<lynx-view>` elements in `@lynx-js/web-core` — the
 * other 13 do not (they fall back to an inert, unstyled element there; see
 * the shared doc comment above `LynxOverlay` in `runtime/src/elements.ts`).
 * On a real Android/iOS/Harmony device the native engine backs all of them.
 *
 * Run with: `npm run verify:primitives`.
 */
import '@angular/compiler';

import { Component, signal } from '@angular/core';

import { bootstrapLynxApplication, publishEvent } from 'angular-lynx';
import { LYNX_ELEMENTS, type LynxEvent } from 'angular-lynx/elements';
import 'angular-lynx/main-thread';

import { assert, type MockEl, getPage, installMockPapi, tick } from './mock-papi.js';

function findAllByType(el: MockEl, type: string): MockEl[] {
  const out: MockEl[] = [];
  if (el.type === type) out.push(el);
  for (const child of el.children) out.push(...findAllByType(child, type));
  return out;
}
function findByType(el: MockEl, type: string): MockEl | undefined {
  return findAllByType(el, type)[0];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  // NOTE: no `schemas` — every tag below is made known by a directive here.
  template: `
    <view class="app">
      <svg [src]="svgSrc()" [content]="svgContent()" [current-color]="svgColor()" (load)="onSvgLoad($event)"></svg>

      <frame
        [src]="frameSrc()"
        [data]="frameData()"
        [global-props]="frameGlobalProps()"
        [auto-width]="frameAutoWidth()"
        (load)="onFrameLoad($event)"
        (loadmetrics)="onFrameLoadMetrics($event)"
      ></frame>

      <overlay
        class="bound"
        [visible]="overlayVisible()"
        [level]="overlayLevel()"
        [mode]="overlayMode()"
        (showoverlay)="onShowOverlay($event)"
        (overlaytouch)="onOverlayTouch($event)"
      ></overlay>
      <overlay class="bare"></overlay>

      <refresh [enable-refresh]="refreshEnabled()" (startrefresh)="onStartRefresh($event)" (headeroffset)="onHeaderOffset($event)">
        <refresh-header><text>pull</text></refresh-header>
      </refresh>

      <title-bar-view [moveable]="titleBarMoveable()"></title-bar-view>

      <viewpager
        [initial-select-index]="vpIndex()"
        [enable-scroll]="vpEnableScroll()"
        (change)="onVpChange($event)"
        (offsetchange)="onVpOffsetChange($event)"
      >
        <viewpager-item><text>p1</text></viewpager-item>
        <viewpager-item><text>p2</text></viewpager-item>
      </viewpager>

      <scroll-coordinator [granularity]="scGranularity()" [refresh-mode]="scRefreshMode()" (offset)="onScOffset($event)">
        <scroll-coordinator-header><text>hdr</text></scroll-coordinator-header>
        <scroll-coordinator-slot>
          <scroll-coordinator-slot-drag [enable-drag]="scSlotDrag()"><text>drag</text></scroll-coordinator-slot-drag>
        </scroll-coordinator-slot>
        <scroll-coordinator-toolbar><text>tb</text></scroll-coordinator-toolbar>
      </scroll-coordinator>

      <blur-view [blur-radius]="blurRadius()" [blur-effect]="blurEffect()"><text>blurred</text></blur-view>

      <webview
        [src]="webviewSrc()"
        [enable-debug]="webviewDebug()"
        (load)="onWebviewLoad($event)"
        (message)="onWebviewMessage($event)"
        (error)="onWebviewError($event)"
      ></webview>
    </view>
  `,
})
export class TestComponent {
  readonly svgSrc = signal<string | undefined>(undefined);
  readonly svgContent = signal('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="5"/></svg>');
  readonly svgColor = signal('#336699');
  readonly svgLoadCount = signal(0);

  readonly frameSrc = signal('nested.lynx.bundle');
  readonly frameData = signal({ greeting: 'hi' });
  readonly frameGlobalProps = signal({ theme: 'dark' });
  readonly frameAutoWidth = signal(true);
  readonly lastFrameLoad = signal<{ url: string; statusCode: number } | undefined>(undefined);
  readonly lastFrameLoadMetrics = signal<{ url: string } | undefined>(undefined);

  readonly overlayVisible = signal(true);
  readonly overlayLevel = signal<1 | 2 | 3 | 4>(2);
  readonly overlayMode = signal('top');
  readonly showOverlayCount = signal(0);
  readonly lastOverlayTouch = signal<{ x: number; y: number; state: number } | undefined>(undefined);

  readonly refreshEnabled = signal(true);
  readonly startRefreshCount = signal(0);
  readonly lastHeaderOffset = signal<{ isDragging: boolean; offsetPercent: number } | undefined>(undefined);

  readonly titleBarMoveable = signal(true);

  readonly vpIndex = signal(1);
  readonly vpEnableScroll = signal(false);
  readonly lastVpChange = signal<{ index: number; isDragged: boolean } | undefined>(undefined);
  readonly lastVpOffsetChange = signal<{ offset: number } | undefined>(undefined);

  readonly scGranularity = signal(0.05);
  readonly scRefreshMode = signal<'none' | 'page' | 'fold'>('fold');
  readonly lastScOffset = signal<{ offset: number; height: number } | undefined>(undefined);
  readonly scSlotDrag = signal(false);

  readonly blurRadius = signal('20px');
  readonly blurEffect = signal<'light' | 'extra-light' | 'dark' | 'glass' | 'glass-container'>('glass');

  readonly webviewSrc = signal('https://example.com');
  readonly webviewDebug = signal(true);
  readonly lastWebviewLoad = signal(0);
  readonly lastWebviewMessage = signal<{ msg: string } | undefined>(undefined);
  readonly lastWebviewError = signal<{ errorMsg: string; errorCode: number } | undefined>(undefined);

  onSvgLoad(_e: LynxEvent<unknown>): void { this.svgLoadCount.update((n) => n + 1); }
  onFrameLoad(e: LynxEvent<{ url: string; statusCode: number }>): void { this.lastFrameLoad.set(e.detail); }
  onFrameLoadMetrics(e: LynxEvent<{ url: string }>): void { this.lastFrameLoadMetrics.set(e.detail); }
  onShowOverlay(_e: LynxEvent<unknown>): void { this.showOverlayCount.update((n) => n + 1); }
  onOverlayTouch(e: LynxEvent<{ x: number; y: number; state: number }>): void { this.lastOverlayTouch.set(e.detail); }
  onStartRefresh(_e: LynxEvent<{ isManual: boolean }>): void { this.startRefreshCount.update((n) => n + 1); }
  onHeaderOffset(e: LynxEvent<{ isDragging: boolean; offsetPercent: number }>): void { this.lastHeaderOffset.set(e.detail); }
  onVpChange(e: LynxEvent<{ index: number; isDragged: boolean }>): void { this.lastVpChange.set(e.detail); }
  onVpOffsetChange(e: LynxEvent<{ offset: number }>): void { this.lastVpOffsetChange.set(e.detail); }
  onScOffset(e: LynxEvent<{ offset: number; height: number }>): void { this.lastScOffset.set(e.detail); }
  onWebviewLoad(_e: LynxEvent<unknown>): void { this.lastWebviewLoad.update((n) => n + 1); }
  onWebviewMessage(e: LynxEvent<{ msg: string }>): void { this.lastWebviewMessage.set(e.detail); }
  onWebviewError(e: LynxEvent<{ errorMsg: string; errorCode: number }>): void { this.lastWebviewError.set(e.detail); }
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>)['renderPage']({});
  const appRef = await bootstrapLynxApplication(TestComponent);
  const app = (appRef as { components: Array<{ instance: TestComponent }> }).components[0]!.instance;
  await tick();
  const page = getPage();

  console.log('\n=== every tag creates a real native element, not the unknown-tag <view> fallback ===');
  for (const tag of [
    'svg', 'frame', 'overlay', 'refresh', 'refresh-header', 'title-bar-view',
    'viewpager', 'viewpager-item', 'scroll-coordinator', 'scroll-coordinator-header',
    'scroll-coordinator-slot', 'scroll-coordinator-slot-drag', 'scroll-coordinator-toolbar',
    'blur-view', 'webview',
  ]) {
    const el = findByType(page, tag);
    assert(!!el, `<${tag}> routed to __CreateElement('${tag}', …), not the __CreateView fallback (found none)`);
  }
  assert(findAllByType(page, 'viewpager-item').length === 2, 'both <viewpager-item> children created');

  console.log('\n=== <svg> ===');
  const svg = findByType(page, 'svg')!;
  assert(svg.attrs['content']?.toString().includes('circle'), 'content forwarded');
  assert(svg.attrs['current-color'] === '#336699', 'current-color forwarded');
  const svgLoadSign = svg.events?.['load']?.sign as string | undefined;
  assert(!!svgLoadSign, '(load) registered a listener');
  publishEvent(svgLoadSign!, { type: 'load' });
  await tick();
  assert(app.svgLoadCount() === 1, 'load handler ran once');

  console.log('\n=== <frame> ===');
  const frame = findByType(page, 'frame')!;
  assert(frame.attrs['src'] === 'nested.lynx.bundle', 'src forwarded');
  assert((frame.attrs['data'] as { greeting?: string })?.greeting === 'hi', 'data forwarded as a real object');
  assert((frame.attrs['global-props'] as { theme?: string })?.theme === 'dark', 'global-props forwarded');
  assert(frame.attrs['auto-width'] === true, 'auto-width forwarded as a real boolean');
  const frameLoadSign = frame.events?.['load']?.sign as string | undefined;
  const frameLoadMetricsSign = frame.events?.['loadmetrics']?.sign as string | undefined;
  publishEvent(frameLoadSign!, { type: 'load', detail: { url: 'nested.lynx.bundle', statusCode: 0 } });
  await tick();
  assert(app.lastFrameLoad()?.statusCode === 0, 'load payload delivered');
  publishEvent(frameLoadMetricsSign!, { type: 'loadmetrics', detail: { url: 'nested.lynx.bundle' } });
  await tick();
  assert(app.lastFrameLoadMetrics()?.url === 'nested.lynx.bundle', 'loadmetrics payload delivered');

  console.log('\n=== <overlay> ===');
  const overlays = findAllByType(page, 'overlay');
  const [boundOverlay, bareOverlay] = overlays;
  assert(boundOverlay!.attrs['visible'] === true, 'visible forwarded');
  assert(boundOverlay!.attrs['level'] === 2, 'level forwarded as a real number');
  assert(boundOverlay!.attrs['mode'] === 'top', 'mode forwarded');
  assert(bareOverlay!.attrs['visible'] === undefined, 'unbound visible never set an attr on the second <overlay>');
  const showOverlaySign = boundOverlay!.events?.['showoverlay']?.sign as string | undefined;
  const overlayTouchSign = boundOverlay!.events?.['overlaytouch']?.sign as string | undefined;
  assert(!bareOverlay!.events?.['showoverlay'], 'unbound (showoverlay) registered no listener at all — lazy outputs cost nothing');
  publishEvent(showOverlaySign!, { type: 'showoverlay' });
  await tick();
  assert(app.showOverlayCount() === 1, 'showoverlay handler ran once');
  publishEvent(overlayTouchSign!, { type: 'overlaytouch', detail: { x: 12, y: 34, state: 1 } });
  await tick();
  assert(app.lastOverlayTouch()?.x === 12 && app.lastOverlayTouch()?.state === 1, 'overlaytouch payload delivered');
  // `visible: false` per platform: an explicit false on a device (Android
  // only hides on it), the attribute removed in the web preview (web-core
  // reads any present `visible`, "false" included, as shown).
  app.overlayVisible.set(false);
  await tick();
  assert(boundOverlay!.attrs['visible'] === false, 'native: visible=false sent as a real false, not removed');
  const g = globalThis as { SystemInfo?: unknown };
  const savedSystemInfo = g.SystemInfo;
  g.SystemInfo = { platform: 'web' };
  try {
    app.overlayVisible.set(true);
    await tick();
    assert(boundOverlay!.attrs['visible'] === true, 'web: visible=true set');
    app.overlayVisible.set(false);
    await tick();
    assert(!('visible' in boundOverlay!.attrs), 'web: visible=false removes the attribute');
  } finally {
    g.SystemInfo = savedSystemInfo;
  }

  console.log('\n=== <refresh> / <refresh-header> ===');
  const refresh = findByType(page, 'refresh')!;
  assert(refresh.attrs['enable-refresh'] === true, 'enable-refresh forwarded');
  assert(!!findByType(page, 'refresh-header'), '<refresh-header> child created');
  const startRefreshSign = refresh.events?.['startrefresh']?.sign as string | undefined;
  const headerOffsetSign = refresh.events?.['headeroffset']?.sign as string | undefined;
  publishEvent(startRefreshSign!, { type: 'startrefresh', detail: { isManual: true } });
  await tick();
  assert(app.startRefreshCount() === 1, 'startrefresh handler ran once');
  publishEvent(headerOffsetSign!, { type: 'headeroffset', detail: { isDragging: true, offsetPercent: 0.5 } });
  await tick();
  assert(app.lastHeaderOffset()?.offsetPercent === 0.5, 'headeroffset payload delivered');

  console.log('\n=== <title-bar-view> ===');
  assert(findByType(page, 'title-bar-view')!.attrs['moveable'] === true, 'moveable forwarded');

  console.log('\n=== <viewpager> / <viewpager-item> ===');
  const viewpager = findByType(page, 'viewpager')!;
  assert(viewpager.attrs['initial-select-index'] === 1, 'initial-select-index forwarded as a real number');
  assert(viewpager.attrs['enable-scroll'] === false, 'enable-scroll forwarded (false still explicit)');
  const vpChangeSign = viewpager.events?.['change']?.sign as string | undefined;
  const vpOffsetChangeSign = viewpager.events?.['offsetchange']?.sign as string | undefined;
  publishEvent(vpChangeSign!, { type: 'change', detail: { index: 1, isDragged: true } });
  await tick();
  assert(app.lastVpChange()?.index === 1 && app.lastVpChange()?.isDragged === true, 'change payload delivered');
  publishEvent(vpOffsetChangeSign!, { type: 'offsetchange', detail: { offset: 1.5 } });
  await tick();
  assert(app.lastVpOffsetChange()?.offset === 1.5, 'offsetchange payload delivered');

  console.log('\n=== <scroll-coordinator> and its children ===');
  const scrollCoordinator = findByType(page, 'scroll-coordinator')!;
  assert(scrollCoordinator.attrs['granularity'] === 0.05, 'granularity forwarded as a real number');
  assert(scrollCoordinator.attrs['refresh-mode'] === 'fold', 'refresh-mode forwarded');
  assert(!!findByType(page, 'scroll-coordinator-header'), '<scroll-coordinator-header> child created');
  assert(!!findByType(page, 'scroll-coordinator-slot'), '<scroll-coordinator-slot> child created');
  assert(!!findByType(page, 'scroll-coordinator-toolbar'), '<scroll-coordinator-toolbar> child created');
  const slotDrag = findByType(page, 'scroll-coordinator-slot-drag')!;
  assert(slotDrag.attrs['enable-drag'] === false, 'enable-drag forwarded on scroll-coordinator-slot-drag');
  const scOffsetSign = scrollCoordinator.events?.['offset']?.sign as string | undefined;
  publishEvent(scOffsetSign!, { type: 'offset', detail: { offset: 40, height: 120 } });
  await tick();
  assert(app.lastScOffset()?.offset === 40 && app.lastScOffset()?.height === 120, 'offset payload delivered');

  console.log('\n=== <blur-view> ===');
  const blurView = findByType(page, 'blur-view')!;
  assert(blurView.attrs['blur-radius'] === '20px', 'blur-radius forwarded');
  assert(blurView.attrs['blur-effect'] === 'glass', 'blur-effect forwarded');

  console.log('\n=== <webview> ===');
  const webview = findByType(page, 'webview')!;
  assert(webview.attrs['src'] === 'https://example.com', 'src forwarded');
  assert(webview.attrs['enable-debug'] === true, 'enable-debug forwarded');
  const webviewLoadSign = webview.events?.['load']?.sign as string | undefined;
  const webviewMessageSign = webview.events?.['message']?.sign as string | undefined;
  const webviewErrorSign = webview.events?.['error']?.sign as string | undefined;
  publishEvent(webviewLoadSign!, { type: 'load' });
  await tick();
  assert(app.lastWebviewLoad() === 1, 'load handler ran once');
  publishEvent(webviewMessageSign!, { type: 'message', detail: { msg: 'hello from js' } });
  await tick();
  assert(app.lastWebviewMessage()?.msg === 'hello from js', 'message payload delivered');
  publishEvent(webviewErrorSign!, { type: 'error', detail: { errorMsg: 'load failed', errorCode: 7 } });
  await tick();
  assert(app.lastWebviewError()?.errorCode === 7, 'error payload delivered');

  console.log('\n✅ Built-in primitives directive assertions passed (wire protocol only — see the module doc for what this cannot prove).\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Built-in primitives directive verification failed:\n', err);
  process.exit(1);
});
