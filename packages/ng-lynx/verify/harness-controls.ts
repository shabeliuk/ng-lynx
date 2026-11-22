/**
 * Headless verification of the richer form controls (`ng-lynx/forms`):
 * `LynxSelect` (single + multiple), `LynxDatePicker` and `LynxTimePicker`
 * (one combined dialog per picker), `LynxAutocomplete` (a search dialog —
 * a filter `<input>` plus a filtered option list), `LynxCheckbox`,
 * `LynxRadioGroup`, and `LynxToggle`. All are `ControlValueAccessor`s,
 * exercised here via `[(ngModel)]`, simulating taps (`(tap)` → a
 * Background-thread string sign, same path as any other element) and text
 * input (Lynx's `event.detail.value` shape). `LynxSlider`'s touches go to
 * Main-Thread worklets instead, fired here with `fireWorklet`.
 *
 * Run with: `npm run verify:controls`.
 */
import '@angular/compiler';

import { ChangeDetectorRef, Component, NO_ERRORS_SCHEMA, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { bootstrapLynxApplication } from 'ng-lynx';
import 'ng-lynx/entry-background';
import { publishEvent } from 'ng-lynx/internal/runtime';
import {
  LynxAutocomplete,
  LynxCheckbox,
  LynxDatePicker,
  LynxRadioGroup,
  LynxSegmentedControl,
  LynxSelect,
  LynxSlider,
  LynxStepper,
  LynxTimePicker,
  LynxToggle,
} from 'ng-lynx/forms';
import 'ng-lynx/main-thread';

import {
  assert,
  findAllByClass,
  findByClass,
  findText,
  fireWorklet,
  getPage,
  installMockPapi,
  type MockEl,
  tick,
} from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    FormsModule,
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
    <view class="app">
      <lynx-select class="country" [options]="countryOptions" [(ngModel)]="country" />
      <lynx-select class="interests" [multiple]="true" [options]="interestOptions" [(ngModel)]="interests" />
      <lynx-date-picker class="birth" [(ngModel)]="birth" />
      <lynx-time-picker class="alarm" [(ngModel)]="alarm" />
      <lynx-autocomplete class="city" [options]="cityOptions" [(ngModel)]="city" />
      <lynx-checkbox class="agree" [(ngModel)]="agreed">I agree</lynx-checkbox>
      <lynx-radio-group class="contact" [options]="contactOptions" [(ngModel)]="contactMethod" />
      <lynx-toggle class="newsletter" [(ngModel)]="subscribed">Newsletter</lynx-toggle>
      <lynx-slider class="volume" [min]="0" [max]="100" [step]="10" [disabled]="sliderDisabled()" [(ngModel)]="volume" />
      <!-- Mounted on demand, so a slider that has never measured can be touched. -->
      @if (showLateSlider()) {
        <lynx-slider class="late" [min]="0" [max]="100" [step]="10" [(ngModel)]="lateVolume" />
      }
      <lynx-stepper class="quantity" [min]="0" [max]="5" [(ngModel)]="quantity" />
      <lynx-segmented-control class="unit" [options]="unitOptions" [(ngModel)]="unit" />
    </view>
  `,
})
export class TestComponent {
  // No `changeDetection` set, so OnPush on Angular 22 and Eager on 21: a test
  // that writes a plain field marks this view itself, which works on both.
  readonly cdr = inject(ChangeDetectorRef);
  readonly countryOptions = [
    { label: 'United States', value: 'us' },
    { label: 'Ukraine', value: 'ua' },
    { label: 'Germany', value: 'de' },
  ];
  readonly interestOptions = [
    { label: 'Music', value: 'music' },
    { label: 'Sports', value: 'sports' },
    { label: 'Reading', value: 'reading' },
  ];
  readonly cityOptions = ['Kyiv', 'Kyoto', 'Krakow', 'Berlin'];
  readonly contactOptions = [
    { label: 'Email', value: 'email' },
    { label: 'Phone', value: 'phone' },
    { label: 'SMS', value: 'sms' },
  ];
  readonly unitOptions = [
    { label: 'km', value: 'km' },
    { label: 'mi', value: 'mi' },
  ];

  country = '';
  interests: string[] = [];
  birth: string | null = null;
  alarm: string | null = null;
  city = '';
  agreed = false;
  contactMethod = '';
  subscribed = false;
  volume = 0;
  readonly sliderDisabled = signal(false);
  readonly showLateSlider = signal(false);
  lateVolume = 0;
  quantity = 0;
  unit = '';
}

function tap(el: MockEl): void {
  const sign = el.events['tap']?.sign;
  if (typeof sign !== 'string') throw new Error('element has no (tap) sign');
  publishEvent(sign, { type: 'tap' });
}

function typeInto(el: MockEl, text: string): void {
  const sign = el.events['input']?.sign;
  if (typeof sign !== 'string') throw new Error('element has no (input) sign');
  publishEvent(sign, { detail: { value: text } });
}

/**
 * Fire a touch on a slider's track that resolves to `x` **track-local** pixels.
 *
 * The slider's worklets read `detail.x`, page-absolute, and subtract the
 * track's left as measured by `invoke('boundingClientRect')` on the Main
 * Thread (the mock answers with `__QUERY_RECT_LEFT__`). An earlier version
 * also read `touches[0].x` and picked between the two per event; that was the
 * cause of a value snapping mid-drag on a real phone (slider.ts's doc).
 *
 * `trackLeft` simulates a track that isn't flush against the page origin: it
 * sets `__QUERY_RECT_LEFT__` (read by the *next* measurement, so only a
 * `touchstart` picks it up; a `touchmove` reuses that gesture's geometry) and
 * offsets `detail.x` by the same amount, so the result lands back on `x`.
 */
function touch(
  el: MockEl,
  eventName: 'touchstart' | 'touchmove' | 'touchend',
  x: number,
  trackLeft = 0,
): void {
  (globalThis as Record<string, unknown>)['__QUERY_RECT_LEFT__'] = trackLeft;
  const event = { type: eventName, detail: { x: x + trackLeft }, touches: [{ clientX: x + trackLeft }] };
  const sign = el.events[eventName]?.sign;
  if (onMainThread) {
    if (typeof sign !== 'function') throw new Error(`track has no ${eventName} worklet`);
    fireWorklet(el, eventName, event);
  } else {
    if (typeof sign !== 'string') throw new Error(`track has no (${eventName}) sign`);
    publishEvent(sign, event);
  }
}

/**
 * Whether this run is a build with the worklet runtime (the default), where
 * `<lynx-slider>` drags on the Main Thread. `verify:controls-background` runs
 * the same file without it.
 */
declare const __WORKLET_RUNTIME__: boolean;
const onMainThread = __WORKLET_RUNTIME__;

/** An inline style property the Main Thread set on a mock element. */
function styleOf(el: MockEl, name: string): string | undefined {
  if (typeof el.style !== 'string') return undefined;
  for (const declaration of el.style.split(';')) {
    const colon = declaration.indexOf(':');
    if (declaration.slice(0, colon).trim() === name) return declaration.slice(colon + 1).trim();
  }
  return undefined;
}

function need(el: MockEl | undefined, what: string): MockEl {
  if (!el) throw new Error(`not found: ${what}`);
  return el;
}

/** Text lives on a nested `#raw-text` descendant, not the `<text>` element itself. */
function subtreeHasText(el: MockEl, text: string): boolean {
  if (el.text === text) return true;
  return el.children.some((c) => subtreeHasText(c, text));
}

function findOptionByLabel(root: MockEl, optionClass: string, label: string): MockEl {
  const match = findAllByClass(root, optionClass).find((o) => subtreeHasText(o, label));
  return need(match, `${optionClass} "${label}"`);
}

function hasOptionLabel(root: MockEl, optionClass: string, label: string): boolean {
  return findAllByClass(root, optionClass).some((o) => subtreeHasText(o, label));
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent);
  await tick();
  await tick();
  const cmp = (app.components[0]?.instance ?? null) as TestComponent | null;
  const page = getPage();

  console.log('\n=== LynxSelect: single, modal dialog ===');
  const countryHost = need(findByClass(page, 'country'), '.country host');
  assert(!findByClass(countryHost, 'lynx-select-backdrop'), 'dialog closed initially');
  assert(
    findText(countryHost, 'Select…') != null,
    "a model of '' that no option has shows the placeholder, as FormControl('') starts",
  );
  tap(need(findByClass(countryHost, 'lynx-select-trigger'), 'country trigger'));
  await tick();
  await tick();
  assert(!!findByClass(countryHost, 'lynx-select-backdrop'), 'dialog opens on trigger tap');
  tap(findOptionByLabel(countryHost, 'lynx-select-option', 'Ukraine'));
  await tick();
  await tick();
  assert(cmp?.country === 'ua', `ngModel updated to the picked option value (got ${cmp?.country})`);
  assert(!findByClass(countryHost, 'lynx-select-backdrop'), 'dialog closes after picking (single-select)');

  console.log('\n=== LynxSelect: reopen after a pick — picking again still works ===');
  tap(need(findByClass(countryHost, 'lynx-select-trigger'), 'country trigger (reopen #1)'));
  await tick();
  await tick();
  assert(!!findByClass(countryHost, 'lynx-select-backdrop'), 'dialog reopens a 2nd time');
  assert(
    findOptionByLabel(countryHost, 'lynx-select-option', 'Ukraine').classes
      ?.split(/\s+/)
      .includes('lynx-select-option-selected') ?? false,
    'previous pick (Ukraine) shows selected on reopen',
  );
  tap(findOptionByLabel(countryHost, 'lynx-select-option', 'Germany'));
  await tick();
  await tick();
  assert(cmp?.country === 'de', `a 2nd pick on a reopened dialog still updates ngModel (got ${cmp?.country})`);
  assert(!findByClass(countryHost, 'lynx-select-backdrop'), 'dialog closes after the 2nd pick too');

  console.log('\n=== LynxSelect: reopen after a backdrop-cancel (no pick) — still works ===');
  tap(need(findByClass(countryHost, 'lynx-select-trigger'), 'country trigger (reopen #2)'));
  await tick();
  await tick();
  tap(need(findByClass(countryHost, 'lynx-select-backdrop'), 'country backdrop'));
  await tick();
  await tick();
  assert(!findByClass(countryHost, 'lynx-select-backdrop'), 'backdrop-cancel closes without picking');
  assert(cmp?.country === 'de', 'value unchanged after a backdrop-cancel');
  tap(need(findByClass(countryHost, 'lynx-select-trigger'), 'country trigger (reopen #3)'));
  await tick();
  await tick();
  assert(!!findByClass(countryHost, 'lynx-select-backdrop'), 'dialog reopens a 3rd time, after a cancel');
  tap(findOptionByLabel(countryHost, 'lynx-select-option', 'United States'));
  await tick();
  await tick();
  assert(cmp?.country === 'us', `pick after a cancel-then-reopen cycle still works (got ${cmp?.country})`);

  console.log('\n=== LynxSelect: multiple, Done + tap-outside both close ===');
  const interestsHost = need(findByClass(page, 'interests'), '.interests host');
  tap(need(findByClass(interestsHost, 'lynx-select-trigger'), 'interests trigger'));
  await tick();
  await tick();
  tap(findOptionByLabel(interestsHost, 'lynx-select-option', 'Music'));
  await tick();
  await tick();
  tap(findOptionByLabel(interestsHost, 'lynx-select-option', 'Reading'));
  await tick();
  await tick();
  assert(
    JSON.stringify(cmp?.interests) === JSON.stringify(['music', 'reading']),
    `multi-select accumulates picks across taps (got ${JSON.stringify(cmp?.interests)})`,
  );
  assert(!!findByClass(interestsHost, 'lynx-select-backdrop'), 'dialog stays open between picks (multi-select)');
  tap(need(findByClass(interestsHost, 'lynx-select-done'), 'interests Done row'));
  await tick();
  await tick();
  assert(!findByClass(interestsHost, 'lynx-select-backdrop'), 'Done closes the multi-select dialog');

  tap(need(findByClass(interestsHost, 'lynx-select-trigger'), 'interests trigger (reopen)'));
  await tick();
  await tick();
  tap(need(findByClass(interestsHost, 'lynx-select-backdrop'), 'interests backdrop'));
  await tick();
  await tick();
  assert(!findByClass(interestsHost, 'lynx-select-backdrop'), 'tapping the backdrop itself also closes the dialog');
  assert(
    JSON.stringify(cmp?.interests) === JSON.stringify(['music', 'reading']),
    'tapping the backdrop did not change the value (no option was picked)',
  );

  console.log('\n=== LynxDatePicker: ONE combined dialog, leap-year + clamp ===');
  const birthHost = need(findByClass(page, 'birth'), '.birth host');
  assert(!findByClass(birthHost, 'lynx-date-picker-backdrop'), 'dialog closed initially');
  tap(need(findByClass(birthHost, 'lynx-date-picker-trigger'), 'date trigger'));
  await tick();
  await tick();
  assert(!!findByClass(birthHost, 'lynx-date-picker-backdrop'), 'one dialog opens on trigger tap');
  const yearCol = need(findByClass(birthHost, 'lynx-date-picker-year'), 'year column');
  const monthCol = need(findByClass(birthHost, 'lynx-date-picker-month'), 'month column');
  const dayCol = need(findByClass(birthHost, 'lynx-date-picker-day'), 'day column');

  // All three picks happen inside the SAME open dialog — no per-field open/close.
  tap(findOptionByLabel(yearCol, 'lynx-select-option', '2000'));
  await tick();
  await tick();
  tap(findOptionByLabel(monthCol, 'lynx-select-option', 'January'));
  await tick();
  await tick();
  assert(hasOptionLabel(dayCol, 'lynx-select-option', '31'), 'January has a 31st');
  tap(findOptionByLabel(dayCol, 'lynx-select-option', '31'));
  await tick();
  await tick();
  assert(!!findByClass(birthHost, 'lynx-date-picker-backdrop'), 'dialog stays open after a field pick');
  assert(cmp?.birth === '2000-01-31', `composite ISO value assembled (got ${cmp?.birth})`);

  console.log('\n=== LynxDatePicker: switching month clamps the day + keeps leap-year correct ===');
  tap(findOptionByLabel(monthCol, 'lynx-select-option', 'February'));
  await tick();
  await tick();
  assert(
    cmp?.birth === '2000-02-29',
    `day clamped 31→29 AND Feb 2000 correctly treated as a leap year (got ${cmp?.birth})`,
  );
  assert(!hasOptionLabel(dayCol, 'lynx-select-option', '30'), 'Feb 2000 has no 30th (column re-rendered live)');
  assert(hasOptionLabel(dayCol, 'lynx-select-option', '29'), 'Feb 2000 (leap year) has a 29th');

  tap(need(findByClass(birthHost, 'lynx-select-done'), 'date Done row'));
  await tick();
  await tick();
  assert(!findByClass(birthHost, 'lynx-date-picker-backdrop'), 'Done closes the date dialog');

  console.log('\n=== LynxTimePicker: ONE combined dialog, stepped minutes ===');
  const alarmHost = need(findByClass(page, 'alarm'), '.alarm host');
  tap(need(findByClass(alarmHost, 'lynx-time-picker-trigger'), 'time trigger'));
  await tick();
  await tick();
  assert(!!findByClass(alarmHost, 'lynx-time-picker-backdrop'), 'one dialog opens on trigger tap');
  const hourCol = need(findByClass(alarmHost, 'lynx-time-picker-hour'), 'hour column');
  const minuteCol = need(findByClass(alarmHost, 'lynx-time-picker-minute'), 'minute column');
  assert(!hasOptionLabel(minuteCol, 'lynx-select-option', '02'), 'default minuteStep=5 skips :02');
  tap(findOptionByLabel(hourCol, 'lynx-select-option', '14'));
  await tick();
  await tick();
  tap(findOptionByLabel(minuteCol, 'lynx-select-option', '30'));
  await tick();
  await tick();
  assert(cmp?.alarm === '14:30', `composite HH:mm value assembled (got ${cmp?.alarm})`);
  assert(!!findByClass(alarmHost, 'lynx-time-picker-backdrop'), 'dialog stays open after both picks');
  tap(need(findByClass(alarmHost, 'lynx-select-done'), 'time Done row'));
  await tick();
  await tick();
  assert(!findByClass(alarmHost, 'lynx-time-picker-backdrop'), 'Done closes the time dialog');

  console.log('\n=== LynxAutocomplete: search dialog, browse + filter + pick ===');
  const cityHost = need(findByClass(page, 'city'), '.city host');
  assert(!findByClass(cityHost, 'lynx-autocomplete-backdrop'), 'dialog closed initially');
  tap(need(findByClass(cityHost, 'lynx-autocomplete-trigger'), 'city trigger'));
  await tick();
  await tick();
  assert(!!findByClass(cityHost, 'lynx-autocomplete-backdrop'), 'dialog opens on trigger tap');
  assert(
    hasOptionLabel(cityHost, 'lynx-select-option', 'Berlin'),
    'all options are browseable before typing anything (empty search)',
  );
  const citySearch = need(findByClass(cityHost, 'lynx-autocomplete-search'), 'city search input');
  typeInto(citySearch, 'ky');
  await tick();
  await tick();
  assert(hasOptionLabel(cityHost, 'lynx-select-option', 'Kyiv'), 'Kyiv matches "ky"');
  assert(hasOptionLabel(cityHost, 'lynx-select-option', 'Kyoto'), 'Kyoto matches "ky"');
  assert(!hasOptionLabel(cityHost, 'lynx-select-option', 'Krakow'), 'Krakow does not contain "ky"');
  assert(cmp?.city === '', 'typing alone does not set the value (must pick)');

  tap(findOptionByLabel(cityHost, 'lynx-select-option', 'Kyiv'));
  await tick();
  await tick();
  assert(cmp?.city === 'Kyiv', 'picking a filtered option sets the value');
  assert(!findByClass(cityHost, 'lynx-autocomplete-backdrop'), 'dialog closes after picking');

  console.log('\n=== LynxAutocomplete: reopening resets the search and highlights the current value ===');
  tap(need(findByClass(cityHost, 'lynx-autocomplete-trigger'), 'city trigger (reopen)'));
  await tick();
  await tick();
  assert(
    hasOptionLabel(cityHost, 'lynx-select-option', 'Berlin'),
    'search resets to empty (browseable again) on reopen',
  );
  const kyivOption = findOptionByLabel(cityHost, 'lynx-select-option', 'Kyiv');
  assert(
    kyivOption.classes?.split(/\s+/).includes('lynx-select-option-selected') ?? false,
    'the current value is highlighted as selected when reopened',
  );
  tap(kyivOption);
  await tick();
  await tick();
  assert(cmp?.city === 'Kyiv', 're-picking the already-selected option still works');
  assert(!findByClass(cityHost, 'lynx-autocomplete-backdrop'), 'dialog closes after picking');

  console.log('\n=== LynxCheckbox: tap toggles, no dialog involved ===');
  const agreeHost = need(findByClass(page, 'agree'), '.agree host');
  assert(!findByClass(agreeHost, 'lynx-checkbox-checked'), 'unchecked initially');
  tap(need(findByClass(agreeHost, 'lynx-checkbox'), 'agree checkbox'));
  await tick();
  await tick();
  assert(cmp?.agreed === true, 'tap checks the box (ngModel updated)');
  assert(!!findByClass(agreeHost, 'lynx-checkbox-checked'), 'lynx-checkbox-checked class applied');
  // Same reason as the toggle below: the box carries its own state class, so its
  // checked styling doesn't depend on a parent-state descendant rule.
  assert(
    !!findByClass(agreeHost, 'lynx-checkbox-box-checked'),
    'the box itself carries lynx-checkbox-box-checked',
  );
  tap(need(findByClass(agreeHost, 'lynx-checkbox'), 'agree checkbox (2nd tap)'));
  await tick();
  await tick();
  assert(cmp?.agreed === false, 'a 2nd tap unchecks it');

  console.log('\n=== LynxRadioGroup: inline, mutually exclusive, no dialog ===');
  const contactHost = need(findByClass(page, 'contact'), '.contact host');
  assert(!findByClass(contactHost, 'lynx-radio-group-disabled'), 'not disabled');
  assert(
    findAllByClass(contactHost, 'lynx-radio-option').length === 3,
    'all 3 options rendered inline (no trigger/dialog to open)',
  );
  tap(findOptionByLabel(contactHost, 'lynx-radio-option', 'Phone'));
  await tick();
  await tick();
  assert(cmp?.contactMethod === 'phone', `ngModel updated to the picked option (got ${cmp?.contactMethod})`);
  assert(
    findOptionByLabel(contactHost, 'lynx-radio-option', 'Phone').classes
      ?.split(/\s+/)
      .includes('lynx-radio-option-selected') ?? false,
    'Phone shows selected',
  );
  tap(findOptionByLabel(contactHost, 'lynx-radio-option', 'SMS'));
  await tick();
  await tick();
  assert(cmp?.contactMethod === 'sms', 'picking a different option switches the selection');
  assert(
    !(
      findOptionByLabel(contactHost, 'lynx-radio-option', 'Phone').classes
        ?.split(/\s+/)
        .includes('lynx-radio-option-selected') ?? false
    ),
    'Phone is no longer selected — mutually exclusive',
  );

  console.log('\n=== LynxToggle: tap flips it, same as checkbox semantics ===');
  const newsletterHost = need(findByClass(page, 'newsletter'), '.newsletter host');
  assert(!findByClass(newsletterHost, 'lynx-toggle-on'), 'off initially');
  tap(need(findByClass(newsletterHost, 'lynx-toggle'), 'newsletter toggle'));
  await tick();
  await tick();
  assert(cmp?.subscribed === true, 'tap turns it on (ngModel updated)');
  assert(!!findByClass(newsletterHost, 'lynx-toggle-on'), 'lynx-toggle-on class applied');
  // The state class must ALSO land on the element that gets styled, not only on
  // the root. Without `enableCSSInvalidation`, Lynx matches descendant
  // selectors only when an element is created, and Angular always applies
  // `[class.x]` after creation, so a `.lynx-toggle-on .lynx-toggle-track` rule
  // never fired on-device and the toggle had no visible on-state at all.
  // pluginAngularLynx turns the flag on now, but an app can turn it off, so the
  // controls don't rely on it. See docs/13-styling.md.
  assert(
    !!findByClass(newsletterHost, 'lynx-toggle-track-on'),
    'the track itself carries lynx-toggle-track-on (no parent-state descendant rule needed)',
  );
  tap(need(findByClass(newsletterHost, 'lynx-toggle'), 'newsletter toggle (2nd tap)'));
  await tick();
  await tick();
  assert(cmp?.subscribed === false, 'a 2nd tap turns it back off');
  assert(
    !findByClass(newsletterHost, 'lynx-toggle-track-on'),
    'and the track-level state class is removed again',
  );

  console.log(`\n=== LynxSlider: drag along the track, on the ${onMainThread ? 'Main' : 'Background'} Thread (mock measures a 100px-wide track) ===`);
  const volumeHost = need(findByClass(page, 'volume'), '.volume host');
  const track = need(findByClass(volumeHost, 'lynx-slider-track'), 'volume track');
  const fill = need(findByClass(volumeHost, 'lynx-slider-fill'), 'volume fill');
  const thumb = need(findByClass(volumeHost, 'lynx-slider-thumb'), 'volume thumb');
  assert(cmp?.volume === 0, 'starts at min (0)');
  if (onMainThread) {
    assert(
      ['touchstart', 'touchmove', 'touchend', 'touchcancel'].every((name) => typeof track.events[name]?.sign === 'function'),
      'the track binds touchstart, touchmove, touchend and touchcancel to Main-Thread worklets',
    );
  } else {
    assert(
      ['touchstart', 'touchmove', 'touchend'].every((name) => typeof track.events[name]?.sign === 'string'),
      'without the worklet runtime the track binds Background touch handlers',
    );
  }
  touch(track, 'touchstart', 50);
  await tick();
  if (onMainThread) {
    assert(
      styleOf(fill, 'width') === '50%' && styleOf(thumb, 'left') === '50%',
      `the Main Thread moves the fill and thumb itself (fill ${styleOf(fill, 'width')}, thumb ${styleOf(thumb, 'left')})`,
    );
  }
  await tick();
  assert(cmp?.volume === 50, `touchstart at 50% of the track sets the value (got ${cmp?.volume})`);
  assert(styleOf(fill, 'width') === '50%' && styleOf(thumb, 'left') === '50%', 'the fill and thumb show it');
  touch(track, 'touchmove', 97);
  if (onMainThread) {
    assert(styleOf(fill, 'width') === '100%', `a touchmove repaints at once, before the Background Thread hears of it (fill ${styleOf(fill, 'width')})`);
  }
  await tick();
  await tick();
  assert(cmp?.volume === 100, `touchmove keeps updating and snaps to step=10 (got ${cmp?.volume})`);
  touch(track, 'touchmove', -20);
  await tick();
  await tick();
  assert(cmp?.volume === 0, `dragging past the start clamps to min (got ${cmp?.volume})`);
  touch(track, 'touchmove', 30);
  touch(track, 'touchend', 30);
  await tick();
  await tick();
  assert(cmp?.volume === 30, `touchend commits the last value (got ${cmp?.volume})`);
  assert(styleOf(fill, 'width') === '30%', `and the Background render that follows agrees with the Main Thread (fill ${styleOf(fill, 'width')})`);

  // A track that starts 40px into the page (not flush against the page
  // origin): the page-absolute touch minus the *measured* `left` still lands
  // on the track-local position. Only a `touchstart` re-measures (see
  // `touch()`'s doc comment), so this exercises gesture start first...
  touch(track, 'touchstart', 60, 40);
  await tick();
  await tick();
  assert(
    cmp?.volume === 60,
    `page-absolute touch minus the measured track left resolves correctly on an inset track (got ${cmp?.volume})`,
  );
  // ...then a touchmove later in the same gesture reuses that gesture's
  // geometry rather than re-measuring or assuming left=0 (which would clamp
  // to 100, not land on 80).
  touch(track, 'touchmove', 80, 40);
  await tick();
  await tick();
  assert(
    cmp?.volume === 80,
    `a touchmove later in the same gesture reuses that gesture's measured geometry, still inset-aware (got ${cmp?.volume})`,
  );
  touch(track, 'touchend', 80, 40);
  await tick();
  await tick();

  // The FIRST touch on a slider must not be dropped: it's applied the moment
  // the measurement lands. On a device this is the difference between "the
  // first tap on a freshly-mounted slider does nothing" (a real bug, seen in
  // examples/accessibility) and it working. The measurement is stretched so
  // the window is deterministic, and the tap ends before it lands.
  const g = globalThis as Record<string, unknown>;
  g['__QUERY_DELAY_MS__'] = 60;
  cmp?.showLateSlider.set(true);
  await tick();
  await tick();
  const lateHost = need(findByClass(page, 'late'), '.late host');
  const lateTrack = need(findByClass(lateHost, 'lynx-slider-track'), 'late track');
  assert(cmp?.lateVolume === 0, 'the freshly-mounted slider starts at min');
  touch(lateTrack, 'touchstart', 20);
  touch(lateTrack, 'touchend', 20);
  await tick();
  assert(
    cmp?.lateVolume === 0,
    `while the first measurement is still outstanding the value is untouched (got ${cmp?.lateVolume})`,
  );
  await new Promise((r) => setTimeout(r, 120));
  await tick();
  assert(
    cmp?.lateVolume === 20,
    `a tap is applied once the measurement lands, even after its touchend (got ${cmp?.lateVolume})`,
  );
  assert(
    styleOf(need(findByClass(lateHost, 'lynx-slider-fill'), 'late fill'), 'width') === '20%',
    'and the late commit leaves the fill where the Main Thread put it',
  );
  g['__QUERY_DELAY_MS__'] = 0;

  console.log('\n=== LynxSlider: the model writes, and disabled ===');
  // A plain field, so Angular needs telling. Marking the root's host view
  // isn't enough on Angular 22, where an unset strategy means OnPush.
  if (cmp) cmp.volume = 70;
  cmp?.cdr.markForCheck();
  await tick();
  await tick();
  assert(styleOf(fill, 'width') === '70%', `a value written by the model moves the fill (got ${styleOf(fill, 'width')})`);
  touch(track, 'touchstart', 70);
  touch(track, 'touchmove', 10);
  touch(track, 'touchend', 10);
  await tick();
  await tick();
  assert(cmp?.volume === 10, `a drag after a model write starts from it (got ${cmp?.volume})`);
  cmp?.sliderDisabled.set(true);
  await tick();
  await tick();
  touch(track, 'touchstart', 90);
  touch(track, 'touchend', 90);
  await tick();
  await tick();
  assert(cmp?.volume === 10 && styleOf(fill, 'width') === '10%', `a disabled slider ignores touches (got ${cmp?.volume})`);
  cmp?.sliderDisabled.set(false);
  await tick();
  await tick();

  // Back to min, so the accessibility-value assertion below reads a known state.
  touch(track, 'touchstart', -20, 40);
  touch(track, 'touchend', -20, 40);
  await tick();
  await tick();
  assert(track.attrs['accessibility-traits'] === 'adjustable', 'track carries accessibility-traits="adjustable"');
  assert(track.attrs['accessibility-value'] === '0', `track's accessibility-value tracks the live value (got ${track.attrs['accessibility-value']})`);

  console.log('\n=== LynxStepper: tap +/- with min/max clamping ===');
  const quantityHost = need(findByClass(page, 'quantity'), '.quantity host');
  const inc = need(findByClass(quantityHost, 'lynx-stepper-increment'), 'quantity +');
  const dec = need(findByClass(quantityHost, 'lynx-stepper-decrement'), 'quantity -');
  assert(cmp?.quantity === 0, 'starts at 0');
  for (let i = 0; i < 5; i++) {
    tap(inc);
    await tick();
    await tick();
  }
  assert(cmp?.quantity === 5, `5 taps reaches max (got ${cmp?.quantity})`);
  assert(inc.attrs['accessibility-traits'] === 'button', '+ button carries accessibility-traits="button"');
  assert(inc.attrs['accessibility-label'] === 'Increase', '+ button carries a descriptive accessibility-label');
  tap(inc);
  await tick();
  await tick();
  assert(cmp?.quantity === 5, 'a 6th tap stays clamped at max');
  for (let i = 0; i < 6; i++) {
    tap(dec);
    await tick();
    await tick();
  }
  assert(cmp?.quantity === 0, `6 taps of - from 5 clamps at min (got ${cmp?.quantity})`);

  console.log('\n=== LynxSegmentedControl: mutually exclusive, no dialog ===');
  const unitHost = need(findByClass(page, 'unit'), '.unit host');
  assert(findAllByClass(unitHost, 'lynx-segment').length === 2, 'both segments rendered inline');
  tap(findOptionByLabel(unitHost, 'lynx-segment', 'mi'));
  await tick();
  await tick();
  assert(cmp?.unit === 'mi', `ngModel updated to the picked segment (got ${cmp?.unit})`);
  assert(
    findOptionByLabel(unitHost, 'lynx-segment', 'mi').classes?.split(/\s+/).includes('lynx-segment-selected') ?? false,
    '"mi" shows selected',
  );
  tap(findOptionByLabel(unitHost, 'lynx-segment', 'km'));
  await tick();
  await tick();
  assert(cmp?.unit === 'km', 'picking the other segment switches the selection');
  assert(
    !(findOptionByLabel(unitHost, 'lynx-segment', 'mi').classes?.split(/\s+/).includes('lynx-segment-selected') ?? false),
    '"mi" is no longer selected — mutually exclusive',
  );

  console.log(
    '\n✅ All control assertions passed — select/date/time/autocomplete/checkbox/radio/toggle/slider/stepper/segmented-control CVAs work end-to-end.\n',
  );
}

main().catch((err) => {
  console.error('\n❌ Control verification failed:\n', err);
  process.exit(1);
});
