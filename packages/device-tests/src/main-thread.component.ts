import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LynxMainThread, runOnMainThread } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import { addOnMainThread, countTap, stopTap } from './worklets.js';

import { BackButtonComponent } from './back-button.component.js';

/**
 * A worklet bound to a tap, a call across to the Main Thread and back, and a
 * worklet that stops its tap from reaching the box around it.
 */
@Component({
  selector: 'app-main-thread',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LYNX_ELEMENTS, LynxMainThread],
  template: `
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
    </view>
  `,
})
export class MainThreadComponent {
  protected readonly countTap = countTap;
  protected readonly stopTap = stopTap;
  protected readonly taps = signal(0);
  protected readonly result = signal('none');
  protected readonly outerTaps = signal(0);
  protected readonly stopReport = signal<unknown>('none');

  protected call(): void {
    runOnMainThread(addOnMainThread)(40, 2).then(
      (sum) => this.result.set(String(sum)),
      (err: Error) => this.result.set(`failed: ${err.message}`),
    );
  }
}
