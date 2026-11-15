import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import { BackButtonComponent } from './back-button.component.js';

/**
 * Enough rows that the native list recycles cells while scrolling. A cell used
 * to be appended again each time the list asked for it: run.mjs fails the run if
 * the engine logs that.
 */
@Component({
  selector: 'app-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LYNX_ELEMENTS],
  template: `
    <view class="page">
      <app-back-button></app-back-button>
      <text class="title" [flatten]="false">Rows: {{ rows.length }}</text>
      <list class="list" list-type="single" [span-count]="1" scroll-orientation="vertical">
        @for (row of rows; track row) {
          <list-item class="row" [attr.item-key]="row" [estimated-main-axis-size-px]="48">
            <text class="line" [flatten]="false">Row {{ row }}</text>
          </list-item>
        }
      </list>
    </view>
  `,
})
export class ListComponent {
  protected readonly rows = Array.from({ length: 120 }, (_, index) => index);
}
