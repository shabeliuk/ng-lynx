/**
 * The naming contract between the model's generated forms and the profile:
 * what a submitted form state turns into, and what gets refused.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  changedFields,
  harvestAnswers,
  mergeProfile,
  missingRequired,
  parseAmount,
  resolveInputs,
  ukStatePensionAge,
  UK_FULL_STATE_PENSION,
} from '../src/planner/profile.ts';

/** Shape `<openui-renderer>` attaches to a `continue_conversation` action. */
const form = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, componentType: 'TextField' }]));

describe('parseAmount', () => {
  it('reads the ways people type money', () => {
    assert.equal(parseAmount('£1,200'), 1200);
    assert.equal(parseAmount('60k'), 60_000);
    assert.equal(parseAmount('1.2m'), 1_200_000);
    assert.equal(parseAmount('25%'), 25);
    assert.equal(parseAmount(' €950 '), 950);
    assert.equal(parseAmount(42), 42);
    assert.equal(parseAmount('about a grand'), undefined);
    assert.equal(parseAmount(Number.NaN), undefined);
  });
});

describe('harvestAnswers', () => {
  it('keeps $<field> answers, coerced and typed', () => {
    const { updates, rejected } = harvestAnswers(
      form({ $currentAge: '41', $retirementAge: 60, $essentialsMonthly: '£2,400', $riskProfile: 'Adventurous (mostly shares)', $country: 'United Kingdom' }),
    );
    assert.deepEqual(updates, { currentAge: 41, retirementAge: 60, essentialsMonthly: 2400, riskProfile: 'adventurous', country: 'UK' });
    assert.deepEqual(rejected, []);
  });

  it('maps EU countries and currencies', () => {
    const { updates } = harvestAnswers(form({ $country: 'Portugal', $currency: '€ Euro' }));
    assert.deepEqual(updates, { country: 'EU', currency: 'EUR' });
  });

  it('rejects out-of-range and unparseable values instead of guessing', () => {
    const { updates, rejected } = harvestAnswers(form({ $currentAge: 200, $savings: 'lots' }));
    assert.deepEqual(updates, {});
    assert.deepEqual(rejected.map((r) => r.field).sort(), ['$currentAge', '$savings']);
  });

  it('assembles goals from $goal<Name>Amount/Age pairs', () => {
    const { updates, rejected } = harvestAnswers(
      form({ $goalBoatAmount: '30k', $goalBoatAge: 62, $goalKidsWeddingAmount: 15000, $goalKidsWeddingAge: '58', $goalHalfAmount: 5 }),
    );
    assert.deepEqual(updates.goals, [
      { label: 'Boat', amount: 30_000, age: 62 },
      { label: 'Kids wedding', amount: 15_000, age: 58 },
    ]);
    assert.equal(rejected[0]?.field, '$goalHalf');
  });

  it('passes unknown answers through as context, ignores blanks', () => {
    const { updates, other } = harvestAnswers(form({ $dreamPlace: 'Algarve', $savings: '', notAVar: 1 }));
    assert.deepEqual(updates, {});
    assert.deepEqual(other, { $dreamPlace: 'Algarve', notAVar: 1 });
  });

  it('unwraps a named form’s field map too', () => {
    const { updates } = harvestAnswers({ planner: { $currentAge: { value: 50 } } });
    assert.deepEqual(updates, { currentAge: 50 });
  });
});

describe('mergeProfile', () => {
  it('derives currency from country and revises goals by label', () => {
    let profile = mergeProfile({}, { country: 'EU', goals: [{ label: 'Boat', amount: 30_000, age: 62 }] });
    assert.equal(profile.currency, 'EUR');
    profile = mergeProfile(profile, { goals: [{ label: 'Boat', amount: 45_000, age: 63 }, { label: 'Car', amount: 20_000, age: 61 }] });
    assert.deepEqual(profile.goals, [
      { label: 'Boat', amount: 45_000, age: 63 },
      { label: 'Car', amount: 20_000, age: 61 },
    ]);
    profile = mergeProfile(profile, { goals: [{ label: 'Car', amount: 0, age: 61 }] });
    assert.deepEqual(profile.goals?.map((g) => g.label), ['Boat'], 'a zero amount removes a goal');
  });
});

