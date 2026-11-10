/**
 * What the app and the model must agree on, in one place: the planner's
 * custom OpenUI components (name, positional props, description) and the
 * `calculate_plan` tool (input/output schema).
 *
 * The app registers Angular renderers under these definitions
 * (`components.ts`); the server hands the *same* definitions to
 * `buildOpenUiSystemPrompt` with `component: () => null` (`server/prompt.ts`).
 * That's upstream's recommended split ("keep shared Zod schemas in a
 * framework-neutral module") — and it's the same parity property
 * `verify:genui-openui-parity` guarantees for the built-ins.
 *
 * No Angular imports: this module is loaded by Node too.
 */
import { z } from 'zod/v4';

import { PROFILE_FIELDS } from './profile.js';

export const CALCULATE_PLAN = 'calculate_plan';

const planProp = z.any();

export const PLANNER_COMPONENTS = [
  {
    name: 'PlanSummary',
    description:
      'Headline of a retirement plan: the monthly investment needed, the pot needed at retirement, and whether the user is on track. Pass the calculate_plan Query result.',
    props: z.object({ plan: planProp }),
  },
  {
    name: 'ScenarioTable',
    description:
      'Pessimistic / base / optimistic comparison of a plan (pot needed, monthly investment, outcome of the current saving). Pass the calculate_plan Query result.',
    props: z.object({ plan: planProp }),
  },
  {
    name: 'PlanAssumptions',
    description:
      'The assumptions behind a plan (inflation, returns per scenario, planning horizon, tax treatment) as a readable list. Pass the calculate_plan Query result.',
    props: z.object({ plan: planProp }),
  },
  {
    name: 'ProjectionChart',
    description:
      'Line chart of the savings pot by age: current saving vs the recommended saving, with the retirement age marked. Pass the calculate_plan Query result.',
    props: z.object({
      plan: planProp,
      scenario: z.enum(['pessimistic', 'base', 'optimistic']).optional(),
    }),
  },
] as const;

export const PLANNER_COMPONENT_GROUP = {
  name: 'Retirement plan',
  components: PLANNER_COMPONENTS.map((component) => component.name),
  notes: [
    'These render a calculate_plan Query result — always pass the Query reference, e.g. PlanSummary(plan).',
  ],
};

/** calculate_plan's arguments: optional what-if overrides of any profile field. */
function inputSchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const spec of PROFILE_FIELDS) {
    properties[spec.key] =
      spec.kind === 'choice'
        ? { type: 'string', enum: spec.options, description: spec.label }
        : { type: 'number', minimum: spec.min, maximum: spec.max, description: `${spec.label} (${spec.unit})` };
  }
  return { type: 'object', properties };
}

const scenarioSchema = {
  type: 'object',
  properties: {
    requiredMonthlyText: { type: 'string' },
    requiredPotText: { type: 'string' },
    projectedPotText: { type: 'string' },
    extraMonthlyText: { type: 'string' },
    gapText: { type: 'string' },
    onTrack: { type: 'boolean' },
    depletionAge: { type: ['number', 'null'] },
    earliestRetirementAge: { type: ['number', 'null'] },
  },
};

export const CALCULATE_PLAN_TOOL = {
  name: CALCULATE_PLAN,
  description: [
    'Computes the retirement plan from the profile the user has confirmed, deterministically (UK/EU tax, inflation, three return scenarios).',
    'Arguments are optional what-if overrides of profile fields — pass the $variables your what-if Sliders are bound to.',
    'Returns ok=false with a message and the missing fields while required answers are still unknown.',
    'The *Text fields are pre-formatted money in the user\'s currency: always show those, never compute or reformat numbers yourself.',
  ].join(' '),
  inputSchema: inputSchema(),
  outputSchema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      message: { type: 'string' },
      missing: { type: 'array', items: { type: 'string' } },
      headline: { type: 'string' },
      retirementAge: { type: 'number' },
      yearsToRetirement: { type: 'number' },
      firstYearSpendingText: { type: 'string' },
      guaranteedIncomeText: { type: 'string' },
      base: scenarioSchema,
      pessimistic: scenarioSchema,
      optimistic: scenarioSchema,
      assumptions: { type: 'array', items: { type: 'string' } },
    },
    required: ['ok'],
  },
  annotations: { readOnlyHint: true },
};

/** What calculate_plan returns while the plan can't be computed yet. */
export interface PlanUnavailable {
  ok: false;
  message: string;
  missing: string[];
}
