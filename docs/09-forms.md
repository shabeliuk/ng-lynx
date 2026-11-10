# Forms & input

Lynx delivers text-input changes differently from the DOM: the new value arrives
as `event.detail.value` (not `event.target.value`). Angular's `@angular/forms`
`DefaultValueAccessor` is built around the DOM assumptions, so it doesn't fit.
angular-lynx gives you two options:

- **`[(lynxModel)]`** — a tiny, dependency-free directive for simple two-way
  binding (no `@angular/forms`). Covered first below.
- **`LynxValueAccessor`** (`angular-lynx/forms`) — a real `ControlValueAccessor`
  so `[(ngModel)]`, reactive forms, and validators work. See
  [`@angular/forms`](#angularforms--ngmodel--reactive-forms) below.

- **Richer controls** — `LynxSelect`, `LynxDatePicker`, `LynxTimePicker`,
  `LynxAutocomplete` (also `angular-lynx/forms`) — `ControlValueAccessor`s for
  the field types Lynx has no native element for. See
  [Richer controls](#richer-controls)
  below.

See the runnable [`examples/lynx-forms`](../examples/lynx-forms) (`lynxModel`) and
[`examples/ng-forms`](../examples/ng-forms) (`@angular/forms` + the richer
controls), verified by `npm run verify:form`, `npm run verify:ngforms`, and
`npm run verify:controls`.

## `[(lynxModel)]`

Import `LynxModel` into your component and bind it on `<input>` / `<textarea>`:

```ts
import { Component, signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { LynxModel } from 'angular-lynx';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [LynxModel],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <input
      placeholder="Your name"
      [lynxModel]="name()"
      (lynxModelChange)="name.set($event)" />
    <text>Hi, {{ name() }}</text>
  `,
})
export class AppComponent {
  name = signal('');
}
```

With **signals** use the split form `[lynxModel]="name()"` +
`(lynxModelChange)="name.set($event)"` (above). With a plain class field you can
use the classic banana-in-a-box:

```html
<input [(lynxModel)]="name" />
```

## How it works

`LynxModel` ([forms.ts](../packages/angular-lynx/runtime/src/forms.ts)) is a
standalone directive with:

- `@Input('lynxModel')` — written back to the element via a
  `@HostBinding('attr.value')`, i.e. `setAttribute(el, 'value', …)`, **and**
  through the element's `setValue` UI method. The native `<input>` /
  `<textarea>` (XElement, iOS and Android) have no `value` attribute at all:
  with the attribute alone a pre-filled field showed empty on device, and a
  field cleared from code kept its text. The web preview honours both. The
  echo of the user's own typing is not written back, since that would move the
  cursor. Found running examples/genui as a native iOS app;
  see [input-value.ts](../packages/angular-lynx/runtime/src/input-value.ts).
- `@Output('lynxModelChange')` — emitted from a `@HostListener('input', …)`
  that reads `event.detail.value`.

Because it uses a single host `input` listener and the Lynx event shape, it
sidesteps the DOM accessor's listener conflict and `target.value` assumption.
The `[lynxModel]` / `[lynxModelChange]` pair is what makes `[(lynxModel)]` work.

In zoneless mode the `(input)` event runs through Angular's listener wrapper, so
emitting `lynxModelChange` schedules change detection automatically — the
computed greeting in the example updates with no extra wiring.

## `@angular/forms` — `ngModel` & reactive forms

For full `@angular/forms` support — `[(ngModel)]`, `[formControl]`,
`formControlName`, validators, `<form>` groups — import **`LynxValueAccessor`**
from the `angular-lynx/forms` entry (it pulls in `@angular/forms`, so it lives in
its own entry point). See the runnable [`examples/ng-forms`](../examples/ng-forms)
and `verify/harness-ngforms.ts` (`npm run verify:ngforms`).

```ts
import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { LynxValueAccessor } from 'angular-lynx/forms';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ReactiveFormsModule, LynxValueAccessor],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <input placeholder="Email" [formControl]="email" />
    @if (email.invalid && email.touched) {
      <text>Enter a valid email</text>
    }
  `,
})
export class AppComponent {
  email = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] });
}
```

`[(ngModel)]` works the same way — just import `FormsModule` + `LynxValueAccessor`.

### How it coexists with the DOM accessor

