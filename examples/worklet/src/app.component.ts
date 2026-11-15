import {
  ChangeDetectionStrategy,
  Component,
  NO_ERRORS_SCHEMA,
  signal,
} from '@angular/core';
import { LynxGesture, type LynxGestures, LynxMainThread, LynxMainThreadRef, runOnMainThread } from 'ng-lynx';

import {
  cardRef,
  checkElementApi,
  chipRef,
  fadeCard,
  onPanEnd,
  onPanStart,
  onPanUpdate,
  pressFade,
  resetCard,
} from './worklets.js';

/**
 * Binds native events to main-thread worklets (registered in worklets.ts).
 *
 * The `pressFade` worklet runs on the Main Thread the instant the card is
 * tapped — dimming it with zero Background-Thread latency — and then calls back
 * to the Background Thread, which we surface here via `(mainThreadCallback)`.
 * "Fade card" demonstrates `lynxAnimate` — a real, timer-driven
 * tween, also entirely on the Main Thread (see docs/33-animations.md).
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LynxGesture, LynxMainThread, LynxMainThreadRef],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      <text class="title">Main-thread worklets</text>
      <text class="description">
        Tapping the card runs a worklet ON the Main Thread (no Background-Thread
        round-trip): it dims the card to a fixed opacity — not a toggle, so
        tapping again re-applies the same value and looks like nothing happened —
        then separately reports the tap count below. "Reset card" runs a
        *different* worklet, bound to a *different* element, that restores the
        card's opacity through a cross-element ref — demonstrating that a
        worklet can reach any element, not just the one the event fired on.
      </text>

      <view
        class="card"
        [lynxMainThreadRef]="cardRef"
        [lynxMainThread]="{ tap: pressFade }"
        (mainThreadCallback)="onPressed($event)"
      >
        <text class="card-label">Tap to dim (fixed value, not a toggle)</text>
      </view>

      <!-- Restores the card via a ref — a worklet on a *different* element. -->
      <view class="reset" [lynxMainThread]="{ tap: resetCard }">
        <text class="reset-label">Reset card opacity (via a main-thread ref)</text>
      </view>

      <!-- Smoothly fades the card via lynxAnimate — real timer-driven
           interpolation on the Main Thread, not an instant setStyle snapshot. -->
      <view class="fade" [lynxMainThread]="{ tap: fadeCard }">
        <text class="fade-label">Fade card (lynxAnimate, 400ms)</text>
      </view>

      <view
        class="chip"
        [lynxMainThreadRef]="chipRef"
        [lynxGesture]="gestures"
        (mainThreadCallback)="onGesture($event)"
      >
        <text class="chip-label">Drag me sideways (native pan gesture)</text>
      </view>
      <text class="gesture-log">{{ gestureLog() }}</text>

      <view class="api-box" (tap)="checkApi()">
        <text class="api-label">Check MainThread.Element (runOnMainThread)</text>
        <scroll-view class="api-scroll" scroll-orientation="vertical">
          <text class="api-item">First line of a scroll-view</text>
          <text class="api-item">Second line</text>
          <text class="api-item">Third line</text>
          <text class="api-item">Fourth line</text>
        </scroll-view>
      </view>
      <text class="gesture-log">{{ apiResult() }}</text>

      <text class="count">Pressed {{ presses() }}× (reported from the worklet via runOnBackground)</text>
    </view>
  `,
})
export class AppComponent {
  /** Worklet + ref references, exposed for the template. */
  protected readonly pressFade = pressFade;
  protected readonly resetCard = resetCard;
  protected readonly fadeCard = fadeCard;
  protected readonly cardRef = cardRef;
  protected readonly chipRef = chipRef;
  protected readonly gestures: LynxGestures = {
    pan: { type: 'pan', callbacks: { onStart: onPanStart, onUpdate: onPanUpdate, onEnd: onPanEnd } },
  };

  readonly presses = signal(0);
  readonly gestureLog = signal('No gesture yet');
  readonly apiResult = signal('Not checked yet');

  onPressed(_data: unknown): void {
    this.presses.update((n) => n + 1);
  }

  checkApi(): void {
    runOnMainThread(checkElementApi)().then(
      (result) => this.apiResult.set(result),
      (err: Error) => this.apiResult.set(`Failed: ${err.message}`),
    );
  }

  onGesture(phase: unknown): void {
    this.gestureLog.set(`Last gesture phase: ${String(phase)}`);
  }
}
