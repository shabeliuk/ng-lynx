/**
 * The offline demo agent: canned OpenUI screens, chosen from the profile.
 *
 * Used when no LLM is reachable (production build, device without the dev
 * server, missing API key, or the user tapped "Use offline demo"). It walks
 * the same four rounds the real model is prompted to follow and ends on the
 * same results screen, so the whole app — forms → harvest → profile →
 * `calculate_plan` → plan components → what-if sliders — is exercisable with
 * no network, in CI, and for device checks. It doesn't read free text;
 * it just asks the next question.
 *
 * Every screen is ordinary OpenUI Lang in genui 0.4.0 signatures, and
 * `test/scripted.test.ts` parses each one against upstream's prompt library
 * with zero validation errors.
 */
import type { Currency } from './calc.js';
import { CALCULATE_PLAN } from './contract.js';
import { type PlannerProfile, ukStatePensionAge } from './profile.js';

const SYMBOL: Record<Currency, string> = { GBP: '£', EUR: '€' };

const str = (value: string) => JSON.stringify(value);
const num = (value: number | undefined, fallback: number) => String(value ?? fallback);
const money = (value: number | undefined, fallback: number) => str(String(Math.round(value ?? fallback)));
const CONTINUE = 'Buttons([Button("Continue", Action([@ToAssistant("Here are my answers")]), "primary")])';
const OFFLINE_NOTE = 'TextContent("Offline demo — scripted questions, no AI.", "small")';

export function aboutYouScreen(profile: PlannerProfile): string {
  return [
    'root = Stack([title, note, card, next], "column", false, "m")',
    `$country = ${str(profile.country ?? 'UK')}`,
    `$currentAge = ${num(profile.currentAge, 40)}`,
    `$retirementAge = ${num(profile.retirementAge, 62)}`,
    'title = Text("Let\'s plan your retirement", "h2")',
    `note = ${OFFLINE_NOTE}`,
    'card = Card([CardHeader("About you", "Where you\'ll retire and when"), countryInput, ageInput, retireInput], "card", "column", false, "m")',
    `countryInput = RadioGroup(["UK", "EU"], ${str(profile.country ?? 'UK')}, "row", null, "$country")`,
    `ageInput = Slider("Your age now", 20, 75, ${num(profile.currentAge, 40)}, 1, null, "$currentAge")`,
    `retireInput = Slider("Retire at", 45, 75, ${num(profile.retirementAge, 62)}, 1, null, "$retirementAge")`,
    `next = ${CONTINUE}`,
  ].join('\n');
}

export function lifestyleScreen(profile: PlannerProfile): string {
  const symbol = SYMBOL[profile.currency ?? 'GBP'];
  return [
    'root = Stack([title, note, spending, goal, next], "column", false, "m")',
    'title = Text("Your retirement lifestyle", "h2")',
    `note = TextContent("Monthly amounts in today's money, after tax.", "small")`,
    'spending = Card([CardHeader("Spending", "Adjust to the life you want"), essentials, lifestyle, travel, travelUntil], "card", "column", false, "m")',
    `essentials = TextField("Essentials per month — home, food, bills (${symbol})", ${money(profile.essentialsMonthly, 2200)}, "number", "^[0-9]+$", null, "$essentialsMonthly")`,
    `lifestyle = TextField("Lifestyle per month — hobbies, dining out (${symbol})", ${money(profile.lifestyleMonthly, 600)}, "number", "^[0-9]+$", null, "$lifestyleMonthly")`,
    `travel = TextField("Travel per year (${symbol})", ${money(profile.travelYearly, 6000)}, "number", "^[0-9]+$", null, "$travelYearly")`,
    `travelUntil = Slider("Keep travelling until", 60, 90, ${num(profile.travelUntilAge, 80)}, 1, null, "$travelUntilAge")`,
    'goal = Card([CardHeader("A one-off goal", "Say, a campervan"), goalAmount, goalAge], "sunk", "column", false, "m")',
    `goalAmount = TextField("Campervan (${symbol})", "35000", "number", "^[0-9]+$", null, "$goalCampervanAmount")`,
    `goalAge = Slider("Buy it at", 50, 85, ${num(profile.retirementAge, 62)}, 1, null, "$goalCampervanAge")`,
    `next = ${CONTINUE}`,
  ].join('\n');
}

export function moneyScreen(profile: PlannerProfile): string {
  const symbol = SYMBOL[profile.currency ?? 'GBP'];
  const uk = profile.country !== 'EU';
  const inputs = ['savings', 'saving', 'risk', ...(uk ? ['isa'] : [])];
  return [
    'root = Stack([title, note, card, next], "column", false, "m")',
    `$riskProfile = ${str(profile.riskProfile ?? 'balanced')}`,
    'title = Text("Your money today", "h2")',
    'note = TextContent("Pensions, ISAs and investments — not your home or emergency cash.", "small")',
    `card = Card([${inputs.join(', ')}], "card", "column", false, "m")`,
    `savings = TextField("Saved so far (${symbol})", ${money(profile.savings, 60000)}, "number", "^[0-9]+$", null, "$savings")`,
    `saving = TextField("Saving each month, incl. employer (${symbol})", ${money(profile.contributionMonthly, 500)}, "number", "^[0-9]+$", null, "$contributionMonthly")`,
    `risk = RadioGroup(["cautious", "balanced", "adventurous"], ${str(profile.riskProfile ?? 'balanced')}, "card", null, "$riskProfile")`,
    ...(uk ? [`isa = Slider("Share held in ISAs (%)", 0, 100, ${num(profile.taxFreeShare, 20)}, 5, null, "$taxFreeShare")`] : []),
    `next = ${CONTINUE}`,
  ].join('\n');
}

