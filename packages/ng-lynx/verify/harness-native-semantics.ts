/**
 * Headless verification of the places the renderer has to speak the native
 * engine's language rather than the DOM's. Each of these worked in the web
 * preview, or passed against a looser mock, and did nothing on a device:
 *
 *  - event registration types: the engine dispatches on the exact strings
 *    `capture-bind`, `capture-catch` and `global-bindEvent`;
 *  - `data-*` reaches `event.target.dataset` only through `__AddDataset`;
 *  - `style="…"` and `[style.x]` share one inline-style slot per element;
 *  - a bound `[id]` must be remembered, or `@defer (on viewport)` replaces it;
 *  - native text fields have no `value` attribute, so `[value]` and
 *    `[formControl]` have to go through the `setValue` UI method;
 *  - documented tags reach the engine instead of becoming `<view>`.
 *
 * Run with: `npm run verify:native-semantics`.
 */
import '@angular/compiler';

import { Component, ElementRef, NO_ERRORS_SCHEMA, signal, ViewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { asLynxElement, bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import { LynxValueAccessor } from 'ng-lynx/forms';
import 'ng-lynx/main-thread';

import { assert, findByClass, getPage, installMockPapi, tick } from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ReactiveFormsModule, LynxValueAccessor],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="capture" (capture-bindtap)="noop()" (capture-catchtouchstart)="noop()"></view>
    <view class="global" (global-bindtap)="noop()"></view>

    <view class="dataset" data-static="a" [attr.data-bound]="bound()"></view>

    <view class="style-mix" style="color: red; margin: 1px;" [style.opacity]="opacity()"></view>
    <view class="style-override" style="color: red" [style.color]="color()"></view>
    <view class="style-only" style="color: blue"></view>

    <view #idTarget class="bound-id" [id]="boundId()"></view>
    <view [className]="'one two'"></view>

    <markdown class="markdown" content="# hi"></markdown>
    <inline-truncation class="truncation"></inline-truncation>
    <my-card class="component-host"></my-card>

    <input class="value-field" [value]="text()" (input)="text.set($event.detail.value)" />
    <input class="control-field" [formControl]="control" />
  `,
})
class TestComponent {
  readonly bound = signal<string | null>('b');
  readonly opacity = signal('0.5');
  readonly color = signal<string | null>('green');
  readonly boundId = signal('my-id');
  readonly text = signal('prefilled');
  readonly control = new FormControl('from-model', { nonNullable: true });
  @ViewChild('idTarget') boundRef!: ElementRef;
  noop(): void {}
}

const setValues = (): unknown[] =>
  (((globalThis as Record<string, unknown>)['__INVOKE_LOG__'] ?? []) as { method: string; params?: { value?: unknown } }[])
    .filter((call) => call.method === 'setValue')
    .map((call) => call.params?.value);

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await tick();
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as { renderPage?: (d: unknown) => void }).renderPage?.({});
  const app = await bootstrapLynxApplication(TestComponent);
  const instance = app.components[0]!.instance as TestComponent;
  await settle();
  const page = getPage();
  const el = (cls: string) => {
    const found = findByClass(page, cls);
    if (!found) throw new Error(`no element .${cls}`);
    return found;
  };

  console.log('\n=== Event registration types the engine dispatches on ===');
  assert(el('capture').events['tap']?.type === 'capture-bind', '(capture-bindtap) registers capture-bind tap');
  assert(
    el('capture').events['touchstart']?.type === 'capture-catch',
    '(capture-catchtouchstart) registers capture-catch touchstart',
  );
  assert(el('global').events['tap']?.type === 'global-bindEvent', '(global-bindtap) registers global-bindEvent tap');

  console.log('\n=== data-* goes to the dataset model ===');
  assert(el('dataset').dataset?.['static'] === 'a', 'a static data-* reaches __AddDataset');
  assert(el('dataset').dataset?.['bound'] === 'b', 'a bound data-* reaches __AddDataset');
  assert(el('dataset').attrs['data-static'] === undefined, 'data-* is not set as a plain attribute');
  instance.bound.set(null);
  await settle();
  assert(el('dataset').dataset?.['bound'] === undefined, 'removing a bound data-* clears it');

  console.log('\n=== The style attribute survives [style.x] ===');
  assert(el('style-mix').style === 'color: red; margin: 1px; opacity: 0.5', 'static declarations and the binding merge');
  assert(el('style-override').style === 'color: red; color: green', 'a binding comes after the static value, so it wins');
  assert(el('style-only').style === 'color: blue', 'a lone style attribute still applies');
  instance.opacity.set('1');
  await settle();
  assert(el('style-mix').style === 'color: red; margin: 1px; opacity: 1', 'an update keeps the static declarations');

  console.log('\n=== A bound [id] is remembered ===');
  assert(el('bound-id').attrs['id'] === 'my-id', '[id] reaches __SetID');
  const selector = await asLynxElement(instance.boundRef.nativeElement).idSelector();
  await settle();
  assert(selector === '#my-id', 'idSelector() reuses the app\'s id');
  assert(el('bound-id').attrs['id'] === 'my-id', 'the observer path doesn\'t overwrite it');

  console.log('\n=== [className] behaves like [class] ===');
  assert(el('one').classes === 'one two', '[className] reaches __SetClasses');
  assert(el('one').attrs['className'] === undefined, 'className is not set as an attribute');

  console.log('\n=== Documented tags reach the engine ===');
  assert(el('markdown').type === 'markdown', '<markdown> is created as itself');
  assert(el('truncation').type === 'inline-truncation', '<inline-truncation> is created as itself');
  assert(el('component-host').type === 'view', 'an unknown tag (a component host) is still a view');

  console.log('\n=== Native text fields get their value through setValue ===');
  assert(setValues().includes('prefilled'), 'a [value] binding calls setValue');
  assert(setValues().includes('from-model'), 'a [formControl] initial value calls setValue');

  const typed = el('value-field').events['input']?.sign as string;
  publishEvent(typed, { detail: { value: 'typed' } });
  await settle();
  assert(instance.text() === 'typed', 'typing updates the model');
  assert(!setValues().includes('typed'), 'the echo of typing is not written back');

  instance.text.set('from-code');
  await settle();
  assert(setValues().includes('from-code'), 'a programmatic [value] change calls setValue');

  instance.control.setValue('patched');
  await settle();
  assert(setValues().includes('patched'), 'FormControl.setValue() calls setValue');
  instance.control.reset();
  await settle();
  assert(setValues().filter((v) => v === 'from-model').length === 2, 'FormControl.reset() calls setValue');

  console.log('\n✅ All native-semantics assertions passed.\n');
  app.destroy();
}

main().catch((err) => {
  console.error('\n❌ Native-semantics verification failed:\n', err);
  process.exit(1);
});
