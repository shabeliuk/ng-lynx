import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

/** Loaded via loadComponent + dynamic import() on first navigation. */
@Component({
  selector: 'app-lazy',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="page">
      <text class="title">Lazy</text>
      <text class="body">This component was loaded via loadComponent + import().</text>
    </view>
  `,
})
export class LazyComponent {}
