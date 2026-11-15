/**
 * Who answers. In order of preference:
 *
 *  1. **Direct** — the bundle carries an API key (`PLANNER_EMBED_KEY=true`
 *     at build time; demo builds only) and calls the provider itself. Works
 *     anywhere the app runs, no server needed. Used even in dev when present,
 *     so what you test is what you ship.
 *  2. **Proxy** — the dev server's `/api/chat`, which keeps the key on the
 *     server. Found at the origin this bundle was served from
 *     (`lynxAssetUrl`): `localhost` in the web preview, the dev machine's LAN
 *     IP on a phone.
 *  3. **Offline** — the scripted agent: no key, or no server reachable (a
 *     production build without an embedded key).
 *
 * All three return OpenUI Lang, streamed as a growing string, so the planner
 * screen doesn't care which it has.
 */
import { lynxAssetUrl } from 'ng-lynx';

import type { ChatMessage } from './conversation.js';
import { chatRequestBody, describeHttpError, type EmbeddedLlmConfig, pickModel, sendWithRetry, sseText } from './llm-wire.js';
import type { PlannerProfile } from './profile.js';
import { nextScriptedScreen } from './scripted.js';
import { createUtf8Decoder, StreamText } from './stream-text.js';

/** Defined by `server/embed.ts`: the embedded LLM config, or `null`. */
declare const __PLANNER_EMBEDDED__: EmbeddedLlmConfig | null;

/** Lynx's runtime global (ng-lynx `system-info.ts`); `'web'` in the web preview. */
declare const SystemInfo: { platform?: string } | undefined;

/**
 * Can this runtime fetch `url`? A browser resolves a relative URL against the
 * page, so `rspeedy preview` still reaches its proxy. Lynx's fetch on a device
 * doesn't: a build served without an absolute asset prefix gets `/api/health`
 * back from `lynxAssetUrl`, and Android rejects it ("Expected URL scheme
 * 'http' or 'https'") with a red error toast in Explorer.
 */
function canFetch(url: string): boolean {
  if (/^https?:\/\//i.test(url)) return true;
  return typeof SystemInfo !== 'undefined' && SystemInfo?.platform === 'web';
}

function embeddedConfig(): EmbeddedLlmConfig | null {
  try {
    return typeof __PLANNER_EMBEDDED__ === 'undefined' ? null : __PLANNER_EMBEDDED__;
  } catch {
    return null; // a build without the define (e.g. a harness)
  }
}

export interface AgentInfo {
  kind: 'llm' | 'offline';
  /** Short badge text, e.g. "Gemini · gemini-3-flash-preview". */
  label: string;
  /** Why we're offline, when we are. */
  reason?: string;
}

export interface Agent {
  readonly info: AgentInfo;
  /** Resolve with the full response; `onText` gets the accumulated text as it streams. */
  respond(messages: ChatMessage[], profile: PlannerProfile, onText: (text: string) => void): Promise<string>;
}

export class AgentError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AgentError(`no answer in ${ms / 1000}s`, 'timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Strip what models add around raw OpenUI Lang despite being told not to: a
 * Markdown code fence (```openui … ```), possibly still open mid-stream.
 */
export function cleanResponse(text: string): string {
  return text
    .replace(/^\s*```[\w-]*\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trimStart();
}

async function readText(res: Response, onText: (text: string) => void): Promise<string> {
  const body = (res as { body?: { getReader?: () => ReadableStreamDefaultReader<unknown> } | null }).body;
  const decode = createUtf8Decoder();
  if (body?.getReader && decode) {
    // Streaming path: web preview always; device with `enableFetchAPIStandardStreaming`.
    // Chunk shapes differ per runtime — see stream-text.ts.
    const reader = body.getReader();
    const stream = new StreamText(decode);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onText(stream.push(value));
    }
    const text = stream.text();
    if (!text && stream.byteLength > 0) {
      console.warn(`[planner] received ${stream.byteLength} bytes but decoded no text`);
    }
    onText(text);
    return text;
  }
  // Whole-body fallback: the screen appears at once instead of streaming in.
  const text = await res.text();
  onText(text);
  return text;
}

class LlmAgent implements Agent {
  constructor(readonly info: AgentInfo) {}

  async respond(messages: ChatMessage[], _profile: PlannerProfile, onText: (text: string) => void): Promise<string> {
    const res = await withTimeout(
      fetch(lynxAssetUrl('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      }),
      60_000,
    );
    if (!res.ok) {
      let message = `the planner API returned HTTP ${res.status}`;
      let code = 'http';
      try {
        const body = (await res.json()) as { message?: string; error?: string };
        message = body.message ?? message;
        code = body.error ?? code;
      } catch {
        // not JSON — keep the status line
      }
      throw new AgentError(message, code);
    }
    const text = await withTimeout(readText(res, (partial) => onText(cleanResponse(partial))), 90_000);
    return cleanResponse(text);
  }
}

/** Talks to the provider straight from the app, with the key baked into the bundle. */
class DirectAgent implements Agent {
  constructor(
    readonly info: AgentInfo,
    private readonly config: EmbeddedLlmConfig,
    private readonly model: string,
  ) {}

  async respond(messages: ChatMessage[], _profile: PlannerProfile, onText: (text: string) => void): Promise<string> {
    const res = await withTimeout(
      sendWithRetry(() =>
        fetch(`${this.config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
          body: chatRequestBody(this.model, this.config.systemPrompt, messages),
        }),
      ),
      60_000,
    );
    if (!res.ok) {
      const { code, message } = describeHttpError(this.config.provider, res.status, await res.text().catch(() => ''));
      throw new AgentError(message, code);
    }
    // The body is raw SSE; `sseText` turns what has arrived so far into text.
    const raw = await withTimeout(readText(res, (partial) => onText(cleanResponse(sseText(partial)))), 90_000);
    return cleanResponse(sseText(raw.endsWith('\n') ? raw : `${raw}\n`));
  }
}

