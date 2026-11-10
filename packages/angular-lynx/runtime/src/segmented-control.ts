/**
 * `<lynx-segmented-control>` — a row of mutually-exclusive, contiguous
 * "pill" segments (the iOS `UISegmentedControl` pattern), all visible inline.
 * Value semantics are identical to {@link LynxRadioGroup} (a `string`, all
 * options always rendered) — kept as a separate component because the two
 * read differently (a joined button row vs. a list of radio rows), matching
 * how `LynxCheckbox`/`LynxToggle` stay separate despite sharing `boolean`
 * semantics.
 *
 * Reuses {@link LynxSelectOption} (`{ label, value }`) — same shape, no
 * reason to duplicate it.
 *
 * ```html
 * <lynx-segmented-control [options]="units" [(ngModel)]="unit" />
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
  selector: 'lynx-segmented-control',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LynxSegmentedControl),
      multi: true,
    },
  ],
  template: `
    <view class="lynx-segmented-control" [class.lynx-segmented-control-disabled]="disabledState()">
      @for (opt of options; track opt.value) {
        <view
          class="lynx-segment"
          [class.lynx-segment-selected]="selected() === opt.value"
          (tap)="choose(opt.value)"
        >
          <text
            class="lynx-segment-label"
            [class.lynx-segment-label-selected]="selected() === opt.value"
            >{{ opt.label }}</text
          >
        </view>
      }
    </view>
  `,
})
export class LynxSegmentedControl implements ControlValueAccessor {
  /** The mutually-exclusive segments. */
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
