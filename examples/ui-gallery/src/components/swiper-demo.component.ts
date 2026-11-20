import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import {
  backgroundFunction,
  bindWorklet,
  injectSystemInfo,
  LynxMainThread,
  LynxMainThreadRef,
  lynxAssetUrl,
  mainThreadRef,
  runOnMainThread,
  type ToMainThread,
} from 'ng-lynx';
import { LYNX_ELEMENTS, type LynxImageErrorEvent, type LynxLayoutChangeEvent } from 'ng-lynx/elements';
import type { MainThreadElement } from 'ng-lynx/worklet';

import { pageScroll } from '../page-lock.js';
import { swiperEnd, swiperGoTo, swiperMove, swiperStart, type SwiperState } from './swiper.mt.js';

/**
 * A recreation of `@lynx-js/lynx-ui`'s `<Swiper>` primitive
 * (https://lynxjs.org/next/ui/components/swiper.html), a paged, draggable
 * carousel with pagination dots, for ng-lynx.
 *
 * **The drag runs on the Main Thread** (`swiper.mt.ts`): touch worklets on the
 * viewport move the track with `setStyleProperty` and snap it with `lynxTween`,
 * so Angular never binds its `transform`. The page it settles on comes back
 * through a `backgroundFunction`, for the dots; a dot or autoplay asks for a
 * page with `runOnMainThread(swiperGoTo)`, which waits for a drag to finish.
 * `examples/product-detail`'s swiper, from the official tutorial, works the
 * same way.
 *
 * The worklets are bound to the **static viewport**, not the moving track, and
 * use the touch's page position, so every reading is in one frame. The drag
 * stops the page scrolling until it ends (`page-lock.ts`).
 *
 * **No measured position.** Each `.swiper-slide` is `flex-shrink: 0; width:
 * 100%` of the track, so the slides overflow the track rather than widen it:
 * the track stays one viewport wide, and `translateX(-100%)` moves exactly one
 * page. The worklets keep the position in pages and write it as a percentage.
 * Only turning the finger's pixels into pages needs the viewport's width, which
 * `(layoutchange)` gives; until it comes, the screen's width less the margins.
 * (`fields()` can't measure it: the web preview has no `getFields`, see
 * docs/10-element-queries.md.) The threshold for turning a page is a fixed
 * distance, as in most carousels.
 */
const DRAG_THRESHOLD_PX = 60;

@Component({
  selector: 'swiper-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, LynxMainThread, LynxMainThreadRef],
  template: `
    <view class="demo-card">
      <text class="demo-title">Swiper</text>
      <text class="demo-desc">Drag to page through, or tap a dot to jump.</text>

      <view
        class="demo-toggle"
        [class.demo-toggle-on]="autoPlay()"
        (tap)="autoPlay.set(!autoPlay())"
      >
        <text class="demo-toggle-label">Autoplay: {{ autoPlay() ? 'On' : 'Off' }}</text>
      </view>

      <view class="swiper-viewport" [lynxMainThread]="touchEvents()" (layoutchange)="onLayout($event)">
        <view class="swiper-track" [lynxMainThreadRef]="track">
          @for (slide of slides; track slide.id) {
            <view class="swiper-slide">
              @if (slide.image) {
                <!-- A real photo slide: image is a core built-in, so this
                     renders on every target (unlike video). mode="aspectFill"
                     is Lynx's cover-crop; the caption sits above it in z-order
                     purely by document order, no z-index needed. -->
                <image
                  class="swiper-photo"
                  [src]="slide.image"
                  mode="aspectFill"
                  (load)="onImageLoad(slide.id)"
                  (error)="onImageError(slide.id, $event)"
                />
                <view class="swiper-caption">
                  <text class="swiper-caption-title">{{ slide.label }}</text>
                  <text class="swiper-caption-sub">{{ slide.caption }}</text>
                </view>
              } @else {
                <!-- A composed content slide — no image at all, just laid-out
                     Lynx elements, to show the carousel carries arbitrary
                     content and not only pictures. -->
                <view class="swiper-content" [style.background-color]="slide.color">
                  <text class="swiper-content-kicker">Composed slide</text>
                  <text class="swiper-content-title">{{ slide.label }}</text>
                  <text class="swiper-content-body">{{ slide.caption }}</text>
                  <view class="swiper-content-row">
                    @for (chip of contentChips; track chip) {
                      <view class="swiper-content-chip"><text class="swiper-content-chip-label">{{ chip }}</text></view>
                    }
                  </view>
                </view>
              }
            </view>
          }
        </view>
      </view>

      <text class="demo-desc">
        image status — {{ statusLine() }}
      </text>
      @if (imageError()) {
        <text class="demo-desc">failed: {{ imageError() }} · first image URL: {{ imageBase }}</text>
      }

      <view class="swiper-dots">
        @for (slide of slides; track slide.id; let i = $index) {
          <view
            class="swiper-dot"
            [class.swiper-dot-active]="i === activeIndex()"
            (tap)="goTo(i)"
          ></view>
        }
      </view>
    </view>
  `,
})
export class SwiperDemoComponent {
  /**
   * Three photo slides plus one composed-content slide.
   *
   * `image` goes through {@link lynxAssetUrl} for the same reason every other
   * asset in this repo does: a relative `src` has nothing to resolve against
   * on a real engine and is rejected outright (docs/22-http.md). The files are
   * served from this example's own `public/` directory.
   */
  protected readonly slides = [
    {
      id: 0,
      label: 'Wide awake',
      caption: 'aspectFill crops to the slide, tap a dot to jump',
      image: lynxAssetUrl('media/cat-alert.jpg'),
      color: '',
    },
    {
      id: 1,
      label: 'Off duty',
      caption: 'photo slides and content slides mix freely',
      image: lynxAssetUrl('media/cat-asleep.jpg'),
      color: '',
    },
    {
      id: 2,
      label: 'All white',
      caption: 'drag past the threshold to page',
      image: lynxAssetUrl('media/cat-white.jpg'),
      color: '',
    },
    {
      id: 3,
      label: 'No image needed',
      caption: 'A slide is just Lynx elements — this one has no picture at all.',
      image: '',
      color: '#1f2937',
    },
  ];

