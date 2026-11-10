import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS, type LynxTouchEvent } from 'angular-lynx/elements';

/**
 * A standalone, zoneless Angular component rendering Lynx elements.
 *
 * `LYNX_ELEMENTS` makes the Lynx tags (`view`, `text`, …) known to the
 * template compiler — fully type-checked under `strictTemplates` — and types
 * `$event` on Lynx events like `(tap)`.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="app">
      <view class="banner">
        <text class="title">__APP_NAME__</text>
        <text class="subtitle">Angular on Lynx — zoneless · signals</text>
      </view>

      <view class="counter" (tap)="increment($event)">
        <text class="count">{{ count() }}</text>
        <text class="hint">Tap to increment</text>
      </view>

      <text class="parity">{{ count() }} is {{ isEven() ? 'even' : 'odd' }}</text>
    </view>
  `,
})
export class AppComponent {
  readonly count = signal(0);
  readonly isEven = computed(() => this.count() % 2 === 0);

  increment(_event: LynxTouchEvent): void {
    this.count.update((n) => n + 1);
  }
}
