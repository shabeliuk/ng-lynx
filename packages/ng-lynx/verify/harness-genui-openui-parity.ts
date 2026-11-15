/**
 * Prompt ↔ renderer parity for the Angular OpenUI library.
 *
 * OpenUI props are **positional**: a model that writes
 * `TextField("Age", "", "number", null, null, "$age")` gets its arguments
 * mapped onto props in *schema field order*. The model learns that order from
 * the system prompt, which a real deployment builds with upstream's
 * `buildOpenUiSystemPrompt` (`@lynx-js/genui/openui/prompt`). If the Angular
 * library's schemas disagree with the prompt library's, a perfectly valid
 * response for one side lands in the wrong props on the other — `"number"`
 * becomes the field's `name`, the input binds to nothing, and nothing errors.
 *
 * That's not hypothetical: this harness was written because the Angular port
 * (made against genui 0.0.6) had drifted from genui 0.4.0 on TextField,
 * Row, Column, Button, Stack's gap scale and more, and was missing `Slider`
 * entirely — found while wiring the retirement-planner example to a real LLM.
 *
 * The check compares lang-core's own generated signature line for every
 * component (`library.toSpec().components[name].signature`) — the exact text
 * the model reads — so it covers names, order, optionality and enum values in
 * one string comparison, and any future upstream change fails here first.
 * Then it compares the whole generated prompt (component order, groups,
 * descriptions, builtins such as genui 0.7's `@Append`), with and without
 * prompt options and for a `componentNames` subset. Upgrading to genui 0.7.2
 * passed the signature check except for the new `Canvas`, while order,
 * groups and the `List` description had drifted unnoticed.
 *
 * Run with: `npm run verify:genui-openui-parity`.
 */
import '@angular/compiler';

import { createOpenUiPromptLibrary } from '@lynx-js/genui/openui/prompt';
import { createOpenUiLibrary } from 'ng-lynx/genui';

import { assert } from './mock-papi.js';

const upstream = createOpenUiPromptLibrary().toSpec().components;
const angular = createOpenUiLibrary().toSpec().components;

const drift: string[] = [];
for (const [name, spec] of Object.entries(upstream)) {
  const ours = angular[name];
  if (!ours) {
    drift.push(`missing: ${name}\n    upstream: ${spec.signature}`);
    continue;
  }
  if (ours.signature !== spec.signature) {
    drift.push(`differs: ${name}\n    upstream: ${spec.signature}\n    angular:  ${ours.signature}`);
  }
}
if (drift.length > 0) {
  console.log(`\n${drift.length} component signature(s) drift from @lynx-js/genui's prompt library:\n`);
  for (const line of drift) console.log(`  ${line}\n`);
}

for (const [name, spec] of Object.entries(upstream)) {
  assert(angular[name]?.signature === spec.signature, `${name} matches the prompt signature`);
}

// Extra Angular-only components would be invisible to a model prompted from
// upstream's library — harmless, but worth knowing about if it ever happens.
const extras = Object.keys(angular).filter((name) => !(name in upstream));
assert(extras.length === 0, `no Angular-only built-ins (found: ${extras.join(', ') || 'none'})`);

assert(
  Object.keys(angular).join(',') === Object.keys(upstream).join(','),
  `components are listed in upstream's order (got ${Object.keys(angular).join(', ')})`,
);

/** Index of the first differing character, with a little context, for a readable failure. */
function firstDifference(left: string, right: string): string {
  let i = 0;
  while (i < left.length && i < right.length && left[i] === right[i]) i++;
  return `at ${i}:\n    upstream: ${JSON.stringify(left.slice(Math.max(0, i - 40), i + 80))}\n    angular:  ${JSON.stringify(right.slice(Math.max(0, i - 40), i + 80))}`;
}

const promptCases: Array<[string, Parameters<typeof createOpenUiLibrary>[0], Parameters<ReturnType<typeof createOpenUiLibrary>['prompt']>[0]]> = [
  ['default library, no prompt options', undefined, undefined],
  ['default library, bindings and tool calls', undefined, { bindings: true, toolCalls: true }],
  ['componentNames subset (root kept)', { componentNames: ['Text', 'Button', 'TextField'] }, { bindings: true }],
];
for (const [label, libraryOptions, promptOptions] of promptCases) {
  const upstreamPrompt = createOpenUiPromptLibrary(libraryOptions).prompt(promptOptions);
  const angularPrompt = createOpenUiLibrary(libraryOptions).prompt(promptOptions);
  if (upstreamPrompt !== angularPrompt) console.log(`\nprompt differs (${label}) ${firstDifference(upstreamPrompt, angularPrompt)}\n`);
  assert(upstreamPrompt === angularPrompt, `generated prompt matches upstream: ${label}`);
}
assert(
  createOpenUiLibrary().prompt({ bindings: true }).includes('@Append(array, item)'),
  'the prompt lists genui 0.7\'s @Append builtin',
);

console.log('✅ Angular OpenUI library matches the upstream prompt library.');
