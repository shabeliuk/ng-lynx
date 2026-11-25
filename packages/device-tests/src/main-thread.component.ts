import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { backgroundFunction, LynxMainThread, mainThreadRef, runOnMainThread } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';
import { LynxSlider } from 'ng-lynx/forms';
import { runOnBackground, type WorkletContext } from 'ng-lynx/worklet';

import { addOnMainThread, countTap, stopTap } from './worklets.js';

import { BackButtonComponent } from './back-button.component.js';

const INLINE_STEP = 1;

/**
 * A worklet bound to a tap, a call across to the Main Thread and back, a
 * worklet that stops its tap from reaching the box around it, a
 * `<lynx-slider>`, which drags on the Main Thread in a build with worklets, and
 * two 'main thread' functions written in this component.
 */
@Component({
  selector: 'app-main-thread',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, FormsModule, LYNX_ELEMENTS, LynxMainThread, LynxSlider],
  // The page scrolls, with room under its last line, so the flow can bring the slider
  // up the screen before it drags it. On a short screen (CI's emulator is 320x640) the
  // slider sat just above Android's navigation handle, where the system takes a
  // horizontal swipe for itself and the slider gets touchcancel after a few pixels.
  host: { class: 'fill' },
  template: `
    <scroll-view class="fill" scroll-orientation="vertical">
    <view class="page">
      <app-back-button></app-back-button>
      <text class="title" [flatten]="false">Main taps: {{ taps() }}</text>
      <view
        class="button"
        [flatten]="false"
        accessibility-label="Tap on main thread"
        [lynxMainThread]="{ tap: countTap }"
        (mainThreadCallback)="taps.set(taps() + 1)"
      >
        <text class="button-label">Tap on main thread</text>
      </view>
      <view class="button" [flatten]="false" accessibility-label="Call main thread" (tap)="call()">
        <text class="button-label">Call main thread</text>
      </view>
      <text class="line" [flatten]="false">Result: {{ result() }}</text>
      <view class="stop-outer" [flatten]="false" (tap)="outerTaps.set(outerTaps() + 1)">
        <text class="line" [flatten]="false">Outer area</text>
        <view
          class="button"
          [flatten]="false"
          accessibility-label="Stop on main thread"
          data-role="stopper"
          [lynxMainThread]="{ tap: stopTap }"
          (mainThreadCallback)="stopReport.set($event)"
        >
          <text class="button-label">Stop on main thread</text>
        </view>
      </view>
      <text class="line" [flatten]="false">Outer taps: {{ outerTaps() }}</text>
      <text class="line" [flatten]="false">Stop: {{ stopReport() }}</text>
      <view class="slider-box" [flatten]="false" accessibility-label="Volume slider">
        <lynx-slider [min]="0" [max]="100" [step]="10" [(ngModel)]="volume" />
      </view>
      <text class="line" [flatten]="false">Volume: {{ volume() }}</text>
      <view class="button" [flatten]="false" accessibility-label="Inline tap" [lynxMainThread]="{ tap: inlineTap }">
        <text class="button-label">Inline tap</text>
      </view>
      <text class="line" [flatten]="false">Inline taps: {{ inlineTaps() }}</text>
      <view class="button" [flatten]="false" accessibility-label="Call inline" (tap)="callInline()">
        <text class="button-label">Call inline</text>
      </view>
      <text class="line" [flatten]="false">Inline result: {{ inlineResult() }}</text>
      <view class="scroll-room"></view>
    </view>
    </scroll-view>
  `,
})
export class MainThreadComponent {
  protected readonly countTap = countTap;
  protected readonly stopTap = stopTap;
  protected readonly taps = signal(0);
  protected readonly result = signal('none');
  protected readonly outerTaps = signal(0);
  protected readonly stopReport = signal<unknown>('none');
  protected readonly volume = signal(50);
  protected readonly inlineResult = signal('none');

  // Written here, run on the Main Thread: pluginAngularLynx moves the body there.
  // Declared before the fields it reads, which are read when it's bound.
  protected readonly inlineTap = (_ctx: WorkletContext) => {
    'main thread';
    this.inlineCount.current += INLINE_STEP;
    void runOnBackground(this.onInlineTap)(this.inlineCount.current);
  };

  private readonly inlineCount = mainThreadRef(0);
  protected readonly inlineTaps = signal(0);
  private readonly onInlineTap = backgroundFunction((count: number) => this.inlineTaps.set(count));
  private readonly factor = 2;

  protected double(value: number): number {
    'main thread';
    return value * this.factor;
  }

  protected callInline(): void {
    runOnMainThread(this.double)(21).then(
      (value) => this.inlineResult.set(String(value)),
      (err: Error) => this.inlineResult.set(`failed: ${err.message}`),
    );
  }

  protected call(): void {
    runOnMainThread(addOnMainThread)(40, 2).then(
      (sum) => this.result.set(String(sum)),
      (err: Error) => this.result.set(`failed: ${err.message}`),
    );
  }
}
