/**
 * The **dynamic component** — built into its own standalone bundle by
 * `lynx.config.producer.ts`, and loaded at runtime by the host app in
 * `app.component.ts`.
 *
 * Nothing here is special: it's an ordinary standalone Angular component
 * using ordinary Lynx elements. What makes it loadable is the *build* (see
 * `lynx.config.producer.ts`), not the source — in particular, its
 * `@angular/core` and `angular-lynx` imports are externalized to the host's
 * already-loaded instances, so this bundle carries no copy of them.
 *
 * It deliberately holds its own signal state and its own `(tap)` handler, so
 * the host can demonstrate that a loaded component is fully live — not a
 * static snapshot.
 */
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

import { LYNX_ELEMENTS } from 'angular-lynx/elements';

@Component({
  selector: 'remote-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="remote-card">
      <text class="remote-title">Loaded from a separate bundle</text>
      <text class="remote-body">
        This component was fetched at runtime, not compiled into the host.
      </text>
      <view class="remote-button" (tap)="bump()">
        <text class="remote-button-label">Tapped {{ taps() }}×</text>
      </view>
    </view>
  `,
})
export class RemoteCardComponent {
  readonly taps = signal(0);

  bump(): void {
    this.taps.update((n) => n + 1);
  }
}

/**
 * `loadDynamicComponent()` resolves `{ default }`, so the bundle's entry has
 * to export the component as its default. (Named exports come through too —
 * the whole module namespace is what the engine hands back.)
 */
export default RemoteCardComponent;
