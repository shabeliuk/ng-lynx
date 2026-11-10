/**
 * The dev-server LLM proxy, end to end against a fake OpenAI-compatible
 * upstream — model auto-pick, SSE → plain-text relay, the system prompt
 * reaching the model, request validation, and error mapping. No real key,
 * no network beyond localhost.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createPlannerApi, pickGeminiModel } from '../server/llm-proxy.ts';

describe('pickGeminiModel', () => {
  it('takes the newest plain Flash, preferring GA over preview', () => {
    const ids = [
      'models/gemini-2.0-flash', 'models/gemini-2.5-flash', 'models/gemini-2.5-flash-lite', 'models/gemini-2.5-pro',
      'models/gemini-2.5-flash-image', 'models/gemini-3-flash-preview', 'models/text-embedding-004',
    ];
    assert.equal(pickGeminiModel(ids), 'gemini-3-flash-preview');
    assert.equal(pickGeminiModel([...ids, 'models/gemini-3-flash']), 'gemini-3-flash');
    assert.equal(pickGeminiModel(['models/gemini-2.5-pro']), undefined);
  });
});

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );

async function readBody(req: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

describe('planner API proxy', () => {
  let upstream: Server;
  let proxy: Server;
  let proxyUrl: string;
  let lastRequest: { authorization?: string; body: Record<string, unknown> } | undefined;
  let mode: 'ok' | 'rate-limit' | 'overloaded-once' = 'ok';

  before(async () => {
    upstream = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'fake-model-a' }, { id: 'fake-model-b' }] }));
        return;
      }
      lastRequest = { authorization: req.headers.authorization, body: JSON.parse(await readBody(req)) };
      if (mode === 'rate-limit') {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end('{"error":{"message":"quota"}}');
        return;
      }
      if (mode === 'overloaded-once') {
        mode = 'ok';
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const piece of ['root = Stack([t])\n', 't = Text("Hi £', '1")']) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      }
      res.write(': keep-alive\n\n');
      res.end('data: [DONE]\n\n');
    });
    const upstreamUrl = await listen(upstream);

    process.env['LLM_BASE_URL'] = `${upstreamUrl}/v1`;
    process.env['LLM_API_KEY'] = 'test-key';
    delete process.env['LLM_MODEL'];
    const api = createPlannerApi(mkdtempSync(join(tmpdir(), 'planner-')));
    proxy = createServer((req, res) =>
      api(req, res, () => {
        res.writeHead(404);
        res.end();
      }),
    );
    proxyUrl = await listen(proxy);
  });

  after(() => {
    upstream.close();
    proxy.close();
  });

  it('reports health with the auto-picked model', async () => {
    const health = await (await fetch(`${proxyUrl}/api/health`)).json();
    assert.deepEqual(health, { configured: true, provider: '127.0.0.1', model: 'fake-model-a' });
  });

  it('streams the model output as plain text, with the system prompt prepended', async () => {
    mode = 'ok';
    const res = await fetch(`${proxyUrl}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'I want to retire at 60' }] }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-planner-model'), 'fake-model-a');
    assert.equal(await res.text(), 'root = Stack([t])\nt = Text("Hi £1")');
    assert.equal(lastRequest?.authorization, 'Bearer test-key');
    const sent = lastRequest!.body['messages'] as { role: string; content: string }[];
    assert.equal(sent[0]!.role, 'system');
    assert.match(sent[0]!.content, /PlanSummary\(plan: any\)/);
    assert.deepEqual(sent[1], { role: 'user', content: 'I want to retire at 60' });
    assert.equal(lastRequest!.body['stream'], true);
  });

  it('trims history to a window that opens on a user turn', async () => {
    const messages = Array.from({ length: 31 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
    await (await fetch(`${proxyUrl}/api/chat`, { method: 'POST', body: JSON.stringify({ messages }) })).text();
    const sent = lastRequest!.body['messages'] as { role: string; content: string }[];
    assert.equal(sent[1]!.role, 'user');
    assert.ok(sent.length - 1 <= 24);
    assert.equal(sent.at(-1)!.content, 'm30');
  });

  it('rejects malformed requests', async () => {
    const res = await fetch(`${proxyUrl}/api/chat`, { method: 'POST', body: JSON.stringify({ messages: [{ role: 'system', content: 'x' }] }) });
    assert.equal(res.status, 400);
  });

  it('maps an upstream 429 to a readable rate-limit error', async () => {
    mode = 'rate-limit';
    const res = await fetch(`${proxyUrl}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 429);
    const body = (await res.json()) as { error: string; message: string };
    assert.equal(body.error, 'rate_limited');
    assert.match(body.message, /rate limit/);
  });

  it('retries a transient upstream 503 ("high demand") instead of failing the turn', async () => {
    mode = 'overloaded-once';
    const res = await fetch(`${proxyUrl}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'root = Stack([t])\nt = Text("Hi £1")');
  });

  it('leaves other paths to the next middleware', async () => {
    assert.equal((await fetch(`${proxyUrl}/main.web.bundle`)).status, 404);
  });
});
