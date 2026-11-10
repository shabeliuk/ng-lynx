/**
 * Headless verification of `lynxEventSource` (angular-lynx/http).
 *
 *  - The parser follows the WHATWG rules: multi-line `data`, named events,
 *    `id`, comments, CRLF and CR line ends, and an event split across chunks,
 *    including a `\r\n` split between two chunks.
 *  - The Observable reads a streamed body from a mocked `lynx.fetch`, emits
 *    unnamed events and only the named ones asked for, completes when the
 *    stream ends, and aborts the request on unsubscribe.
 *  - A response without a stream (fetch's standard streaming off, on a device)
 *    errors with a message naming the setting, instead of hanging.
 *
 * Run with: `npm run verify:event-source`.
 */
import { createSseParser, lynxEventSource, type LynxServerEvent } from '../runtime/src/event-source.js';
import { assert } from '../testing/src/mock-papi.js';

function parseAll(chunks: string[]): LynxServerEvent[] {
  const events: LynxServerEvent[] = [];
  const feed = createSseParser((e) => events.push(e));
  for (const chunk of chunks) feed(chunk);
  return events;
}

// --- parser ------------------------------------------------------------------
{
  const events = parseAll(['data: hello\n\n', 'event: tick\nid: 7\ndata: a\ndata: b\n\n', ': comment\n\n']);
  assert(events.length === 2, `parser: two events, got ${events.length}`);
  assert(events[0]!.type === 'message' && events[0]!.data === 'hello', 'parser: unnamed event is "message"');
  assert(events[1]!.type === 'tick' && events[1]!.data === 'a\nb', 'parser: named event, data lines joined');
  assert(events[1]!.lastEventId === '7', 'parser: id is kept');
}
{
  const events = parseAll(['data: one\r\n\r', '\ndata: two\r\rdata:three\n', '\n']);
  assert(events.length === 3, `parser: CRLF and CR line ends, got ${events.length}`);
  assert(events.map((e) => e.data).join('|') === 'one|two|three', 'parser: data across chunks and line ends');
}
{
  const events = parseAll(['da', 'ta: spl', 'it\n', '\n']);
  assert(events.length === 1 && events[0]!.data === 'split', 'parser: an event split across chunks');
}

// --- Observable over a mocked streaming fetch -------------------------------
const encoder = new TextEncoder();
let aborted = false;
let requestHeaders: Record<string, string> = {};

function mockFetch(chunks: string[] | null, keepOpen = false): void {
  (globalThis as Record<string, unknown>).lynx = {
    fetch: async (_url: string, init: { headers: Record<string, string>; signal?: { addEventListener?: unknown } }) => {
      requestHeaders = init.headers;
      (init.signal as { onabort?: () => void } | undefined) &&
        ((init.signal as AbortSignal).addEventListener('abort', () => (aborted = true)));
      if (!chunks) return { ok: true, status: 200, body: null };
      let i = 0;
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              if (i < chunks.length) return { done: false, value: encoder.encode(chunks[i++]).buffer };
              if (keepOpen) return new Promise(() => {});
              return { done: true };
            },
            cancel: async () => {},
          }),
        },
      };
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 10));

{
  mockFetch(['data: hello\n\n', 'event: tick\ndata: 1\n\n', 'event: other\ndata: x\n\n']);
  const got: LynxServerEvent[] = [];
  let completed = false;
  lynxEventSource('http://x/sse', { events: ['tick'] }).subscribe({
    next: (e) => got.push(e),
    complete: () => (completed = true),
  });
  await flush();
  assert(got.map((e) => `${e.type}:${e.data}`).join(',') === 'message:hello,tick:1', `observable: got ${JSON.stringify(got)}`);
  assert(completed, 'observable: completes when the stream ends');
  assert(requestHeaders.Accept === 'text/event-stream', 'observable: sends Accept: text/event-stream');
}
{
  mockFetch(['data: first\n\n'], true);
  const got: string[] = [];
  const sub = lynxEventSource('http://x/sse').subscribe((e) => got.push(e.data));
  await flush();
  sub.unsubscribe();
  await flush();
  assert(got.join() === 'first', 'observable: emits while the stream stays open');
  assert(aborted, 'observable: unsubscribe aborts the request');
}
{
  mockFetch(null);
  let message = '';
  lynxEventSource('http://x/sse').subscribe({ error: (e: Error) => (message = e.message) });
  await flush();
  assert(message.includes('enableFetchAPIStandardStreaming'), `observable: no stream names the setting, got "${message}"`);
}

console.log('✓ event-source: parser, streaming Observable, abort, and the missing-stream error');
