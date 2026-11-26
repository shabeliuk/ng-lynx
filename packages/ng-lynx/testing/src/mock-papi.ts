/**
 * Mock of the Lynx element PAPI for headless testing (Node — no device, no
 * browser). This is the same environment ng-lynx's own verification
 * harnesses run on, packaged for users.
 *
 * Each PAPI global builds an in-memory "native" tree (`MockEl`) so a test can
 * read back what the Main-Thread executor produced. `installMockPapi()` also
 * wires `lynx.getNativeApp().callLepusMethod` to forward ops straight into
 * the Main-Thread patch handler that `ng-lynx/main-thread` installs.
 *
 * Most tests should use the higher-level `renderLynxComponent()` from
 * `ng-lynx/testing` instead of calling these directly.
 */
import { resolveInterned } from 'ng-lynx/internal/ops';
import { clearWorklets, installWorkletRuntime } from 'ng-lynx/internal/worklet-runtime';

export interface MockEl {
  uid: number;
  type: string;
  text?: string;
  classes?: string;
  style?: unknown;
  attrs: Record<string, unknown>;
  /** What `__AddDataset` stored: `event.target.dataset` on a real engine. */
  dataset?: Record<string, unknown>;
  /** The `nodeIndex` the element was created with (`templateSourceMap`), for Lynx DevTool. */
  nodeIndex?: number;
  // sign is a string for BG handlers, a function for main-thread worklet handlers.
  events: Record<string, { type: string; sign: string | ((e: unknown) => unknown) }>;
  children: MockEl[];
  parent?: MockEl;
  /** For <list>: native item callbacks + synthetic list id. */
  listCbs?: {
    componentAtIndex: (list: MockEl, listID: number, cellIndex: number, op: number) => number | undefined;
    enqueueComponent?: (list: MockEl, listID: number, sign: number) => void;
  };
  listId?: number;
  /** For <list>: every `update-list-info` not yet applied by {@link virtualizingList}, oldest first. */
  listUpdates?: unknown[];
  /** Native gesture detectors registered via `__SetGestureDetector` (gesture id → detector). */
  gestures?: Record<number, { type: number; config: { callbacks: { name: string; callback: unknown }[] }; relationMap: unknown }>;
}

let uidCounter = 1;
/** Every element by uid: a list's `componentAtIndex` answers with a uid. */
const elementsByUid = new Map<number, MockEl>();

function mk(type: string, info?: { nodeIndex?: unknown }): MockEl {
  const el: MockEl = { uid: uidCounter++, type, attrs: {}, events: {}, children: [] };
  if (typeof info?.nodeIndex === 'number') el.nodeIndex = info.nodeIndex;
  elementsByUid.set(el.uid, el);
  return el;
}

const g = globalThis as Record<string, any>;

// Mock GlobalEventEmitter (window/document/body events). The harness drives it
// with `emitGlobalEvent(name, …)`.
const globalListeners = new Map<string, Set<(...args: unknown[]) => void>>();
const globalEmitter = {
  addListener(name: string, listener: (...args: unknown[]) => void): void {
    let set = globalListeners.get(name);
    if (!set) globalListeners.set(name, (set = new Set()));
    set.add(listener);
  },
  removeListener(name: string, listener: (...args: unknown[]) => void): void {
    globalListeners.get(name)?.delete(listener);
  },
  // The real JSModule emitter also exposes `emit(name, paramsArray)`, calling
  // each listener with the array spread as arguments — confirmed against
  // @lynx-js/react's updateCardData (`emit('onDataChanged', [restNewData])`)
  // paired with its own listener (`(...args) => { const [newData] = args; … }`).
  // host-data.ts emits parity events through this.
  emit(name: string, params?: unknown[]): void {
    const args = Array.isArray(params) ? params : params === undefined ? [] : [params];
    for (const l of [...(globalListeners.get(name) ?? [])]) l(...args);
  },
};

/** Simulate native (or other BG code) emitting an app-level global event. */
export function emitGlobalEvent(name: string, ...args: unknown[]): void {
  for (const l of [...(globalListeners.get(name) ?? [])]) l(...args);
}

// Every flushed ops batch, in order, since the last installMockPapi().
const opsLog: unknown[][] = [];

// IntersectionObserver mock registry: selector → observe callback.
const ioObserved = new Map<string, (result: unknown) => void>();

// Performance mock registry: entry type → observe callback; trace log.
const perfObserved = new Map<string, (entry: unknown) => void>();
const perfTrace: string[] = [];
let perfFlowCounter = 0;

/** Simulate the engine delivering a performance entry to observers of `entryType`. */
export function firePerformanceEntry(entryType: string, entry: Record<string, unknown>): void {
  perfObserved.get(entryType)?.({ entryType, ...entry });
}

/** Entry types currently under a performance observer. */
export function performanceObservedTypes(): string[] {
  return [...perfObserved.keys()];
}

/** The recorded tracing calls (`start:name` / `end` / `mark:name`). */
export function performanceTrace(): string[] {
  return perfTrace;
}

/**
 * Simulate the native intersection observer firing for an observed selector
 * (e.g. an element scrolling into view). `selector` is the element's
 * `[ng-ref-{id}]` selector; pass `isIntersecting` and optionally a ratio.
 */
export function fireIntersection(
  selector: string,
  isIntersecting: boolean,
  intersectionRatio = isIntersecting ? 1 : 0,
): void {
  ioObserved.get(selector)?.({
    isIntersecting,
    intersectionRatio,
    boundingClientRect: { top: 0, right: 0, bottom: 0, left: 0 },
    time: 0,
  });
}

/** All selectors currently under an intersection observer. */
export function observedSelectors(): string[] {
  return [...ioObserved.keys()];
}

// Session storage mock: shared in-memory map + per-key subscriber sets, so a
// harness can assert cross-"LynxView" behavior without a real device.
const sessionStorageData = new Map<string, unknown>();
const sessionStorageListeners = new Map<string, Set<(data: unknown) => void>>();

// `lynx.reportError()` call log — `{ error, options }` per call.
const reportedErrorsLog: { error: unknown; options?: { level?: string } }[] = [];

/** Errors forwarded to `lynx.reportError()` since the last `installMockPapi()`. */
export function reportedErrors(): { error: unknown; options?: { level?: string } }[] {
  return reportedErrorsLog;
}

// `lynx.resumeExposure()` / `stopExposure()` call log, in call order.
const exposureCallsLog: ('resume' | 'stop')[] = [];

