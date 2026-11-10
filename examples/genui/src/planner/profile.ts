/**
 * The planner's profile: what the app knows about the user, and the contract
 * between the LLM's generated forms and that knowledge.
 *
 * ## The naming contract
 *
 * A generated form collects an answer by binding an input to a `$variable`
 * named **exactly** after a profile field — `Slider("Retire at", 50, 75, 60, 1,
 * null, "$retirementAge")`. When the user submits (`@ToAssistant`), the app
 * reads the form state, keeps the `$<field>` entries it recognises, coerces
 * and range-checks them ({@link harvestAnswers}), and merges them into the
 * profile. Nothing the model *says* changes the profile; only values the user
 * saw in a form and submitted do. That's the property a money app needs: the
 * model proposes numbers, the user confirms them.
 *
 * One-off goals use `$goal<Name>Amount` + `$goal<Name>Age` pairs
 * (`$goalBoatAmount`, `$goalBoatAge` → `{ label: 'Boat', … }`).
 *
 * {@link PROFILE_FIELDS} is the single source for that contract: the server
 * prints it into the system prompt, the harvester validates against it, and
 * the profile panel labels from it.
 *
 * Leaf module (type-only imports) so the Node side — the prompt builder and
 * `node --test` — can load it directly.
 */
import type { Currency, Goal, PlanInputs, RiskProfile, TaxRegime } from './calc.js';

export interface PlannerProfile {
  country?: TaxRegime;
  currency?: Currency;
  currentAge?: number;
  retirementAge?: number;
  lifeExpectancy?: number;
  essentialsMonthly?: number;
  lifestyleMonthly?: number;
  travelYearly?: number;
  travelUntilAge?: number;
  goals?: Goal[];
  savings?: number;
  contributionMonthly?: number;
  /** Percent, 0..100. */
  taxFreeShare?: number;
  riskProfile?: RiskProfile;
  statePensionYearly?: number;
  statePensionAge?: number;
  otherPensionYearly?: number;
  otherPensionAge?: number;
  /** Percent, 0..60 (EU only). */
  effectiveTaxRate?: number;
  /** Percent, 0..10. */
  inflation?: number;
  legacy?: number;
}

export type ScalarField = Exclude<keyof PlannerProfile, 'goals'>;

export type FieldGroup = 'you' | 'lifestyle' | 'money' | 'pensions' | 'assumptions';

export interface FieldSpec {
  key: ScalarField;
  label: string;
  group: FieldGroup;
  kind: 'number' | 'choice';
  /** How the value is shown and what it means; money is always today's money. */
  unit: 'age' | 'money' | 'moneyPerMonth' | 'moneyPerYear' | 'percent' | 'choice';
  min?: number;
  max?: number;
  options?: readonly string[];
  /** Needed before any plan can be calculated. */
  required: boolean;
  /** For the prompt: what the field means and how to ask about it. */
  hint: string;
}

/** 2026/27 full new State Pension: £241.30/week. */
export const UK_FULL_STATE_PENSION = 12_547.6;

