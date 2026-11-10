/**
 * Unit tests for the deterministic planner maths. Oracles are independent of
 * the implementation: published UK tax figures, closed-form annuity formulas,
 * and invariants (paying the recommended contribution must exactly fund the
 * plan). Run with `npm test` (Node's built-in runner, TypeScript stripped).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculatePlan,
  formatMoney,
  formatMoneyShort,
  grossWithdrawal,
  netIncome,
  type PlanInputs,
  type ReturnTable,
  ukIncomeTax,
} from '../src/planner/calc.ts';

const close = (actual: number, expected: number, tolerance = 0.5, message?: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} expected ≈${expected}, got ${actual}`);

/** A plain, tax-free, pension-free profile — every figure computable by hand. */
function simpleInputs(overrides: Partial<PlanInputs> = {}): PlanInputs {
  return {
    currency: 'GBP',
    taxRegime: 'EU',
    effectiveTaxRate: 0,
    currentAge: 40,
    retirementAge: 60,
    lifeExpectancy: 90,
    essentialsMonthly: 2_000,
    lifestyleMonthly: 0,
    travelYearly: 0,
    travelUntilAge: 80,
    goals: [],
    savings: 50_000,
    contributionMonthly: 500,
    taxFreeShare: 0,
    riskProfile: 'balanced',
    statePensionYearly: 0,
    statePensionAge: 67,
    otherPensionYearly: 0,
    otherPensionAge: 60,
    inflation: 0,
    legacy: 0,
    ...overrides,
  };
}

const flat = (before: number, after: number): ReturnTable => {
  const scenario = { pessimistic: [before, after], base: [before, after], optimistic: [before, after] } as const;
  return { cautious: scenario, balanced: scenario, adventurous: scenario };
};

describe('UK income tax (2026/27, rest of UK)', () => {
  it('matches published figures', () => {
    assert.equal(ukIncomeTax(12_570), 0);
    close(ukIncomeTax(30_000), 3_486, 0.01, '£30k:');
    close(ukIncomeTax(60_000), 11_432, 0.01, '£60k:');
    close(ukIncomeTax(100_000), 27_432, 0.01, '£100k:');
    // Personal allowance fully tapered away at £125,140.
    close(ukIncomeTax(125_140), 42_516, 0.01, '£125,140:');
    close(ukIncomeTax(130_000), 44_703, 0.01, '£130k:');
  });

  it('never reaches a 100% marginal rate (so the gross-up is well defined)', () => {
    for (let income = 0; income < 200_000; income += 997) {
      assert.ok(ukIncomeTax(income + 100) - ukIncomeTax(income) < 100);
    }
  });
});

describe('gross-up of withdrawals', () => {
  it('finds the withdrawal whose net equals the need (UK, all in pensions)', () => {
    const inputs = simpleInputs({ taxRegime: 'UK' });
    const gross = grossWithdrawal(inputs, 0, 30_000);
    close(netIncome(inputs, 0, gross), 30_000, 0.01);
    // 25% tax-free: taxable part is 0.75·gross, so gross > need but < need/0.8.
    assert.ok(gross > 30_000 && gross < 30_000 / 0.8);
  });

  it('is zero when guaranteed income already covers the need', () => {
    const inputs = simpleInputs({ taxRegime: 'UK' });
    assert.equal(grossWithdrawal(inputs, 12_547.6, 10_000), 0);
  });

  it('ISA money is untaxed', () => {
    const inputs = simpleInputs({ taxRegime: 'UK', taxFreeShare: 1 });
    close(grossWithdrawal(inputs, 20_000, 40_000), 40_000 - (20_000 - ukIncomeTax(20_000)), 0.01);
  });

  it('EU flat rate grosses up exactly', () => {
    const inputs = simpleInputs({ effectiveTaxRate: 0.2 });
    close(grossWithdrawal(inputs, 0, 24_000), 30_000, 0.01);
  });
});

