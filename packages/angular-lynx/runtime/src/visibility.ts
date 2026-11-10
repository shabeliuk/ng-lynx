/**
 * Visibility detection on Lynx — an `IntersectionObserver` polyfill (so
 * Angular's `@defer (on viewport)` works) and `LynxIntersectionObserver`, a
 * DI-friendly wrapper over Lynx's native, more capable observer API.
 *
 * Lynx has no DOM `IntersectionObserver`, but it does expose
 * `lynx.createIntersectionObserver(component, options)` with
 * `.relativeToViewport()` / `.relativeTo(selector)` / `.observe(selector, cb)`
 * / `.disconnect()` — verified against `@lynx-js/types@3.7.0` and
 * `@lynx-js/web-core` (which backs it with an `IntersectionObserverModule`;
 * the first arg is `{ componentId }`).
 *
 * Angular's `@defer (on viewport)` calls the **global** `IntersectionObserver`
 * constructor directly (no DI seam — confirmed in `@angular/core`'s compiled
 * `onViewport`), then `observer.observe(triggerElement)` and reads
 * `entry.isIntersecting` / `entry.target`. {@link installIntersectionObserver}
 * installs a DOM-shaped polyfill over the Lynx observer so that path works.
 * The trigger element is a `ShadowElement`. Lynx's `observe` finds its target
 * by `id` only (native and web-core alike), so the element is observed
 * through `ShadowElement.idSelector()`, which gives it an id if it has none,
 * not through the `[ng-ref-{id}]` attribute selector the selector queries
 * use.
 *
 * `on idle` / `on timer` triggers need nothing here — Angular falls back to
 * `setTimeout` when `requestIdleCallback` is absent. `on interaction` /
 * `on hover` are **not** supported yet (they call `element.addEventListener`
 * directly, which `ShadowElement` doesn't implement — see the roadmap).
 */
import { Injectable, type OnDestroy } from '@angular/core';

// ---------------------------------------------------------------------------
// Native Lynx IntersectionObserver surface (module-local ambient — real types
// come from @lynx-js/types).
// ---------------------------------------------------------------------------

interface LynxObserveResult {
  isIntersecting: boolean;
  intersectionRatio: number;
  boundingClientRect?: { top: number; right: number; bottom: number; left: number };
  relativeRect?: { top: number; right: number; bottom: number; left: number };
  time?: number;
}

interface LynxObserverMargins {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface LynxNativeObserver {
  relativeTo(selector: string, margins?: LynxObserverMargins): LynxNativeObserver;
  relativeToViewport(margins?: LynxObserverMargins): LynxNativeObserver;
  relativeToScreen(margins?: LynxObserverMargins): LynxNativeObserver;
  observe(selector: string, callback: (result: LynxObserveResult) => void): void;
  disconnect(): void;
}

interface LynxObserverOptions {
  thresholds?: number[];
  initialRatio?: number;
  observeAll?: boolean;
}

// eslint-disable-next-line no-var
declare var lynx:
  | {
      createIntersectionObserver?(
        component: unknown,
        options?: LynxObserverOptions,
      ): LynxNativeObserver;
      resumeExposure?(): void;
      stopExposure?(): void;
      setObserverFrameRate?(options?: LynxObserverFrameRateOptions): void;
    }
  | null
  | undefined;

/** Options for {@link LynxExposure.setObserverFrameRate}. @public */
export interface LynxObserverFrameRateOptions {
  /** Min. detection frequency for LynxView position changes, fps (default 20). */
  forPageRect?: number;
  /** Min. detection frequency for target-node visibility, fps (default 20). */
  forExposureCheck?: number;
}

declare const __DEV__: boolean;

function nativeFactory():
  | ((component: unknown, options?: LynxObserverOptions) => LynxNativeObserver)
  | undefined {
  return typeof lynx !== 'undefined' ? lynx?.createIntersectionObserver?.bind(lynx) : undefined;
}

/** Root-scope component handle: `{ componentId: '' }` resolves global selectors. */
const ROOT_COMPONENT = { componentId: '' };

// ---------------------------------------------------------------------------
// DOM IntersectionObserver polyfill (backs @defer on viewport)
// ---------------------------------------------------------------------------

/** Parse a CSS `rootMargin` string ("0px 0px 0px 0px") into Lynx px margins. */
function parseRootMargin(rootMargin: string | undefined): LynxObserverMargins | undefined {
  if (!rootMargin) return undefined;
  const parts = rootMargin.trim().split(/\s+/);
  const px = (v: string | undefined): number => {
    if (!v) return 0;
    const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v);
    if (!m) {
      if (__DEV__ && v !== '0') {
        console.warn(
          `[angular-lynx] IntersectionObserver rootMargin "${v}" isn't a px value; `
            + 'Lynx viewport margins are px-only — treating it as 0.',
        );
      }
      return 0;
    }
    return Number(m[1]);
  };
  // CSS order: top right bottom left (with the usual 1/2/4-value shorthand).
  const top = px(parts[0]);
  const right = parts.length > 1 ? px(parts[1]) : top;
  const bottom = parts.length > 2 ? px(parts[2]) : top;
  const left = parts.length > 3 ? px(parts[3]) : right;
  return { top, right, bottom, left };
}