export const PROFILE_FIELDS: readonly FieldSpec[] = [
  { key: 'country', label: 'Tax country', group: 'you', kind: 'choice', unit: 'choice', options: ['UK', 'EU'], required: true,
    hint: 'Where they will be taxed in retirement. "UK" uses UK income tax; "EU" (any other European country) uses an effective tax rate.' },
  { key: 'currency', label: 'Currency', group: 'you', kind: 'choice', unit: 'choice', options: ['GBP', 'EUR'], required: false,
    hint: 'Defaults to GBP for UK and EUR for EU.' },
  { key: 'currentAge', label: 'Age now', group: 'you', kind: 'number', unit: 'age', min: 18, max: 80, required: true,
    hint: 'Their age today.' },
  { key: 'retirementAge', label: 'Retire at', group: 'you', kind: 'number', unit: 'age', min: 40, max: 80, required: true,
    hint: 'The age they want to stop working. Must be after their current age.' },
  { key: 'lifeExpectancy', label: 'Plan to age', group: 'you', kind: 'number', unit: 'age', min: 70, max: 105, required: false,
    hint: 'Planning horizon — the money should last until this age. Default 95: a prudent horizon (roughly a 1-in-4 chance of living longer for a healthy 40–60 year old). Offer 90–100 depending on health and family history.' },

  { key: 'essentialsMonthly', label: 'Essentials', group: 'lifestyle', kind: 'number', unit: 'moneyPerMonth', min: 0, max: 50_000, required: true,
    hint: 'Monthly spending on housing, food, bills, transport, healthcare — in retirement, net of tax, today\'s money. Help them estimate from their lifestyle description (e.g. mortgage paid off? renting?).' },
  { key: 'lifestyleMonthly', label: 'Lifestyle', group: 'lifestyle', kind: 'number', unit: 'moneyPerMonth', min: 0, max: 50_000, required: false,
    hint: 'Monthly discretionary spending: hobbies, dining out, gifts, clubs. Default 0.' },
  { key: 'travelYearly', label: 'Travel', group: 'lifestyle', kind: 'number', unit: 'moneyPerYear', min: 0, max: 200_000, required: false,
    hint: 'Yearly holiday budget. Turn descriptions into a number the user adjusts (e.g. two long-haul trips for two ≈ £8,000–£12,000/year). Default 0.' },
  { key: 'travelUntilAge', label: 'Travel until', group: 'lifestyle', kind: 'number', unit: 'age', min: 50, max: 100, required: false,
    hint: 'Age the travel budget stops (people travel less later in retirement). Default 80.' },

  { key: 'savings', label: 'Savings now', group: 'money', kind: 'number', unit: 'money', min: 0, max: 20_000_000, required: true,
    hint: 'Everything already invested for retirement: pensions (workplace, SIPP), ISAs, investment accounts. Exclude the home and emergency cash.' },
  { key: 'contributionMonthly', label: 'Saving monthly', group: 'money', kind: 'number', unit: 'moneyPerMonth', min: 0, max: 100_000, required: true,
    hint: 'What goes into those savings every month today, including any employer pension contribution.' },
  { key: 'taxFreeShare', label: 'Share in ISAs', group: 'money', kind: 'number', unit: 'percent', min: 0, max: 100, required: false,
    hint: 'UK: percent of savings held in ISAs (tax-free withdrawals) vs pensions. Default 20 for UK, 0 for EU.' },
  { key: 'riskProfile', label: 'Investment style', group: 'money', kind: 'choice', unit: 'choice', options: ['cautious', 'balanced', 'adventurous'], required: false,
    hint: 'How invested their savings are: cautious (mostly bonds/cash), balanced (~60% shares), adventurous (mostly shares). Default balanced.' },

  { key: 'statePensionYearly', label: 'State pension', group: 'pensions', kind: 'number', unit: 'moneyPerYear', min: 0, max: 60_000, required: false,
    hint: 'Expected yearly state pension, today\'s money. UK default: the full new State Pension, £12,547.60/year (£241.30/week, 2026/27) — needs 35 qualifying NI years; fewer years pay proportionally less (minimum 10). EU: ask for the figure on their national pension statement; default 0.' },
  { key: 'statePensionAge', label: 'State pension from', group: 'pensions', kind: 'number', unit: 'age', min: 55, max: 75, required: false,
    hint: 'UK: 67 for anyone born on or after 6 March 1961; 68 is legislated for those born after 5 April 1977 (under review). Default derived from their age. EU: typically 65–67.' },
  { key: 'otherPensionYearly', label: 'Other income', group: 'pensions', kind: 'number', unit: 'moneyPerYear', min: 0, max: 500_000, required: false,
    hint: 'Other guaranteed yearly income in retirement: a final-salary (defined benefit) pension, an annuity, rental income. Default 0.' },
  { key: 'otherPensionAge', label: 'Other income from', group: 'pensions', kind: 'number', unit: 'age', min: 40, max: 80, required: false,
    hint: 'Age that income starts. Default: the retirement age.' },

  { key: 'effectiveTaxRate', label: 'Tax rate', group: 'assumptions', kind: 'number', unit: 'percent', min: 0, max: 60, required: false,
    hint: 'EU only: average tax rate on retirement income. Default 20.' },
  { key: 'inflation', label: 'Inflation', group: 'assumptions', kind: 'number', unit: 'percent', min: 0, max: 10, required: false,
    hint: 'Long-run yearly inflation. Default 2.5 (the Bank of England and ECB target 2).' },
  { key: 'legacy', label: 'Leave behind', group: 'assumptions', kind: 'number', unit: 'money', min: 0, max: 20_000_000, required: false,
    hint: 'Amount to leave to heirs at the end, today\'s money. Default 0.' },
];