describe('resolveInputs', () => {
  const complete = { country: 'UK', currentAge: 45, retirementAge: 62, essentialsMonthly: 2000, savings: 80_000, contributionMonthly: 600 } as const;

  it('lists what is still required', () => {
    assert.deepEqual(missingRequired({ country: 'UK', currentAge: 45 }).map((f) => f.key), ['retirementAge', 'essentialsMonthly', 'savings', 'contributionMonthly']);
    const resolved = resolveInputs({ currentAge: 45 });
    assert.equal(resolved.ok, false);
  });

  it('applies UK defaults and converts percentages', () => {
    const resolved = resolveInputs({ ...complete });
    assert.ok(resolved.ok);
    assert.equal(resolved.inputs.currency, 'GBP');
    assert.equal(resolved.inputs.statePensionYearly, UK_FULL_STATE_PENSION);
    assert.equal(resolved.inputs.statePensionAge, 68); // born 1981
    assert.equal(resolved.inputs.taxFreeShare, 0.2);
    assert.equal(resolved.inputs.inflation, 0.025);
    assert.ok(resolved.defaulted.includes('statePensionYearly'));
  });

  it('applies EU defaults', () => {
    const resolved = resolveInputs({ ...complete, country: 'EU' });
    assert.ok(resolved.ok);
    assert.equal(resolved.inputs.currency, 'EUR');
    assert.equal(resolved.inputs.statePensionYearly, 0);
    assert.equal(resolved.inputs.effectiveTaxRate, 0.2);
  });

  it('refuses inconsistent ages with a readable problem', () => {
    const resolved = resolveInputs({ ...complete, retirementAge: 40 });
    assert.equal(resolved.ok, false);
    assert.match((resolved as { problems: string[] }).problems[0]!, /after current age/);
  });

  it('derives the UK State Pension age from birth year', () => {
    assert.equal(ukStatePensionAge(70), 66);
    assert.equal(ukStatePensionAge(60), 67);
    assert.equal(ukStatePensionAge(49), 67);
    assert.equal(ukStatePensionAge(48), 68);
  });
});

describe('changedFields', () => {
  it('keeps only what differs from the profile', () => {
    const profile = { currentAge: 41, retirementAge: 60, goals: [{ label: 'Boat', amount: 30_000, age: 62 }] };
    assert.deepEqual(
      changedFields(profile, { currentAge: 41, retirementAge: 62, goals: [{ label: 'Boat', amount: 30_000, age: 62 }, { label: 'Car', amount: 9_000, age: 61 }] }),
      { retirementAge: 62, goals: [{ label: 'Car', amount: 9_000, age: 61 }] },
    );
    assert.deepEqual(changedFields(profile, { currentAge: 41 }), {});
  });
});

describe('describeProblems', () => {
  it('quotes the broken statement and the component signature', async () => {
    const { describeProblems } = await import('../src/planner/conversation.ts');
    const text = 'root = Stack([title, notes])\ntitle = Text("Assumptions", "h2")\nnotes = List([a], null, "start", "s")';
    const problems = describeProblems(
      text,
      {
        root: {},
        meta: {
          errors: [
            { message: 'field "/direction" expects one of ["vertical", "horizontal"] but got "start"', component: 'List', statementId: 'notes' },
            { message: 'field "/align" expects one of ["start", "center", "end", "stretch"] but got "s"', component: 'List', statementId: 'notes' },
          ],
          unresolved: ['a'],
        },
      },
      { List: { signature: 'List(children?: any[], items?: any[], direction?: "vertical" | "horizontal", align?: …)' } },
    );
    assert.equal(problems.length, 3);
    assert.match(problems[0]!, /^`notes = List\(\[a\], null, "start", "s"\)`: field "\/direction"/);
    assert.match(problems[0]!, /arguments are positional: List\(children\?/);
    assert.ok(!problems[1]!.includes('arguments are positional'), 'signature quoted once per component');
    assert.equal(problems[2], '"a" is referenced but never defined');
  });
});

describe('isSevereError', () => {
  it('corrects content-dropping errors, not cosmetic prop mismatches', async () => {
    const { isSevereError } = await import('../src/planner/conversation.ts');
    assert.equal(isSevereError({ message: '', code: 'type-mismatch' }), false);
    assert.equal(isSevereError({ message: '', code: 'excess-args' }), false);
    assert.equal(isSevereError({ message: '', code: 'missing-required' }), true);
    assert.equal(isSevereError({ message: '', code: 'unknown-component' }), true);
  });
});
