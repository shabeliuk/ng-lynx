import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { bindWorklet, LynxMainThread, LynxMainThreadRef, mainThreadRef, runOnMainThread, type ToMainThread } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';
import type { MainThreadElement } from 'ng-lynx/worklet';

import { pageScroll } from '../page-lock.js';
import { swipeRowEnd, swipeRowForget, swipeRowMove, swipeRowStart, type SwipeRowState } from './swipe-action.mt.js';

/** `.swipe-action-area`'s width in `app.css`. */
const ACTION_WIDTH = 88;

/**
 * One swipeable row: its content (`displayArea`) stacked over its action
 * (`actionArea`). A component of its own so that each row has its own
 * Main-Thread refs.
 *
 * The touch worklets are bound to the row's **static outer view**, not the
 * moving content, and use the touch's page position, so every reading is in
 * one frame.
 */
@Component({
  selector: 'swipe-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, LynxMainThread, LynxMainThreadRef],
  template: `
    <view class="swipe-row" [lynxMainThread]="touchEvents()">
      <view class="swipe-action-area">
        <view class="swipe-action-btn" (tap)="delete.emit()">
          <text class="swipe-action-btn-label">Delete</text>
        </view>
      </view>
      <view class="swipe-display-area" [lynxMainThreadRef]="display">
        <text class="swipe-display-label">{{ label() }}</text>
      </view>
    </view>
  `,
})
export class SwipeRowComponent {
  readonly label = input.required<string>();
  /** The list's shared "which row is open" ref. */
  readonly openRow = input.required<ToMainThread<SwipeRowState['openRow']>>();
  readonly delete = output();

  protected readonly display = mainThreadRef<MainThreadElement | null>();
  private readonly start = mainThreadRef<SwipeRowState['start']['current']>(null);
  private readonly offset = mainThreadRef(0);
  private readonly snap = mainThreadRef<SwipeRowState['snap']['current']>(null);

  protected readonly touchEvents = computed(() => {
    const state: ToMainThread<SwipeRowState> = {
      page: pageScroll,
      display: this.display,
      start: this.start,
      offset: this.offset,
      snap: this.snap,
      openRow: this.openRow(),
      actionWidth: ACTION_WIDTH,
    };
    return {
      touchstart: bindWorklet(swipeRowStart, state),
      touchmove: bindWorklet(swipeRowMove, state),
      touchend: bindWorklet(swipeRowEnd, state),
      touchcancel: bindWorklet(swipeRowEnd, state),
    };
  });
}

/**
 * A recreation of `@lynx-js/lynx-ui`'s `<SwipeAction>` primitive
 * (https://lynxjs.org/next/ui/components/swipe-action.html), swipe a row to
 * reveal a hidden action, for ng-lynx.
 *
 * **The drag runs on the Main Thread** (`swipe-action.mt.ts`): touch worklets
 * move a row's content with `setStyleProperty` and snap it open or closed with
 * `lynxTween`, so Angular never binds its `transform`. Only one row is open at
 * a time: opening a row closes the other there too, through a ref the rows
 * share. Delete is an ordinary `(tap)`. The drag stops the page scrolling until
 * it ends (`page-lock.ts`).
 */
@Component({
  selector: 'swipe-action-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, SwipeRowComponent],
  template: `
    <view class="demo-card">
      <text class="demo-title">SwipeAction</text>
      <text class="demo-desc">Swipe a row left to reveal Delete.</text>

      <view class="swipe-list">
        @for (row of rows(); track row.id) {
          <swipe-row [label]="row.label" [openRow]="openRow" (delete)="deleteRow(row.id)" />
        } @empty {
          <text class="demo-desc">No rows left — reload to reset.</text>
        }
      </view>
    </view>
  `,
})
export class SwipeActionDemoComponent {
  protected readonly rows = signal([
    { id: 1, label: 'Inbox message #1' },
    { id: 2, label: 'Inbox message #2' },
    { id: 3, label: 'Inbox message #3' },
  ]);

  protected readonly openRow = mainThreadRef<SwipeRowState['openRow']['current']>(null);

  protected deleteRow(id: number): void {
    // Only an open row shows Delete, so the open row is the one going.
    void runOnMainThread(swipeRowForget)(this.openRow);
    this.rows.update((rows) => rows.filter((r) => r.id !== id));
  }
}
