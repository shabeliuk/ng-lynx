/**
 * `MainThreadElement`: a native element, wrapped for worklets.
 *
 * One class serves every place a worklet meets an element: `ctx.element`, a
 * main-thread ref's `current`, `event.target` and `event.currentTarget`,
 * `mainThreadLynx.querySelector` and the main-thread `lynx.querySelector`. It
 * makes the same element-PAPI calls as `MainThread.Element` in `@lynx-js/react`'s
 * worklet runtime, plus `setStyle`. See docs/42-worklet-runtime.md#element-handles.
 */
import { PAGE_ROOT_ID } from 'ng-lynx/internal/ops';

import { elements } from '../element-registry.js';

/** Returned by {@link MainThreadElement.animate}. @public */
export interface MainThreadAnimation {
  cancel(): void;
  pause(): void;
  play(): void;
}

/** Options for {@link MainThreadElement.animate}: a duration in ms, or these. @public */
export interface MainThreadAnimationOptions {
  name?: string;
  duration?: number;
  delay?: number;
  iterations?: number;
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  easing?: string;
  fill?: 'none' | 'forwards' | 'backwards' | 'both';
}

/**
 * An element on the Main Thread: Lynx's `MainThread.Element`
 * (https://lynxjs.org/api/lynx-api/main-thread/main-thread-element), plus
 * {@link MainThreadElement.setStyle}. Used by `ctx`, by refs, by event targets and
 * by `mainThreadLynx`. Reads and writes are synchronous; the commit that follows a
 * write happens once, a microtask later, for every element written in between.
 *
 * An inline style set here lasts until a `[style.x]` binding on the same element
 * next changes, because the Background Thread writes its whole inline style.
 *
 * @public
 */
export interface MainThreadElement {
  /** Replace the element's whole inline style with a CSS string. */
  setStyle(css: string): void;
  /** Set one inline style property, keeping the others. */
  setStyleProperty(name: string, value: string): void;
  /** Set several inline style properties, keeping the others. */
  setStyleProperties(styles: Record<string, string>): void;
  /** Set an attribute on the element (synchronous, on the MT). */
  setAttribute(key: string, value: unknown): void;
  /** Read an attribute, `undefined` if the element doesn't have it. */
  getAttribute(name: string): unknown;
  getAttributeNames(): string[];
  /** The first descendant matching a CSS selector. Needs `enableCSSSelector`. */
  querySelector(selector: string): MainThreadElement | null;
  /** Every descendant matching a CSS selector. Needs `enableCSSSelector`. */
  querySelectorAll(selector: string): MainThreadElement[];
  /** Call a UI method, such as `scrollTo` on a `<scroll-view>`. Rejects if it fails. */
  invoke(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Run a native animation. `options` is a duration in ms, or {@link MainThreadAnimationOptions}. */
  animate(keyframes: Record<string, number | string>[], options?: number | MainThreadAnimationOptions): MainThreadAnimation;
  /**
   * Read a single resolved (computed) style value off the element,
   * synchronously on the MT — e.g. `getComputedStyleProperty('opacity')`. The
   * read counterpart to `setStyle`, handy for a worklet that animates *from*
   * the current value. Returns the value as a string (as the engine reports
   * it). Needs Lynx 3.5.
   */
  getComputedStyleProperty(name: string): string;
}

/**
 * Commit pending element changes once, a microtask from now, however many writes
 * come first. Module-wide, since `__FlushElementTree` commits every pending change
 * whichever element it's given.
 *
 * Deferred, not just batched: a worklet runs inside a call from the engine, and on
 * the web preview that call is inside its WASM context. Flushing from in there
 * re-enters it, and wasm-bindgen panics ("recursive use of an object detected").
 * A microtask runs once that call has returned. `@lynx-js/react`'s runtime defers
 * the same way.
 */
let flushScheduled = false;
export function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  void Promise.resolve().then(() => {
    flushScheduled = false;
    __FlushElementTree();
  });
}

const ANIMATION_START = 0;
const ANIMATION_PLAY = 1;
const ANIMATION_PAUSE = 2;
const ANIMATION_CANCEL = 3;
let nextAnimationId = 0;

