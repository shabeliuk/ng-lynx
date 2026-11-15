/**
 * Headless verification of the Angular OpenUI renderer (`ng-lynx/genui`)
 * against the real `@openuidev/lang-core` parser/evaluator — the same
 * machinery `@lynx-js/genui/openui` uses under ReactLynx. Exercises:
 *
 *  - parsing raw OpenUI-language text (statements, references, positional →
 *    named prop mapping) and rendering it from the Angular library;
 *  - streaming: partial text renders what's parseable, appended chunks
 *    re-render, taps are gated while `streaming` is true;
 *  - `Action([@ToAssistant(...)])` → ActionPlan evaluation → `(action)`
 *    output with `continue_conversation` type and form state attached;
 *  - `$state` refs in dynamic props re-evaluate when a TextField bound to
 *    the same state name changes it;
 *  - unknown component names render nothing (fail soft), and parse errors
 *    surface through `(parseResult)`;
 *  - the components added for full-catalog parity (Icon, Loading, Separator,
 *    RadioGroup, ChoicePicker, DateTimeInput, Modal, Tabs) parse, render,
 *    and (where interactive) respond to taps correctly — including Modal's
 *    open/close and Tabs' content switch, both of which depend on
 *    `OpenuiNode`'s `ngOnChanges` correctly rebuilding when its bound node
 *    switches to a different sibling id while staying non-null.
 *
 * Run with: `npm run verify:genui-openui`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import type { ActionEvent, ParseResult } from '@openuidev/lang-core';
import { bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import { createOpenUiLibrary, OpenuiRenderer } from 'ng-lynx/genui';
import 'ng-lynx/main-thread';

import {
  assert,
  findAllByClass,
  findByClass,
  findText,
  getPage,
  installMockPapi,
  tick,
} from './mock-papi.js';

const FULL_RESPONSE = [
  '$name = ""',
  'root = Stack([card, hello, field, btn], "column")',
  'card = Card([CardHeader("Trip planner", "3 stops"), Tag("beta")])',
  'hello = Text("Hello " + $name)',
  'field = TextField("Name", "", null, null, null, "$name")',
  'btn = Button("Send", Action([@ToAssistant("submitted")]))',
].join('\n');

const NEW_COMPONENTS_RESPONSE = [
  'root = Stack([icon, loading, sep, radios, picker, when, modal, tabsNode, clip, track])',
  'icon = Icon("home", "lg", "primary")',
  'loading = Loading("block")',
  'sep = Separator()',
  'radios = RadioGroup(["Small", "Medium", "Large"], "Medium")',
  'picker = ChoicePicker("Color", ["Red", "Blue"], "Red")',
  'when = DateTimeInput("2024-03-01", true, false)',
  'triggerLabel = Text("Open")',
  'modalBody = Text("Modal body")',
  'modal = Modal(triggerLabel, modalBody, "Details")',
  'tabAContent = Text("Tab A body")',
  'tabBContent = Text("Tab B body")',
  'tabsNode = Tabs([{value: "a", title: "Tab A", child: tabAContent}, {value: "b", title: "Tab B", child: tabBContent}])',
  'clip = Video("https://example.com/clip.mp4", "Demo clip")',
  'track = AudioPlayer("https://example.com/track.mp3", "Demo track")',
].join('\n');

// Written the way a model prompted by genui 0.4.0's `buildOpenUiSystemPrompt`
// writes it: skipped optional arguments as `null`, Row's `justify, align, gap`
// order, Buttons' `buttons` array, the Slider added in 0.4.0.
const PARITY_RESPONSE = [
  'root = Stack([age, amount, city, echo, row, btns])',
  'age = Slider("Retire at", 50, 70, 60, 5, null, "$retireAge")',
  'amount = TextField("Monthly savings", "500", "number", "^[0-9]+$", null, "$monthly")',
  'city = TextField("Where?", "Lisbon", null, null, null, "$city")',
  'echo = Text("Age " + $retireAge)',
  'row = Row([Tag("a"), Tag("b")], "between", "start", "s")',
  'btns = Buttons([Button("Submit", Action([@ToAssistant("answers")]), "primary", "destructive", "small"), Button("Other", null, "secondary")])',
].join('\n');

const actions: ActionEvent[] = [];
let lastParse: ParseResult | undefined;

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [OpenuiRenderer],
  template: `
    <view class="app">
      <openui-renderer
        [response]="response()"
        [library]="library"
        [streaming]="streaming()"
        (action)="onAction($event)"
        (parseResult)="onParse($event)"
      />
    </view>
  `,
})
export class TestComponent {
  readonly library = createOpenUiLibrary();
  readonly response = signal('');
  readonly streaming = signal(true);

  onAction(event: ActionEvent): void {
    actions.push(event);
  }
  onParse(result: ParseResult): void {
    lastParse = result;
  }
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>)['renderPage']({});
  const appRef = await bootstrapLynxApplication(TestComponent);
  const app = (appRef as { components: Array<{ instance: TestComponent }> })
    .components[0]!.instance;
  await tick();
  const page = getPage();

  console.log('\n=== streaming: partial text renders what is parseable ===');
  // Cut mid-way through the `hello` statement — root and card are complete.
  const cut = FULL_RESPONSE.indexOf('field =');
  app.response.set(FULL_RESPONSE.slice(0, cut));
  await tick();
  assert(!!findText(page, 'Trip planner'), 'card header title rendered from partial stream');
  assert(!!findText(page, '3 stops'), 'card header subtitle rendered');
  assert(!!findText(page, 'beta'), 'tag rendered');
  assert(!findText(page, 'Send'), 'button not rendered yet (statement not streamed)');

  console.log('\n=== full text renders the complete tree ===');
  app.response.set(FULL_RESPONSE);
  await tick();
  assert(!!findText(page, 'Send'), 'button rendered after the full stream');
  assert(!!findText(page, 'Hello'), 'dynamic text rendered');
  assert(!!findByClass(page, 'OpenUITextFieldControl'), 'textfield control rendered');
  assert(lastParse?.meta.errors.length === 0, 'no validation errors reported');

  console.log('\n=== taps are gated while streaming ===');
  const streamingTapSign = findByClass(page, 'OpenUIButton')?.events?.['tap']?.sign as
    | string
    | undefined;
  assert(!!streamingTapSign, 'button has a (tap) listener');
  publishEvent(streamingTapSign!, { type: 'tap' });
  await tick();
  assert(actions.length === 0, 'no action while streaming=true');

  console.log('\n=== $state: TextField input re-evaluates dynamic text ===');
  app.streaming.set(false);
  await tick();
  const control = findByClass(page, 'OpenUITextFieldControl');
  const inputSign = control?.events?.['input']?.sign as string | undefined;
  assert(!!inputSign, 'textfield has an (input) listener');
  publishEvent(inputSign!, { detail: { value: 'Grace' } });
  await tick();
  assert(!!findText(page, 'Hello Grace'), 'dynamic prop re-evaluated from form state');

  console.log('\n=== tap dispatches the evaluated ActionPlan ===');
  publishEvent(streamingTapSign!, { type: 'tap' });
  await tick();
  assert(actions.length === 1, 'one action emitted after streaming ended');
  assert(actions[0]!.type === 'continue_conversation', 'ToAssistant → continue_conversation');
  assert(actions[0]!.humanFriendlyMessage === 'submitted', 'step message carried through');
  const formState = (actions[0] as { formState?: Record<string, unknown> }).formState;
  assert(
    (formState?.['$name'] as { value?: unknown } | undefined)?.value === 'Grace',
    'form state attached to the action',
  );

  console.log('\n=== unknown components fail soft ===');
  app.response.set('root = Stack([Text("still here"), Carousel(["a", "b"])])');
  await tick();
  assert(!!findText(page, 'still here'), 'known component still renders');
  assert(!findText(page, 'Carousel'), 'unknown component renders nothing');

  console.log('\n=== newly ported components (Icon, Loading, Separator, RadioGroup, ChoicePicker, DateTimeInput, Modal, Tabs) ===');
  app.response.set(NEW_COMPONENTS_RESPONSE);
  await tick();
  assert(!!findText(page, 'home'), 'Icon renders the Material name');
  assert(!!findByClass(page, 'OpenUIIconLg'), 'Icon applies the size class');
  assert(!!findByClass(page, 'OpenUIIconColorPrimary'), 'Icon applies the color class');

  assert(!!findByClass(page, 'OpenUILoadingBlock'), 'Loading applies the block variant class');
  assert(!!findByClass(page, 'OpenUILoadingSkeletonSecondary'), 'Loading block variant renders the secondary skeleton');

  assert(!!findByClass(page, 'OpenUISeparator'), 'Separator renders');

  const radioOptions = findAllByClass(page, 'OpenUIRadioOption');
  assert(radioOptions.length === 3, 'RadioGroup rendered all 3 items');
  assert(findAllByClass(page, 'OpenUIRadioIndicatorDot').length === 1, 'RadioGroup shows exactly one selected dot ("Medium")');
  const radioTapSign = radioOptions[0]?.events?.['tap']?.sign as string | undefined;
  assert(!!radioTapSign, 'RadioGroup option has a (tap) listener');
  publishEvent(radioTapSign!, { type: 'tap' });
  await tick();
  assert(findAllByClass(page, 'OpenUIRadioIndicatorDot').length === 1, 'RadioGroup tap moved the selected dot without adding a second one');

  const choiceItems = findAllByClass(page, 'OpenUIChoiceItem');
  assert(choiceItems.length === 2, 'ChoicePicker rendered both options');
  assert(findAllByClass(page, 'OpenUIChoiceItemSelected').length === 1, 'ChoicePicker starts with exactly one selected chip ("Red")');
  const secondChoiceTapSign = choiceItems[1]?.events?.['tap']?.sign as string | undefined;
  publishEvent(secondChoiceTapSign!, { type: 'tap' });
  await tick();
  assert(findAllByClass(page, 'OpenUIChoiceItemSelected').length === 1, 'ChoicePicker tap moves selection without adding a second selected chip');

  assert(!!findText(page, '2024-03-01'), 'DateTimeInput renders its value');
  assert(!!findText(page, 'enableDate=true, enableTime=false'), 'DateTimeInput renders the mode hint');

  assert(!findText(page, 'Modal body'), 'Modal content is not rendered before the trigger is tapped');
  const modalTriggerSign = findByClass(page, 'OpenUIModalTrigger')?.events?.['tap']?.sign as string | undefined;
  assert(!!modalTriggerSign, 'Modal trigger has a (tap) listener');
  publishEvent(modalTriggerSign!, { type: 'tap' });
  await tick();
  assert(!!findText(page, 'Modal body'), 'Modal content renders after the trigger is tapped');
  assert(!!findText(page, 'Details'), 'Modal renders its title');
  const modalCloseSign = findByClass(page, 'OpenUIModalClose')?.events?.['tap']?.sign as string | undefined;
  publishEvent(modalCloseSign!, { type: 'tap' });
  await tick();
  assert(!findText(page, 'Modal body'), 'Modal content is removed after tapping close');

  assert(!!findText(page, 'Tab A body'), 'Tabs renders the first tab by default');
  assert(!findText(page, 'Tab B body'), 'Tabs does not render the inactive tab');
  const tabTriggers = findAllByClass(page, 'OpenUITabTrigger');
  const secondTabSign = tabTriggers[1]?.events?.['tap']?.sign as string | undefined;
  publishEvent(secondTabSign!, { type: 'tap' });
  await tick();
  assert(!!findText(page, 'Tab B body'), 'Tabs switches content after tapping the second header');
  assert(!findText(page, 'Tab A body'), 'Tabs no longer renders the first tab body');

  assert(!!findText(page, 'Demo clip'), 'Video renders its title (placeholder card, matches upstream)');
  assert(!!findText(page, 'https://example.com/clip.mp4'), 'Video renders its URL');
  assert(!!findByClass(page, 'OpenUIVideoPlay'), 'Video renders the static play-icon placeholder');
  assert(!!findText(page, 'Demo track'), 'AudioPlayer renders its description (placeholder card, matches upstream)');
  assert(!!findText(page, 'https://example.com/track.mp3'), 'AudioPlayer renders its URL');

  console.log('\n=== genui 0.4.0 signatures: Slider, pre-filled defaults, TextField variants, Buttons, Row ===');
  actions.length = 0;
  app.streaming.set(true);
  app.response.set(PARITY_RESPONSE);
  await tick();
  assert(lastParse?.meta.errors.length === 0, '0.4.0-signature response validates with no errors');
  assert(findAllByClass(page, 'OpenUISliderSegment').length === 5, 'Slider 50..70 step 5 renders one tap target per step (5)');
  app.streaming.set(false);
  await tick();
  assert(!!findText(page, 'Age 60'), 'Slider pre-filled value lands in its $variable once streaming ends');
  assert(!!findText(page, '60'), 'Slider header shows the value');

  const segments = findAllByClass(page, 'OpenUISliderSegment');
  publishEvent(segments[4]!.events['tap']!.sign as string, { type: 'tap' });
  await tick();
  assert(!!findText(page, 'Age 70'), 'tapping the last segment sets max (70)');
  const stepDownSign = findByClass(page, 'OpenUISliderStepDown')?.events?.['tap']?.sign as string;
  publishEvent(stepDownSign, { type: 'tap' });
  await tick();
  assert(!!findText(page, 'Age 65'), 'the − stepper moves one step (65)');
  for (let i = 0; i < 6; i++) publishEvent(stepDownSign, { type: 'tap' });
  await tick();
  assert(!!findText(page, 'Age 50'), 'the stepper clamps at min (50)');

  const setValues = () =>
    (((globalThis as Record<string, unknown>)['__INVOKE_LOG__'] ?? []) as { method: string; params?: { value?: string } }[])
      .filter((call) => call.method === 'setValue')
      .map((call) => call.params?.value);
  await tick();
  assert(setValues().includes('500'), 'a pre-filled TextField value is pushed with setValue (native inputs have no value attribute)');
  assert(setValues().includes('Lisbon'), 'every pre-filled TextField gets setValue');

  const amountControl = findAllByClass(page, 'OpenUITextFieldControl')[0];
  assert(amountControl?.attrs['type'] === 'number', 'TextField variant "number" → <input type="number">');
  assert(!findByClass(page, 'OpenUITextFieldError'), 'a pre-filled value matching validationRegexp shows no error');
  publishEvent(amountControl!.events['input']!.sign as string, { detail: { value: '12a' } });
  await tick();
  await tick();
  assert(!!findByClass(page, 'OpenUITextFieldError'), 'a value failing validationRegexp shows the error');
  assert(!setValues().includes('12a'), 'typed text is not echoed back through setValue');
  publishEvent(amountControl!.events['input']!.sign as string, { detail: { value: '500' } });
  await tick();
  assert(!findByClass(page, 'OpenUITextFieldError'), 'the error clears once the value is valid again');

  // The renderer normalizes inline styles (`key: value; …`), so compare without spaces.
  const rowStyle = String(findByClass(page, 'OpenUIRow')?.style ?? '').replace(/\s+/g, '');
  assert(rowStyle.includes('justify-content:space-between'), 'Row maps its 2nd positional arg (justify "between")');
  assert(rowStyle.includes('align-items:flex-start'), 'Row maps its 3rd positional arg (align "start")');
  assert(findAllByClass(page, 'OpenUIButton').length === 2, 'Buttons renders every entry of its `buttons` prop');
  assert(!!findByClass(page, 'OpenUIButtonDestructive'), 'Button type "destructive" → theme class');
  assert(!!findByClass(page, 'OpenUIButtonSize-small'), 'Button size "small" → theme class');

  publishEvent(findAllByClass(page, 'OpenUIButton')[0]!.events['tap']!.sign as string, { type: 'tap' });
  await tick();
  assert(actions.length === 1, 'Submit dispatched one action');
  const submitted = (actions[0] as { formState?: Record<string, { value?: unknown }> }).formState ?? {};
  assert(submitted['$retireAge']?.value === 50, 'submitted form state carries the Slider value (a number)');
  assert(submitted['$monthly']?.value === '500', 'submitted form state carries the edited TextField value');
  assert(submitted['$city']?.value === 'Lisbon', 'an untouched pre-filled TextField still submits its value');

  console.log('\n✅ Angular OpenUI renderer assertions passed.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Angular OpenUI renderer verification failed:\n', err);
  process.exit(1);
});
