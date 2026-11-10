/**
 * Deterministic retirement maths — the part of the planner the LLM never does.
 *
 * The model's job is conversation: ask good questions, turn "two long trips a
 * year" into a number the user confirms, and lay out the answer. Every figure
 * the user sees comes from here, through the `calculate_plan` tool, so it is
 * reproducible and unit-tested (`npm test` in this example).
 *
 * ## Model
 *
 * Everything is in **today's money** (real terms): spending, pensions,
 * contributions and the pot are all deflated by the inflation assumption, so
 * "£3,000 a month" means £3,000 of today's purchasing power at every age.
 * Returns are converted to real with `(1 + nominal) / (1 + inflation) - 1`.
 *
 * - **Before retirement** the pot grows at the scenario's pre-retirement real
 *   return; contributions are paid monthly (end of month) and stay constant in
 *   real terms, i.e. they rise with inflation. One-off goals dated before
 *   retirement are paid out of the pot at the start of their year.
 * - **In retirement** each year needs `essentials + lifestyle` (×12), plus the
 *   travel budget until `travelUntilAge`, plus any goals dated that year — all
 *   *net of tax*. Guaranteed income (state pension, other pensions) is added
 *   from its start age, and the pot pays the rest as a **gross** withdrawal at
 *   the start of the year, grossed up for tax (see below). The pot earns the
 *   scenario's in-retirement real return, which is lower: portfolios usually
 *   de-risk at retirement.
 * - **The required pot** is the present value, at the retirement date, of
 *   every gross withdrawal from retirement to `lifeExpectancy`, plus the
 *   `legacy` left at the end. **The required monthly contribution** is the
 *   one that grows today's savings into exactly that pot. Accumulation is
 *   linear in the contribution, so it's solved in closed form, not searched.
 *
 * ## Tax
 *
 * - `UK`: income tax at the 2026/27 rest-of-UK rates (personal allowance
 *   £12,570 tapering above £100,000; 20% / 40% / 45% with the higher and
 *   additional rates starting at £50,270 and £125,140). State and other
 *   pensions are taxable income. Of each withdrawal, the `taxFreeShare` part
 *   comes from ISAs (untaxed); of the rest (pension wrappers), 25% is tax-free
 *   and 75% taxable — the UK's pension commencement rule, taken per
 *   withdrawal. The £268,275 lump-sum allowance cap is **not** modelled, and
 *   bands are held constant in today's money: they are frozen in cash terms
 *   until April 2031, so this is mildly optimistic for anyone retiring before
 *   then. Scottish rates differ.
 * - `EU`: a single effective rate the user supplies, applied to guaranteed
 *   income and to the non-tax-free part of each withdrawal. EU tax systems
 *   differ too much to model generically; one honest number beats a wrong
 *   bracket table.
 *
 * ## Scenarios
 *
 * Three return paths per risk profile ({@link RETURN_ASSUMPTIONS}), net of
 * fees, illustrative rather than forecasts. Inflation is the same across them
 * so the scenarios isolate market risk.
 */

export type ScenarioId = 'pessimistic' | 'base' | 'optimistic';
export type RiskProfile = 'cautious' | 'balanced' | 'adventurous';
export type TaxRegime = 'UK' | 'EU';
export type Currency = 'GBP' | 'EUR';

export interface Goal {
  label: string;
  /** Net cost in today's money. */
  amount: number;
  /** The age the user wants it at. */
  age: number;
}

/** Fully-resolved inputs: every default applied, every percentage a fraction. */
export interface PlanInputs {
  currency: Currency;
  taxRegime: TaxRegime;
  currentAge: number;
  retirementAge: number;
  /** Planning horizon — plan for the money to last until this age. */
  lifeExpectancy: number;
  essentialsMonthly: number;
  lifestyleMonthly: number;
  travelYearly: number;
  travelUntilAge: number;
  goals: Goal[];
  savings: number;
  contributionMonthly: number;
  /** 0..1 — share of the pot in tax-free wrappers (UK ISA). */
  taxFreeShare: number;
  riskProfile: RiskProfile;
  statePensionYearly: number;
  statePensionAge: number;
  otherPensionYearly: number;
  otherPensionAge: number;
  /** 0..1 — EU only. */
  effectiveTaxRate: number;
  /** 0..1 */
  inflation: number;
  /** Amount to leave at `lifeExpectancy`, today's money. */
  legacy: number;
}

