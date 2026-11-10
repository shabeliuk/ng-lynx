/**
 * The OpenAI-compatible chat-completions wire format, shared by the two ways
 * the planner reaches a model: the dev-server proxy (`server/llm-proxy.ts`,
 * key kept on the server) and the in-app direct client (`agent.ts`, key
 * embedded in the bundle — demo builds only, see README.md).
 *
 * No Angular, no Node APIs: loaded by both.
 */

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

/** The <planner_state> block carries the facts, so older turns can drop off. */
export const MAX_MESSAGES = 24;

export interface WireMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** What a demo build embeds when `PLANNER_EMBED_KEY=true` (see `server/embed.ts`). */
export interface EmbeddedLlmConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  /** Pinned model, or undefined to pick the newest Gemini Flash at startup. */
  model?: string;
  systemPrompt: string;
}

/**
 * Newest plain Flash model the key can use: `gemini-<version>-flash`, with or
 * without a `-preview` suffix, skipping lite/image/tts/live variants. The free
 * tier is Flash-only and which versions it offers changes over time, so this
 * asks instead of hard-coding one.
 */
export function pickGeminiModel(ids: readonly string[]): string | undefined {
  const candidates = ids
    .map((id) => id.replace(/^models\//, ''))
    .map((id) => ({ id, match: /^gemini-(\d+(?:\.\d+)?)-flash(-preview(?:-[\w-]+)?)?$/.exec(id) }))
    .filter((entry): entry is { id: string; match: RegExpExecArray } => entry.match !== null)
    .sort((a, b) => Number(b.match[1]) - Number(a.match[1]) || Number(!!a.match[2]) - Number(!!b.match[2]));
  return candidates[0]?.id;
}

/** Pick a model from a `GET {baseUrl}/models` response body. */
export function pickModel(provider: string, body: unknown): string | undefined {
  const ids = ((body as { data?: { id: string }[] } | null)?.data ?? []).map((model) => model.id);
  return provider === 'Gemini' ? pickGeminiModel(ids) : ids[0];
}

/** The most recent {@link MAX_MESSAGES} messages, opening on a user turn. */
export function messageWindow(messages: readonly WireMessage[]): WireMessage[] {
  const recent = messages.slice(-MAX_MESSAGES);
  while (recent.length > 0 && recent[0]!.role !== 'user') recent.shift();
  return recent;
}

/** The request body for one planner turn. */
export function chatRequestBody(model: string, systemPrompt: string, messages: readonly WireMessage[]): string {
  return JSON.stringify({
    model,
    stream: true,
    temperature: 0.3,
    max_tokens: 4096,
    messages: [{ role: 'system', content: systemPrompt }, ...messageWindow(messages)],
  });
}

/**
 * The text so far of an OpenAI-style SSE stream (`data: {…delta…}` lines),
 * from the raw body received so far. Only complete lines count, so a chunk
 * boundary never yields half a JSON event. Also accepts a whole non-streamed
 * `{ choices: [{ message: { content } }] }` body.
 */
export function sseText(raw: string): string {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const content = (JSON.parse(trimmed) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message
        ?.content;
      if (typeof content === 'string') return content;
    } catch {
      // not a whole JSON body (yet)
    }
  }
  let text = '';
  const complete = raw.slice(0, raw.lastIndexOf('\n') + 1);
  for (const line of complete.split('\n')) {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith('data:')) continue;
    const data = trimmedLine.slice(5).trim();
    if (data === '[DONE]') break;
    try {
      const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
      if (delta) text += delta;
    } catch {
      // a keep-alive or a provider-specific event we don't need
    }
  }
  return text;
}

/**
 * Statuses a second try usually fixes. Gemini answers 503 "This model is
 * currently experiencing high demand" in bursts that pass within seconds.
 * 429 (the free tier's per-minute quota) isn't here: seconds don't help.
 */
const RETRYABLE_STATUSES = [500, 502, 503, 504];
export const RETRY_DELAYS_MS = [1_000, 3_000];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `send()` again after a transient provider error, waiting RETRY_DELAYS_MS
 * between tries. Resolves with the last response, so a persistent error
 * still reaches the caller's error handling.
 */
export async function sendWithRetry(
  send: () => Promise<Response>,
  onRetry?: (status: number, attempt: number) => void,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await send();
    if (res.ok || !RETRYABLE_STATUSES.includes(res.status) || attempt >= RETRY_DELAYS_MS.length) return res;
    await res.text().catch(() => ''); // release the connection
    onRetry?.(res.status, attempt + 1);
    await wait(RETRY_DELAYS_MS[attempt]);
  }
}

/** A readable message for a failed chat-completions call. */
export function describeHttpError(provider: string, status: number, body: string): { code: string; message: string } {
  if (status === 429) {
    return { code: 'rate_limited', message: `${provider} free-tier rate limit reached — wait a minute, or switch to the offline demo.` };
  }
  if (status === 503) {
    return {
      code: 'overloaded',
      message: `${provider} is overloaded right now (HTTP 503) — try again in a minute, or set another LLM_MODEL.`,
    };
  }
  if (status === 400 || status === 401 || status === 403) {
    let detail = '';
    try {
      detail = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      // not JSON
    }
    return { code: 'auth', message: `${provider} rejected the request (HTTP ${status})${detail ? `: ${detail}` : ''}` };
  }
  return { code: 'upstream_error', message: `${provider} returned HTTP ${status}` };
}
