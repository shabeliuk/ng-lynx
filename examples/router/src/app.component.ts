import { ChangeDetectionStrategy, Component, inject, NO_ERRORS_SCHEMA } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

/**
 * Root shell: a tap-driven nav bar + `<router-outlet>`.
 *
 * `<router-outlet>` renders as a real (empty, unstyled) host element with the
 * active route's component inserted as its sibling — same as on the DOM. See
 * docs/15-routing.md and docs/14-content-projection.md (the "nested components
 * create a real host element" note applies to `<router-outlet>` too).
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [RouterOutlet],
  template: `
    <view class="app">
      <view class="nav">
        <view class="nav-btn" (tap)="go('/')"><text class="nav-label">Home</text></view>
        <view class="nav-btn" (tap)="go('/users')"><text class="nav-label">Users</text></view>
        <view class="nav-btn" (tap)="go('/lazy')"><text class="nav-label">Lazy</text></view>
      </view>
      <view class="content">
        <router-outlet></router-outlet>
      </view>
    </view>
  `,
})
export class AppComponent {
  private readonly router = inject(Router);
  go(path: string): void {
    this.router.navigateByUrl(path);
  }
}