/** `resumeExposure`/`stopExposure` calls since the last `installMockPapi()`. */
export function exposureCalls(): ('resume' | 'stop')[] {
  return exposureCallsLog;
}

// `lynx.registerModule()` registry — `getJSModule()` reads from this first.
const registeredModules = new Map<string, unknown>();

// Dynamic-component mock registry — schema/source → exports "the native host
// has already fetched and cached" (see runtime/src/dynamic-component.ts).
// `QueryComponent` mirrors the real `{code: 0, detail: {schema}}` success
// shape confirmed against lynx-family/lynx's own `lynx.ts`/`appManager.ts`
// for anything registered, or the failure iOS Explorer 4.2 sends for anything not.
const dynamicComponentExports = new Map<string, unknown>();

/**
 * Simulate the native host having already fetched and cached a
 * dynamic-component bundle, ready for `loadDynamicComponent(schema)` to
 * resolve. `exports` is whatever that bundle's module exports would be — for
 * an ng-lynx dynamic component, `{ default: SomeComponentType }`.
 */
export function registerDynamicComponent(schema: string, exports: unknown): void {
  dynamicComponentExports.set(schema, exports);
}

// `element.animate()` call log (from a `getElementById()` handle).
const animateCallsLog: { id: string; keyframes: unknown; options: unknown }[] = [];

/** `.animate()` calls made on any `getElementById()` handle. */
export function animateCalls(): { id: string; keyframes: unknown; options: unknown }[] {
  return animateCallsLog;
}

// `lynx.accessibilityAnnounce()` call log.
const announcedMessagesLog: string[] = [];

/** Content strings passed to `accessibilityAnnounce()`. */
export function announcedMessages(): string[] {
  return announcedMessagesLog;
}

// `lynx.addFont()` call log.
const addedFontsLog: { 'font-family': string; src: string }[] = [];

/** Font faces passed to `addFont()`. */
export function addedFonts(): { 'font-family': string; src: string }[] {
  return addedFontsLog;
}

// `lynx.requestResourcePrefetch()` / `cancelResourcePrefetch()` call log.
const prefetchCallsLog: { action: 'request' | 'cancel'; data: unknown }[] = [];

/** Prefetch/cancel calls, in call order. */
export function prefetchCalls(): { action: 'request' | 'cancel'; data: unknown }[] {
  return prefetchCallsLog;
}

// `lynx.beforePublishEvent` handler registry: event name → handlers.
const beforePublishHandlers = new Map<string, Set<(...args: unknown[]) => void>>();

/** Simulate the engine firing a `beforePublishEvent`-intercepted event. */
export function fireBeforePublishEvent(eventName: string, ...args: unknown[]): void {
  for (const h of [...(beforePublishHandlers.get(eventName) ?? [])]) h(...args);
}

/**
 * Mock of `LynxCrossThreadContext` (`@lynx-js/web-core`'s real cross-thread
 * event channel — `getJSContext()`/`getCoreContext()`). Real `dispatchEvent`
 * RPCs to the *other* thread, asynchronously; this mock delivers via a
 * microtask, which is enough to model the asynchrony without a real RPC.
 * Since this harness shares one process, one registry covers both directions:
 * each direction uses its own event names.
 */
const crossThreadListeners = new Map<string, Set<(event: { type: string; data: unknown }) => void>>();
const crossThreadContext = {
  addEventListener(type: string, listener: (event: { type: string; data: unknown }) => void): void {
    let set = crossThreadListeners.get(type);
    if (!set) crossThreadListeners.set(type, (set = new Set()));
    set.add(listener);
  },
  dispatchEvent(event: { type: string; data?: unknown }): void {
    queueMicrotask(() => {
      for (const l of [...(crossThreadListeners.get(event.type) ?? [])]) {
        l({ type: event.type, data: event.data ?? {} });
      }
    });
  },
};

