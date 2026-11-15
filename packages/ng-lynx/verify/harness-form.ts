/**
 * Headless verification of two-way input binding ([(lynxModel)]).
 *
 * Simulates Lynx `input` events (text in `event.detail.value`) and asserts that
 * the bound signal updates, derived computed values react, the element's `value`
 * is reflected back, and a (tap) submit reads the latest state.
 *
 * Run with: `npm run verify:form`.
 */
import '@angular/compiler';

import { bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';

import { AppComponent } from '../../../examples/lynx-forms/src/app.component.js';
import {
  assert,
  findByClass,
  findText,
  getPage,
  installMockPapi,
  type MockEl,
  tick,
} from './mock-papi.js';

/** Simulate the user typing `text` into the field with the given class. */
async function type(fieldClass: string, text: string): Promise<MockEl> {
  const field = findByClass(getPage(), fieldClass);
  if (!field) throw new Error(`no field .${fieldClass}`);
  const sign = field.events['input']?.sign;
  if (!sign) throw new Error(`field .${fieldClass} has no (input) listener`);
  publishEvent(sign, { detail: { value: text } });
  await tick();
  await tick();
  return field;
}

async function tap(btnClass: string): Promise<void> {
  const sign = findByClass(getPage(), btnClass)?.events['tap']?.sign;
  if (!sign) throw new Error(`no (tap) on .${btnClass}`);
  publishEvent(sign, { type: 'tap' });
  await tick();
  await tick();
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>).renderPage({});

  const appRef = await bootstrapLynxApplication(AppComponent);
  const app = (appRef as unknown as { components: Array<{ instance: AppComponent }> }).components[0]!.instance;
  await tick();
  await tick();

  const page = getPage();

  console.log('\n=== Assertions: initial state ===');
  assert(!!findByClass(page, 'field-name'), 'name <input> rendered');
  assert(findText(page, 'Tell us your name') != null, 'initial greeting shown (empty model)');

  console.log('\n=== Type into the name field ===');
  const nameEl = await type('field-name', 'Ada');
  assert(findText(page, 'Hi, Ada!') != null, 'computed greeting reacted to input');
  assert(nameEl.attrs['value'] === 'Ada', 'model value reflected back to the element');

  console.log('\n=== Type into the email field ===');
  await type('field-email', 'ada@lynx.dev');

  console.log('\n=== Tap submit ===');
  await tap('submit');
  assert(
    findText(page, 'Submitted Ada <ada@lynx.dev>') != null,
    'submit handler read the latest two-way-bound state',
  );

  // Editing the name to empty should flip the computed greeting back.
  console.log('\n=== Clear the name field ===');
  await type('field-name', '');
  assert(findText(page, 'Tell us your name') != null, 'greeting reverts when model cleared');

  // Native <input>/<textarea> have no `value` attribute — content is set with
  // the `setValue` UI method (runtime/src/input-value.ts). Typing must not be
  // echoed back through it (it would move the cursor); a change made in code
  // (pre-fill, clear after send) must be.
  console.log('\n=== Programmatic values reach native inputs via setValue ===');
  const setValues = () =>
    (((globalThis as Record<string, unknown>)['__INVOKE_LOG__'] ?? []) as { method: string; params?: { value?: string } }[])
      .filter((call) => call.method === 'setValue')
      .map((call) => call.params?.value);
  assert(!setValues().includes('Ada'), 'typed text is not echoed back through setValue');
  app.name.set('Grace');
  await tick();
  await tick();
  await tick();
  assert(nameEl.attrs['value'] === 'Grace', 'a programmatic change still sets the value attribute (web preview)');
  assert(setValues().includes('Grace'), 'a programmatic change calls setValue (native inputs)');

  // Android can answer the first write to a fresh input with "no node found"
  // (code 2); input-value.ts retries while the element is still in the page.
  console.log('\n=== A failed setValue is retried ===');
  const g = globalThis as Record<string, unknown>;
  const writesOf = (value: string) => setValues().filter((v) => v === value).length;
  g['__INVOKE_FAIL_NEXT__'] = 2;
  app.name.set('Hopper');
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert(writesOf('Hopper') === 3, 'two failed writes, then a third that lands');
  // A retry must not overwrite a newer value written meanwhile.
  g['__INVOKE_FAIL_NEXT__'] = 1;
  app.name.set('Lovelace');
  await tick();
  await tick();
  g['__INVOKE_FAIL_NEXT__'] = 0;
  app.name.set('Turing');
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert(writesOf('Lovelace') === 1, 'the stale write is not retried once a newer one exists');
  assert(setValues().at(-1) === 'Turing', 'the newest value is the last one written');

  console.log('\n✅ All form assertions passed — [(lynxModel)] works end-to-end.\n');
}

main().catch((err) => {
  console.error('\n❌ Form verification failed:\n', err);
  process.exit(1);
});
