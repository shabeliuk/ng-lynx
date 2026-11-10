import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import { LYNX_ELEMENTS } from 'angular-lynx/elements';

import { lockDrag, unlockDrag } from '../drag-lock.service.js';

/**
 * A recreation of `@lynx-js/lynx-ui`'s `<Draggable>` primitive
 * (https://lynxjs.org/next/ui/components/draggable.html) — free-form
 * drag-within-bounds — for angular-lynx.
 *
 * The real component drives its drag loop through Lynx's native gesture
 * detector (`[lynxGesture]`), which is on-device-only (`@lynx-js/web-core`
 * doesn't implement `__SetGestureDetector` — see docs/32-gestures.md). This
 * demo uses plain `(catchtouchstart)`/`(catchtouchmove)`/`(catchtouchend)`
 * instead — the same portability trade-off `LynxSlider` makes (see
 * runtime/src/slider.ts) — so the drag is verifiable in the web preview too,
 * not just on-device.
 *
 * **Keeping the page still during a drag: `pan-intercept-*`.** `catch`
 * events alone don't stop it: on a device, dragging vertically inside the
 * field also scrolled the page, because a native `<scroll-view>`'s own pan
 * recognizer isn't gated by JS event bubbling (`(catchtouchmove)` stays, as
 * the right thing at the JS layer). This demo used to switch the page's
 * `[enable-scroll]` off for the duration (`drag-lock.service.ts`, which the
 * other drag demos still use). Now the field declares it instead:
 * `pan-intercept-direction="1"` (vertical) with `pan-intercept-scope="1"`
 * (ancestors) keeps a vertical swipe that starts here from scrolling any
 * ancestor. Measured on Lynx Explorer (engine 3.7, iOS simulator): without
 * it, a vertical drag in the field scrolled the page; with it, the box
 * follows the finger and the page stays put, while a drag that starts
 * outside the field still scrolls the page. iOS since 3.4, Android since
 * 3.6, where Lynx's docs add that it may need `flatten` off, hence
 * `[flatten]="false"`; Android is unmeasured. See docs/32-gestures.md.
 *
 * **It wasn't enough on a real iPhone** (Explorer 4.2): picking the box up
 * sometimes scrolled the page too. The iOS simulator never did, so the cause is
 * unconfirmed. In the engine's source, iOS picks the direction once, after 10px,
 * and only blocks ancestors that scroll in that direction, so a drag that starts
 * sideways isn't blocked from scrolling the page later. So the drag also turns
 * the page's scrolling off until it ends, like the other drag demos
 * (`drag-lock.service.ts`), and `touchcancel` ends it too, so an interrupted
 * touch can't leave the page stuck.
 *
 * The touch listeners are bound to the **static field container**, not the
 * moving box: `detail.x`/`detail.y` are the touch position relative to
 * whatever element the listener is on, so binding to a box that's itself
 * being translated would report coordinates in a constantly-shifting frame.
 * Binding to the fixed container keeps every reading in one stable frame;
 * the box's own translate offset is tracked separately in `tx`/`ty`.
 *
 * **Clamping without a measured field size.** The natural design reads the
 * field's pixel size via `ShadowElement.fields({ size: true })` (in
 * `ngAfterViewInit`/`afterNextRender`) to clamp the drag within bounds.
 * Found live in the real dual-thread web preview: that read can't work here
 * — `@lynx-js/web-core@0.21`'s `nativeApp` has no `getFields` method at all,
 * so *every* `fields()` call throws `TypeError: nativeApp.getFields is not a
 * function` (see swiper-demo's doc for the full finding; it affects both
 * single- and multi-element reads, not just the multi-element case
 * docs/10-element-queries.md previously flagged). `.draggable-field`'s
 * height is a fixed `220px` in `app.css`, so vertical clamping just uses
 * that constant directly — no measurement needed. Its *width* isn't fixed
 * (the field stretches to the card's content width, which varies by screen
 * size), so horizontal clamping is dropped instead of guessed at: the field
 * has `overflow: hidden`, so a box dragged past the true right edge is
 * simply clipped from view rather than escaping the card.
 */
const FIELD_HEIGHT = 220;
@Component({
  selector: 'draggable-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
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
        (catchtouchstart)="onStart($event)"
        (catchtouchmove)="onMove($event)"
        (catchtouchend)="onEnd()"
        (catchtouchcancel)="onEnd()"
      >
        <view class="draggable-box" [style.transform]="transformStyle()">
          <text class="draggable-box-label">{{ label() }}</text>
        </view>
      </view>
    </view>
  `,
})
export class DraggableDemoComponent {
  protected readonly resetOnEnd = signal(true);

  private readonly tx = signal(0);
  private readonly ty = signal(0);
  protected readonly label = computed(() => `${Math.round(this.tx())}, ${Math.round(this.ty())}`);
  protected readonly transformStyle = computed(() => `translate(${this.tx()}px, ${this.ty()}px)`);

  /** Fixed to match `.draggable-box`'s CSS width/height (app.css). */
  private readonly boxSize = 64;

  private dragging = false;
  private startPointerX = 0;
  private startPointerY = 0;
  private startTx = 0;
  private startTy = 0;

  protected onStart(event: { detail?: { x?: number; y?: number } }): void {
    const x = event.detail?.x;
    const y = event.detail?.y;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (!this.dragging) lockDrag();
    this.dragging = true;
    this.startPointerX = x;
    this.startPointerY = y;
    this.startTx = this.tx();
    this.startTy = this.ty();
  }

  protected onMove(event: { detail?: { x?: number; y?: number } }): void {
    if (!this.dragging) return;
    const x = event.detail?.x;
    const y = event.detail?.y;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const maxTy = FIELD_HEIGHT - this.boxSize;
    // No horizontal clamp — see the class doc: the field's width isn't a
    // fixed constant, and `overflow: hidden` (app.css) clips any overshoot.
    this.tx.set(Math.max(0, this.startTx + (x - this.startPointerX)));
    this.ty.set(Math.min(maxTy, Math.max(0, this.startTy + (y - this.startPointerY))));
  }

  protected onEnd(): void {
    if (!this.dragging) return;
    this.dragging = false;
    unlockDrag();
    if (this.resetOnEnd()) {
      this.tx.set(0);
      this.ty.set(0);
    }
  }
}
