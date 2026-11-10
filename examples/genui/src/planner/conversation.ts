/**
 * What the app tells the model on every user turn.
 *
 * The model sees the whole transcript, but the transcript is not the source
 * of truth for numbers — the profile is. So each user message carries a
 * `<planner_state>` block the app computes deterministically: the confirmed
 * profile, what's still required, what's still on defaults, and the next
 * step. That keeps even a small model on the rails (it never has to
 * remember what it already asked) and makes "the model forgot my age" a
 * non-issue. The system prompt (`server/prompt.ts`) explains the block.
 */
import type { Harvest, PlannerProfile } from './profile.js';
import { FIELD_BY_KEY, formatField, missingRequired, PROFILE_FIELDS } from './profile.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface UserTurn {
  /** Free text the user typed. */
  text?: string;
  /** A submitted generated form: its button message plus what the app read from it. */
  form?: { message: string; harvest: Harvest };
  /** The app asking the model to fix its own previous response. */
  correction?: string;
}

function stateBlock(profile: PlannerProfile): string {
  const currency = profile.currency ?? (profile.country === 'EU' ? 'EUR' : 'GBP');
  const known: Record<string, unknown> = {};
  for (const spec of PROFILE_FIELDS) {
    if (profile[spec.key] !== undefined) known[spec.key] = profile[spec.key];
  }
  if (profile.goals?.length) known['goals'] = profile.goals;

  const missing = missingRequired(profile);
  const onDefault = PROFILE_FIELDS.filter((spec) => !spec.required && profile[spec.key] === undefined).map(
    (spec) => spec.key,
  );
  const next =
    missing.length > 0
      ? `Ask for the missing required fields (${missing.map((spec) => spec.key).join(', ')}) — at most 4 inputs on one screen, pre-filled with sensible values from what the user said.`
      : 'Every required field is known. If lifestyle, travel, goals or pensions have not been covered yet, ask about them on one more screen; otherwise show the results screen with calculate_plan.';

  return [
    '<planner_state>',
    `confirmed profile (${currency}, today's money): ${JSON.stringify(known)}`,
    `still required: ${missing.length ? missing.map((spec) => spec.key).join(', ') : 'none'}`,
    `optional fields still on defaults: ${onDefault.join(', ') || 'none'}`,
    `next step: ${next}`,
    '</planner_state>',
  ].join('\n');
}

/** Compose the content of one user message to the model. */
export function composeUserMessage(turn: UserTurn, profile: PlannerProfile): string {
  const parts: string[] = [];
  if (turn.text) parts.push(`<user_message>\n${turn.text}\n</user_message>`);
  if (turn.form) {
    const { message, harvest } = turn.form;
    const lines = [`<form_submission button="${message}">`];
    const changed = Object.keys(harvest.updates).length > 0;
    lines.push(changed ? `changed: ${JSON.stringify(harvest.updates)}` : 'changed: nothing — the user confirmed the screen as shown');
    if (harvest.rejected.length) lines.push(`rejected (ask again, explain why): ${JSON.stringify(harvest.rejected)}`);
    if (Object.keys(harvest.other).length) lines.push(`other answers (context only): ${JSON.stringify(harvest.other)}`);
    lines.push('</form_submission>');
    parts.push(lines.join('\n'));
  }
  if (turn.correction) parts.push(`<app_notice>\n${turn.correction}\n</app_notice>`);
  parts.push(stateBlock(profile));
  return parts.join('\n\n');
}

interface ParseError {
  message: string;
  code?: string;
  component?: string;
  statementId?: string;
}

interface ParseProblemsInput {
  root: unknown;
  meta: {
    errors: readonly ParseError[];
    unresolved: readonly string[];
  };
}

/**
 * Whether a validation error actually breaks the screen. lang-core keeps a
 * component whose optional prop has the wrong type or that got extra
 * arguments — the prop falls back to its default and it renders — so those
 * are logged, not sent back for a (quota-costing) correction round. A
 * missing required prop, an unknown component or a reserved inline name
 * does drop content.
 */
export function isSevereError(error: ParseError): boolean {
  return error.code !== 'type-mismatch' && error.code !== 'excess-args';
}

/**
 * What's wrong with a generated screen, phrased so a model can fix it: each
 * validation error quotes the offending statement and the component's
 * correct signature. The bare error text alone ("expects one of … but got
 * \"start\"") was not enough — a small model re-sent the same mistake.
 */
export function describeProblems(
  text: string,
  result: ParseProblemsInput,
  signatures: Readonly<Record<string, { signature: string }>>,
): string[] {
  const lines = text.split('\n').map((line) => line.trim());
  const statement = (id: string | undefined) => {
    if (!id) return undefined;
    const line = lines.find((l) => l.startsWith(`${id} =`) || l.startsWith(`${id}=`));
    return line && line.length > 220 ? `${line.slice(0, 220)}…` : line;
  };
  const problems: string[] = [];
  const explained = new Set<string>();
  for (const error of result.meta.errors) {
    const where = statement(error.statementId);
    let problem = where ? `\`${where}\`: ${error.message}` : error.message;
    if (error.component && !explained.has(error.component) && signatures[error.component]) {
      explained.add(error.component);
      problem += ` — arguments are positional: ${signatures[error.component]!.signature}`;
    }
    problems.push(problem);
  }
  for (const name of result.meta.unresolved) problems.push(`"${name}" is referenced but never defined`);
  if (!result.root) problems.push('there is no root = Stack(...) statement');
  return problems;
}

/** A short line for the chat transcript, e.g. "✓ Age now 41 · Retire at 60". */
export function describeAnswers(harvest: Harvest, profile: PlannerProfile): string {
  const currency = profile.currency ?? 'GBP';
  const items = Object.entries(harvest.updates)
    .filter(([key]) => key !== 'goals')
    .map(([key, value]) => {
      const spec = FIELD_BY_KEY[key];
      return spec ? `${spec.label} ${formatField(spec, value, currency)}` : `${key} ${String(value)}`;
    });
  for (const goal of harvest.updates.goals ?? []) {
    items.push(`${goal.label} ${formatField(FIELD_BY_KEY['legacy']!, goal.amount, currency)} at ${goal.age}`);
  }
  return items.length ? `✓ ${items.join(' · ')}` : '✓ Sent';
}
