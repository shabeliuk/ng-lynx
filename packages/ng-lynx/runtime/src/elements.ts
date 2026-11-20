/**
 * Typed template directives for Lynx's built-in elements.
 *
 * Angular's template checker only knows the DOM vocabulary, so a Lynx template
 * normally needs `schemas: [NO_ERRORS_SCHEMA]` — which turns *all* checking
 * off: tag typos compile, attribute typos compile, and `$event` is untyped
 * (or wrongly typed, when a Lynx event name collides with a DOM one — the
 * `(scroll)` gotcha in docs/12-events.md).
 *
 * Importing `LYNX_ELEMENTS` (or individual directives) into a component fixes
 * all three, because of how the compiler treats a matched directive:
 *
 *  - a directive whose selector matches the tag suppresses NG8001
 *    ("'view' is not a known element"), so **`NO_ERRORS_SCHEMA` can be
 *    dropped** — verified against ngc 21.2 with `strictTemplates`;
 *  - `[attr]` bindings are checked against the directive's typed inputs
 *    (typos → NG8002, wrong value types → TS2322);
 *  - `(event)` bindings resolve to the directive's typed outputs, so `$event`
 *    has the right payload type — including names that collide with DOM
 *    events (`scroll`, `input`, `focus`, …), where the directive type wins.
 *
 * Runtime cost is designed to be near zero:
 *
 *  - **Outputs are type-only.** When a template binds `(tap)` on an element,
 *    Angular registers a listener on the element itself (through
 *    `LynxRenderer2.listen()` — the exact same path untyped bindings use)
 *    *and additionally* subscribes to any same-named directive output. If the
 *    directive's output re-emitted the native event, every handler would run
 *    **twice** (confirmed empirically in `verify:elements` during
 *    development). So the outputs here are lazily-created **inert** emitters:
 *    they give the compiler the payload type for `$event` and make the event
 *    name a "claimed" output (which is also what suppresses the DOM-collision
 *    mis-typing of names like `scroll` — see docs/12-events.md), but never
 *    fire; delivery stays 100% on the renderer's native path. An unbound
 *    event costs nothing at all (Angular only reads output properties that
 *    are bound). Consequence: subscribe to these events in the template, not
 *    via `viewChild(LynxImage).load.subscribe(...)` — the programmatic
 *    emitter never emits.
 *  - **Inputs are setters** that forward to the element as ordinary attribute
 *    ops (`SET_ATTR` via `Renderer2.setProperty`, raw value preserved —
 *    booleans/numbers stay typed on the wire). Unset inputs never emit an op;
 *    setting one back to `undefined`/`null` removes the attribute only if the
 *    directive previously set it.
 *
 * Attribute and event surfaces are curated from `@lynx-js/types` (the same
 * typings ReactLynx's JSX uses via its `IntrinsicElements` map) — the original
 * set from `@lynx-js/types@3.7.0`, the rest (everything from `<svg>` on)
 * cross-checked directly against the canonical source
 * (`js_libraries/types/types/common/element/*.d.ts` in the `lynx-family/lynx`
 * GitHub repo) to pick up newer fields. Anything not declared here can still
 * be set as a static attribute (static attributes are not schema-checked), or
 * bound after adding `NO_ERRORS_SCHEMA` back — the directives are additive.
 */
import {
  Directive,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  Renderer2,
} from '@angular/core';

import { isWebPlatform } from './system-info.js';

// ---------------------------------------------------------------------------
// Event payload types (shapes from @lynx-js/types@3.7.0)
// ---------------------------------------------------------------------------

/** Identification of an event's target/currentTarget node. @public */
export interface LynxTarget {
  /** The `id` attribute of the node, if any. */
  id: string;
  /** The engine's unique identifier for the node. */
  uid: number;
  /** `data-*` attributes of the node. */
  dataset: Record<string, unknown>;
}

/** Base shape of every Lynx event delivered to the Background Thread. @public */
export interface LynxEvent<D = unknown> {
  /** Event type, e.g. `'tap'`. */
  type: string;
  /** Timestamp when the event was generated. */
  timestamp: number;
  /** The node the event originated on. */
  target: LynxTarget;
  /** The node the listener is bound to. */
  currentTarget: LynxTarget;
  /** Event-specific payload. */
  detail: D;
}

/** One finger on the touch plane. @public */
export interface LynxTouch {
  identifier: number;
  /** Coordinates relative to the touched element. */
  x: number;
  y: number;
  /** Coordinates relative to the page. */
  pageX: number;
  pageY: number;
  /** Coordinates relative to the display area. */
  clientX: number;
  clientY: number;
}

/** `tap` / `longtap` / `touchstart` / … payload. @public */
export interface LynxTouchEvent extends LynxEvent<{ x: number; y: number }> {
  touches: LynxTouch[];
  changedTouches: LynxTouch[];
}

// ---------------------------------------------------------------------------
// Pointer / keyboard events (PC / desktop targets).
//
// Lynx's touch-first event set (`tap`/`touch*` above) is what mobile uses.
// On PC/desktop targets Lynx also fires mouse, wheel, and physical-keyboard
// events — typed here from the reference's `MouseEvent`/`WheelEvent`/`KeyEvent`
// shapes (lynxjs.org/api/lynx-api/event/…). Their fields sit at the top level
// of the event object (like `touches` above), not in `detail`. Bind them the
// same way as any Lynx event: `(keydown)="…"`, `(wheel)="…"`, etc. On a mobile
// target they simply never fire.
// ---------------------------------------------------------------------------

