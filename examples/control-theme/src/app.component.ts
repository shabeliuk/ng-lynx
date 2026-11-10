import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LYNX_ELEMENTS } from 'angular-lynx/elements';
import {
  LynxCheckbox,
  LynxRadioGroup,
  LynxSegmentedControl,
  type LynxSelectOption,
  LynxSlider,
  LynxStepper,
  LynxToggle,
} from 'angular-lynx/forms';

/**
 * Every control here is styled entirely by `angular-lynx/forms/theme.css`
 * (imported in index.ts) — this component writes no control CSS of its own.
 * app.css only overrides a couple of `--lynx-*` tokens to re-theme the whole
 * kit at once, which is the point of the theme.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LYNX_ELEMENTS,
    FormsModule,
    LynxCheckbox,
    LynxToggle,
    LynxRadioGroup,
    LynxSegmentedControl,
    LynxSlider,
    LynxStepper,
  ],
  template: `
    <view class="app">
      <text class="title">Themed control kit</text>
      <text class="subtitle">All styling from angular-lynx/forms/theme.css</text>

      <lynx-checkbox [(ngModel)]="agreed">
        <text>I agree to the terms</text>
      </lynx-checkbox>

      <lynx-toggle [(ngModel)]="notify">
        <text>Notifications</text>
      </lynx-toggle>

      <text class="label">Plan</text>
      <lynx-radio-group [options]="plans" [(ngModel)]="plan" />

      <text class="label">Units</text>
      <lynx-segmented-control [options]="units" [(ngModel)]="unit" />

      <text class="label">Volume</text>
      <lynx-slider [min]="0" [max]="100" [step]="5" [(ngModel)]="volume" />

      <text class="label">Guests</text>
      <lynx-stepper [min]="1" [max]="9" [(ngModel)]="guests" />
    </view>
  `,
})
export class AppComponent {
  readonly plans: readonly LynxSelectOption[] = [
    { label: 'Free', value: 'free' },
    { label: 'Pro', value: 'pro' },
    { label: 'Team', value: 'team' },
  ];
  readonly units: readonly LynxSelectOption[] = [
    { label: 'Metric', value: 'metric' },
    { label: 'Imperial', value: 'imperial' },
  ];

  agreed = true;
  notify = true;
  plan = 'pro';
  unit = 'metric';
  volume = 60;
  guests = 2;
}
