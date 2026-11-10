import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

@Component({
  selector: 'app-back-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="button" [flatten]="false" accessibility-label="Go back" (tap)="location.back()">
      <text class="button-label">Go back</text>
    </view>
  `,
})
export class BackButtonComponent {
  protected readonly location = inject(Location);
}