/** `keydown` / `keyup` payload (physical keyboard, PC targets). @public */
export interface LynxKeyEvent extends LynxEvent {
  /** The value of the physical key pressed. */
  key: string;
  /** True while the key is held and auto-repeating. */
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * `mousedown` / `mouseup` / `mousemove` / `mouseenter` / `mouseover` /
 * `mouseleave` payload (PC targets). @public
 */
export interface LynxMouseEvent extends LynxEvent {
  /** Which button (0 = primary, 1 = middle, 2 = secondary). */
  button: number;
  /** Bitmask of buttons currently pressed. */
  buttons: number;
  /** Position in the element's coordinate system. */
  x: number;
  y: number;
  /** Position in the LynxView's coordinate system. */
  pageX: number;
  pageY: number;
  /** Position in the window's coordinate system. */
  clientX: number;
  clientY: number;
}

/** `wheel` payload (mouse wheel / touchpad scroll, PC targets). @public */
export interface LynxWheelEvent extends LynxMouseEvent {
  /** Horizontal scroll distance in logical pixels. */
  deltaX: number;
  /** Vertical scroll distance in logical pixels. */
  deltaY: number;
}

/** Scroll info shared by `<scroll-view>` scroll events. @public */
export interface LynxScrollDetail {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  deltaX: number;
  deltaY: number;
}

/** `<scroll-view>` `scroll`-family payload. @public */
export interface LynxScrollEvent extends LynxEvent<LynxScrollDetail> {}

/** `<list>` scroll payload (adds list geometry & attached cells). @public */
export interface LynxListScrollEvent
  extends LynxEvent<
    LynxScrollDetail & {
      listWidth?: number;
      listHeight?: number;
      eventSource?: number;
      /** The `<list-item>`s rendered right now; only with `[need-visible-item-info]="true"`. `index` counts the list's own children, so under `LynxVirtualFor` read the row from `itemKey`. */
      attachedCells?: { id: string; itemKey: string; index: number; top?: number; bottom?: number; left?: number; right?: number }[];
    }
  > {}

/** `<list>` `scrollstatechange` payload — 1 stationary, 2 dragging, 3 decelerating, 4 animating. @public */
export interface LynxListScrollStateChangeEvent extends LynxEvent<{ state: number }> {}

/** `<list>` `snap` payload. @public */
export interface LynxListSnapEvent
  extends LynxEvent<{
    position: number;
    currentScrollLeft?: number;
    currentScrollTop?: number;
    targetScrollLeft?: number;
    targetScrollTop?: number;
  }> {}

/** `<image>` `load` payload (dimensions in pixels). @public */
export interface LynxImageLoadEvent extends LynxEvent<{ width?: number; height?: number }> {
  width: number;
  height: number;
}

/** `<image>` `error` payload. @public */
export interface LynxImageErrorEvent extends LynxEvent<{ errMsg?: string }> {
  errMsg?: string;
  error_code?: number;
}

/** `<text>` `layout` payload. @public */
export interface LynxTextLayoutEvent
  extends LynxEvent<{
    lineCount: number;
    lines: { start: number; end: number; ellipsisCount: number }[];
    size: { width: number; height: number };
  }> {}

/** `<input>` / `<textarea>` `input` payload. @public */
export interface LynxInputEvent
  extends LynxEvent<{
    value: string;
    selectionStart: number;
    selectionEnd: number;
    isComposing?: boolean;
  }> {}

/** `<input>` / `<textarea>` `confirm` (submit-on-enter) payload. @public */
export interface LynxConfirmEvent extends LynxEvent<{ value: string }> {}

/** `<input>` / `<textarea>` `focus` / `blur` payload. @public */
export interface LynxFocusEvent extends LynxEvent<{ value: string }> {}

/** `<input>` / `<textarea>` `selection` payload. @public */
export interface LynxSelectionEvent
  extends LynxEvent<{ selectionStart: number; selectionEnd: number }> {}

/** `layoutchange` payload (new layout of the node). @public */
export interface LynxLayoutChangeEvent
  extends LynxEvent<{
    id?: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  }> {}

/** `uiappear` / `uidisappear` payload. @public */
export interface LynxUIAppearanceEvent
  extends LynxEvent<{ 'exposure-id'?: string; 'exposure-scene'?: string; unique_id?: number }> {}

/** CSS animation lifecycle payload. @public */
export interface LynxAnimationEvent extends LynxEvent<Record<string, never>> {
  animation_type?: string;
  animation_name?: string;
}

/** CSS transition lifecycle payload. @public */
export interface LynxTransitionEvent extends LynxEvent<Record<string, never>> {
  animation_type?: string;
}

/** `accessibilityaction` payload: which of `accessibility-actions` was triggered. @public */
export interface LynxAccessibilityActionEvent extends LynxEvent<{ name: string }> {}

/**
 * `<video>` `firstframe` payload: the source has loaded and shows its first
 * frame. Fired once per source: measured on iOS, and Android's engine source
 * does the same. @public
 */
export interface LynxVideoFirstFrameEvent extends LynxEvent<{ duration: number }> {}

/** `<video>` `timeupdate` payload. @public */
export interface LynxVideoTimeUpdateEvent extends LynxEvent<{ current: number; duration: number }> {}

/** `<video>` `error` payload. @public */
export interface LynxVideoErrorEvent extends LynxEvent<{ error_code?: number; error_msg?: string }> {}

/** `<frame>` `load` payload. @public */
export interface LynxFrameLoadEvent
  extends LynxEvent<{ url: string; statusCode: number; statusMessage: string }> {}

/** `<frame>` `loadmetrics` payload. @public */
export interface LynxFrameLoadMetricsEvent
  extends LynxEvent<{ url: string; mode: string; entry: Record<string, unknown> }> {}

/** `<overlay>` `overlaytouch` payload — `state`: 0 down, 1 move, 2 up, 3 cancel. @public */
export interface LynxOverlayTouchEvent extends LynxEvent<{ x: number; y: number; state: number }> {}

/** `<overlay>` `error` payload (Android only). @public */
export interface LynxOverlayErrorEvent extends LynxEvent<{ errorCode: string; errorMsg: string }> {}

/** `<refresh>` `startrefresh` payload. @public */
export interface LynxRefreshStartEvent extends LynxEvent<{ isManual: boolean }> {}

/** `<refresh>` `headeroffset` payload. @public */
export interface LynxRefreshHeaderOffsetEvent
  extends LynxEvent<{ isDragging: boolean; offsetPercent: number }> {}

/** `<refresh>` `refreshstatechange` payload — 0 idle, 1 over-drag-release, 2 refreshing. @public */
export interface LynxRefreshStateChangeEvent extends LynxEvent<{ state: number }> {}

/** `<viewpager>` `change` / `willchange` payload. @public */
export interface LynxViewPagerChangeEvent extends LynxEvent<{ index: number; isDragged: boolean }> {}

/** `<viewpager>` `offsetchange` payload. @public */
export interface LynxViewPagerOffsetChangeEvent extends LynxEvent<{ offset: number }> {}

/** `<scroll-coordinator>` `offset` payload — both in px. @public */
export interface LynxScrollCoordinatorOffsetEvent extends LynxEvent<{ offset: number; height: number }> {}

/** `<webview>` `error` payload. @public */
export interface LynxWebviewErrorEvent extends LynxEvent<{ errorMsg: string; errorCode: number }> {}

/** `<webview>` `message` payload (posted from the embedded page's JS). @public */
export interface LynxWebviewMessageEvent extends LynxEvent<{ msg: string }> {}

/** `<webview>` `locationchange` / `openwindow` payload (Desktop only). @public */
export interface LynxWebviewUrlEvent extends LynxEvent<{ url: string }> {}

// ---------------------------------------------------------------------------
// Base machinery
// ---------------------------------------------------------------------------

/**
 * Shared machinery: lazy typed outputs and attribute-forwarding inputs.
 *
 * Selector-less abstract directive — concrete element directives extend it and
 * Ivy's definition inheritance merges the metadata (the same feature
 * `@angular/forms` relies on; `Object.hasOwn` is polyfilled for it in
 * entry-background.ts).
 */
@Directive()
export abstract class LynxElementBase {
  private readonly elementRef = inject(ElementRef);
  private readonly renderer = inject(Renderer2);
  private emitters?: Map<string, EventEmitter<unknown>>;
  private appliedAttrs?: Set<string>;

  /**
   * Lazily create the **inert** emitter for `name`. Angular only reads an
   * output property the template binds, so unbound events allocate nothing.
   * The emitter never emits — it exists purely to type `$event` and claim the
   * event name; delivery happens through Angular's own element listener (see
   * the module doc for why re-emitting here would double-deliver).
   */
  protected event<E>(name: string): EventEmitter<E> {
    const emitters = (this.emitters ??= new Map());
    let emitter = emitters.get(name);
    if (!emitter) {
      emitter = new EventEmitter<unknown>();
      emitters.set(name, emitter);
    }
    return emitter as EventEmitter<E>;
  }

