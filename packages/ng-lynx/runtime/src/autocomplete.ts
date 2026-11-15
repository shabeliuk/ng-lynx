/**
 * `<lynx-autocomplete>` — a searchable select: a trigger that opens a modal
 * dialog (same mechanics as `select.ts`'s doc comment — a plain `<view>`
 * styled `position: fixed`, mounted via `@if`, not Lynx's `<overlay>`)
 * containing a search `<input>` and a live-filtered option list below it.
 * Picking a row sets the value and closes the dialog, same as a
 * single-select `LynxSelect`.
 *
 * Earlier revision: an in-flow text field with suggestions appearing below
 * it as you typed, allowing free text not in `options`. That shape proved
 * unreliable on a real device (suggestion taps not registering) even after a
 * `(touchstart)`-based fix; this dialog rewrite is a structural change, not
 * another patch to the old shape — it reuses the same `LynxSelect`/
 * `LynxSelectColumn` dialog mechanics already working elsewhere, and the
 * value is now constrained to an entry in `options` (no more free text).
 *
 * The search `<input>` reuses {@link LynxModel} for its binding.
 *
 * Ships unstyled — see docs/09-forms.md.
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

import { LynxModel } from './forms.js';
import { LynxSelectColumn } from './select-column.js';

@Component({
  selector: 'lynx-autocomplete',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LynxModel, LynxSelectColumn],
  schemas: [NO_ERRORS_SCHEMA],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LynxAutocomplete),
      multi: true,
    },
  ],
  template: `
    <view
      class="lynx-autocomplete"
      [class.lynx-autocomplete-open]="open()"
      [class.lynx-autocomplete-disabled]="disabledState()"
    >
      <view
        class="lynx-autocomplete-trigger"
        [class.lynx-autocomplete-trigger-open]="open()"
        (tap)="toggle()"
      >
        <text class="lynx-autocomplete-value">{{ displayLabel() }}</text>
      </view>
      @if (open()) {
        <view class="lynx-autocomplete-backdrop" (tap.self)="close()">
          <view class="lynx-autocomplete-dialog">
            <input
              class="lynx-autocomplete-search"
              [placeholder]="placeholder"
              [lynxModel]="query()"
              (lynxModelChange)="onQuery($event)"
            />
            @if (filteredOptions().length > 0) {
              <lynx-select-column
                [options]="filteredOptions()"
                [selected]="selectedArr()"
                (pick)="choose($event)"
              />
            } @else {
              <view class="lynx-autocomplete-empty">
                <text class="lynx-autocomplete-empty-label">No results</text>
              </view>
            }
          </view>
        </view>
      }
    </view>
  `,
})
export class LynxAutocomplete implements ControlValueAccessor {
  /** The pickable options; the value is always one of these (or `null`), never free text. */
  @Input({ required: true }) options: readonly string[] = [];

  @Input() placeholder = 'Search…';

  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly disabledState = signal(false);
  private readonly selected = signal<string | null>(null);

  protected readonly selectedArr = computed(() => arr(this.selected()));

  /** All options when the search is empty (browseable), filtered as you type. */
  protected readonly filteredOptions = computed(() => {
    const q = this.query().trim().toLowerCase();
    const matches = q ? this.options.filter((o) => o.toLowerCase().includes(q)) : this.options;
    return matches.map((label) => ({ label, value: label }));
  });

  private onChange: (value: unknown) => void = () => {};
  private onTouchedFn: () => void = () => {};

  protected displayLabel(): string {
    return this.selected() ?? this.placeholder;
  }

  protected toggle(): void {
    if (this.disabledState()) return;
    if (this.open()) {
      this.close();
    } else {
      this.query.set('');
      this.open.set(true);
    }
  }

  protected close(): void {
    this.open.set(false);
    this.onTouchedFn();
  }

  protected onQuery(value: string): void {
    this.query.set(value);
  }

  protected choose(value: string): void {
    this.selected.set(value);
    this.onChange(value);
    this.close();
  }

  writeValue(value: unknown): void {
    this.selected.set(typeof value === 'string' && value ? value : null);
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