`@angular/forms` always instantiates its built-in `DefaultValueAccessor` on any
`input[ngModel]` / `input[formControl]` (its selector matches). On Lynx that
accessor is wrong — it reads `event.target.value` and would crash. Two pieces
make `LynxValueAccessor` win cleanly:

- **Custom accessor priority.** Angular selects a *custom* `NG_VALUE_ACCESSOR`
  over the built-in default, so `LynxValueAccessor` (not `DefaultValueAccessor`)
  is wired to the control. It reads the text from `event.detail.value` and
  reflects the model back through the `setValue` UI method, so a pre-filled,
  patched or reset control shows on a device (see [How it works](#how-it-works)).
- **Multiplexed listeners + `event.target`.** The renderer now supports multiple
  listeners per `(element, event)`, and dispatched events carry a `target` (the
  element). So the still-instantiated `DefaultValueAccessor` reads a harmless
  `undefined` (a `ShadowElement` has no `.value`) instead of throwing, and both
  listeners coexist on the one native `input` binding.

When to use which: reach for **`[(lynxModel)]`** (main entry, no `@angular/forms`)
for simple two-way binding; reach for **`LynxValueAccessor`** (`angular-lynx/forms`)
when you want validators, reactive forms, or `<form>` groups.

## Richer controls

Lynx has no native `<select>`, `<picker>`, checkbox, radio, or switch element
in its [built-in elements
reference](https://lynxjs.org/api/elements/built-in/view). Even `lynx-ui` (the official
component library) builds its pickers the same way angular-lynx does here —
composed from those primitives, not a native control.

`angular-lynx/forms` ships ten such controls, each a `ControlValueAccessor`
so they drop into `[(ngModel)]` / `[formControl]` exactly like `LynxValueAccessor`.
Four open a **modal dialog** (covered first, below); six are **inline** —
no trigger, no dialog, always fully visible, the conventional UX for a
checkbox/radio/switch/slider/stepper/segmented row:

| Component | Value | UI | Composition |
| --- | --- | --- | --- |
| `LynxSelect` | `string` (single) or `string[]` (`[multiple]="true"`) | modal dialog | leaf control |
| `LynxDatePicker` | ISO date `'YYYY-MM-DD'` \| `null` | one modal dialog, 3 columns | day/month/year `LynxSelectColumn`s |
| `LynxTimePicker` | 24h `'HH:mm'` \| `null` | one modal dialog, 2 columns | hour/minute `LynxSelectColumn`s |
| `LynxAutocomplete` | `string` \| `null`, always one of `options` | modal dialog + search `<input>` | a `LynxSelectColumn` filtered by a `LynxModel`-bound search field |
| `LynxCheckbox` | `boolean` | inline, no dialog | leaf control, projected label |
| `LynxRadioGroup` | `string` | inline, no dialog | leaf control |
| `LynxToggle` | `boolean` | inline, no dialog | leaf control, projected label |
| `LynxSlider` | `number` | inline, no dialog | track measured via `invoke('boundingClientRect')` + `(touchstart)`/`(touchmove)` |
| `LynxStepper` | `number` | inline, no dialog | `−`/`+` tap buttons |
| `LynxSegmentedControl` | `string` | inline, no dialog | leaf control |

```ts
import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
} from 'angular-lynx/forms';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    FormsModule, LynxSelect, LynxDatePicker, LynxTimePicker,
    LynxAutocomplete, LynxCheckbox, LynxRadioGroup, LynxToggle,
    LynxSlider, LynxStepper, LynxSegmentedControl,
  ],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <lynx-select [options]="countries" [(ngModel)]="country" />
    <lynx-select [multiple]="true" [options]="interests" [(ngModel)]="picked" />
    <lynx-date-picker [yearRange]="[1970, 2015]" [(ngModel)]="birthDate" />
    <lynx-time-picker [(ngModel)]="alarm" />
    <lynx-autocomplete [options]="cities" [(ngModel)]="city" />
    <lynx-radio-group [options]="contactMethods" [(ngModel)]="contactMethod" />
    <lynx-toggle [(ngModel)]="subscribed">
      <text>Subscribe to the newsletter</text>
    </lynx-toggle>
    <lynx-checkbox [(ngModel)]="agreed">
      <text>I agree to the terms</text>
    </lynx-checkbox>
    <lynx-segmented-control [options]="units" [(ngModel)]="unit" />
    <lynx-slider [min]="0" [max]="100" [step]="5" [(ngModel)]="volume" />
    <lynx-stepper [min]="1" [max]="8" [(ngModel)]="guests" />
  `,
})
export class AppComponent {
  countries: LynxSelectOption[] = [{ label: 'Ukraine', value: 'ua' }, /* … */];
  interests: LynxSelectOption[] = [{ label: 'Music', value: 'music' }, /* … */];
  contactMethods: LynxSelectOption[] = [{ label: 'Email', value: 'email' }, /* … */];
  units: LynxSelectOption[] = [{ label: 'km', value: 'km' }, { label: 'mi', value: 'mi' }];
  cities = ['Kyiv', 'Kyoto', 'Krakow'];
  country = '';
  picked: string[] = [];
  birthDate: string | null = null;
  alarm: string | null = null;
  city = '';
  contactMethod = '';
  subscribed = false;
  agreed = false;
  unit = 'km';
  volume = 50;
  guests = 2;
}
```

See the full working version in
[`examples/ng-forms/src/app.component.ts`](../examples/ng-forms/src/app.component.ts),
exercised headlessly by
[`verify/harness-controls.ts`](../packages/angular-lynx/verify/harness-controls.ts)
(`npm run verify:controls`).

### Why the dialog is a plain `position: fixed` view, not `<overlay>`

All four controls open a **modal dialog** — a full-screen backdrop behind a
centered box — built from a plain `<view>` styled `position: fixed`, mounted
and unmounted via `@if` rather than a persistently-toggled `visible`
attribute. That's deliberately **not** Lynx's `<overlay>` element: its
`level` attribute can't be changed while displayed, and its own docs
recommend `position: fixed` anyway for content (like this) that lives
entirely inside the Lynx tree rather than embedding a Lynx view into a native
host page. Mounting fresh via `@if` each open sidesteps any attribute-toggle
question entirely — nothing persists across opens to toggle.

Tapping the backdrop closes the dialog, via Angular's `(tap.self)` modifier
(fires only when the tap originated on the backdrop itself, not a bubbled tap
from the dialog box — see [12 — Events](12-events.md)) — free in addition to
the explicit **Done** row (`LynxSelect` multi-select, `LynxDatePicker`,
`LynxTimePicker`) or an option pick (`LynxSelect` single-select,
`LynxAutocomplete`).

> **CSS gotcha if you build something similar:** size the backdrop with
> `top: 0; left: 0; width: 100%; height: 100%;`, **not**
> `top: 0; right: 0; bottom: 0; left: 0;` — the latter gets collapsed by the
> build's CSS minifier into the `inset` shorthand, which Lynx's CSS encoder
> doesn't support and silently drops, losing the positioning entirely with
> only a build-time warning to notice it by. See
> [13 — Styling](13-styling.md#what-the-lynx-css-engine-supports).

> **Dead end, documented deliberately:** option rows briefly also bound
> `(touchstart)`, theorizing that a row next to `LynxAutocomplete`'s focused
> search `<input>` could blur it, dismiss the keyboard, and have the
> resulting layout shift drop or mis-land the tap — `(touchstart)` would
> commit ahead of that. It was never actually confirmed (every device test of
> it happened to also be hitting the unrelated `Object.hasOwn` PrimJS crash —
> see [05 — Build integration](05-build-integration.md) — which made the app
> fail to load at all). What it *did* cause, confirmed on device: closing a
> dialog (the normal result of a single-select pick) removes the backdrop
> mid-gesture, while the same physical touch is still completing — the
> finger-lift's tap then lands on whatever is newly exposed underneath, e.g.
> **another field's trigger, opening that field's dialog**. For multi-select,
> which doesn't close on pick, the row stayed put instead, so both
> `(touchstart)` and `(tap)` fired for one tap — toggling a value on and
> immediately back off. Reverted; `LynxSelectColumn` binds plain `(tap)` only
> now. If the original keyboard-dismiss concern turns out to still be real on
> a clean build, it needs a fix that doesn't remove the tapped element
> mid-gesture (e.g. preventing the blur itself, not racing it).

### `LynxSelect`

```html
<lynx-select [options]="countries" [(ngModel)]="country" />
<lynx-select [multiple]="true" [options]="interests" [(ngModel)]="picked" />
```

`options: LynxSelectOption[]` is `{ label: string; value: string }[]`. Tapping
the trigger opens the dialog; tapping an option picks it. In single-select
mode, picking closes the dialog. In multi-select mode the dialog stays open
across picks (so you can pick several) and shows a **Done** row (and accepts
a tap on the backdrop) to close it explicitly.

> **Gotcha:** bind multi-select as **`[multiple]="true"`**, not a bare
> `multiple` attribute. A bare attribute (no brackets) passes the Angular
> input the *string* `''`, which is falsy — `LynxSelect` would silently run in
> single-select mode. This is a general Angular behavior (the same thing
> happens with `<input disabled>` vs `[disabled]="true"`), not specific to
> this component, but it's an easy one to trip on here since native HTML's
> `<select multiple>` *does* accept the bare form.

Besides the CVA (`[(ngModel)]` / `[formControl]`), `LynxSelect` also exposes a
plain `[value]` / `(valueChange)` pair, available if you want a select outside
`@angular/forms` entirely.

Ships **unstyled** — the same headless model `lynx-ui` uses. Style these
classes in your own CSS (see `examples/ng-forms/src/app.css` for a full
worked stylesheet):

| Class | What it is |
| --- | --- |
| `.lynx-select` | root; gets `.lynx-select-open` while the dialog is open, `.lynx-select-disabled` when disabled |
| `.lynx-select-trigger` | the tappable row showing the current value |
| `.lynx-select-value` | the label text inside the trigger |
| `.lynx-select-backdrop` | the full-screen `position: fixed` dimmer; closes on tap (`(tap.self)`) |
| `.lynx-select-dialog` | the centered box |
| `.lynx-select-list` | the `<scroll-view>` wrapping the options — give it a fixed `height` (a `<scroll-view>` needs a definite height to scroll; see [08 — Lists](08-lists.md)) |
| `.lynx-select-option` | one option row; gets `.lynx-select-option-selected` when picked |
| `.lynx-select-done` | the "Done" row (multi-select; also shared by the date/time picker dialogs below) |

### `LynxDatePicker` / `LynxTimePicker`

```html
<lynx-date-picker [yearRange]="[1970, 2015]" [(ngModel)]="birthDate" />
<lynx-time-picker [minuteStep]="1" [(ngModel)]="alarm" />
```

One trigger, **one combined dialog** — day/month/year (or hour/minute) side by
side in the same dialog, the way a native date dialog presents them together,
rather than each field popping its own separate dialog. Internally each
column is a `LynxSelectColumn` (an internal, non-CVA presentational piece
shared with `LynxSelect`'s own dialog content — not a full nested
`LynxSelect`, since a column here doesn't need its own trigger or dialog).
There's no scroll-snap primitive documented on `<scroll-view>` to build an
iOS-style wheel picker against, so several option columns is the fallback,
the same way it is in many web date pickers.

`LynxDatePicker`'s day column is leap-year-correct and follows the selected
month/year (`new Date(year, month, 0).getDate()`), live — switching month
while the dialog is still open re-renders the day column immediately.
Switching to a shorter month clamps an out-of-range day down (Jan 31st →
February becomes Feb 28th/29th). `yearRange: [number, number]` defaults to
the last 100 years up to this year. `LynxTimePicker`'s minutes step by
`minuteStep` (default 5, giving 12 options) rather than listing all 60 — pass
`[minuteStep]="1"` for every minute. Picking a field does **not** close the
dialog by itself — only **Done** or tapping the backdrop does, since you
typically want to set more than one field per visit.

Style `.lynx-date-picker-trigger` / `-value` / `-backdrop` / `-dialog` /
`-columns` / `-day` / `-month` / `-year` (and the `-open` / `-disabled` root
modifiers), and the equivalent `.lynx-time-picker-*` / `-hour` / `-minute`
classes. The columns themselves are `.lynx-select-list` / `.lynx-select-option`
— the same classes `LynxSelect` uses — and the Done row is the shared
`.lynx-select-done`.

### `LynxAutocomplete`

```html
<lynx-autocomplete placeholder="Search…" [options]="cities" [(ngModel)]="city" />
```

A **searchable select**: tapping the trigger opens a dialog with a search
`<input>` (reuses `LynxModel` for its binding) above a `LynxSelectColumn`
filtered by case-insensitive substring match. The list is browseable (shows
everything) before you type anything, narrows as you type, and picking a row
sets the value and closes the dialog — same as a single-select `LynxSelect`.
Reopening resets the search to empty and highlights the current value if it's
still in `options`.

Unlike the original in-flow design this replaced, **the value is always one
of `options`, never free text** — typing alone doesn't set anything, only
picking does. (An earlier revision kept the field inline with suggestions
appearing below it as you typed, allowing arbitrary text; picks weren't
registering reliably on a real device. The exact cause was never pinned down
— every test of it was confounded by the unrelated `Object.hasOwn` crash — but
rather than keep patching an unconfirmed theory, it was rebuilt on the same
dialog mechanics already proven to work for `LynxSelect`. See the dead-end
callout above for the full account, including a regression that approach
caused.)

Style `.lynx-autocomplete-trigger` / `-value` / `-backdrop` / `-dialog` /
`-search` (and the `-open` / `-disabled` root modifiers) — the option list
itself is a `LynxSelectColumn`, so `.lynx-select-list` / `.lynx-select-option`
apply inside it too.

### `LynxCheckbox` / `LynxToggle`

```html
<lynx-checkbox [(ngModel)]="agreed">
  <text>I agree to the terms</text>
