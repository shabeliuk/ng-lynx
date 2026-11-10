// Runs on the Main Thread: listed in `mainThreadModules` in lynx.config.ts.
import {
  defineMainThreadFunction,
  defineMainThreadRef,
  defineWorklet,
  mainThreadLynx,
  type MainThreadGestureEvent,
  type WorkletContext,
} from 'angular-lynx/worklet';

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
