import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import { backgroundFunction, bindWorklet, LynxMainThread, LynxMainThreadRef, mainThreadRef, type ToMainThread } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';
import type { MainThreadElement } from 'ng-lynx/worklet';

import { pageScroll } from '../page-lock.js';
import { draggableEnd, draggableMove, draggableStart, type DraggableState } from './draggable.mt.js';

/**
 * A recreation of `@lynx-js/lynx-ui`'s `<Draggable>` primitive
 * (https://lynxjs.org/next/ui/components/draggable.html), free-form
 * drag-within-bounds, for ng-lynx.
 *
 * **The drag runs on the Main Thread** (`draggable.mt.ts`): touch worklets move
 * the box with `setStyleProperty`, so it keeps up with the finger however busy
 * the Background Thread is. Angular never binds the box's `transform`; it hears
 * the position through a `backgroundFunction`, for the label, and passes
 * "Reset on release" to the worklets as a `bindWorklet` param. The real
 * component uses the native gesture detector (`[lynxGesture]`); touch events
 * are simpler and work the same in the web preview.
 *
 * **Keeping the page still.** The field declares `pan-intercept-direction="1"`
 * (vertical) and `pan-intercept-scope="1"` (ancestors), with `flatten` off, as
 * Android may need. On the iOS simulator that alone kept the page still, but
 * on a real iPhone (Explorer 4.2) picking the box up sometimes scrolled the
 * page too: in the engine's source, iOS picks the direction once, after 10px.
 * So the drag also turns the page's scrolling off from the Main Thread until it
 * ends or is cancelled (`page-lock.ts`).
 *
 * The touch worklets are bound to the **static field**, not the moving box, and
 * use the touch's page position, so every reading is in one frame.
 *
 * **Clamping.** `.draggable-field`'s height is a fixed 220px in `app.css`, so the
 * vertical clamp uses that constant. Its width stretches with the screen, so there
 * is no horizontal clamp: the field has `overflow: hidden`, and a box dragged past
 * the right edge is clipped.
 */
const FIELD_HEIGHT = 220;
/** `.draggable-box`'s width and height in `app.css`. */
const BOX_SIZE = 64;

@Component({
  selector: 'draggable-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, LynxMainThread, LynxMainThreadRef],
  template: `
    <view class="demo-card">
      <text class="demo-title">Draggable</text>
      <text class="demo-desc">Drag the box anywhere inside the field.</text>

      <view
        class="demo-toggle"
        [class.demo-toggle-on]="resetOnEnd()"
        (tap)="resetOnEnd.set(!resetOnEnd())"
      >
        <text class="demo-toggle-label">Reset on release: {{ resetOnEnd() ? 'On' : 'Off' }}</text>
      </view>

      <view
        class="draggable-field"
        [pan-intercept-direction]="1"
        [pan-intercept-scope]="1"
        [flatten]="false"
        [lynxMainThread]="touchEvents()"
      >
        <view class="draggable-box" [lynxMainThreadRef]="box">
          <text class="draggable-box-label">{{ label() }}</text>
        </view>
      </view>
    </view>
  `,
})
export class DraggableDemoComponent {
  protected readonly resetOnEnd = signal(true);
  private readonly position = signal<[number, number]>([0, 0]);
  protected readonly label = computed(() => this.position().join(', '));

  protected readonly box = mainThreadRef<MainThreadElement | null>();
  private readonly start = mainThreadRef<DraggableState['start']['current']>();
  private readonly tx = mainThreadRef(0);
  private readonly ty = mainThreadRef(0);
  private readonly reset = mainThreadRef<DraggableState['reset']['current']>();
  private readonly onMove = backgroundFunction((x: number, y: number) => this.position.set([x, y]));

  protected readonly touchEvents = computed(() => {
    const state: ToMainThread<DraggableState> = {
      page: pageScroll,
      box: this.box,
      start: this.start,
      tx: this.tx,
      ty: this.ty,
      reset: this.reset,
      maxTy: FIELD_HEIGHT - BOX_SIZE,
      resetOnEnd: this.resetOnEnd(),
      onMove: this.onMove,
    };
    return {
      touchstart: bindWorklet(draggableStart, state),
      touchmove: bindWorklet(draggableMove, state),
      touchend: bindWorklet(draggableEnd, state),
      touchcancel: bindWorklet(draggableEnd, state),
    };
  });
}