async function connectDirect(config: EmbeddedLlmConfig): Promise<Agent> {
  let model = config.model;
  if (!model) {
    const res = await withTimeout(
      fetch(`${config.baseUrl}/models`, { headers: { Authorization: `Bearer ${config.apiKey}` } }),
      8_000,
    );
    if (!res.ok) {
      throw new AgentError(describeHttpError(config.provider, res.status, await res.text().catch(() => '')).message, 'auth');
    }
    model = pickModel(config.provider, await res.json());
    if (!model) throw new AgentError(`no usable ${config.provider} model found — set LLM_MODEL`, 'model');
  }
  return new DirectAgent({ kind: 'llm', label: `${config.provider} · ${model} · in-app key` }, config, model);
}

const CHUNK = 28;
const CHUNK_DELAY_MS = 30;

/** Replays the next canned screen in chunks, so offline mode streams like the real thing. */
export class ScriptedAgent implements Agent {
  readonly info: AgentInfo;

  constructor(reason: string) {
    this.info = { kind: 'offline', label: 'Offline demo agent', reason };
  }

  respond(messages: ChatMessage[], profile: PlannerProfile, onText: (text: string) => void): Promise<string> {
    // Not `.at(-1)`: PrimJS (Lynx on device) is ~ES2019 and has no Array.prototype.at.
    const last = messages[messages.length - 1]?.content ?? '';
    const typed = /<user_message>\n([\s\S]*?)\n<\/user_message>/.exec(last)?.[1] ?? '';
    const button = /<form_submission button="([^"]*)"/.exec(last)?.[1] ?? '';
    const screen = nextScriptedScreen(profile, `${typed} ${button}`);
    return new Promise((resolve) => {
      let offset = 0;
      const timer = setInterval(() => {
        offset = Math.min(screen.length, offset + CHUNK);
        onText(screen.slice(0, offset));
        if (offset >= screen.length) {
          clearInterval(timer);
          resolve(screen);
        }
      }, CHUNK_DELAY_MS);
    });
  }
}

/** Direct if the bundle carries a key, else the dev-server proxy, else offline. */
export async function connectAgent(): Promise<Agent> {
  const embedded = embeddedConfig();
  if (embedded) {
    try {
      return await connectDirect(embedded);
    } catch (error) {
      return new ScriptedAgent(`The in-app ${embedded.provider} key didn't work (${(error as Error).message})`);
    }
  }
  const healthUrl = lynxAssetUrl('/api/health');
  if (!canFetch(healthUrl)) return new ScriptedAgent('No dev server for this build');
  try {
    const res = await withTimeout(fetch(healthUrl), 5_000);
    if (!res.ok) return new ScriptedAgent('The planner API is not available (production build?)');
    const health = (await res.json()) as { configured?: boolean; provider?: string; model?: string; reason?: string };
    if (health.configured && health.model) {
      return new LlmAgent({ kind: 'llm', label: `${health.provider ?? 'LLM'} · ${health.model}` });
    }
    return new ScriptedAgent(health.reason ?? 'No LLM configured on the dev server');
  } catch {
    return new ScriptedAgent('Could not reach the dev server');
  }
}