export function installMockPapi(): void {
  // What `pluginAngularLynx` defines at build time. A harness bundle replaces
  // the identifiers; a plain Vitest or Jest run reads these globals instead.
  // `ngDevMode` too: a shipped bundle never runs Angular's dev mode, whose image
  // performance check needs a real document.
  const defines = globalThis as Record<string, unknown>;
  defines['ngDevMode'] = false;
  defines['__DEV__'] ??= false;
  defines['__ENABLE_SELECTOR_QUERIES__'] ??= 'lazy';
  defines['__HAS_FIRST_SCREEN__'] ??= false;
  // The mock installs the worklet runtime below, so `<lynx-slider>` drags on
  // the Main Thread, as in a build with `mainThreadModules`.
  defines['__WORKLET_RUNTIME__'] ??= true;
  globalListeners.clear();
  // Deliberately NOT cleared here (unlike globalListeners/ioObserved/etc.
  // below). `entry-background.ts`'s cross-thread listeners (the
  // RUN_ON_BACKGROUND_EVENT / FIRST_SCREEN_RESOLVED_EVENT bridges) register
  // exactly once, at that module's top-level — the same as a real BG script
  // only ever runs its top-level code once per real boot. A harness that
  // simulates several sequential "boots" in one process (multiple
  // `setupLynxTestEnvironment()` calls) still only imports that module once,
  // so clearing this map on a later install would permanently orphan a
  // registration nothing re-creates — a mock-only gap a real second boot
  // (a fresh JS context, re-running that top-level code) wouldn't have.
  ioObserved.clear();
  perfObserved.clear();
  perfTrace.length = 0;
  perfFlowCounter = 0;
  sessionStorageData.clear();
  sessionStorageListeners.clear();
  reportedErrorsLog.length = 0;
  exposureCallsLog.length = 0;
  registeredModules.clear();
  dynamicComponentExports.clear();
  opsLog.length = 0;
  animateCallsLog.length = 0;
  announcedMessagesLog.length = 0;
  addedFontsLog.length = 0;
  prefetchCallsLog.length = 0;
  beforePublishHandlers.clear();
  g.__FIRST_OPS_STRING__ = undefined;
  g.__LAST_EPOCH__ = undefined;
  // Bare global `SystemInfo` — confirmed set this way (not under `lynx`) by
  // `@lynx-js/web-core`'s Background-Thread worker bootstrap; a fake but
  // shaped-correctly device profile so a harness can assert real fields.
  g.SystemInfo = {
    engineVersion: '3.2',
    lynxSdkVersion: '3.2',
    osVersion: '0.0',
    pixelHeight: 2400,
    pixelWidth: 1080,
    pixelRatio: 3,
    platform: 'headless',
    runtimeType: 'quickjs',
  };
  g.lynx = {
    SystemInfo: g.SystemInfo,
    getJSContext: () => crossThreadContext,
    getCoreContext: () => crossThreadContext,
    // Mock of `lynx.QueryComponent` (`loadDynamicComponent`, dynamic-component.ts).
    // Mirrors the real success shape confirmed against lynx-family/lynx's own
    // `js_libraries/lynx-core/src/lynx/lynx.ts` — `{ code: 0, data: {...},
    // detail: { schema } }` — for a `source` a harness has registered via
    // `registerDynamicComponent(schema, exports)`; otherwise the failure iOS
    // Explorer 4.2 sends for a dropped connection (code 160101, `error_msg`),
    // since nothing here has fetched it.
    QueryComponent: (
      source: string,
      callback: (result: {
        code: number;
        data?: { url: string; sync?: boolean; error_msg?: string; error_message?: string; mode?: string };
        detail?: { schema: string; cache?: boolean; errMsg?: string };
      }) => void,
    ) => {
      if (dynamicComponentExports.has(source)) {
        callback({
          code: 0,
          data: { url: source, sync: true, error_message: '', mode: 'cache' },
          detail: { schema: source, cache: false, errMsg: '' },
        });
      } else {
        const message = 'Load lazy bundle failed, the error message is: not registered.';
        callback({
          code: 160101,
          data: { url: source, sync: false, error_msg: message, mode: 'normal' },
          detail: { schema: source, cache: false, errMsg: message },
        });
      }
    },
    getNativeApp: () => ({
      callLepusMethod: (method: string, params: unknown, cb?: () => void) => {
        if (method === 'ngPatchUpdate') {
          const { data, epoch } = params as { data: string; epoch?: string };
          // Normalize a possibly string-table-compressed batch (see
          // internal/src/ops.ts) so every harness reading getLastOps() keeps
          // seeing plain, semantic ops regardless of the wire encoding.
          g.__LAST_OPS__ = resolveInterned(JSON.parse(data));
          g.__LAST_EPOCH__ = epoch;
          // Work triggered outside an active change-detection walk (e.g. an
          // imperative ViewContainerRef mutation called directly from test
          // code, not from a signal write) can legitimately split across two
          // flushes: one for the bare CREATE/INSERT (synchronous, at the
          // point of creation) and a second, separately-scheduled one once
          // Angular's own zoneless scheduler runs the new view's first CD
          // pass and evaluates its bindings. `opsLog` accumulates every
          // batch so a harness can inspect the union instead of just the
          // most recent one.
          opsLog.push(g.__LAST_OPS__);
          // The exact serialized string of the FIRST batch — what a
          // first-screen snapshot must be, byte-for-byte (the Main Thread
          // hydrates by string equality; see main-thread/src/first-screen.ts).
          if (g.__FIRST_OPS_STRING__ === undefined) g.__FIRST_OPS_STRING__ = data;
        }
        g[method](params);
        cb?.();
      },
    }),
    getJSModule: (name: string) =>
      registeredModules.has(name)
        ? registeredModules.get(name)
        : name === 'GlobalEventEmitter'
          ? globalEmitter
          : undefined,
    registerModule: (name: string, module: unknown) => {
      registeredModules.set(name, module);
    },
    // Minimal selector-query mock: records the last query and feeds canned data.
    // `select` targets one element; `selectAll` targets many — a class selector
    // (`.foo`) is resolved against the mock tree via findAllByClass so a harness
    // can assert the match count, and `fields` then yields one result per match.
    createSelectorQuery: () => {
      // Count matches for a `.class` selectAll against the current mock page.
      const matchCount = (sel: string): number => {
        const page = g.__MOCK_PAGE__ as MockEl | undefined;
        if (!page || !sel.startsWith('.')) return 0;
        return findAllByClass(page, sel.slice(1)).length;
      };
      const q: any = {
        _sel: '',
        _all: false,
        _run: () => {},
        select(sel: string) {
          q._sel = sel;
          q._all = false;
          return q;
        },
        selectAll(sel: string) {
          q._sel = sel;
          q._all = true;
          return q;
        },
        fields(fields: Record<string, boolean>, cb: (r: unknown) => void) {
          g.__LAST_QUERY__ = { selector: q._sel, fields, all: q._all };
          if (q._all) {
            const n = matchCount(q._sel);
            const results = Array.from({ length: n }, (_, i) => ({
              width: 100,
              height: 50,
              top: i * 50,
              left: 0,
            }));
            q._run = () => cb(results);
          } else {
            q._run = () => cb({ width: 100, height: 50, top: 0, left: 0 });
          }
          return q;
        },
        invoke(opts: {
          method: string;
          params?: Record<string, unknown>;
          success?: (r: unknown) => void;
          fail?: (e: unknown) => void;
        }) {
          g.__LAST_QUERY__ = { selector: q._sel, method: opts.method, params: opts.params, all: q._all };
          // Every invoke, in order — for harnesses asserting on UI-method calls
          // (e.g. `setValue` on inputs, which native elements need; see
          // runtime/src/input-value.ts).
          ((g.__INVOKE_LOG__ ??= []) as unknown[]).push({ selector: q._sel, method: opts.method, params: opts.params });
          // `__INVOKE_FAIL_NEXT__ = n` fails the next n invokes the way Android
          // does when the element isn't found yet (code 2), for harnesses
          // exercising a retry.
          const failNext = (g.__INVOKE_FAIL_NEXT__ as number | undefined) ?? 0;
          if (failNext > 0) {
            g.__INVOKE_FAIL_NEXT__ = failNext - 1;
            q._run = () => opts.fail?.({ code: 2, data: `no node found for selector '${q._sel}'` });
            return q;
          }
          // `boundingClientRect` returns a real rect, matching what the native
          // engine actually sends back. It's the only way to measure an element
          // on a real device — `fields({ size: true })` resolves the selector
          // but drops `size`/`rect` on iOS — so a mock that answered `{ok:true}`
          // here (as this one used to) let a measurement bug pass verification.
          // `left` defaults to 0 but is overridable via `__QUERY_RECT_LEFT__`, so
          // a harness can exercise a track that isn't flush against the page
          // origin (see slider.ts's page-absolute-minus-measured-left math).
          const left = (g.__QUERY_RECT_LEFT__ as number | undefined) ?? 0;
          q._run = () =>
            opts.success?.(
              opts.method === 'boundingClientRect'
                ? { left, top: 0, right: left + 100, bottom: 50, width: 100, height: 50 }
                : { ok: true },
            );
          return q;
        },
        setNativeProps(props: Record<string, unknown>) {
          g.__LAST_QUERY__ = { selector: q._sel, props, all: q._all };
          q._run = () => {};
          return q;
        },
        path(cb: (r: unknown[] | null) => void) {
          g.__LAST_QUERY__ = { selector: q._sel, path: true };
          // Canned root-path: one synthetic ancestor entry per real call —
          // enough for a harness to assert `.path()` reached the real PAPI at
          // all, not what a specific real device tree would report.
          q._run = () => cb([{ id: q._sel }, { id: '[page-root]' }]);
          return q;
        },
        exec() {
          // Deliver results **asynchronously**, like the real engine.
          // A selector query is a Background->Main Thread round-trip; it can
          // never call back within `exec()`. This mock used to run `_run()`
          // synchronously, and that single inaccuracy hid a real bug: the
          // slider looked like it had geometry on its very first touch here,
          // while on-device the first tap was silently swallowed because the
          // measurement hadn't come back yet.
          // `__QUERY_DELAY_MS__` stretches that round-trip, so a harness can
          // exercise what happens to input that arrives *while a query is
          // still outstanding* — the window the bug above lived in.
          const run = q._run;
          q._run = () => {};
          const delay = g.__QUERY_DELAY_MS__;
          if (typeof delay === 'number' && delay > 0) setTimeout(run, delay);
          else Promise.resolve().then(run);
        },
      };
      return q;
    },
    // Mock of `lynx.performance`. `createObserver` records the observed entry
    // types + callback in `g.__PERF_OBSERVED__` so a harness can fire an entry
    // via `firePerformanceEntry(type, entry)`; tracing calls are counted.
    performance: {
      createObserver: (callback: (entry: unknown) => void) => {
        const observer: any = {
          _types: [] as string[],
          observe(types: string[]) {
            observer._types = types;
            for (const t of types) perfObserved.set(t, callback);
          },
          disconnect() {
            for (const t of observer._types) perfObserved.delete(t);
            observer._types = [];
          },
        };
        return observer;
      },
      profileStart: (name: string) => perfTrace.push(`start:${name}`),
      profileEnd: () => perfTrace.push('end'),
      profileMark: (name: string) => perfTrace.push(`mark:${name}`),
      profileFlowId: () => ++perfFlowCounter,
      isProfileRecording: () => true,
    },
    // Mock of `lynx.createIntersectionObserver`. Records observed selectors +
    // their callbacks in `g.__IO_OBSERVED__` so a harness can simulate an
    // element scrolling into/out of view via `fireIntersection(selector, …)`.
    // Mirrors the real chained API: create → relativeToViewport/relativeTo →
    // observe(selector, cb) → disconnect().
    createIntersectionObserver: (_component: unknown, _options?: unknown) => {
      const registered: { selector: string; cb: (r: unknown) => void }[] = [];
      const observer: any = {
        relativeTo(selector: string) {
          g.__IO_RELATIVE_TO__ = selector;
          return observer;
        },
        relativeToViewport: () => observer,
        relativeToScreen: () => observer,
        observe(selector: string, cb: (r: unknown) => void) {
          const entry = { selector, cb };
          registered.push(entry);
          ioObserved.set(selector, cb);
        },
        disconnect() {
          for (const { selector } of registered) ioObserved.delete(selector);
          registered.length = 0;
        },
      };
      return observer;
    },
    reportError: (error: unknown, options?: { level?: string }) => {
      reportedErrorsLog.push({ error, options });
    },
    resumeExposure: () => {
      exposureCallsLog.push('resume');
    },
    stopExposure: () => {
      exposureCallsLog.push('stop');
    },
    // Session storage mock: a shared map + per-key subscriber sets (module
    // scope, not reset per query) so writes notify every subscriber, mirroring
    // the real cross-LynxView behavior.
    getSessionStorageItem: (key: string, callback: (data: unknown) => void) => {
      callback(sessionStorageData.get(key));
    },
    setSessionStorageItem: (key: string, value: unknown) => {
      sessionStorageData.set(key, value);
      for (const cb of [...(sessionStorageListeners.get(key) ?? [])]) cb(value);
    },
    subscribeSessionStorage: (key: string, callback: (data: unknown) => void) => {
      let set = sessionStorageListeners.get(key);
      if (!set) sessionStorageListeners.set(key, (set = new Set()));
      set.add(callback);
    },
    unsubscribeSessionStorage: (key: string, callback: (data: unknown) => void) => {
      sessionStorageListeners.get(key)?.delete(callback);
    },
    // `getElementById` searches the mock tree by `attrs.id`; the returned
    // handle's `.animate()` records the call and returns a fake Animation
    // whose cancel/pause/play are spies (no real timing simulated).
    getElementById: (id: string) => {
      function search(el: MockEl): MockEl | undefined {
        if (el.attrs['id'] === id) return el;
        for (const c of el.children) {
          const found = search(c);
          if (found) return found;
        }
        return undefined;
      }
      const target = g.__MOCK_PAGE__ ? search(g.__MOCK_PAGE__) : undefined;
      if (!target) return null;
      return {
        animate: (keyframes: unknown, options: unknown) => {
          animateCallsLog.push({ id, keyframes, options });
          return { cancel: () => {}, pause: () => {}, play: () => {} };
        },
      };
    },
    getTextInfo: (text: string, info: { fontSize: string; maxWidth?: string; maxLine?: number }) => {
      // Canned metrics: proportional "width" so a harness can sanity-check a
      // real call happened, not a faithful text-layout engine.
      const width = text.length * 8;
      const singleLineFits = !info.maxWidth || width <= parseInt(info.maxWidth, 10);
      return {
        width: singleLineFits ? width : parseInt(info.maxWidth ?? '0', 10),
        content: info.maxLine === 1 ? undefined : [text],
      };
    },
    addFont: (fontFace: { 'font-family': string; src: string }, callback?: () => void) => {
      addedFontsLog.push(fontFace);
      callback?.();
    },
    requestResourcePrefetch: (data: unknown, callback: (res: unknown) => void) => {
      prefetchCallsLog.push({ action: 'request', data });
      callback({ code: 0, msg: 'success', details: [] });
    },
    cancelResourcePrefetch: (data: unknown, callback: (res: unknown) => void) => {
      prefetchCallsLog.push({ action: 'cancel', data });
      callback({ code: 0, msg: 'success', details: [] });
    },
    accessibilityAnnounce: (options: { content: string }) => {
      announcedMessagesLog.push(options.content);
    },
    beforePublishEvent: {
      add: (eventName: string, handler: (...args: unknown[]) => void) => {
        let set = beforePublishHandlers.get(eventName);
        if (!set) beforePublishHandlers.set(eventName, (set = new Set()));
        set.add(handler);
      },
      remove: (eventName: string, handler: (...args: unknown[]) => void) => {
        beforePublishHandlers.get(eventName)?.delete(handler);
      },
    },
  };

  // `lynxCoreInject` is injected by the runtime wrapper as a bare identifier,
  // not a `globalThis` property, in a real build (see entry-background.ts /
  // dynamic-component.ts) — but reading an undeclared bare identifier falls
  // back to `globalThis`'s own property of the same name, so setting it here
  // is enough to make `typeof lynxCoreInject !== 'undefined'` checks resolve
  // correctly in this harness environment.
  g.lynxCoreInject = {
    tt: {
      // Mock of `getDynamicComponentExports` (dynamic-component.ts) — reads
      // back whatever `registerDynamicComponent(schema, exports)` set,
      // mirroring the real `lynx-core`'s `app.ts`:
      // `getDynamicComponentExports(url) { return this.dynamicComponentExports[url]; }`.
      getDynamicComponentExports: (schema: string) => dynamicComponentExports.get(schema),
    },
  };

  g.__CreatePage = () => {
    const el = mk('page');
    g.__MOCK_PAGE__ = el;
    return el;
  };
  // The info argument's `nodeIndex` is kept, as the engine does (`Element::SetNodeIndex`).
  g.__CreateView = (_parent: number, info?: { nodeIndex?: unknown }) => mk('view', info);
  g.__CreateText = (_parent: number, info?: { nodeIndex?: unknown }) => mk('text', info);
  g.__CreateImage = (_parent: number, info?: { nodeIndex?: unknown }) => mk('image', info);
  g.__CreateScrollView = (_parent: number, info?: { nodeIndex?: unknown }) => mk('scroll-view', info);
  // The real native engine throws `LynxCreateUIException: ... ui not found
  // when create UI` for a tag outside Lynx's fixed built-in vocabulary, with
  // no generic fallback (confirmed on-device). `createTypedElement`
  // (ops-apply.ts) must never pass an unrecognized tag here — it falls back to
  // `__CreateView` itself. Mirror that strictness so a regression fails this
  // mock instead of only surfacing on a real device.
  const KNOWN_LYNX_TAGS = new Set([
    'view', 'text', 'image', 'scroll-view', 'list', 'list-item', 'frame',
    'input', 'textarea', 'overlay', 'svg', 'refresh', 'refresh-header',
    'title-bar-view', 'viewpager', 'viewpager-item', 'scroll-coordinator',
    'scroll-coordinator-header', 'scroll-coordinator-slot',
    'scroll-coordinator-slot-drag', 'scroll-coordinator-toolbar', 'blur-view',
    'webview', 'video', 'markdown', 'filter-image', 'inline-text', 'inline-image',
    'inline-truncation', 'list-row',
  ]);
  g.__CreateElement = (type: string, _parent?: number, info?: { nodeIndex?: unknown }) => {
    if (!KNOWN_LYNX_TAGS.has(type)) {
      throw new Error(
        `__CreateElement('${type}'): not a real Lynx tag — the native engine has no generic `
          + 'fallback for this (confirmed on-device); createTypedElement should have used '
          + '__CreateView instead.',
      );
    }
    return mk(type, info);
  };
  g.__CreateRawText = (text: string) => {
    const el = mk('#raw-text');
    el.text = text;
    return el;
  };
  g.__CreateList = (
    _parentUid: number,
    componentAtIndex: NonNullable<MockEl['listCbs']>['componentAtIndex'],
    enqueueComponent?: NonNullable<MockEl['listCbs']>['enqueueComponent'],
  ) => {
    const el = mk('list');
    el.listId = el.uid;
    el.listCbs = { componentAtIndex, enqueueComponent };
    return el;
  };

  g.__AppendElement = (p: MockEl, c: MockEl) => {
    c.parent = p;
    p.children.push(c);
  };
  g.__InsertElementBefore = (p: MockEl, c: MockEl, anchor: MockEl) => {
    c.parent = p;
    const i = p.children.indexOf(anchor);
    p.children.splice(i < 0 ? p.children.length : i, 0, c);
  };
  g.__RemoveElement = (p: MockEl, c: MockEl) => {
    const i = p.children.indexOf(c);
    if (i >= 0) p.children.splice(i, 1);
  };
  g.__SetAttribute = (el: MockEl, key: string, value: unknown) => {
    if (key === 'update-list-info' && value !== undefined) (el.listUpdates ??= []).push(value);
    if (key === 'text') el.text = value as string;
    else if (value === undefined) delete el.attrs[key];
    else el.attrs[key] = value;
  };
  g.__AddDataset = (el: MockEl, key: string, value: unknown) => {
    el.dataset ??= {};
    if (value === undefined) delete el.dataset[key];
    else el.dataset[key] = value;
  };
  g.__SetInlineStyles = (el: MockEl, styles: unknown) => {
    el.style = styles;
  };
  // A real engine adds one property to the element's inline style. Mirror that for
  // a string style, keeping the other declarations.
  g.__AddInlineStyle = (el: MockEl, key: string, value: string) => {
    const declarations = typeof el.style === 'string'
      ? el.style.split(';').map((d) => d.trim()).filter((d) => d && d.slice(0, d.indexOf(':')).trim() !== key)
      : [];
    el.style = [...declarations, `${key}: ${value}`].join('; ');
  };
  g.__GetAttributeByName = (el: MockEl, name: string) => el.attrs[name];
  g.__GetAttributeNames = (el: MockEl) => Object.keys(el.attrs);
  // Enough of a selector engine for a harness: `.class` and `#id`, descendants only.
  const matches = (el: MockEl, selector: string): boolean =>
    selector.startsWith('#')
      ? el.attrs['id'] === selector.slice(1)
      : selector.startsWith('.') && String(el.classes ?? '').split(/\s+/).includes(selector.slice(1));
  const queryAll = (el: MockEl, selector: string): MockEl[] =>
    el.children.flatMap((child) => [...(matches(child, selector) ? [child] : []), ...queryAll(child, selector)]);
  g.__QuerySelector = (el: MockEl, selector: string) => queryAll(el, selector)[0] ?? null;
  g.__QuerySelectorAll = (el: MockEl, selector: string) => queryAll(el, selector);
  // `method: 'fail'` lets a harness reach the rejection path.
  g.__InvokeUIMethod = (
    el: MockEl,
    method: string,
    params: unknown,
    callback: (result: { code: number; data?: unknown }) => void,
  ) => {
    ((g.__MT_INVOKE_LOG__ ??= []) as unknown[]).push({ el, method, params });
    if (method === 'boundingClientRect') {
      // The same rect, `__QUERY_RECT_LEFT__` and `__QUERY_DELAY_MS__` as the
      // Background Thread's `invoke` below: `<lynx-slider>` measures here.
      const left = (g.__QUERY_RECT_LEFT__ as number | undefined) ?? 0;
      const answer = (): void =>
        callback({ code: 0, data: { left, top: 0, right: left + 100, bottom: 50, width: 100, height: 50 } });
      const delay = g.__QUERY_DELAY_MS__;
      if (typeof delay === 'number' && delay > 0) setTimeout(answer, delay);
      else answer();
      return;
    }
    callback(method === 'fail' ? { code: 1 } : { code: 0, data: { method, params } });
  };
  g.__ElementAnimate = (el: MockEl, args: unknown[]) => {
    ((g.__ANIMATE_LOG__ ??= []) as unknown[]).push({ el, args });
  };
  g.__SetClasses = (el: MockEl, cls: string) => {
    el.classes = cls;
  };
  g.__SetID = (el: MockEl, id: string | undefined) => {
    el.attrs['id'] = id;
  };
  g.__SetCSSId = () => {};
  // Mirrors the real engine's typeof-based dispatch (confirmed against
  // @lynx-js/web-core's actual __AddEvent and the engine's touch_event_handler.cc):
  // a `string` is a cross-thread sign, an object `{type:'worklet',
  // value}` routes to the worklet runtime, anything else (notably a raw
  // function — what an earlier, broken version of worklet-apply.ts passed) is
  // NOT a real PAPI shape and registers no listener, exactly like a real
  // device. This is what would have caught that bug here instead of only on
  // a physical device.
  g.__AddEvent = (el: MockEl, type: string, name: string, handler: unknown) => {
    if (handler === undefined) {
      delete el.events[name];
    } else if (typeof handler === 'string') {
      el.events[name] = { type, sign: handler };
    } else if (
      typeof handler === 'object'
      && handler !== null
      && (handler as { type?: string }).type === 'worklet'
    ) {
      const value = (handler as { value: unknown }).value;
      // As the native engine calls it: the event carries the element it's bound
      // to as `currentTarget` (and `target`, unless the harness gave one), with
      // the native element under `elementRefptr`, and `source: 1` asks for the
      // stopPropagation bits back.
      el.events[name] = {
        type,
        sign: (event: unknown) => {
          if (event && typeof event === 'object') {
            const ev = event as Record<string, unknown>;
            const self = { id: el.attrs['id'], uid: el.uid, dataset: el.dataset ?? {}, elementRefptr: el };
            ev['currentTarget'] ??= self;
            ev['target'] ??= { ...self };
          }
          return g.runWorklet(value, [event], { source: 1 });
        },
      };
    }
    // Anything else (e.g. a function) — silently no-op, matching the engine.
  };
  g.__GetElementUniqueID = (el: MockEl) => el.uid;
  // No real CSS engine here, so approximate "computed" style by reading the
  // element's own inline styles (set via __SetInlineStyles). Enough for a
  // harness to assert the read reached the PAPI and round-tripped a value;
  // a real engine resolves the full cascade.
  g.__GetComputedStyleByKey = (el: MockEl, key: string): string => {
    const style = el.style;
    if (typeof style === 'string') {
      for (const decl of style.split(';')) {
        const idx = decl.indexOf(':');
        if (idx > 0 && decl.slice(0, idx).trim() === key) return decl.slice(idx + 1).trim();
      }
      return '';
    }
    if (style && typeof style === 'object') {
      const v = (style as Record<string, unknown>)[key];
      return v == null ? '' : String(v);
    }
    return '';
  };
  g.__FlushElementTree = () => {};
  // Mock of `__SetGestureDetector`/`__RemoveGestureDetector` (absent from a
  // real `@lynx-js/web-core` bundle — on-device only; see gesture-apply.ts).
  // Records the detector so a harness can inspect it and fire a named
  // callback via `fireGestureCallback`.
  g.__SetGestureDetector = (
    el: MockEl,
    gestureId: number,
    type: number,
    config: { callbacks: { name: string; callback: unknown }[] },
    relationMap: unknown,
  ) => {
    (el.gestures ??= {})[gestureId] = { type, config, relationMap };
  };
  g.__RemoveGestureDetector = (el: MockEl, gestureId: number) => {
    delete el.gestures?.[gestureId];
  };

  // `lynxAnimate` (worklet-apply.ts) drives its tween loop with plain
  // `setTimeout`/`clearTimeout` — real Node globals, no mock needed. (An
  // earlier version used `requestAnimationFrame`; switched after live testing
  // found the web preview's Main Thread runs inside a `display: none` iframe,
  // where browsers never fire rAF callbacks at all — see worklet-apply.ts's
  // module doc for the full story.)

  // ng-lynx's own worklet runtime (main-thread/src/worklet-runtime), the one a
  // real Main-Thread bundle installs: `runWorklet`, the registration globals,
  // timers from `lynx` (this mock's has none, so Node's stay) and
  // `lynx.querySelector`. Each harness registers its worklets afresh.
  installWorkletRuntime();
  clearWorklets();
}

