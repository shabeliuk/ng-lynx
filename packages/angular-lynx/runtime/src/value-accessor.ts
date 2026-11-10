/**
 * `@angular/forms` integration for Lynx `<input>` / `<textarea>`.
 *
 * This is a {@link ControlValueAccessor} so the standard `@angular/forms`
 * directives — `[(ngModel)]`, `[formControl]`, `formControlName`, validators,
 * `<form>` groups — work against Lynx inputs. It exists because the DOM
 * `DefaultValueAccessor` doesn't fit Lynx: the new text arrives as
 * `event.detail.value` (not `event.target.value`), so its `(input)` handler
 * would read `undefined`.
 *
 * `LynxValueAccessor` matches the same elements as `DefaultValueAccessor`, so
 * Angular picks it automatically (a *custom* accessor wins over the built-in
 * default). The two coexist on the element: angular-lynx's renderer multiplexes
 * event listeners, and the dispatched event carries a `target` (the element), so
 * the still-instantiated `DefaultValueAccessor` reads a harmless `undefined`
 * instead of crashing.
 *
 * Import it via the `angular-lynx/forms` entry (keeps `@angular/forms` out of
 * apps that don't use it). For dependency-free two-way binding without
 * `@angular/forms`, use `[(lynxModel)]` from the main entry instead.
 *
 * @example
 * ```ts
 * import { FormsModule } from '@angular/forms';
 * import { LynxValueAccessor } from 'angular-lynx/forms';
 *
 * @Component({
 *   imports: [FormsModule, LynxValueAccessor],
 *   schemas: [NO_ERRORS_SCHEMA],
 *   template: `<input [(ngModel)]="name" />`,
 * })
 * export class AppComponent { name = ''; }
 * ```
 */
import { Directive, ElementRef, forwardRef, inject, Renderer2 } from '@angular/core';
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { writeInputValue } from './input-value.js';
import type { ShadowElement } from './shadow-element.js';

/** The shape of a Lynx text-input event (`input`). */
interface LynxInputEvent {
  detail?: { value?: string };
}

@Directive({
  selector:
    'input[formControlName],textarea[formControlName],'
    + 'input[formControl],textarea[formControl],'
    + 'input[ngModel],textarea[ngModel],'
    + '[lynxControl]',
  standalone: true,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LynxValueAccessor),
      multi: true,
    },
  ],
  host: {
    '(input)': 'onInput($event)',
    '(blur)': 'onBlur()',
  },
})
export class LynxValueAccessor implements ControlValueAccessor {
  // Use `inject()` rather than constructor params: it needs no
  // `design:paramtypes` metadata, so the directive works under both `ngc` and the
  // metadata-free esbuild build used by the verification harnesses.
  private readonly el = inject<ElementRef<ShadowElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);

  private onChange: (value: unknown) => void = () => {};
  private onTouchedFn: () => void = () => {};
  private lastTyped: string | undefined;

  /**
   * forms → element. The native `<input>` / `<textarea>` have no `value`
   * attribute, so a pre-filled, patched or reset control also needs `setValue`
   * (see input-value.ts). The echo of the user's own typing isn't written back:
   * that would only move their cursor.
   */
  writeValue(value: unknown): void {
    const next = value == null ? '' : String(value);
    this.renderer.setAttribute(this.el.nativeElement, 'value', next);
    if (next === this.lastTyped) return;
    this.lastTyped = undefined;
    writeInputValue(this.el.nativeElement, next);
  }

  registerOnChange(fn: (value: unknown) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouchedFn = fn;
  }

  /** forms → element: disable/enable the native control. */
  setDisabledState(isDisabled: boolean): void {
    if (isDisabled) {
      this.renderer.setAttribute(this.el.nativeElement, 'disabled', 'true');
    } else {
      this.renderer.removeAttribute(this.el.nativeElement, 'disabled');
    }
  }

  /** element → forms: Lynx delivers the new text in `event.detail.value`. */
  onInput(event: LynxInputEvent): void {
    const text = event?.detail?.value ?? '';
    this.lastTyped = text;
    this.onChange(text);
  }

  onBlur(): void {
    this.onTouchedFn();
  }
}
