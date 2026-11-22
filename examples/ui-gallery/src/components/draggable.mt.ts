/**
 * Draggable's Main-Thread half: the box follows the finger from here, with no
 * round trip to the Background Thread on each move. The component only hears the
 * position, for its label.
 */
import {
  type BackgroundFunctionHandle,
  defineWorklet,
  type LynxAnimationHandle,
  lynxTween,
  type MainThreadElement,
  type MainThreadRef,
  type MainThreadTouchEvent,
  runOnBackground,
} from 'ng-lynx/worklet';

import { ease, lockPage, touchPoint, unlockPage } from '../page-lock.mt.js';

export interface DraggableState {
  page: MainThreadRef<MainThreadElement | null>;
  box: MainThreadRef<MainThreadElement | null>;
  /** Where the finger and the box were when the drag started. */
  start: MainThreadRef<{ x: number; y: number; tx: number; ty: number } | null>;
  /** The box's offset in the field, in px. */
  tx: MainThreadRef<number>;
  ty: MainThreadRef<number>;
  reset: MainThreadRef<LynxAnimationHandle | null>;
  maxTy: number;
  resetOnEnd: boolean;
  onMove: BackgroundFunctionHandle<[number, number], void>;
}

function place(state: DraggableState, tx: number, ty: number): void {
  state.tx.current = tx;
  state.ty.current = ty;
  state.box.current?.setStyleProperty('transform', `translate(${tx}px, ${ty}px)`);
  void runOnBackground(state.onMove)(Math.round(tx), Math.round(ty));
}

export const draggableStart = defineWorklet<MainThreadTouchEvent, DraggableState>(function draggableStartMT(ctx) {
  const state = ctx.params;
  const point = touchPoint(ctx.event);
  if (!point || state.start.current) return;
  state.reset.current?.cancel();
  state.reset.current = null;
  state.start.current = { ...point, tx: state.tx.current, ty: state.ty.current };
  lockPage(state.page);
});

export const draggableMove = defineWorklet<MainThreadTouchEvent, DraggableState>(function draggableMoveMT(ctx) {
  const state = ctx.params;
  const start = state.start.current;
  const point = touchPoint(ctx.event);
  if (!start || !point) return;
  // No horizontal clamp: the field's width isn't fixed, and `overflow: hidden`
  // clips any overshoot (see the component's doc).
  const tx = Math.max(0, start.tx + point.x - start.x);
  const ty = Math.min(state.maxTy, Math.max(0, start.ty + point.y - start.y));
  place(state, tx, ty);
});

export const draggableEnd = defineWorklet<MainThreadTouchEvent, DraggableState>(function draggableEndMT(ctx) {
  const state = ctx.params;
  if (!state.start.current) return;
  state.start.current = null;
  unlockPage(state.page);
  if (!state.resetOnEnd) return;
  const fromX = state.tx.current;
  const fromY = state.ty.current;
  state.reset.current = lynxTween({
    from: 1,
    to: 0,
    duration: 200,
    easing: ease,
    onUpdate: (k) => place(state, fromX * k, fromY * k),
  });
});
