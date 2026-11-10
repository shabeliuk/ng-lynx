/**
 * The planner's LLM proxy, mounted into the rspeedy dev (and preview) server.
 *
 *   GET  /api/health  → { configured, provider, model, reason? }
 *   POST /api/chat    → { messages: [{ role, content }] } in,
 *                       the model's OpenUI Lang out, as a plain-text stream
 *
 * Why a proxy at all: it keeps the API key and the system prompt (~33 kB,
 * built from the same contract the app renders) out of the bundle — the
 * default. (Demo builds can opt into shipping both inside the app instead,
 * with `PLANNER_EMBED_KEY=true`; see `embed.ts`. When a bundle carries a key,
 * the app calls the provider itself and this proxy goes unused.) Why *inside*
 * the dev server:
 * `npm run dev` stays one command, and the app reaches the proxy at the
 * same origin it was loaded from — `localhost` in the web preview, the
 * LAN IP on a phone — via `lynxAssetUrl('/api/chat')`, with no CORS and no
 * extra port.
 *
 * Provider-agnostic: it speaks the OpenAI-compatible chat-completions API,
 * which Gemini, Groq, OpenRouter, Ollama and others all serve. Configured
 * from the environment or `examples/genui/.env.local` (gitignored):
 *
 *   GEMINI_API_KEY   the key (or LLM_API_KEY for any other provider)
 *   LLM_BASE_URL     default: Gemini's OpenAI-compatible endpoint
 *   LLM_MODEL        default: the newest available Gemini Flash model
 *
 * Logs one line per request (model, latency, size) — never message content.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

import type { RsbuildPlugin } from '@lynx-js/rspeedy';

import {
  chatRequestBody,
  describeHttpError,
  GEMINI_BASE_URL,
  messageWindow,
  pickModel,
  sendWithRetry,
  type WireMessage,
} from '../src/planner/llm-wire.js';
import { buildPlannerSystemPrompt } from './prompt.js';

export { pickGeminiModel } from '../src/planner/llm-wire.js';

const MAX_BODY_BYTES = 512 * 1024;

export interface LlmEnv {
  baseUrl: string;
  apiKey: string | undefined;
  model: string | undefined;
  provider: string;
  /** `PLANNER_EMBED_KEY=true`: also bake the key into the app bundle (demo builds). */
  embedKey: boolean;
  /** `PLANNER_DEBUG_LOG=true`: save every exchange under `.planner-logs/` (gitignored). */
  debugLog: boolean;
}

type Next = (error?: unknown) => void;

/** LLM settings from the environment, falling back to `<root>/.env.local` (real env vars win). */
export function readLlmEnv(root: string): LlmEnv {
  const envFile = join(root, '.env.local');
  if (existsSync(envFile)) {
    // Real environment variables win over the file.
    for (const [key, value] of Object.entries(parseEnv(readFileSync(envFile, 'utf8')))) {
      if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
    }
  }
  const baseUrl = (process.env['LLM_BASE_URL'] || GEMINI_BASE_URL).replace(/\/+$/, '');
  const gemini = baseUrl.includes('generativelanguage.googleapis.com');
  return {
    baseUrl,
    apiKey: process.env['LLM_API_KEY'] || (gemini ? process.env['GEMINI_API_KEY'] : undefined) || undefined,
    model: process.env['LLM_MODEL'] || undefined,
    provider: gemini ? 'Gemini' : new URL(baseUrl).hostname,
    embedKey: /^(1|true|yes)$/i.test(process.env['PLANNER_EMBED_KEY'] ?? ''),
    debugLog: /^(1|true|yes)$/i.test(process.env['PLANNER_DEBUG_LOG'] ?? ''),
  };
}

async function resolveModel(config: LlmEnv): Promise<string> {
  if (config.model) return config.model;
  const res = await fetch(`${config.baseUrl}/models`, { headers: { Authorization: `Bearer ${config.apiKey}` } });
  if (!res.ok) throw new Error(`${config.provider} rejected the model listing (HTTP ${res.status}) — check the API key`);
  const picked = pickModel(config.provider, await res.json());
  if (!picked) throw new Error(`no usable model found at ${config.baseUrl}; set LLM_MODEL`);
  return picked;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

type ChatMessage = WireMessage;

function validMessages(body: unknown): ChatMessage[] | undefined {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  const ok = messages.every(
    (m) =>
      m && typeof m === 'object' &&
      ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
      typeof (m as ChatMessage).content === 'string' &&
      (m as ChatMessage).content.length <= 40_000,
  );
  if (!ok) return undefined;
  const recent = messageWindow(messages as ChatMessage[]);
  return recent.length > 0 ? recent : undefined;
}

/** Relay an OpenAI-style SSE stream as plain text deltas. */
async function relayStream(upstream: Response, res: ServerResponse): Promise<string> {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sent = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return sent;
      try {
        const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
        if (delta) {
          res.write(delta);
          sent += delta;
        }
      } catch {
        // A keep-alive or a provider-specific event we don't need.
      }
    }
  }
  return sent;
}

