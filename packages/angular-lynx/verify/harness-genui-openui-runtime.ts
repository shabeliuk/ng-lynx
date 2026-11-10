/**
 * Headless verification of the Angular OpenUI renderer's *runtime* mode —
 * `toolProvider` / `Query()` / `Mutation()` / `$variables` / `@Run` / `@Set`
 * / `@Reset` / `initialState` / `stateUpdate` — against the real
 * `@openuidev/lang-core` `createQueryManager` (the same framework-agnostic
 * engine `@lynx-js/genui/openui`'s runtime `OpenUiRenderer` uses). This is
 * the DSL from upstream's own README "v0.5 Runtime" example, almost
 * verbatim — confirmed independently via a scratch probe directly against
 * `createStreamingParser` + `createQueryManager` before wiring the Angular
 * side, since positional-arg quirks bite easily here (see docs/17-genui.md).
 *
 *  - a Query() resolves asynchronously: renders its `defaults` immediately,
 *    the real result once the toolProvider's promise settles;
 *  - `initialState` seeds a `$variable` before the first render (and before
 *    the first Query fetch, so the seeded value reaches the tool call);
 *  - typing into a bound TextField updates `$title` (existing `$state`
 *    wiring — unchanged by this feature);
 *  - tapping a button whose `Action([@Run(save), @Run(data), @Reset($title)])`
 *    evaluates: `@Run` on a Mutation awaits `fireMutation` (calling the
 *    toolProvider with the CURRENT `$title`), `@Run` on a Query invalidates
 *    it (triggering a real refetch), and `@Reset` restores `$title` to its
 *    parsed default;
 *  - `stateUpdate` emits the form-state snapshot after a user-driven change.
 *
 * Run with: `npm run verify:genui-openui-runtime`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import type { ActionEvent, ParseResult } from '@openuidev/lang-core';
import { bootstrapLynxApplication, publishEvent } from 'angular-lynx';
import { createOpenUiLibrary, OpenuiRenderer } from 'angular-lynx/genui';
import 'angular-lynx/main-thread';

import { assert, findByClass, findText, getPage, installMockPapi, tick } from './mock-papi.js';

const RESPONSE = [
  '$title = ""',
  'data = Query("list_items", { search: $title }, { rows: [] })',
  'save = Mutation("save_item", { title: $title })',
  'root = Stack([field, echo, btn, info])',
  'field = TextField("Title", "", null, null, null, "$title")',
  'echo = TextContent("Title: " + $title)',
  'btn = Button("Save", Action([@Run(save), @Run(data), @Reset($title)]))',
  'info = TextContent("Rows: " + @Count(data.rows))',
].join('\n');

const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const toolProvider = {
  list_items: async (args: Record<string, unknown>) => {
    toolCalls.push({ name: 'list_items', args });
    return { rows: [{ id: 1 }, { id: 2 }] };
  },
  save_item: async (args: Record<string, unknown>) => {
    toolCalls.push({ name: 'save_item', args });
    return { ok: true };
  },
};

const stateUpdates: Array<Record<string, unknown>> = [];
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
        [toolProvider]="toolProvider"
        [initialState]="initialState()"
        (action)="onAction($event)"
        (parseResult)="onParse($event)"
        (stateUpdate)="onStateUpdate($event)"
      />
    </view>
  `,
})
export class TestComponent {
  readonly library = createOpenUiLibrary();
  readonly response = signal('');
  readonly toolProvider = toolProvider;
  readonly initialState = signal<Record<string, unknown> | undefined>({ '$title': 'Preset' });

  onAction(event: ActionEvent): void {
    actions.push(event);
  }
  onParse(result: ParseResult): void {
    lastParse = result;
  }
  onStateUpdate(snapshot: Record<string, unknown>): void {
    stateUpdates.push(snapshot);
  }
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>)['renderPage']({});
  const appRef = await bootstrapLynxApplication(TestComponent);
  const app = (appRef as { components: Array<{ instance: TestComponent }> }).components[0]!.instance;
  await tick();
  const page = getPage();

  console.log('\n=== initialState seeds $title before the first render and the first Query fetch ===');
  app.response.set(RESPONSE);
  await tick();
  assert(!!findByClass(page, 'OpenUITextFieldControl'), 'TextField control rendered');
  assert(lastParse?.meta.errors.length === 0, `no validation errors reported (${JSON.stringify(lastParse?.meta.errors)})`);
  assert(!!findText(page, 'Title: Preset'), '$title was seeded from initialState before the first render');
  assert(!!findText(page, 'Rows: 0'), "Query's `defaults` render before the (async) fetch settles");

  console.log('\n=== Query resolves asynchronously via the real toolProvider ===');
  await tick();
  await tick();
  assert(toolCalls.length === 1, `exactly one tool call after the initial fetch (got ${toolCalls.length})`);
  assert(toolCalls[0]!.name === 'list_items', 'the initial tool call is list_items');
  assert(toolCalls[0]!.args['search'] === 'Preset', 'list_items was called with the seeded $title');
  assert(!!findText(page, 'Rows: 2'), 'Query result re-renders once the toolProvider promise settles');

  console.log('\n=== typing updates $title (existing $state wiring, unchanged) ===');
  const fieldControl = findByClass(page, 'OpenUITextFieldControl');
  const inputSign = fieldControl?.events?.['input']?.sign as string | undefined;
  assert(!!inputSign, 'TextField control has an (input) listener');
  publishEvent(inputSign!, { detail: { value: 'Hello' } });
  await tick();
  assert(!!findText(page, 'Title: Hello'), 'TextField input updated $title (reflected by the echo Text node)');

  console.log('\n=== @Run(mutation) awaits fireMutation with the current $title ===');
  const buttonTapSign = findByClass(page, 'OpenUIButton')?.events?.['tap']?.sign as string | undefined;
  assert(!!buttonTapSign, 'Save button has a (tap) listener');
  publishEvent(buttonTapSign!, { type: 'tap' });
  await tick();
  await tick();
  await tick();
  const saveCall = toolCalls.find((c) => c.name === 'save_item');
  assert(!!saveCall, 'save_item was called');
  assert(saveCall?.args['title'] === 'Hello', 'save_item was called with the current $title ("Hello")');

  console.log('\n=== @Run(query) invalidates and refetches; @Reset restores the default ===');
  // The query declares `$title` as a dep, so it refetches on every change to
  // it — not just the explicit @Run(data) — matching upstream's reactive
  // dep-tracking exactly: (1) the initial fetch (seeded "Preset"), (2) typing
  // "Hello" changes the dep, (3) @Run(data)'s explicit invalidate (still
  // "Hello" — @Reset hasn't run yet within the same ActionPlan step order),
  // (4) @Reset changing the dep back to "" triggers one more reactive
  // refetch. This is intentional, not a bug — a Query's whole point is to
  // stay in sync with the $variables it declares as args.
  const refetchCalls = toolCalls.filter((c) => c.name === 'list_items');
  assert(refetchCalls.length === 4, `list_items was called 4 times total (got ${refetchCalls.length}: ${JSON.stringify(refetchCalls.map((c) => c.args))})`);
  assert(refetchCalls[1]!.args['search'] === 'Hello', 'the reactive refetch after typing used the updated $title');
  assert(refetchCalls[2]!.args['search'] === 'Hello', "@Run(data)'s explicit invalidate ran before @Reset, so it still used \"Hello\"");
  assert(refetchCalls[3]!.args['search'] === '', 'the final reactive refetch (triggered by @Reset changing the dep) used the reset (empty) $title');
  assert(!findText(page, 'Title: Hello'), '$title (and the TextField, via the echo Text node) were reset after the action');
  assert(!!findText(page, 'Title: '), '$title reads back as its parsed default (empty string) after @Reset');

  console.log('\n=== actions still dispatch normally alongside Run/Set/Reset ===');
  assert(actions.length === 0, 'no ToAssistant/OpenUrl steps in this ActionPlan, so no (action) events yet');

  console.log('\n=== stateUpdate emits the form-state snapshot after a user-driven change ===');
  assert(stateUpdates.length > 0, 'stateUpdate fired at least once');
  const lastUpdate = stateUpdates[stateUpdates.length - 1]!;
  assert('$title' in lastUpdate, 'the emitted snapshot includes $title');

  console.log('\n✅ Angular OpenUI runtime-mode assertions passed.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Angular OpenUI runtime-mode verification failed:\n', err);
  process.exit(1);
});
