/**
 * The Main-Thread halves of ng-lynx's own controls. A drag follows the finger
 * here, without a round trip to the Background Thread on each move; the
 * Background Thread hears only about values that change.
 *
 * Registered by `installWorkletRuntime()`, so every build that has the worklet
 * runtime has these too. The Background halves bind them by id
 * (`SLIDER_WORKLET` in `ng-lynx/internal/ops`).
 */
import { SLIDER_WORKLET, type SliderDrag, type SliderParams } from 'ng-lynx/internal/ops';

import { defineWorklet, type MainThreadTouchEvent, runOnBackground } from './worklet-apply.js';

/**
 * How long a touch that arrived before the measurement stays applicable. The
 * measurement normally lands within a frame; this only stops a very late one
 * from moving the thumb.
 */
const PENDING_TOUCH_MAX_AGE_MS = 1000;

/**
 * The touch's page-absolute x. `detail.x` is page-absolute on both engines,
 * consistently through a gesture (see runtime/src/slider.ts's history notes);
 * `touches[0].clientX` is the same coordinate.
 */
function pageX(event: MainThreadTouchEvent): number | undefined {
  const x = (event.detail as { x?: unknown } | undefined)?.x;
  if (typeof x === 'number') return x;
  const touch = event.touches?.[0] ?? event.changedTouches?.[0];
  return touch?.clientX ?? touch?.pageX;
}

function paint(p: SliderParams, value: number): void {
  const span = p.max - p.min;
  const percent = span > 0 ? `${((value - p.min) / span) * 100}%` : '0%';
  p.fill.current?.setStyleProperty('width', percent);
  p.thumb.current?.setStyleProperty('left', percent);
}

function apply(p: SliderParams, x: number, geometry: NonNullable<SliderDrag['geometry']>): void {
  const span = p.max - p.min;
  if (span <= 0) return;
  const fraction = Math.min(1, Math.max(0, (x - geometry.left) / geometry.width));
  const raw = p.min + fraction * span;
  const stepped = p.step > 0 ? Math.round(raw / p.step) * p.step : raw;
  const value = Math.min(p.max, Math.max(p.min, stepped));
  const drag = p.drag.current;
  if (value === drag.value) return;
  drag.value = value;
  paint(p, value);
  // A tap's measurement can land after its touchend: commit it then.
  void runOnBackground(drag.active ? p.onValue : p.onCommit)(value);
}

/**
 * Measure the track. Asynchronous, so the touch that asked waits in
 * `drag.pending`. A failed or empty measurement leaves the drag inert rather
 * than guessing.
 */
function measure(p: SliderParams): void {
  const drag = p.drag.current;
  const generation = ++drag.generation;
  const track = p.track.current;
  if (!track) return;
  track.invoke('boundingClientRect').then(
    (result) => {
      if (generation !== drag.generation) return;
      const rect = result as { left?: number; width?: number } | null;
      if (typeof rect?.width !== 'number' || rect.width <= 0) return;
      const geometry = { left: typeof rect.left === 'number' ? rect.left : 0, width: rect.width };
      drag.geometry = geometry;
      const pending = drag.pending;
      drag.pending = null;
      if (pending && Date.now() - pending.at <= PENDING_TOUCH_MAX_AGE_MS) apply(p, pending.x, geometry);
    },
    () => {},
  );
}

/**
 * Register the controls' worklets. Called by `installWorkletRuntime()` and,
 * after a harness clears the registry, by `clearWorklets()`.
 */
export function registerControlWorklets(): void {
  defineWorklet<MainThreadTouchEvent, SliderParams>(SLIDER_WORKLET.start, function sliderTouchStartMT(ctx) {
    const p = ctx.params;
    if (p.disabled) return;
    const drag = p.drag.current;
    drag.active = true;
    drag.value = p.value;
    // Measured again on every touchstart: the track may have moved since the
    // last drag, and the previous geometry would put this touch in the wrong
    // place first.
    drag.geometry = null;
    const x = pageX(ctx.event);
    drag.pending = typeof x === 'number' ? { x, at: Date.now() } : null;
    measure(p);
  });

  defineWorklet<MainThreadTouchEvent, SliderParams>(SLIDER_WORKLET.move, function sliderTouchMoveMT(ctx) {
    const p = ctx.params;
    if (p.disabled) return;
    const drag = p.drag.current;
    const x = pageX(ctx.event);
    if (typeof x !== 'number') return;
    if (drag.geometry) apply(p, x, drag.geometry);
    else drag.pending = { x, at: Date.now() };
  });

  defineWorklet<MainThreadTouchEvent, SliderParams>(SLIDER_WORKLET.end, function sliderTouchEndMT(ctx) {
    const p = ctx.params;
    const drag = p.drag.current;
    if (p.disabled || !drag.active) return;
    drag.active = false;
    void runOnBackground(p.onCommit)(drag.value);
  });
}