/** Nominal annual returns, net of fees: `[before retirement, in retirement]`. */
export type ReturnTable = Record<RiskProfile, Record<ScenarioId, readonly [number, number]>>;

export const RETURN_ASSUMPTIONS: ReturnTable = {
  cautious: { pessimistic: [0.025, 0.02], base: [0.04, 0.035], optimistic: [0.055, 0.045] },
  balanced: { pessimistic: [0.03, 0.025], base: [0.05, 0.04], optimistic: [0.07, 0.055] },
  adventurous: { pessimistic: [0.035, 0.025], base: [0.06, 0.045], optimistic: [0.085, 0.06] },
};

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  pessimistic: 'Pessimistic',
  base: 'Base case',
  optimistic: 'Optimistic',
};

/** 2026/27 rest-of-UK income tax (thresholds frozen in cash terms until April 2031). */
export const UK_INCOME_TAX = {
  personalAllowance: 12_570,
  taperThreshold: 100_000,
  basicBand: 37_700, // £12,570 → £50,270
  additionalRateThreshold: 125_140,
  basicRate: 0.2,
  higherRate: 0.4,
  additionalRate: 0.45,
} as const;

/** Share of a UK pension withdrawal that is taxable (25% is tax-free). */
export const UK_PENSION_TAXABLE_SHARE = 0.75;

export interface ScenarioResult {
  id: ScenarioId;
  label: string;
  /** Nominal returns `[before, in retirement]`, as fractions. */
  nominalReturns: readonly [number, number];
  /** Pot needed on the retirement date, today's money. */
  requiredPot: number;
  /** Pot the current monthly contribution reaches by retirement, today's money. */
  projectedPot: number;
  /** `requiredPot - projectedPot`; negative means a surplus. */
  gap: number;
  /** Monthly contribution (rising with inflation) that closes the gap exactly. */
  requiredMonthly: number;
  /** `requiredMonthly - contributionMonthly`, floored at 0. */
  extraMonthly: number;
  onTrack: boolean;
  /** Age the money runs out on the *current* plan, or `null` if it lasts. */
  depletionAge: number | null;
  /** Earliest age the *current* contribution supports, or `null` if none ≤ 80. */
  earliestRetirementAge: number | null;
  requiredPotText: string;
  projectedPotText: string;
  gapText: string;
  requiredMonthlyText: string;
  extraMonthlyText: string;
}

export interface PlanResult {
  ok: true;
  currency: Currency;
  currentAge: number;
  retirementAge: number;
  lifeExpectancy: number;
  yearsToRetirement: number;
  yearsInRetirement: number;
  /** Net spending in the first retirement year, today's money. */
  firstYearSpending: number;
  firstYearSpendingText: string;
  /** Guaranteed income once every pension has started (gross, yearly). */
  guaranteedIncome: number;
  guaranteedIncomeText: string;
  pessimistic: ScenarioResult;
  base: ScenarioResult;
  optimistic: ScenarioResult;
  /** Base-case pot by age (today's money), on the current vs the required contribution. */
  projection: { ages: number[]; current: number[]; recommended: number[] };
  /** One-line summary for text-only layouts. */
  headline: string;
  assumptions: string[];
}

// ─── money formatting ───────────────────────────────────────────────────────
// Hand-rolled: PrimJS (Lynx's JS engine) is not guaranteed to ship `Intl`.

const SYMBOL: Record<Currency, string> = { GBP: '£', EUR: '€' };

export function formatMoney(amount: number, currency: Currency): string {
  const rounded = Math.round(Math.abs(amount));
  const digits = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${amount < 0 ? '-' : ''}${SYMBOL[currency]}${digits}`;
}

/** `£1.24m`, `£480k`, `£950` — for chart axes and tight layouts. */
export function formatMoneyShort(amount: number, currency: Currency): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${SYMBOL[currency]}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}m`;
  if (abs >= 10_000) return `${sign}${SYMBOL[currency]}${Math.round(abs / 1_000)}k`;
  return formatMoney(amount, currency);
}

// ─── tax ────────────────────────────────────────────────────────────────────

