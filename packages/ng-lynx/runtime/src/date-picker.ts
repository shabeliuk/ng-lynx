/**
 * `<lynx-date-picker>` — a day/month/year date picker with one combined
 * native-like modal dialog (see select.ts's doc comment for the dialog
 * mechanics — same `position: fixed` backdrop + `(tap.self)`-to-close
 * pattern, and for why there's no native picker control to wrap at all).
 *
 * The three fields share **one** dialog (three `LynxSelectColumn`s side by
 * side) rather than each opening its own, the way a native date dialog
 * presents day/month/year together. There's no scroll-snap primitive
 * documented on `<scroll-view>` to build an iOS-style wheel picker against,
 * so several option columns is the fallback, the same way it is in many web
 * date pickers.
 *
 * The value is an ISO date string (`'YYYY-MM-DD'`) or `null`. Ships unstyled —
 * see docs/09-forms.md.
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

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Days in `month` (1-based) of `year`, leap-year-correct. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

@Component({
  selector: 'lynx-date-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LynxSelectColumn],
  schemas: [NO_ERRORS_SCHEMA],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LynxDatePicker),
      multi: true,
    },
  ],
  template: `
    <view
      class="lynx-date-picker"
      [class.lynx-date-picker-open]="open()"
      [class.lynx-date-picker-disabled]="disabledState()"
    >
      <view
        class="lynx-date-picker-trigger"
        [class.lynx-date-picker-trigger-open]="open()"
        (tap)="toggle()"
      >
        <text class="lynx-date-picker-value">{{ displayLabel() }}</text>
      </view>
      @if (open()) {
        <view class="lynx-date-picker-backdrop" (tap.self)="close()">
          <view class="lynx-date-picker-dialog">
            <view class="lynx-date-picker-columns">
              <lynx-select-column
                class="lynx-date-picker-day"
                [options]="dayOptions()"
                [selected]="dayArr()"
                (pick)="setDay($event)"
              />
              <lynx-select-column
                class="lynx-date-picker-month"
                [options]="monthOptions"
                [selected]="monthArr()"
                (pick)="setMonth($event)"
              />
              <lynx-select-column
                class="lynx-date-picker-year"
                [options]="yearOptions()"
                [selected]="yearArr()"
                (pick)="setYear($event)"
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
export class LynxDatePicker implements ControlValueAccessor {
  /** `[from, to]` inclusive; defaults to the last 100 years up to this year. */
  @Input() yearRange: readonly [number, number] = (() => {
    const now = new Date().getFullYear();
    return [now - 100, now];
  })();

  @Input() placeholder = 'Select date';

  protected readonly open = signal(false);
  protected readonly day = signal<string | null>(null);
  protected readonly month = signal<string | null>(null);
  protected readonly year = signal<string | null>(null);
  protected readonly disabledState = signal(false);

  protected readonly dayArr = computed(() => arr(this.day()));
  protected readonly monthArr = computed(() => arr(this.month()));
  protected readonly yearArr = computed(() => arr(this.year()));

  protected readonly monthOptions: readonly LynxSelectOption[] = MONTH_NAMES.map(
    (label, i) => ({ label, value: pad2(i + 1) }),
  );

  protected readonly yearOptions = computed<readonly LynxSelectOption[]>(() => {
    const [from, to] = this.yearRange;
    const years: LynxSelectOption[] = [];
    for (let y = to; y >= from; y--) years.push({ label: String(y), value: String(y) });
    return years;
  });

  /** Day count follows the selected month/year (leap years included). */
  protected readonly dayOptions = computed<readonly LynxSelectOption[]>(() => {
    const y = this.year() ? Number(this.year()) : new Date().getFullYear();
    const m = this.month() ? Number(this.month()) : 1;
    const count = daysInMonth(y, m);
    return Array.from({ length: count }, (_, i) => {
      const d = pad2(i + 1);
      return { label: d, value: d };
    });
  });

  private onChange: (value: unknown) => void = () => {};
  private onTouchedFn: () => void = () => {};

  protected displayLabel(): string {
    const d = this.day();
    const m = this.month();
    const y = this.year();
    if (!d || !m || !y) return this.placeholder;
    return `${MONTH_NAMES[Number(m) - 1]} ${Number(d)}, ${y}`;
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

  protected setDay(value: string): void {
    this.day.set(value);
    this.emit();
  }

  protected setMonth(value: string): void {
    this.month.set(value);
    this.clampDay();
    this.emit();
  }

  protected setYear(value: string): void {
    this.year.set(value);
    this.clampDay();
    this.emit();
  }

  /** Re-picking a shorter month/year (e.g. Jan 31st → Feb) clamps day to the new max. */
  private clampDay(): void {
    const max = this.dayOptions().length;
    const current = this.day();
    if (current != null && Number(current) > max) {
      this.day.set(pad2(max));
    }
  }

  private emit(): void {
    const d = this.day();
    const m = this.month();
    const y = this.year();
    this.onChange(d && m && y ? `${y}-${m}-${d}` : null);
  }

  writeValue(value: unknown): void {
    const match = typeof value === 'string' ? ISO_DATE.exec(value) : null;
    this.year.set(match?.[1] ?? null);
    this.month.set(match?.[2] ?? null);
    this.day.set(match?.[3] ?? null);
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

function arr(value: string | null): readonly string[] {
  return value == null ? [] : [value];
}
