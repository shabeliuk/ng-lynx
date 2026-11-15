import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { lynxGlobalProps } from 'ng-lynx';
import { LYNX_ELEMENTS, type LynxLayoutChangeEvent } from 'ng-lynx/elements';

/**
 * CSS `@media` on Lynx 4.0+. Every chip in the first card is always rendered,
 * and `app.css`'s `@media` rules decide which ones light up, which theme the
 * page uses. A page loaded in either orientation matches correctly.
 *
 * Rotating is another matter. On Android, Explorer recreates the page, so the
 * queries match again (and the app's state resets). On iOS the page keeps its
 * state and resizes, and whether `@media` is re-evaluated isn't reliable: on
 * Explorer 4.2 it wasn't on a real iPhone, nor in one simulator run, and was
 * in a later one (docs/13-styling.md).
 * So what has to follow rotation everywhere, the tile columns and the
 * Measured row, comes from the page's own size instead: `(layoutchange)` on
 * the scroll-view fires whenever it's laid out at a new size.
 *
 * The one thing computed here is the host theme. `prefers-color-scheme` only
 * follows the system when the host app reports it to the engine, and Lynx
 * Explorer 4.1 doesn't. Explorer sends the system scheme as a global prop
 * instead, which is how Lynx's theming guide has a host pass it, so the page
 * also goes dark from that.
 *
 * The web preview drops `@media` by design (Lynx's web runtime has no
 * conditional rule kind), so there the page shows its base styles and the
 * note saying so.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <scroll-view
      class="page"
      [class.theme-dark]="hostTheme() === 'dark'"
      scroll-orientation="vertical"
      (layoutchange)="onPageLayout($event)"
    >
      <view class="content">
        <text class="title">Responsive with &#64;media</text>
        <view class="fallback">
          <text class="fallback-text">No &#64;media applied. It needs Lynx 4.0+; the web preview drops &#64;media by design.</text>
        </view>

        <view class="card">
          <text class="card-title">What &#64;media matched</text>
          <text class="card-body">On iOS these can keep the result from when the page loaded, because the engine doesn't always re-run &#64;media on rotation. Reopen the page to update them.</text>
          <view class="row">
            <text class="chip chip-portrait">portrait</text>
            <text class="chip chip-landscape">landscape</text>
          </view>
          <view class="row">
            <text class="chip chip-narrow">width &lt; 600px</text>
            <text class="chip chip-wide">width ≥ 600px</text>
          </view>
          <view class="row">
            <text class="chip chip-light">light scheme</text>
            <text class="chip chip-dark">dark scheme</text>
          </view>
          <view class="row">
            <text class="chip chip-2x">below 3×</text>
            <text class="chip chip-3x">3× display</text>
          </view>
        </view>

        <view class="card">
          <text class="card-title">Measured</text>
          <text class="card-body">From the page's size, in (layoutchange). This follows rotation on every engine.</text>
          <view class="row">
            <text class="chip" [class.chip-on]="!landscape()">portrait</text>
            <text class="chip" [class.chip-on]="landscape()">landscape</text>
          </view>
          <view class="row">
            <text class="chip" [class.chip-on]="!wide()">width &lt; 600px</text>
            <text class="chip" [class.chip-on]="wide()">width ≥ 600px</text>
          </view>
          <text class="card-body">{{ sizeLabel() }}</text>
        </view>

        <view class="card">
          <text class="card-title">Host theme</text>
          <text class="card-body">From the host's global props. Lights up when the host sends a scheme, even where the scheme chips above stay on light.</text>
          <view class="row">
            <text class="chip" [class.chip-on]="hostTheme() === 'light'">host: light</text>
            <text class="chip" [class.chip-on]="hostTheme() === 'dark'">host: dark</text>
          </view>
        </view>

        <view class="card">
          <text class="card-title">Layout</text>
          <text class="card-body">One column in portrait, two on a wide portrait screen, three in landscape. Set from the measured size, so it follows rotation.</text>
          <view class="tiles">
            @for (tile of tiles; track tile) {
              <view class="tile" [class.tile-half]="columns() === 2" [class.tile-third]="columns() === 3">
                <text class="tile-label">{{ tile }}</text>
              </view>
            }
          </view>
        </view>
      </view>
    </scroll-view>
  `,
})
export class AppComponent {
  readonly tiles = ['Savings', 'Pension', 'ISA', 'Property', 'Bonds', 'Cash'];

  /** The page's size in px, from its latest `layoutchange`. 0 until the first one. */
  private readonly size = signal({ width: 0, height: 0 });

  readonly landscape = computed(() => this.size().width > this.size().height);
  readonly wide = computed(() => this.size().width >= 600);
  readonly columns = computed(() => (this.landscape() ? 3 : this.wide() ? 2 : 1));
  readonly sizeLabel = computed(() => {
    const { width, height } = this.size();
    return width ? `${Math.round(width)} × ${Math.round(height)} px` : 'not measured yet';
  });

  onPageLayout(event: LynxLayoutChangeEvent): void {
    const { width, height } = event.detail ?? {};
    if (typeof width === 'number' && typeof height === 'number') this.size.set({ width, height });
  }

  private readonly globalProps = lynxGlobalProps<{ appTheme?: unknown; theme?: unknown }>();

  /**
   * The host's scheme, lower-cased: `appTheme` is the name in Lynx's theming
   * guide, `theme` (`'Light'` or `'Dark'`) is what Lynx Explorer sends.
   * `undefined` when the host sends neither, as in the web preview.
   */
  readonly hostTheme = computed(() => {
    const { appTheme, theme } = this.globalProps();
    const value = appTheme ?? theme;
    return typeof value === 'string' ? value.toLowerCase() : undefined;
  });
}