/**
 * Opt-in (`PLANNER_DEBUG_LOG=true`): append each exchange — the user turn the
 * model saw and the screen it sent back — to `.planner-logs/<date>.log`, so a
 * broken screen can be read instead of guessed at. Local and gitignored; it
 * contains whatever you typed, so leave it off otherwise.
 */
function writeDebugLog(root: string, model: string, userTurn: string, response: string): void {
  try {
    const dir = join(root, '.planner-logs');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString();
    const entry = [
      `===== ${stamp} · ${model}`,
      '----- user turn',
      userTurn,
      '----- model response',
      response,
      '',
    ].join('\n');
    appendFileSync(join(dir, `${stamp.slice(0, 10)}.log`), `${entry}\n`);
  } catch (error) {
    console.warn(`[planner-api] could not write the debug log: ${(error as Error).message}`);
  }
}

export function createPlannerApi(root: string) {
  let config = readLlmEnv(root);
  let model: Promise<string> | undefined;
  const getModel = () =>
    (model ??= resolveModel(config).catch((error: unknown) => {
      model = undefined; // retry on the next request (e.g. after fixing the key)
      throw error;
    }));

  const log = (message: string) => console.log(`[planner-api] ${message}`);
  log(
    config.apiKey
      ? `${config.provider} configured (${config.model ?? 'model: auto'}) — the planner will use the real LLM` +
          (config.debugLog ? '; logging exchanges to .planner-logs/' : '')
      : 'no API key (set GEMINI_API_KEY in examples/genui/.env.local) — the planner runs its offline demo agent',
  );

  async function health(res: ServerResponse): Promise<void> {
    if (!config.apiKey) {
      sendJson(res, 200, { configured: false, provider: config.provider, reason: 'No API key configured on the dev server' });
      return;
    }
    try {
      sendJson(res, 200, { configured: true, provider: config.provider, model: await getModel() });
    } catch (error) {
      sendJson(res, 200, { configured: false, provider: config.provider, reason: (error as Error).message });
    }
  }

  async function chat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!config.apiKey) {
      sendJson(res, 503, { error: 'not_configured', message: 'No API key configured on the dev server' });
      return;
    }
    let messages: ChatMessage[] | undefined;
    try {
      messages = validMessages(await readJson(req));
    } catch (error) {
      sendJson(res, 400, { error: 'bad_request', message: (error as Error).message });
      return;
    }
    if (!messages) {
      sendJson(res, 400, { error: 'bad_request', message: 'expected { messages: [{ role, content }] }' });
      return;
    }

    const started = Date.now();
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    let modelId: string;
    let upstream: Response;
    try {
      modelId = await getModel();
      upstream = await sendWithRetry(
        () =>
          fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            signal: abort.signal,
            headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
            body: chatRequestBody(modelId, buildPlannerSystemPrompt(), messages),
          }),
        (status, attempt) => log(`${modelId} → HTTP ${status}, retry ${attempt}`),
      );
    } catch (error) {
      sendJson(res, 502, { error: 'upstream_unreachable', message: (error as Error).message });
      return;
    }

    if (!upstream.ok || !upstream.body) {
      const detail = (await upstream.text().catch(() => '')).slice(0, 600);
      log(`${modelId} → HTTP ${upstream.status} after ${Date.now() - started} ms`);
      const { code, message } = describeHttpError(config.provider, upstream.status, detail);
      sendJson(res, upstream.status === 429 ? 429 : 502, { error: code, status: upstream.status, message, detail });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Planner-Model': modelId,
    });
    try {
      const text = await relayStream(upstream, res);
      log(`${modelId} → ${text.length} chars in ${Date.now() - started} ms (${messages.length} messages)`);
      if (config.debugLog) writeDebugLog(root, modelId, messages.at(-1)?.content ?? '', text);
    } catch (error) {
      if (!abort.signal.aborted) log(`${modelId} stream failed: ${(error as Error).message}`);
    } finally {
      res.end();
    }
  }

  /** Pick up a key added to `.env.local` after startup — no server restart needed. */
  function refreshIfUnconfigured(): void {
    if (config.apiKey) return;
    config = readLlmEnv(root);
    if (config.apiKey) {
      model = undefined;
      log(`${config.provider} key found in .env.local — switching the planner to the real LLM`);
    }
  }

  return function plannerApi(req: IncomingMessage, res: ServerResponse, next: Next): void {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/api/health' || path === '/api/chat') refreshIfUnconfigured();
    if (path === '/api/health' && req.method === 'GET') {
      void health(res);
    } else if (path === '/api/chat' && req.method === 'POST') {
      void chat(req, res);
    } else {
      next();
    }
  };
}

/**
 * Mounts {@link createPlannerApi} ahead of rsbuild's built-in middlewares
 * (so compression never buffers the stream). A plugin rather than a
 * `server:` key because rspeedy's config schema doesn't expose rsbuild's
 * `server.setup`.
 */
export function pluginPlannerApi(options: { root: string }): RsbuildPlugin {
  return {
    name: 'planner:llm-proxy',
    setup(api) {
      api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
        mergeRsbuildConfig(config, {
          server: {
            setup: ({ server }) => {
              server.middlewares.use(createPlannerApi(options.root));
            },
          },
        }),
      );
    },
  };
}
