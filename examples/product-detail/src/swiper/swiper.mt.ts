/**
 * The swiper's Main-Thread half: `useOffset` and `useAnimate` from the official
 * Product Detail tutorial (https://lynxjs.org/learn/product-detail), Copyright The
 * Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
 *
 * The tutorial's worklets are closures, so each `<Swiper>` has its own refs and
 * callbacks. An Angular build can't extract a closure (docs/11-worklets.md), so the
 * same state arrives as `ctx.params`, from `bindWorklet` in `swiper.component.ts`.
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

/** What the handlers of one swiper share. The refs live on the Main Thread. */
export interface SwiperState {
  container: MainThreadRef<MainThreadElement | null>;
  touchStartX: MainThreadRef<number>;
  touchStartOffset: MainThreadRef<number>;
  offset: MainThreadRef<number>;
  index: MainThreadRef<number>;
  animation: MainThreadRef<LynxAnimationHandle | null>;
  itemWidth: number;
  count: number;
  duration: number;
  easing: (t: number) => number;
  onIndexChange: BackgroundFunctionHandle<[number], void>;
}

function moveTo(state: SwiperState, offset: number): void {
  const lowerBound = -(state.count - 1) * state.itemWidth;
  const realOffset = Math.min(0, Math.max(lowerBound, offset));
  state.offset.current = realOffset;
  state.container.current?.setStyleProperty('transform', `translateX(${realOffset}px)`);

  const index = Math.round(-realOffset / state.itemWidth);
  if (state.index.current !== index) {
    state.index.current = index;
    void runOnBackground(state.onIndexChange)(index);
  }
}

function cancelSnap(state: SwiperState): void {
  state.animation.current?.cancel();
  state.animation.current = null;
}

export const onTouchStart = defineWorklet<MainThreadTouchEvent, SwiperState>(function swiperTouchStartMT(ctx) {
  const state = ctx.params;
  state.touchStartX.current = ctx.event.touches[0]!.clientX;
  state.touchStartOffset.current = state.offset.current;
  cancelSnap(state);
});

export const onTouchMove = defineWorklet<MainThreadTouchEvent, SwiperState>(function swiperTouchMoveMT(ctx) {
  const state = ctx.params;
  const deltaX = ctx.event.touches[0]!.clientX - state.touchStartX.current;
  moveTo(state, state.touchStartOffset.current + deltaX);
});

/** Settle on the nearest page, with this swiper's duration and easing. */
export const onTouchEnd = defineWorklet<MainThreadTouchEvent, SwiperState>(function swiperTouchEndMT(ctx) {
  const state = ctx.params;
  const nearestPage = Math.round(state.offset.current / state.itemWidth) * state.itemWidth;
  state.animation.current = lynxTween({
    from: state.offset.current,
    to: nearestPage,
    duration: state.duration,
    easing: state.easing,
    onUpdate: (offset) => moveTo(state, offset),
  });
});

/** Jump to a page from the Background Thread: a tap on the indicator. */
export const goToIndex = defineMainThreadFunction(function swiperGoToIndexMT(state: SwiperState, index: number) {
  cancelSnap(state);
  moveTo(state, -index * state.itemWidth);
});

/** The default snap. */
export const linear = defineMainThreadFunction(function linearMT(t: number) {
  return t;
});

/** The tutorial's easing, passed to a swiper as an input. */
export const easeInOut = defineMainThreadFunction(function easeInOutMT(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
});