/** UK (rest-of-UK) income tax on a year's total taxable income. */
export function ukIncomeTax(income: number): number {
  if (income <= 0) return 0;
  const t = UK_INCOME_TAX;
  const allowance = Math.max(0, t.personalAllowance - Math.max(0, income - t.taperThreshold) / 2);
  const taxable = Math.max(0, income - allowance);
  const basic = Math.min(taxable, t.basicBand);
  const higher = Math.min(Math.max(taxable - t.basicBand, 0), t.additionalRateThreshold - t.basicBand);
  const additional = Math.max(taxable - t.additionalRateThreshold, 0);
  return basic * t.basicRate + higher * t.higherRate + additional * t.additionalRate;
}

/** Net income from guaranteed (gross, taxable) income plus a gross pot withdrawal. */
export function netIncome(inputs: PlanInputs, guaranteed: number, withdrawal: number): number {
  const taxedWithdrawal = withdrawal * (1 - inputs.taxFreeShare);
  const tax =
    inputs.taxRegime === 'UK'
      ? ukIncomeTax(guaranteed + taxedWithdrawal * UK_PENSION_TAXABLE_SHARE)
      : (guaranteed + taxedWithdrawal) * inputs.effectiveTaxRate;
  return guaranteed + withdrawal - tax;
}

/**
 * Gross withdrawal needed for a year's net spending, given guaranteed income.
 * Net income rises strictly with the withdrawal (no marginal rate reaches
 * 100%), so bisection converges; 0 when guaranteed income already covers it.
 */
export function grossWithdrawal(inputs: PlanInputs, guaranteed: number, need: number): number {
  if (netIncome(inputs, guaranteed, 0) >= need) return 0;
  let low = 0;
  let high = Math.max(need, 1);
  while (netIncome(inputs, guaranteed, high) < need) high *= 2;
  // 50 halvings: far below a penny for any realistic amount.
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    if (netIncome(inputs, guaranteed, mid) < need) low = mid;
    else high = mid;
  }
  return high;
}

// ─── cash flows ─────────────────────────────────────────────────────────────

function goalsAt(inputs: PlanInputs, age: number): number {
  let total = 0;
  for (const goal of inputs.goals) if (goal.age === age) total += goal.amount;
  return total;
}

/** Net spending needed at `age` (a retirement year). */
export function spendingAt(inputs: PlanInputs, age: number): number {
  const base = 12 * (inputs.essentialsMonthly + inputs.lifestyleMonthly);
  const travel = age < inputs.travelUntilAge ? inputs.travelYearly : 0;
  return base + travel + goalsAt(inputs, age);
}

/** Gross guaranteed income at `age`. */
export function guaranteedAt(inputs: PlanInputs, age: number): number {
  return (
    (age >= inputs.statePensionAge ? inputs.statePensionYearly : 0) +
    (age >= inputs.otherPensionAge ? inputs.otherPensionYearly : 0)
  );
}

/**
 * Gross withdrawal needed at a given age, memoized. It depends only on the
 * age — not on the retirement date or the return scenario — so one table
 * serves every scenario and every trial age in {@link earliestRetirementAge}.
 * That matters on device: what-if sliders re-run the whole plan live, and
 * each entry is a tax gross-up by bisection.
 */
type DrawTable = (age: number) => number;

function createDrawTable(inputs: PlanInputs): DrawTable {
  const memo = new Map<number, number>();
  return (age) => {
    let draw = memo.get(age);
    if (draw === undefined) {
      draw = grossWithdrawal(inputs, guaranteedAt(inputs, age), spendingAt(inputs, age));
      memo.set(age, draw);
    }
    return draw;
  };
}

/** Withdrawals for retirement ages `retirementAge .. lifeExpectancy-1`. */
function withdrawals(inputs: PlanInputs, drawAt: DrawTable): number[] {
  const out: number[] = [];
  for (let age = inputs.retirementAge; age < inputs.lifeExpectancy; age++) out.push(drawAt(age));
  return out;
}

export function realReturn(nominal: number, inflation: number): number {
  return (1 + nominal) / (1 + inflation) - 1;
}

/** PV at retirement of every withdrawal (start of year) plus the legacy. */
function requiredPotFor(inputs: PlanInputs, draws: number[], realAfter: number): number {
  let pot = inputs.legacy;
  for (let i = draws.length - 1; i >= 0; i--) pot = draws[i]! + pot / (1 + realAfter);
  return pot;
}

