/**
 * Stop the page's `<scroll-view>` scrolling while any demo is mid-drag (see
 * `page-lock.ts`). A counter, so two overlapping drags, or a `touchend` that never
 * comes for one, can't leave the page locked or unlocked wrongly: each demo locks
 * once when its drag starts, and unlocks once when it ends or is cancelled.
 */
import type { MainThreadElement, MainThreadRef } from 'ng-lynx/worklet';

let locks = 0;

export function lockPage(page: MainThreadRef<MainThreadElement | null>): void {
  if (locks++ === 0) page.current?.setAttribute('enable-scroll', false);
}

export function unlockPage(page: MainThreadRef<MainThreadElement | null>): void {
  if (locks === 0) return;
  if (--locks === 0) page.current?.setAttribute('enable-scroll', true);
}

/** The first touch's position on the page. Deltas are all the demos need. */
export function touchPoint(event: { touches: readonly { clientX: number; clientY: number }[] }): { x: number; y: number } | null {
  const t = event.touches[0];
  return t ? { x: t.clientX, y: t.clientY } : null;
}

/** CSS `ease`, near enough, for the snaps the demos used to leave to `transition`. */
export function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
