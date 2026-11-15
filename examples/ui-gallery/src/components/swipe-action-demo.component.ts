import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import { lockDrag, unlockDrag } from '../drag-lock.service.js';

interface SwipeRow {
  id: number;
  label: string;
  /** Current content-layer translateX, in px (0 = closed, negative = open). */
  offset: number;
}

const ACTION_WIDTH = 88;

/**
 * A recreation of `@lynx-js/lynx-ui`'s `<SwipeAction>` primitive
 * (https://lynxjs.org/next/ui/components/swipe-action.html) — swipe a row to
 * reveal a hidden action — for ng-lynx.
 *
 * Each row is a `displayArea` (the swipeable content) stacked over an
 * `actionArea` (the revealed action button). The touch listeners are bound
 * to the row's static outer container, same reasoning as the other demos:
 * `detail.x` needs a fixed frame, not one that moves with the content layer.
 * Only one row is open at a time — opening a new row closes any other, the
 * common swipe-list convention.
 *
 * `catch`-prefixed, not bubbling `bind` — see draggable-demo's doc comment
 * for why: a touch here would otherwise also scroll the ancestor
 * `.app-scroll` underneath the list, found on a real device. `catch` alone
 * wasn't enough there either, so `onStart`/`onEnd` also call
 * `lockDrag()`/`unlockDrag()` (`drag-lock.service.ts`), which is what
 * actually gates `.app-scroll`'s `[enable-scroll]`.
 */
@Component({
  selector: 'swipe-action-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="demo-card">
      <text class="demo-title">SwipeAction</text>
      <text class="demo-desc">Swipe a row left to reveal Delete.</text>

      <view class="swipe-list">
        @for (row of rows(); track row.id) {
          <view
            class="swipe-row"
            (catchtouchstart)="onStart(row, $event)"
            (catchtouchmove)="onMove(row, $event)"
            (catchtouchend)="onEnd(row)"
          >
            <view class="swipe-action-area">
              <view class="swipe-action-btn" (tap)="deleteRow(row.id)">
                <text class="swipe-action-btn-label">Delete</text>
              </view>
            </view>
            <view class="swipe-display-area" [style.transform]="'translateX(' + row.offset + 'px)'">
              <text class="swipe-display-label">{{ row.label }}</text>
            </view>
          </view>
        } @empty {
          <text class="demo-desc">No rows left — reload to reset.</text>
        }
      </view>
    </view>
  `,
})
export class SwipeActionDemoComponent {
  protected readonly rows = signal<SwipeRow[]>([
    { id: 1, label: 'Inbox message #1', offset: 0 },
    { id: 2, label: 'Inbox message #2', offset: 0 },
    { id: 3, label: 'Inbox message #3', offset: 0 },
  ]);

  private draggingId: number | null = null;
  private startPointerX = 0;
  private startOffset = 0;

  protected onStart(row: SwipeRow, event: { detail?: { x?: number } }): void {
    const x = event.detail?.x;
    if (typeof x !== 'number') return;
    this.draggingId = row.id;
    lockDrag();
    this.startPointerX = x;
    this.startOffset = row.offset;
  }

  protected onMove(row: SwipeRow, event: { detail?: { x?: number } }): void {
    if (this.draggingId !== row.id) return;
    const x = event.detail?.x;
    if (typeof x !== 'number') return;
    const next = Math.min(0, Math.max(-ACTION_WIDTH, this.startOffset + (x - this.startPointerX)));
    this.setOffset(row.id, next);
  }

  protected onEnd(row: SwipeRow): void {
    if (this.draggingId !== row.id) return;
    this.draggingId = null;
    unlockDrag();
    const open = row.offset < -ACTION_WIDTH / 2;
    this.setOffset(row.id, open ? -ACTION_WIDTH : 0);
    // Opening one row closes every other (single-row-open convention).
    if (open) {
      for (const r of this.rows()) if (r.id !== row.id) this.setOffset(r.id, 0);
    }
  }

  protected deleteRow(id: number): void {
    this.rows.update((rows) => rows.filter((r) => r.id !== id));
  }

  private setOffset(id: number, offset: number): void {
    this.rows.update((rows) => rows.map((r) => (r.id === id ? { ...r, offset } : r)));
  }
}
