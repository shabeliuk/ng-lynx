/**
 * The prompt teaches exactly what the app renders: every example in the
 * system prompt and every offline-agent screen must parse, with zero
 * validation errors, against the prompt-side library — which
 * `verify:genui-openui-parity` proves identical to the Angular one for the
 * built-ins, and `contract.ts` makes identical for the planner components.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createParser } from '@openuidev/lang-core';

import {
  buildPlannerSystemPrompt,
  createPlannerPromptLibrary,
  EXAMPLE_ASSUMPTIONS,
  EXAMPLE_QUESTIONS,
  EXAMPLE_RESULTS,
} from '../server/prompt.ts';
import { PROFILE_FIELDS } from '../src/planner/profile.ts';
import {
  aboutYouScreen,
  assumptionsScreen,
  lifestyleScreen,
  moneyScreen,
  nextScriptedScreen,
  pensionsScreen,
  resultsScreen,
} from '../src/planner/scripted.ts';

const library = createPlannerPromptLibrary();
const parser = createParser(library.toJSONSchema(), library.root);

function assertRenders(name: string, source: string): void {
  const result = parser.parse(source);
  assert.deepEqual(result.meta.errors, [], `${name}: validation errors`);
  assert.ok(result.root, `${name}: has a root`);
  assert.deepEqual(result.meta.unresolved, [], `${name}: unresolved references`);
  assert.deepEqual(result.meta.orphaned, [], `${name}: unreachable statements`);
}

describe('system prompt', () => {
  const prompt = buildPlannerSystemPrompt();

  it('teaches the planner components and the tool', () => {
    assert.match(prompt, /PlanSummary\(plan: any\)/);
    assert.match(prompt, /ProjectionChart\(plan: any, scenario\?: "pessimistic" \| "base" \| "optimistic"\)/);
    assert.match(prompt, /calculate_plan\(/);
    assert.match(prompt, /Slider\(label\?: string, min\?: number/);
  });

  it('lists every profile field by its $variable name', () => {
    for (const spec of PROFILE_FIELDS) assert.ok(prompt.includes(`- $${spec.key} (`), spec.key);
  });

  it('keeps the model off Canvas, which phones cannot draw', () => {
    assert.match(prompt, /Canvas\(code: string \| string\[\]/, 'genui 0.7 lists Canvas among the built-ins');
    assert.ok(prompt.includes('Never use Canvas'), 'the planner rule is missing');
    assert.ok(prompt.includes('Arguments are positional.'), 'upstream\'s default rules were replaced, not extended');
  });

  it('replaces the generic examples with the planner ones', () => {
    assert.ok(prompt.includes(EXAMPLE_RESULTS));
    assert.ok(!prompt.includes('Weekly Summary'), 'upstream default example still present');
  });
});

describe('everything the model is shown renders', () => {
  it('prompt examples', () => {
    assertRenders('EXAMPLE_QUESTIONS', EXAMPLE_QUESTIONS);
    assertRenders('EXAMPLE_RESULTS', EXAMPLE_RESULTS);
    assertRenders('EXAMPLE_ASSUMPTIONS', EXAMPLE_ASSUMPTIONS);
  });

  it('steers assumptions to the trusted component, not a hand-built List', () => {
    const prompt = buildPlannerSystemPrompt();
    assert.match(prompt, /PlanAssumptions\(plan: any\)/);
    assert.ok(!prompt.includes('List(@Each(plan.assumptions'), 'the old fragile pattern is still recommended');
  });
});

describe('offline agent screens render', () => {
  const profiles = {
    empty: {},
    uk: { country: 'UK', currency: 'GBP', currentAge: 41, retirementAge: 60, essentialsMonthly: 2400, savings: 85_000, contributionMonthly: 650 },
    eu: { country: 'EU', currency: 'EUR', currentAge: 52, retirementAge: 63 },
  } as const;

  for (const [name, profile] of Object.entries(profiles)) {
    it(name, () => {
      assertRenders(`${name}/aboutYou`, aboutYouScreen(profile));
      assertRenders(`${name}/lifestyle`, lifestyleScreen(profile));
      assertRenders(`${name}/money`, moneyScreen(profile));
      assertRenders(`${name}/pensions`, pensionsScreen(profile));
      assertRenders(`${name}/results`, resultsScreen(profile));
      assertRenders(`${name}/assumptions`, assumptionsScreen());
    });
  }

  it('walks the rounds in order', () => {
    assert.match(nextScriptedScreen({}), /About you/);
    assert.match(nextScriptedScreen({ country: 'UK', currentAge: 40, retirementAge: 60 }), /\$essentialsMonthly/);
    assert.match(nextScriptedScreen({ country: 'UK', currentAge: 40, retirementAge: 60, essentialsMonthly: 2000 }), /\$savings/);
    const known = { country: 'UK', currentAge: 40, retirementAge: 60, essentialsMonthly: 2000, savings: 1, contributionMonthly: 1 } as const;
    assert.match(nextScriptedScreen(known), /\$statePensionYearly/);
    assert.match(nextScriptedScreen({ ...known, statePensionYearly: 12_000 }), /PlanSummary\(plan\)/);
    assert.match(nextScriptedScreen({ ...known, statePensionYearly: 12_000 }, 'Explain the assumptions'), /PlanAssumptions\(plan\)/);
  });
});
