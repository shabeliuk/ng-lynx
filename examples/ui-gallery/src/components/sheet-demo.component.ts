import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

import { backgroundFunction, bindWorklet, LynxMainThread, LynxMainThreadRef, mainThreadRef, type ToMainThread } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';
import type { MainThreadElement } from 'ng-lynx/worklet';

import { pageScroll } from '../page-lock.js';
import { sheetEnd, sheetMove, sheetStart, type SheetState } from './sheet.mt.js';

/**
 * A recreation of `@lynx-js/lynx-ui`'s `<SheetRoot>`/`<Sheet…>` primitives
 * (https://lynxjs.org/next/ui/components/sheet.html) — a bottom sheet with a
 * backdrop, drag-to-close handle, and rubber-band-style clamped drag — for
 * ng-lynx. A single snap point (open/closed) rather than the real
 * component's `snapPoints` array, to keep the demo focused.
 *
 * The panel is a `position: fixed` overlay, the same technique
 * `LynxSelect`/`LynxDatePicker`'s dialogs use (docs/09-forms.md): Lynx has no
 * native `<dialog>` or portal, so a fixed view *is* the modal layer.
 *
 * **The drag runs on the Main Thread** (`sheet.mt.ts`): touch worklets on the
 * handle move the panel with `setStyleProperty` and spring it back with
 * `lynxTween`, so Angular never binds its `transform`. A release far enough
 * down calls `close()` through a `backgroundFunction`. Each opening is a new
 * panel, so it starts at the top again.
 *
 * `position: fixed` changes where the panel paints, not where it sits in the
 * tree: it's still inside `app.component.ts`'s `.app-scroll`, so the drag stops
 * the page scrolling too (`page-lock.ts`).
 */
@Component({
  selector: 'sheet-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, LynxMainThread, LynxMainThreadRef],
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
        <view class="sheet-panel" [lynxMainThreadRef]="panel">
          <view class="sheet-handle-row" [lynxMainThread]="touchEvents">
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

  protected readonly panel = mainThreadRef<MainThreadElement | null>();
  private readonly startY = mainThreadRef<number | null>(null);
  private readonly dragY = mainThreadRef(0);
  private readonly spring = mainThreadRef<SheetState['spring']['current']>(null);
  private readonly onClose = backgroundFunction(() => this.close());

  private readonly state: ToMainThread<SheetState> = {
    page: pageScroll,
    panel: this.panel,
    startY: this.startY,
    dragY: this.dragY,
    spring: this.spring,
    closeAt: 80,
    onClose: this.onClose,
  };

  protected readonly touchEvents = {
    touchstart: bindWorklet(sheetStart, this.state),
    touchmove: bindWorklet(sheetMove, this.state),
    touchend: bindWorklet(sheetEnd, this.state),
    touchcancel: bindWorklet(sheetEnd, this.state),
  };

  protected open(): void {
    this.show.set(true);
  }

  protected close(): void {
    this.show.set(false);
  }
}
