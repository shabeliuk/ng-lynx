/**
 * `<lynx-slider>` — a numeric `ControlValueAccessor` you drag or tap along a
 * track. Lynx has no native `<input type="range">` (see select.ts's doc
 * comment for the built-in elements reference), so this is a `view` track.
 *
 * ## Where the drag runs
 *
 * **On the Main Thread, when the build has the worklet runtime** (a
 * `pluginAngularLynx` build with `mainThreadModules`, or one that imports
 * `ng-lynx/worklet-runtime`). The track's touches go to worklets
 * (main-thread/src/controls.ts), which measure the track on each touchstart,
 * move the fill and thumb themselves, and tell this side only when the value
 * changes, so the thumb follows the finger however busy the Background Thread
 * is. While a drag is on, the Main Thread owns the fill and thumb styles: the
 * `[style]` bindings follow `shown`, which changes only when the drag commits
 * or the model writes a value, so a late Background render can't move the
 * thumb back under the finger.
 *
 * **On the Background Thread otherwise**: plain `(touchstart)`/`(touchmove)`
 * bindings, the track measured with `invoke({ method: 'boundingClientRect' })`
 * from here, and every move a round trip. The runtime is about 10 kB of Lynx
 * bundle, so an app without worklets doesn't get it for a slider's sake.
 *
 * ## Requires a track width the engine can report
 *
 * The control needs a measured size, so it is only as good as the engine's
 * geometry bridge. On the **native engine** that bridge is accurate. On the
 * **web preview** `@lynx-js/web-core` reports a *style-derived* rect, so a
 * track whose width comes from layout (`flex: 1`) measures as `width: 0` and
 * the slider stays inert rather than jumping to a wrong value. Give the track
 * an explicit CSS `width` if you need it to work in the web preview. See
 * docs/09-forms.md.
 *
 * ## Touch coordinates
 *
 * The worklets read `detail.x`, which both engines send page-absolute and
 * consistently through a gesture. An earlier version also read `touches[0].x`
 * and picked between the two per event; that flipped mid-drag and made the
 * value snap between a wrong reading and the right one on a real phone.
 *
 * ```html
 * <lynx-slider [min]="0" [max]="100" [step]="5" [(ngModel)]="volume" />
 * ```
 *
 * The track carries `accessibility-traits="adjustable"` and a live
 * `accessibility-value` (the current number, as a string) — see
 * docs/34-accessibility.md for the full attribute reference this reads from.
 *
 * Ships unstyled — see docs/09-forms.md.
 */
import {
  type AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  forwardRef,
  Input,
  NO_ERRORS_SCHEMA,
  signal,
  ViewChild,
} from '@angular/core';
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import {
  bindWorklet,
  SLIDER_WORKLET,
  type SliderDrag,
  type SliderElement,
  type SliderParams,
  type WorkletHandle,
} from 'ng-lynx/internal/ops';

import { whenFlushed } from './flush.js';
import type { ShadowElement } from './shadow-element.js';
import { backgroundFunction, mainThreadRef } from './thread-calls.js';
import { LynxMainThread, LynxMainThreadRef } from './worklet.js';

/**
 * Whether the Main-Thread bundle has the worklet runtime. `pluginAngularLynx`
 * defines it; a plain Vitest or Jest run reads the global `ng-lynx/testing`'s
 * mock sets.
 */
declare const __WORKLET_RUNTIME__: boolean;

function hasWorkletRuntime(): boolean {
  return typeof __WORKLET_RUNTIME__ !== 'undefined' && __WORKLET_RUNTIME__;
}

const start = { _wkltId: SLIDER_WORKLET.start } as WorkletHandle<SliderParams>;
const move = { _wkltId: SLIDER_WORKLET.move } as WorkletHandle<SliderParams>;
const end = { _wkltId: SLIDER_WORKLET.end } as WorkletHandle<SliderParams>;

/** A Lynx touch event, as the Background Thread gets it. `detail.x` is page-absolute. */
interface LynxTouchLikeEvent {
  detail?: { x?: number; y?: number };
  touches?: ReadonlyArray<{ clientX?: number; pageX?: number }>;
}

/** Where the track starts on the page, and how wide it is. */
interface TrackGeometry {
  left: number;
  width: number;
}

/** A touch reduced to what the value math needs, plus when it happened. */
interface TouchPoint {
  pageX?: number;
  at: number;
}

