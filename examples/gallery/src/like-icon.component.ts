import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

/**
 * The tutorial's `LikeIcon`: a tap likes the picture, with two ripples. The card
 * positions the host (`class="like-icon"`): its `<view>` is what sits over the
 * picture, so the inner view only fills it.
 */
@Component({
  selector: 'app-like-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="like-button" (tap)="liked.set(true)" accessibility-label="Like">
      @if (liked()) {
        <view class="circle"></view>
        <view class="circle circleAfter"></view>
      }
      <text class="heart-love" [class.liked]="liked()">{{ liked() ? '♥' : '♡' }}</text>
    </view>
  `,
})
export class LikeIconComponent {
  readonly liked = signal(false);
}