export const FIELD_BY_KEY: Readonly<Record<string, FieldSpec>> = Object.fromEntries(
  PROFILE_FIELDS.map((spec) => [spec.key, spec]),
);

// ─── coercion ───────────────────────────────────────────────────────────────

/** `"£1,200"`, `"60k"`, `"1.2m"`, `"25%"`, `42` → number; anything else → undefined. */
export function parseAmount(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.trim().toLowerCase().replace(/[£€$,\s%]/g, '');
  const match = /^(-?\d+(?:\.\d+)?)(k|m)?$/.exec(cleaned);
  if (!match) return undefined;
  const value = Number(match[1]);
  return match[2] === 'k' ? value * 1_000 : match[2] === 'm' ? value * 1_000_000 : value;
}

const EU_COUNTRIES = [
  'austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czech', 'denmark', 'estonia', 'finland', 'france',
  'germany', 'greece', 'hungary', 'ireland', 'italy', 'latvia', 'lithuania', 'luxembourg', 'malta',
  'netherlands', 'poland', 'portugal', 'romania', 'slovakia', 'slovenia', 'spain', 'sweden',
];

/** Loose matching for choice answers ("United Kingdom", "Adventurous (mostly shares)", "€"). */
export function parseChoice(key: ScalarField, raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim().toLowerCase();
  if (!text) return undefined;
  switch (key) {
    case 'country':
      if (/\b(uk|u\.k\.|united kingdom|england|scotland|wales|northern ireland|britain|gb)\b/.test(text)) return 'UK';
      if (/\b(eu|europe|european|eurozone)\b/.test(text) || EU_COUNTRIES.some((c) => text.includes(c))) return 'EU';
      return undefined;
    case 'currency':
      if (/gbp|£|pound|sterling/.test(text)) return 'GBP';
      if (/eur|€|euro/.test(text)) return 'EUR';
      return undefined;
    case 'riskProfile':
      if (/cautious|conservative|low|safe/.test(text)) return 'cautious';
      if (/adventurous|aggressive|high|growth/.test(text)) return 'adventurous';
      if (/balanced|moderate|medium/.test(text)) return 'balanced';
      return undefined;
    default:
      return undefined;
  }
}

export interface Rejected {
  field: string;
  value: unknown;
  reason: string;
}

export interface Harvest {
  updates: PlannerProfile;
  /** Answers to `$variables` that aren't profile fields — context for the model. */
  other: Record<string, unknown>;
  rejected: Rejected[];
}

/** Unwrap OpenUI form state (`{ $x: { value } }`, or a named form's field map). */
function flattenFormState(formState: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(formState ?? {})) {
    if (entry && typeof entry === 'object' && 'value' in entry) {
      out[name] = (entry as { value: unknown }).value;
    } else if (entry && typeof entry === 'object') {
      for (const [inner, innerEntry] of Object.entries(entry as Record<string, unknown>)) {
        if (innerEntry && typeof innerEntry === 'object' && 'value' in innerEntry) {
          out[inner] = (innerEntry as { value: unknown }).value;
        }
      }
    }
  }
  return out;
}

const GOAL_PATTERN = /^\$goal([A-Z0-9][A-Za-z0-9]*)(Amount|Age)$/;