export function getPage(): MockEl {
  return g.__MOCK_PAGE__;
}

/** The last selector query issued (for selector-query verification). */
export function getLastQuery(): { selector: string; [k: string]: unknown } | undefined {
  return g.__LAST_QUERY__;
}

/** The most recent flushed ops batch (flat wire buffer). */
export function getLastOps(): unknown[] {
  return g.__LAST_OPS__ ?? [];
}

/**
 * The exact serialized string of the first ops batch shipped since
 * `installMockPapi()` — the raw material of a first-screen snapshot.
 */
export function getFirstOpsString(): string | undefined {
  return g.__FIRST_OPS_STRING__;
}

/** The `epoch` sibling field of the most recent flushed batch (see flush.ts). */
export function getLastEpoch(): string | undefined {
  return g.__LAST_EPOCH__;
}

/**
 * Every flushed ops batch since the last `installMockPapi()`, each as its
 * own flat array. Work triggered outside an active change-detection walk
 * (e.g. calling a `ViewContainerRef` method directly, not from a signal
 * write) can legitimately split across two flushes — a bare CREATE/INSERT,
 * then a separately-scheduled pass evaluating the new view's bindings — so
 * prefer `opsSince(marker)` over `getLastOps()` when asserting on such work.
 */
export function getOpsLog(): unknown[][] {
  return opsLog;
}

