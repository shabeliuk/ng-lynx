import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

import { BackButtonComponent } from './back-button.component.js';

/** On Angular 22, every URL once serialized to `/` on a device, with no error. */
@Component({
  selector: 'app-user',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, BackButtonComponent],
  template: `
    <view class="page">
      <text class="title" [flatten]="false">User {{ id }}</text>
      <app-back-button></app-back-button>
    </view>
  `,
})
export class UserComponent {
  protected readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');
}