/** Pot on the retirement date for a given monthly contribution. */
function potAtRetirement(inputs: PlanInputs, realBefore: number, monthly: number): number {
  const monthlyRate = Math.pow(1 + realBefore, 1 / 12) - 1;
  let pot = inputs.savings;
  for (let age = inputs.currentAge; age < inputs.retirementAge; age++) {
    pot -= goalsAt(inputs, age);
    for (let month = 0; month < 12; month++) pot = pot * (1 + monthlyRate) + monthly;
  }
  return pot;
}

/** Contribution that makes {@link potAtRetirement} hit `target` — the map is affine in it. */
function monthlyFor(inputs: PlanInputs, realBefore: number, target: number): number {
  const withoutContributions = potAtRetirement(inputs, realBefore, 0);
  const perUnit = potAtRetirement(inputs, realBefore, 1) - withoutContributions;
  return Math.max(0, (target - withoutContributions) / perUnit);
}

/** Pot at the start of each age, `currentAge .. lifeExpectancy` (unfloored). */
function projectPot(inputs: PlanInputs, realBefore: number, realAfter: number, monthly: number, draws: number[]): number[] {
  const monthlyRate = Math.pow(1 + realBefore, 1 / 12) - 1;
  const series: number[] = [];
  let pot = inputs.savings;
  for (let age = inputs.currentAge; age < inputs.retirementAge; age++) {
    series.push(pot);
    pot -= goalsAt(inputs, age);
    for (let month = 0; month < 12; month++) pot = pot * (1 + monthlyRate) + monthly;
  }
  for (let i = 0; i < draws.length; i++) {
    series.push(pot);
    pot = (pot - draws[i]!) * (1 + realAfter);
  }
  series.push(pot);
  return series;
}

/** First retirement age at which the pot can't cover that year's withdrawal. */
function depletionAgeOf(inputs: PlanInputs, series: number[], draws: number[]): number | null {
  const offset = inputs.retirementAge - inputs.currentAge;
  for (let i = 0; i < draws.length; i++) {
    if (series[offset + i]! < draws[i]! - 0.5) return inputs.retirementAge + i;
  }
  return null;
}

function earliestRetirementAge(inputs: PlanInputs, scenario: ScenarioId, returns: ReturnTable, drawAt: DrawTable): number | null {
  const [before, after] = returns[inputs.riskProfile][scenario];
  const realBefore = realReturn(before, inputs.inflation);
  const realAfter = realReturn(after, inputs.inflation);
  const lastAge = Math.min(80, inputs.lifeExpectancy - 1);
  for (let age = inputs.currentAge + 1; age <= lastAge; age++) {
    const trial = { ...inputs, retirementAge: age };
    const required = requiredPotFor(trial, withdrawals(trial, drawAt), realAfter);
    if (potAtRetirement(trial, realBefore, inputs.contributionMonthly) >= required) return age;
  }
  return null;
}

function scenarioResult(
  inputs: PlanInputs,
  id: ScenarioId,
  draws: number[],
  returns: ReturnTable,
  drawAt: DrawTable,
): ScenarioResult {
  const nominalReturns = returns[inputs.riskProfile][id];
  const realBefore = realReturn(nominalReturns[0], inputs.inflation);
  const realAfter = realReturn(nominalReturns[1], inputs.inflation);
  const requiredPot = requiredPotFor(inputs, draws, realAfter);
  const projectedPot = potAtRetirement(inputs, realBefore, inputs.contributionMonthly);
  const requiredMonthly = monthlyFor(inputs, realBefore, requiredPot);
  const extraMonthly = Math.max(0, requiredMonthly - inputs.contributionMonthly);
  const current = projectPot(inputs, realBefore, realAfter, inputs.contributionMonthly, draws);
  const money = (value: number) => formatMoney(value, inputs.currency);
  return {
    id,
    label: SCENARIO_LABELS[id],
    nominalReturns,
    requiredPot,
    projectedPot,
    gap: requiredPot - projectedPot,
    requiredMonthly,
    extraMonthly,
    onTrack: projectedPot >= requiredPot,
    depletionAge: depletionAgeOf(inputs, current, draws),
    earliestRetirementAge: earliestRetirementAge(inputs, id, returns, drawAt),
    requiredPotText: money(requiredPot),
    projectedPotText: money(projectedPot),
    gapText: money(Math.abs(requiredPot - projectedPot)),
    requiredMonthlyText: `${money(requiredMonthly)}/month`,
    extraMonthlyText: `${money(extraMonthly)}/month`,
  };
}

