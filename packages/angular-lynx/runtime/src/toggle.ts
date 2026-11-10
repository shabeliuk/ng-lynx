/**
 * `<lynx-toggle>` — a boolean `ControlValueAccessor` rendered as a sliding
 * switch rather than a checkbox. Same semantics as {@link LynxCheckbox} (tap
 * to flip, content-projected label) — separate component because the two
 * look and read differently, matching how the other controls in this file
 * set stay single-purpose rather than growing an `appearance` flag.
 *
 * The thumb's position is **not** `transform`/`left`/`right` — it slides by
 * flipping the track's `justify-content` between `flex-start` and
 * `flex-end`. Deliberate: this session already hit two CSS gotchas where a
 * seemingly-ordinary property silently failed on Lynx's CSS engine (the
 * `inset` shorthand, and relying on an assumed default `flex-direction` —
 * see docs/13-styling.md) — flexbox alignment is the one positioning
 * mechanism verified repeatedly throughout this package, so it's the lowest-
 * risk way to move the thumb without re-verifying a new property from
 * scratch. No slide *animation* for the same reason — `transition` hasn't
 * been verified here either.
 *
 * ```html
 * <lynx-toggle [(ngModel)]="subscribed">
 *   <text>Subscribe to the newsletter</text>
 * </lynx-toggle>
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
  selector: 'lynx-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LynxToggle),
      multi: true,
    },
  ],
  template: `
    <view
      class="lynx-toggle"
      [class.lynx-toggle-on]="checked()"
      [class.lynx-toggle-disabled]="disabledState()"
      (tap)="toggle()"
    >
      <view class="lynx-toggle-track" [class.lynx-toggle-track-on]="checked()">
        <view class="lynx-toggle-thumb"></view>
      </view>
      <view class="lynx-toggle-label">
        <ng-content></ng-content>
      </view>
    </view>
  `,
})
export class LynxToggle implements ControlValueAccessor {
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
