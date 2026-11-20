/**
 * Swiper's Main-Thread half: the track follows the finger and snaps from here.
 * The component hears the page it settled on, for the dots, and asks for a page
 * with `swiperGoTo` when a dot is tapped or autoplay advances.
 *
 * The track's position is kept in pages, and written as a percentage of its own
 * width, which is the viewport's (see the component's doc), so only turning the
 * finger's pixels into pages needs the viewport's width.
 */
import {
  type BackgroundFunctionHandle,
  defineMainThreadFunction,
  defineWorklet,
  type LynxAnimationHandle,
  lynxTween,
  type MainThreadElement,
  type MainThreadRef,
  type MainThreadTouchEvent,
  runOnBackground,
} from 'ng-lynx/worklet';

import { ease, lockPage, touchPoint, unlockPage } from '../page-lock.mt.js';

export interface SwiperState {
  page: MainThreadRef<MainThreadElement | null>;
  track: MainThreadRef<MainThreadElement | null>;
  /** The finger's x and the track's position when the drag started, or null between drags. */
  start: MainThreadRef<{ x: number; pos: number } | null>;
  /** Where the track is, in pages: 1.5 is halfway between the second and third. */
  pos: MainThreadRef<number>;
  snap: MainThreadRef<LynxAnimationHandle | null>;
  count: number;
  /** The viewport's width, in px. */
  width: number;
  /** How far a drag must go to turn the page, in px. */
  threshold: number;
  onPage: BackgroundFunctionHandle<[number], void>;
}

function moveTo(state: SwiperState, pos: number): void {
  state.pos.current = pos;
  state.track.current?.setStyleProperty('transform', `translateX(${-100 * pos}%)`);
}

function settle(state: SwiperState, index: number): void {
  state.snap.current?.cancel();
  void runOnBackground(state.onPage)(index);
  state.snap.current = lynxTween({
    from: state.pos.current,
    to: index,
    duration: 240,
    easing: ease,
    onUpdate: (pos) => moveTo(state, pos),
  });
}

export const swiperStart = defineWorklet<MainThreadTouchEvent, SwiperState>(function swiperStartMT(ctx) {
  const state = ctx.params;
  const point = touchPoint(ctx.event);
  if (!point || state.start.current) return;
  state.snap.current?.cancel();
  state.snap.current = null;
  state.start.current = { x: point.x, pos: state.pos.current };
  lockPage(state.page);
});

export const swiperMove = defineWorklet<MainThreadTouchEvent, SwiperState>(function swiperMoveMT(ctx) {
  const state = ctx.params;
  const start = state.start.current;
  const point = touchPoint(ctx.event);
  if (!start || !point) return;
  const pos = start.pos - (point.x - start.x) / state.width;
  moveTo(state, Math.min(state.count - 1, Math.max(0, pos)));
});

export const swiperEnd = defineWorklet<MainThreadTouchEvent, SwiperState>(function swiperEndMT(ctx) {
  const state = ctx.params;
  const start = state.start.current;
  if (!start) return;
  state.start.current = null;
  unlockPage(state.page);
  // Past the threshold either way turns one page from where the drag started.
  const moved = (start.pos - state.pos.current) * state.width;
  const from = Math.round(start.pos);
  let index = from;
  if (moved <= -state.threshold) index = Math.min(state.count - 1, from + 1);
  else if (moved >= state.threshold) index = Math.max(0, from - 1);
  settle(state, index);
});

/** Go to a page from the Background Thread: a dot, or autoplay. Not mid-drag. */
export const swiperGoTo = defineMainThreadFunction(function swiperGoToMT(state: SwiperState, index: number) {
  if (state.start.current) return;
  settle(state, index);
});
