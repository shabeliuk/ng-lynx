/**
 * `<lynx-select-column>` — an internal, non-CVA presentational piece: one
 * scrollable column of tappable options with highlighted selection. Shared by
 * `LynxSelect`'s dialog, the combined `LynxDatePicker` / `LynxTimePicker`
 * dialogs, and `LynxAutocomplete`'s search dialog, so there's one rendering of
 * "a list of options you can tap" rather than near-identical copies in each.
 * Not exported from `ng-lynx/forms` — it carries no value-accessor
 * contract of its own; the parent decides what a pick means (set-and-close
 * for a plain select, toggle-in-array for multi-select, update-one-field-of-
 * several for a composite picker, or set-and-close again for autocomplete).
 *
 * Picks commit on plain `(tap)` only.
 *
 * Dead end, left here deliberately: an earlier revision also bound
 * `(touchstart)`, theorizing that tapping a row next to `LynxAutocomplete`'s
 * focused search input could blur it, dismiss the keyboard, and have the
 * resulting layout shift drop or mis-land the tap — `(touchstart)` would
 * commit ahead of that. It was never actually confirmed: every device test
 * of it happened to also be hitting the unrelated `Object.hasOwn` PrimJS
 * crash (see entry-background.ts), which made the app fail to load at all,
 * so nothing about the touchstart theory was independently verified either
 * way. What it *did* cause, confirmed on device: closing a dialog (the
 * normal outcome of a single-select pick) removes the backdrop from the
 * tree mid-gesture, while the same physical touch is still completing —
 * the finger-lift's tap then lands on whatever is newly exposed underneath
 * (e.g. another field's trigger), opening *that* field's dialog. For
 * multi-select, which doesn't close on pick, the row stays put instead — so
 * both `(touchstart)` and `(tap)` fired for one physical tap, toggling the
 * value on and immediately back off. Reverted rather than patched further;
 * if the original blur/keyboard concern turns out to still be real on a
 * clean build, it needs a fix that doesn't remove the tapped element
 * mid-gesture (e.g. preventing the blur itself, not racing it).
 */
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  NO_ERRORS_SCHEMA,
  Output,
} from '@angular/core';

export interface LynxSelectOption {
  readonly label: string;
  readonly value: string;
}

@Component({
  selector: 'lynx-select-column',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <scroll-view
      class="lynx-select-list"
      scroll-orientation="vertical"
      [initial-scroll-to-index]="selectedIndex()"
    >
      @for (opt of options; track opt.value) {
        <view
          class="lynx-select-option"
          flatten="false"
          [class.lynx-select-option-selected]="selected.includes(opt.value)"
          (tap)="pick.emit(opt.value)"
        >
          <text class="lynx-select-option-label">{{ opt.label }}</text>
        </view>
      }
    </scroll-view>
  `,
})
export class LynxSelectColumn {
  @Input({ required: true }) options: readonly LynxSelectOption[] = [];
  /** Values to highlight as selected (one for a single pick, several for multi). */
  @Input() selected: readonly string[] = [];
  @Output() readonly pick = new EventEmitter<string>();

  /**
   * The dialog that hosts this column is mounted fresh (via `@if`) on every
   * open (see select.ts's doc comment) — so `<scroll-view>`'s
   * `initial-scroll-to-index` re-applies every time, not just once ever,
   * which is exactly the "scroll to the selected row so it's visible without
   * hunting for it" behavior a reopened dialog needs. `undefined` (nothing
   * selected yet) leaves the scroll-view at its default top position.
   *
   * Each row carries `flatten="false"` — Lynx's own docs for
   * `initial-scroll-to-index` state "All direct child nodes must be
   * flatten=false", and this was the missing piece: without it, on-device
   * testing found the target row landing at wildly different vertical
   * positions between two columns of the *same* dialog (one flush at the
   * top, the other in the middle) even though both went through this exact
   * same code path — consistent with the engine falling back to some other
   * positioning behavior when the documented precondition isn't met, rather
   * than a bug in the index/value math itself (which was already correct in
   * both cases — the *right* row highlighted, just inconsistently placed).
   */
  protected selectedIndex(): number | undefined {
    if (this.selected.length === 0) return undefined;
    const index = this.options.findIndex((o) => this.selected.includes(o.value));
    return index >= 0 ? index : undefined;
  }
}
