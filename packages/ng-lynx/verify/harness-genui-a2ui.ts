/**
 * Headless verification of the Angular A2UI renderer (`ng-lynx/genui`)
 * against the real `@lynx-js/genui/a2ui/store` protocol machinery — no mocks
 * on the protocol side. Exercises the full loop the ReactLynx `<A2UI>` docs
 * describe: push messages in, render, send actions out.
 *
 *  - createSurface / updateComponents / updateDataModel render a surface
 *    from the Angular basic catalog;
 *  - data-binding reactivity: a later updateDataModel updates rendered text
 *    (through the preact-signal → Angular-signal bridge);
 *  - in-place component replacement re-renders via per-component resources;
 *  - taps dispatch `UserActionPayload`s with bindings in the action context
 *    resolved at dispatch time;
 *  - TextField input writes back through its `value` binding (setValue) and
 *    other components bound to the same path update;
 *  - templated children (`{ path, componentId }`) expand per data item with
 *    scoped relative bindings;
 *  - unknown component tags fail soft with a notice.
 *
 * Run with: `npm run verify:genui-a2ui`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { basicFunctions } from '@lynx-js/genui/a2ui/functions';
import type { UserActionPayload } from '@lynx-js/genui/a2ui/store';
import { createMessageStore } from '@lynx-js/genui/a2ui/store';
import { bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import {
  A2UI_BASIC_CATALOG,
  A2uiSurface,
  defineA2uiCatalog,
} from 'ng-lynx/genui';
import 'ng-lynx/main-thread';

import {
  assert,
  findAllByClass,
  findByClass,
  findByType,
  findText,
  getPage,
  installMockPapi,
  tick,
} from './mock-papi.js';

const store = createMessageStore();
const actions: UserActionPayload[] = [];

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [A2uiSurface],
  template: `
    <view class="app">
      <a2ui-surface [messageStore]="store" [catalog]="catalog" (action)="onAction($event)" />
      <text class="status">actions:{{ count() }}</text>
    </view>
  `,
})
export class TestComponent {
  readonly store = store;
  readonly catalog = defineA2uiCatalog([...A2UI_BASIC_CATALOG, ...(basicFunctions as never[])]);
  readonly count = signal(0);

  onAction(action: UserActionPayload): void {
    actions.push(action);
    this.count.update((n) => n + 1);
  }
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>)['renderPage']({});
  await bootstrapLynxApplication(TestComponent);
  await tick();

  console.log('\n=== createSurface + updateComponents + updateDataModel render ===');
  store.push([
    { createSurface: { surfaceId: 's1' } },
    {
      updateComponents: {
        surfaceId: 's1',
        components: [
          { id: 'root', component: 'Column', children: ['title', 'row1', 'buy', 'name-field', 'greet'] },
          { id: 'title', component: 'Text', text: { path: '/product/title' }, variant: 'headline' },
          { id: 'row1', component: 'Row', children: ['price', 'badge'] },
          { id: 'price', component: 'Text', text: { path: '/product/price' } },
          { id: 'badge', component: 'Text', text: 'NEW' },
          { id: 'buy-label', component: 'Text', text: 'Buy now' },
          {
            id: 'buy',
            component: 'Button',
            child: 'buy-label',
            action: { event: { name: 'buy', context: { sku: { path: '/product/sku' } } } },
          },
          { id: 'name-field', component: 'TextField', label: 'Your name', value: { path: '/form/name' } },
          { id: 'greet', component: 'Text', text: { path: '/form/name' } },
        ],
      },
    },
    {
      updateDataModel: {
        surfaceId: 's1',
        path: '/',
        value: { product: { title: 'Lynx Deck', price: '$49', sku: 'LX-1' }, form: { name: 'Ada' } },
      },
    },
  ] as never[]);
  await tick();
  const page = getPage();
  assert(!!findText(page, 'Lynx Deck'), 'bound title text rendered');
  assert(!!findText(page, '$49'), 'bound price rendered inside a Row');
  assert(!!findText(page, 'NEW'), 'literal text rendered');
  assert(!!findText(page, 'Buy now'), 'button child rendered');
  assert(!!findText(page, 'Ada'), 'text bound to the form path rendered');
  assert(!!findByClass(page, 'button-primary'), 'button uses upstream class names');

  console.log('\n=== data-model update re-renders bound props ===');
  store.push([
    { updateDataModel: { surfaceId: 's1', path: '/product/title', value: 'Lynx Deck Pro' } },
  ] as never[]);
  await tick();
  assert(!!findText(page, 'Lynx Deck Pro'), 'title updated when only the data model changed');

  console.log('\n=== in-place component replacement re-renders ===');
  store.push([
    {
      updateComponents: {
        surfaceId: 's1',
        components: [{ id: 'badge', component: 'Text', text: 'SALE', emphasis: 'strong' }],
      },
    },
  ] as never[]);
  await tick();
  assert(!!findText(page, 'SALE'), 'replaced component re-rendered via its resource');
  assert(!findText(page, 'NEW'), 'old component content gone');

  console.log('\n=== tap dispatches a resolved UserActionPayload ===');
  const buttonEl = findByClass(page, 'button');
  const tapSign = buttonEl?.events?.['tap']?.sign as string | undefined;
  assert(!!tapSign, 'button view has a (tap) listener');
  publishEvent(tapSign!, { type: 'tap' });
  await tick();
  assert(actions.length === 1, 'one action emitted');
  assert(actions[0]!.name === 'buy', 'action name from the event');
  assert(actions[0]!.sourceComponentId === 'buy', 'source component id recorded');
  assert(actions[0]!.context['sku'] === 'LX-1', 'binding in action context resolved at dispatch');
  assert(!!findText(page, 'actions:1'), 'host component saw the output');

  console.log('\n=== TextField writes back through its value binding ===');
  const fieldControl = findByClass(page, 'textfield-control');
  const inputSign = fieldControl?.events?.['input']?.sign as string | undefined;
  assert(!!inputSign, 'textfield control has an (input) listener');
  publishEvent(inputSign!, { detail: { value: 'Grace' } });
  await tick();
  assert(!!findText(page, 'Grace'), 'text bound to the same path updated after input');

  console.log('\n=== templated children expand per data item ===');
  store.push([
    {
      updateComponents: {
        surfaceId: 's1',
        components: [
          { id: 'root', component: 'Column', children: ['items'] },
          { id: 'items', component: 'Column', children: { path: '/todos', componentId: 'todo-tpl' } },
          { id: 'todo-tpl', component: 'Text', text: { path: 'label' } },
        ],
      },
    },
    {
      updateDataModel: {
        surfaceId: 's1',
        path: '/todos',
        value: [{ label: 'Write docs' }, { label: 'Ship genui' }],
      },
    },
  ] as never[]);
  await tick();
  assert(!!findText(page, 'Write docs'), 'first templated item rendered with relative binding');
  assert(!!findText(page, 'Ship genui'), 'second templated item rendered');

  console.log('\n=== newly ported components (Icon, RadioGroup, ChoicePicker, Modal, Tabs, DateTimeInput, charts) ===');
  store.push([
    {
      updateComponents: {
        surfaceId: 's1',
        components: [
          {
            id: 'root',
            component: 'Column',
            children: ['icon', 'radios', 'picker', 'modal', 'tabs', 'when', 'line', 'pie'],
          },
          { id: 'icon', component: 'Icon', name: 'arrow_back' },
          { id: 'radios', component: 'RadioGroup', items: ['a', 'b', 'c'], value: { path: '/pick' } },
          {
            id: 'picker',
            component: 'ChoicePicker',
            variant: 'multipleSelection',
            options: [{ label: 'Red', value: 'red' }, { label: 'Blue', value: 'blue' }],
            value: { path: '/colors' },
          },
          { id: 'modal-trigger-label', component: 'Text', text: 'Open' },
          { id: 'modal-content-label', component: 'Text', text: 'Modal body' },
          { id: 'modal', component: 'Modal', trigger: 'modal-trigger-label', content: 'modal-content-label' },
          { id: 'tab1-label', component: 'Text', text: 'Tab one content' },
          { id: 'tab2-label', component: 'Text', text: 'Tab two content' },
          {
            id: 'tabs',
            component: 'Tabs',
            tabs: [{ title: 'One', child: 'tab1-label' }, { title: 'Two', child: 'tab2-label' }],
          },
          { id: 'when', component: 'DateTimeInput', value: '2024-03-01', enableTime: false },
          {
            id: 'line',
            component: 'LineChart',
            labels: ['Mon', 'Tue'],
            series: [{ name: 'Visits', values: [1, 2] }],
          },
          { id: 'pie', component: 'PieChart', data: [{ name: 'A', value: 3 }, { name: 'B', value: 1 }] },
        ],
      },
    },
    { updateDataModel: { surfaceId: 's1', path: '/pick', value: 'a' } },
    { updateDataModel: { surfaceId: 's1', path: '/colors', value: [] } },
  ] as never[]);
  await tick();
  assert(!!findText(page, 'arrow_back'), 'Icon renders the Material ligature name');

  const radioOptions = findAllByClass(page, 'radio-option');
  assert(radioOptions.length === 3, 'RadioGroup rendered all 3 items');
  assert(findAllByClass(page, 'radio-dot-selected').length === 1, 'RadioGroup shows exactly one selected dot ("a")');
  const radioTapSign = radioOptions[1]?.events?.['tap']?.sign as string | undefined;
  assert(!!radioTapSign, 'RadioGroup option has a (tap) listener');
  publishEvent(radioTapSign!, { type: 'tap' });
  await tick();
  assert(findAllByClass(page, 'radio-option').length === 3, 'RadioGroup still renders all 3 items after selection');
  assert(findAllByClass(page, 'radio-dot-selected').length === 1, 'RadioGroup setValue moved the selected dot to "b"');

  const pickerOptions = findAllByClass(page, 'choice-picker-option');
  assert(pickerOptions.length === 2, 'ChoicePicker rendered both options');
  const pickerTapSign = pickerOptions[0]?.events?.['tap']?.sign as string | undefined;
  publishEvent(pickerTapSign!, { type: 'tap' });
  await tick();
  assert(!!findText(page, '✓'), 'ChoicePicker shows a checkmark once an option is selected');

  assert(!findText(page, 'Modal body'), 'Modal content is not rendered before the trigger is tapped');
  const modalTriggerEl = findByClass(page, 'modal-trigger');
  const modalTapSign = modalTriggerEl?.events?.['tap']?.sign as string | undefined;
  assert(!!modalTapSign, 'Modal trigger has a (tap) listener');
  publishEvent(modalTapSign!, { type: 'tap' });
  await tick();
  assert(!!findText(page, 'Modal body'), 'Modal content renders after the trigger is tapped');

  assert(!!findText(page, 'Tab one content'), 'Tabs renders the first tab by default');
  assert(!findText(page, 'Tab two content'), 'Tabs does not render the inactive tab');
  const tabHeaders = findAllByClass(page, 'tabs-header');
  const secondTabSign = tabHeaders[1]?.events?.['tap']?.sign as string | undefined;
  publishEvent(secondTabSign!, { type: 'tap' });
  await tick();
  assert(!!findText(page, 'Tab two content'), 'Tabs switches content after tapping the second header');

  assert(!!findText(page, '2024-03-01'), 'DateTimeInput shows the formatted current value');
  const dateControlEl = findByClass(page, 'datetime-input-control');
  const dateTapSign = dateControlEl?.events?.['tap']?.sign as string | undefined;
  publishEvent(dateTapSign!, { type: 'tap' });
  await tick();
  assert(!!findByClass(page, 'datetime-calendar'), 'DateTimeInput opens a calendar dialog on tap');

  const lineSvg = findByType(page, 'svg');
  assert(!!lineSvg && typeof lineSvg.attrs['content'] === 'string' && (lineSvg.attrs['content'] as string).includes('<path'), 'LineChart renders SVG path markup');
  assert(!!findText(page, 'Visits'), 'LineChart legend renders the series name');
  assert(!!findText(page, 'A: 3'), 'PieChart legend renders a slice value');

  console.log('\n=== unknown components fail soft ===');
  store.push([
    {
      updateComponents: {
        surfaceId: 's1',
        components: [{ id: 'root', component: 'Column', children: ['mystery'] }, {
          id: 'mystery',
          component: 'BarChart',
          title: 'Not in the catalog',
        }],
      },
    },
  ] as never[]);
  await tick();
  assert(!!findText(page, 'Unsupported component'), 'unknown tag renders the fail-soft notice');

  console.log('\n✅ Angular A2UI renderer assertions passed.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Angular A2UI renderer verification failed:\n', err);
  process.exit(1);
});
