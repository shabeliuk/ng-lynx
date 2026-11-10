/**
 * Demo builds: bake the LLM key into the app bundle.
 *
 * With `PLANNER_EMBED_KEY=true` in `.env.local`, this defines
 * `__PLANNER_EMBEDDED__` as `{ provider, baseUrl, apiKey, model, systemPrompt }`,
 * and the app calls the provider directly (`agent.ts`, `DirectAgent`) — in dev,
 * in `rspeedy build` output, in Lynx Explorer, with no server anywhere.
 *
 * ⚠️ Anything in a bundle is readable by anyone who gets the bundle. This is
 * for a demo you control, with a key you're willing to lose — see README.md.
 * Without the flag it defines `null`, and the key stays on the dev server
 * (the default, verified by building with a sentinel key and grepping the
 * output).
 */
import { buildPlannerSystemPrompt } from './prompt.js';
import { readLlmEnv } from './llm-proxy.js';

import type { EmbeddedLlmConfig } from '../src/planner/llm-wire.js';

export function plannerDefines(root: string): Record<string, string> {
  const env = readLlmEnv(root);
  if (!env.embedKey) return { __PLANNER_EMBEDDED__: 'null' };
  if (!env.apiKey) {
    console.warn('[planner] PLANNER_EMBED_KEY is set but there is no API key to embed (GEMINI_API_KEY) — ignoring it');
    return { __PLANNER_EMBEDDED__: 'null' };
  }
  console.warn(
    `[planner] PLANNER_EMBED_KEY=true: embedding the ${env.provider} API key in the app bundle. ` +
      'Anyone with the bundle can read it — demo builds only.',
  );
  const embedded: EmbeddedLlmConfig = {
    provider: env.provider,
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    ...(env.model ? { model: env.model } : {}),
    systemPrompt: buildPlannerSystemPrompt(),
  };
  // `define` values are source text: a JSON object is a valid JS expression.
  return { __PLANNER_EMBEDDED__: JSON.stringify(embedded) };
}