export function pensionsScreen(profile: PlannerProfile): string {
  const symbol = SYMBOL[profile.currency ?? 'GBP'];
  const uk = profile.country !== 'EU';
  return [
    'root = Stack([title, note, card, next], "column", false, "m")',
    'title = Text("Pensions you can count on", "h2")',
    uk
      ? `note = TextContent("The full new State Pension is ${symbol}12,547.60 a year (2026/27) with 35 years of National Insurance.", "small")`
      : 'note = TextContent("Use the yearly figure from your national pension statement.", "small")',
    'card = Card([state, stateAge, other], "card", "column", false, "m")',
    `state = TextField("State pension per year (${symbol})", ${money(profile.statePensionYearly, uk ? 12548 : 9000)}, "number", "^[0-9]+$", null, "$statePensionYearly")`,
    `stateAge = Slider("State pension from age", 60, 70, ${num(profile.statePensionAge, uk ? ukStatePensionAge(profile.currentAge ?? 40) : 67)}, 1, null, "$statePensionAge")`,
    `other = TextField("Other guaranteed income per year — final-salary pension, rent (${symbol})", ${money(profile.otherPensionYearly, 0)}, "number", "^[0-9]+$", null, "$otherPensionYearly")`,
    `next = ${CONTINUE}`,
  ].join('\n');
}

export function resultsScreen(profile: PlannerProfile): string {
  const retirementAge = profile.retirementAge ?? 62;
  const monthly = Math.round(profile.contributionMonthly ?? 500);
  const maxMonthly = Math.max(3000, Math.ceil((monthly * 4) / 500) * 500);
  return [
    'root = Stack([title, summary, whatIf, chart, scenarios, caveat, actions], "column", false, "m")',
    `$retirementAge = ${retirementAge}`,
    `$contributionMonthly = ${monthly}`,
    `plan = Query(${str(CALCULATE_PLAN)}, {retirementAge: $retirementAge, contributionMonthly: $contributionMonthly}, {ok: false, message: "Calculating…"})`,
    'title = Text("Your retirement plan", "h2")',
    'summary = PlanSummary(plan)',
    'whatIf = Card([CardHeader("What if…", "Move a slider — the plan recalculates instantly"), retireSlider, saveSlider], "sunk", "column", false, "m")',
    `retireSlider = Slider("Retire at", 50, 75, ${retirementAge}, 1, null, "$retirementAge")`,
    `saveSlider = Slider("Invest per month", 0, ${maxMonthly}, ${monthly}, 50, null, "$contributionMonthly")`,
    'chart = ProjectionChart(plan)',
    'scenarios = ScenarioTable(plan)',
    'caveat = Text("Illustrative only, not financial advice. All amounts in today\'s money.", "caption")',
    'actions = Buttons([Button("Save these settings", Action([@ToAssistant("Save these settings")]), "primary"), Button("Explain the assumptions", Action([@ToAssistant("Explain the assumptions")]), "secondary"), Button("Change my lifestyle", Action([@ToAssistant("I want to change my lifestyle answers")]), "tertiary")])',
  ].join('\n');
}

export function assumptionsScreen(): string {
  return [
    'root = Stack([title, intro, notes, actions], "column", false, "m")',
    `plan = Query(${str(CALCULATE_PLAN)}, {}, {ok: false, message: "Calculating…"})`,
    'title = Text("How the plan is worked out", "h2")',
    'intro = TextContent("The assumptions behind every number, in today\'s money.", "small")',
    'notes = Card([PlanAssumptions(plan)], "card", "column", false, "m")',
    'actions = Buttons([Button("Back to my plan", Action([@ToAssistant("Show my plan again")]), "primary")])',
  ].join('\n');
}

/** The next screen for this profile — the scripted equivalent of the prompt's conversation flow. */
export function nextScriptedScreen(profile: PlannerProfile, lastUserText = ''): string {
  if (profile.country === undefined || profile.currentAge === undefined || profile.retirementAge === undefined) {
    return aboutYouScreen(profile);
  }
  if (profile.essentialsMonthly === undefined || /lifestyle/i.test(lastUserText)) return lifestyleScreen(profile);
  if (profile.savings === undefined || profile.contributionMonthly === undefined) return moneyScreen(profile);
  if (profile.statePensionYearly === undefined) return pensionsScreen(profile);
  if (/assumption/i.test(lastUserText)) return assumptionsScreen();
  return resultsScreen(profile);
}
