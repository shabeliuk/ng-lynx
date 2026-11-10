import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="page">
      <text class="title">Home</text>
      <text class="body">Tap the nav above to switch routes.</text>
    </view>
  `,
})
export class HomeComponent {}
