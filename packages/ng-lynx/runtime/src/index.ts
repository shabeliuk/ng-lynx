/**
 * ng-lynx
 *
 * Angular custom renderer for building Lynx apps. Public Background-Thread API.
 *
 * Usage:
 * ```ts
 * import { bootstrapLynxApplication } from 'ng-lynx';
 * import { AppComponent } from './app.component';
 *
 * bootstrapLynxApplication(AppComponent);
 * ```
 *
 * You write ordinary standalone Angular components with signals. Use Lynx
 * element tags (`view`, `text`, `image`, `scroll-view`, …) in templates and the
 * renderer translates everything into Lynx element-PAPI operations under the
 * hood.
 */

export {
  bootstrapLynxApplication,
  provideLynx,
  type BootstrapLynxOptions,
} from './bootstrap.js';

export { LynxRendererFactory2 } from './renderer.js';

/**
 * Standalone directive for two-way binding on Lynx `<input>` / `<textarea>` via
 * `[(lynxModel)]`. Import it into your component's `imports`. No `@angular/forms`
 * dependency.
 *
 * @public
 */
export { LynxModel } from './forms.js';

/**
 * Standalone directive that binds native events to main-thread worklets via
 * `[lynxMainThread]="{ tap: workletRef }"` (a `defineWorklet` handle) or
 * `{ tap: 'workletId' }` (a string id). Worklets are registered on the Main
 * Thread with `defineWorklet` / `registerWorklet` from `ng-lynx/worklet`.
 *
 * @public
 */
export {
  LynxMainThread,
  LynxMainThreadRef,
  type MainThreadEvents,
  type WorkletHandle,
  type WorkletRef,
} from './worklet.js';

/**
 * Calls between the threads: `runOnMainThread` calls a function from
 * `defineMainThreadFunction`, `backgroundFunction` exposes one to the Main Thread's
 * `runOnBackground`, and `mainThreadRef` gives each component instance its own ref.
 * `bindWorklet` hands them to a worklet as `ctx.params`. See docs/11-worklets.md.
 *
 * @public
 */
export { backgroundFunction, mainThreadRef, runOnMainThread } from './thread-calls.js';
export {
  bindWorklet,
  type BackgroundFunctionHandle,
  type BoundWorklet,
  type MainThreadFunctionHandle,
  type MainThreadRefHandle,
  type ToMainThread,
} from 'ng-lynx/internal/ops';

/**
 * Standalone directive that registers native gesture detectors via
 * `[lynxGesture]="{ pan: { type: 'pan', callbacks: { onStart, onUpdate, onEnd } } }"`.
 * Callbacks are worklets, exactly like `[lynxMainThread]`. On-device only —
 * `@lynx-js/web-core` doesn't implement the underlying native PAPI. See
 * docs/32-gestures.md.
 *
 * @public
 */
export {
  GESTURE_TYPE,
  LynxGesture,
  type LynxGestureDescriptor,
  type LynxGestures,
  type LynxGestureType,
} from './gesture.js';


/**
 * Host data as signals: `lynxInitData()` (the data the native host loaded the
 * card with, live-updated on host `updateData` pushes) and `lynxGlobalProps()`
 * (`lynx.__globalProps`, live-updated on host global-prop pushes). Zoneless
 * change detection picks the updates up automatically.
 *
 * @public
 */
export { lynxInitData, lynxGlobalProps, type HostData } from './host-data.js';


/**
 * App-level events as injectables: `LynxGlobalEvents` (the GlobalEventEmitter
 * as a service — `listen` / `latest` signal / `emit`) and `lynxForeground()`
 * (host foreground/background lifecycle as a signal).
 *
 * @public
 */
export { LynxGlobalEvents, lynxForeground } from './app-events.js';


/**
 * Visibility detection: `LynxIntersectionObserver` (a DI-friendly wrapper over
 * Lynx's native observer API). Angular's `@defer (on viewport)` works out of
 * the box — the runtime installs a `globalThis.IntersectionObserver` polyfill
 * over the same Lynx API at bundle start.
 *
 * @public
 */
export {
  LynxIntersectionObserver,
  type LynxVisibilityEntry,
  type LynxVisibilityOptions,
} from './visibility.js';

/**
 * `LynxExposure` — app-wide `resumeExposure()`/`stopExposure()` toggle for
 * Lynx's exposure-detection system (the same one driving the per-element
 * `uiappear`/`uidisappear` events and the global `exposure` event). Distinct
 * from {@link LynxIntersectionObserver}, a separate imperative observer API.
 *
 * @public
 */
