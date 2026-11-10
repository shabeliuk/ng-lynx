import { ChangeDetectionStrategy, Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

/**
 * Demonstrates Lynx **exposure** (visibility detection): an element with an
 * `exposure-id` fires `uiappear` / `uidisappear` as it enters / leaves the
 * viewport, delivered as ordinary element events; and `@defer (on
 * interaction)`, backed by `ShadowElement.addEventListener` mapping the
 * trigger's `click` registration onto Lynx's real `tap` gesture — the one
 * DOM-ish defer trigger event that has a genuine Lynx equivalent (`on hover`
 * doesn't; see docs/24-visibility.md).
 *
 * Below the fold, `@defer (on viewport)`: the placeholder starts off-screen
 * and the block loads once it scrolls into view, through the runtime's
 * IntersectionObserver polyfill over `lynx.createIntersectionObserver`. The
 * web preview only backs that API from `@lynx-js/web-core` 0.25 on; before,
 * the block stayed on its placeholder there.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  // The host renders as a plain view between the router outlet's container
  // and the scroll-view; without a height of its own, the scroll-view's
  // `height: 100%` resolves against content and it never scrolls.
  host: { class: 'home-host' },
  template: `
    <scroll-view class="home-scroll" scroll-orientation="vertical">
      <view class="page">
        <text class="title">Home</text>
        <text class="body">The banner has an exposure-id and reports its visibility.</text>
        <text class="status">banner uiappear fired: {{ bannerSeen() ? 'yes' : 'no' }}</text>

        <view
          class="banner"
          exposure-id="home-banner"
          (uiappear)="onAppear()"
          (uidisappear)="onDisappear()"
        >
          <text class="banner-text">Visibility-tracked banner (exposure)</text>
        </view>

        <text class="body">Tap the card below to defer-load its content.</text>
        @defer (on interaction) {
          <view class="banner">
            <text class="banner-text">Loaded via &#64;defer (on interaction)</text>
          </view>
        } @placeholder {
          <view class="banner">
            <text class="banner-text">Tap to load</text>
          </view>
        }

        <text class="body">Scroll down: the last card loads when it scrolls into view.</text>
        <view class="home-spacer">
          <text class="body">↓</text>
        </view>
        @defer (on viewport) {
          <view class="banner">
            <text class="banner-text">Loaded via &#64;defer (on viewport)</text>
          </view>
        } @placeholder {
          <view class="banner banner-waiting">
            <text class="banner-text">Waiting to scroll into view</text>
          </view>
        }
      </view>
    </scroll-view>
  `,
})
export class HomeComponent {
  readonly bannerSeen = signal(false);
  onAppear(): void {
    this.bannerSeen.set(true);
  }
  onDisappear(): void {
    this.bannerSeen.set(false);
  }
}
