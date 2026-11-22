import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import { LikeIconComponent } from './like-icon.component.js';
import type { Picture } from './pictures.js';

/** The tutorial's `ImageCard`: a picture, its own shape, and a like button over it. */
@Component({
  selector: 'app-image-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LikeIconComponent, LYNX_ELEMENTS],
  template: `
    <view class="picture-wrapper">
      <view
        class="picture"
        [style.aspect-ratio]="picture().width + '/' + picture().height"
        [style.background-color]="picture().color"
      >
        <text class="picture-label">{{ picture().label }}</text>
      </view>
      <app-like-icon class="like-icon" />
    </view>
  `,
})
export class ImageCardComponent {
  readonly picture = input.required<Picture>();
}