export { LynxExposure, type LynxObserverFrameRateOptions } from './visibility.js';


/**
 * Dev op-stream logging: `enableLynxOpLogging()` prints each flush's decoded
 * ops (the renderer's "Elements panel" on a platform with no DOM inspector);
 * `disableLynxOpLogging()` stops it. Pass a `sink` to capture lines instead of
 * printing. See docs/26-debugging.md.
 *
 * @public
 */
export {
  enableLynxOpLogging,
  disableLynxOpLogging,
  type OpLogSink,
} from './op-logger.js';


/**
 * Typed, mockable access to host-registered native modules:
 * `injectNativeModule<T>(name)` / `injectNativeBridge()`, with
 * `provideLynxNativeModules(...)` to substitute fakes (tests) or a custom
 * registry. See docs/27-native-modules.md.
 *
 * @public
 */
export {
  injectNativeModule,
  injectNativeBridge,
  provideLynxNativeModules,
  LYNX_NATIVE_MODULES,
  type LynxNativeModules,
  type LynxNativeBridge,
} from './native-modules.js';

/**
 * Performance API: `LynxPerformance` (a DI wrapper over `lynx.performance`) —
 * observe pipeline/metric entries (FCP, TTI, per-update render pipelines) and
 * drive Lynx DevTool tracing. Name a pipeline with a `__lynx_timing_flag`
 * attribute. See docs/25-performance.md.
 *
 * @public
 */
export {
  LynxPerformance,
  type LynxPerformanceEntry,
  type LynxPerformanceMetric,
  type LynxPipelineEntry,
  type LynxTraceOption,
} from './performance.js';

/**
 * Resolves once all pending render ops have been applied on the Main Thread.
 * Use this when you need to read back the materialised native tree (for example
 * before issuing a selector query in `afterNextRender`).
 *
 * @public
 */
export { whenFlushed } from './flush.js';


/**
 * The Background-Thread element handle. `ElementRef.nativeElement` is one of
 * these, so a template ref / `viewChild` gives you imperative access to Lynx's
 * selector-query methods (`fields`, `invoke`, `setNativeProps`, `path`). Use
 * {@link asLynxElement} to cast an `ElementRef.nativeElement` with types.
 *
 * @public
 */
export { ShadowElement } from './shadow-element.js';

/**
 * `lynxSelectAll(selector)` — a tree-wide multi-element query (Lynx's native
 * `selectorQuery.selectAll`). Batch-measure or batch-update every element
 * matching a CSS selector in one round-trip, e.g.
 * `lynxSelectAll('.item').fields({ size: true }, rects => …)`. The
 * multi-element counterpart to `ShadowElement`'s single-element queries. See
 * docs/10-element-queries.md.
 *
 * @public
 */
export {
  lynxSelectAll,
  lynxSelectRoot,
  lynxSelectUniqueID,
  type LynxNodesQuery,
  type LynxNodesQueryAll,
} from './shadow-element.js';

/**
 * `lynxRequestAnimationFrame` / `lynxCancelAnimationFrame` — a portable frame
 * scheduler: the native `requestAnimationFrame` when present, else a ~60fps
 * `setTimeout` fallback (the web-preview's Background Worker has no rAF).
 * Most apps won't need this — signals/zoneless CD and `lynxAnimate` cover the
 * common cases. See docs/33-animations.md.
 *
 * @public
 */
export { lynxRequestAnimationFrame, lynxCancelAnimationFrame } from './animation-frame.js';

/**
 * Typed access to the host's `SystemInfo` (platform, screen metrics, pixel
 * ratio) — `injectSystemInfo()`, backed by `LYNX_SYSTEM_INFO` (override in
 * tests with a plain provider). See docs/29-platform-apis.md.
 *
 * @public
 */
export { injectSystemInfo, LYNX_SYSTEM_INFO, type LynxSystemInfo } from './system-info.js';

/**
 * `LynxErrorHandler` forwards uncaught Angular errors to `lynx.reportError()`
 * (native crash reporting / DevTool) in addition to the default
 * `console.error` — installed by `provideLynx()`. See docs/29-platform-apis.md.
 *
 * @public
 */
export { LynxErrorHandler } from './error-handler.js';

/**
 * `LynxSessionStorage` — cross-LynxView shared storage (`get`/`set`/
 * `subscribe`), distinct from `initData`/`globalProps` (per-card load-time
 * data). See docs/29-platform-apis.md.
 *
 * @public
 */