/** A checkpoint into `getOpsLog()` — pass to `opsSince` later. */
export function opsLogMark(): number {
  return opsLog.length;
}

/** Every op (flattened) from every batch flushed since `mark`. */
export function opsSince(mark: number): unknown[] {
  return opsLog.slice(mark).flat();
}

/**
 * Simulate the native engine firing a main-thread worklet event: runs the
 * handler `__AddEvent` stored, which calls `runWorklet` the way the engine does.
 * Returns what `runWorklet` returned: `{ returnValue, eventReturnResult }`, or
 * `undefined` if nothing is bound to `name`.
 */
export function fireWorklet(el: MockEl, name: string, event: unknown): unknown {
  const handler = el.events[name]?.sign as unknown;
  return typeof handler === 'function' ? (handler as (e: unknown) => unknown)(event) : undefined;
}

/**
 * Simulate the native gesture engine invoking one phase of a registered
 * gesture (e.g. `onStart`) — resolves the worklet ref `__SetGestureDetector`
 * was given and runs it through the same real worklet dispatch `fireWorklet`
 * ultimately relies on (`g.runWorklet`), with `source: 2` as the engine passes.
 */
export function fireGestureCallback(el: MockEl, gestureId: number, name: string, event: unknown): void {
  const callback = el.gestures?.[gestureId]?.config.callbacks.find((c) => c.name === name)?.callback;
  if (!callback) return;
  // The engine's state manager: the second argument of a gesture callback. Like
  // Explorer 4.2's, it has `__SetGestureState(element, id, 1 | 2 | 3)` and no
  // `active`/`fail`/`end` methods of its own.
  const log = (g.__GESTURE_STATE_LOG__ ??= []) as unknown[];
  const states = { 1: 'active', 2: 'fail', 3: 'end' } as Record<number, string>;
  const lepusGesture = {
    __SetGestureState: (element: unknown, id: number, state: number) =>
      log.push([states[state] ?? state, id, element === el ? 'this element' : 'another element']),
    scrollBy: (deltaX: number, deltaY: number) => {
      log.push(['scrollBy', deltaX, deltaY]);
      return { consumedX: deltaX, consumedY: deltaY, unconsumedX: 0, unconsumedY: 0 };
    },
  };
  g.runWorklet(callback as { _wkltId: string }, [event, lepusGesture], { source: 2 });
}