/** Problems that make a plan impossible — {@link calculatePlan} throws on any. */
export function validateInputs(inputs: PlanInputs): string[] {
  const problems: string[] = [];
  if (inputs.retirementAge <= inputs.currentAge) problems.push('retirementAge must be after currentAge');
  if (inputs.lifeExpectancy <= inputs.retirementAge) problems.push('lifeExpectancy must be after retirementAge');
  if (inputs.savings < 0 || inputs.contributionMonthly < 0) problems.push('savings and contributions cannot be negative');
  return problems;
}

/** `returns` is injectable for tests; the app always uses {@link RETURN_ASSUMPTIONS}. */
export function calculatePlan(inputs: PlanInputs, returns: ReturnTable = RETURN_ASSUMPTIONS): PlanResult {
  const problems = validateInputs(inputs);
  if (problems.length > 0) throw new Error(problems.join('; '));

  const drawAt = createDrawTable(inputs);
  const draws = withdrawals(inputs, drawAt);
  const pessimistic = scenarioResult(inputs, 'pessimistic', draws, returns, drawAt);
  const base = scenarioResult(inputs, 'base', draws, returns, drawAt);
  const optimistic = scenarioResult(inputs, 'optimistic', draws, returns, drawAt);

  const [before, after] = returns[inputs.riskProfile].base;
  const realBefore = realReturn(before, inputs.inflation);
  const realAfter = realReturn(after, inputs.inflation);
  const ages: number[] = [];
  for (let age = inputs.currentAge; age <= inputs.lifeExpectancy; age++) ages.push(age);
  const floor = (series: number[]) => series.map((value) => Math.max(0, Math.round(value)));

  const money = (value: number) => formatMoney(value, inputs.currency);
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const guaranteedIncome = guaranteedAt(inputs, Math.max(inputs.statePensionAge, inputs.otherPensionAge, inputs.retirementAge));
  const firstYearSpending = spendingAt(inputs, inputs.retirementAge);

  const assumptions = [
    `All amounts are in today's money; inflation ${percent(inputs.inflation)} a year.`,
    `Returns (${inputs.riskProfile}, net of fees) before / in retirement: ` +
      (['pessimistic', 'base', 'optimistic'] as const)
        .map((id) => {
          const [b, a] = returns[inputs.riskProfile][id];
          return `${SCENARIO_LABELS[id].toLowerCase()} ${percent(b)} / ${percent(a)}`;
        })
        .join(', ') + '.',
    `Money must last to age ${inputs.lifeExpectancy}` +
      (inputs.legacy > 0 ? `, leaving ${money(inputs.legacy)}.` : '.'),
    inputs.taxRegime === 'UK'
      ? `UK 2026/27 income tax; ${Math.round(inputs.taxFreeShare * 100)}% of savings in ISAs, the rest in pensions (25% of each pension withdrawal tax-free). Bands held flat in today's money.`
      : `Flat ${percent(inputs.effectiveTaxRate)} effective tax on pensions and on the ${Math.round((1 - inputs.taxFreeShare) * 100)}% of withdrawals that is taxable.`,
    `Contributions rise with inflation. Illustrative only — not financial advice.`,
  ];

  return {
    ok: true,
    currency: inputs.currency,
    currentAge: inputs.currentAge,
    retirementAge: inputs.retirementAge,
    lifeExpectancy: inputs.lifeExpectancy,
    yearsToRetirement: inputs.retirementAge - inputs.currentAge,
    yearsInRetirement: inputs.lifeExpectancy - inputs.retirementAge,
    firstYearSpending,
    firstYearSpendingText: money(firstYearSpending),
    guaranteedIncome,
    guaranteedIncomeText: money(guaranteedIncome),
    pessimistic,
    base,
    optimistic,
    projection: {
      ages,
      current: floor(projectPot(inputs, realBefore, realAfter, inputs.contributionMonthly, draws)),
      recommended: floor(projectPot(inputs, realBefore, realAfter, base.requiredMonthly, draws)),
    },
    headline: base.onTrack
      ? `On track: your current ${money(inputs.contributionMonthly)}/month should fund retirement at ${inputs.retirementAge} (base case).`
      : `Invest ${base.requiredMonthlyText} to retire at ${inputs.retirementAge} (base case) — ${base.extraMonthlyText} more than now.`,
    assumptions,
  };
}