export { LynxSessionStorage } from './session-storage.js';

/**
 * `LynxVirtualFor` — a windowed alternative to `@for` for huge lists inside
 * `<list>`: only materializes embedded views (and their Main-Thread
 * elements) for a `[start, end)` window, shifted via
 * `updateVisibleRange(start, end)` fed from the list's own `(scroll)` event.
 * See docs/30-virtual-list.md for why this is windowed rather than truly
 * lazy (the trick ReactLynx's own list virtualization uses needs Main-Thread
 * Script, which Angular can't run).
 *
 * @public
 */
export { LynxVirtualFor, LynxVirtualForContext } from './virtual-for.js';

/**
 * `hotSwapComponent(type, next)` — state-preserving component hot-swap:
 * rebuild every live view of `type` with `next`'s template **in place**,
 * keeping component instances (signals, fields, injected services). The
 * runtime half of full HMR, built on Angular's own `ɵɵreplaceMetadata`
 * primitive (the same one Angular CLI's dev-server HMR uses). Template-level
 * changes only — see docs/31-hot-swap.md.
 *
 * @public
 */
export { hotSwapComponent } from './hot-swap.js';

/**
 * `LynxObject` — the remaining `lynx.*` global methods: `getElementById`
 * (+ the returned handle's `animate()`), `getTextInfo`, `addFont`,
 * `requestResourcePrefetch`/`cancelResourcePrefetch`, `registerModule`/
 * `getJSModule`, `accessibilityAnnounce`, and `beforePublishEvent`. See
 * docs/29-platform-apis.md.
 *
 * @public
 */
export {
  LynxObject,
  type LynxAnimation,
  type LynxAnimationKeyframe,
  type LynxAnimationKeyframes,
  type LynxAnimationOptions,
  type LynxNodeRef,
  type LynxTextInfo,
  type LynxTextMetrics,
  type LynxFontFace,
  type LynxPrefetchResourceItem,
  type LynxPrefetchRequest,
  type LynxPrefetchResourceStatus,
  type LynxPrefetchResult,
  type LynxPrefetchConfig,
} from './lynx-object.js';




import type {
  LynxElementHandle,
  LynxUIMethodElement,
  ShadowElement as _ShadowElement,
} from './shadow-element.js';

export type { LynxElementHandle, LynxInvokeOptions, LynxUIMethodElement } from './shadow-element.js';

/**
 * Type-safe accessor for the Lynx element behind an `ElementRef`.
 *
 * @example
 * ```ts
 * const box = viewChild.required<ElementRef>('box');
 * asLynxElement(box().nativeElement).fields({ size: true }, (r) => { ... });
 * ```
 * @public
 */
export function asLynxElement(nativeElement: unknown): _ShadowElement;
/**
 * With an element type, `invoke()` is typed: only that element's methods, each
 * with its own `params` and result.
 *
 * ```ts
 * asLynxElement<'video'>(this.video().nativeElement).invoke({ method: 'seek', params: { position: 5 } });
 * asLynxElement<'scroll-view'>(this.scroller().nativeElement).invoke({
 *   method: 'scrollTo',
 *   params: { offset: 120, smooth: true },
 * });
 * ```
 * @public
 */
export function asLynxElement<Tag extends LynxUIMethodElement>(nativeElement: unknown): LynxElementHandle<Tag>;
export function asLynxElement(nativeElement: unknown): unknown {
  return nativeElement;
}

export { loadDynamicComponent } from './dynamic-component.js';

/**
 * Shared-runtime registry for dynamic components — the mechanism that lets a
 * separately-built dynamic-component bundle use the **host's** Angular
 * instance instead of bundling its own (which provably cannot work, even at
 * an identical version). Wired automatically by
 * `pluginAngularLynx({ dynamicComponentHost: true })` /
 * `({ dynamicComponent: true })`; exported for hosts that wire it by hand
 * and for tests. See docs/38-dynamic-component.md.
 */
export {
  DEFAULT_SHARED_MODULES,
  hasSharedModule,
  publishSharedModule,
  readSharedModule,
  sharedModuleExpression,
  sharedModuleKey,
} from './shared-runtime.js';

/**
 * Resolve an app-relative asset path to an absolute URL. Lynx has no document
 * and no base URL, so a relative `fetch`/`src` that works in the web preview
 * is rejected outright by a real engine — see docs/22-http.md.
 */
export { bundlePublicPath, lynxAssetUrl } from './asset-url.js';
