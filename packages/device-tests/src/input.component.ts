import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import { BackButtonComponent } from './back-button.component.js';

/** The native keyboard. On Android, Return only fires `(confirm)` with `confirm-type` set. */
@Component({
  selector: 'app-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LYNX_ELEMENTS],
  template: `
    <view class="page">
      <app-back-button></app-back-button>
      <input
        class="field"
        [flatten]="false"
        accessibility-label="Name field"
        confirm-type="done"
        (input)="typed.set($event.detail.value)"
        (confirm)="confirmed.set(typed())"
      />
      <text class="line" [flatten]="false">Typed: {{ typed() }}</text>
      <text class="line" [flatten]="false">Confirmed: {{ confirmed() }}</text>
    </view>
  `,
})
export class InputComponent {
  protected readonly typed = signal('');
  protected readonly confirmed = signal('');
}