  /**
   * Forward an input value to the element as an attribute op. Raw values are
   * preserved (booleans/numbers don't get stringified). `undefined`/`null`
   * removes the attribute — but only if this directive previously set it, so
   * unset inputs never emit ops.
   */
  protected setAttr(name: string, value: unknown): void {
    if (value === undefined || value === null) {
      if (this.appliedAttrs?.delete(name)) {
        this.renderer.removeAttribute(this.elementRef.nativeElement, name);
      }
      return;
    }
    (this.appliedAttrs ??= new Set()).add(name);
    this.renderer.setProperty(this.elementRef.nativeElement, name, value);
  }
}

/**
 * Events every Lynx element supports (`@lynx-js/types` `LynxEventProps`,
 * mobile surface — the PC-only mouse/wheel/key events are omitted for now).
 * Listed as `outputs` metadata; the properties themselves are lazy getters.
 */
const STANDARD_OUTPUTS = [
  'tap',
  'catchtap',
  'longtap',
  'catchlongtap',
  'touchstart',
  'catchtouchstart',
  'touchmove',
  'catchtouchmove',
  'touchend',
  'catchtouchend',
  'touchcancel',
  'catchtouchcancel',
  'longpress',
  'catchlongpress',
  'focus',
  'blur',
  'layoutchange',
  'uiappear',
  'uidisappear',
  'animationstart',
  'animationiteration',
  'animationend',
  'animationcancel',
  'transitionstart',
  'transitionend',
  'transitioncancel',
  'accessibilityaction',
  'bgload',
  'bgerror',
  // Pointer / keyboard (PC / desktop targets — never fire on mobile).
  'keydown',
  'keyup',
  'mousedown',
  'mouseup',
  'mouseclick',
  'mousemove',
  'mouseenter',
  'mouseover',
  'mouseleave',
  'wheel',
];

/** `exposure-*-margin-*` value. @public */
export type LynxExposureMargin = `${number}px` | `${number}rpx`;

/**
 * `accessibility-traits` value — the combination of accessibility traits that
 * best characterizes the node, per `@lynx-js/types@3.7.0`'s `StandardProps`.
 * @public
 */
export type LynxAccessibilityTrait =
  | 'text'
  | 'image'
  | 'button'
  | 'link'
  | 'header'
  | 'search'
  | 'selected'
  | 'playable'
  | 'keyboard'
  | 'summary'
  | 'disabled'
  | 'updating'
  | 'adjustable'
  | 'tabbar'
  | 'none';

/**
 * Inputs + outputs shared by all Lynx elements (`StandardProps`, curated).
 */
@Directive({ outputs: STANDARD_OUTPUTS })
export abstract class LynxStandardElement extends LynxElementBase {
  // --- events (lazy) ---
  get tap(): EventEmitter<LynxTouchEvent> { return this.event('tap'); }
  get touchstart(): EventEmitter<LynxTouchEvent> { return this.event('touchstart'); }
  get touchmove(): EventEmitter<LynxTouchEvent> { return this.event('touchmove'); }
  get touchend(): EventEmitter<LynxTouchEvent> { return this.event('touchend'); }
  get touchcancel(): EventEmitter<LynxTouchEvent> { return this.event('touchcancel'); }
  get longtap(): EventEmitter<LynxTouchEvent> { return this.event('longtap'); }
  /**
   * `(catchX)` counterparts of the touch/tap events above — same
   * `LynxTouchEvent` payload, registered as `catchEvent` instead of
   * `bindEvent` (renderer.ts's `parseEvent` strips the prefix and picks the
   * registration mode; it works for any event name, `catch`-prefixed or not,
   * with no directive output required for the runtime behavior to work).
   *
   * These getters exist purely so `(catchtouchmove)="…"` in a template gets
   * typed as `LynxTouchEvent` (with `.detail`) instead of Angular's strict
   * template checker falling back to the DOM's generic `Event` type for an
   * unclaimed event name (see docs/12-events.md's "a typing gotcha" section)
   * — found because that fallback typing broke a real `(catchtouchmove)`
   * usage (ui-gallery's gesture demos, added to stop a drag from also
   * scrolling an ancestor `<scroll-view>` — `catch` is the only mechanism in
   * this codebase for that).
   */
  get catchtap(): EventEmitter<LynxTouchEvent> { return this.event('catchtap'); }
  get catchtouchstart(): EventEmitter<LynxTouchEvent> { return this.event('catchtouchstart'); }
  get catchtouchmove(): EventEmitter<LynxTouchEvent> { return this.event('catchtouchmove'); }
  get catchtouchend(): EventEmitter<LynxTouchEvent> { return this.event('catchtouchend'); }
  get catchtouchcancel(): EventEmitter<LynxTouchEvent> { return this.event('catchtouchcancel'); }
  get catchlongtap(): EventEmitter<LynxTouchEvent> { return this.event('catchlongtap'); }
  get longpress(): EventEmitter<LynxTouchEvent> { return this.event('longpress'); }
  get catchlongpress(): EventEmitter<LynxTouchEvent> { return this.event('catchlongpress'); }
  // `any`, as in @lynx-js/types: `<input>` and `<textarea>` narrow it to `{ value }`.
  // biome-ignore lint/suspicious/noExplicitAny: see above
  get focus(): EventEmitter<LynxEvent<any>> { return this.event('focus'); }
  // biome-ignore lint/suspicious/noExplicitAny: see above
  get blur(): EventEmitter<LynxEvent<any>> { return this.event('blur'); }
  get layoutchange(): EventEmitter<LynxLayoutChangeEvent> { return this.event('layoutchange'); }
  get uiappear(): EventEmitter<LynxUIAppearanceEvent> { return this.event('uiappear'); }
  get uidisappear(): EventEmitter<LynxUIAppearanceEvent> { return this.event('uidisappear'); }
  get animationstart(): EventEmitter<LynxAnimationEvent> { return this.event('animationstart'); }
  get animationiteration(): EventEmitter<LynxAnimationEvent> { return this.event('animationiteration'); }
  get animationend(): EventEmitter<LynxAnimationEvent> { return this.event('animationend'); }
  get animationcancel(): EventEmitter<LynxAnimationEvent> { return this.event('animationcancel'); }
  get transitionstart(): EventEmitter<LynxTransitionEvent> { return this.event('transitionstart'); }
  get transitionend(): EventEmitter<LynxTransitionEvent> { return this.event('transitionend'); }
  get transitioncancel(): EventEmitter<LynxTransitionEvent> { return this.event('transitioncancel'); }
  get accessibilityaction(): EventEmitter<LynxAccessibilityActionEvent> { return this.event('accessibilityaction'); }
  /** The `background-image` loaded. */
  get bgload(): EventEmitter<LynxImageLoadEvent> { return this.event('bgload'); }
  /** The `background-image` failed to load. */
  get bgerror(): EventEmitter<LynxImageErrorEvent> { return this.event('bgerror'); }
  // Pointer / keyboard (PC / desktop targets) — see the event interfaces above.
  get keydown(): EventEmitter<LynxKeyEvent> { return this.event('keydown'); }
  get keyup(): EventEmitter<LynxKeyEvent> { return this.event('keyup'); }
  get mousedown(): EventEmitter<LynxMouseEvent> { return this.event('mousedown'); }
  get mouseup(): EventEmitter<LynxMouseEvent> { return this.event('mouseup'); }
  get mouseclick(): EventEmitter<LynxMouseEvent> { return this.event('mouseclick'); }
  get mousemove(): EventEmitter<LynxMouseEvent> { return this.event('mousemove'); }
  get mouseenter(): EventEmitter<LynxMouseEvent> { return this.event('mouseenter'); }
  get mouseover(): EventEmitter<LynxMouseEvent> { return this.event('mouseover'); }
  get mouseleave(): EventEmitter<LynxMouseEvent> { return this.event('mouseleave'); }
  get wheel(): EventEmitter<LynxWheelEvent> { return this.event('wheel'); }

  // --- identification ---
  @Input() set id(v: string | undefined) { this.setAttr('id', v); }

  // --- accessibility (curated from @lynx-js/types@3.7.0's `StandardProps` —
  // see docs/34-accessibility.md) ---
  @Input('accessibility-label') set accessibilityLabel(v: string | undefined) { this.setAttr('accessibility-label', v); }
  @Input('accessibility-element') set accessibilityElement(v: boolean | undefined) { this.setAttr('accessibility-element', v); }
  @Input('accessibility-traits') set accessibilityTraits(v: LynxAccessibilityTrait | undefined) { this.setAttr('accessibility-traits', v); }
  @Input('accessibility-value') set accessibilityValue(v: string | undefined) { this.setAttr('accessibility-value', v); }
  /** An id for `accessibility-elements` to refer to. */
  @Input('a11y-id') set a11yId(v: string | undefined) { this.setAttr('a11y-id', v); }
  /** Comma-separated `a11y-id`s: the focus order among this node's descendants. */
  @Input('accessibility-elements') set accessibilityElements(v: string | undefined) { this.setAttr('accessibility-elements', v); }
  /** Comma-separated `a11y-id`s: like `accessibility-elements`, for the elements that are accessible. */
  @Input('accessibility-elements-a11y') set accessibilityElementsA11y(v: string | undefined) { this.setAttr('accessibility-elements-a11y', v); }
  /** Marks the node as a heading for accessibility navigation (Android). */
  @Input('accessibility-heading') set accessibilityHeading(v: boolean | undefined) { this.setAttr('accessibility-heading', v); }
  /** A custom role description (Android) — common values, or any string. */
  @Input('accessibility-role-description') set accessibilityRoleDescription(
    v: 'switch' | 'checkbox' | 'image' | 'progressbar' | (string & {}) | undefined,
  ) { this.setAttr('accessibility-role-description', v); }
  /** Names of custom accessibility actions exposed on this node. */
  @Input('accessibility-actions') set accessibilityActions(v: readonly string[] | undefined) { this.setAttr('accessibility-actions', v); }
  /** Hides this node and its whole subtree from the accessibility tree. */
  @Input('accessibility-elements-hidden') set accessibilityElementsHidden(v: boolean | undefined) { this.setAttr('accessibility-elements-hidden', v); }
  /** Restricts sequential accessibility navigation to this node's subtree. */
  @Input('accessibility-exclusive-focus') set accessibilityExclusiveFocus(v: boolean | undefined) { this.setAttr('accessibility-exclusive-focus', v); }
  /** iOS-only: the `accessibilityIdentifier` of the underlying `UIView`. */
  @Input('ios-platform-accessibility-id') set iosPlatformAccessibilityId(v: string | undefined) { this.setAttr('ios-platform-accessibility-id', v); }

  // --- exposure (visibility detection) ---
  @Input('exposure-id') set exposureId(v: string | undefined) { this.setAttr('exposure-id', v); }
  @Input('exposure-scene') set exposureScene(v: string | undefined) { this.setAttr('exposure-scene', v); }
  @Input('exposure-area') set exposureArea(v: string | undefined) { this.setAttr('exposure-area', v); }
  /** Extends the screen's boundary for this node's exposure check. */
  @Input('exposure-screen-margin-top') set exposureScreenMarginTop(v: LynxExposureMargin | undefined) { this.setAttr('exposure-screen-margin-top', v); }
  @Input('exposure-screen-margin-bottom') set exposureScreenMarginBottom(v: LynxExposureMargin | undefined) { this.setAttr('exposure-screen-margin-bottom', v); }
  @Input('exposure-screen-margin-left') set exposureScreenMarginLeft(v: LynxExposureMargin | undefined) { this.setAttr('exposure-screen-margin-left', v); }
  @Input('exposure-screen-margin-right') set exposureScreenMarginRight(v: LynxExposureMargin | undefined) { this.setAttr('exposure-screen-margin-right', v); }
  /** Extends this node's own boundary for its exposure check. Needs `enable-exposure-ui-margin`. */
  @Input('exposure-ui-margin-top') set exposureUiMarginTop(v: LynxExposureMargin | undefined) { this.setAttr('exposure-ui-margin-top', v); }
  @Input('exposure-ui-margin-bottom') set exposureUiMarginBottom(v: LynxExposureMargin | undefined) { this.setAttr('exposure-ui-margin-bottom', v); }
  @Input('exposure-ui-margin-left') set exposureUiMarginLeft(v: LynxExposureMargin | undefined) { this.setAttr('exposure-ui-margin-left', v); }
  @Input('exposure-ui-margin-right') set exposureUiMarginRight(v: LynxExposureMargin | undefined) { this.setAttr('exposure-ui-margin-right', v); }
  @Input('enable-exposure-ui-margin') set enableExposureUiMargin(v: boolean | undefined) { this.setAttr('enable-exposure-ui-margin', v); }
  /** Whether a parent's clipping counts: a node clipped by its parent isn't exposed. */
  @Input('enable-exposure-ui-clip') set enableExposureUiClip(v: boolean | undefined) { this.setAttr('enable-exposure-ui-clip', v); }