/** Read a submitted form's answers into validated profile updates. */
export function harvestAnswers(formState: Record<string, unknown> | undefined): Harvest {
  const updates: PlannerProfile = {};
  const other: Record<string, unknown> = {};
  const rejected: Rejected[] = [];
  const goalParts = new Map<string, { amount?: number; age?: number }>();

  for (const [name, raw] of Object.entries(flattenFormState(formState))) {
    if (raw === null || raw === undefined || raw === '') continue;
    const key = name.startsWith('$') ? name.slice(1) : name;

    const goal = GOAL_PATTERN.exec(name);
    if (goal) {
      const value = parseAmount(raw);
      if (value === undefined || value < 0) {
        rejected.push({ field: name, value: raw, reason: 'not a number' });
        continue;
      }
      const parts = goalParts.get(goal[1]!) ?? {};
      if (goal[2] === 'Amount') parts.amount = value;
      else parts.age = Math.round(value);
      goalParts.set(goal[1]!, parts);
      continue;
    }

    const spec = FIELD_BY_KEY[key];
    if (!spec || !name.startsWith('$')) {
      other[name] = raw;
      continue;
    }
    if (spec.kind === 'choice') {
      const choice = parseChoice(spec.key, raw);
      if (choice === undefined) rejected.push({ field: name, value: raw, reason: `expected one of ${spec.options!.join(', ')}` });
      else (updates as Record<string, unknown>)[spec.key] = choice;
      continue;
    }
    const value = parseAmount(raw);
    if (value === undefined) {
      rejected.push({ field: name, value: raw, reason: 'not a number' });
    } else if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) {
      rejected.push({ field: name, value: raw, reason: `out of range ${spec.min}–${spec.max}` });
    } else {
      (updates as Record<string, unknown>)[spec.key] = spec.unit === 'age' ? Math.round(value) : value;
    }
  }

  const goals: Goal[] = [];
  for (const [slug, parts] of goalParts) {
    const label = slug.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    if (parts.amount === undefined || parts.age === undefined) {
      rejected.push({ field: `$goal${slug}`, value: parts, reason: 'needs both $goal…Amount and $goal…Age' });
    } else {
      goals.push({ label: label.charAt(0).toUpperCase() + label.slice(1).toLowerCase(), amount: parts.amount, age: parts.age });
    }
  }
  if (goals.length > 0) updates.goals = goals;
  return { updates, other, rejected };
}

/** Merge updates; goals merge by label (same label = the user revised it). */
export function mergeProfile(profile: PlannerProfile, updates: PlannerProfile): PlannerProfile {
  const next: PlannerProfile = { ...profile, ...updates };
  if (updates.goals) {
    const byLabel = new Map((profile.goals ?? []).map((goal) => [goal.label, goal]));
    for (const goal of updates.goals) byLabel.set(goal.label, goal);
    next.goals = [...byLabel.values()].filter((goal) => goal.amount > 0);
  }
  if (updates.country && !updates.currency && !profile.currency) next.currency = updates.country === 'UK' ? 'GBP' : 'EUR';
  return next;
}

/**
 * The part of `updates` that actually changes `profile`. Generated forms are
 * seeded with every confirmed answer (so they pre-fill), which means every
 * submission echoes the whole profile back; this is what the user really
 * changed — for the transcript line and for the model.
 */
export function changedFields(profile: PlannerProfile, updates: PlannerProfile): PlannerProfile {
  const changed: PlannerProfile = {};
  for (const [key, value] of Object.entries(updates) as [keyof PlannerProfile, unknown][]) {
    if (key === 'goals') {
      const known = new Map((profile.goals ?? []).map((goal) => [goal.label, JSON.stringify(goal)]));
      const goals = (value as Goal[]).filter((goal) => known.get(goal.label) !== JSON.stringify(goal));
      if (goals.length > 0) changed.goals = goals;
    } else if (profile[key] !== value) {
      (changed as Record<string, unknown>)[key] = value;
    }
  }
  return changed;
}

