import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

/**
 * Root shell: a tap-driven nav bar + `<router-outlet>`. There is no
 * `RouterLink` on Lynx (no click/anchor semantics) — navigate imperatively
 * via the injected Router.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, RouterOutlet],
  template: `
    <view class="app">
      <view class="nav">
        <view class="nav-btn" (tap)="go('/')"><text class="nav-label">Home</text></view>
        <view class="nav-btn" (tap)="go('/about')"><text class="nav-label">About</text></view>
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
