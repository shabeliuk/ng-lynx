/**
 * The planner's `toolProvider`: what a model-written
 * `Query("calculate_plan", { retirementAge: $retirementAge }, …)` actually
 * runs. Arguments are what-if overrides layered on the confirmed profile —
 * coerced and range-checked by the same harvester that reads form answers, so
 * a slider mid-drag or a stray string can't produce a nonsense plan. The
 * profile itself is only changed by a submitted form, never by a Query.
 */
import { calculatePlan, type PlanResult } from './calc.js';
import { CALCULATE_PLAN, type PlanUnavailable } from './contract.js';
import { FIELD_BY_KEY, harvestAnswers, mergeProfile, type PlannerProfile, resolveInputs } from './profile.js';

export function planFor(profile: PlannerProfile, overrides: Record<string, unknown> = {}): PlanResult | PlanUnavailable {
  const asFormState = Object.fromEntries(
    Object.entries(overrides).map(([key, value]) => [key.startsWith('$') ? key : `$${key}`, { value }]),
  );
  const { updates } = harvestAnswers(asFormState);
  const resolved = resolveInputs(mergeProfile(profile, updates));
  if (!resolved.ok) {
    const labels = resolved.missing.map((key) => FIELD_BY_KEY[key]?.label ?? key);
    return {
      ok: false,
      missing: resolved.missing,
      message: resolved.problems[0] ?? `I still need: ${labels.join(', ')}.`,
    };
  }
  return calculatePlan(resolved.inputs);
}

/** `{ calculate_plan }` for `<openui-renderer [toolProvider]>`, reading the live profile. */
export function createPlannerTools(profile: () => PlannerProfile) {
  return {
    [CALCULATE_PLAN]: async (args: unknown) =>
      planFor(profile(), args && typeof args === 'object' ? (args as Record<string, unknown>) : {}),
  };
}
