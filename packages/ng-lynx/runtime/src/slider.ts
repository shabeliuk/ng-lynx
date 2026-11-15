/**
 * `<lynx-slider>` — a numeric `ControlValueAccessor` you drag or tap along a
 * track. Lynx has no native `<input type="range">` (see select.ts's doc
 * comment for the built-in elements reference), so this is a `view` track
 * measured via `invoke({ method: 'boundingClientRect' })` and driven by plain
 * `(touchstart)`/`(touchmove)` events — Lynx's own touch-event catalog, not
 * the newer gesture-detector system
 * ([32 — Gestures](../../../docs/32-gestures.md)).
 *
 * ## Requires a track width the engine can report
 *
 * This control is the one place in the package that genuinely needs a measured
 * size, so it is only as good as the engine's geometry bridge. On the **native
 * engine** that bridge is accurate and the slider works. On the **web
 * preview** it is not: `@lynx-js/web-core` reports a *style-derived* rect,
 * so a track whose width comes from layout (`flex: 1`, the natural way to
 * style one) measures as `width: 0` and the slider stays inert rather than
 * jumping to a wrong value. Give the track an explicit CSS `width` if you need
 * it to work in the web preview. See docs/09-forms.md.
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

import { whenFlushed } from './flush.js';
import type { ShadowElement } from './shadow-element.js';

/**
 * The shape of a Lynx touch event.
 *
 * **`detail.x` is NOT element-relative**, despite what an earlier version of
 * this file assumed. Measured on both targets, `detail.x` comes back equal to
 * the touch's `clientX` — i.e. page-absolute — and it does so **consistently**
 * across every event of a gesture.
 *
 * An earlier version of this file also read `touches[0].x`, reasoned to be
 * element-relative on the native engine (and just `clientX` again on the web
 * preview), and picked between the two per-event by comparing
 * `x !== clientX`. **That heuristic is the leading suspect** for a value that
 * repeatedly snapped between a wrong (near-0) reading and the correct one
 * throughout a single held real-finger drag, reported on real hardware — a
 * per-event branch flip is the only mechanism in this file that could produce
 * a *repeated*, large swing rather than a one-off. Not yet confirmed on
 * device (no raw touch payload was captured); if a real-hardware drag still
 * flaps after this change, the branch heuristic wasn't the cause and the next
 * step is logging the raw `event.detail`/`event.touches` payload from an
 * actual device rather than guessing further. `detail.x` is one field, one
 * coordinate space, always — it removes the branch, not just one guess about it.
 */
interface LynxTouchLikeEvent {
  detail?: { x?: number; y?: number };
  touches?: ReadonlyArray<{ clientX?: number; pageX?: number }>;
}

/** The horizontal geometry a drag needs: where the track starts, and how wide it is. */
interface TrackGeometry {
  left: number;
  width: number;
}

/** A touch reduced to what the value math needs, plus when it happened. */
interface TouchPoint {
  /** Page-absolute, from `detail.x` (falling back to a touch's own field only if that's absent). */
  pageX?: number;
  at: number;
}

/**
 * How long a touch that arrived before any measurement stays applicable.
 * The measurement normally lands within a frame or two; this only exists so a
 * long-delayed (or never-answered) query can't move the thumb much later.
 */
const PENDING_TOUCH_MAX_AGE_MS = 1000;