/**
 * The implementation of {@link MainThreadElement}.
 *
 * The native element is kept in a property that isn't enumerable, so printing a
 * handle or sending it to the Background Thread (`JSON.stringify`) never reaches
 * the native object. Lynx 2.15 and older crashed when one was.
 */
export class MainThreadElementImpl implements MainThreadElement {
  /** The native element. Set in the constructor, not enumerable. */
  private declare readonly _el: LynxElement;

  constructor(el: LynxElement) {
    Object.defineProperty(this, '_el', { value: el });
  }

  setStyle(css: string): void {
    __SetInlineStyles(this._el, css);
    scheduleFlush();
  }

  setStyleProperty(name: string, value: string): void {
    __AddInlineStyle(this._el, name, value);
    scheduleFlush();
  }

  setStyleProperties(styles: Record<string, string>): void {
    for (const name of Object.keys(styles)) __AddInlineStyle(this._el, name, styles[name]!);
    scheduleFlush();
  }

  setAttribute(key: string, value: unknown): void {
    __SetAttribute(this._el, key, value);
    scheduleFlush();
  }

  getAttribute(name: string): unknown {
    return __GetAttributeByName(this._el, name);
  }

  getAttributeNames(): string[] {
    return __GetAttributeNames(this._el);
  }

  getComputedStyleProperty(name: string): string {
    if (typeof __GetComputedStyleByKey !== 'function') {
      throw new Error('ng-lynx: getComputedStyleProperty needs Lynx 3.5 or newer (__GetComputedStyleByKey).');
    }
    return __GetComputedStyleByKey(this._el, name);
  }

  querySelector(selector: string): MainThreadElement | null {
    const found = __QuerySelector(this._el, selector, {});
    return found ? new MainThreadElementImpl(found) : null;
  }

  querySelectorAll(selector: string): MainThreadElement[] {
    return __QuerySelectorAll(this._el, selector, {}).map((found) => new MainThreadElementImpl(found));
  }

  invoke(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      __InvokeUIMethod(this._el, method, params, (result) => {
        if (result.code === 0) resolve(result.data);
        else reject(new Error(`UI method ${method}: ${JSON.stringify(result)}`));
      });
      scheduleFlush();
    });
  }

  animate(keyframes: Record<string, number | string>[], options?: number | MainThreadAnimationOptions): MainThreadAnimation {
    const el = this._el;
    const id = `__ng-main-thread-animation-${nextAnimationId++}`;
    __ElementAnimate(el, [ANIMATION_START, id, keyframes, typeof options === 'number' ? { duration: options } : (options ?? {})]);
    return {
      cancel: () => void __ElementAnimate(el, [ANIMATION_CANCEL, id]),
      pause: () => void __ElementAnimate(el, [ANIMATION_PAUSE, id]),
      play: () => void __ElementAnimate(el, [ANIMATION_PLAY, id]),
    };
  }
}

/**
 * `event.target` / `event.currentTarget`: the element, and the fields the engine
 * sent with it (`id`, `uid`, `dataset`, …). Only those fields are enumerable, so
 * `JSON.stringify(event)` gives them and nothing native.
 */
export class MainThreadEventTargetImpl extends MainThreadElementImpl {
  constructor(el: LynxElement, fields: Record<string, unknown>) {
    super(el);
    for (const key of Object.keys(fields)) {
      // A field can't hide a method: `animate` from the engine would break `.animate()`.
      if (key === 'elementRefptr' || key in this) continue;
      (this as unknown as Record<string, unknown>)[key] = fields[key];
    }
  }
}

/** The first element on the page matching `selector`, or `null` before the page exists. */
export function queryPage(selector: string): MainThreadElement | null {
  const page = elements.get(PAGE_ROOT_ID);
  return page === undefined ? null : new MainThreadElementImpl(page).querySelector(selector);
}

/** Every element on the page matching `selector`. */
export function queryPageAll(selector: string): MainThreadElement[] {
  const page = elements.get(PAGE_ROOT_ID);
  return page === undefined ? [] : new MainThreadElementImpl(page).querySelectorAll(selector);
}
