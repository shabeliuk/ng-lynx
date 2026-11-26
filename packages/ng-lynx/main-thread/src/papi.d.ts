/**
 * Ambient declarations for the subset of the Lynx element PAPI (Platform API)
 * used by the Main-Thread executor.
 *
 * In a real build these come from `@lynx-js/type-element-api` /
 * `@lynx-js/types`. They are declared here so the package type-checks
 * standalone. The functions are injected into the Lepus global scope by the
 * Lynx runtime; on the JS side they are simply ambient globals.
 */

/** The Main Thread's `console`; declared here because this package targets no DOM lib. */
declare const console: { log(...args: unknown[]): void; warn(...args: unknown[]): void };

/** Opaque handle to a real Lynx element living on the Main Thread. */
type LynxElement = unknown;

declare function __CreatePage(componentId: string, cssId: number): LynxElement;
declare function __CreateView(parentComponentUniqueId: number): LynxElement;
declare function __CreateText(parentComponentUniqueId: number): LynxElement;
declare function __CreateImage(parentComponentUniqueId: number): LynxElement;
declare function __CreateScrollView(parentComponentUniqueId: number): LynxElement;
declare function __CreateElement(type: string, parentComponentUniqueId: number): LynxElement;
declare function __CreateRawText(text: string): LynxElement;

/** Native virtualized list. The runtime drives item creation via the callbacks. */
declare function __CreateList(
  parentComponentUniqueId: number,
  componentAtIndex: (list: LynxElement, listID: number, cellIndex: number, operationID: number) => number | undefined,
  enqueueComponent: (list: LynxElement, listID: number, sign: number) => void,
  info: Record<string, unknown>,
  componentAtIndexes: (list: LynxElement, listID: number, cellIndexes: number[], operationIDs: number[]) => void,
): LynxElement;

declare function __AppendElement(parent: LynxElement, child: LynxElement): void;
declare function __InsertElementBefore(parent: LynxElement, child: LynxElement, anchor: LynxElement): void;
declare function __RemoveElement(parent: LynxElement, child: LynxElement): void;

declare function __SetAttribute(el: LynxElement, key: string, value: unknown): void;
declare function __AddDataset(el: LynxElement, key: string, value: unknown): void;
declare function __GetAttributeByName(el: LynxElement, name: string): unknown;
declare function __GetAttributeNames(el: LynxElement): string[];
declare function __AddInlineStyle(el: LynxElement, key: string, value: string): void;
declare function __QuerySelector(el: LynxElement, selector: string, options: object): LynxElement | null | undefined;
declare function __QuerySelectorAll(el: LynxElement, selector: string, options: object): LynxElement[];
declare function __InvokeUIMethod(
  el: LynxElement,
  method: string,
  params: Record<string, unknown>,
  callback: (result: { code: number; data?: unknown }) => void,
): void;
declare function __ElementAnimate(el: LynxElement, args: unknown[]): unknown;
declare function __SetInlineStyles(el: LynxElement, styles: string | object): void;
declare function __SetClasses(el: LynxElement, classes: string): void;
declare function __SetID(el: LynxElement, id: string | undefined): void;
declare function __SetCSSId(els: LynxElement[], cssId: number): void;
/** The stylesheet in a fetched bundle's custom section, or `null` when it has none. Engine 3.9. */
declare function __LoadStyleSheet(section: string, bundleName: string): unknown;
declare function __AdoptStyleSheet(sheet: unknown): void;
/**
 * `handler` is `string` for a cross-thread sign (routed to `publishEvent`),
 * `undefined` to remove the listener, or `{ type: 'worklet', value }` to
 * route to the native worklet runtime (`runWorklet` — see worklet-apply.ts).
 * Never a function — the real engine has no such branch.
 */
declare function __AddEvent(
  el: LynxElement,
  eventType: string,
  eventName: string,
  handler: string | undefined | { type: 'worklet'; value: unknown },
): void;

declare function __GetElementUniqueID(el: LynxElement): number;
/**
 * Read a single resolved (computed) style value off an element on the Main
 * Thread — the read counterpart to `__SetInlineStyles`. Curated from Lynx's
 * Element-PAPI reference (`__GetComputedStyleByKey`), used only by the
 * worklet element handle's `getComputedStyleProperty` (worklet-apply.ts); like
 * the other declarations here it's typed against the reference, not
 * independently confirmed on-device.
 */
declare function __GetComputedStyleByKey(el: LynxElement, key: string): string;
declare function __FlushElementTree(el?: LynxElement, options?: Record<string, unknown>): void;

/**
 * Native gesture-detector registration — see `gesture-apply.ts`. The web preview
 * has only no-op detectors (web-core 0.26), so gestures fire on a device only;
 * guarded with a `typeof` check at the one call site.
 */
declare function __SetGestureDetector(
  el: LynxElement,
  gestureId: number,
  gestureType: number,
  config: Record<string, unknown>,
  relationMap: Record<string, unknown>,
): void;
declare function __RemoveGestureDetector(el: LynxElement, gestureId: number): void;
declare function _ReportError(error: Error, info: { errorCode: number }): void;

/**
 * The Main Thread's end of a cross-thread event channel — `dispatchEvent`
 * sends to the *other* thread (here, the Background Thread's
 * `getCoreContext()`); it does not dispatch locally. Confirmed against
 * `@lynx-js/web-core`'s real `LynxCrossThreadContext`.
 */
interface LynxJSContext {
  dispatchEvent(event: { type: string; data?: unknown }): void;
  addEventListener(type: string, listener: (event: { data: unknown }) => void): void;
}

// eslint-disable-next-line no-var
declare var lynx:
  | {
      SystemInfo?: Record<string, unknown>;
      getJSContext?(): LynxJSContext;
      // The rest of the main-thread `lynx`, for `mainThreadLynx` in worklet-apply.ts.
      requestAnimationFrame?(callback: (time: number) => void): number;
      cancelAnimationFrame?(handle: number): void;
      getTextInfo?(text: string, info: Record<string, unknown>): { width: number; content?: string[] };
      __globalProps?: Record<string, unknown>;
      stopExposure?(options?: Record<string, unknown>): void;
      resumeExposure?(): void;
      getSessionStorageItem?(key: string, callback: (value: unknown) => void): void;
      setSessionStorageItem?(key: string, value: unknown): void;
      subscribeSessionStorage?(key: string, listener: (value: unknown) => void): number;
      unsubscribeSessionStorage?(key: string, id: number): void;
    }
  | undefined;
