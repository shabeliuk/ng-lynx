import {
  ChangeDetectionStrategy,
  Component,
  NO_ERRORS_SCHEMA,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  LynxAutocomplete,
  LynxCheckbox,
  LynxDatePicker,
  LynxRadioGroup,
  LynxSegmentedControl,
  LynxSelect,
  type LynxSelectOption,
  LynxSlider,
  LynxStepper,
  LynxTimePicker,
  LynxToggle,
  LynxValueAccessor,
} from 'ng-lynx/forms';

/**
 * `@angular/forms` on Lynx via `LynxValueAccessor`.
 *
 * Demonstrates **reactive forms** (a `FormGroup` with validators + live error
 * messages) and a **template-driven** `[(ngModel)]` field — both bound to Lynx
 * `<input>`. Compare with `examples/lynx-forms`, which uses the dependency-free
 * `[(lynxModel)]` instead.
 *
 * Also demonstrates the richer controls from `ng-lynx/forms` — `LynxSelect`
 * (single + multi), `LynxDatePicker`, `LynxTimePicker`, `LynxAutocomplete`,
 * `LynxRadioGroup`, `LynxToggle`, `LynxCheckbox`, `LynxSegmentedControl`,
 * `LynxSlider`, and `LynxStepper` — each a `ControlValueAccessor` Lynx has no
 * native element for. See docs/09-forms.md.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    LynxValueAccessor,
    LynxSelect,
    LynxDatePicker,
    LynxTimePicker,
    LynxAutocomplete,
    LynxCheckbox,
    LynxRadioGroup,
    LynxToggle,
    LynxSlider,
    LynxStepper,
    LynxSegmentedControl,
  ],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <scroll-view class="app" scroll-orientation="vertical">
      <text class="title">Sign up</text>

      <!-- Reactive forms -->
      <input
        class="field"
        [class.field-focused]="focusedField() === 'name'"
        placeholder="Name"
        [formControl]="name"
        (focus)="focusedField.set('name')"
        (blur)="focusedField.set(null)"
      />
      @if (showError(name)) {
        <text class="hint error">Name is required</text>
      }

      <input
        class="field"
        [class.field-focused]="focusedField() === 'email'"
        placeholder="Email"
        [formControl]="email"
        (focus)="focusedField.set('email')"
        (blur)="focusedField.set(null)"
      />
      @if (showError(email)) {
        <text class="hint error">Enter a valid email</text>
      }

      <!-- Template-driven [(ngModel)] -->
      <input
        class="field"
        [class.field-focused]="focusedField() === 'nickname'"
        placeholder="Nickname (optional)"
        [(ngModel)]="nickname"
        (focus)="focusedField.set('nickname')"
        (blur)="focusedField.set(null)"
      />
      <text class="greeting">{{ nickname() ? 'Hey ' + nickname() + '!' : '' }}</text>

      <!-- LynxSelect: single -->
      <text class="label">Country</text>
      <lynx-select class="control" [options]="countryOptions" [(ngModel)]="country" />

      <!-- LynxSelect: multiple. Note the [multiple]="true" binding — a bare
           "multiple" attribute (no brackets) passes the *string* '' to the
           @Input, which is falsy and silently selects single-select mode. -->
      <text class="label">Interests</text>
      <lynx-select
        class="control"
        [multiple]="true"
        [options]="interestOptions"
        [(ngModel)]="interests"
      />

      <!-- LynxDatePicker: composite of 3 LynxSelects (day/month/year) -->
      <text class="label">Birth date</text>
      <lynx-date-picker class="control" [yearRange]="[1970, 2015]" [(ngModel)]="birthDate" />

      <!-- LynxTimePicker: composite of 2 LynxSelects (hour/minute) -->
      <text class="label">Preferred contact time</text>
      <lynx-time-picker class="control" [(ngModel)]="contactTime" />

      <!-- LynxAutocomplete: search dialog (tap to open, then filter + pick) -->
      <text class="label">City</text>
      <lynx-autocomplete
        class="control"
        placeholder="Search city…"
        [options]="cityOptions"
        [(ngModel)]="city"
      />

      <!-- LynxRadioGroup: inline, mutually exclusive (not a dialog) -->
      <text class="label">Preferred contact method</text>
      <lynx-radio-group class="control" [options]="contactOptions" [(ngModel)]="contactMethod" />

      <!-- LynxSegmentedControl: same value semantics as radio, joined pill row -->
      <text class="label">Distance unit</text>
      <lynx-segmented-control class="control" [options]="unitOptions" [(ngModel)]="unit" />

      <!-- LynxSlider: drag/tap along a measured track -->
      <text class="label">Volume: {{ volume }}</text>
      <lynx-slider class="control" [min]="0" [max]="100" [step]="5" [(ngModel)]="volume" />

      <!-- LynxStepper: increment/decrement a number, no text input -->
      <text class="label">Guests</text>
      <lynx-stepper class="control" [min]="1" [max]="8" [(ngModel)]="guests" />

      <!-- LynxToggle: same boolean semantics as LynxCheckbox, switch styling -->
      <lynx-toggle class="control" [(ngModel)]="subscribed">
        <text class="toggle-label">Subscribe to the newsletter</text>
      </lynx-toggle>

      <!-- LynxCheckbox: content-projected label, tap anywhere in the row -->
      <lynx-checkbox class="control" [(ngModel)]="agreed">
        <text class="checkbox-label">I agree to the terms</text>
      </lynx-checkbox>

      <view class="submit" [class.disabled]="form.invalid" (tap)="submit()">
        <text class="submit-label">Submit</text>
      </view>

      <text class="status">{{ status() }}</text>

      <!-- Writing to the form from code. "Fill example" calls setValue() and
           sets every other field; "Reset" calls form.reset() and puts every
           other field back to its default. Each one has to reach the native
           <input> (writeValue), and reset() also has to clear dirty/touched,
           which hides the error messages again. -->
      <view class="form-actions">
        <view class="action" (tap)="fillExample()">
          <text class="submit-label">Fill example</text>
        </view>
        <view class="action" (tap)="resetForm()">
          <text class="submit-label">Reset</text>
        </view>
      </view>
      <text class="status">
        Name {{ stateOf(name) }} · Email {{ stateOf(email) }} · resets {{ resets() }}
      </text>
    </scroll-view>
  `,
})
export class AppComponent {
  readonly name = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  readonly email = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email],
  });
  readonly form = new FormGroup({ name: this.name, email: this.email });

  readonly nickname = signal('');
  readonly status = signal('');
  readonly resets = signal(0);

  /**
   * Which of the three plain `<input>`s currently has focus, or `null`.
   *
   * Lynx's CSS engine has no confirmed `:focus` pseudo-class support (and
   * this codebase already learned, from the toggle/checkbox/radio/etc state
   * classes, not to lean on pseudo-class-style CSS the native engine may not
   * re-evaluate). `<input>`/`<textarea>` do fire real `(focus)`/`(blur)`
   * events (`LynxTextFieldBase` in runtime/src/elements.ts), so this mirrors
   * that same event-driven state-class pattern instead.
   */
  readonly focusedField = signal<string | null>(null);

  readonly countryOptions: LynxSelectOption[] = [
    { label: 'Ukraine', value: 'ua' },
    { label: 'United States', value: 'us' },
    { label: 'Germany', value: 'de' },
    { label: 'Japan', value: 'jp' },
  ];
  country = '';

  readonly interestOptions: LynxSelectOption[] = [
    { label: 'Music', value: 'music' },
    { label: 'Sports', value: 'sports' },
    { label: 'Reading', value: 'reading' },
    { label: 'Travel', value: 'travel' },
  ];
  interests: string[] = [];

  birthDate: string | null = null;
  contactTime: string | null = null;

  readonly cityOptions = ['Kyiv', 'Kyoto', 'Krakow', 'Berlin', 'Boston', 'Bordeaux'];
  city = '';

  readonly contactOptions: LynxSelectOption[] = [
    { label: 'Email', value: 'email' },
    { label: 'Phone', value: 'phone' },
    { label: 'SMS', value: 'sms' },
  ];
  contactMethod = '';

  readonly unitOptions: LynxSelectOption[] = [
    { label: 'Kilometers', value: 'km' },
    { label: 'Miles', value: 'mi' },
  ];
  unit = 'km';

  volume = 50;
  guests = 2;

  subscribed = false;
  agreed = false;

  /** Show a field's error only once the user has interacted with it. */
  showError(control: FormControl): boolean {
    return control.invalid && (control.dirty || control.touched);
  }

  /** "dirty, touched" or "pristine, untouched", for the line under the buttons. */
  stateOf(control: FormControl): string {
    return `${control.dirty ? 'dirty' : 'pristine'}, ${control.touched ? 'touched' : 'untouched'}`;
  }

  /** Every field gets a value from code, not from typing. */
  fillExample(): void {
    this.form.setValue({ name: 'Ada Lovelace', email: 'ada@example.com' });
    this.nickname.set('Ada');
    this.country = 'ua';
    this.interests = ['music', 'travel'];
    this.birthDate = '1990-12-10';
    this.contactTime = '09:30';
    this.city = 'Kyiv';
    this.contactMethod = 'email';
    this.unit = 'mi';
    this.volume = 80;
    this.guests = 4;
    this.subscribed = true;
    this.agreed = true;
    this.status.set('Filled from code');
  }

  /** form.reset() for the reactive fields, and the defaults for the rest. */
  resetForm(): void {
    this.form.reset();
    this.nickname.set('');
    this.country = '';
    this.interests = [];
    this.birthDate = null;
    this.contactTime = null;
    this.city = '';
    this.contactMethod = '';
    this.unit = 'km';
    this.volume = 50;
    this.guests = 2;
    this.subscribed = false;
    this.agreed = false;
    this.resets.update((n) => n + 1);
    this.status.set('');
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.status.set('Please fix the errors above');
      return;
    }
    this.status.set(`Welcome, ${this.name.value} <${this.email.value}>`);
  }
}

