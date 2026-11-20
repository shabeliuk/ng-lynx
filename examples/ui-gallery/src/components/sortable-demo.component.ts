import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import { backgroundFunction, bindWorklet, LynxMainThread, LynxMainThreadRef, mainThreadRef, type ToMainThread } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';
import type { MainThreadElement } from 'ng-lynx/worklet';

import { pageScroll } from '../page-lock.js';
import { sortableEnd, sortableMove, sortableStart, type SortableState } from './sortable.mt.js';

/** `.sortable-item`'s height in `app.css`. */
const ITEM_HEIGHT = 52;

/**
 * A recreation of `@lynx-js/lynx-ui`'s `<SortableRoot>`/`<SortableItem>`
 * primitives (https://lynxjs.org/next/ui/components/sortable.html), drag a
 * handle to reorder a list, for ng-lynx.
 *
 * **The drag runs on the Main Thread** (`sortable.mt.ts`). Each item is placed
 * absolutely in a slot, `translateY(slot * 52px)`, so a reorder moves
 * transforms and never the elements themselves. While the finger is down the
 * worklets keep their own copy of the order: the dragged item follows the
 * finger, and each item it passes steps into its new slot. On release the new
 * order comes back through a `backgroundFunction`, and Angular's bindings write
 * the same slots the worklets already set. So nothing waits for the Background
 * Thread mid-drag, and nothing jumps when it catches up, as it would if the
 * array were reordered under the finger.
 *
 * The worklets are bound to each item's handle, with the item's id as a
 * `bindWorklet` param. The drag stops the page scrolling until it ends
 * (`page-lock.ts`).
 */
@Component({
  selector: 'sortable-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, LynxMainThread, LynxMainThreadRef],
  template: `
    <view class="demo-card">
      <text class="demo-title">Sortable</text>
      <text class="demo-desc">Drag a handle (≡) to reorder the list.</text>

      <view class="sortable-list" [style.height.px]="items.length * itemHeight">
        @for (item of items; track item.id) {
          <view
            class="sortable-item"
            [lynxMainThreadRef]="item.ref"
            [style.transform]="'translateY(' + slotOf()[item.id]! * itemHeight + 'px)'"
          >
            <view class="sortable-handle" [lynxMainThread]="handleEvents()[item.id]!">
              <text class="sortable-handle-icon">≡</text>
            </view>
            <text class="sortable-item-label">{{ item.label }}</text>
          </view>
        }
      </view>
      <text class="demo-desc">Order: {{ orderLabel() }}</text>
    </view>
  `,
})
export class SortableDemoComponent {
  protected readonly itemHeight = ITEM_HEIGHT;
  protected readonly items = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    label: `Item ${i + 1}`,
    ref: mainThreadRef<MainThreadElement | null>(),
  }));

  /** The ids in slot order, as of the last drop. */
  private readonly order = signal(this.items.map((item) => item.id));
  protected readonly slotOf = computed(() => Object.fromEntries(this.order().map((id, slot) => [id, slot])));
  protected readonly orderLabel = computed(() => this.order().join(' '));

  private readonly mtOrder = mainThreadRef(this.order());
  private readonly drag = mainThreadRef<SortableState['drag']['current']>(null);
  private readonly drop = mainThreadRef<SortableState['drop']['current']>(null);
  private readonly onReorder = backgroundFunction((ids: number[]) => this.order.set(ids));

  protected readonly handleEvents = computed(() => {
    const shared: Omit<ToMainThread<SortableState>, 'id'> = {
      page: pageScroll,
      items: Object.fromEntries(this.items.map((item) => [item.id, item.ref])),
      order: this.mtOrder,
      drag: this.drag,
      drop: this.drop,
      itemHeight: ITEM_HEIGHT,
      onReorder: this.onReorder,
    };
    return Object.fromEntries(
      this.items.map((item) => {
        const state = { ...shared, id: item.id };
        return [
          item.id,
          {
            touchstart: bindWorklet(sortableStart, state),
            touchmove: bindWorklet(sortableMove, state),
            touchend: bindWorklet(sortableEnd, state),
            touchcancel: bindWorklet(sortableEnd, state),
          },
        ];
      }),
    );
  });
}
