import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import {
  backgroundFunction,
  bindWorklet,
  injectSystemInfo,
  LynxMainThread,
  LynxMainThreadRef,
  mainThreadRef,
  type MainThreadFunctionHandle,
  runOnMainThread,
  type ToMainThread,
} from 'angular-lynx';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

import { IndicatorComponent } from './indicator.component.js';
import { goToIndex, linear, onTouchEnd, onTouchMove, onTouchStart, type SwiperState } from './swiper.mt.js';

export interface SwiperItem {
  label: string;
  color: string;
}

/**
 * The tutorial's `<Swiper>`. Touch handling stays on the Main Thread, so the page
 * follows the finger however busy the Background Thread is. Each instance has its own
 * refs, callback and `bindWorklet` params, so a page can hold any number of them.
 */
@Component({
  selector: 'app-swiper',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IndicatorComponent, LYNX_ELEMENTS, LynxMainThread, LynxMainThreadRef],
  template: `
    <view class="swiper-wrapper">
      <view class="swiper-container" [lynxMainThreadRef]="container" [lynxMainThread]="touchEvents()">
        @for (item of data(); track item.label) {
          <view class="swiper-item" [style.width.px]="itemWidth" [style.background-color]="item.color">
            <text class="swiper-label">{{ item.label }}</text>
          </view>
        }
      </view>
      <app-indicator [total]="data().length" [current]="current()" (select)="select($event)" />
    </view>
  `,
})
export class SwiperComponent {
  readonly data = input.required<SwiperItem[]>();
  /** How long the snap takes, in ms. */
  readonly duration = input(300);
  /** Runs on the Main Thread for each frame of the snap: `main-thread:easing` in the tutorial. */
  readonly easing = input<MainThreadFunctionHandle<[number], number>>(linear);

  private readonly systemInfo = injectSystemInfo();
  readonly itemWidth = this.systemInfo.pixelWidth / this.systemInfo.pixelRatio;
  readonly current = signal(0);

  readonly container = mainThreadRef<SwiperState['container']['current']>();
  private readonly touchStartX = mainThreadRef(0);
  private readonly touchStartOffset = mainThreadRef(0);
  private readonly offset = mainThreadRef(0);
  private readonly index = mainThreadRef(0);
  private readonly animation = mainThreadRef<SwiperState['animation']['current']>();

  private readonly onIndexChange = backgroundFunction((index: number) => this.current.set(index));

  private readonly state = computed<ToMainThread<SwiperState>>(() => ({
    container: this.container,
    touchStartX: this.touchStartX,
    touchStartOffset: this.touchStartOffset,
    offset: this.offset,
    index: this.index,
    animation: this.animation,
    itemWidth: this.itemWidth,
    count: this.data().length,
    duration: this.duration(),
    easing: this.easing(),
    onIndexChange: this.onIndexChange,
  }));

  readonly touchEvents = computed(() => {
    const state = this.state();
    return {
      touchstart: bindWorklet(onTouchStart, state),
      touchmove: bindWorklet(onTouchMove, state),
      touchend: bindWorklet(onTouchEnd, state),
      touchcancel: bindWorklet(onTouchEnd, state),
    };
  });

  select(index: number): void {
    void runOnMainThread(goToIndex)(this.state(), index);
  }
}
