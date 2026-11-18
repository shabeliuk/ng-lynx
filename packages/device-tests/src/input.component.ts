import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';
import { LynxValueAccessor } from 'ng-lynx/forms';

import { BackButtonComponent } from './back-button.component.js';

/**
 * The native keyboard. On Android, Return only fires `(confirm)` with `confirm-type` set.
 * The second field is `[(ngModel)]`: typing in the middle of its text must leave the
 * cursor where it was, so the accessor mustn't write each keystroke back.
 */
@Component({
  selector: 'app-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, FormsModule, LYNX_ELEMENTS, LynxValueAccessor],
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
      <input class="field" [flatten]="false" accessibility-label="Model field" [(ngModel)]="model" />
      <text class="line" [flatten]="false">Model: {{ model() }}</text>
    </view>
  `,
})
export class InputComponent {
  protected readonly typed = signal('');
  protected readonly confirmed = signal('');
  protected readonly model = signal('');
}
