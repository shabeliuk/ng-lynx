import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

import { LYNX_ELEMENTS } from 'angular-lynx/elements';

import { lockDrag, unlockDrag } from '../drag-lock.service.js';

const ITEM_HEIGHT = 52;

/**
 * A recreation of `@lynx-js/lynx-ui`'s `<SortableRoot>`/`<SortableItem>`
 * primitives (https://lynxjs.org/next/ui/components/sortable.html) — drag a
 * handle to reorder a list — for angular-lynx. Built directly on the same
 * touch-driven approach as Draggable (the real component composes `Draggable`
 * internally too).
 *
 * The algorithm: `startIndex` and the drag's start pointer Y are fixed for
 * the whole gesture. On every move, `desiredIndex` is recomputed from scratch
 * (`startIndex + round(totalDy / itemHeight)`, clamped) — whenever it differs
 * from the item's current position, the array is reordered and the dragged
 * item's *visual* offset is reduced by exactly the distance just "consumed"
 * by that reorder. That keeps the dragged item tracking the finger smoothly
 * while the list underneath reorders in discrete, item-height steps — the
 * standard drag-to-reorder technique.
 *
 * The handle's touch listeners are `catch`-prefixed, not bubbling `bind` —
 * see draggable-demo's doc comment for why: on a real device this list sits
 * inside `.app-scroll`, and reordering vertically also scrolled the whole
 * page underneath it at the same time without `catch`. `catch` alone wasn't
 * enough there either, so `onStart`/`onEnd` also call
 * `lockDrag()`/`unlockDrag()` (`drag-lock.service.ts`), which is what
 * actually gates `.app-scroll`'s `[enable-scroll]`.
 */
@Component({
  selector: 'sortable-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="demo-card">
      <text class="demo-title">Sortable</text>
      <text class="demo-desc">Drag a handle (≡) to reorder the list.</text>

      <view class="sortable-list">
        @for (item of items(); track item.id; let i = $index) {
          <view
            class="sortable-item"
            [class.sortable-item-dragging]="draggingId() === item.id"
            [style.transform]="draggingId() === item.id ? 'translateY(' + visualOffset() + 'px)' : ''"
          >
            <view
              class="sortable-handle"
              (catchtouchstart)="onStart(item.id, i, $event)"
              (catchtouchmove)="onMove($event)"
              (catchtouchend)="onEnd()"
            >
              <text class="sortable-handle-icon">≡</text>
            </view>
            <text class="sortable-item-label">{{ item.label }}</text>
          </view>
        }
      </view>
    </view>
  `,
})
export class SortableDemoComponent {
  protected readonly items = signal(
    Array.from({ length: 5 }, (_, i) => ({ id: i + 1, label: `Item ${i + 1}` })),
  );

  protected readonly draggingId = signal<number | null>(null);
  protected readonly visualOffset = signal(0);

  private startPointerY = 0;
  private startIndex = 0;
  private currentIndex = 0;

  protected onStart(id: number, index: number, event: { detail?: { y?: number } }): void {
    const y = event.detail?.y;
    if (typeof y !== 'number') return;
    this.draggingId.set(id);
    lockDrag();
    this.startPointerY = y;
    this.startIndex = index;
    this.currentIndex = index;
    this.visualOffset.set(0);
  }

  protected onMove(event: { detail?: { y?: number } }): void {
    if (this.draggingId() === null) return;
    const y = event.detail?.y;
    if (typeof y !== 'number') return;
    const totalDy = y - this.startPointerY;
    const len = this.items().length;
    const desiredIndex = Math.min(len - 1, Math.max(0, this.startIndex + Math.round(totalDy / ITEM_HEIGHT)));

    if (desiredIndex !== this.currentIndex) {
      this.items.update((items) => {
        const next = items.slice();
        const [moved] = next.splice(this.currentIndex, 1);
        next.splice(desiredIndex, 0, moved);
        return next;
      });
      this.currentIndex = desiredIndex;
    }

    // The remainder beyond the item-heights already consumed by reordering.
    this.visualOffset.set(totalDy - (this.currentIndex - this.startIndex) * ITEM_HEIGHT);
  }

  protected onEnd(): void {
    if (this.draggingId() === null) return;
    this.draggingId.set(null);
    unlockDrag();
    this.visualOffset.set(0);
  }
}