  // --- touch behavior ---
  @Input('user-interaction-enabled') set userInteractionEnabled(v: boolean | undefined) { this.setAttr('user-interaction-enabled', v); }
  @Input('block-native-event') set blockNativeEvent(v: boolean | undefined) { this.setAttr('block-native-event', v); }
  @Input('event-through') set eventThrough(v: boolean | undefined) { this.setAttr('event-through', v); }
  @Input('ignore-focus') set ignoreFocus(v: boolean | undefined) { this.setAttr('ignore-focus', v); }
  @Input('hit-slop') set hitSlop(v: string | object | undefined) { this.setAttr('hit-slop', v); }
  /**
   * Keep native swipe gestures in one direction from claiming a touch that
   * starts here: `0` horizontal, `1` vertical, `2` none (default). Needs
   * `pan-intercept-scope`. The declarative answer to a drag inside a
   * `<scroll-view>` scrolling the page too, which `catch` events can't stop
   * (docs/32-gestures.md). iOS 3.4+, Android 3.6+ (on Android only `view`,
   * `scroll-view` and `list`, and possibly with `flatten` off).
   */
  @Input('pan-intercept-direction') set panInterceptDirection(v: 0 | 1 | 2 | undefined) { this.setAttr('pan-intercept-direction', v); }
  /**
   * Where `pan-intercept-direction` blocks native swipes: `0` self,
   * `1` ancestors, `2` descendants, `3` self and ancestors, `4` self and
   * descendants, `5` all, `6` none (default).
   */
  @Input('pan-intercept-scope') set panInterceptScope(v: 0 | 1 | 2 | 3 | 4 | 5 | 6 | undefined) { this.setAttr('pan-intercept-scope', v); }
  /**
   * iOS 4.1+: also intercept another platform gesture, matched by its
   * `UIGestureRecognizer` class, its view's class and its view's `tag`. All
   * three must be set, with `pan-intercept-direction`/`-scope`.
   */
  @Input('ios-pan-intercept-gesture-class') set iosPanInterceptGestureClass(v: string | undefined) { this.setAttr('ios-pan-intercept-gesture-class', v); }
  /** iOS 4.1+: see `ios-pan-intercept-gesture-class`. */
  @Input('ios-pan-intercept-view-class') set iosPanInterceptViewClass(v: string | undefined) { this.setAttr('ios-pan-intercept-view-class', v); }
  /** iOS 4.1+: see `ios-pan-intercept-gesture-class`. */
  @Input('ios-pan-intercept-view-tag') set iosPanInterceptViewTag(v: number | undefined) { this.setAttr('ios-pan-intercept-view-tag', v); }

  // --- rendering ---
  @Input() set flatten(v: boolean | undefined) { this.setAttr('flatten', v); }
}

// ---------------------------------------------------------------------------
// Element directives
// ---------------------------------------------------------------------------

/** Typed `<view>`. @public */
@Directive({ selector: 'view', standalone: true })
export class LynxView extends LynxStandardElement {}

/** Typed `<text>`. @public */
@Directive({ selector: 'text', standalone: true, outputs: ['layout', 'selectionchange'] })
export class LynxText extends LynxStandardElement {
  get layout(): EventEmitter<LynxTextLayoutEvent> { return this.event('layout'); }
  get selectionchange(): EventEmitter<LynxEvent<{ start: number; end: number; direction: 'forward' | 'backward' }>> { return this.event('selectionchange'); }

  @Input('text-maxline') set textMaxline(v: string | number | undefined) { this.setAttr('text-maxline', v); }
  /** @deprecated Deprecated by Lynx: shorten the text before rendering it. */
  @Input('text-maxlength') set textMaxlength(v: string | number | undefined) { this.setAttr('text-maxlength', v); }
  /** @deprecated Deprecated by Lynx: use `text-single-line-vertical-align`. */
  @Input('text-vertical-align') set textVerticalAlign(v: 'bottom' | 'center' | 'top' | undefined) { this.setAttr('text-vertical-align', v); }
  @Input('text-single-line-vertical-align') set textSingleLineVerticalAlign(v: 'normal' | 'bottom' | 'center' | 'top' | undefined) { this.setAttr('text-single-line-vertical-align', v); }
  @Input('text-selection') set textSelection(v: boolean | undefined) { this.setAttr('text-selection', v); }
  /** Use your own context menu after selecting text. Needs `text-selection`. */
  @Input('custom-context-menu') set customContextMenu(v: boolean | undefined) { this.setAttr('custom-context-menu', v); }
  /** Handle the selection gestures yourself, with the `setTextSelection` method. */
  @Input('custom-text-selection') set customTextSelection(v: boolean | undefined) { this.setAttr('custom-text-selection', v); }
  /** A 32-bit ARGB number, not a CSS colour. */
  @Input('selection-background-color') set selectionBackgroundColor(v: number | undefined) { this.setAttr('selection-background-color', v); }
  /** A 32-bit ARGB number on native mobile platforms. */
  @Input('selection-handle-color') set selectionHandleColor(v: number | string | undefined) { this.setAttr('selection-handle-color', v); }
  /** Physical pixels on Android, logical units on iOS. */
  @Input('selection-handle-size') set selectionHandleSize(v: number | undefined) { this.setAttr('selection-handle-size', v); }
  @Input('tail-color-convert') set tailColorConvert(v: boolean | undefined) { this.setAttr('tail-color-convert', v); }
  @Input('include-font-padding') set includeFontPadding(v: boolean | undefined) { this.setAttr('include-font-padding', v); }
}

/** Typed `<image>`. @public */
@Directive({ selector: 'image', standalone: true, outputs: ['load', 'error'] })
export class LynxImage extends LynxStandardElement {
  get load(): EventEmitter<LynxImageLoadEvent> { return this.event('load'); }
  get error(): EventEmitter<LynxImageErrorEvent> { return this.event('error'); }

  @Input() set src(v: string | undefined) { this.setAttr('src', v); }
  @Input() set mode(v: 'scaleToFill' | 'aspectFit' | 'aspectFill' | 'center' | undefined) { this.setAttr('mode', v); }
  @Input() set placeholder(v: string | undefined) { this.setAttr('placeholder', v); }
  @Input('blur-radius') set blurRadius(v: string | undefined) { this.setAttr('blur-radius', v); }
  @Input('cap-insets') set capInsets(v: string | undefined) { this.setAttr('cap-insets', v); }
  @Input('loop-count') set loopCount(v: number | undefined) { this.setAttr('loop-count', v); }
  /** @deprecated Deprecated by Lynx. */
  @Input('prefetch-width') set prefetchWidth(v: string | undefined) { this.setAttr('prefetch-width', v); }
  /** @deprecated Deprecated by Lynx. */
  @Input('prefetch-height') set prefetchHeight(v: string | undefined) { this.setAttr('prefetch-height', v); }
  @Input('auto-size') set autoSize(v: boolean | undefined) { this.setAttr('auto-size', v); }
  @Input() set autoplay(v: boolean | undefined) { this.setAttr('autoplay', v); }
  @Input('tint-color') set tintColor(v: string | undefined) { this.setAttr('tint-color', v); }
}

/** Typed `<scroll-view>`. @public */
@Directive({
  selector: 'scroll-view',
  standalone: true,
  outputs: ['scroll', 'scrolltoupper', 'scrolltolower', 'scrollend', 'contentsizechanged'],
})
export class LynxScrollView extends LynxStandardElement {
  get scroll(): EventEmitter<LynxScrollEvent> { return this.event('scroll'); }
  get scrolltoupper(): EventEmitter<LynxScrollEvent> { return this.event('scrolltoupper'); }
  get scrolltolower(): EventEmitter<LynxScrollEvent> { return this.event('scrolltolower'); }
  get scrollend(): EventEmitter<LynxScrollEvent> { return this.event('scrollend'); }
  get contentsizechanged(): EventEmitter<LynxScrollEvent> { return this.event('contentsizechanged'); }

