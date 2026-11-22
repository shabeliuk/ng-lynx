/**
 * Headless verification of HttpClient-over-fetch on Lynx
 * (`provideLynxHttpClient`).
 *
 * The real `@angular/common/http` FetchBackend runs against a mocked global
 * `fetch` that returns **Node's native `Response`** objects — so the entire
 * production read path executes: `AbortController` setup, the
 * `response.body.getReader()` stream loop, `TextDecoder` body decoding, and
 * JSON parsing. Covered:
 *
 *  - a typed JSON GET renders into the view (zoneless CD picks up the
 *    subscribe callback's signal write);
 *  - a functional interceptor (`withInterceptors`) mutates the outgoing
 *    request — asserted on the headers the fetch mock actually received;
 *  - a 500 response surfaces as `HttpErrorResponse` with the parsed error
 *    body.
 *
 * Run with: `npm run verify:http`.
 */
import '@angular/compiler';

import { HttpClient, type HttpInterceptorFn, withInterceptors } from '@angular/common/http';
import { Component, inject, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication } from 'ng-lynx';
import { installStreamlessFetchShim, provideLynxHttpClient } from 'ng-lynx/http';
import 'ng-lynx/main-thread';

import { assert, findText, getPage, installMockPapi, tick } from './mock-papi.js';

// --- fetch mock: canned Node Response objects + request capture -------------
const seenRequests: { url: string; headers: Record<string, string> }[] = [];

