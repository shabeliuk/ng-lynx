import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { LynxEnter, LynxLeave } from 'ng-lynx';
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
 *  - List items animate in and out with `lynxEnter` / `lynxLeave` and CSS
 *    keyframes (app.css): Angular's own `animate.enter` / `animate.leave` need a
 *    DOM, which Lynx doesn't have. Tap an item to remove it.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, LynxEnter, LynxLeave],
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
        <text class="list-hint">Tap an item to remove it</text>
        @for (item of items(); track item) {
          <text class="item" lynxEnter="item-in" lynxLeave="item-out" (tap)="removeItem(item)">• {{ item }}</text>
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
  /** Numbers new items, so a name never comes back after a removal (`track item`). */
  private added = 0;

  increment(): void {
    this.count.update((n) => n + 1);
  }

  addItem(): void {
    this.items.update((list) => [...list, `Item ${++this.added}`]);
  }

  removeItem(item: string): void {
    this.items.update((list) => list.filter((it) => it !== item));
  }
}
