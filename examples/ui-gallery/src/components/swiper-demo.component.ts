import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import { lynxAssetUrl } from 'ng-lynx';
import { LYNX_ELEMENTS, type LynxImageErrorEvent } from 'ng-lynx/elements';

import { lockDrag, unlockDrag } from '../drag-lock.service.js';

/**
 * A recreation of `@lynx-js/lynx-ui`'s `<Swiper>` primitive
 * (https://lynxjs.org/next/ui/components/swiper.html) — a paged, draggable
 * carousel with pagination dots — for ng-lynx.
 *
 * Same portability trade-off as the Draggable demo: drag is driven by plain
 * `(catchtouchstart)`/`(catchtouchmove)`/`(catchtouchend)` rather than the
 * native gesture detector, so it works in the web preview too (see
 * draggable-demo's doc). `catch` alone does not stop the ancestor
 * `.app-scroll` from also scrolling during a drag here — confirmed on a real
 * device, same finding as draggable-demo — so `onStart`/`onEnd` also call
 * `lockDrag()`/`unlockDrag()` (`drag-lock.service.ts`), which is what
 * `app.component.ts` actually gates `.app-scroll`'s `[enable-scroll]` on.
 *
 * The touch listeners are bound to the **static viewport container**, not the
 * moving track, for the same reason as Draggable: a stable coordinate frame.
 * The track's CSS `transition` is toggled off during an active drag (so it
 * tracks the finger 1:1) and on for the snap after release (so releasing
 * settles smoothly instead of jumping) — mirroring the real component's
 * `duration` prop.
 *
 * **No measured pixel width.** The natural design reads the viewport's pixel
 * width via `ShadowElement.fields({ size: true })` and computes
 * `translateX(-activeIndex * width + dragOffset)`. Found live in the real
 * dual-thread web preview: `fields()`'s callback never fires there — the
 * Main-Thread handler calls `nativeApp.getFields(...)`, and
 * `@lynx-js/web-core@0.21`'s `nativeApp` has no `getFields` method at all
 * (`TypeError: nativeApp.getFields is not a function`), for *both*
 * single-element `select()` and multi-element `selectAll()` reads — the
 * project's docs previously only flagged the multi-element case (see
 * docs/10-element-queries.md); this demo is what surfaced that the
 * single-element read is equally affected on the web preview. Rather than
 * depend on a read that can't work here, the base (non-dragging) position is
 * expressed as a CSS **percentage** instead: each `.swiper-slide` is
 * `flex-shrink: 0; width: 100%` (of the track), so the slides overflow the
 * track's own box rather than inflating it — the track's own border-box
 * stays exactly one viewport-width wide no matter how many slides it holds.
 * `transform: translateX()` percentages resolve against the *transformed
 * element's own* border-box (not its content), so `translateX(-100%)` is
 * exactly one viewport-width of travel — `-100% * activeIndex` lands on
 * slide `activeIndex` with no JS measurement at all. `calc()` lets that
 * percentage base and the live pixel drag offset combine in one `transform`.
 * The only remaining pixel quantity is the drag-to-advance threshold, which
 * doesn't need to be measured either — a fixed distance (see
 * `DRAG_THRESHOLD_PX`) is how most touch carousels do it regardless of
 * screen size.
 */
const DRAG_THRESHOLD_PX = 60;

@Component({
  selector: 'swiper-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
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

      <view
        class="swiper-viewport"
        (catchtouchstart)="onStart($event)"
        (catchtouchmove)="onMove($event)"
        (catchtouchend)="onEnd()"
      >
        <view class="swiper-track" [class.swiper-track-animated]="!dragging()" [style.transform]="trackTransform()">
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
  protected readonly dragging = signal(false);
  protected readonly autoPlay = signal(false);

  private readonly dragOffset = signal(0);
  protected readonly trackTransform = computed(() => {
    const basePercent = -100 * this.activeIndex();
    return `translateX(calc(${basePercent}% + ${this.dragOffset()}px))`;
  });

  private startPointerX = 0;
  private autoPlayHandle: ReturnType<typeof setInterval> | undefined;

  ngOnDestroy(): void {
    clearInterval(this.autoPlayHandle);
  }

  constructor() {
    // Autoplay: advance one slide every 2s while enabled, paused while dragging.
    this.autoPlayHandle = setInterval(() => {
      if (!this.autoPlay() || this.dragging()) return;
      this.goTo((this.activeIndex() + 1) % this.slides.length);
    }, 2000);
  }

  protected onStart(event: { detail?: { x?: number } }): void {
    const x = event.detail?.x;
    if (typeof x !== 'number') return;
    this.dragging.set(true);
    lockDrag();
    this.startPointerX = x;
  }

  protected onMove(event: { detail?: { x?: number } }): void {
    if (!this.dragging()) return;
    const x = event.detail?.x;
    if (typeof x !== 'number') return;
    this.dragOffset.set(x - this.startPointerX);
  }

  protected onEnd(): void {
    if (!this.dragging()) return;
    this.dragging.set(false);
    unlockDrag();
    const offset = this.dragOffset();
    let next = this.activeIndex();
    if (offset <= -DRAG_THRESHOLD_PX) next = Math.min(this.slides.length - 1, next + 1);
    else if (offset >= DRAG_THRESHOLD_PX) next = Math.max(0, next - 1);
    this.activeIndex.set(next);
    this.dragOffset.set(0);
  }

  protected goTo(index: number): void {
    this.activeIndex.set(index);
    this.dragOffset.set(0);
  }
}
