import { Component, signal } from '@angular/core';
import { backgroundFunction, LynxMainThread, LynxMainThreadRef, mainThreadRef, runOnMainThread } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';
import { type MainThreadElement, type MainThreadTouchEvent, runOnBackground, type WorkletContext } from 'ng-lynx/worklet';

const MAX = 200;

export function clamp(value: number, min: number, max: number): number {
  'main thread';
  return Math.max(min, Math.min(value, max));
}

/**
 * The same kind of worklets as worklets.ts, written in the component instead:
 * each function whose body starts with 'main thread' runs on the Main Thread,
 * and pluginAngularLynx moves it there. See docs/11-worklets.md#inline-main-thread-functions.
 *
 * - Drag the box: `onStart`/`onMove` move it through an element ref, clamped by
 *   `clamp`, a module-level 'main thread' function they capture.
 * - Let go: `onEnd`, a method, reports where through `runOnBackground` and a
 *   captured `backgroundFunction`.
 * - "Fade": a tap, reading the captured `this.fadeTo`.
 * - "runOnMainThread": calls the `triple` method on the Main Thread.
 *
 * The functions are declared before the refs they read: what a function captures
 * is read when it's bound, not when it's created. In the web preview the box
 * drags with touch input, not a mouse.
 */
@Component({
  selector: 'app-inline-playground',
  standalone: true,
  imports: [LYNX_ELEMENTS, LynxMainThread, LynxMainThreadRef],
  template: `
    <view class="inline-panel">
      <text class="inline-title">Inline 'main thread' functions</text>
      <view
        class="inline-box"
        [lynxMainThreadRef]="box"
        [lynxMainThread]="{ touchstart: onStart, touchmove: onMove, touchend: onEnd }"
      >
        <text class="inline-label">Drag me</text>
      </view>
      <text class="inline-line">Released at: {{ releasedAt() }}</text>
      <view class="inline-button" [lynxMainThread]="{ tap: onTap }">
        <text class="inline-label">Fade on Main Thread</text>
      </view>
      <view class="inline-button" (tap)="callTriple()">
        <text class="inline-label">runOnMainThread: {{ tripled() }}</text>
      </view>
    </view>
  `,
})
export class InlinePlaygroundComponent {
  // Declared before the refs it uses, on purpose.
  readonly onStart = (ctx: WorkletContext<MainThreadTouchEvent>) => {
    'main thread';
    this.startX.current = ctx.event.touches[0]!.clientX - this.offset.current;
  };

  readonly onMove = (ctx: WorkletContext<MainThreadTouchEvent>) => {
    'main thread';
    this.offset.current = clamp(ctx.event.touches[0]!.clientX - this.startX.current, 0, MAX);
    this.box.current?.setStyleProperty('transform', `translateX(${this.offset.current}px)`);
  };

  onEnd(): void {
    'main thread';
    void runOnBackground(this.released)(Math.round(this.offset.current));
  }

  readonly onTap = (ctx: WorkletContext) => {
    'main thread';
    ctx.setStyle(`opacity: ${this.fadeTo}`);
  };

  triple(value: number): number {
    'main thread';
    return value * this.factor;
  }

  readonly box = mainThreadRef<MainThreadElement | null>(null);
  readonly startX = mainThreadRef(0);
  readonly offset = mainThreadRef(0);
  readonly releasedAt = signal(0);
  readonly tripled = signal(0);
  readonly released = backgroundFunction((x: number) => this.releasedAt.set(x));
  fadeTo = 0.4;
  factor = 3;

  callTriple(): void {
    void runOnMainThread(this.triple)(14).then((value) => this.tripled.set(value));
  }
}
