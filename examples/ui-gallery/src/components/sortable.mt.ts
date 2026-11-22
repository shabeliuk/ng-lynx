/**
 * Sortable's Main-Thread half. Every item sits in a slot, `translateY(slot *
 * itemHeight)`, so reordering is moving transforms, all from here: the dragged
 * item follows the finger, and the others step into their new slots as it
 * passes them. The component hears the new order when the finger lifts.
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

export interface SortableState {
  page: MainThreadRef<MainThreadElement | null>;
  /** Each item's element, by id. */
  items: Record<number, MainThreadRef<MainThreadElement | null>>;
  /** The ids in slot order: the Main Thread's copy of the order. */
  order: MainThreadRef<number[]>;
  /** The drag, or null between drags. */
  drag: MainThreadRef<{ id: number; y: number; from: number; slot: number; at: number } | null>;
  /** The dropped item settling into its slot. Cancelling it puts it there at once. */
  drop: MainThreadRef<LynxAnimationHandle | null>;
  itemHeight: number;
  onReorder: BackgroundFunctionHandle<[number[]], void>;
  /** The item whose handle this binding is on. */
  id: number;
}

function placeAt(state: SortableState, id: number, y: number): void {
  state.items[id]?.current?.setStyleProperty('transform', `translateY(${y}px)`);
}

export const sortableStart = defineWorklet<MainThreadTouchEvent, SortableState>(function sortableStartMT(ctx) {
  const state = ctx.params;
  const point = touchPoint(ctx.event);
  if (!point || state.drag.current) return;
  state.drop.current?.cancel();
  state.drop.current = null;
  const slot = state.order.current.indexOf(state.id);
  state.drag.current = { id: state.id, y: point.y, from: slot, slot, at: slot * state.itemHeight };
  // Dimmed, so it reads as lifted. Not raised with z-index: on iOS (Explorer 4.2)
  // an absolutely placed item with a z-index is drawn about 20px off, from
  // another parent. The items it passes step aside at the halfway point.
  state.items[state.id]?.current?.setStyleProperty('opacity', '0.85');
  lockPage(state.page);
});

export const sortableMove = defineWorklet<MainThreadTouchEvent, SortableState>(function sortableMoveMT(ctx) {
  const state = ctx.params;
  const drag = state.drag.current;
  const point = touchPoint(ctx.event);
  if (!drag || !point) return;
  const order = state.order.current;
  const h = state.itemHeight;
  const dy = Math.min((order.length - 1 - drag.from) * h, Math.max(-drag.from * h, point.y - drag.y));
  const slot = drag.from + Math.round(dy / h);
  if (slot !== drag.slot) {
    order.splice(drag.slot, 1);
    order.splice(slot, 0, drag.id);
    drag.slot = slot;
    // The items it passed step into their new slots.
    order.forEach((id, i) => {
      if (id !== drag.id) placeAt(state, id, i * h);
    });
  }
  drag.at = drag.from * h + dy;
  placeAt(state, drag.id, drag.at);
});

export const sortableEnd = defineWorklet<MainThreadTouchEvent, SortableState>(function sortableEndMT(ctx) {
  const state = ctx.params;
  const drag = state.drag.current;
  if (!drag) return;
  state.drag.current = null;
  unlockPage(state.page);
  const el = state.items[drag.id]?.current;
  const to = drag.slot * state.itemHeight;
  const settled = (): void => {
    placeAt(state, drag.id, to);
    el?.setStyleProperty('opacity', '1');
  };
  const tween = lynxTween({
    from: drag.at,
    to,
    duration: 120,
    easing: ease,
    onUpdate: (y) => placeAt(state, drag.id, y),
    onFinish: settled,
  });
  state.drop.current = {
    cancel: () => {
      tween.cancel();
      settled();
    },
  };
  void runOnBackground(state.onReorder)(state.order.current.slice());
});
