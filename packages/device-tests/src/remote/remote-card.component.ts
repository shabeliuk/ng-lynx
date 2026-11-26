import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import './remote-card.css';

/**
 * The component the `bundle` screen loads from a bundle of its own, built by
 * lynx.config.producer.ts. It keeps its own signal and its own `(tap)`, so the
 * screen can tell a live component from a copy of one.
 */
@Component({
  selector: 'remote-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <!-- remote-card.css hides the first text: it shows up only if the bundle's own CSS wasn't applied. -->
    <text class="remote-unstyled" [flatten]="false">Card CSS not applied</text>
    <text class="remote-styled" [flatten]="false">Card CSS applied</text>
    <view class="button" [flatten]="false" (tap)="taps.update((n) => n + 1)">
      <text class="button-label" [flatten]="false">Card taps: {{ taps() }}</text>
    </view>
  `,
})
export class RemoteCardComponent {
  readonly taps = signal(0);
}

export default RemoteCardComponent;
