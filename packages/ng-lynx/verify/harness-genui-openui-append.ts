/**
 * Headless verification of what genui 0.7 changed in OpenUI's runtime, on
 * the Angular renderer:
 *
 *  - `@Append(array, item)`: genui 0.7's system prompt teaches it, and genui
 *    registers it into lang-core only from its prompt library and its
 *    ReactLynx renderer, neither of which is in an Angular Lynx bundle. This
 *    harness doesn't import `@lynx-js/genui/openui/prompt` (whose module
 *    evaluation registers it as a side effect), so it sees what a device
 *    sees: the builtin exists only because `createOpenUiLibrary` registered
 *    it.
 *  - Action plans read state live: in
 *    `Action([@Set($items, @Append(...)), @Set($count, @Count($items))])` the
 *    second step sees the first step's write. genui 0.7.2 fixed this in
 *    `useOpenUIState`; the Angular port reads through a signal and had it
 *    already, and this pins it.
 *  - A list whose children come from `@Each($items, …)` grows on tap, and
 *    the rows already there are updated in place, not rebuilt (upstream's
 *    stable React keys, genui 0.7). Before this harness, such children
 *    didn't render at all.
 *  - `Canvas` renders upstream's non-Web fallback.
 *
 * Run with: `npm run verify:genui-openui-append`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { BUILTINS, type ParseResult } from '@openuidev/lang-core';
import { bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import { createOpenUiLibrary, OpenuiRenderer } from 'ng-lynx/genui';
import 'ng-lynx/main-thread';

import { assert, findByClass, findText, getPage, installMockPapi, tick } from './mock-papi.js';

type Page = ReturnType<typeof getPage>;

/** The element carrying `text` (`findText` returns only the string). */
function findTextElement(el: Page, text: string): Page | undefined {
  if (el.text === text) return el;
  for (const child of el.children) {
    const found = findTextElement(child, text);
    if (found) return found;
  }
  return undefined;
}

async function addItem(page: Page, text: string): Promise<void> {
  const inputSign = findByClass(page, 'OpenUITextFieldControl')?.events?.['input']?.sign as string | undefined;
  const tapSign = findByClass(page, 'OpenUIButton')?.events?.['tap']?.sign as string | undefined;
  assert(!!inputSign && !!tapSign, 'the TextField and the Add button have listeners');
  publishEvent(inputSign!, { detail: { value: text } });
  await tick();
  assert(!!findText(page, `Draft: ${text}`), `typing "${text}" updated $draft`);
  publishEvent(tapSign!, { type: 'tap' });
  await tick();
  await tick();
}

const RESPONSE = [
  '$items = ["Milk"]',
  '$draft = ""',
  '$count = 1',
  'root = Stack([list, draft, echo, add, info, canvas])',
  'list = Stack(@Each($items, "item", Card([Text(item)])))',
  'draft = TextField("Item", "", null, null, null, "$draft")',
  'echo = TextContent("Draft: " + $draft)',
  'add = Button("Add", Action([@Set($items, @Append($items, $draft)), @Set($count, @Count($items)), @Reset($draft)]))',
  'info = TextContent("Count: " + $count)',
  'canvas = Canvas("ctx.fillRect(0, 0, 10, 10)", 120, 80)',
].join('\n');

let lastParse: ParseResult | undefined;
const appendRegisteredAtStartup = 'Append' in BUILTINS;

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [OpenuiRenderer],
  template: `
    <view class="app">
      <openui-renderer [response]="response()" [library]="library" (parseResult)="onParse($event)" />
    </view>
  `,
})
export class TestComponent {
  readonly library = createOpenUiLibrary();
  readonly response = signal('');

  onParse(result: ParseResult): void {
    lastParse = result;
  }
}

async function main(): Promise<void> {
  console.log('\n=== @Append is registered by the Angular library, not by genui ===');
  assert(!appendRegisteredAtStartup, 'nothing had registered @Append before the app started');

  installMockPapi();
  (globalThis as Record<string, any>)['renderPage']({});
  const appRef = await bootstrapLynxApplication(TestComponent);
  const app = (appRef as { components: Array<{ instance: TestComponent }> }).components[0]!.instance;
  await tick();
  const page = getPage();
  assert('Append' in BUILTINS, 'createOpenUiLibrary registered @Append in lang-core');

  console.log('\n=== the response parses and renders ===');
  app.response.set(RESPONSE);
  await tick();
  assert(lastParse?.meta.errors.length === 0, `no validation errors (${JSON.stringify(lastParse?.meta.errors)})`);
  const milk = findTextElement(page, 'Milk');
  assert(!!milk, '@Each renders the seeded item through its nested template (Card > Text)');
  assert(!!findText(page, 'Count: 1'), '$count starts at its declared value');

  console.log('\n=== tap: @Append grows the list, and the next @Set reads it live ===');
  await addItem(page, 'Eggs');
  assert(!!findText(page, 'Eggs'), 'the list shows the typed item');
  assert(!!findText(page, 'Count: 2'), '@Count($items) in the second step saw the first step\'s @Append');
  assert(findTextElement(page, 'Milk') === milk, 'the existing row was updated in place, not rebuilt');
  assert(!!findText(page, 'Draft: ') && !findText(page, 'Draft: Eggs'), '@Reset cleared the draft');

  await addItem(page, 'Bread');
  assert(!!findText(page, 'Milk') && !!findText(page, 'Eggs') && !!findText(page, 'Bread'), 'a second add keeps the earlier items');
  assert(!!findText(page, 'Count: 3'), 'and the count follows (the input array is never mutated in place)');

  console.log('\n=== Canvas renders upstream\'s non-Web fallback ===');
  assert(!!findByClass(page, 'OpenUICanvas'), 'Canvas renders its OpenUICanvas container');
  assert(!!findText(page, 'Canvas is not supported on this platform.'), 'with upstream\'s fallback text');

  console.log('\n✅ Angular OpenUI genui 0.7 assertions passed.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Angular OpenUI genui 0.7 verification failed:\n', err);
  process.exit(1);
});