function normalizeThreshold(threshold: number | number[] | undefined): number[] | undefined {
  if (threshold === undefined) return undefined;
  return Array.isArray(threshold) ? threshold : [threshold];
}

interface DomObserverTarget {
  selector: string;
  /** `ShadowElement.idSelector()`: `#id`, once the Main Thread has it. */
  idSelector?(): Promise<string>;
}

/**
 * The selector Lynx's observer can find `target` by: `#id`. A target that
 * can't provide one (not a `ShadowElement`) is passed through as-is.
 */
function observableSelector(target: DomObserverTarget): Promise<string> {
  return target.idSelector ? target.idSelector() : Promise.resolve(target.selector);
}

interface DomIntersectionEntry {
  target: DomObserverTarget;
  isIntersecting: boolean;
  intersectionRatio: number;
  boundingClientRect: { top: number; right: number; bottom: number; left: number };
  intersectionRect: { top: number; right: number; bottom: number; left: number };
  time: number;
}

type DomIntersectionCallback = (entries: DomIntersectionEntry[], observer: unknown) => void;

const EMPTY_RECT = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * A DOM-`IntersectionObserver`-shaped wrapper around Lynx's native observer.
 * One native observer is created per observed target (Lynx has no per-target
 * `unobserve`, only `disconnect()` — so a target == an observer keeps
 * `unobserve` correct without leaking callbacks).
 */
class LynxDomIntersectionObserver {
  readonly root = null;
  readonly rootMargin: string;
  readonly thresholds: number[];

  private readonly callback: DomIntersectionCallback;
  private readonly margins?: LynxObserverMargins;
  private readonly options: LynxObserverOptions;
  private readonly perTarget = new Map<DomObserverTarget, LynxNativeObserver>();

  constructor(
    callback: DomIntersectionCallback,
    options?: { root?: unknown; rootMargin?: string; threshold?: number | number[] },
  ) {
    this.callback = callback;
    this.rootMargin = options?.rootMargin ?? '0px 0px 0px 0px';
    this.thresholds = normalizeThreshold(options?.threshold) ?? [0];
    this.margins = parseRootMargin(options?.rootMargin);
    this.options = { thresholds: this.thresholds, initialRatio: 0 };
  }

  observe(target: DomObserverTarget): void {
    if (!target || this.perTarget.has(target)) return;
    const factory = nativeFactory();
    if (!factory) return;
    const native = factory(ROOT_COMPONENT, this.options);
    native.relativeToViewport(this.margins);
    this.perTarget.set(target, native);
    void observableSelector(target).then((selector) => {
      // Unobserved (or re-observed) while the id was on its way.
      if (this.perTarget.get(target) !== native) return;
      native.observe(selector, (result) => {
        // Late callbacks after unobserve/disconnect are dropped: the native
        // observer is gone from the map, so this target no longer forwards.
        if (this.perTarget.get(target) !== native) return;
        const rect = result.boundingClientRect ?? EMPTY_RECT;
        this.callback(
          [
            {
              target,
              isIntersecting: result.isIntersecting,
              intersectionRatio: result.intersectionRatio,
              boundingClientRect: rect,
              intersectionRect: rect,
              time: result.time ?? 0,
            },
          ],
          this,
        );
      });
    });
  }

