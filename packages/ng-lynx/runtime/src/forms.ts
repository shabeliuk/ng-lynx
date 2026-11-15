/**
 * Two-way input binding for Lynx `<input>` / `<textarea>`.
 *
 * Angular's `@angular/forms` `DefaultValueAccessor` is built for the DOM: it
 * reads `event.target.value` and competes for the element's `input` listener.
 * Lynx instead delivers the text as `event.detail.value` and allows a single
 * listener per event, so the DOM accessor doesn't fit. `LynxModel` is a tiny,
 * dependency-free directive (no `@angular/forms`) that provides ergonomic
 * two-way binding via `[(lynxModel)]`.
 *
 * @example
 * ```html
 * <!-- signals -->
 * <input :placeholder="'Name'"
 *        [lynxModel]="name()"
 *        (lynxModelChange)="name.set($event)" />
 *
 * <!-- or classic two-way banana-in-a-box -->
 * <input [(lynxModel)]="name" />
 * ```
 */
import {
  Directive,
  ElementRef,
  EventEmitter,
  HostBinding,
  HostListener,
  inject,
  Input,
  type OnChanges,
  Output,
  type SimpleChanges,
} from '@angular/core';

import { writeInputValue } from './input-value.js';
import type { ShadowElement } from './shadow-element.js';

interface LynxInputEvent {
  detail?: { value?: string };
}

@Directive({
  selector: 'input[lynxModel], textarea[lynxModel]',
  standalone: true,
})
export class LynxModel implements OnChanges {
  private readonly host = inject<ElementRef<ShadowElement>>(ElementRef);
  /** The last text this directive reported from typing — the element already shows it. */
  private lastTyped: string | undefined;

  /**
   * The bound value. Written to the element's `value` attribute (the web
   * preview reads that) *and* through `setValue` (the native elements have
   * no `value` attribute — see input-value.ts).
   */
  @Input('lynxModel') value: string | number | null = null;

  /** Emits the new text whenever the user edits the field. */
  @Output('lynxModelChange') readonly valueChange = new EventEmitter<string>();

  /** Reflect the model into the native element's `value`. */
  @HostBinding('attr.value')
  get hostValue(): string {
    return this.value == null ? '' : String(this.value);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['value']) return;
    const next = this.hostValue;
    // The model echoing what the user just typed: writing it back would only
    // move their cursor. A programmatic change (pre-fill, clear after send)
    // differs from it and goes through.
    if (next === this.lastTyped) return;
    this.lastTyped = undefined;
    writeInputValue(this.host.nativeElement, next);
  }

  /** Lynx `input` events carry the text in `detail.value`. */
  @HostListener('input', ['$event'])
  onInput(event: LynxInputEvent): void {
    const text = event?.detail?.value ?? '';
    this.lastTyped = text;
    this.valueChange.emit(text);
  }
}
