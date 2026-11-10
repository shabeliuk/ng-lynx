import { ChangeDetectionStrategy, Component, inject, NO_ERRORS_SCHEMA } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

/**
 * Reads the `:id` route param from `ActivatedRoute.snapshot` and navigates back
 * via the injected `Location` service — both work unchanged on Lynx, backed by
 * `LynxPlatformLocation`'s in-memory history stack instead of `window.history`.
 */
@Component({
  selector: 'app-user-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="page">
      <text class="title">User #{{ id }}</text>
      <view class="row" (tap)="back()">
        <text class="row-label">← Back</text>
      </view>
    </view>
  `,
})
export class UserDetailComponent {
  private readonly location = inject(Location);
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');

  back(): void {
    this.location.back();
  }
}
