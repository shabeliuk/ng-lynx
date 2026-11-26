/**
 * Headless verification of the Angular A2UI renderer (`ng-lynx/genui`)
 * against the real `@lynx-js/genui/a2ui/store` protocol machinery — no mocks
 * on the protocol side — for A2UI v1.0. Exercises the full loop the
 * ReactLynx `<A2UI>` docs describe: push messages in, render, send messages
 * out.
 *
 *  - createSurface (with the catalog id) / updateComponents / updateDataModel
 *    render a surface from the Angular basic catalog;
 *  - `@path` bindings re-render on data-model updates, and `null` deletes;
 *  - in-place component replacement re-renders via per-component resources;
 *  - taps send a v1.0 `action` message (to `messageHandler` and the
 *    `action` output), with `@path` and `@call` context values resolved;
 *  - `@call` props run catalog functions; a value read *inside* a function
 *    implementation re-resolves the prop when it changes;
 *  - a function with no implementation is routed to the agent
 *    (`callAgentFunction`), and the prop updates when the
 *    `agentFunctionResponse` arrives;
 *  - `@checks`: a failing check disables a Button and shows its message;
 *    TextField shows a check's message once typed into;
 *  - `@accessibility` becomes Lynx accessibility attributes;
 *  - `@@` escapes a literal `@` key; unknown directives resolve to null and
 *    are reported;
 *  - TextField input writes back through its `@path` binding;
 *  - templated children (`{ path, componentId }`) expand per data item;
 *  - pre-1.0 messages are rejected with UNSUPPORTED_VERSION;
 *  - a surface whose catalogId isn't registered renders notices;
 *  - `[messageStore]="null"` renders nothing; a new store starts fresh.
 *
 * Run with: `npm run verify:genui-a2ui`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { basicFunctions } from '@lynx-js/genui/a2ui/functions';
import type { MessageStore, UserActionPayload } from '@lynx-js/genui/a2ui/store';
import { createMessageStore } from '@lynx-js/genui/a2ui/store';
import { bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import {
  A2UI_BASIC_CATALOG,
  A2UI_DEFAULT_CATALOG_ID,
  A2uiSurface,
  defineA2uiCatalog,
  serializeA2uiCatalog,
  type A2uiFunctionEntry,
  type A2uiOutgoingMessage,
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
  type MockEl,
} from './mock-papi.js';

const V = '1.0' as const;
const CATALOG = A2UI_DEFAULT_CATALOG_ID;

const actions: UserActionPayload[] = [];
const outgoing: A2uiOutgoingMessage[] = [];
const sent = (key: string): Record<string, unknown>[] =>
  outgoing.map((o) => o.message).filter((m) => key in m);

/** Reads `/tax/rate` itself, not through its args. */
const withTax: A2uiFunctionEntry = {
  kind: 'function',
  name: 'withTax',
  impl: (args, context) => {
    const rate = Number(context.resolveDynamicValue({ '@path': '/tax/rate' }) ?? 0);
    return `${Number(args['amount']) * (1 + rate)}`;
  },
};

/** No implementation: the agent computes it. */
const lookupStock: A2uiFunctionEntry = {
  kind: 'function',
  name: 'lookupStock',
  definition: {
    name: 'lookupStock',
    description: 'Units in stock for a SKU.',
    parameters: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] },
    returnType: 'string',
  },
};

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [A2uiSurface],
  template: `
    <view class="app">
      <a2ui-surface
        [messageStore]="store()"
        [catalog]="catalog"
        [messageHandler]="handler"
        (action)="onAction($event)"
      />
      <text class="status">actions:{{ count() }}</text>
    </view>
  `,
})
export class TestComponent {
  readonly store = signal<MessageStore | null>(createMessageStore());
  readonly catalog = defineA2uiCatalog([
    ...A2UI_BASIC_CATALOG,
    ...(basicFunctions as never[]),
    withTax,
    lookupStock,
  ]);
  readonly count = signal(0);
  readonly handler = (message: A2uiOutgoingMessage): void => {
    outgoing.push(message);
  };

  onAction(action: UserActionPayload): void {
    actions.push(action);
    this.count.update((n) => n + 1);
  }
}

/** The element whose subtree has a text node containing `text`. */
function findTextElement(el: MockEl, text: string): MockEl | undefined {
  if (el.type === 'text' && el.children.some((c) => c.text?.includes(text))) return el;
  if (el.type === 'text' && el.text?.includes(text)) return el;
  for (const c of el.children) {
    const found = findTextElement(c, text);
    if (found) return found;
  }
  return undefined;
}

