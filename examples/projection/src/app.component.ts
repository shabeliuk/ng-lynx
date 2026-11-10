import {
  ChangeDetectionStrategy,
  Component,
  NO_ERRORS_SCHEMA,
  signal,
} from '@angular/core';

import { CardComponent } from './card.component.js';

/**
 * Two `<app-card>` instances projecting different content into the same
 * named + default slots — including a `(tap)` handler bound on a node that
 * lives in the *consumer's* template but renders inside the card's body, to
 * prove events on projected content reach the consumer's own handler.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [CardComponent],
  template: `
    <view class="app">
      <text class="title">Content projection</text>

      <app-card class="profile">
        <text header class="header-label">Profile</text>
        <text class="line">Ada Lovelace</text>
        <text class="line muted">Engineer</text>
      </app-card>

      <app-card class="actions">
        <text header class="header-label">Counter</text>
        <text class="line">Tapped {{ count() }} times</text>
        <view class="btn" (tap)="inc()">
          <text class="btn-label">Tap me</text>
        </view>
      </app-card>
    </view>
  `,
})
export class AppComponent {
  readonly count = signal(0);
  inc(): void {
    this.count.update((n) => n + 1);
  }
}
