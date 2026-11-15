import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

/**
 * The shell of the test app.
 *
 * Every element a flow taps or reads sets `[flatten]="false"`, here and on each
 * screen. On Android, Lynx draws a flattened element into its parent with no View
 * of its own, so Maestro can't see it.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, RouterOutlet],
  template: `
    <view class="app">
      <router-outlet></router-outlet>
    </view>
  `,
})
export class AppComponent {
  constructor() {
    // Tells run.mjs that leaving the page really destroyed the app: page exit used
    // to throw, and no destroy hook ran. A log line and not a request, because the
    // engine frees the runtime straight after this hook.
    inject(DestroyRef).onDestroy(() => console.log('[device-tests] app destroyed'));
  }
}