  unobserve(target: DomObserverTarget): void {
    const native = this.perTarget.get(target);
    if (native) {
      this.perTarget.delete(target);
      native.disconnect();
    }
  }

  disconnect(): void {
    for (const native of this.perTarget.values()) native.disconnect();
    this.perTarget.clear();
  }

  takeRecords(): DomIntersectionEntry[] {
    return [];
  }
}

/**
 * Install a `globalThis.IntersectionObserver` polyfill backed by
 * `lynx.createIntersectionObserver`, unless the environment already provides
 * one (the web preview's worker has the browser's). Enables Angular's
 * `@defer (on viewport)` and any userland DOM-style `IntersectionObserver`.
 * No-op when neither exists (the observer simply never fires — `@defer` blocks
 * then stay on their placeholder). Called by `entry-background` at bundle
 * start.
 *
 * @internal
 */
export function installIntersectionObserver(): void {
  const g = globalThis as Record<string, unknown>;
  // Install whenever Lynx's observer factory exists, even if the environment
  // already exposes a global `IntersectionObserver`. On Lynx the rendered
  // elements are Lynx elements, observable *only* via
  // `lynx.createIntersectionObserver` — a DOM `IntersectionObserver` (e.g. one
  // a runtime shims into the worker scope) can't see them, so ours must win.
  // If there's no Lynx factory, leave any existing global untouched (the web
  // preview's main thread has the real browser one; the BG worker has none).
  if (!nativeFactory()) return;
  g['IntersectionObserver'] = LynxDomIntersectionObserver;
}

// ---------------------------------------------------------------------------
// LynxIntersectionObserver — DI-friendly native wrapper
// ---------------------------------------------------------------------------

/** Options for {@link LynxIntersectionObserver.observe}. @public */
export interface LynxVisibilityOptions {
  /** Ratios of visibility that trigger the callback. @defaultValue [0] */
  thresholds?: number[];
  /** Viewport margins (px) expanding/shrinking the intersection area. */
  margins?: { top?: number; right?: number; bottom?: number; left?: number };
  /**
   * Observe relative to another element (by its Lynx element handle / an
   * `ElementRef.nativeElement`) instead of the viewport.
   */
  relativeTo?: { selector: string };
}

/** A visibility change for an observed element. @public */
export interface LynxVisibilityEntry {
  isIntersecting: boolean;
  intersectionRatio: number;
  boundingClientRect?: { top: number; right: number; bottom: number; left: number };
}

/**
 * Injectable wrapper over Lynx's native `createIntersectionObserver` — the
 * full-fidelity API (thresholds, element-relative roots) the DOM polyfill
 * can't express. For visibility-driven lazy loading prefer Angular's
 * `@defer (on viewport)` (which the polyfill powers); reach for this when you
 * need the native options or imperative control.
 *
 * @example
 * ```ts
 * export class AdComponent {
 *   private readonly visibility = inject(LynxIntersectionObserver);
 *   private readonly card = viewChild.required<ElementRef>('card');
 *   ngAfterViewInit() {
 *     this.visibility.observe(this.card().nativeElement, (e) => {
 *       if (e.isIntersecting) this.trackImpression();
 *     }, { thresholds: [0.5] });
 *   }
 * }
 * ```
 * @public
 */
@Injectable({ providedIn: 'root' })
export class LynxIntersectionObserver implements OnDestroy {
  private readonly observers: LynxNativeObserver[] = [];

