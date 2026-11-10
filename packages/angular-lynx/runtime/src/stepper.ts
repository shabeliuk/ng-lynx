/**
 * `<lynx-stepper>` — a numeric `ControlValueAccessor` incremented/decremented
 * by tapping `−`/`+` buttons. Lynx has no native `<input type="number">` (see
 * select.ts's doc comment for the built-in elements reference); a stepper
 * sidesteps text input entirely, matching how `LynxCheckbox`/`LynxToggle`
 * sidestep native checkbox/switch elements.
 *
 * ```html
 * <lynx-stepper [min]="0" [max]="10" [(ngModel)]="quantity" />
 * ```
 *
 * The `−`/`+` buttons carry `accessibility-traits="button"` and a descriptive
 * `accessibility-label` — see docs/34-accessibility.md.
 *
 * Ships unstyled — see docs/09-forms.md.
 */
import {
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  Input,
  NO_ERRORS_SCHEMA,
  signal,
} from '@angular/core';
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'lynx-stepper',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LynxStepper),
      multi: true,
    },
  ],
  template: `
    <view class="lynx-stepper" [class.lynx-stepper-disabled]="disabledState()">
      <view
        class="lynx-stepper-btn lynx-stepper-decrement"
        (tap)="adjust(-1)"
        accessibility-traits="button"
        accessibility-label="Decrease"
      >
        <text class="lynx-stepper-btn-label">−</text>
      </view>
      <text class="lynx-stepper-value" [accessibility-value]="value().toString()">{{ value() }}</text>
      <view
        class="lynx-stepper-btn lynx-stepper-increment"
        (tap)="adjust(1)"
        accessibility-traits="button"
        accessibility-label="Increase"
      >
        <text class="lynx-stepper-btn-label">+</text>
      </view>
    </view>
  `,
})
export class LynxStepper implements ControlValueAccessor {
  @Input() min = -Infinity;
  @Input() max = Infinity;
  @Input() step = 1;

  protected readonly value = signal(0);
  protected readonly disabledState = signal(false);

  private onChange: (value: unknown) => void = () => {};
  private onTouchedFn: () => void = () => {};

  protected adjust(direction: 1 | -1): void {
    if (this.disabledState()) return;
    const next = Math.min(this.max, Math.max(this.min, this.value() + direction * this.step));
    if (next !== this.value()) {
      this.value.set(next);
      this.onChange(next);
    }
    this.onTouchedFn();
  }

  writeValue(value: unknown): void {
    this.value.set(typeof value === 'number' ? value : 0);
  }

  registerOnChange(fn: (value: unknown) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouchedFn = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledState.set(isDisabled);
  }
}
