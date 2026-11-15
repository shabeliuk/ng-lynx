import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

import { LYNX_ELEMENTS } from 'ng-lynx/elements';

/**
 * A recreation of `@lynx-js/lynx-ui`'s `<FeedList>` primitive
 * (https://lynxjs.org/next/ui/components/feed-list.html) — a scrolling feed
 * with pull-to-refresh and load-more — for ng-lynx. A `single`-layout
 * feed rather than the real component's `waterfall`/`flow` masonry modes, to
 * keep the demo focused.
 *
 * Unlike the other demos in this gallery, this one needs **no raw touch
 * tracking at all** — `<scroll-view>`'s own `scrolltoupper`/`scrolltolower`
 * events (native Lynx scroll thresholds, see `LynxScrollView` in
 * `ng-lynx/elements`) directly give "user reached the top" / "user
 * reached the bottom", which is exactly pull-to-refresh / load-more. A real
 * pull-to-refresh would also want a visible drag distance while pulling (the
 * real component's rubber-band header) — simplified here to a
 * threshold-triggered spinner, which is enough to prove the scroll-event
 * wiring end to end.
 */
@Component({
  selector: 'feed-list-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="demo-card">
      <text class="demo-title">FeedList</text>
      <text class="demo-desc">Scroll to the top to refresh, or the bottom to load more.</text>

      <scroll-view
        class="feed-scroll"
        scroll-orientation="vertical"
        [upper-threshold]="20"
        [lower-threshold]="20"
        (scrolltoupper)="onRefresh()"
        (scrolltolower)="onLoadMore()"
      >
        <view class="feed-content">
          @if (refreshing()) {
            <view class="feed-status-row">
              <text class="feed-status-label">Refreshing…</text>
            </view>
          }
          @for (item of items(); track item.id) {
            <view class="feed-item">
              <text class="feed-item-label">{{ item.label }}</text>
            </view>
          }
          <view class="feed-status-row">
            <text class="feed-status-label">{{ loadingMore() ? 'Loading more…' : 'Scroll down to load more' }}</text>
          </view>
        </view>
      </scroll-view>
    </view>
  `,
})
export class FeedListDemoComponent {
  private nextId = 6;
  protected readonly items = signal(
    Array.from({ length: 5 }, (_, i) => ({ id: i + 1, label: `Feed item ${i + 1}` })),
  );
  protected readonly refreshing = signal(false);
  protected readonly loadingMore = signal(false);

  protected onRefresh(): void {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    setTimeout(() => {
      const fresh = Array.from({ length: 2 }, (_, i) => ({
        id: -(i + 1) - Date.now(),
        label: `New item ${i + 1}`,
      }));
      this.items.update((items) => [...fresh, ...items]);
      this.refreshing.set(false);
    }, 700);
  }

  protected onLoadMore(): void {
    if (this.loadingMore()) return;
    this.loadingMore.set(true);
    setTimeout(() => {
      const more = Array.from({ length: 3 }, () => ({ id: this.nextId, label: `Feed item ${this.nextId++}` }));
      this.items.update((items) => [...items, ...more]);
      this.loadingMore.set(false);
    }, 700);
  }
}