/**
 * Simulate the native list runtime: read the list element's pending
 * `update-list-info` and call `componentAtIndex` for each newly-inserted item,
 * which appends the real item element into the list's children.
 */
export function driveList(listEl: MockEl): void {
  const info = listEl.attrs['update-list-info'] as
    | { insertAction: { position: number }[]; removeAction: unknown[] }
    | undefined;
  if (!info || !listEl.listCbs) return;

  // Faithfully emulate @lynx-js/web-core's `update-list-info` handler so that a
  // wrongly-shaped removeAction fails here the same way it fails on a device:
  //   removeAction.forEach((position, i) => children[position - i] is removed)
  //   insertAction.forEach(a => componentAtIndex(a.position) then insertBefore)
  // If removeAction carries `{ position }` objects or descending numbers, the
  // `position - i` arithmetic is NaN / wrong, no cells are removed, and the new
  // cells pile onto the old ones — surfacing as duplicate item-keys downstream.
  const removeAction = (info.removeAction ?? []) as unknown[];
  removeAction.forEach((position, i) => {
    const idx = (position as number) - i;
    if (Number.isInteger(idx) && listEl.children[idx]) listEl.children.splice(idx, 1);
  });

  for (const action of info.insertAction) {
    // Mirror web-core: the returned sign says which cell it is, and that cell goes
    // to the requested position (`insertBefore(cell, children[pos])`) whether or not
    // the callback appended it. A cell the list asks for again isn't appended.
    const sign = listEl.listCbs.componentAtIndex(listEl, listEl.listId ?? 0, action.position, 0);
    const cell = sign === undefined ? undefined : elementsByUid.get(sign);
    if (!cell) continue;
    const current = listEl.children.indexOf(cell);
    if (current >= 0) listEl.children.splice(current, 1);
    listEl.children.splice(Math.min(action.position, listEl.children.length), 0, cell);
  }
  // Consume the batch (the native side would not replay it).
  delete listEl.attrs['update-list-info'];
}

