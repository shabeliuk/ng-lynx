/**
 * The shared wire helpers the in-app client and the proxy both use, and the
 * build-time switch that decides whether the key goes into the bundle.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import { plannerDefines } from '../server/embed.ts';
import { describeHttpError, messageWindow, RETRY_DELAYS_MS, sendWithRetry, sseText } from '../src/planner/llm-wire.ts';

const event = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

describe('sseText', () => {
  const stream = event('root = Stack([t])\n') + ': keep-alive\n\n' + event('t = Text("£1")') + 'data: [DONE]\n\n';

  it('joins the deltas of a whole stream', () => {
    assert.equal(sseText(stream), 'root = Stack([t])\nt = Text("£1")');
  });

  it('ignores a half-received event at any cut point', () => {
    for (let cut = 0; cut <= stream.length; cut++) {
      const partial = sseText(stream.slice(0, cut));
      assert.ok('root = Stack([t])\nt = Text("£1")'.startsWith(partial), `cut ${cut}: ${JSON.stringify(partial)}`);
    }
  });

  it('accepts a non-streamed completion body', () => {
    assert.equal(sseText(JSON.stringify({ choices: [{ message: { content: 'root = Stack([])' } }] })), 'root = Stack([])');
  });
});

describe('messageWindow', () => {
  it('keeps the last 24 messages, opening on a user turn', () => {
    const messages = Array.from({ length: 31 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }) as const);
    const window = messageWindow(messages);
    assert.equal(window[0]!.role, 'user');
    assert.ok(window.length <= 24);
    assert.equal(window.at(-1)!.content, 'm30');
  });
});

describe('describeHttpError', () => {
  it('explains rate limits and rejected keys', () => {
    assert.equal(describeHttpError('Gemini', 429, '').code, 'rate_limited');
    const rejected = describeHttpError('Gemini', 400, '{"error":{"message":"Please pass a valid API key"}}');
    assert.equal(rejected.code, 'auth');
    assert.match(rejected.message, /Please pass a valid API key/);
  });

  it('calls a 503 what it is: the model is overloaded', () => {
    const overloaded = describeHttpError('Gemini', 503, '');
    assert.equal(overloaded.code, 'overloaded');
    assert.match(overloaded.message, /overloaded/);
  });
});

describe('sendWithRetry', () => {
  const noWait = () => Promise.resolve();
  const responder = (statuses: number[]) => {
    const calls: number[] = [];
    const send = () => {
      const status = statuses[calls.length] ?? 200;
      calls.push(status);
      return Promise.resolve(new Response(status === 200 ? 'ok' : 'busy', { status }));
    };
    return { send, calls };
  };

  it('retries 503s until one succeeds', async () => {
    const { send, calls } = responder([503, 503, 200]);
    const retries: number[] = [];
    const res = await sendWithRetry(send, (_status, attempt) => retries.push(attempt), noWait);
    assert.equal(res.status, 200);
    assert.deepEqual(calls, [503, 503, 200]);
    assert.deepEqual(retries, [1, 2]);
  });

  it(`gives up after ${RETRY_DELAYS_MS.length} retries and hands back the error`, async () => {
    const { send, calls } = responder([503, 503, 503, 503]);
    const res = await sendWithRetry(send, undefined, noWait);
    assert.equal(res.status, 503);
    assert.equal(calls.length, RETRY_DELAYS_MS.length + 1);
  });

  it("doesn't retry a rate limit or a rejected key", async () => {
    for (const status of [429, 400]) {
      const { send, calls } = responder([status]);
      assert.equal((await sendWithRetry(send, undefined, noWait)).status, status);
      assert.equal(calls.length, 1);
    }
  });
});

describe('plannerDefines (build-time key embedding)', () => {
  const SENTINEL = 'sentinel-not-a-real-key-5c21';
  const envKeys = ['GEMINI_API_KEY', 'LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'PLANNER_EMBED_KEY'];
  const rootWith = (contents: string) => {
    const root = mkdtempSync(join(tmpdir(), 'planner-embed-'));
    writeFileSync(join(root, '.env.local'), contents);
    return root;
  };

  beforeEach(() => {
    for (const key of envKeys) delete process.env[key];
  });

  it('embeds nothing by default, even with a key present', () => {
    const defines = plannerDefines(rootWith(`GEMINI_API_KEY=${SENTINEL}\n`));
    assert.deepEqual(defines, { __PLANNER_EMBEDDED__: 'null' });
  });

  it('embeds key, provider and system prompt with PLANNER_EMBED_KEY=true', () => {
    const defines = plannerDefines(rootWith(`GEMINI_API_KEY=${SENTINEL}\nPLANNER_EMBED_KEY=true\n`));
    const embedded = JSON.parse(defines['__PLANNER_EMBEDDED__']!);
    assert.equal(embedded.apiKey, SENTINEL);
    assert.equal(embedded.provider, 'Gemini');
    assert.match(embedded.baseUrl, /generativelanguage\.googleapis\.com/);
    assert.match(embedded.systemPrompt, /PlanSummary\(plan: any\)/);
    assert.equal(embedded.model, undefined, 'no LLM_MODEL → picked at startup');
  });

  it('carries a pinned model and ignores the flag without a key', () => {
    const pinned = JSON.parse(
      plannerDefines(rootWith(`GEMINI_API_KEY=${SENTINEL}\nPLANNER_EMBED_KEY=1\nLLM_MODEL=gemini-2.5-flash\n`))['__PLANNER_EMBEDDED__']!,
    );
    assert.equal(pinned.model, 'gemini-2.5-flash');
    for (const key of envKeys) delete process.env[key];
    assert.deepEqual(plannerDefines(rootWith('PLANNER_EMBED_KEY=true\n')), { __PLANNER_EMBEDDED__: 'null' });
  });
});
