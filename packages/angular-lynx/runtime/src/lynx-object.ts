/**
 * `LynxObject` — the remaining assorted `lynx.*` global methods, grouped the
 * same way lynxjs.org's own "Lynx Object" API page does: element lookup by
 * id, text measurement, custom fonts, resource prefetching, the BG-thread
 * module registry, and accessibility announcements. Each is a thin wrapper —
 * no state, no reactivity — so one small service covers all of them rather
 * than one file per method.
 *
 * `setObserverFrameRate()` lives on {@link LynxExposure} instead
 * (`visibility.ts`) — it tunes the same exposure-detection system that
 * service already wraps.
 */
import { Injectable } from '@angular/core';

declare const __DEV__: boolean;

// ---------------------------------------------------------------------------
// getElementById() / element.animate()
// ---------------------------------------------------------------------------

/** An `Animation` handle returned by {@link LynxNodeRef.animate}. @public */
export interface LynxAnimation {
  cancel(): void;
  pause(): void;
  play(): void;
}

/** A single CSS-property keyframe (plus an optional per-keyframe easing). @public */
export type LynxAnimationKeyframe = Record<string, string | number> & {
  'animation-timing-function'?: string;
};

/** `element.animate()` keyframes — an array, or percentage-keyed object. @public */
export type LynxAnimationKeyframes =
  | LynxAnimationKeyframe[]
  | Record<string, LynxAnimationKeyframe>;

/** `element.animate()` options — the same surface as CSS animations. @public */
export interface LynxAnimationOptions {
  /** Milliseconds. */
  duration?: number;
  /** Milliseconds. */
  delay?: number;
  iterations?: number;
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  /** e.g. `'linear'`, `'cubic-bezier(...)'`. */
  easing?: string;
  fill?: 'none' | 'forwards' | 'backwards';
  /** Custom identifier, surfaced on animation events. */
  name?: string;
  'play-state'?: 'running' | 'paused';
}

/**
 * The handle `lynx.getElementById()` returns. Background-thread code may only
 * use it for cross-thread method invocation (`animate`) — it does **not**
 * keep the element alive and isn't a substitute for `ElementRef`/`ShadowElement`.
 * @public
 */
export interface LynxNodeRef {
  animate(keyframes: LynxAnimationKeyframes, options: LynxAnimationOptions): LynxAnimation;
}

// ---------------------------------------------------------------------------
// getTextInfo()
// ---------------------------------------------------------------------------

/** Input to {@link LynxObject.getTextInfo}. `fontSize` is required, px-only. @public */
export interface LynxTextInfo {
  /** e.g. `'16px'` — the only supported unit. */
  fontSize: string;
  /** Built-in fonts only (custom fonts registered via `addFont` aren't measurable here). */
  fontFamily?: string;
  /** e.g. `'200px'`. */
  maxWidth?: string;
  maxLine?: number;
}

/** Result of {@link LynxObject.getTextInfo}. @public */
export interface LynxTextMetrics {
  /** Measured width, px. */
  width: number;
  /** One entry per wrapped line — omitted when `maxLine` is 1. */
  content?: string[];
}

// ---------------------------------------------------------------------------
// addFont()
// ---------------------------------------------------------------------------

/** @public */
export interface LynxFontFace {
  'font-family': string;
  src: string;
}

// ---------------------------------------------------------------------------
// requestResourcePrefetch() / cancelResourcePrefetch()
// ---------------------------------------------------------------------------

/** One resource to prefetch or cancel. @public */
export interface LynxPrefetchResourceItem {
  /** CDN resource address. */
  uri: string;
  type: 'image' | 'video' | 'audio' | 'font';
  /**
   * Per-type control params — images: `priority`/`cacheTarget`; video/audio:
   * required `preloadKey` (+ optional `size` for video).
   */
  params?: Record<string, unknown>;
}

/** @public */
export interface LynxPrefetchRequest {
  data: LynxPrefetchResourceItem[];
}

/** Per-resource status inside a {@link LynxPrefetchResult}. @public */
export interface LynxPrefetchResourceStatus {
  code: number;
  msg: string;
  uri: string;
  type: string;
}

/** Result of {@link LynxObject.requestResourcePrefetch} / `cancelResourcePrefetch`. @public */
export interface LynxPrefetchResult {
  /** `0` on success. */
  code: number;
  msg: string;
  details: LynxPrefetchResourceStatus[];
}

/** @public */
export interface LynxPrefetchConfig {
  awaitComplete?: boolean;
  /** Milliseconds, default `60000`. */
  awaitTimeout?: number;
}

// ---------------------------------------------------------------------------
// Ambient `lynx` surface used by this file.
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-var
declare var lynx:
  | {
      getElementById?(id: string): LynxNodeRef | null;
      getTextInfo?(text: string, info: LynxTextInfo): LynxTextMetrics;
      addFont?(fontFace: LynxFontFace, callback?: () => void): void;
      requestResourcePrefetch?(
        data: LynxPrefetchRequest,
        callback: (res: LynxPrefetchResult) => void,
        config?: LynxPrefetchConfig,
      ): void;
      cancelResourcePrefetch?(
        data: LynxPrefetchRequest,
        callback: (res: LynxPrefetchResult) => void,
      ): void;
      registerModule?<T>(name: string, module: T): void;
      getJSModule?(name: string): unknown;
      accessibilityAnnounce?(options: { content: string }): void;
      reload?(value: object, callback: () => void): void;
      beforePublishEvent?: {
        add(eventName: string, handler: (...args: unknown[]) => void): void;
        remove(eventName: string, handler: (...args: unknown[]) => void): void;
      };
    }
  | null
  | undefined;