/** A native `<list>` that virtualizes, from {@link virtualizingList}. */
export interface VirtualizingList {
  /** Every item-key the list knows, in order. */
  readonly keys: readonly string[];
  /** What a device would report: duplicate item-keys, malformed actions, bad signs. */
  readonly errors: readonly string[];
  /** Every `componentAtIndex` call, by cell index. */
  readonly requests: readonly number[];
  /** Apply the pending `update-list-info`, then show cells `first` to `last`. */
  layout(first: number, last: number): void;
  /** The element shown in cell `index`, or `undefined` for an empty or hidden cell. */
  cell(index: number): MockEl | undefined;
  /** Cells on screen that show nothing. */
  emptyCells(): number[];
}

/**
 * Imitate a native `<list>` that virtualizes, as the iOS collection list and the
 * C++ list container do (`driveList` imitates web-core, which doesn't): it keeps
 * every item-key it's told about, asks `componentAtIndex` only for the cells on
 * screen, lets go of cells that leave with `enqueueComponent`, and asks again for
 * a cell on screen that an `updateAction` with `flush: true` names. It records
 * what a device rejects: duplicate item-keys, an action without `item-key` or
 * `type` (iOS stores both in arrays that can't hold nil), and an update whose
 * `item-key` isn't the one at its position.
 */