/**
 * How long a touch that arrived before any measurement stays applicable. The
 * measurement normally lands within a frame or two; this only stops a very
 * late one from moving the thumb.
 */
const PENDING_TOUCH_MAX_AGE_MS = 1000;

@Component({
  selector: 'lynx-slider',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LynxMainThread, LynxMainThreadRef],
  schemas: [NO_ERRORS_SCHEMA],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LynxSlider),
      multi: true,
    },
  ],
  template: `
    <view class="lynx-slider" [class.lynx-slider-disabled]="disabledState()">
      @if (onMainThread) {
        <view
          class="lynx-slider-track"
          [lynxMainThreadRef]="mtTrack"
          [lynxMainThread]="touchEvents()"
          [accessibility-element]="true"
          accessibility-traits="adjustable"
          [accessibility-value]="value().toString()"
        >
          <view class="lynx-slider-fill" [lynxMainThreadRef]="mtFill" [style.width.%]="percent()"></view>
          <view class="lynx-slider-thumb" [lynxMainThreadRef]="mtThumb" [style.left.%]="percent()"></view>
        </view>
      } @else {
        <view
          class="lynx-slider-track"
          #track
          (touchstart)="onTouchStart($any($event))"
          (touchmove)="onTouch($any($event))"
          (touchend)="onTouchEnd()"
          [accessibility-element]="true"
          accessibility-traits="adjustable"
          [accessibility-value]="value().toString()"
        >
          <view class="lynx-slider-fill" [style.width.%]="percent()"></view>
          <view class="lynx-slider-thumb" [style.left.%]="percent()"></view>
        </view>
      }
    </view>
  `,
})
export class LynxSlider implements ControlValueAccessor, AfterViewInit {
  // Plain `@Input()` setters over signals, not `input()`: the JIT verify build
  // doesn't wire up initializer inputs (docs/19-testing.md).
  @Input() set min(value: number) {
    this.minState.set(value);
  }
  get min(): number {
    return this.minState();
  }

  @Input() set max(value: number) {
    this.maxState.set(value);
  }
  get max(): number {
    return this.maxState();
  }

  /** `0` disables snapping — any value in `[min, max]` is accepted as-is. */
  @Input() set step(value: number) {
    this.stepState.set(value);
  }
  get step(): number {
    return this.stepState();
  }

  private readonly minState = signal(0);
  private readonly maxState = signal(100);
  private readonly stepState = signal(1);

  protected readonly onMainThread = hasWorkletRuntime();

  /** The latest value, mid-drag included. */
  protected readonly value = signal(0);
  /** The value the styles show: the model's, or a committed drag's. See the class doc. */
  private readonly shown = signal(0);
  protected readonly disabledState = signal(false);
  protected readonly percent = computed(() => {
    const span = this.maxState() - this.minState();
    if (span <= 0) return 0;
    return ((this.shown() - this.minState()) / span) * 100;
  });

  private onChange: (value: unknown) => void = () => {};
  private onTouchedFn: () => void = () => {};

  // -- Main-Thread path ------------------------------------------------------

  protected readonly mtTrack = mainThreadRef<SliderElement | null>();
  protected readonly mtFill = mainThreadRef<SliderElement | null>();
  protected readonly mtThumb = mainThreadRef<SliderElement | null>();
  private readonly drag = mainThreadRef<SliderDrag>({
    geometry: null,
    pending: null,
    generation: 0,
    value: 0,
    active: false,
  });

  private readonly onValue = backgroundFunction((value: number) => this.update(value));
  private readonly onCommit = backgroundFunction((value: number) => {
    this.update(value);
    this.shown.set(value);
    this.onTouchedFn();
  });

  protected readonly touchEvents = computed(() => {
    const params = {
      min: this.minState(),
      max: this.maxState(),
      step: this.stepState(),
      disabled: this.disabledState(),
      value: this.shown(),
      track: this.mtTrack,
      fill: this.mtFill,
      thumb: this.mtThumb,
      drag: this.drag,
      onValue: this.onValue,
      onCommit: this.onCommit,
    };
    return {
      touchstart: bindWorklet(start, params),
      touchmove: bindWorklet(move, params),
      touchend: bindWorklet(end, params),
      touchcancel: bindWorklet(end, params),
    };
  });

  private update(value: number): void {
    if (value === this.value()) return;
    this.value.set(value);
    this.onChange(value);
  }

  // -- Background path -------------------------------------------------------

