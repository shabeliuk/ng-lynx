/**
 * `<lynx-radio-group>` — a mutually-exclusive set of options, all visible
 * inline (not behind a dialog, unlike `LynxSelect`) — the conventional radio
 * UX, since a handful of options are normally shown at once rather than
 * hidden behind a trigger. Lynx has no native radio-button control (see
 * select.ts's doc comment for the built-in elements reference), so each
 * option is a `view`/`text` row with a circle indicator that fills when
 * selected.
 *
 * Reuses {@link LynxSelectOption} (`{ label, value }`) rather than a separate
 * type — same shape, no reason to duplicate it.
 *
 * ```html
 * <lynx-radio-group [options]="contactMethods" [(ngModel)]="contactMethod" />
 * ```
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

import type { LynxSelectOption } from './select-column.js';

@Component({
  selector: 'lynx-radio-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LynxRadioGroup),
      multi: true,
    },
  ],
  template: `
    <view class="lynx-radio-group" [class.lynx-radio-group-disabled]="disabledState()">
      @for (opt of options; track opt.value) {
        <view
          class="lynx-radio-option"
          [class.lynx-radio-option-selected]="selected() === opt.value"
          (tap)="choose(opt.value)"
        >
          <view
            class="lynx-radio-dot-outer"
            [class.lynx-radio-dot-outer-selected]="selected() === opt.value"
          >
            @if (selected() === opt.value) {
              <view class="lynx-radio-dot-inner"></view>
            }
          </view>
          <text class="lynx-radio-label">{{ opt.label }}</text>
        </view>
      }
    </view>
  `,
})
export class LynxRadioGroup implements ControlValueAccessor {
  /** The mutually-exclusive options. */
  @Input({ required: true }) options: readonly LynxSelectOption[] = [];

  protected readonly selected = signal<string | null>(null);
  protected readonly disabledState = signal(false);

  private onChange: (value: unknown) => void = () => {};
  private onTouchedFn: () => void = () => {};

  protected choose(value: string): void {
    if (this.disabledState()) return;
    this.selected.set(value);
    this.onChange(value);
    this.onTouchedFn();
  }

  writeValue(value: unknown): void {
    this.selected.set(typeof value === 'string' ? value : null);
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