  protected readonly contentChips = ['view', 'text', 'flexbox'];

  /** Per-slide load/error status, so a broken asset is visible, not silent. */
  protected readonly imageStatus = signal<Record<number, string>>({});

  protected onImageLoad(id: number): void {
    this.imageStatus.update((s) => ({ ...s, [id]: 'loaded' }));
  }

  protected onImageError(id: number, event: LynxImageErrorEvent): void {
    this.imageStatus.update((s) => ({ ...s, [id]: 'error' }));
    // iOS's message is the whole NSError description: its start says enough.
    this.imageError.set((event.detail?.errMsg || 'no message from the engine').slice(0, 120));
  }

  /** Why the last image failed, and from where, shown under the status line. */
  protected readonly imageError = signal('');
  protected readonly imageBase = this.slides[0]!.image;

  /** Rendered on screen so a failed asset is visible rather than a blank box. */
  protected readonly statusLine = computed(() => {
    const st = this.imageStatus();
    return this.slides
      .filter((s) => s.image)
      .map((s) => `${s.id}:${st[s.id] ?? 'pending'}`)
      .join(' · ');
  });

  protected readonly activeIndex = signal(0);
  protected readonly autoPlay = signal(false);

  private readonly systemInfo = injectSystemInfo();
  /** `.app-scroll-content`'s and `.demo-card`'s padding and border, until `(layoutchange)`. */
  private readonly width = signal(this.systemInfo.pixelWidth / this.systemInfo.pixelRatio - 74);

  protected readonly track = mainThreadRef<MainThreadElement | null>();
  private readonly start = mainThreadRef<SwiperState['start']['current']>(null);
  private readonly pos = mainThreadRef(0);
  private readonly snap = mainThreadRef<SwiperState['snap']['current']>(null);
  private readonly onPage = backgroundFunction((index: number) => this.activeIndex.set(index));

  private readonly state = computed<ToMainThread<SwiperState>>(() => ({
    page: pageScroll,
    track: this.track,
    start: this.start,
    pos: this.pos,
    snap: this.snap,
    count: this.slides.length,
    width: this.width(),
    threshold: DRAG_THRESHOLD_PX,
    onPage: this.onPage,
  }));

  protected readonly touchEvents = computed(() => {
    const state = this.state();
    return {
      touchstart: bindWorklet(swiperStart, state),
      touchmove: bindWorklet(swiperMove, state),
      touchend: bindWorklet(swiperEnd, state),
      touchcancel: bindWorklet(swiperEnd, state),
    };
  });

  private readonly autoPlayHandle = setInterval(() => {
    // Advance one slide every 2s while on. `swiperGoTo` skips it mid-drag.
    if (this.autoPlay()) this.goTo((this.activeIndex() + 1) % this.slides.length);
  }, 2000);

  ngOnDestroy(): void {
    clearInterval(this.autoPlayHandle);
  }

  protected onLayout(event: LynxLayoutChangeEvent): void {
    const width = event.detail?.width;
    if (typeof width === 'number' && width > 0) this.width.set(width);
  }

  protected goTo(index: number): void {
    void runOnMainThread(swiperGoTo)(this.state(), index);
  }
}
