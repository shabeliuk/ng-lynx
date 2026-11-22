import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { whenFlushed } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';
import { LynxCheckbox, LynxSlider } from 'ng-lynx/forms';

import { BackButtonComponent } from './back-button.component.js';

/** What one churn mounts: 20 rows with an `@if` each, handlers and two form controls. */
@Component({
  selector: 'app-churned',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LYNX_ELEMENTS, LynxCheckbox, LynxSlider],
  template: `
    <view class="churned">
      @for (row of rows; track row) {
        <view class="churn-row" (tap)="tapped = row">
          <text class="line">Row {{ row }}</text>
          @if (row % 2 === 0) {
            <text class="line">even</text>
          }
        </view>
      }
      <lynx-slider [min]="0" [max]="10" [(ngModel)]="volume" />
      <lynx-checkbox [(ngModel)]="agreed">Agree</lynx-checkbox>
    </view>
  `,
})
export class ChurnedComponent {
  readonly rows = Array.from({ length: 20 }, (_, i) => i);
  tapped = -1;
  volume = 3;
  agreed = false;
}

/**
 * Mounts and destroys {@link ChurnedComponent} 1,000 times per tap, waiting for
 * each batch to reach the Main Thread. Native memory is read from outside
 * between rounds (docs/41-device-testing.md, "Memory").
 */
@Component({
  selector: 'app-memory',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, ChurnedComponent, LYNX_ELEMENTS],
  template: `
    <view class="page">
      <app-back-button></app-back-button>
      <view class="button" [flatten]="false" accessibility-label="Churn 1000" (tap)="churn()">
        <text class="button-label">Churn 1000</text>
      </view>
      <text class="line" [flatten]="false">Churned: {{ churned() }}</text>
      @if (shown()) {
        <app-churned />
      }
    </view>
  `,
})
export class MemoryComponent {
  protected readonly churned = signal(0);
  protected readonly shown = signal(false);
  private running = false;

  protected async churn(): Promise<void> {
    if (this.running) return;
    this.running = true;
    for (let i = 0; i < 1000; i++) {
      this.shown.set(true);
      await nextFlush();
      this.shown.set(false);
      await nextFlush();
      if (i % 50 === 49) this.churned.update((n) => n + 50);
    }
    this.running = false;
  }
}

/** After the change detection a signal write schedules, and its flush. */
function nextFlush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0)).then(() => whenFlushed());
}
