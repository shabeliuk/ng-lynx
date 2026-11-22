/**
 * The tutorial's Main-Thread scrollbar: the list's `scroll` runs here, and the
 * thumb moves in the same frame, however busy the Background Thread is.
 */
import { defineWorklet, type MainThreadElement, type MainThreadRef } from 'ng-lynx/worklet';

export interface ScrollbarState {
  thumb: MainThreadRef<MainThreadElement | null>;
  listHeight: number;
}

export const adjustScrollbar = defineWorklet<unknown, ScrollbarState>(function adjustScrollbarMT(ctx) {
  const { scrollTop, scrollHeight } = (ctx.event as { detail: { scrollTop: number; scrollHeight: number } }).detail;
  const { thumb, listHeight } = ctx.params;
  if (!scrollHeight) return;
  const scrollbarHeight = listHeight * (listHeight / scrollHeight);
  const scrollbarTop = listHeight * (scrollTop / scrollHeight);
  thumb.current?.setStyleProperties({ height: `${scrollbarHeight}px`, top: `${scrollbarTop}px` });
});
