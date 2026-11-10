import {
  ChangeDetectionStrategy,
  Component,
  inject,
  NO_ERRORS_SCHEMA,
} from '@angular/core';
import { Router } from '@angular/router';

interface User {
  id: number;
  name: string;
}

/**
 * Lists users; tapping one navigates to `/users/:id`.
 *
 * There's no `<a>`/`click` on Lynx, so `RouterLink` (which binds a `click`
 * listener) doesn't apply here — navigate imperatively from `(tap)` instead.
 * See docs/15-routing.md.
 */
@Component({
  selector: 'app-users',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="page">
      <text class="title">Users</text>
      @for (user of users; track user.id) {
        <view class="row" (tap)="open(user.id)">
          <text class="row-label">{{ user.name }}</text>
        </view>
      }
    </view>
  `,
})
export class UsersComponent {
  private readonly router = inject(Router);

  readonly users: User[] = [
    { id: 1, name: 'Ada Lovelace' },
    { id: 2, name: 'Alan Turing' },
    { id: 3, name: 'Grace Hopper' },
  ];

  open(id: number): void {
    this.router.navigate(['/users', id]);
  }
}
