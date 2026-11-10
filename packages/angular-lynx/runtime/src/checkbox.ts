/**
 * `<lynx-checkbox>` — a boolean `ControlValueAccessor`. Lynx has no native
 * `<input type="checkbox">` (see select.ts's doc comment for the built-in
 * elements reference), so this is a `view`/`text` box that toggles on tap.
 *
 * The label is projected content, not a plain-string `@Input()` — so it can
 * be any markup, and tapping anywhere in the row (box or label) toggles it,
 * the same way a native `<label><input type="checkbox">…</label>` does:
 *
 * ```html
 * <lynx-checkbox [(ngModel)]="agreed">
 *   <text>I agree to the terms</text>
 * </lynx-checkbox>
 * ```
 *
 * Ships unstyled — see docs/09-forms.md.
 */
import {
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  NO_ERRORS_SCHEMA,
  signal,
} from '@angular/core';
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'lynx-checkbox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LynxCheckbox),
      multi: true,
    },
  ],
  template: `
    <view
      class="lynx-checkbox"
      [class.lynx-checkbox-checked]="checked()"
      [class.lynx-checkbox-disabled]="disabledState()"
      (tap)="toggle()"
    >
      <view class="lynx-checkbox-box" [class.lynx-checkbox-box-checked]="checked()">
        @if (checked()) {
          <text class="lynx-checkbox-mark">✓</text>
        }
      </view>
      <view class="lynx-checkbox-label">
        <ng-content></ng-content>
      </view>
    </view>
  `,
})
export class LynxCheckbox implements ControlValueAccessor {
  protected readonly checked = signal(false);
  protected readonly disabledState = signal(false);

  private onChange: (value: unknown) => void = () => {};
  private onTouchedFn: () => void = () => {};

  protected toggle(): void {
    if (this.disabledState()) return;
    const next = !this.checked();
    this.checked.set(next);
    this.onChange(next);
    this.onTouchedFn();
  }

  writeValue(value: unknown): void {
    this.checked.set(value === true);
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