  @Input('scroll-orientation') set scrollOrientation(v: 'vertical' | 'horizontal' | undefined) { this.setAttr('scroll-orientation', v); }
  @Input() set bounces(v: boolean | undefined) { this.setAttr('bounces', v); }
  @Input('enable-scroll') set enableScroll(v: boolean | undefined) { this.setAttr('enable-scroll', v); }
  /** Android 4.2+: the new overflow clipping for scroll-view (default `true`); `false` restores the old one. Experimental. */
  @Input('experimental-android-enable-new-overflow') set experimentalAndroidEnableNewOverflow(v: boolean | undefined) { this.setAttr('experimental-android-enable-new-overflow', v); }
  @Input('scroll-bar-enable') set scrollBarEnable(v: boolean | undefined) { this.setAttr('scroll-bar-enable', v); }
  @Input('upper-threshold') set upperThreshold(v: number | undefined) { this.setAttr('upper-threshold', v); }
  @Input('lower-threshold') set lowerThreshold(v: number | undefined) { this.setAttr('lower-threshold', v); }
  @Input('initial-scroll-offset') set initialScrollOffset(v: number | undefined) { this.setAttr('initial-scroll-offset', v); }
  @Input('initial-scroll-to-index') set initialScrollToIndex(v: number | undefined) { this.setAttr('initial-scroll-to-index', v); }
}

/** Typed `<list>`. @public */
@Directive({
  selector: 'list',
  standalone: true,
  outputs: ['scroll', 'scrolltoupper', 'scrolltolower', 'scrollstatechange', 'snap', 'layoutcomplete'],
})
export class LynxList extends LynxStandardElement {
  get scroll(): EventEmitter<LynxListScrollEvent> { return this.event('scroll'); }
  get scrolltoupper(): EventEmitter<LynxListScrollEvent> { return this.event('scrolltoupper'); }
  get scrolltolower(): EventEmitter<LynxListScrollEvent> { return this.event('scrolltolower'); }
  get scrollstatechange(): EventEmitter<LynxListScrollStateChangeEvent> { return this.event('scrollstatechange'); }
  get snap(): EventEmitter<LynxListSnapEvent> { return this.event('snap'); }
  get layoutcomplete(): EventEmitter<LynxEvent<unknown>> { return this.event('layoutcomplete'); }

  @Input('scroll-orientation') set scrollOrientation(v: 'vertical' | 'horizontal' | undefined) { this.setAttr('scroll-orientation', v); }
  @Input('list-type') set listType(v: 'single' | 'flow' | 'waterfall' | undefined) { this.setAttr('list-type', v); }
  @Input('span-count') set spanCount(v: number | undefined) { this.setAttr('span-count', v); }
  @Input('enable-scroll') set enableScroll(v: boolean | undefined) { this.setAttr('enable-scroll', v); }
  @Input('enable-nested-scroll') set enableNestedScroll(v: boolean | undefined) { this.setAttr('enable-nested-scroll', v); }
  @Input() set sticky(v: boolean | undefined) { this.setAttr('sticky', v); }
  @Input('sticky-offset') set stickyOffset(v: number | undefined) { this.setAttr('sticky-offset', v); }
  /** The item the list scrolls to after its first render. */
  @Input('initial-scroll-index') set initialScrollIndex(v: number | undefined) { this.setAttr('initial-scroll-index', v); }
  /** `scrolltoupper` fires when fewer than this many items remain above. */
  @Input('upper-threshold-item-count') set upperThresholdItemCount(v: number | undefined) { this.setAttr('upper-threshold-item-count', v); }
  /** `scrolltolower` fires when fewer than this many items remain below. */
  @Input('lower-threshold-item-count') set lowerThresholdItemCount(v: number | undefined) { this.setAttr('lower-threshold-item-count', v); }
  @Input('preload-buffer-count') set preloadBufferCount(v: number | undefined) { this.setAttr('preload-buffer-count', v); }
  @Input('scroll-bar-enable') set scrollBarEnable(v: boolean | undefined) { this.setAttr('scroll-bar-enable', v); }
  @Input('need-layout-complete-info') set needLayoutCompleteInfo(v: boolean | undefined) { this.setAttr('need-layout-complete-info', v); }
  /** Adds `attachedCells` to `scroll`, `scrolltoupper` and `scrolltolower`, on every platform. Off by default. */
  @Input('need-visible-item-info') set needVisibleItemInfo(v: boolean | undefined) { this.setAttr('need-visible-item-info', v); }
}

/** Typed `<list-item>`. @public */
@Directive({ selector: 'list-item', standalone: true })
export class LynxListItem extends LynxStandardElement {
  @Input('item-key') set itemKey(v: string | undefined) { this.setAttr('item-key', v); }
  @Input('sticky-top') set stickyTop(v: boolean | undefined) { this.setAttr('sticky-top', v); }
  @Input('sticky-bottom') set stickyBottom(v: boolean | undefined) { this.setAttr('sticky-bottom', v); }
  @Input('full-span') set fullSpan(v: boolean | undefined) { this.setAttr('full-span', v); }
  @Input('estimated-main-axis-size-px') set estimatedMainAxisSizePx(v: number | undefined) { this.setAttr('estimated-main-axis-size-px', v); }
  @Input() set recyclable(v: boolean | undefined) { this.setAttr('recyclable', v); }
}

const TEXT_FIELD_OUTPUTS = ['input', 'confirm', 'focus', 'blur', 'selection'];

/** Shared surface of `<input>` / `<textarea>`. */
@Directive({ outputs: TEXT_FIELD_OUTPUTS })
export abstract class LynxTextFieldBase extends LynxStandardElement {
  get input(): EventEmitter<LynxInputEvent> { return this.event('input'); }
  get confirm(): EventEmitter<LynxConfirmEvent> { return this.event('confirm'); }
  get focus(): EventEmitter<LynxFocusEvent> { return this.event('focus'); }
  get blur(): EventEmitter<LynxFocusEvent> { return this.event('blur'); }
  get selection(): EventEmitter<LynxSelectionEvent> { return this.event('selection'); }

  @Input() set value(v: string | undefined) { this.setAttr('value', v); }
  /** The initial content. Only applies on the first render, and doesn't fire `input`. */
  @Input('default-value') set defaultValue(v: string | undefined) { this.setAttr('default-value', v); }
  @Input() set placeholder(v: string | undefined) { this.setAttr('placeholder', v); }
  @Input('confirm-type') set confirmType(v: 'send' | 'search' | 'go' | 'done' | 'next' | undefined) { this.setAttr('confirm-type', v); }
  @Input() set maxlength(v: number | undefined) { this.setAttr('maxlength', v); }
  @Input() set readonly(v: boolean | undefined) { this.setAttr('readonly', v); }
  @Input() set disabled(v: boolean | undefined) { this.setAttr('disabled', v); }
  @Input('show-soft-input-on-focus') set showSoftInputOnFocus(v: boolean | undefined) { this.setAttr('show-soft-input-on-focus', v); }
  @Input('input-filter') set inputFilter(v: string | undefined) { this.setAttr('input-filter', v); }
}

/** Typed `<input>`. @public */
@Directive({ selector: 'input', standalone: true })
export class LynxInput extends LynxTextFieldBase {
  @Input() set type(v: 'text' | 'number' | 'digit' | 'password' | 'tel' | 'email' | undefined) { this.setAttr('type', v); }
}

/** Typed `<textarea>`. @public */
@Directive({ selector: 'textarea', standalone: true })
export class LynxTextarea extends LynxTextFieldBase {
  @Input() set maxlines(v: number | undefined) { this.setAttr('maxlines', v); }
  @Input('line-spacing') set lineSpacing(v: string | number | undefined) { this.setAttr('line-spacing', v); }
  @Input() set bounces(v: boolean | undefined) { this.setAttr('bounces', v); }
  @Input('enable-scroll-bar') set enableScrollBar(v: boolean | undefined) { this.setAttr('enable-scroll-bar', v); }
}

/**
 * Typed `<video>` — https://lynxjs.org/next/api/elements/built-in/video.html
 *
 * **Experimental in Lynx, engine 4.1+.** Measured on Explorer 4.1 (iOS simulator
 * and Android emulator). It has no `autoplay`: start it with the `play` method,
 * through `invoke`. It fires `paused`, not HTML's `pause`.
 *
 * @public
 */
@Directive({
  selector: 'video',
  standalone: true,
  outputs: ['firstframe', 'playing', 'paused', 'stopped', 'timeupdate', 'ended', 'looped', 'error', 'buffering'],
})
export class LynxVideo extends LynxStandardElement {
  get firstframe(): EventEmitter<LynxVideoFirstFrameEvent> { return this.event('firstframe'); }
  get playing(): EventEmitter<LynxEvent<unknown>> { return this.event('playing'); }
  get paused(): EventEmitter<LynxEvent<unknown>> { return this.event('paused'); }
  get stopped(): EventEmitter<LynxEvent<unknown>> { return this.event('stopped'); }
  get timeupdate(): EventEmitter<LynxVideoTimeUpdateEvent> { return this.event('timeupdate'); }
  get ended(): EventEmitter<LynxEvent<unknown>> { return this.event('ended'); }
  get looped(): EventEmitter<LynxEvent<unknown>> { return this.event('looped'); }
  get error(): EventEmitter<LynxVideoErrorEvent> { return this.event('error'); }
  get buffering(): EventEmitter<LynxEvent<unknown>> { return this.event('buffering'); }