function warnUnavailable(method: string): void {
  if (__DEV__) {
    console.warn(`[angular-lynx] LynxObject.${method}: lynx.${method} is unavailable in this environment.`);
  }
}

/**
 * Injectable access to the remaining `lynx.*` global methods. See each
 * method's doc comment for the underlying API; all are thin pass-throughs —
 * no state to clean up, so there's no `ngOnDestroy`.
 *
 * @public
 */
@Injectable({ providedIn: 'root' })
export class LynxObject {
  /**
   * Look up an element by its `id` attribute (the `[id]` input every typed
   * element has). Unlike `ElementRef`/`asLynxElement`, this returns `null`
   * when nothing matches instead of throwing, and the handle is
   * cross-thread-invoke-only (currently just `.animate()`).
   */
  getElementById(id: string): LynxNodeRef | null {
    if (typeof lynx === 'undefined' || !lynx?.getElementById) {
      warnUnavailable('getElementById');
      return null;
    }
    return lynx.getElementById(id);
  }

  /** Measure text without rendering it (layout width, wrapped lines). */
  getTextInfo(text: string, info: LynxTextInfo): LynxTextMetrics | undefined {
    if (typeof lynx === 'undefined' || !lynx?.getTextInfo) {
      warnUnavailable('getTextInfo');
      return undefined;
    }
    return lynx.getTextInfo(text, info);
  }

  /** Register a custom font face. */
  addFont(fontFace: LynxFontFace, callback?: () => void): void {
    if (typeof lynx === 'undefined' || !lynx?.addFont) {
      warnUnavailable('addFont');
      return;
    }
    lynx.addFont(fontFace, callback);
  }

  /** Prefetch images/video/audio/fonts ahead of when they're needed. */
  requestResourcePrefetch(
    data: LynxPrefetchRequest,
    config?: LynxPrefetchConfig,
  ): Promise<LynxPrefetchResult> {
    return new Promise((resolve) => {
      if (typeof lynx === 'undefined' || !lynx?.requestResourcePrefetch) {
        warnUnavailable('requestResourcePrefetch');
        resolve({ code: -1, msg: 'unavailable', details: [] });
        return;
      }
      lynx.requestResourcePrefetch(data, resolve, config);
    });
  }

  /** Cancel a previously requested prefetch. */
  cancelResourcePrefetch(data: LynxPrefetchRequest): Promise<LynxPrefetchResult> {
    return new Promise((resolve) => {
      if (typeof lynx === 'undefined' || !lynx?.cancelResourcePrefetch) {
        warnUnavailable('cancelResourcePrefetch');
        resolve({ code: -1, msg: 'unavailable', details: [] });
        return;
      }
      lynx.cancelResourcePrefetch(data, resolve);
    });
  }

  /**
   * Register a value under `name` in this LynxView's Background-Thread
   * module registry (any JS value — object, class, function). Scoped to this
   * LynxView instance; not shared across views.
   */
  registerModule<T>(name: string, module: T): void {
    if (typeof lynx === 'undefined' || !lynx?.registerModule) {
      warnUnavailable('registerModule');
      return;
    }
    lynx.registerModule(name, module);
  }

  /** Look up a previously `registerModule`'d value (or a host-provided one, e.g. `GlobalEventEmitter`). */
  getJSModule<T = unknown>(name: string): T | undefined {
    if (typeof lynx === 'undefined' || !lynx?.getJSModule) {
      warnUnavailable('getJSModule');
      return undefined;
    }
    return lynx.getJSModule(name) as T | undefined;
  }

  /**
   * Reload the page, like a browser's refresh button, with `initData` as its
   * new init data (what `lynxInitData()` reads). Resolves when the engine
   * reports the reload done.
   *
   * Lynx's notes: data processors don't run on this data, and
   * `__globalProps`, `SystemInfo` and JS globals stay as they were.
   */
  reload(initData: object = {}): Promise<void> {
    return new Promise((resolve) => {
      if (typeof lynx === 'undefined' || !lynx?.reload) {
        warnUnavailable('reload');
        resolve();
        return;
      }
      lynx.reload(initData, () => resolve());
    });
  }

  /** Announce text to screen readers. */
  accessibilityAnnounce(content: string): void {
    if (typeof lynx === 'undefined' || !lynx?.accessibilityAnnounce) {
      warnUnavailable('accessibilityAnnounce');
      return;
    }
    lynx.accessibilityAnnounce({ content });
  }

  /**
   * `lynx.beforePublishEvent` — a Background-Thread "event aspect" hook that
   * intercepts a named event (e.g. `'tap'`) before it reaches its normal
   * handler, for cross-cutting concerns like uniform analytics logging.
   *
   * **Lower confidence than the rest of this service**: lynxjs.org's docs
   * for this one don't specify the handler's parameters, return value, or
   * whether it can cancel/modify the event — only the `add`/`remove` shape.
   * Verify against your engine version before relying on it for anything
   * beyond passive observation.
   */
  readonly beforePublishEvent = {
    add: (eventName: string, handler: (...args: unknown[]) => void): void => {
      if (typeof lynx === 'undefined' || !lynx?.beforePublishEvent) {
        warnUnavailable('beforePublishEvent.add');
        return;
      }
      lynx.beforePublishEvent.add(eventName, handler);
    },
    remove: (eventName: string, handler: (...args: unknown[]) => void): void => {
      if (typeof lynx === 'undefined' || !lynx?.beforePublishEvent) {
        warnUnavailable('beforePublishEvent.remove');
        return;
      }
      lynx.beforePublishEvent.remove(eventName, handler);
    },
  };
}
