import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

@Component({
  selector: 'app-about',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="page">
      <text class="title">About</text>
      <text class="body">Plain @angular/router — guards, resolvers, params all work.</text>
    </view>
  `,
})
export class AboutComponent {}