  /**
   * Observe an element's viewport visibility. `element` is an
   * `ElementRef.nativeElement` (a `ShadowElement`); it's observed by `#id`,
   * and given an id if it has none (see `ShadowElement.idSelector`). Returns
   * a disposer; all observers are also disconnected on app destroy.
   */
  observe(
    element: DomObserverTarget,
    callback: (entry: LynxVisibilityEntry) => void,
    options: LynxVisibilityOptions = {},
  ): () => void {
    const factory = nativeFactory();
    if (!factory || !element?.selector) {
      if (__DEV__ && !factory) {
        console.warn(
          '[angular-lynx] LynxIntersectionObserver: lynx.createIntersectionObserver '
            + 'is unavailable in this environment; observe() is a no-op.',
        );
      }
      return () => {};
    }
    const native = factory(ROOT_COMPONENT, {
      thresholds: options.thresholds ?? [0],
      initialRatio: 0,
    });
    if (options.relativeTo?.selector) {
      native.relativeTo(options.relativeTo.selector, options.margins);
    } else {
      native.relativeToViewport(options.margins);
    }
    let disposed = false;
    void observableSelector(element).then((selector) => {
      if (disposed) return;
      native.observe(selector, (result) => {
        callback({
          isIntersecting: result.isIntersecting,
          intersectionRatio: result.intersectionRatio,
          boundingClientRect: result.boundingClientRect,
        });
      });
    });
    this.observers.push(native);
    return () => {
      if (disposed) return;
      disposed = true;
      native.disconnect();
      const i = this.observers.indexOf(native);
      if (i >= 0) this.observers.splice(i, 1);
    };
  }

  ngOnDestroy(): void {
    for (const native of this.observers) native.disconnect();
    this.observers.length = 0;
  }
}

// ---------------------------------------------------------------------------
// LynxExposure — app-wide exposure detection toggle
// ---------------------------------------------------------------------------

/**
 * App-wide control over Lynx's **exposure detection system** — the same
 * system that drives the per-element `uiappear`/`uidisappear` events (typed
 * on `LynxStandardElement` in `angular-lynx/elements`) and the global
 * `exposure`/`no-longer-exposure` events reachable via `LynxGlobalEvents`.
 * Distinct from {@link LynxIntersectionObserver}, which is a separate,
 * imperative observer API.
 *
 * Pause detection during a heavy transition or navigation to save work, then
 * resume it — calling {@link resumeExposure} doesn't retroactively fire
 * events for elements whose visibility hasn't changed since the last check.
 *
 * @example
 * ```ts
 * export class RouteTransitionService {
 *   private readonly exposure = inject(LynxExposure);
 *   onNavigationStart(): void { this.exposure.stopExposure(); }
 *   onNavigationEnd(): void { this.exposure.resumeExposure(); }
 * }
 * ```
 * @public
 */
@Injectable({ providedIn: 'root' })
export class LynxExposure {
  /** Resume exposure detection (`uiappear`/`uidisappear`, global `exposure`). */
  resumeExposure(): void {
    if (typeof lynx === 'undefined' || !lynx?.resumeExposure) {
      if (__DEV__) {
        console.warn(
          '[angular-lynx] LynxExposure.resumeExposure: lynx.resumeExposure is '
            + 'unavailable in this environment.',
        );
      }
      return;
    }
    lynx.resumeExposure();
  }

  /** Pause exposure detection app-wide. */
  stopExposure(): void {
    if (typeof lynx === 'undefined' || !lynx?.stopExposure) {
      if (__DEV__) {
        console.warn(
          '[angular-lynx] LynxExposure.stopExposure: lynx.stopExposure is '
            + 'unavailable in this environment.',
        );
      }
      return;
    }
    lynx.stopExposure();
  }

  /** Tune exposure/page-rect detection frequency (fps, default 20 for both). */
  setObserverFrameRate(options?: LynxObserverFrameRateOptions): void {
    if (typeof lynx === 'undefined' || !lynx?.setObserverFrameRate) {
      if (__DEV__) {
        console.warn(
          '[angular-lynx] LynxExposure.setObserverFrameRate: lynx.setObserverFrameRate '
            + 'is unavailable in this environment.',
        );
      }
      return;
    }
    lynx.setObserverFrameRate(options);
  }
}