  /** Video source URL — online network URLs only (no local/bundled assets). */
  @Input() set src(v: string | undefined) { this.setAttr('src', v); }
  @Input() set loop(v: boolean | undefined) { this.setAttr('loop', v); }
  /** 0 to 1. */
  @Input() set volume(v: number | undefined) { this.setAttr('volume', v); }
  @Input() set muted(v: boolean | undefined) { this.setAttr('muted', v); }
  /** 0.1 to 2.0. */
  @Input() set speed(v: number | undefined) { this.setAttr('speed', v); }
  @Input('object-fit') set objectFit(v: 'contain' | 'cover' | 'fill' | undefined) { this.setAttr('object-fit', v); }
  /** UIMethod (`play`/`pause`/`stop`/`seek`) execution mode. */
  @Input() set mode(v: 'queue' | 'direct' | 'latest' | undefined) { this.setAttr('mode', v); }
  /** Minimum interval between `timeupdate` dispatches, in seconds. */
  @Input('timeupdate-interval') set timeupdateInterval(v: number | undefined) { this.setAttr('timeupdate-interval', v); }
}

/**
 * Typed `<svg>` — https://lynxjs.org/next/api/elements/built-in/svg.html
 *
 * Renders as a single native view from `src`/`content` rather than one node
 * per shape, offloading parsing off the main thread. Confirmed working in the
 * web preview (`@lynx-js/web-core` backs it with a real `x-svg` custom
 * element) — unlike most of the other directives added alongside this one,
 * see their doc comments for why they differ.
 *
 * @public
 */
@Directive({ selector: 'svg', standalone: true, outputs: ['load'] })
export class LynxSvg extends LynxStandardElement {
  get load(): EventEmitter<LynxEvent<unknown>> { return this.event('load'); }

  /** SVG resource URL. */
  @Input() set src(v: string | undefined) { this.setAttr('src', v); }
  /** Inline SVG XML content. */
  @Input() set content(v: string | undefined) { this.setAttr('content', v); }
  /** Default color used to resolve `currentColor` in the SVG content; does not override explicit `fill`/`stroke`. */
  @Input('current-color') set currentColor(v: string | undefined) { this.setAttr('current-color', v); }
}

/**
 * Typed `<frame>` — Lynx's equivalent of an `<iframe>`, embedding a nested
 * Lynx page. Confirmed working in the web preview: a `<frame src="...">`
 * really does mount a nested `<lynx-view>` that loads and runs the target
 * bundle (verified by pointing one at its own bundle and observing the
 * resulting recursive embedding).
 *
 * @public
 */
@Directive({ selector: 'frame', standalone: true, outputs: ['load', 'loadmetrics'] })
export class LynxFrame extends LynxStandardElement {
  get load(): EventEmitter<LynxFrameLoadEvent> { return this.event('load'); }
  get loadmetrics(): EventEmitter<LynxFrameLoadMetricsEvent> { return this.event('loadmetrics'); }

  /** Loading path for the embedded Lynx page. */
  @Input() set src(v: string | undefined) { this.setAttr('src', v); }
  /** Init data passed to the embedded page. */
  @Input() set data(v: Record<string, unknown> | undefined) { this.setAttr('data', v); }
  /** `globalProps` passed to the embedded page (read via `lynx.__globalProps`). */
  @Input('global-props') set globalProps(v: Record<string, unknown> | undefined) { this.setAttr('global-props', v); }
  @Input('auto-width') set autoWidth(v: boolean | undefined) { this.setAttr('auto-width', v); }
  @Input('auto-height') set autoHeight(v: boolean | undefined) { this.setAttr('auto-height', v); }
  @Input('preset-width') set presetWidth(v: string | undefined) { this.setAttr('preset-width', v); }
  @Input('preset-height') set presetHeight(v: string | undefined) { this.setAttr('preset-height', v); }
  @Input('enable-multi-async-thread') set enableMultiAsyncThread(v: boolean | undefined) { this.setAttr('enable-multi-async-thread', v); }
}

/**
 * The following directives (`<overlay>`, `<refresh>`/`<refresh-header>`,
 * `<title-bar-view>`, `<viewpager>`/`<viewpager-item>`,
 * `<scroll-coordinator>` and its 4 children, `<blur-view>`, `<webview>`) are
 * all registered in `KNOWN_LYNX_TAGS` (`main-thread/src/ops-apply.ts`) so
 * they route to a real, typed `__CreateElement(tag, …)` instead of falling back
 * to a `<view>`.
 *
 * **On web-core 0.26.1 most of these render in the web preview.** Earlier
 * web-core created them as bare, inert elements. 0.26.1 maps `webview`,
 * `blur-view`, `viewpager`, `refresh` and `scroll-coordinator` (and their
 * children) onto `@lynx-js/web-elements`' custom elements. Measured in
 * `examples/primitives`:
 *
 * - `<webview>` loads its page in an iframe and fires `load`.
 * - `<blur-view>` applies a backdrop blur.
 * - `<viewpager>` pages, fires `change`/`offsetchange`, and its methods
 *   work through `invoke`.
 * - `<refresh>` runs `autoStartRefresh()` → `startrefresh`.
 * - `<scroll-coordinator>` lays out its header and slot.
 *
 * - `<overlay>` opens as a modal `<dialog>` (`x-overlay-ng`) and fires
 *   `showoverlay`/`dismissoverlay`.
 *
 * `<title-bar-view>` (Clay desktop only) isn't measured.
 *
 * On a device each needs an engine new enough to have it (Lynx's compat
 * data): `<overlay>` 3.5, `<refresh>` 3.8, `<viewpager>` and
 * `<scroll-coordinator>` 3.9, `<blur-view>` and `<webview>` 4.0 (and
 * `<video>`, typed above, 4.1). The "ui not found" errors this repo once
 * blamed on Lynx Explorer not registering them came from an Explorer whose
 * engine was 3.7. Wire-protocol behavior is verified headlessly
 * (`verify:elements`).
 */

/**
 * Typed `<overlay>` — a detached rendering layer for dialogs/modals. Engine 3.5+; renders in the web preview, see the note above.
 *
 * Follow Lynx's documented shape: the `<overlay>` itself `position: fixed`,
 * its one child a full-size backdrop (`width/height: 100%`, `z-index: 0`)
 * with the dialog inside. On Android a `position: fixed` child instead fell
 * outside the overlay's hit-testing: every touch landed on the overlay
 * itself, so nothing in it could be tapped (Explorer 4.1). Bind
 * `(requestclose)` for Android's back key. See `examples/primitives`.
 *
 * @public
 */
@Directive({
  selector: 'overlay',
  standalone: true,
  outputs: ['showoverlay', 'dismissoverlay', 'requestclose', 'overlaytouch', 'error'],
})
export class LynxOverlay extends LynxStandardElement {
  get showoverlay(): EventEmitter<LynxEvent<unknown>> { return this.event('showoverlay'); }
  get dismissoverlay(): EventEmitter<LynxEvent<unknown>> { return this.event('dismissoverlay'); }
  get requestclose(): EventEmitter<LynxEvent<unknown>> { return this.event('requestclose'); }
  get overlaytouch(): EventEmitter<LynxOverlayTouchEvent> { return this.event('overlaytouch'); }
  get error(): EventEmitter<LynxOverlayErrorEvent> { return this.event('error'); }

  /**
   * Shown or hidden. `false` takes a different op per platform, so it's
   * normalised here. Android only hides on an explicit `false`: removing the
   * attribute leaves the overlay showing (Explorer 4.1). web-core's
   * `x-overlay-ng` treats any present `visible` attribute as shown, the
   * string `"false"` included, so there `false` removes it instead.
   */
  @Input() set visible(v: boolean | undefined) {
    this.setAttr('visible', v === false && isWebPlatform() ? undefined : v);
  }
  /**
   * Layering depth 1-4; cannot change while `visible`. On Android a level
   * that lands on a showing overlay is ignored with LynxError 2298 ("Overlay
   * set Level error!"), so create the overlay hidden and show it afterwards.
   */
  @Input() set level(v: 1 | 2 | 3 | 4 | undefined) { this.setAttr('level', v); }
  /** iOS only: `'window' | 'top' | 'page' | <custom client class name>`. */
  @Input() set mode(v: string | undefined) { this.setAttr('mode', v); }
  @Input('ios-enable-swipe-back') set iosEnableSwipeBack(v: boolean | undefined) { this.setAttr('ios-enable-swipe-back', v); }
  /** Android 4.1+: the navigation bar's background and contrasting icons while the overlay shows; `auto` (default) keeps the Activity's. */
  @Input('android-navigation-bar-style') set androidNavigationBarStyle(v: 'auto' | 'light' | 'dark' | 'transparent' | undefined) { this.setAttr('android-navigation-bar-style', v); }
}

/** Typed `<refresh>` — pull-to-refresh. Engine 3.8+; renders in the web preview, see the note above. @public */
@Directive({
  selector: 'refresh',
  standalone: true,
  outputs: ['startrefresh', 'headeroffset', 'refreshstatechange'],
})
export class LynxRefresh extends LynxStandardElement {
  get startrefresh(): EventEmitter<LynxRefreshStartEvent> { return this.event('startrefresh'); }
  get headeroffset(): EventEmitter<LynxRefreshHeaderOffsetEvent> { return this.event('headeroffset'); }
  get refreshstatechange(): EventEmitter<LynxRefreshStateChangeEvent> { return this.event('refreshstatechange'); }

