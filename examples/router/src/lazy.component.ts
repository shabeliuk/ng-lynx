import { ChangeDetectionStrategy, Component, NO_ERRORS_SCHEMA } from '@angular/core';

/**
 * A lazily-loaded route (`loadComponent` + dynamic `import()`). This module is
 * only evaluated when the user first navigates to /lazy — Angular's standard
 * code-splitting seam, exercised here on the Lynx build pipeline.
 */
@Component({
  selector: 'app-lazy',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="page">
      <text class="title">Lazy</text>
      <text class="body">This component was loaded via loadComponent + import().</text>
    </view>
  `,
})
export class LazyComponent {}
