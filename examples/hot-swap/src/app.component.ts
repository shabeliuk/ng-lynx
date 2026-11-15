import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

import { hotSwapComponent } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

/**
 * Live demo of `hotSwapComponent` — state-preserving component hot-swap
 * (docs/31-hot-swap.md) — in the real dual-thread engine (AOT, ngDevMode
 * false, Background Thread in a worker / on PrimJS).
 *
 * `CounterCard` is the "live" component. `CounterCardV2` plays the role of
 * the same component *after an edit*: same class shape, new template. In a
 * real dev loop the v2 definition would arrive from a rebuild; here both are
 * compiled into the bundle so the swap can be triggered with a tap and
 * verified anywhere the bundle runs — web preview or a real device.
 *
 * The point to observe: bump the counter first, then swap. The count (and
 * the tap handler, and the whole component instance) survives the swap —
 * only the template is replaced.
 */
@Component({
  selector: 'counter-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="card v1">
      <text class="card-tag">template v1</text>
      <view class="counter" (tap)="bump()">
        <text class="count">{{ count() }}</text>
        <text class="hint">Tap to increment</text>
      </view>
    </view>
  `,
})
export class CounterCard {
  readonly count = signal(0);
  bump(): void {
    this.count.update((n) => n + 1);
  }
}

/** The "edited" template: same class shape, different structure and styling. */
@Component({
  selector: 'counter-card-v2',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="card v2">
      <text class="card-tag">template v2 — hot-swapped, state intact</text>
      <view class="counter counter-v2" (tap)="bump()">
        <text class="count count-v2">count = {{ count() }} (doubled: {{ count() * 2 }})</text>
        <text class="hint">Still tappable — same instance</text>
      </view>
    </view>
  `,
})
export class CounterCardV2 {
  readonly count = signal(0);
  bump(): void {
    this.count.update((n) => n + 1);
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CounterCard, LYNX_ELEMENTS],
  template: `
    <view class="app">
      <text class="title">Hot-swap demo</text>
      <text class="subtitle">bump the counter, then swap — the count survives</text>
      <counter-card />
      <view class="btn-row">
        <view class="btn" (tap)="swapToV2()"><text class="btn-label">Swap to v2</text></view>
        <view class="btn btn-muted" (tap)="swapToV1()"><text class="btn-label">Swap back to v1</text></view>
      </view>
    </view>
  `,
})
export class AppComponent {
  swapToV2(): void {
    hotSwapComponent(CounterCard, CounterCardV2);
  }
  swapToV1(): void {
    // Swapping "back" is just another swap — repeatability is the whole
    // edit → save → edit → save loop.
    hotSwapComponent(CounterCard, CounterCard0);
  }
}

/**
 * A pristine copy of the v1 definition to swap back to. (After the first
 * swap, `CounterCard`'s own definition has been replaced in place — its
 * original template lives on only here.)
 */
@Component({
  selector: 'counter-card-v0',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="card v1">
      <text class="card-tag">template v1</text>
      <view class="counter" (tap)="bump()">
        <text class="count">{{ count() }}</text>
        <text class="hint">Tap to increment</text>
      </view>
    </view>
  `,
})
export class CounterCard0 {
  readonly count = signal(0);
  bump(): void {
    this.count.update((n) => n + 1);
  }
}
