import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

/**
 * A standalone, zoneless Angular component that renders with Lynx elements.
 *
 * Notes that make this a *Lynx* component rather than a web one:
 *  - The template uses Lynx tags (`view`, `text`, `image`) instead of HTML.
 *    Importing the `LYNX_ELEMENTS` directives makes those tags known to the
 *    template compiler — fully type-checked under `strictTemplates`, no
 *    `NO_ERRORS_SCHEMA` needed — and types `$event` on Lynx events.
 *  - Tap handling uses `(tap)` — a native Lynx event — not `(click)`.
 *  - State is held in signals; in zoneless mode reading a signal in the template
 *    registers a dependency, and writing it schedules a change-detection pass
 *    that flushes ops to the Main Thread.
 *  - There is no Zone.js.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="app">
      <view class="banner">
        <text class="title">Angular on Lynx</text>
        <text class="subtitle">zoneless · signals · custom renderer</text>
      </view>

      <view class="counter" (tap)="increment()">
        <text class="count">{{ count() }}</text>
        <text class="hint">Tap to increment</text>
      </view>

      <text class="parity" [class.even]="isEven()">
        {{ count() }} is {{ isEven() ? 'even' : 'odd' }}
      </text>

      <view class="list">
        @for (item of items(); track item) {
          <text class="item">• {{ item }}</text>
        } @empty {
          <text class="item">No items yet</text>
        }
      </view>

      <view class="add" (tap)="addItem()">
        <text class="add-label">Add item</text>
      </view>
    </view>
  `,
})
export class AppComponent {
  readonly count = signal(0);
  readonly isEven = computed(() => this.count() % 2 === 0);
  readonly items = signal<string[]>(['Lynx', 'Angular']);

  increment(): void {
    this.count.update((n) => n + 1);
  }

  addItem(): void {
    this.items.update((list) => [...list, `Item ${list.length + 1}`]);
  }
}