</lynx-checkbox>
<lynx-toggle [(ngModel)]="subscribed">
  <text>Subscribe to the newsletter</text>
</lynx-toggle>
```

Both are `boolean` `ControlValueAccessor`s that flip on tap — same semantics,
different look (a box with a checkmark vs. a sliding switch), kept as two
components rather than one with an `appearance` flag, matching how the other
controls in this set stay single-purpose. Neither opens a dialog.

The label is **projected content** (`<ng-content>`), not a plain-string
`@Input()` — so it can be any markup, and tapping anywhere in the row (box/
switch or label) toggles it, the same way a native
`<label><input type="checkbox">…</label>` does.

> **⚠️ Wrap the label in `<text>`.** Lynx renders text only inside a `<text>`
> element — a bare text node projected straight into the control renders
> **nothing at all** on-device (it looks fine in the web preview, which is how
> it went unnoticed in `examples/control-theme` until a device run showed both
> its labels missing). Write
> `<lynx-toggle …><text>Notifications</text></lynx-toggle>`, never
> `<lynx-toggle …>Notifications</lynx-toggle>`.

> **If you build something similar:** the toggle's thumb slides via the
> track's `justify-content` (`flex-start` ↔ `flex-end`), not
> `transform`/`left`/`right`. This session hit two CSS gotchas where a
> seemingly-ordinary property silently failed on Lynx's CSS engine — the
> `inset` shorthand (above) and relying on an assumed default `flex-direction`
> (see [13 — Styling](13-styling.md)) — so the thumb uses the one positioning
> mechanism verified repeatedly throughout this package instead of a new,
> unverified property. There's no slide *animation* for the same reason —
> `transition` hasn't been verified here either.

Style `.lynx-checkbox` (`-box`, `-mark`, `-label`, plus `-checked` /
`-disabled` root modifiers) and `.lynx-toggle` (`-track`, `-thumb`, `-label`,
plus `-on` / `-disabled` root modifiers).

> **⚠️ Style the state from the element's own class, not the root modifier.**
> The checked/on state is *also* published directly on the element it affects —
> `.lynx-checkbox-box-checked` on the box, `.lynx-toggle-track-on` on the
> track, `.lynx-radio-dot-outer-selected`, `.lynx-segment-label-selected`, and
> `.lynx-<control>-trigger-open` on the pickers' triggers. **Use those.** The
> root modifiers (`.lynx-toggle-on`, …) are still applied and are fine for
> styling the root itself. A descendant rule keyed on one
> (`.lynx-toggle-on .lynx-toggle-track`) follows the state on a device only
> with `enableCSSInvalidation`, which `pluginAngularLynx` turns on and an app
> can turn off; without it, Lynx matches such a rule only against the classes
> present when the element was created. That left `LynxToggle` with no visible
> on-state at all on a device before the flag was on. The element's own class
> works either way. See
> [13 — Styling](13-styling.md#what-the-lynx-css-engine-supports).

### `LynxRadioGroup`

```html
<lynx-radio-group [options]="contactMethods" [(ngModel)]="contactMethod" />
```

`options: LynxSelectOption[]` (the same `{ label, value }` shape `LynxSelect`
uses — no separate type). Unlike `LynxSelect`, **all options render inline,
always** — the conventional radio UX, since a handful of options are normally
shown at once rather than hidden behind a trigger. Tapping a row sets the
value; only one option is ever selected.

Style `.lynx-radio-group` (`-disabled` modifier), `.lynx-radio-option`
(`-selected` modifier), `.lynx-radio-dot-outer`, `.lynx-radio-dot-inner`, and
`.lynx-radio-label`.

### `LynxSegmentedControl`

```html
<lynx-segmented-control [options]="units" [(ngModel)]="unit" />
```

Value semantics are **identical to `LynxRadioGroup`** (a `string`, one of
`options`, all rendered inline) — it's a separate component only because a
joined "pill" button row (the iOS `UISegmentedControl` look) reads differently
from a vertical list of radio rows. Reuses the same `LynxSelectOption`
(`{ label, value }`) shape. Style `.lynx-segmented-control` (`-disabled`
modifier), `.lynx-segment` (`-selected` modifier), and `.lynx-segment-label`.

### `LynxStepper`

```html
<lynx-stepper [min]="1" [max]="8" [step]="1" [(ngModel)]="guests" />
```

A `number` incremented/decremented by tapping `−`/`+` — sidesteps native
number-text input entirely (Lynx has none), the same way `LynxCheckbox`/
`LynxToggle` sidestep native checkbox/switch. `min`/`max` clamp; `step`
(default `1`) is the increment. Style `.lynx-stepper` (`-disabled` modifier),
`.lynx-stepper-btn` (+ `.lynx-stepper-decrement`/`.lynx-stepper-increment`),
`.lynx-stepper-btn-label`, and `.lynx-stepper-value`.

### `LynxSlider`

```html
<lynx-slider [min]="0" [max]="100" [step]="5" [(ngModel)]="volume" />
```

A `number` you drag or tap along a track. Because Lynx has no native
`<input type="range">`, this measures its own track (via
`invoke({ method: 'boundingClientRect' })` — the selector-query path from
[10 — Element queries](10-element-queries.md), refreshed at the start of each
gesture) and drives the value from plain `(touchstart)`/`(touchmove)` events —
Lynx's own touch-event catalog, **not** the newer gesture-detector system
([32 — Gestures](32-gestures.md)). `step` snaps (`0` disables snapping). Style
`.lynx-slider` (`-disabled` modifier), `.lynx-slider-track`,
`.lynx-slider-fill` (bind its `width`), and `.lynx-slider-thumb` (position it
with `left: N%` + a negative `margin-left` of half its width, over a
`position: relative` track — see `examples/ng-forms/src/app.css`).

#### Measuring the track — why `fields()` isn't used

This is the one control in the kit that genuinely needs a measured size, and
an earlier version used `fields({ size: true })` for it. **That made the
slider silently inert on every target available here** — dragging did nothing
at all, with no error. Fixed; the history is worth keeping because the failure
mode is a trap for any size-dependent component.

What was measured directly, by probing a live component on both targets:

| | `fields({size:true})` | `invoke('boundingClientRect')` |
| --- | --- | --- |
| Web preview (web-core 0.26) | **throws** `nativeApp.getFields is not a function` | returns a rect, but a *style-derived* one |
| iOS (Explorer on engine 3.7) | resolves the selector, then calls back **empty** | returns a **true layout rect** ✅ |

On iOS the query pipeline itself is fine — asking for
`{ rect, size, id, dataset }` returns `{ id, dataset }`, so `size`/`rect` are
simply dropped while the rest comes back. That's what made this so quiet: no
exception, no null, just a missing field, and a `trackWidth <= 0` guard that
never opened.

Two coordinate details also matter, and both contradict what the old code
assumed:

- **`detail.x` is *not* element-relative.** On both targets it comes back equal
  to the touch's `clientX` — page-absolute. Using it directly offsets every
  value by the track's own left inset.
- **`touches[0].x` *is* element-relative, but only on the native engine**; on
  the web preview it too is just `clientX`. The component tells them apart by
  comparing the two, so it never mixes coordinate spaces.

Verified on device: with the track at `left: 24, width: 345`, a tap at
`x = 340` yields `90` and a tap at `x = 113` yields `25` — both matching
`round(((x − left) / width) × 100 / step) × step` exactly.

**A touch that arrives before any measurement is held, not dropped.** The
measurement is a Background→Main Thread round-trip, so on a freshly-mounted
slider the very first touch can land before any geometry exists. It's
remembered and applied the instant the measurement returns (age-bounded, so a
long-delayed query can't move the thumb much later). Without that, the first
*tap* on a fresh slider silently did nothing — a drag survived only because it
delivers many more move events. Found on-device in
`examples/accessibility`: tap once, nothing; tap again, it works.

#### ⚠️ Still inert in the web preview

The native engine reports a real layout rect, so the slider works there. The
**web preview does not**: `web-core`'s `boundingClientRect` is style-derived,
so a track sized by layout (`flex: 1` — the natural way to style one) measures
as `width: 0`, and the control stays inert rather than jumping to a wrong
value. Give the track an explicit CSS `width` if you need it to drag in the
web preview.

> **Live-verification caveat:** the value logic (fraction → stepped → clamped)
> is covered headlessly by `npm run verify:controls`, which drives
> `(touchstart)`/`(touchmove)` against a mock that returns a rect from
> `invoke('boundingClientRect')` — and asserts *both* coordinate shapes above,
> so the element-relative path can't silently regress. The mock previously
> answered `{ok:true}` to every `invoke` and implemented `fields` as a working
> measurement, which is exactly why this bug passed verification while being
> broken everywhere real. The continuous-drag *interaction* is verified
> headlessly and on-device; a synthetic drag in a headless browser doesn't
> reach Lynx's native touch pipeline (the same limitation
> [30 — Virtual lists](30-virtual-list.md) documents for synthetic scroll).

## Theming

The kit ships **headless** — every control emits stable class names and you
bring the CSS (the tables above are the contract). For a batteries-included
start there's also an **optional default theme**,
`angular-lynx/forms/theme.css`, that styles all ten controls **entirely from
CSS custom properties**. Import it, then re-theme the whole kit by overriding a
few tokens — no per-control CSS:

```ts
// index.ts — import the theme first
import 'angular-lynx/forms/theme.css';
import './app.css';
```

```css
/* app.css — one override re-themes every control */
:root {
  --primary: #e5484d;   /* checked box, toggle, radio dot, slider fill, … */
  --lynx-radius: 14px;
}
```

Tokens split into two groups: the **palette** (`--primary`, `--primary-content`,
`--paper`, `--paper-clear`, `--line`, `--content`, `--content-muted`) uses
`@lynx-js/lynx-ui`'s own [LUNA design-token names](https://lynxjs.org/next/ui/luna-themes-tokens.html)
verbatim, not a `--lynx-*` lookalike — a real drop-in skin for an app that
already speaks LUNA tokens elsewhere. **Shape/rhythm and per-control sizing**
(`--lynx-radius`, `--lynx-gap`, `--lynx-control-height`,
`--lynx-disabled-opacity`, `--lynx-checkbox-size`, `--lynx-toggle-w`,
`--lynx-slider-thumb`, …) stay under this package's own `--lynx-*` prefix —
LUNA is a color-only system and has no spacing/sizing tokens to match. See the
top of [`forms-theme.css`](../packages/angular-lynx/forms-theme.css) for the
full list of defaults.

**Requires `enableCSSInheritance: true`** in `pluginAngularLynx({ … })` — Lynx
only cascades CSS variables with that flag on (see
[13 — Styling](13-styling.md)). The theme is written to Lynx's CSS constraints
(explicit `display: flex` + `flex-direction`, px units, no `inset`, class
selectors only), so it works on-device and on the web preview alike.

`examples/control-theme` is a runnable showcase: all controls styled solely by
the theme, with a single `--primary`/`--lynx-radius` override — verified
live in the web preview (the primary token drives every control, confirmed down
to the computed `background-color`). Not importing the theme leaves the
controls exactly as headless as before — nothing changes for apps that style
the classes themselves (as `examples/ng-forms` does).

> Naming note: **class** names still follow this package's own
> `.lynx-<control>-…` convention (`lynx-ui`'s own components don't expose a
> stable class-name contract to match against) — but **palette token** names
> now do mirror `lynx-ui` exactly, LUNA name for LUNA name (see above); only
> the shape/sizing tokens, which LUNA has no equivalent for, stay under
> `--lynx-*`.

## Notes & limitations

- **Controlled value.** `[(lynxModel)]` reflects the model back via `value`. If
  you need uncontrolled behavior, bind only `(lynxModelChange)` and skip
  `[lynxModel]`.
- **Enter / submit.** Bind Lynx's `(confirm)` event for "submit on enter":
  `<input [(lynxModel)]="email" confirm-type="done" (confirm)="submit()" />` (the
  final text is in `$event.detail.value`). Without `confirm-type`, Return on Android
  does nothing. `LynxModel` itself only tracks `input`. Demoed in `examples/lynx-forms`;
  see [12 — Events](12-events.md).
