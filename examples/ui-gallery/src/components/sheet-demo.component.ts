import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import { LYNX_ELEMENTS } from 'angular-lynx/elements';

import { lockDrag, unlockDrag } from '../drag-lock.service.js';

/**
 * A recreation of `@lynx-js/lynx-ui`'s `<SheetRoot>`/`<Sheet…>` primitives
 * (https://lynxjs.org/next/ui/components/sheet.html) — a bottom sheet with a
 * backdrop, drag-to-close handle, and rubber-band-style clamped drag — for
 * angular-lynx. A single snap point (open/closed) rather than the real
 * component's `snapPoints` array, to keep the demo focused.
 *
 * The panel is a `position: fixed` overlay (the same technique
 * `LynxSelect`/`LynxDatePicker`'s dialogs use — see docs/09-forms.md — Lynx has
 * no native `<dialog>`/portal, so a fixed-position view *is* the modal
 * layer). Drag-to-close is touch-driven, same portability note as the other
 * demos in this gallery.
 *
 * `position: fixed` only changes paint position, not the DOM/event tree —
 * this component still mounts inside `app.component.ts`'s `.app-scroll`, so
 * the handle's touch listeners are `catch`-prefixed for the same reason as
 * every other demo here (see draggable-demo's doc comment) — and, like every
 * other demo, `catch` alone wasn't enough on a real device, so `onStart`/
 * `onEnd` also call `lockDrag()`/`unlockDrag()` (`drag-lock.service.ts`),
 * which is what actually gates `.app-scroll`'s `[enable-scroll]`.
 */
@Component({
  selector: 'sheet-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="demo-card">
      <text class="demo-title">Sheet</text>
      <text class="demo-desc">A bottom sheet you can drag down to dismiss.</text>

      <view class="demo-toggle" (tap)="open()">
        <text class="demo-toggle-label">Open sheet</text>
      </view>
    </view>

    @if (show()) {
      <view class="sheet-backdrop" (tap.self)="close()">
        <view
          class="sheet-panel"
          [style.transform]="panelTransform()"
          [class.sheet-panel-animated]="!dragging()"
        >
          <view
            class="sheet-handle-row"
            (catchtouchstart)="onStart($event)"
            (catchtouchmove)="onMove($event)"
            (catchtouchend)="onEnd()"
          >
            <view class="sheet-handle"></view>
          </view>
          <text class="sheet-panel-title">Sheet content</text>
          <text class="sheet-panel-desc">
            Drag the handle down (or tap the backdrop) to dismiss. A short
            drag springs back open; drag far enough and it stays dismissed —
            the same clamped, rubber-band-free release the real lynx-ui
            component uses.
          </text>
        </view>
      </view>
    }
  `,
})
export class SheetDemoComponent {
  protected readonly show = signal(false);
  protected readonly dragging = signal(false);

  private readonly dragY = signal(0);
  protected readonly panelTransform = computed(() => `translateY(${Math.max(0, this.dragY())}px)`);

  private startPointerY = 0;

  protected open(): void {
    this.dragY.set(0);
    this.show.set(true);
  }

  protected close(): void {
    this.show.set(false);
    this.dragY.set(0);
  }

  protected onStart(event: { detail?: { y?: number } }): void {
    const y = event.detail?.y;
    if (typeof y !== 'number') return;
    this.dragging.set(true);
    lockDrag();
    this.startPointerY = y;
  }

  protected onMove(event: { detail?: { y?: number } }): void {
    if (!this.dragging()) return;
    const y = event.detail?.y;
    if (typeof y !== 'number') return;
    // Only downward drag moves the sheet — clamped at 0 (rubber-band-free,
    // matching the real component's "drag toward the closed edge" model.
    this.dragY.set(Math.max(0, y - this.startPointerY));
  }

  protected onEnd(): void {
    if (!this.dragging()) return;
    this.dragging.set(false);
    unlockDrag();
    if (this.dragY() > 80) {
      this.close();
    } else {
      this.dragY.set(0);
    }
  }
}
