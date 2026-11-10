import { ChangeDetectionStrategy, Component } from '@angular/core';

import { LYNX_ELEMENTS } from 'angular-lynx/elements';

import { DraggableDemoComponent } from './components/draggable-demo.component.js';
import { FeedListDemoComponent } from './components/feed-list-demo.component.js';
import { SheetDemoComponent } from './components/sheet-demo.component.js';
import { SortableDemoComponent } from './components/sortable-demo.component.js';
import { SwipeActionDemoComponent } from './components/swipe-action-demo.component.js';
import { SwiperDemoComponent } from './components/swiper-demo.component.js';
import { dragLockScrollEnabled } from './drag-lock.service.js';

/**
 * A gallery of `@lynx-js/lynx-ui` component patterns
 * (https://lynxjs.org/next/ui/components/) recreated for angular-lynx:
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
        <text class="app-subtitle">lynx-ui component patterns on angular-lynx</text>
      </view>
      <scroll-view class="app-scroll" scroll-orientation="vertical" [enable-scroll]="dragLockScrollEnabled()">
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
  // Templates can only reference class members, not bare module imports —
  // this just re-exposes the shared signal under the same name.
  protected readonly dragLockScrollEnabled = dragLockScrollEnabled;
}