  @Input('enable-refresh') set enableRefresh(v: boolean | undefined) { this.setAttr('enable-refresh', v); }
}

/** Typed `<refresh-header>` — the pull-to-refresh header, child of `<refresh>`. @public */
@Directive({ selector: 'refresh-header', standalone: true })
export class LynxRefreshHeader extends LynxStandardElement {}

/**
 * Typed `<title-bar-view>` — customizes the draggable window-chrome region. Clay Windows/macOS only, no web/mobile support at all.
 *
 * @experimental
 */
@Directive({ selector: 'title-bar-view', standalone: true })
export class LynxTitleBarView extends LynxStandardElement {
  @Input() set moveable(v: boolean | undefined) { this.setAttr('moveable', v); }
}

/** Typed `<viewpager>` — horizontally swipeable paging. Engine 3.9+; renders in the web preview, see the note above. @public */
@Directive({
  selector: 'viewpager',
  standalone: true,
  outputs: ['change', 'willchange', 'offsetchange'],
})
export class LynxViewpager extends LynxStandardElement {
  get change(): EventEmitter<LynxViewPagerChangeEvent> { return this.event('change'); }
  get willchange(): EventEmitter<LynxViewPagerChangeEvent> { return this.event('willchange'); }
  get offsetchange(): EventEmitter<LynxViewPagerOffsetChangeEvent> { return this.event('offsetchange'); }

  @Input('initial-select-index') set initialSelectIndex(v: number | undefined) { this.setAttr('initial-select-index', v); }
  @Input('enable-scroll') set enableScroll(v: boolean | undefined) { this.setAttr('enable-scroll', v); }
  @Input() set bounces(v: boolean | undefined) { this.setAttr('bounces', v); }
  @Input('keep-item-view') set keepItemView(v: boolean | undefined) { this.setAttr('keep-item-view', v); }
  @Input('ios-gesture-offset') set iosGestureOffset(v: number | undefined) { this.setAttr('ios-gesture-offset', v); }
  @Input('ios-gesture-direction') set iosGestureDirection(v: boolean | undefined) { this.setAttr('ios-gesture-direction', v); }
  @Input('ios-recognized-view-tag') set iosRecognizedViewTag(v: number | undefined) { this.setAttr('ios-recognized-view-tag', v); }
  @Input('ios-recognized-gesture-class') set iosRecognizedGestureClass(v: string | undefined) { this.setAttr('ios-recognized-gesture-class', v); }
  @Input('android-always-overscroll') set androidAlwaysOverscroll(v: boolean | undefined) { this.setAttr('android-always-overscroll', v); }
  @Input('android-force-can-scroll') set androidForceCanScroll(v: boolean | undefined) { this.setAttr('android-force-can-scroll', v); }
}

/** Typed `<viewpager-item>` — direct child of `<viewpager>`. @public */
@Directive({ selector: 'viewpager-item', standalone: true })
export class LynxViewpagerItem extends LynxStandardElement {}

/** Typed `<scroll-coordinator>` — nested scroll coordination for sticky-header layouts. Engine 3.9+; renders in the web preview, see the note above. @public */
@Directive({ selector: 'scroll-coordinator', standalone: true, outputs: ['offset'] })
export class LynxScrollCoordinator extends LynxStandardElement {
  get offset(): EventEmitter<LynxScrollCoordinatorOffsetEvent> { return this.event('offset'); }

  @Input('ios-scrolls-to-top') set iosScrollsToTop(v: boolean | undefined) { this.setAttr('ios-scrolls-to-top', v); }
  @Input('header-over-slot') set headerOverSlot(v: boolean | undefined) { this.setAttr('header-over-slot', v); }
  @Input('enable-scroll') set enableScroll(v: boolean | undefined) { this.setAttr('enable-scroll', v); }
  @Input() set bounces(v: boolean | undefined) { this.setAttr('bounces', v); }
  @Input('enable-scroll-bar') set enableScrollBar(v: boolean | undefined) { this.setAttr('enable-scroll-bar', v); }
  @Input('android-nested-scroll-as-child') set androidNestedScrollAsChild(v: boolean | undefined) { this.setAttr('android-nested-scroll-as-child', v); }
  /** Android 4.2+: adjust the collapse when the active slot is empty or too short to scroll (default `false`). */
  @Input('android-adapt-to-empty-slot') set androidAdaptToEmptySlot(v: boolean | undefined) { this.setAttr('android-adapt-to-empty-slot', v); }
  @Input('ios-force-scroll-detach') set iosForceScrollDetach(v: boolean | undefined) { this.setAttr('ios-force-scroll-detach', v); }
  @Input() set granularity(v: number | undefined) { this.setAttr('granularity', v); }
  @Input('refresh-mode') set refreshMode(v: 'none' | 'page' | 'fold' | undefined) { this.setAttr('refresh-mode', v); }
}

/** Typed `<scroll-coordinator-header>` — fixed header, child of `<scroll-coordinator>`. @public */
@Directive({ selector: 'scroll-coordinator-header', standalone: true })
export class LynxScrollCoordinatorHeader extends LynxStandardElement {}

/** Typed `<scroll-coordinator-slot>` — scrollable content, child of `<scroll-coordinator>` (typically wraps a `<list>` or `<viewpager>`). @public */
@Directive({ selector: 'scroll-coordinator-slot', standalone: true })
export class LynxScrollCoordinatorSlot extends LynxStandardElement {}

/** Typed `<scroll-coordinator-slot-drag>` — drag-responsive region inside a slot. @public */
@Directive({ selector: 'scroll-coordinator-slot-drag', standalone: true })
export class LynxScrollCoordinatorSlotDrag extends LynxStandardElement {
  @Input('enable-drag') set enableDrag(v: boolean | undefined) { this.setAttr('enable-drag', v); }
}

/** Typed `<scroll-coordinator-toolbar>` — optional toolbar, child of `<scroll-coordinator>`. @public */
@Directive({ selector: 'scroll-coordinator-toolbar', standalone: true })
export class LynxScrollCoordinatorToolbar extends LynxStandardElement {}

/**
 * Typed `<blur-view>` — backdrop blur, like CSS `backdrop-filter: blur`. Engine 4.0+; renders in the web preview, see the note above.
 *
 * On Android it blurs a snapshot of its parent's native view, so give the
 * parent one with `[flatten]="false"` (or point `android-capture-target` at
 * an element that has one). Under a flattened parent, Lynx's default for a
 * plain `<view>`, Explorer 4.1 only tinted what was behind it.
 *
 * @public
 */
@Directive({ selector: 'blur-view', standalone: true })
export class LynxBlurView extends LynxStandardElement {
  @Input('blur-radius') set blurRadius(v: string | undefined) { this.setAttr('blur-radius', v); }
  @Input('blur-sampling') set blurSampling(v: number | undefined) { this.setAttr('blur-sampling', v); }
  @Input('enable-auto-blur') set enableAutoBlur(v: boolean | undefined) { this.setAttr('enable-auto-blur', v); }
  @Input('android-capture-target') set androidCaptureTarget(v: string | undefined) { this.setAttr('android-capture-target', v); }
  @Input('blur-effect') set blurEffect(v: 'light' | 'extra-light' | 'dark' | 'glass' | 'glass-container' | undefined) { this.setAttr('blur-effect', v); }
  @Input() set spacing(v: number | undefined) { this.setAttr('spacing', v); }
  @Input('glass-interactive') set glassInteractive(v: boolean | undefined) { this.setAttr('glass-interactive', v); }
  @Input('ios-user-interface-style') set iosUserInterfaceStyle(v: 'dark' | 'light' | undefined) { this.setAttr('ios-user-interface-style', v); }
  @Input('glass-tint-color') set glassTintColor(v: string | undefined) { this.setAttr('glass-tint-color', v); }
  @Input('glass-style') set glassStyle(v: 'regular' | 'clear' | undefined) { this.setAttr('glass-style', v); }
}

/** Typed `<webview>` — embeds a web page. Engine 4.0+; renders in the web preview, see the note above. @public */
@Directive({
  selector: 'webview',
  standalone: true,
  outputs: ['load', 'error', 'message', 'openwindow', 'locationchange'],
})
export class LynxWebview extends LynxStandardElement {
  get load(): EventEmitter<LynxEvent<unknown>> { return this.event('load'); }
  get error(): EventEmitter<LynxWebviewErrorEvent> { return this.event('error'); }
  get message(): EventEmitter<LynxWebviewMessageEvent> { return this.event('message'); }
  get openwindow(): EventEmitter<LynxWebviewUrlEvent> { return this.event('openwindow'); }
  get locationchange(): EventEmitter<LynxWebviewUrlEvent> { return this.event('locationchange'); }

