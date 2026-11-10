import { ChangeDetectionStrategy, Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

/**
 * The page embedded by the main demo's `<frame>` section
 * (`nested.web.bundle` / `nested.lynx.bundle`) — a separate rspeedy entry, not
 * the `main` one, so `<frame>` can never recurse into itself. A running
 * counter proves it's a genuinely independent, running Lynx page rather than
 * a static snapshot.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="nested">
      <text class="nested-title">👋 nested page</text>
      <text class="nested-body">Loaded via &lt;frame&gt; — a real, separately-running Lynx page.</text>
      <text class="nested-tick">tick: {{ tick() }}</text>
    </view>
  `,
})
export class NestedAppComponent {
  readonly tick = signal(0);

  constructor() {
    setInterval(() => this.tick.update((n) => n + 1), 1000);
  }
}