function tapSign(el: MockEl | undefined): string | undefined {
  return el?.events?.['tap']?.sign as string | undefined;
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>)['renderPage']({});
  let app!: TestComponent;
  const ref = await bootstrapLynxApplication(TestComponent);
  app = ref.components[0]!.instance as TestComponent;
  await tick();
  const push = (messages: unknown[]): void => app.store()!.push(messages as never[]);

  console.log('\n=== createSurface + updateComponents + updateDataModel render ===');
  push([
    { version: V, createSurface: { surfaceId: 's1', catalogId: CATALOG } },
    {
      version: V,
      updateComponents: {
        surfaceId: 's1',
        components: [
          { id: 'root', component: 'Column', children: ['title', 'row1', 'buy', 'name-field', 'greet'] },
          { id: 'title', component: 'Text', text: { '@path': '/product/title' }, variant: 'headline' },
          { id: 'row1', component: 'Row', children: ['price', 'badge'] },
          { id: 'price', component: 'Text', text: { '@path': '/product/price' } },
          { id: 'badge', component: 'Text', text: 'NEW' },
          { id: 'buy-label', component: 'Text', text: 'Buy now' },
          {
            id: 'buy',
            component: 'Button',
            child: 'buy-label',
            action: {
              event: {
                name: 'buy',
                context: {
                  sku: { '@path': '/product/sku' },
                  summary: {
                    '@call': 'formatString',
                    args: { value: '${/product/title} for ${/product/price}' },
                  },
                },
              },
            },
          },
          { id: 'name-field', component: 'TextField', label: 'Your name', value: { '@path': '/form/name' } },
          { id: 'greet', component: 'Text', text: { '@path': '/form/name' } },
        ],
      },
    },
    {
      version: V,
      updateDataModel: {
        surfaceId: 's1',
        path: '/',
        value: { product: { title: 'Lynx Deck', price: '$49', sku: 'LX-1' }, form: { name: 'Ada' } },
      },
    },
  ]);
  await tick();
  const page = getPage();
  assert(!!findText(page, 'Lynx Deck'), 'bound title text rendered');
  assert(!!findText(page, '$49'), 'bound price rendered inside a Row');
  assert(!!findText(page, 'NEW'), 'literal text rendered');
  assert(!!findText(page, 'Buy now'), 'button child rendered');
  assert(!!findText(page, 'Ada'), 'text bound to the form path rendered');
  assert(!!findByClass(page, 'button-primary'), 'button uses upstream class names');
  assert(sent('error').length === 0, 'no protocol errors so far');

  console.log('\n=== data-model update re-renders bound props ===');
  push([{ version: V, updateDataModel: { surfaceId: 's1', path: '/product/title', value: 'Lynx Deck Pro' } }]);
  await tick();
  assert(!!findText(page, 'Lynx Deck Pro'), 'title updated when only the data model changed');

  console.log('\n=== in-place component replacement re-renders ===');
  push([
    {
      version: V,
      updateComponents: {
        surfaceId: 's1',
        components: [{ id: 'badge', component: 'Text', text: 'SALE', emphasis: 'strong' }],
      },
    },
  ]);
  await tick();
  assert(!!findText(page, 'SALE'), 'replaced component re-rendered via its resource');
  assert(!findText(page, 'NEW'), 'old component content gone');

  console.log('\n=== tap sends a v1.0 action message ===');
  const buySign = tapSign(findByClass(page, 'button'));
  assert(!!buySign, 'button view has a (tap) listener');
  publishEvent(buySign!, { type: 'tap' });
  await tick();
  await tick();
  assert(actions.length === 1, 'one action emitted on the (action) output');
  assert(actions[0]!.name === 'buy', 'action name from the event');
  assert(actions[0]!.sourceComponentId === 'buy', 'source component id recorded');
  assert(actions[0]!.context['sku'] === 'LX-1', '@path in the action context resolved at dispatch');
  assert(
    actions[0]!.context['summary'] === 'Lynx Deck Pro for $49',
    '@call in the action context resolved (formatString interpolation)',
  );
  const actionMessages = sent('action');
  assert(actionMessages.length === 1, 'messageHandler received the action message');
  assert(actionMessages[0]!['version'] === '1.0', 'the outgoing message is versioned 1.0');
  assert(!!findText(page, 'actions:1'), 'host component saw the output');

  console.log('\n=== TextField writes back through its @path binding ===');
  const fieldControl = findByClass(page, 'textfield-control');
  const inputSign = fieldControl?.events?.['input']?.sign as string | undefined;
  assert(!!inputSign, 'textfield control has an (input) listener');
  publishEvent(inputSign!, { detail: { value: 'Grace' } });
  await tick();
  assert(!!findText(page, 'Grace'), 'text bound to the same path updated after input');

  console.log('\n=== @call props, function internals, agent functions ===');
  push([
    {
      version: V,
      updateComponents: {
        surfaceId: 's1',
        components: [
          { id: 'root', component: 'Column', children: ['total', 'stock', 'escaped', 'broken', 'a11y'] },
          { id: 'total', component: 'Text', text: { '@call': 'withTax', args: { amount: { '@path': '/cart/amount' } } } },
          { id: 'stock', component: 'Text', text: { '@call': 'lookupStock', args: { sku: { '@path': '/product/sku' } } } },
          { id: 'escaped', component: 'PieChart', title: 'Escapes', data: [{ name: 'at', '@@value': 1, value: 2 }] },
          { id: 'broken', component: 'Text', text: { '@bogus': 1 } },
          {
            id: 'a11y',
            component: 'Text',
            text: 'Described',
            '@accessibility': { label: 'Total', description: { '@path': '/a11y/hint' } },
          },
        ],
      },
    },
    {
      version: V,
      updateDataModel: { surfaceId: 's1', path: '/', value: { product: { sku: 'LX-1' }, cart: { amount: 100 }, tax: { rate: 0.5 }, a11y: { hint: 'incl. tax' } } },
    },
  ]);
  await tick();
  assert(!!findText(page, '150'), '@call prop ran the catalog function');
  push([{ version: V, updateDataModel: { surfaceId: 's1', path: '/tax/rate', value: 0.25 } }]);
  await tick();
  assert(!!findText(page, '125'), 'a value read inside the function re-resolved the prop');

  const calls = sent('callAgentFunction');
  assert(calls.length === 1, 'a function without an impl is routed to the agent');
  const call = calls[0]!['callAgentFunction'] as {
    functionCallId: string;
    callFunction: { '@call': string; args: Record<string, unknown> };
  };
  assert(call.callFunction['@call'] === 'lookupStock', 'the call names the function');
  assert(call.callFunction.args['sku'] === 'LX-1', 'its args are resolved');
  push([{ version: V, agentFunctionResponse: { functionCallId: call.functionCallId, value: '7 in stock' } }]);
  await tick();
  await tick();
  assert(!!findText(page, '7 in stock'), 'the prop updated when the agent responded');

  assert(!!findText(page, 'at: 2'), '`@@value` stays a literal key, next to `value`');
  const errors = sent('error').map((m) => m['error'] as { code: string; message: string });
  assert(
    errors.some((e) => e.message.includes('Unknown dynamic directive')),
    'an unknown directive is reported to the agent',
  );

  const described = findTextElement(page, 'Described');
  assert(
    described?.attrs['accessibility-label'] === 'Total. incl. tax',
    '@accessibility label and resolved description become accessibility-label',
  );
  assert(described?.attrs['accessibility-element'] === true, 'and mark it an accessibility element');

  console.log('\n=== @checks: Button disabled with a message, TextField message ===');
  push([
    {
      version: V,
      updateComponents: {
        surfaceId: 's1',
        components: [
          { id: 'root', component: 'Column', children: ['email', 'send'] },
          {
            id: 'email',
            component: 'TextField',
            label: 'Email',
            value: { '@path': '/form/email' },
            '@checks': [{ condition: { '@call': 'email', args: { value: { '@path': '/form/email' } } }, message: 'Enter an email' }],
          },
          { id: 'send-label', component: 'Text', text: 'Send' },
          {
            id: 'send',
            component: 'Button',
            child: 'send-label',
            action: { event: { name: 'send' } },
            '@checks': [{ condition: { '@call': 'required', args: { value: { '@path': '/form/email' } } }, message: 'Email is required' }],
          },
        ],
      },
    },
    { version: V, updateDataModel: { surfaceId: 's1', path: '/form/email', value: '' } },
  ]);
  await tick();
  assert(!!findText(page, 'Email is required'), 'a failing check shows its message under the Button');
  assert(!!findByClass(page, 'button-invalid'), 'and marks the Button invalid');
  publishEvent(tapSign(findByClass(page, 'button'))!, { type: 'tap' });
  await tick();
  assert(sent('action').length === 1, 'a Button with failing checks sends nothing');

  const emailSign = findByClass(page, 'textfield-control')?.events?.['input']?.sign as string;
  publishEvent(emailSign, { detail: { value: 'not-an-email' } });
  await tick();
  assert(!!findText(page, 'Enter an email'), 'TextField shows its check message once typed into');
  assert(!findText(page, 'Email is required'), 'the Button check passes once there is a value');

  publishEvent(emailSign, { detail: { value: 'ada@example.com' } });
  await tick();
  assert(!findText(page, 'Enter an email'), 'the TextField message clears when the check passes');
  publishEvent(tapSign(findByClass(page, 'button'))!, { type: 'tap' });
  await tick();
  await tick();
  assert(sent('action').length === 2, 'the Button sends once its checks pass');

  console.log('\n=== templated children expand per data item ===');
  push([
    {
      version: V,
      updateComponents: {
        surfaceId: 's1',
        components: [
          { id: 'root', component: 'Column', children: ['items'] },
          { id: 'items', component: 'Column', children: { path: '/todos', componentId: 'todo-tpl' } },
          { id: 'todo-tpl', component: 'Text', text: { '@path': 'label' } },
        ],
      },
    },
    {
      version: V,
      updateDataModel: { surfaceId: 's1', path: '/todos', value: [{ label: 'Write docs' }, { label: 'Ship genui' }] },
    },
  ]);
  await tick();
  assert(!!findText(page, 'Write docs'), 'first templated item rendered with relative binding');
  assert(!!findText(page, 'Ship genui'), 'second templated item rendered');
  push([{ version: V, updateDataModel: { surfaceId: 's1', path: '/todos/0', value: null } }]);
  await tick();
  assert(!findText(page, 'Write docs'), 'a null value deletes the item');
  assert(!!findText(page, 'Ship genui'), 'and the rest stays');

  console.log('\n=== the rest of the basic catalog ===');
  push([
    {
      version: V,
      updateComponents: {
        surfaceId: 's1',
        components: [
          {
            id: 'root',
            component: 'Column',
            children: ['icon', 'radios', 'picker', 'modal', 'tabs', 'when', 'line', 'pie'],
          },
          { id: 'icon', component: 'Icon', name: 'arrow_back' },
          { id: 'radios', component: 'RadioGroup', items: ['a', 'b', 'c'], value: { '@path': '/pick' } },
          {
            id: 'picker',
            component: 'ChoicePicker',
            variant: 'multipleSelection',
            options: [{ label: 'Red', value: 'red' }, { label: 'Blue', value: 'blue' }],
            value: { '@path': '/colors' },
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
    { version: V, updateDataModel: { surfaceId: 's1', path: '/pick', value: 'a' } },
    { version: V, updateDataModel: { surfaceId: 's1', path: '/colors', value: [] } },
  ]);
  await tick();
  assert(!!findText(page, 'arrow_back'), 'Icon renders the Material ligature name');

  const radioOptions = findAllByClass(page, 'radio-option');
  assert(radioOptions.length === 3, 'RadioGroup rendered all 3 items');
  assert(findAllByClass(page, 'radio-dot-selected').length === 1, 'RadioGroup shows exactly one selected dot ("a")');
  publishEvent(tapSign(radioOptions[1])!, { type: 'tap' });
  await tick();
  assert(findAllByClass(page, 'radio-option').length === 3, 'RadioGroup still renders all 3 items after selection');
  assert(findAllByClass(page, 'radio-dot-selected').length === 1, 'RadioGroup setValue moved the selected dot to "b"');

  const pickerOptions = findAllByClass(page, 'choice-picker-option');
  assert(pickerOptions.length === 2, 'ChoicePicker rendered both options');
  publishEvent(tapSign(pickerOptions[0])!, { type: 'tap' });
  await tick();
  assert(!!findText(page, '✓'), 'ChoicePicker shows a checkmark once an option is selected');

  assert(!findText(page, 'Modal body'), 'Modal content is not rendered before the trigger is tapped');
  const modalTapSign = tapSign(findByClass(page, 'modal-trigger'));
  assert(!!modalTapSign, 'Modal trigger has a (tap) listener');
  publishEvent(modalTapSign!, { type: 'tap' });
  await tick();
  assert(!!findText(page, 'Modal body'), 'Modal content renders after the trigger is tapped');

  assert(!!findText(page, 'Tab one content'), 'Tabs renders the first tab by default');
  assert(!findText(page, 'Tab two content'), 'Tabs does not render the inactive tab');
  publishEvent(tapSign(findAllByClass(page, 'tabs-header')[1])!, { type: 'tap' });
  await tick();
  assert(!!findText(page, 'Tab two content'), 'Tabs switches content after tapping the second header');

  assert(!!findText(page, '2024-03-01'), 'DateTimeInput shows the formatted current value');
  publishEvent(tapSign(findByClass(page, 'datetime-input-control'))!, { type: 'tap' });
  await tick();
  assert(!!findByClass(page, 'datetime-calendar'), 'DateTimeInput opens a calendar dialog on tap');

  const lineSvg = findByType(page, 'svg');
  assert(!!lineSvg && typeof lineSvg.attrs['content'] === 'string' && (lineSvg.attrs['content'] as string).includes('<path'), 'LineChart renders SVG path markup');
  assert(!!findText(page, 'Visits'), 'LineChart legend renders the series name');
  assert(!!findText(page, 'A: 3'), 'PieChart legend renders a slice value');

  console.log('\n=== unknown components fail soft ===');
  push([
    {
      version: V,
      updateComponents: {
        surfaceId: 's1',
        components: [{ id: 'root', component: 'Column', children: ['mystery'] }, {
          id: 'mystery',
          component: 'BarChart',
          title: 'Not in the catalog',
        }],
      },
    },
  ]);
  await tick();
  assert(!!findText(page, 'Unsupported component'), 'unknown tag renders the fail-soft notice');

  console.log('\n=== pre-1.0 messages are rejected ===');
  const errorsBefore = sent('error').length;
  push([{ updateDataModel: { surfaceId: 's1', path: '/product/title', value: 'v0.9 write' } }]);
  await tick();
  const versionErrors = sent('error').slice(errorsBefore).map((m) => m['error'] as { code: string });
  assert(versionErrors.some((e) => e.code === 'UNSUPPORTED_VERSION'), 'a versionless message gets UNSUPPORTED_VERSION');

  console.log('\n=== a null store renders nothing; a new store starts fresh ===');
  app.store.set(null);
  await tick();
  assert(!findText(page, 'Unsupported component'), 'the surface is gone with a null store');
  const fresh = createMessageStore();
  app.store.set(fresh);
  await tick();
  fresh.push([
    {
      version: V,
      createSurface: {
        surfaceId: 's1',
        catalogId: CATALOG,
        components: [{ id: 'root', component: 'Text', text: { '@path': '/hello' } }],
        dataModel: { hello: 'Fresh session' },
      },
    },
  ] as never[]);
  await tick();
  assert(!!findText(page, 'Fresh session'), 'the same surface id renders again in a new session (inline createSurface)');

  console.log('\n=== a surface naming an unregistered catalog renders notices ===');
  const other = createMessageStore();
  app.store.set(other);
  await tick();
  other.push([
    {
      version: V,
      createSurface: {
        surfaceId: 'x',
        catalogId: 'https://example.com/other-catalog.json',
        components: [{ id: 'root', component: 'Text', text: 'Wrong catalog' }],
      },
    },
  ] as never[]);
  await tick();
  assert(!findText(page, 'Wrong catalog'), 'nothing renders from a catalog that is not registered');
  assert(!!findText(page, 'Unsupported component'), 'a notice shows instead');

  console.log('\n=== serializeA2uiCatalog ===');
  const serialized = serializeA2uiCatalog(defineA2uiCatalog([
    { name: 'Badge', component: TestComponent, schema: { properties: { text: { $ref: 'common_types.json#/$defs/DynamicString' } } } },
    lookupStock,
  ]));
  assert(serialized.protocolVersion === '1.0' && serialized.catalogId === CATALOG, 'serialized as a 1.0 catalog under the default id');
  assert((serialized.components['Badge']!['required'] as string[]).includes('component'), 'components require `component`');
  assert(!!serialized.functions?.['lookupStock'], 'function definitions are announced');
  let threw = false;
  try {
    serializeA2uiCatalog(defineA2uiCatalog(A2UI_BASIC_CATALOG));
  } catch {
    threw = true;
  }
  assert(threw, 'a component without a schema cannot be serialized');

  console.log('\n✅ Angular A2UI renderer assertions passed.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Angular A2UI renderer verification failed:\n', err);
  process.exit(1);
});
