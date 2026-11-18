// Runs on the Main Thread: listed in `mainThreadModules` in lynx.config.ts.
import {
  type BackgroundFunctionHandle,
  defineMainThreadFunction,
  defineMainThreadRef,
  defineWorklet,
  mainThreadLynx,
  runOnBackground,
  type MainThreadGestureEvent,
  type WorkletContext,
} from 'ng-lynx/worklet';

mainThreadLynx.registerDataProcessors({
  defaultDataProcessor: (raw: { mockData?: string }) => ({ ...raw, processed: `${raw.mockData} processed` }),
  // A native host names this one: `updateData(…, processorName: "fromNative")`.
  dataProcessors: {
    fromNative: (raw: { note?: string }) => ({ named: `${raw.note} via fromNative` }),
  },
});

function countTapMT(ctx: WorkletContext): void {
  ctx.setStyle('opacity: 0.8');
  ctx.runOnBackground('tap');
}
export const countTap = defineWorklet(countTapMT);

export const addOnMainThread = defineMainThreadFunction(async function addOnMainThreadMT(a: number, b: number) {
  return a + b;
});

export const chipRef = defineMainThreadRef('chip');
const chipGrabX = defineMainThreadRef('chipGrabX', 0);
const chipX = defineMainThreadRef('chipX', 0);

function onPanStartMT(ctx: WorkletContext<MainThreadGestureEvent>): void {
  chipGrabX.current = ctx.event.params.clientX - chipX.current;
}
export const onPanStart = defineWorklet(onPanStartMT);

function onPanUpdateMT(ctx: WorkletContext<MainThreadGestureEvent>): void {
  chipX.current = ctx.event.params.clientX - chipGrabX.current;
  chipRef.current?.setStyleProperty('transform', `translateX(${chipX.current}px)`);
}
export const onPanUpdate = defineWorklet(onPanUpdateMT);

function onPanEndMT(ctx: WorkletContext<MainThreadGestureEvent>): void {
  ctx.runOnBackground('end');
}
export const onPanEnd = defineWorklet(onPanEndMT);

// The gesture lab: each detector reports its phases as `<label>:<phase>`.
type PhaseParams = { label: string; phase: string };

function recordPhaseMT(ctx: WorkletContext<MainThreadGestureEvent, PhaseParams>): void {
  ctx.runOnBackground(`${ctx.params.label}:${ctx.params.phase}`);
}
export const recordPhase = defineWorklet(recordPhaseMT);

/** A pan that gives up as soon as it starts: nothing after `onStart` should follow but `onEnd`. */
function failOnStartMT(ctx: WorkletContext<MainThreadGestureEvent, PhaseParams>): void {
  ctx.runOnBackground(`${ctx.params.label}:start`);
  ctx.gesture?.fail();
}
export const failOnStart = defineWorklet(failOnStartMT);

/** A pan that ends itself on its first move: one `onUpdate`, then `onEnd`. */
function endOnUpdateMT(ctx: WorkletContext<MainThreadGestureEvent, PhaseParams>): void {
  ctx.runOnBackground(`${ctx.params.label}:update`);
  ctx.gesture?.end();
}
export const endOnUpdate = defineWorklet(endOnUpdateMT);

/**
 * An `onUpdate` that also reports what the event carries, as `<label>~<json>`, so the
 * lab shows what a fling's `params` carry.
 */
function recordUpdateMT(ctx: WorkletContext<MainThreadGestureEvent, PhaseParams>): void {
  ctx.runOnBackground(`${ctx.params.label}:update`);
  ctx.runOnBackground(`${ctx.params.label}~${JSON.stringify(ctx.event.params)}`);
}
export const recordUpdate = defineWorklet(recordUpdateMT);

// The timing screen: how many frames the Main Thread draws while its list
// scrolls. A touch starts counting `requestAnimationFrame` callbacks, and
// 600 ms with no scroll event ends it.
export interface FlingResult {
  /** Frames between the touch and the last scroll event. */
  frames: number;
  ms: number;
  /** The longest gap between two frames. */
  longest: number;
  scrolls: number;
}
type FlingParams = { report: BackgroundFunctionHandle<[FlingResult], void> };

const fling = { running: false, start: 0, last: 0, frames: 0, longest: 0, scrolls: 0, lastScroll: 0, atLastScroll: { frames: 0, longest: 0 } };
let flingReport: BackgroundFunctionHandle<[FlingResult], void> | undefined;

function flingFrameMT(): void {
  const now = Date.now();
  if (fling.last) fling.longest = Math.max(fling.longest, now - fling.last);
  fling.last = now;
  fling.frames++;
  const quietFor = now - (fling.lastScroll || fling.start);
  if (quietFor < 600) {
    mainThreadLynx.requestAnimationFrame(flingFrameMT);
    return;
  }
  fling.running = false;
  if (fling.scrolls > 0 && flingReport) {
    void runOnBackground(flingReport)({
      frames: fling.atLastScroll.frames,
      ms: fling.lastScroll - fling.start,
      longest: fling.atLastScroll.longest,
      scrolls: fling.scrolls,
    });
  }
}

function flingTouchMT(ctx: WorkletContext<unknown, FlingParams>): void {
  flingReport = ctx.params.report;
  if (fling.running) return;
  Object.assign(fling, { running: true, start: Date.now(), last: 0, frames: 0, longest: 0, scrolls: 0, lastScroll: 0 });
  mainThreadLynx.requestAnimationFrame(flingFrameMT);
}
export const flingTouch = defineWorklet(flingTouchMT);

function flingScrollMT(): void {
  if (!fling.running) return;
  fling.scrolls++;
  fling.lastScroll = Date.now();
  fling.atLastScroll = { frames: fling.frames, longest: fling.longest };
}
export const flingScroll = defineWorklet(flingScrollMT);