@Component({
  selector: 'lynx-slider',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    </view>
  `,
})
export class LynxSlider implements ControlValueAccessor, AfterViewInit {
  @Input() min = 0;
  @Input() max = 100;
  /** `0` disables snapping — any value in `[min, max]` is accepted as-is. */
  @Input() step = 1;

  // `@ViewChild` (decorator), not `viewChild()` (initializer) — the JIT verify
  // build doesn't wire up initializer queries; see docs/19-testing.md.
  @ViewChild('track', { read: ElementRef }) private readonly trackRef!: ElementRef<ShadowElement>;

  protected readonly value = signal(0);
  protected readonly disabledState = signal(false);
  protected readonly percent = computed(() => {
    const span = this.max - this.min;
    if (span <= 0) return 0;
    return ((this.value() - this.min) / span) * 100;
  });

  /** Last known track geometry; refreshed on each `touchstart` (see measureTrack). */
  private geometry: TrackGeometry | null = null;

  /** A touch that landed before any geometry existed; applied when one arrives. */
  private pendingPoint: TouchPoint | null = null;

  /**
   * Incremented on every `measureTrack()` call; each in-flight measurement
   * captures the value at its own call time and only acts if it's still the
   * latest when its response lands.
   *
   * Needed because `measureTrack()` now runs on *every* touchstart (not just
   * once at mount) — so two measurements can be in flight together: the
   * best-effort one from `ngAfterViewInit` and a fresh one from a touchstart
   * that happened before the first had resolved. If the older one resolves
   * *second* (a real possibility, not a hypothetical — a mounting request and
   * a gesture's remeasure have no ordering guarantee relative to each other),
   * it would otherwise steal and apply `pendingPoint` using its own stale
   * geometry, then clear it — leaving the genuinely fresh measurement with
   * nothing left to apply. Discarding a response that isn't from the latest
   * call closes that window.
   */
  private measurementGeneration = 0;

  private onChange: (value: unknown) => void = () => {};
  private onTouchedFn: () => void = () => {};

  ngAfterViewInit(): void {
    // Best-effort: layout may not be done yet, in which case this comes back
    // empty and the `touchstart` re-measure below is what makes it work.
    //
    // Wait for the ops to actually reach the Main Thread first. `ngAfterViewInit`
    // runs *inside* change detection, before `LynxRendererFactory2.end()` has
    // flushed anything, so measuring here queries an element the Main Thread has
    // not been told about yet — it can't resolve `[ng-ref-{id}]` and the query
    // fails. That was harmless by design (`fail` is a no-op and the touchstart
    // re-measure is the real guarantee), but web-core logs the miss as a console
    // **error** — `[lynx-web] cannot find from for selector [ng-ref-30]` — on
    // every slider mount in the web preview, which is both alarming and noise
    // that buries real errors.
    //
    // `whenFlushed()` is the purpose-built barrier for exactly this (see its doc
    // comment), but it has to be reached *after* the flush has been initiated:
    // called synchronously from here it would see nothing in flight and resolve
    // immediately, which is the bug it's meant to avoid. The microtask hop puts
    // it after the synchronous change-detection cycle, by which point `end()`
    // has sent the batch. Delaying a best-effort measurement can only improve
    // its odds — on device it now runs against a materialised tree instead of
    // racing one.
    queueMicrotask(() => {
      void whenFlushed().then(() => this.measureTrack());
    });
  }

  /**
   * Ask the Main Thread for the track's geometry, via `invoke()` rather than
   * `fields()`.
   *
   * **`fields({ size: true })` does not work on either target available here**,
   * which is what made this control silently inert everywhere. Measured
   * directly: on the web preview it *throws*
   * (`nativeApp.getFields is not a function`); on an iOS simulator (Lynx
   * Explorer 4.0.0) it resolves the selector correctly but calls back with an
   * empty object, and asking for `{ rect, size, id, dataset }` returns only
   * `{ id, dataset }` — so `size`/`rect` are silently dropped while the rest of
   * the query pipeline works fine.
   *
   * `invoke({ method: 'boundingClientRect' })` *is* implemented on both, and on
   * the native engine returns a true layout rect. It's asynchronous, so this
   * refreshes the cache for *subsequent* events rather than the current one.
   *
   * A failed or implausible measurement must leave the previous geometry alone
   * rather than zeroing it, so one bad read can't kill an in-flight drag.
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
          // Superseded by a newer measurement (e.g. this was the best-effort
          // `ngAfterViewInit` one, and a touchstart already re-measured) — a
          // stale rect must not overwrite the current geometry or steal a
          // pending point meant for the newer call. See measurementGeneration's
          // doc comment.
          if (generation !== this.measurementGeneration) return;
          const rect = res as { left?: number; width?: number } | null;
          const width = rect?.width;
          if (typeof width === 'number' && width > 0) {
            const geometry = { left: typeof rect?.left === 'number' ? rect.left : 0, width };
            this.geometry = geometry;
            // A touch that arrived before any measurement existed is applied
            // now, so the first tap on a freshly-mounted slider isn't lost.
            // Age-bounded: a stale position from a gesture the user has long
            // since forgotten must not suddenly move the thumb.
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

  /**
   * Convert a touch into a page-absolute X, from `detail.x` — the one field
   * verified consistent on both targets (see the class doc comment for why
   * `touches[0].x` is no longer read at all).
   */
  private toTouchPoint(event: LynxTouchLikeEvent): TouchPoint {
    const touch = event.touches?.[0];
    return {
      pageX: event.detail?.x ?? touch?.clientX ?? touch?.pageX,
      at: Date.now(),
    };
  }

  private localX(point: TouchPoint, geometry: TrackGeometry): number | undefined {
    return typeof point.pageX === 'number' ? point.pageX - geometry.left : undefined;
  }

  protected onTouchStart(event: LynxTouchLikeEvent): void {
    if (this.disabledState()) return;
    // Do NOT apply this point against whatever `this.geometry` already holds.
    // An earlier version did — re-measuring, then immediately consulting the
    // still-stale cached geometry synchronously — and on a real device that
    // produced a visible double-move: the point applied instantly against the
    // old (sometimes wrong, e.g. captured before the track's final on-screen
    // position) geometry, then a touchmove a few ms later re-applied against
    // the freshly landed, correct geometry, reading as the thumb snapping
    // between a wrong value and the real one.
    //
    // Discarding the cached geometry and queuing this point — the same
    // pending-point path a first-ever tap (before any geometry exists) already
    // used — guarantees exactly one, correct application per gesture, at the
    // cost of waiting for one measurement round trip before the thumb first
    // moves (imperceptible on the native engine; see measureTrack's doc).
    this.pendingPoint = this.toTouchPoint(event);
    this.geometry = null;
    this.measureTrack();
  }

  protected onTouch(event: LynxTouchLikeEvent): void {
    if (this.disabledState()) return;
    const point = this.toTouchPoint(event);
    const geometry = this.geometry;
    if (!geometry) {
      // Nothing measured yet and the `touchstart` request is still in flight.
      // Hold on to this position so the measurement can apply it the moment it
      // lands — without this, the very first *tap* on a freshly-mounted slider
      // is silently swallowed (a drag survives only because it delivers many
      // more move events). Confirmed on-device: tap once, nothing; tap again,
      // it works.
      this.pendingPoint = point;
      return;
    }
    this.applyPoint(point, geometry);
  }

  private applyPoint(point: TouchPoint, geometry: TrackGeometry): void {
    const x = this.localX(point, geometry);
    if (typeof x !== 'number') return;
    const span = this.max - this.min;
    if (span <= 0) return;
    const fraction = Math.min(1, Math.max(0, x / geometry.width));
    const raw = this.min + fraction * span;
    const stepped = this.step > 0 ? Math.round(raw / this.step) * this.step : raw;
    const clamped = Math.min(this.max, Math.max(this.min, stepped));
    if (clamped !== this.value()) {
      this.value.set(clamped);
      this.onChange(clamped);
    }
  }

  protected onTouchEnd(): void {
    this.onTouchedFn();
  }

  writeValue(value: unknown): void {
    this.value.set(typeof value === 'number' ? value : this.min);
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
