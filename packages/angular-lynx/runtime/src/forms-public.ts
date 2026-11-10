/**
 * `angular-lynx/forms` — `@angular/forms` integration for Lynx.
 *
 * Import {@link LynxValueAccessor} into a component (alongside `FormsModule` or
 * `ReactiveFormsModule`) to use `[(ngModel)]`, `[formControl]`, `formControlName`,
 * validators, and `<form>` groups against Lynx `<input>` / `<textarea>`.
 *
 * This entry pulls in `@angular/forms`; if you only need simple two-way binding,
 * prefer the dependency-free `[(lynxModel)]` from the main `angular-lynx` entry.
 *
 * It also ships richer controls Lynx has no native element for — a select
 * ({@link LynxSelect}, single or multi), a date picker ({@link LynxDatePicker}),
 * a time picker ({@link LynxTimePicker}), an autocomplete
 * ({@link LynxAutocomplete}), a checkbox ({@link LynxCheckbox}), a radio group
 * ({@link LynxRadioGroup}), a toggle switch ({@link LynxToggle}), a slider
 * ({@link LynxSlider}), a stepper ({@link LynxStepper}), and a segmented
 * control ({@link LynxSegmentedControl}) — each a `ControlValueAccessor` in
 * its own right. See docs/09-forms.md.
 *
 * @packageDocumentation
 */
export { LynxValueAccessor } from './value-accessor.js';
export { LynxAutocomplete } from './autocomplete.js';
export { LynxCheckbox } from './checkbox.js';
export { LynxDatePicker } from './date-picker.js';
export { LynxRadioGroup } from './radio-group.js';
export { LynxSegmentedControl } from './segmented-control.js';
export { LynxSelect, type LynxSelectOption } from './select.js';
export { LynxSlider } from './slider.js';
export { LynxStepper } from './stepper.js';
export { LynxTimePicker } from './time-picker.js';
export { LynxToggle } from './toggle.js';
