import { ChangeDetectionStrategy, Component } from '@angular/core';

import { LynxMainThreadRef } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import { DraggableDemoComponent } from './components/draggable-demo.component.js';
import { FeedListDemoComponent } from './components/feed-list-demo.component.js';
import { SheetDemoComponent } from './components/sheet-demo.component.js';
import { SortableDemoComponent } from './components/sortable-demo.component.js';
import { SwipeActionDemoComponent } from './components/swipe-action-demo.component.js';
import { SwiperDemoComponent } from './components/swiper-demo.component.js';
import { pageScroll } from './page-lock.js';

/**
 * A gallery of `@lynx-js/lynx-ui` component patterns
 * (https://lynxjs.org/next/ui/components/) recreated for ng-lynx:
 * Draggable, Swiper, Sheet, SwipeAction, Sortable, FeedList. Each is its own
 * demo component under `src/components/`; see each file's doc comment for how
 * it differs from the real `@lynx-js/lynx-ui` primitive (they're React
 * components built on native gestures — this gallery reimplements the
 * *patterns* for Angular, portable to the web preview where possible — see
 * docs/37-ui-gallery.md).
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LYNX_ELEMENTS,
    LynxMainThreadRef,
    DraggableDemoComponent,
    SwiperDemoComponent,
    SheetDemoComponent,
    SwipeActionDemoComponent,
    SortableDemoComponent,
    FeedListDemoComponent,
  ],
  template: `
    <view class="app">
      <view class="app-header">
        <text class="app-title">UI Gallery</text>
        <text class="app-subtitle">lynx-ui component patterns on ng-lynx</text>
      </view>
      <scroll-view class="app-scroll" scroll-orientation="vertical" [lynxMainThreadRef]="pageScroll">
        <view class="app-scroll-content">
          <draggable-demo />
          <swiper-demo />
          <sheet-demo />
          <swipe-action-demo />
          <sortable-demo />
          <feed-list-demo />
        </view>
      </scroll-view>
    </view>
  `,
})
export class AppComponent {
  // Templates can only reference class members, not module imports.
  protected readonly pageScroll = pageScroll;
}
