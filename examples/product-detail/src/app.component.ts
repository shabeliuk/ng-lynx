import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

import { SwiperComponent, type SwiperItem } from './swiper/swiper.component.js';
import { easeInOut } from './swiper/swiper.mt.js';

/**
 * The official Product Detail tutorial (https://lynxjs.org/learn/product-detail) in
 * Angular. The tutorial's product photos are coloured panels here. A second swiper,
 * with a slower linear snap, shows that each instance keeps its own state.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, SwiperComponent],
  template: `
    <scroll-view class="page" scroll-orientation="vertical">
      <app-swiper [data]="pictures" [easing]="easeInOut" [duration]="300" />
      <view class="details">
        <text class="price">$49.00</text>
        <text class="name">Canvas backpack, 20 litres</text>
        <text class="description">
          Swipe the pictures, or tap a dot. The pictures follow your finger on the Main
          Thread, and the dots update from the Background Thread.
        </text>
      </view>
      <text class="heading">You might also like</text>
      <app-swiper [data]="related" [duration]="600" />
    </scroll-view>
  `,
})
export class AppComponent {
  readonly easeInOut = easeInOut;
  readonly pictures: SwiperItem[] = [
    { label: 'Front', color: '#c8553d' },
    { label: 'Side', color: '#588b8b' },
    { label: 'Back', color: '#f28f3b' },
    { label: 'Inside', color: '#5d576b' },
  ];
  readonly related: SwiperItem[] = [
    { label: 'Water bottle', color: '#3d5a80' },
    { label: 'Walking boots', color: '#81b29a' },
    { label: 'Rain jacket', color: '#e07a5f' },
  ];
}
