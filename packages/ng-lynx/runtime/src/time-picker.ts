/**
 * `<lynx-time-picker>` — an hour/minute time picker with one combined
 * native-like modal dialog (see select.ts's doc comment for the dialog
 * mechanics, and date-picker.ts's for why several option columns instead of
 * a wheel picker).
 *
 * The value is a 24-hour `'HH:mm'` string or `null`. Minutes step by
 * `minuteStep` (default 5) rather than listing all 60 — override via
 * `[minuteStep]="1"` if you need every minute. Ships unstyled — see
 * docs/09-forms.md.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  Input,
  NO_ERRORS_SCHEMA,
  signal,
} from '@angular/core';
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { LynxSelectColumn, type LynxSelectOption } from './select-column.js';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const HOUR_OPTIONS: readonly LynxSelectOption[] = Array.from({ length: 24 }, (_, h) => {
  const v = pad2(h);
  return { label: v, value: v };
});

const ISO_TIME = /^(\d{2}):(\d{2})$/;

function arr(value: string | null): readonly string[] {
  return value == null ? [] : [value];
}

@Component({
  selector: 'lynx-time-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LynxSelectColumn],
  schemas: [NO_ERRORS_SCHEMA],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LynxTimePicker),
      multi: true,
    },
  ],
  template: `
    <view
      class="lynx-time-picker"
      [class.lynx-time-picker-open]="open()"
      [class.lynx-time-picker-disabled]="disabledState()"
    >
      <view
        class="lynx-time-picker-trigger"
        [class.lynx-time-picker-trigger-open]="open()"
        (tap)="toggle()"
      >
        <text class="lynx-time-picker-value">{{ displayLabel() }}</text>
      </view>
      @if (open()) {
        <view class="lynx-time-picker-backdrop" (tap.self)="close()">
          <view class="lynx-time-picker-dialog">
            <view class="lynx-time-picker-columns">
              <lynx-select-column
                class="lynx-time-picker-hour"
                [options]="hourOptions"
                [selected]="hourArr()"
                (pick)="setHour($event)"
              />
              <lynx-select-column
                class="lynx-time-picker-minute"
                [options]="minuteOptions()"
                [selected]="minuteArr()"
                (pick)="setMinute($event)"
              />
            </view>
            <view class="lynx-select-done" (tap)="close()">
              <text class="lynx-select-done-label">Done</text>
            </view>
          </view>
        </view>
      }
    </view>
  `,
})
export class LynxTimePicker implements ControlValueAccessor {
  @Input() minuteStep = 5;
  @Input() placeholder = 'Select time';

  protected readonly open = signal(false);
  protected readonly hour = signal<string | null>(null);
  protected readonly minute = signal<string | null>(null);
  protected readonly disabledState = signal(false);

  protected readonly hourArr = computed(() => arr(this.hour()));
  protected readonly minuteArr = computed(() => arr(this.minute()));

  protected readonly hourOptions = HOUR_OPTIONS;

  protected minuteOptions(): readonly LynxSelectOption[] {
    const step = Math.max(1, this.minuteStep);
    const opts: LynxSelectOption[] = [];
    for (let m = 0; m < 60; m += step) {
      const v = pad2(m);
      opts.push({ label: v, value: v });
    }
    return opts;
  }

  private onChange: (value: unknown) => void = () => {};
  private onTouchedFn: () => void = () => {};

  protected displayLabel(): string {
    const h = this.hour();
    const m = this.minute();
    return h && m ? `${h}:${m}` : this.placeholder;
  }

  protected toggle(): void {
    if (this.disabledState()) return;
    if (this.open()) this.close();
    else this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
    this.onTouchedFn();
  }

  protected setHour(value: string): void {
    this.hour.set(value);
    this.emit();
  }

  protected setMinute(value: string): void {
    this.minute.set(value);
    this.emit();
  }

  private emit(): void {
    const h = this.hour();
    const m = this.minute();
    this.onChange(h && m ? `${h}:${m}` : null);
  }

  writeValue(value: unknown): void {
    const match = typeof value === 'string' ? ISO_TIME.exec(value) : null;
    this.hour.set(match?.[1] ?? null);
    this.minute.set(match?.[2] ?? null);
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
