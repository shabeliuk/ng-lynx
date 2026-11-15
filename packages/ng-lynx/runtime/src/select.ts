/**
 * `<lynx-select>` — a single/multi-select with a native-like modal dialog,
 * built from Lynx primitives.
 *
 * Lynx has no native `<select>` or `<picker>` element (confirmed against the
 * built-in elements reference; `lynx-ui`, the official component library,
 * builds its own pickers the same way — composed from `view`/`text`/
 * `scroll-view`, not a native control). `LynxSelect` is a
 * {@link ControlValueAccessor}, so it drops into `[(ngModel)]` / `[formControl]`
 * like any other field; it also exposes a plain `[value]`/`(valueChange)` pair
 * for use without `@angular/forms` (e.g. composed inside `LynxDatePicker`).
 *
 * The dialog is a plain `<view>` styled `position: fixed` (a full-screen
 * backdrop behind a centered box), mounted via `@if` rather than a
 * persistently-toggled `visible` attribute — deliberately **not** Lynx's
 * `<overlay>` element, whose `level` attribute can't be changed while
 * displayed, and whose own docs recommend `position: fixed` anyway for
 * content (like this) that lives entirely inside the Lynx tree rather than
 * embedding a Lynx view into a native host page. Tapping the backdrop closes
 * the dialog via the `(tap.self)` modifier (fires only when the tap
 * originated on the backdrop itself, not a bubbled tap from the dialog box).
 *
 * Ships unstyled (the same headless model `lynx-ui` uses) — style the
 * `lynx-select-*` classes in your own CSS. See `examples/ng-forms` for a
 * worked stylesheet and docs/09-forms.md.
 */
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  forwardRef,
  Input,
  NO_ERRORS_SCHEMA,
  Output,
  signal,
} from '@angular/core';
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { LynxSelectColumn } from './select-column.js';
import type { LynxSelectOption } from './select-column.js';

export type { LynxSelectOption };

type LynxSelectValue = string | readonly string[] | null;

@Component({
  selector: 'lynx-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LynxSelectColumn],
  schemas: [NO_ERRORS_SCHEMA],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LynxSelect),
      multi: true,
    },
  ],
  template: `
    <view
      class="lynx-select"
      [class.lynx-select-open]="open()"
      [class.lynx-select-disabled]="isDisabled()"
    >
      <view class="lynx-select-trigger" [class.lynx-select-trigger-open]="open()" (tap)="toggle()">
        <text class="lynx-select-value">{{ displayLabel() }}</text>
      </view>
      @if (open()) {
        <view class="lynx-select-backdrop" (tap.self)="close()">
          <view class="lynx-select-dialog">
            <lynx-select-column [options]="options" [selected]="selectedValues()" (pick)="choose($event)" />
            @if (multiple) {
              <view class="lynx-select-done" (tap)="close()">
                <text class="lynx-select-done-label">Done</text>
              </view>
            }
          </view>
        </view>
      }
    </view>
  `,
})
export class LynxSelect implements ControlValueAccessor {
  /** The pickable options. */
  @Input({ required: true }) options: readonly LynxSelectOption[] = [];

  /** When `true`, `value` is a `string[]` and the panel stays open between picks. */
  @Input() multiple = false;

  @Input() placeholder = 'Select…';

  @Input()
  set value(v: LynxSelectValue) {
    this.applyValue(v);
  }
  get value(): LynxSelectValue {
    return this.multiple ? this.selectedMany() : this.selectedOne();
  }

  @Input()
  set disabled(v: boolean) {
    this.disabledState.set(v);
  }
  get disabled(): boolean {
    return this.disabledState();
  }

  /** Emits the new value on every pick (single) or panel-close (multi). */
  @Output() readonly valueChange = new EventEmitter<string | readonly string[]>();

  protected readonly open = signal(false);
  protected readonly disabledState = signal(false);
  protected readonly isDisabled = this.disabledState.asReadonly();
  private readonly selectedOne = signal<string | null>(null);
  private readonly selectedMany = signal<readonly string[]>([]);

  private onChange: (value: unknown) => void = () => {};
  private onTouchedFn: () => void = () => {};

  private labelOf(value: string): string {
    return this.options.find((o) => o.value === value)?.label ?? value;
  }

  protected displayLabel(): string {
    if (this.multiple) {
      const values = this.selectedMany();
      return values.length ? values.map((v) => this.labelOf(v)).join(', ') : this.placeholder;
    }
    const value = this.selectedOne();
    return value == null ? this.placeholder : this.labelOf(value);
  }

  /** Values to highlight in the option column — one for single-select, several for multi. */
  protected selectedValues(): readonly string[] {
    if (this.multiple) return this.selectedMany();
    const value = this.selectedOne();
    return value == null ? [] : [value];
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

  protected choose(value: string): void {
    if (this.multiple) {
      const current = this.selectedMany();
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      this.selectedMany.set(next);
      this.onChange(next);
      this.valueChange.emit(next);
    } else {
      this.selectedOne.set(value);
      this.onChange(value);
      this.valueChange.emit(value);
      this.close();
    }
  }

  private applyValue(v: LynxSelectValue): void {
    if (this.multiple) {
      this.selectedMany.set(Array.isArray(v) ? v : []);
    } else {
      this.selectedOne.set(typeof v === 'string' ? v : null);
    }
  }

  writeValue(value: unknown): void {
    this.applyValue(value as LynxSelectValue);
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