function installFetchMock(): void {
  (globalThis as Record<string, unknown>).fetch = async (
    url: string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    seenRequests.push({ url: String(url), headers });
    if (String(url).includes('/fail')) {
      return new Response(JSON.stringify({ message: 'boom' }), {
        status: 500,
        statusText: 'Server Error',
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ title: 'Hello from fetch' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

// --- app ---------------------------------------------------------------------
const authInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ setHeaders: { 'x-lynx-auth': 'token-42' } }));

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      <text class="title">{{ title() }}</text>
      <text class="err">{{ error() }}</text>
    </view>
  `,
})
export class TestComponent {
  private readonly http = inject(HttpClient);
  readonly title = signal('loading');
  readonly error = signal('no-error');

  constructor() {
    this.http.get<{ title: string }>('https://api.example.test/data').subscribe((data) => {
      this.title.set(data.title);
    });
    this.http.get('https://api.example.test/fail').subscribe({
      error: (err: { status?: number; error?: { message?: string } }) => {
        this.error.set(`error:${err.status}:${err.error?.message}`);
      },
    });
  }
}

async function main(): Promise<void> {
  installMockPapi();
  installFetchMock();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent, {
    providers: [provideLynxHttpClient(withInterceptors([authInterceptor]))],
  });
  // fetch resolves over real macro/microtasks — settle a few times.
  await tick();
  await tick();
  await tick();
  const page = getPage();

  console.log('\n=== Typed JSON GET through the real FetchBackend ===');
  assert(
    findText(page, 'Hello from fetch') != null,
    'response body decoded (stream reader + TextDecoder) and rendered zonelessly',
  );

  console.log('\n=== Interceptors ===');
  const dataReq = seenRequests.find((r) => r.url.endsWith('/data'));
  assert(!!dataReq, 'fetch mock saw the request');
  assert(
    dataReq?.headers['x-lynx-auth'] === 'token-42',
    'functional interceptor header reached the wire',
  );

  console.log('\n=== Error responses ===');
  assert(
    findText(page, 'error:500:boom') != null,
    '500 surfaced as HttpErrorResponse with the parsed JSON error body',
  );
  assert(seenRequests.length === 2, 'exactly the two expected requests were made');

  await verifyStreamlessShim(app);
  await verifyLynxEngineFetch(app);

  console.log('\n✅ All HttpClient assertions passed — provideLynxHttpClient works.\n');
}

/**
 * A stream-less engine fetch must still deliver bodies.
 *
 * Angular's FetchBackend reads bodies only via `response.body.getReader()`,
 * behind a bare `if (response.body)` with no `else` — so on an engine whose
 * fetch returns responses with `body == null`, every request would *succeed*
 * with a silently `null` body. `installStreamlessFetchShim()` synthesizes a
 * one-chunk reader from `arrayBuffer()` for exactly those responses.
 *
 * This drives the real shim over a hand-built stream-less response (Node's
 * `Response` always has a stream, so one is faked here the way a
 * non-compliant engine would return it).
 */
async function verifyStreamlessShim(app: import('@angular/core').ApplicationRef): Promise<void> {
  console.log('\n=== Stream-less engine fetch (response.body == null) ===');
  const g = globalThis as Record<string, unknown>;
  const realFetch = g['fetch'];

  const payload = JSON.stringify({ title: 'From a stream-less response' });
  const bytes = new TextEncoder().encode(payload);
  let arrayBufferCalls = 0;
  g['fetch'] = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    url: 'https://example.test/streamless',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: null, // <- the whole point: no ReadableStream
    arrayBuffer: async () => {
      arrayBufferCalls++;
      return bytes.buffer.slice(0);
    },
  });

  assert(installStreamlessFetchShim() === true, 'the shim installed over the engine fetch');
  assert(installStreamlessFetchShim() === false, 'installing twice is a no-op (idempotent)');

  const shimmed = g['fetch'] as (u: string) => Promise<{ body: { getReader(): any } }>;
  const response = await shimmed('https://example.test/streamless');
  assert(!!response.body, 'the shimmed response now exposes a body');

  const reader = response.body.getReader();
  const first = await reader.read();
  assert(
    first.done === false && new TextDecoder().decode(first.value) === payload,
    'its reader yields the full body in one chunk, decoded correctly',
  );
  const second = await reader.read();
  assert(second.done === true, 'the second read reports done — the stream terminates');
  assert(arrayBufferCalls === 1, 'the body was buffered exactly once');

  console.log('\n=== End-to-end: a real HttpClient request over the stream-less fetch ===');
  // The point of the shim isn't the reader in isolation — it's that
  // FetchBackend, which only reads bodies through `response.body.getReader()`,
  // now gets a parsed body instead of a silent `null`.
  const http = app.injector.get(HttpClient);
  const received = await new Promise<unknown>((resolve, reject) => {
    http.get('https://example.test/streamless').subscribe({ next: resolve, error: reject });
  });
  assert(
    (received as { title?: string })?.title === 'From a stream-less response',
    'HttpClient parsed the JSON body — without the shim this resolves to null, silently',
  );

  console.log('\n=== A compliant response is passed through untouched ===');
  const realBody = { getReader: () => ({ read: async () => ({ done: true }) }) };
  const passthrough = { ok: true, status: 200, statusText: 'OK', url: '', headers: new Headers(), body: realBody, arrayBuffer: async () => new ArrayBuffer(0) };
  g['fetch'] = async () => passthrough;
  installStreamlessFetchShim();
  const untouched = await (g['fetch'] as (u: string) => Promise<{ body: unknown }>)('x');
  assert(untouched.body === realBody, 'a response that already streams is returned as-is, not re-wrapped');

  g['fetch'] = realFetch;
}

/**
 * What a device actually has (Lynx Explorer 4.2, found by a real app):
 *
 * - **no global `fetch`**: Lynx hands `fetch` to each bundle as a wrapper
 *   parameter, `fetch = fetch || lynx.fetch`, and FetchBackend calls
 *   `globalThis.fetch(...)`, so every request failed with "not a function";
 * - **responses without a stream**, whose `body` getter uses the body up:
 *   reading it, even to check it, makes a later `text()` fail.
 *
 * This fakes exactly that engine and drives a real HttpClient request through it.
 */
async function verifyLynxEngineFetch(app: import('@angular/core').ApplicationRef): Promise<void> {
  console.log('\n=== The engine fetch: no global fetch, lynx.fetch only ===');
  const g = globalThis as Record<string, unknown>;
  const realFetch = g['fetch'];
  const hadLynx = 'lynx' in g;
  const realLynx = g['lynx'];

  let bodyReads = 0;
  let failNext = false;
  let calledWith: { url?: string; self?: unknown } = {};
  const engine = {
    fetch(this: unknown, url: string) {
      calledWith = { url, self: this };
      if (failNext) return Promise.reject(new TypeError('Network request failed'));
      let used = false;
      const response = {
        ok: true,
        status: 200,
        statusText: 'OK',
        url,
        headers: new Headers({ 'content-type': 'application/json' }),
        get body() {
          // What Lynx does: reading the body uses it up.
          bodyReads++;
          used = true;
          return undefined;
        },
        async text() {
          if (used) throw new Error('body used');
          used = true;
          return JSON.stringify({ title: 'From lynx.fetch', price: '61,234.56 €' });
        },
      };
      return Promise.resolve(response);
    },
  };
  delete g['fetch'];
  g['lynx'] = { ...(realLynx as object), fetch: engine.fetch };

  assert(installStreamlessFetchShim() === true, 'with no global fetch, the shim installs lynx.fetch as the global');
  assert(typeof g['fetch'] === 'function', 'globalThis.fetch exists now, where FetchBackend looks for it');

  const http = app.injector.get(HttpClient);
  const received = await new Promise<unknown>((resolve, reject) => {
    http.get('https://example.test/engine').subscribe({ next: resolve, error: reject });
  });
  const data = received as { title?: string; price?: string };
  assert(data?.title === 'From lynx.fetch', 'HttpClient parsed the JSON body from the engine response');
  assert(data?.price === '61,234.56 €', 'non-ASCII text survives the UTF-8 round trip');
  assert(bodyReads === 0, 'the response body getter was never read (it would have used the body up)');
  assert(calledWith.url === 'https://example.test/engine', 'the request reached lynx.fetch');
  assert(calledWith.self === g['lynx'], 'lynx.fetch was called with lynx as `this`');

  console.log('\n=== A failed engine response still surfaces as an error ===');
  failNext = true;
  const failure = await new Promise<unknown>((resolve) => {
    http.get('https://example.test/engine').subscribe({ next: () => resolve('next'), error: resolve });
  });
  assert((failure as { status?: number })?.status === 0, 'a network failure is an HttpErrorResponse with status 0');

  g['fetch'] = realFetch;
  if (hadLynx) g['lynx'] = realLynx;
  else delete g['lynx'];
}

main().catch((err) => {
  console.error('\n❌ HttpClient verification failed:\n', err);
  process.exit(1);
});
