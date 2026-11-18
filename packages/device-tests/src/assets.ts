import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { bootstrapLynxApplication, lynxAssetUrl } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import './app.css';
// Images imported as modules, as the quick start does: one over the build's 4 kB
// inline limit, emitted as a file, and one under it, inlined as a data: URL.
import dotUrl from './imported-dot.png';
import photoUrl from './imported-photo.png';

/**
 * The `assets` bundle: an image loaded through lynxAssetUrl(), with no lazy chunk in
 * the build, and two images imported as modules.
 */
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
        <image class="square" [src]="photo" (load)="photoStatus.set('Imported file loaded')" (error)="photoStatus.set('Imported file failed')"></image>
        <text class="line" [flatten]="false">{{ photoStatus() }}</text>
        <image class="square" [src]="dot" (load)="dotStatus.set('Inlined image loaded')" (error)="dotStatus.set('Inlined image failed')"></image>
        <text class="line" [flatten]="false">{{ dotStatus() }}</text>
      </view>
    </view>
  `,
})
class AssetsComponent {
  // A new URL each run: Explorer keeps images on disk between launches, so a repeat
  // would load without reaching the server run.mjs checks.
  protected readonly src = `${lynxAssetUrl('square.png')}?run=${Date.now()}`;
  protected readonly status = signal('Image waiting');
  protected readonly photo = `${photoUrl}?run=${Date.now()}`;
  protected readonly dot = dotUrl;
  protected readonly photoStatus = signal('Imported file waiting');
  protected readonly dotStatus = signal('Inlined image waiting');
}

bootstrapLynxApplication(AssetsComponent).catch((err) => {
  console.error('[ng-lynx] bootstrap failed', err);
});
