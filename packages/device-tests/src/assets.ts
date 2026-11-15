import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { bootstrapLynxApplication, lynxAssetUrl } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import './app.css';

/** The `assets` bundle: an image loaded through lynxAssetUrl(), with no lazy chunk in the build. */
@Component({
  selector: 'app-assets',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="app">
      <view class="page">
        <text class="title" [flatten]="false">Assets page</text>
        <image class="square" [src]="src" (load)="status.set('Image loaded')" (error)="status.set('Image failed')"></image>
        <text class="line" [flatten]="false">{{ status() }}</text>
      </view>
    </view>
  `,
})
class AssetsComponent {
  // A new URL each run: Explorer keeps images on disk between launches, so a repeat
  // would load without reaching the server run.mjs checks.
  protected readonly src = `${lynxAssetUrl('square.png')}?run=${Date.now()}`;
  protected readonly status = signal('Image waiting');
}

bootstrapLynxApplication(AssetsComponent).catch((err) => {
  console.error('[ng-lynx] bootstrap failed', err);
});
