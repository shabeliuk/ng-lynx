/**
 * SwipeAction's Main-Thread half: a row's content follows the finger and snaps
 * open or closed from here. Opening a row closes the one that was open, through
 * `openRow`, a ref every row shares, so that stays on the Main Thread too.
 */
import {
  defineMainThreadFunction,
  defineWorklet,
  type LynxAnimationHandle,
  lynxTween,
  type MainThreadElement,
  type MainThreadRef,
  type MainThreadTouchEvent,
} from 'ng-lynx/worklet';

import { ease, lockPage, touchPoint, unlockPage } from '../page-lock.mt.js';

/** One row's Main-Thread state. */
interface RowRefs {
  display: MainThreadRef<MainThreadElement | null>;
  /** The content's translateX, in px: 0 is closed, `-actionWidth` open. */
  offset: MainThreadRef<number>;
  snap: MainThreadRef<LynxAnimationHandle | null>;
}

export interface SwipeRowState extends RowRefs {
  page: MainThreadRef<MainThreadElement | null>;
  /** The finger's x and the row's offset when the drag started, or null between drags. */
  start: MainThreadRef<{ x: number; offset: number } | null>;
  /** The open row, shared by every row of the list. */
  openRow: MainThreadRef<RowRefs | null>;
  actionWidth: number;
}

function moveTo(row: RowRefs, offset: number): void {
  row.offset.current = offset;
  row.display.current?.setStyleProperty('transform', `translateX(${offset}px)`);
}

function snapTo(row: RowRefs, offset: number): void {
  row.snap.current?.cancel();
  row.snap.current = lynxTween({
    from: row.offset.current,
    to: offset,
    duration: 180,
    easing: ease,
    onUpdate: (x) => moveTo(row, x),
  });
}

export const swipeRowStart = defineWorklet<MainThreadTouchEvent, SwipeRowState>(function swipeRowStartMT(ctx) {
  const state = ctx.params;
  const point = touchPoint(ctx.event);
  if (!point || state.start.current) return;
  state.snap.current?.cancel();
  state.snap.current = null;
  state.start.current = { x: point.x, offset: state.offset.current };
  lockPage(state.page);
});

export const swipeRowMove = defineWorklet<MainThreadTouchEvent, SwipeRowState>(function swipeRowMoveMT(ctx) {
  const state = ctx.params;
  const start = state.start.current;
  const point = touchPoint(ctx.event);
  if (!start || !point) return;
  moveTo(state, Math.min(0, Math.max(-state.actionWidth, start.offset + point.x - start.x)));
});

export const swipeRowEnd = defineWorklet<MainThreadTouchEvent, SwipeRowState>(function swipeRowEndMT(ctx) {
  const state = ctx.params;
  if (!state.start.current) return;
  state.start.current = null;
  unlockPage(state.page);
  const open = state.offset.current < -state.actionWidth / 2;
  snapTo(state, open ? -state.actionWidth : 0);
  const other = state.openRow.current;
  if (open) {
    // One row open at a time, the usual swipe-list convention.
    if (other && other.offset !== state.offset) snapTo(other, 0);
    state.openRow.current = { display: state.display, offset: state.offset, snap: state.snap };
  } else if (other?.offset === state.offset) {
    state.openRow.current = null;
  }
});

/** Forget the open row: it's being deleted. */
export const swipeRowForget = defineMainThreadFunction(function swipeRowForgetMT(openRow: MainThreadRef<RowRefs | null>) {
  openRow.current = null;
});
