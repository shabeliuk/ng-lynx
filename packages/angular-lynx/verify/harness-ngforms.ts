/**
 * Headless verification of the `@angular/forms` integration (LynxValueAccessor).
 *
 * Exercises BOTH template-driven (`[(ngModel)]`) and reactive (`[formControl]`
 * with a validator) bindings against Lynx `<input>`, simulating Lynx `input`
 * events (`event.detail.value`). Proves:
 *   - the model updates from input and writes back to the element `value`,
 *   - reactive validators react,
 *   - the still-instantiated DOM `DefaultValueAccessor` coexists without throwing
 *     (it reads the enriched `event.target`, our accessor reads `detail.value`).
 *
 * Run with: `npm run verify:ngforms`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

import { bootstrapLynxApplication, publishEvent } from 'angular-lynx';
import { LynxValueAccessor } from 'angular-lynx/forms';
import 'angular-lynx/main-thread';

import {
  assert,
  findByClass,
  findText,
  getPage,
  installMockPapi,
  type MockEl,
  tick,
} from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, LynxValueAccessor],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      <input class="ng-name" [(ngModel)]="name" />
      <text class="ng-greet">{{ name ? 'Hi ' + name : 'Anonymous' }}</text>

      <input class="rx-email" [formControl]="email" />
      <text class="rx-status">{{ email.valid ? 'good' : 'bad' }}</text>
    </view>
  `,
})
export class TestComponent {
  name = '';
  readonly email = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email],
  });
}

/** Simulate the user typing `text` into the `.cls` field via a Lynx input event. */
async function type(cls: string, text: string): Promise<MockEl> {
  const field = findByClass(getPage(), cls);
  if (!field) throw new Error(`no field .${cls}`);
  const sign = field.events['input']?.sign;
  if (!sign) throw new Error(`field .${cls} has no (input) listener`);
  publishEvent(sign, { detail: { value: text } });
  await tick();
  await tick();
  return field;
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent);
  await tick();
  await tick();
  const cmp = (app.components[0]?.instance ?? null) as TestComponent | null;
  const page = getPage();

  console.log('\n=== Assertions: initial state ===');
  assert(!!findByClass(page, 'ng-name'), 'ngModel <input> rendered');
  assert(findText(page, 'Anonymous') != null, 'ngModel initial (empty model)');
  assert(findText(page, 'bad') != null, 'reactive control initially invalid (required)');

  console.log('\n=== Template-driven: type into [(ngModel)] ===');
  await type('ng-name', 'Ada');
  assert(cmp?.name === 'Ada', 'ngModel updated the component field from input');
  assert(findText(page, 'Hi Ada') != null, 'interpolation reacted to ngModel change');
  // Note: after user input Angular does NOT call writeValue back (the native
  // input already shows the text) — writeValue reflection is asserted via the
  // programmatic setValue case below.

  console.log('\n=== Reactive: type into [formControl] with Validators.email ===');
  await type('rx-email', 'not-an-email');
  assert(cmp?.email.value === 'not-an-email', 'formControl value updated from input');
  assert(findText(page, 'bad') != null, 'email validator rejects bad input');

  await type('rx-email', 'ada@lynx.dev');
  assert(cmp?.email.value === 'ada@lynx.dev', 'formControl value updated again');
  assert(findText(page, 'good') != null, 'email validator accepts a valid address');

  console.log('\n=== Model → element: programmatic setValue reflects to value ===');
  cmp?.email.setValue('grace@lynx.dev');
  await tick();
  await tick();
  const emailEl = findByClass(page, 'rx-email');
  assert(emailEl?.attrs['value'] === 'grace@lynx.dev', 'writeValue reflected setValue to the element');

  console.log('\n✅ All ngForms assertions passed — ngModel + reactive forms work end-to-end.\n');
}

main().catch((err) => {
  console.error('\n❌ ngForms verification failed:\n', err);
  process.exit(1);
});
