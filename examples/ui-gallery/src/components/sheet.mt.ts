/**
 * Sheet's Main-Thread half: the panel follows the finger down from here, and
 * springs back from here too. The component hears only that it should close.
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

export interface SheetState {
  page: MainThreadRef<MainThreadElement | null>;
  panel: MainThreadRef<MainThreadElement | null>;
  /** The finger's y when the drag started, or null between drags. */
  startY: MainThreadRef<number | null>;
  /** How far down the panel is, in px. */
  dragY: MainThreadRef<number>;
  spring: MainThreadRef<LynxAnimationHandle | null>;
  /** How far down a release closes the sheet. */
  closeAt: number;
  onClose: BackgroundFunctionHandle<[], void>;
}

function moveTo(state: SheetState, y: number): void {
  state.dragY.current = y;
  state.panel.current?.setStyleProperty('transform', `translateY(${y}px)`);
}

export const sheetStart = defineWorklet<MainThreadTouchEvent, SheetState>(function sheetStartMT(ctx) {
  const state = ctx.params;
  const point = touchPoint(ctx.event);
  if (!point || state.startY.current != null) return;
  state.spring.current?.cancel();
  state.spring.current = null;
  state.startY.current = point.y - (state.dragY.current ?? 0);
  lockPage(state.page);
});

export const sheetMove = defineWorklet<MainThreadTouchEvent, SheetState>(function sheetMoveMT(ctx) {
  const state = ctx.params;
  const startY = state.startY.current;
  const point = touchPoint(ctx.event);
  if (startY == null || !point) return;
  // Only a downward drag moves the sheet, as in lynx-ui: no rubber band upwards.
  moveTo(state, Math.max(0, point.y - startY));
});

export const sheetEnd = defineWorklet<MainThreadTouchEvent, SheetState>(function sheetEndMT(ctx) {
  const state = ctx.params;
  if (state.startY.current == null) return;
  state.startY.current = null;
  unlockPage(state.page);
  const from = state.dragY.current ?? 0;
  if (from > state.closeAt) {
    // The next opening is a new panel, at the top.
    state.dragY.current = 0;
    void runOnBackground(state.onClose)();
    return;
  }
  state.spring.current = lynxTween({
    from,
    to: 0,
    duration: 220,
    easing: ease,
    onUpdate: (y) => moveTo(state, y),
  });
});