export function missingRequired(profile: PlannerProfile): FieldSpec[] {
  return PROFILE_FIELDS.filter((spec) => spec.required && profile[spec.key] === undefined);
}

/** Default UK State Pension age from today's age (born ≥ 6 Apr 1978 → 68). */
export function ukStatePensionAge(currentAge: number, year = 2026): number {
  const birthYear = year - currentAge;
  if (birthYear >= 1978) return 68;
  if (birthYear >= 1961) return 67;
  return 66;
}

export type Resolved =
  | { ok: true; inputs: PlanInputs; defaulted: ScalarField[] }
  | { ok: false; missing: string[]; problems: string[] };

/** Apply defaults and convert percentages; reports what's missing or inconsistent. */
export function resolveInputs(profile: PlannerProfile): Resolved {
  const missing = missingRequired(profile).map((spec) => spec.key);
  if (missing.length > 0) return { ok: false, missing, problems: [] };

  const p = profile as Required<Pick<PlannerProfile, 'country' | 'currentAge' | 'retirementAge' | 'essentialsMonthly' | 'savings' | 'contributionMonthly'>> & PlannerProfile;
  const uk = p.country === 'UK';
  const defaulted: ScalarField[] = [];
  const pick = <T>(key: ScalarField, fallback: T): T => {
    const value = profile[key];
    if (value === undefined) {
      defaulted.push(key);
      return fallback;
    }
    return value as T;
  };

  const lifeExpectancy = pick('lifeExpectancy', 95);
  const inputs: PlanInputs = {
    currency: pick('currency', uk ? 'GBP' : 'EUR'),
    taxRegime: p.country,
    currentAge: p.currentAge,
    retirementAge: p.retirementAge,
    lifeExpectancy,
    essentialsMonthly: p.essentialsMonthly,
    lifestyleMonthly: pick('lifestyleMonthly', 0),
    travelYearly: pick('travelYearly', 0),
    travelUntilAge: pick('travelUntilAge', 80),
    goals: (profile.goals ?? []).filter((goal) => goal.age >= p.currentAge && goal.age < lifeExpectancy),
    savings: p.savings,
    contributionMonthly: p.contributionMonthly,
    taxFreeShare: pick('taxFreeShare', uk ? 20 : 0) / 100,
    riskProfile: pick('riskProfile', 'balanced'),
    statePensionYearly: pick('statePensionYearly', uk ? UK_FULL_STATE_PENSION : 0),
    statePensionAge: pick('statePensionAge', uk ? ukStatePensionAge(p.currentAge) : 67),
    otherPensionYearly: pick('otherPensionYearly', 0),
    otherPensionAge: pick('otherPensionAge', p.retirementAge),
    effectiveTaxRate: pick('effectiveTaxRate', 20) / 100,
    inflation: pick('inflation', 2.5) / 100,
    legacy: pick('legacy', 0),
  };
  const problems: string[] = [];
  if (inputs.retirementAge <= inputs.currentAge) problems.push('Retirement age must be after current age.');
  if (inputs.lifeExpectancy <= inputs.retirementAge) problems.push('Plan-to age must be after retirement age.');
  if (problems.length > 0) return { ok: false, missing: [], problems };
  return { ok: true, inputs, defaulted };
}

// ─── display ────────────────────────────────────────────────────────────────

const SYMBOL: Record<Currency, string> = { GBP: '£', EUR: '€' };

export function formatField(spec: FieldSpec, value: unknown, currency: Currency = 'GBP'): string {
  if (value === undefined || value === null) return '—';
  if (spec.kind === 'choice') return String(value);
  const number = Number(value);
  const money = `${SYMBOL[currency]}${String(Math.round(number)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  switch (spec.unit) {
    case 'money':
      return money;
    case 'moneyPerMonth':
      return `${money}/mo`;
    case 'moneyPerYear':
      return `${money}/yr`;
    case 'percent':
      return `${number}%`;
    default:
      return String(number);
  }
}
