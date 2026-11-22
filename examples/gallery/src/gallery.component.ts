import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  signal,
  viewChild,
} from '@angular/core';
import {
  asLynxElement,
  bindWorklet,
  injectSystemInfo,
  LynxMainThread,
  LynxMainThreadRef,
  mainThreadRef,
} from 'ng-lynx';
import { LYNX_ELEMENTS, type LynxListScrollEvent } from 'ng-lynx/elements';
import type { MainThreadElement } from 'ng-lynx/worklet';

import { ImageCardComponent } from './image-card.component.js';
import { pictures } from './pictures.js';
import { adjustScrollbar } from './scrollbar.mt.js';
import { calculateEstimatedSize } from './utils.js';

/**
 * The official Gallery tutorial (https://lynxjs.org/guide/start/tutorial-gallery) in
 * Angular: a two-column waterfall `<list>` that scrolls itself through `invoke`, with
 * the tutorial's comparison of two scrollbars. The left one follows `(scroll)` on the
 * Background Thread; the right one, a worklet on the Main Thread.
 */
@Component({
  selector: 'app-gallery',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ImageCardComponent, LYNX_ELEMENTS, LynxMainThread, LynxMainThreadRef],
  template: `
    <view class="gallery-wrapper">
      <view class="header">
        <text class="title">Gallery</text>
      </view>
      <view class="list-wrapper">
        <list
          #gallery
          class="list"
          list-type="waterfall"
          [span-count]="2"
          scroll-orientation="vertical"
          [scroll-event-throttle]="0"
          (scroll)="onScroll($event)"
          (layoutcomplete)="startAutoScroll()"
          [lynxMainThread]="mainThreadScroll"
        >
          @for (picture of pictures; track picture.label) {
            <list-item
              [item-key]="picture.label"
              [estimated-main-axis-size-px]="estimatedSize(picture.width, picture.height)"
            >
              <app-image-card [picture]="picture" />
            </list-item>
          }
        </list>
        <view
          class="scrollbar scrollbar-background"
          [style.height.px]="backgroundThumbHeight()"
          [style.top.px]="backgroundThumbTop()"
        >
          <view class="scrollbar-effect glow"></view>
        </view>
        <view class="scrollbar" [lynxMainThreadRef]="thumb">
          <view class="scrollbar-effect glow"></view>
        </view>
      </view>
    </view>
  `,
})
export class GalleryComponent {
  readonly pictures = pictures;
  private readonly system = injectSystemInfo();
  private readonly screenWidth = this.system.pixelWidth / this.system.pixelRatio;
  /** The tutorial's `screenHeight - 48`: the list fills the screen below the header. */
  private readonly listHeight = this.system.pixelHeight / this.system.pixelRatio - 48;

  private readonly gallery = viewChild.required('gallery', { read: ElementRef });

  protected readonly backgroundThumbHeight = signal(0);
  protected readonly backgroundThumbTop = signal(0);

  protected readonly thumb = mainThreadRef<MainThreadElement | null>();
  protected readonly mainThreadScroll = {
    scroll: bindWorklet(adjustScrollbar, { thumb: this.thumb, listHeight: this.listHeight }),
  };

  private scrolling = false;

  /**
   * The tutorial starts scrolling from a `useEffect`. Here it waits for the list's
   * first `layoutcomplete`: on Android, an `autoScroll` that arrived before the list
   * had laid out its items was ignored on some loads.
   */
  protected startAutoScroll(): void {
    if (this.scrolling) return;
    this.scrolling = true;
    asLynxElement<'list'>(this.gallery().nativeElement).invoke({
      method: 'autoScroll',
      params: { rate: '60', start: true },
    });
  }

  protected estimatedSize(width: number, height: number): number {
    return calculateEstimatedSize(this.screenWidth, width, height);
  }

  /** The tutorial's first scrollbar: each `scroll` crosses to the Background Thread and back. */
  protected onScroll(event: LynxListScrollEvent): void {
    const { scrollTop, scrollHeight } = event.detail;
    if (!scrollHeight) return;
    this.backgroundThumbHeight.set(this.listHeight * (this.listHeight / scrollHeight));
    this.backgroundThumbTop.set(this.listHeight * (scrollTop / scrollHeight));
  }
}