describe('required pot and contribution', () => {
  it('with zero real returns, the pot is just the sum of spending', () => {
    const plan = calculatePlan(simpleInputs(), flat(0, 0));
    close(plan.base.requiredPot, 24_000 * 30, 0.01);
    // (720,000 − 50,000) over 240 months.
    close(plan.base.requiredMonthly, 670_000 / 240, 0.01);
  });

  it('matches the closed-form annuity-due at a positive return', () => {
    const r = 0.03;
    const plan = calculatePlan(simpleInputs(), flat(0.05, r));
    const annuityDue = 24_000 * ((1 - Math.pow(1 + r, -30)) / r) * (1 + r);
    close(plan.base.requiredPot, annuityDue, 0.01);
  });

  it('paying the recommended contribution funds the plan exactly', () => {
    const inputs = simpleInputs({ taxRegime: 'UK', statePensionYearly: 12_547.6, lifestyleMonthly: 600 });
    const plan = calculatePlan(inputs);
    for (const scenario of [plan.pessimistic, plan.base, plan.optimistic]) {
      const funded = calculatePlan({ ...inputs, contributionMonthly: scenario.requiredMonthly });
      const same = funded[scenario.id];
      close(same.projectedPot, same.requiredPot, 1, `${scenario.id}:`);
      assert.equal(same.depletionAge, null, `${scenario.id}: money lasts`);
    }
  });

  it('orders the scenarios: better returns need less', () => {
    const plan = calculatePlan(simpleInputs({ inflation: 0.025 }));
    assert.ok(plan.pessimistic.requiredMonthly > plan.base.requiredMonthly);
    assert.ok(plan.base.requiredMonthly > plan.optimistic.requiredMonthly);
  });

  it('a state pension reduces what you need', () => {
    const without = calculatePlan(simpleInputs());
    const withPension = calculatePlan(simpleInputs({ statePensionYearly: 12_547.6, statePensionAge: 67 }));
    assert.ok(withPension.base.requiredPot < without.base.requiredPot);
  });

  it('a goal in retirement costs its present value', () => {
    const r = 0.03;
    const base = calculatePlan(simpleInputs(), flat(0.05, r));
    const withBoat = calculatePlan(simpleInputs({ goals: [{ label: 'Boat', amount: 30_000, age: 62 }] }), flat(0.05, r));
    close(withBoat.base.requiredPot - base.base.requiredPot, 30_000 / Math.pow(1 + r, 2), 0.01);
  });

  it('a goal before retirement comes out of the pot', () => {
    const plan = calculatePlan(simpleInputs({ goals: [{ label: 'Kitchen', amount: 20_000, age: 45 }] }), flat(0, 0));
    close(plan.base.requiredMonthly, (720_000 - 50_000 + 20_000) / 240, 0.01);
  });

  it('travel stops at travelUntilAge', () => {
    const plan = calculatePlan(simpleInputs({ travelYearly: 6_000, travelUntilAge: 75 }), flat(0, 0));
    close(plan.base.requiredPot, 24_000 * 30 + 6_000 * 15, 0.01);
  });

  it('a legacy is added at the end', () => {
    const plan = calculatePlan(simpleInputs({ legacy: 100_000 }), flat(0, 0));
    close(plan.base.requiredPot, 24_000 * 30 + 100_000, 0.01);
  });
});

describe('current-plan diagnostics', () => {
  it('reports when the money runs out', () => {
    const plan = calculatePlan(simpleInputs({ contributionMonthly: 0, savings: 240_000 }), flat(0, 0));
    // 240,000 at 24,000/year lasts 10 years: 60..69, runs out at 70.
    assert.equal(plan.base.depletionAge, 70);
    assert.equal(plan.base.onTrack, false);
  });

  it('saving more never delays the earliest retirement age', () => {
    const low = calculatePlan(simpleInputs({ contributionMonthly: 800, inflation: 0.025 }));
    const high = calculatePlan(simpleInputs({ contributionMonthly: 2_500, inflation: 0.025 }));
    assert.ok(high.base.earliestRetirementAge !== null);
    assert.ok(low.base.earliestRetirementAge === null || high.base.earliestRetirementAge! <= low.base.earliestRetirementAge);
  });

  it('the projection spans current age to the planning horizon', () => {
    const plan = calculatePlan(simpleInputs());
    assert.equal(plan.projection.ages[0], 40);
    assert.equal(plan.projection.ages.at(-1), 90);
    assert.equal(plan.projection.current.length, plan.projection.ages.length);
    assert.equal(plan.projection.recommended.length, plan.projection.ages.length);
  });

  it('rejects impossible inputs', () => {
    assert.throws(() => calculatePlan(simpleInputs({ retirementAge: 40 })), /retirementAge/);
    assert.throws(() => calculatePlan(simpleInputs({ lifeExpectancy: 55 })), /lifeExpectancy/);
  });
});

describe('money formatting (no Intl dependency)', () => {
  it('formats full and short amounts', () => {
    assert.equal(formatMoney(1_234_567.4, 'GBP'), '£1,234,567');
    assert.equal(formatMoney(-950, 'EUR'), '-€950');
    assert.equal(formatMoneyShort(1_240_000, 'GBP'), '£1.24m');
    assert.equal(formatMoneyShort(480_400, 'GBP'), '£480k');
    assert.equal(formatMoneyShort(950, 'EUR'), '€950');
  });
});