export function virtualizingList(listEl: MockEl): VirtualizingList {
  const keys: string[] = [];
  const keySet = new Set<string>();
  const errors: string[] = [];
  const requests: number[] = [];
  /** item-key → sign of the cell held for it; -1 for an empty cell. */
  const held = new Map<string, number>();
  const dirty = new Set<string>();
  let first = 0;
  let last = -1;
  let operationId = 1;
  const listId = listEl.listId ?? 0;

  const release = (key: string): void => {
    const sign = held.get(key);
    if (sign === undefined) return;
    held.delete(key);
    // iOS recycles a cell's UI even when it has none, as sign 0.
    listEl.listCbs?.enqueueComponent?.(listEl, listId, sign > 0 ? sign : 0);
  };

  const applyUpdates = (): void => {
    const updates = listEl.listUpdates ?? [];
    listEl.listUpdates = [];
    delete listEl.attrs['update-list-info'];
    for (const update of updates) applyUpdate(update as Parameters<typeof applyUpdate>[0]);
  };

  const applyUpdate = (info: {
    insertAction?: Record<string, unknown>[];
    removeAction?: unknown[];
    updateAction?: Record<string, unknown>[];
  }): void => {
    (info.removeAction ?? []).forEach((position, i) => {
      const index = (position as number) - i;
      if (!Number.isInteger(index) || index < 0 || index >= keys.length) {
        errors.push(`removeAction position ${String(position)} is out of range`);
        return;
      }
      const key = keys.splice(index, 1)[0]!;
      keySet.delete(key);
      release(key);
      dirty.delete(key);
    });
    for (const action of info.insertAction ?? []) {
      const key = action['item-key'];
      const position = action['position'] as number;
      if (typeof key !== 'string' || key === '') {
        errors.push(`insertAction at ${String(position)} has no item-key`);
        continue;
      }
      if (typeof action['type'] !== 'string') errors.push(`insertAction for "${key}" has no type`);
      if (keySet.has(key)) errors.push(`duplicated list item-key "${key}"`);
      keySet.add(key);
      keys.splice(Math.min(position, keys.length), 0, key);
    }
    for (const action of info.updateAction ?? []) {
      const key = action['item-key'];
      const from = action['from'];
      if (typeof key !== 'string' || key === '' || typeof action['type'] !== 'string') {
        errors.push(`updateAction at ${String(from)} needs item-key and type`);
        continue;
      }
      if (typeof from !== 'number' || typeof action['to'] !== 'number' || typeof action['flush'] !== 'boolean') {
        errors.push(`updateAction for "${key}" needs numeric from/to and a boolean flush`);
        continue;
      }
      if (keys[from] !== key) errors.push(`updateAction at ${from} names "${key}", but the cell there is "${keys[from]}"`);
      if (action['flush'] === true && held.has(key)) dirty.add(key);
    }
  };

  const attached = (sign: number | undefined): MockEl | undefined => {
    if (sign === undefined || sign <= 0) return undefined;
    const el = elementsByUid.get(sign);
    return el && listEl.children.includes(el) ? el : undefined;
  };

  return {
    keys,
    errors,
    requests,
    layout(from: number, to: number): void {
      applyUpdates();
      first = Math.max(0, from);
      last = Math.min(keys.length - 1, to);
      const visible = new Set(keys.slice(first, last + 1));
      for (const key of [...held.keys()]) if (!visible.has(key)) release(key);
      for (let index = first; index <= last; index++) {
        const key = keys[index]!;
        if (held.has(key) && !dirty.has(key)) continue;
        dirty.delete(key);
        // The C++ list container lets go of a cell before binding it again.
        const previous = held.get(key);
        if (previous !== undefined && previous > 0) listEl.listCbs?.enqueueComponent?.(listEl, listId, previous);
        requests.push(index);
        const answer = listEl.listCbs?.componentAtIndex(listEl, listId, index, operationId++);
        const sign = typeof answer === 'number' ? answer : -1;
        if (sign > 0 && !attached(sign)) {
          errors.push(`componentAtIndex(${index}) answered with sign ${sign}, which isn't a cell of this list`);
        }
        held.set(key, sign);
      }
    },
    cell(index: number): MockEl | undefined {
      if (index < first || index > last) return undefined;
      const key = keys[index];
      return key === undefined ? undefined : attached(held.get(key));
    },
    emptyCells(): number[] {
      const empty: number[] = [];
      for (let index = first; index <= last; index++) if (!this.cell(index)) empty.push(index);
      return empty;
    },
  };
}

// --- tree helpers ----------------------------------------------------------

export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export function printTree(el: MockEl, depth = 0): string[] {
  const pad = '  '.repeat(depth);
  const bits: string[] = [];
  if (el.classes) bits.push(`.${el.classes.split(' ').join('.')}`);
  if (el.events && Object.keys(el.events).length) bits.push(`@${Object.keys(el.events).join(',')}`);
  if (el.type === 'list-item' && el.attrs['item-key'] != null) bits.push(`key=${el.attrs['item-key']}`);
  const text = el.text != null ? ` "${el.text}"` : '';
  const lines = [`${pad}<${el.type}${bits.length ? ' ' + bits.join(' ') : ''}>${text}`];
  for (const c of el.children) lines.push(...printTree(c, depth + 1));
  return lines;
}

export function findByType(el: MockEl, type: string): MockEl | undefined {
  if (el.type === type) return el;
  for (const c of el.children) {
    const r = findByType(c, type);
    if (r) return r;
  }
  return undefined;
}

export function findByClass(el: MockEl, cls: string): MockEl | undefined {
  if (el.classes?.split(/\s+/).includes(cls)) return el;
  for (const c of el.children) {
    const r = findByClass(c, cls);
    if (r) return r;
  }
  return undefined;
}

/** Every element carrying `cls`, in document order (depth-first). */
export function findAllByClass(el: MockEl, cls: string): MockEl[] {
  const out: MockEl[] = [];
  if (el.classes?.split(/\s+/).includes(cls)) out.push(el);
  for (const c of el.children) out.push(...findAllByClass(c, cls));
  return out;
}

export function findEventSign(el: MockEl, name: string): string | undefined {
  if (el.events?.[name]) return el.events[name].sign as string;
  for (const c of el.children) {
    const s = findEventSign(c, name);
    if (s) return s;
  }
  return undefined;
}

export function findText(el: MockEl, includes: string): string | undefined {
  if (el.text?.includes(includes)) return el.text;
  for (const c of el.children) {
    const t = findText(c, includes);
    if (t) return t;
  }
  return undefined;
}

export function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}