  // `@ViewChild` (decorator), not `viewChild()` (initializer) — the JIT verify
  // build doesn't wire up initializer queries; see docs/19-testing.md.
  @ViewChild('track', { read: ElementRef }) private readonly trackRef?: ElementRef<ShadowElement>;

  /** Last known track geometry; refreshed on each `touchstart`. */
  private geometry: TrackGeometry | null = null;

  /** A touch that landed before any geometry existed; applied when one arrives. */
  private pendingPoint: TouchPoint | null = null;

  /**
   * Bumped by each `measureTrack()`, so a measurement that lands after a newer
   * one was asked for (the mount's best-effort one, after a touchstart's) can't
   * overwrite the geometry or take the pending point.
   */
  private measurementGeneration = 0;

  ngAfterViewInit(): void {
    if (this.onMainThread) return;
    // Best-effort: layout may not be done yet, and the touchstart re-measure is
    // what makes it work. Waits for the ops to reach the Main Thread first:
    // `ngAfterViewInit` runs before the flush, and querying an element the Main
    // Thread doesn't have yet makes web-core log an error on every mount. The
    // microtask hop puts `whenFlushed()` after the flush has started.
    queueMicrotask(() => {
      void whenFlushed().then(() => this.measureTrack());
    });
  }

  /**
   * Ask the Main Thread for the track's geometry with `invoke('boundingClientRect')`:
   * `fields({ size: true })` doesn't work on either engine (docs/09-forms.md).
   * A failed or empty measurement leaves the previous geometry alone.
   */
  private measureTrack(): void {
    const track = this.trackRef?.nativeElement;
    if (!track) return;
    const generation = ++this.measurementGeneration;
    try {
      track.invoke({
        method: 'boundingClientRect',
        params: {},
        success: (res) => {
          if (generation !== this.measurementGeneration) return;
          const rect = res as { left?: number; width?: number } | null;
          const width = rect?.width;
          if (typeof width === 'number' && width > 0) {
            const geometry = { left: typeof rect?.left === 'number' ? rect.left : 0, width };
            this.geometry = geometry;
            const pending = this.pendingPoint;
            this.pendingPoint = null;
            if (pending && Date.now() - pending.at <= PENDING_TOUCH_MAX_AGE_MS) {
              this.applyPoint(pending, geometry);
            }
          }
        },
        fail: () => {},
      });
    } catch {
      // An engine without this UI method — nothing further to try.
    }
  }

  private toTouchPoint(event: LynxTouchLikeEvent): TouchPoint {
    const touch = event.touches?.[0];
    return { pageX: event.detail?.x ?? touch?.clientX ?? touch?.pageX, at: Date.now() };
  }

  protected onTouchStart(event: LynxTouchLikeEvent): void {
    if (this.disabledState()) return;
    // Measured again, and the cached geometry dropped: applying this touch
    // against the old geometry, then the next one against the new, read on a
    // real phone as the thumb snapping between two values.
    this.pendingPoint = this.toTouchPoint(event);
    this.geometry = null;
    this.measureTrack();
  }

  protected onTouch(event: LynxTouchLikeEvent): void {
    if (this.disabledState()) return;
    const point = this.toTouchPoint(event);
    const geometry = this.geometry;
    // Held until the touchstart's measurement lands: without it, the first tap
    // on a freshly-mounted slider did nothing.
    if (!geometry) this.pendingPoint = point;
    else this.applyPoint(point, geometry);
  }

  private applyPoint(point: TouchPoint, geometry: TrackGeometry): void {
    if (typeof point.pageX !== 'number') return;
    const span = this.maxState() - this.minState();
    if (span <= 0) return;
    const fraction = Math.min(1, Math.max(0, (point.pageX - geometry.left) / geometry.width));
    const raw = this.minState() + fraction * span;
    const step = this.stepState();
    const stepped = step > 0 ? Math.round(raw / step) * step : raw;
    const clamped = Math.min(this.maxState(), Math.max(this.minState(), stepped));
    this.shown.set(clamped);
    this.update(clamped);
  }

  protected onTouchEnd(): void {
    this.onTouchedFn();
  }

  // -- ControlValueAccessor --------------------------------------------------

  writeValue(value: unknown): void {
    const next = typeof value === 'number' ? value : this.minState();
    this.value.set(next);
    this.shown.set(next);
  }

  registerOnChange(fn: (value: unknown) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouchedFn = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledState.set(isDisabled);
  }
}