  @Input() set src(v: string | undefined) { this.setAttr('src', v); }
  /** Lower priority than `src`. */
  @Input() set html(v: string | undefined) { this.setAttr('html', v); }
  @Input() set bounces(v: boolean | undefined) { this.setAttr('bounces', v); }
  @Input('scroll-bar-enable') set scrollBarEnable(v: boolean | undefined) { this.setAttr('scroll-bar-enable', v); }
  @Input('webview-type') set webviewType(v: string | undefined) { this.setAttr('webview-type', v); }
  @Input('enable-debug') set enableDebug(v: boolean | undefined) { this.setAttr('enable-debug', v); }
}

/** `<markdown>`'s `animationStep` payload. @public */
export interface LynxMarkdownAnimationStepEvent extends LynxEvent<{ animationStep: number; maxAnimationStep: number }> {}
/** `<markdown>`'s `overflow` payload: how the text was cut. @public */
export interface LynxMarkdownOverflowEvent extends LynxEvent<{ type: 'ellipsis' | 'clip' }> {}
/** `<markdown>`'s `link` payload: a tapped link. @public */
export interface LynxMarkdownLinkEvent extends LynxEvent<{ url: string; content: string }> {}
/** `<markdown>`'s `imageTap` payload. @public */
export interface LynxMarkdownImageTapEvent extends LynxEvent<{ url: string }> {}

/**
 * Typed `<markdown>`: renders Markdown natively, with optional typewriter
 * animation for streamed text. Attributes and events from `@lynx-js/types`.
 * `asLynxElement<'markdown'>(el).invoke(...)` types its methods.
 * @public
 */
@Directive({
  selector: 'markdown',
  standalone: true,
  outputs: [
    'drawStart',
    'drawEnd',
    'animationStep',
    'overflow',
    'link',
    'selectionchange',
    'imageTap',
    'textClick',
    'parseEnd',
  ],
})
export class LynxMarkdown extends LynxStandardElement {
  get drawStart(): EventEmitter<LynxEvent<unknown>> { return this.event('drawStart'); }
  get drawEnd(): EventEmitter<LynxEvent<unknown>> { return this.event('drawEnd'); }
  get animationStep(): EventEmitter<LynxMarkdownAnimationStepEvent> { return this.event('animationStep'); }
  get overflow(): EventEmitter<LynxMarkdownOverflowEvent> { return this.event('overflow'); }
  get link(): EventEmitter<LynxMarkdownLinkEvent> { return this.event('link'); }
  get selectionchange(): EventEmitter<LynxEvent<{ start: number; end: number; direction: 'forward' | 'backward' }>> { return this.event('selectionchange'); }
  get imageTap(): EventEmitter<LynxMarkdownImageTapEvent> { return this.event('imageTap'); }
  get textClick(): EventEmitter<LynxEvent<{ id: string }>> { return this.event('textClick'); }
  get parseEnd(): EventEmitter<LynxEvent<{ id: string }>> { return this.event('parseEnd'); }

  /** The Markdown source. */
  @Input() set content(v: string | undefined) { this.setAttr('content', v); }
  /** Per-element styles (headings, code, links, …), as an object. */
  @Input('markdown-style') set markdownStyle(v: object | undefined) { this.setAttr('markdown-style', v); }
  @Input('markdown-effect') set markdownEffect(v: object | undefined) { this.setAttr('markdown-effect', v); }
  @Input('markdown-max-height') set markdownMaxHeight(v: number | undefined) { this.setAttr('markdown-max-height', v); }
  @Input('content-id') set contentId(v: string | undefined) { this.setAttr('content-id', v); }
  @Input('content-range') set contentRange(v: number[] | undefined) { this.setAttr('content-range', v); }
  /** Set when a streamed `content` has arrived in full. */
  @Input('content-complete') set contentComplete(v: boolean | undefined) { this.setAttr('content-complete', v); }
  @Input('animation-type') set animationType(v: 'none' | 'typewriter' | 'line-expand' | undefined) { this.setAttr('animation-type', v); }
  @Input('animation-velocity') set animationVelocity(v: number | undefined) { this.setAttr('animation-velocity', v); }
  @Input('animation-frame-rate') set animationFrameRate(v: number | undefined) { this.setAttr('animation-frame-rate', v); }
  @Input('initial-animation-step') set initialAnimationStep(v: number | undefined) { this.setAttr('initial-animation-step', v); }
  @Input('typewriter-dynamic-height') set typewriterDynamicHeight(v: boolean | undefined) { this.setAttr('typewriter-dynamic-height', v); }
  @Input('typewriter-height-transition-duration') set typewriterHeightTransitionDuration(v: number | undefined) { this.setAttr('typewriter-height-transition-duration', v); }
  @Input('typewriter-height-transition-prefetch') set typewriterHeightTransitionPrefetch(v: boolean | undefined) { this.setAttr('typewriter-height-transition-prefetch', v); }
  @Input('text-maxline') set textMaxline(v: number | undefined) { this.setAttr('text-maxline', v); }
  @Input('text-selection') set textSelection(v: boolean | undefined) { this.setAttr('text-selection', v); }
  @Input('enable-selection') set enableSelection(v: boolean | undefined) { this.setAttr('enable-selection', v); }
  /** A 32-bit ARGB number, not a CSS colour. */
  @Input('selection-background-color') set selectionBackgroundColor(v: number | undefined) { this.setAttr('selection-background-color', v); }
  /** A 32-bit ARGB number. */
  @Input('selection-handle-color') set selectionHandleColor(v: number | undefined) { this.setAttr('selection-handle-color', v); }
  @Input('selection-handle-size') set selectionHandleSize(v: number | undefined) { this.setAttr('selection-handle-size', v); }
  @Input('allow-break-around-punctuation') set allowBreakAroundPunctuation(v: boolean | undefined) { this.setAttr('allow-break-around-punctuation', v); }
  @Input('enable-break-around-punctuation') set enableBreakAroundPunctuation(v: boolean | undefined) { this.setAttr('enable-break-around-punctuation', v); }
  @Input('exposure-tags') set exposureTags(v: string[] | undefined) { this.setAttr('exposure-tags', v); }
  @Input('text-mark-attachments') set textMarkAttachments(v: unknown[] | undefined) { this.setAttr('text-mark-attachments', v); }
}

/** Typed `<filter-image>`: an image with a blur or drop shadow applied natively. @public */
@Directive({ selector: 'filter-image', standalone: true, outputs: ['load', 'error'] })
export class LynxFilterImage extends LynxStandardElement {
  get load(): EventEmitter<LynxImageLoadEvent> { return this.event('load'); }
  get error(): EventEmitter<LynxImageErrorEvent> { return this.event('error'); }

  @Input() set src(v: string | undefined) { this.setAttr('src', v); }
  @Input() set mode(v: 'scaleToFill' | 'aspectFit' | 'aspectFill' | 'center' | undefined) { this.setAttr('mode', v); }
  @Input('blur-radius') set blurRadius(v: string | undefined) { this.setAttr('blur-radius', v); }
  /** CSS `drop-shadow()` arguments, e.g. `'0 4px 8px rgba(0,0,0,0.3)'`. */
  @Input('drop-shadow') set dropShadow(v: string | undefined) { this.setAttr('drop-shadow', v); }
}

/** Typed `<inline-image>`: an image inside a `<text>`, with `<image>`'s attributes. @public */
@Directive({ selector: 'inline-image', standalone: true, outputs: ['load', 'error'] })
export class LynxInlineImage extends LynxImage {
  /** Moves the image off the text baseline, e.g. `'-2px'`. */
  @Input('custom-baseline-shift') set customBaselineShift(v: string | undefined) { this.setAttr('custom-baseline-shift', v); }
}

/** Typed `<inline-text>`: styled text inside a `<text>`, with `<text>`'s attributes. @public */
@Directive({ selector: 'inline-text', standalone: true, outputs: ['layout', 'selectionchange'] })
export class LynxInlineText extends LynxText {}

/** Typed `<inline-truncation>`: what a truncated `<text>` shows in place of its tail. @public */
@Directive({ selector: 'inline-truncation', standalone: true })
export class LynxInlineTruncation extends LynxStandardElement {}

/** Typed `<list-row>`. @public */
@Directive({ selector: 'list-row', standalone: true })
export class LynxListRow extends LynxStandardElement {}

/**
 * All typed element directives — add to a component's `imports` and drop
 * `NO_ERRORS_SCHEMA`:
 *
 * ```ts
 * import { LYNX_ELEMENTS } from 'ng-lynx/elements';
 *
 * @Component({
 *   standalone: true,
 *   imports: [LYNX_ELEMENTS],
 *   template: `<view (tap)="onTap($event)">…</view>`, // $event: LynxTouchEvent
 * })
 * ```
 * @public
 */
export const LYNX_ELEMENTS = [
  LynxView,
  LynxText,
  LynxImage,
  LynxScrollView,
  LynxList,
  LynxListItem,
  LynxInput,
  LynxTextarea,
  LynxVideo,
  LynxSvg,
  LynxFrame,
  LynxOverlay,
  LynxRefresh,
  LynxRefreshHeader,
  LynxTitleBarView,
  LynxViewpager,
  LynxViewpagerItem,
  LynxScrollCoordinator,
  LynxScrollCoordinatorHeader,
  LynxScrollCoordinatorSlot,
  LynxScrollCoordinatorSlotDrag,
  LynxScrollCoordinatorToolbar,
  LynxBlurView,
  LynxWebview,
  LynxMarkdown,
  LynxFilterImage,
  LynxInlineImage,
  LynxInlineText,
  LynxInlineTruncation,
  LynxListRow,
] as const;
