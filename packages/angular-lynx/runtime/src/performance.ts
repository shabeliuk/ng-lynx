/**
 * Performance API — `LynxPerformance`, a DI wrapper over `lynx.performance`.
 *
 * Lynx exposes a standardized performance interface on the Background Thread
 * (`lynx.performance`): a **PerformanceObserver** for pipeline/metric entries
 * (FCP, TTI, actual-FMP, per-update render pipelines) and a **tracing** API
 * (`profileStart`/`profileEnd`/`profileMark`) that feeds Lynx DevTool. This
 * service surfaces both to Angular code (services, components) and cleans up
 * observers on app teardown.
 *
 * Shapes verified against `@lynx-js/types@3.7.0` and `@lynx-js/web-core`
 * (which backs `createObserver` / `addTimingListener` on the emitter).
 *
 * ## Naming a render pipeline
 *
 * To measure a specific update, put a `__lynx_timing_flag` attribute on an
 * element the update touches — the resulting `PipelineEntry` carries that flag
 * as its `identifier`:
 *
 * ```html
 * <view [attr.__lynx_timing_flag]="'checkout-render'">…</view>
 * ```
 *
 * The attribute rides through the renderer like any other, so no special
 * support is needed; observe `'pipeline'` entries and filter by `identifier`.
 */
import { Injectable, type OnDestroy } from '@angular/core';

// ---------------------------------------------------------------------------
// Native Lynx performance surface (module-local ambient; real types come from
// @lynx-js/types' background-thread/performance).
// ---------------------------------------------------------------------------

/** Base performance entry; `entryType` discriminates the concrete shape. */
export interface LynxPerformanceEntry {
  name: string;
  entryType: string;
  [key: string]: unknown;
}

/** A named metric (FCP / TTI / actual-FMP …). */
export interface LynxPerformanceMetric {
  name: string;
  duration: number;
  [key: string]: unknown;
}

/** A render-pipeline entry (`entryType: 'pipeline'`). `identifier` is the timing flag. */
export interface LynxPipelineEntry extends LynxPerformanceEntry {
  identifier: string;
  pipelineStart: number;
  pipelineEnd: number;
  paintEnd: number;
}

/** Optional tracing context for `profileStart` / `profileMark`. */
export interface LynxTraceOption {
  flowId?: number;
  flowIds?: number[];
  args?: Record<string, string>;
}

interface NativePerformanceObserver {
  observe(entryTypes: string[]): void;
  disconnect(): void;
}

interface NativePerformance {
  createObserver?(callback: (entry: LynxPerformanceEntry) => void): NativePerformanceObserver;
  profileStart?(name: string, option?: LynxTraceOption): void;
  profileEnd?(): void;
  profileMark?(name: string, option?: LynxTraceOption): void;
  profileFlowId?(): number;
  isProfileRecording?(): boolean;
}

// eslint-disable-next-line no-var
declare var lynx: { performance?: NativePerformance } | null | undefined;

declare const __DEV__: boolean;

function getPerformance(): NativePerformance | undefined {
  return typeof lynx !== 'undefined' ? lynx?.performance : undefined;
}

/**
 * Injectable wrapper over `lynx.performance`.
 *
 * @example
 * ```ts
 * export class MetricsService {
 *   private readonly perf = inject(LynxPerformance);
 *   readonly fcp = signal<number | undefined>(undefined);
 *   constructor() {
 *     this.perf.observe(['metric.fcp'], (entry) => {
 *       this.fcp.set((entry['fcp'] as { duration: number } | undefined)?.duration);
 *     });
 *   }
 * }
 * ```
 * @public
 */
@Injectable({ providedIn: 'root' })
export class LynxPerformance implements OnDestroy {
  private readonly observers: NativePerformanceObserver[] = [];

  /**
   * Observe performance entries of the given types (e.g. `['pipeline']`,
   * `['metric.fcp', 'metric.actual-fmp']`). Returns a disposer; all observers are
   * also disconnected when the app (root injector) is destroyed. No-op when
   * the runtime lacks `lynx.performance.createObserver`.
   */
  observe(
    entryTypes: string[],
    callback: (entry: LynxPerformanceEntry) => void,
  ): () => void {
    const perf = getPerformance();
    if (!perf?.createObserver) {
      if (__DEV__) {
        console.warn(
          '[angular-lynx] LynxPerformance.observe: lynx.performance.createObserver '
            + 'is unavailable in this environment; observe() is a no-op.',
        );
      }
      return () => {};
    }
    const observer = perf.createObserver((entry) => callback(entry));
    observer.observe(entryTypes);
    this.observers.push(observer);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      const i = this.observers.indexOf(observer);
      if (i >= 0) this.observers.splice(i, 1);
    };
  }

  /** Begin a tracing span (Lynx DevTool). Pair with {@link profileEnd}. */
  profileStart(name: string, option?: LynxTraceOption): void {
    getPerformance()?.profileStart?.(name, option);
  }

  /** End the most recent tracing span. */
  profileEnd(): void {
    getPerformance()?.profileEnd?.();
  }

  /** Emit an instant trace mark (optionally linked via `flowId`). */
  profileMark(name: string, option?: LynxTraceOption): void {
    getPerformance()?.profileMark?.(name, option);
  }

  /** A unique flow id for correlating trace spans/marks. `0` if unsupported. */
  profileFlowId(): number {
    return getPerformance()?.profileFlowId?.() ?? 0;
  }

  /** Whether the device is currently recording a trace. */
  isProfileRecording(): boolean {
    return getPerformance()?.isProfileRecording?.() ?? false;
  }

  ngOnDestroy(): void {
    for (const observer of this.observers) observer.disconnect();
    this.observers.length = 0;
  }
}
