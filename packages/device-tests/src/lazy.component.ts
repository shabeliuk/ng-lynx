import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

import { BackButtonComponent } from './back-button.component.js';

/** Only reachable if the async chunk loads from the device. */
@Component({
  selector: 'app-lazy',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, BackButtonComponent],
  template: `
    <view class="page">
      <text class="title" [flatten]="false">Lazy page loaded</text>
      <app-back-button></app-back-button>
    </view>
  `,
})
export class LazyComponent {}
