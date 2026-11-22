/**
 * HttpClient on Lynx — `provideLynxHttpClient()`.
 *
 * Angular's default `HttpClient` backend is **XHR**, which doesn't exist on
 * Lynx. The fetch backend does: Lynx exposes a Fetch API on the Background
 * Thread (and the web preview's worker has the browser's own `fetch`). This
 * helper is `provideHttpClient(withFetch(), ...features)` plus a dev-mode
 * boot check that makes a missing `fetch` global legible immediately instead
 * of at the first request.
 *
 * What Angular's `FetchBackend` (v21) actually touches at request time —
 * verified against `@angular/common`'s compiled output, not assumed:
 *
 *  - the global `fetch` itself. **On a device there is none**: Lynx hands
 *    `fetch` to each bundle as a parameter of its wrapper
 *    (`fetch = fetch || lynx.fetch`), not as a property of `globalThis`, and
 *    FetchBackend calls `globalThis.fetch(...)`. Every request failed with
 *    "not a function" until 1.0.1 (found by a real app on Explorer 4.2; the
 *    web preview's worker has a real global fetch, which is how it got
 *    through). {@link installStreamlessFetchShim} now puts one there;
 *  - `new AbortController()` (request cancellation) and `new TextDecoder()`
 *    (body decoding) — both beyond ES2019, so entry-background.ts ships
 *    guarded polyfills for PrimJS (same class as the `Object.hasOwn` gap that
 *    once crashed `@angular/forms` on-device);
 *  - `response.headers` / `.status` / `.statusText` / `.url`;
 *  - **`response.body` as a ReadableStream** — FetchBackend reads bodies
 *    exclusively via `response.body.getReader()`; there is *no* fallback to
 *    `response.text()`, and the branch is a bare `if (response.body)` with no
 *    `else`, so a stream-less response yields a **silently `null` body**
 *    rather than an error. Lynx's own `Response` has no stream, and reading
 *    its `body` at all uses the body up, after which `text()` fails or gives
 *    `undefined`. {@link installStreamlessFetchShim} closes both holes — see
 *    its doc.
 *
 * Interceptors (`withInterceptors`), typed responses, and error handling are
 * plain `@angular/common/http` — verified by `npm run verify:http`.
 */
import {
  type HttpFeature,
  type HttpFeatureKind,
  provideHttpClient,
  withFetch,
} from '@angular/common/http';
import {
  type EnvironmentProviders,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from '@angular/core';

/** The slice of `Response` that Angular's FetchBackend actually reads. */
interface FetchLikeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly headers: { get(name: string): string | null };
  readonly body: unknown;
  readonly redirected?: boolean;
  readonly type?: string;
  arrayBuffer?(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
}

type FetchLike = (...args: unknown[]) => Promise<FetchLikeResponse>;

/**
 * Give a stream-less response a **one-chunk `body.getReader()`** synthesized
 * from `arrayBuffer()`.
 *
 * Returns a plain object rather than mutating or subclassing the original:
 * `Response.prototype.body` is a native getter, so it can't be overridden on
 * an instance, and `Object.create(response)` would route the other native
 * getters through a foreign `this` (an "Illegal invocation" in a real
 * browser). The fields copied here are exactly the ones FetchBackend touches
 * (verified against its compiled output — see this module's doc); the
 * body-reading methods are forwarded so anything else holding the response
 * still works.
 */
function withSynthesizedBody(response: FetchLikeResponse): FetchLikeResponse {
  let buffered: Promise<ArrayBuffer> | undefined;
  const body = {
    getReader() {
      let finished = false;
      return {
        async read(): Promise<{ done: boolean; value?: Uint8Array }> {
          if (finished) return { done: true };
          buffered ??= response.arrayBuffer!();
          const chunk = new Uint8Array(await buffered);
          finished = true;
          // A zero-length body must report `done` immediately: FetchBackend
          // concatenates chunks and would otherwise decode an empty chunk as
          // an empty string where `null` is correct.
          return chunk.byteLength === 0 ? { done: true } : { done: false, value: chunk };
        },
        async cancel(): Promise<void> {
          finished = true;
        },
        releaseLock(): void {},
      };
    },
  };
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    headers: response.headers,
    body,
    arrayBuffer: () => (buffered ??= response.arrayBuffer!()),
  };
}

/** UTF-8 bytes of a string. Neither engine has `TextEncoder`. */
function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return new Uint8Array(out);
}

/**
 * A Lynx engine response, made readable by FetchBackend: a one-chunk
 * `body.getReader()` over `text()`.
 *
 * **Never reads `response.body`.** On Lynx (Explorer 4.2, iOS) reading it,
 * even to check it, uses the body up: a later `text()` then fails with "body
 * used" or resolves to `undefined`. So a Lynx response is always read through
 * `text()`, whether or not the page turned on standard streaming.
 */
function withTextBody(response: FetchLikeResponse): FetchLikeResponse {
  let text: Promise<string> | undefined;
  const readText = (): Promise<string> =>
    (text ??= response.text
      ? response.text().then((t) => (typeof t === 'string' ? t : ''))
      : response.arrayBuffer!().then((b) => decodeUtf8(new Uint8Array(b))));
  const body = {
    getReader() {
      let finished = false;
      return {
        async read(): Promise<{ done: boolean; value?: Uint8Array }> {
          if (finished) return { done: true };
          finished = true;
          const bytes = utf8(await readText());
          return bytes.byteLength === 0 ? { done: true } : { done: false, value: bytes };
        },
        async cancel(): Promise<void> {
          finished = true;
        },
        releaseLock(): void {},
      };
    },
  };
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    headers: response.headers,
    redirected: response.redirected,
    type: response.type,
    body,
    text: readText,
    arrayBuffer: () => readText().then((t) => utf8(t).buffer as ArrayBuffer),
  };
}

function decodeUtf8(bytes: Uint8Array): string {
  const Decoder = (globalThis as { TextDecoder?: new () => { decode(b: Uint8Array): string } }).TextDecoder;
  return Decoder ? new Decoder().decode(bytes) : String.fromCharCode(...bytes);
}

// eslint-disable-next-line no-var
declare var lynx: { fetch?: FetchLike } | null | undefined;

/** The engine's own fetch, bound: `lynx.fetch`, which the bundle wrapper's `fetch` is. */
function lynxFetch(): FetchLike | undefined {
  const l = typeof lynx !== 'undefined' ? lynx : undefined;
  const f = l?.fetch;
  return typeof f === 'function' ? (f.bind(l) as FetchLike) : undefined;
}

/**
 * Give Angular's `HttpClient` a `fetch` that works on the engine: put one on
 * `globalThis` where there is none, and make sure every response delivers its
 * body.
 *
 * - **No global `fetch`** (a device): install `lynx.fetch`, wrapped so each
 *   response is read through `text()` and never through `.body`, which on Lynx
 *   uses the body up (see `withTextBody`).
 * - **A global `fetch`** (the web preview, or a compliant engine): responses
 *   that arrive without a readable stream get one built from `arrayBuffer()`.
 *
 * Angular's `FetchBackend` reads bodies only through
 * `response.body.getReader()`, guarded by a bare `if (response.body)` with no
 * `else` — so on an engine whose fetch returns stream-less responses
 * (`response.body == null`), every request *succeeds* with a `null` body and
 * no error anywhere. That's the worst shape of failure, and it's exactly the
 * kind this package polyfills around elsewhere.
 *
 * The wrapper is a no-op on any response that already has a `body` (the web
 * preview's real browser fetch, and any engine with a compliant one), so it
 * costs one property check per request and changes nothing where nothing is
 * wrong. Installed by {@link provideLynxHttpClient}; idempotent.
 *
 * Installing it from an environment initializer (i.e. after `FetchBackend`
 * has already been constructed) is safe, and that's not an assumption:
 * FetchBackend's default `fetchImpl` is
 * `(...args) => globalThis.fetch(...args)` — a lazy read at call time, not a
 * binding captured at construction (verified in `@angular/common`'s compiled
 * output). An app that supplies its own `FetchFactory` bypasses the global
 * entirely, and therefore this shim too.
 *
 * Exported for the verify harness and for apps that use `HttpClient` without
 * going through `provideLynxHttpClient()`.
 *
 * @public
 */
export function installStreamlessFetchShim(): boolean {
  const g = globalThis as { fetch?: FetchLike & { __angularLynxStreamShim?: true } };
  const global = g.fetch;
  if (typeof global === 'function' && global.__angularLynxStreamShim) return false;
  const engine = lynxFetch();
  // No global fetch: a device, where `lynx.fetch` is the one there is. A global
  // that is `lynx.fetch` itself behaves the same way.
  const fromEngine = typeof global !== 'function' || (engine !== undefined && global === (lynx as { fetch?: FetchLike }).fetch);
  const original = typeof global === 'function' ? global : engine;
  if (!original) return false;
  const wrapped = async (...args: unknown[]): Promise<FetchLikeResponse> => {
    const response = await original(...args);
    if (!response) return response;
    if (fromEngine) return withTextBody(response);
    if (!response.body && typeof response.arrayBuffer === 'function') {
      return withSynthesizedBody(response);
    }
    return response;
  };
  (wrapped as FetchLike & { __angularLynxStreamShim?: true }).__angularLynxStreamShim = true;
  g.fetch = wrapped as FetchLike & { __angularLynxStreamShim?: true };
  return true;
}

/**
 * Configure `HttpClient` for Lynx: the fetch backend plus any standard
 * features (`withInterceptors(...)`, `withRequestsMadeViaParent()`, …).
 * Don't pass `withFetch()` yourself — it's already applied.
 *
 * @example
 * ```ts
 * bootstrapLynxApplication(AppComponent, {
 *   providers: [provideLynxHttpClient(withInterceptors([authInterceptor]))],
 * });
 * ```
 * @public
 */
export function provideLynxHttpClient(
  ...features: HttpFeature<HttpFeatureKind>[]
): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideHttpClient(withFetch(), ...features),
    provideEnvironmentInitializer(() => {
      // Puts the engine's fetch on `globalThis` where FetchBackend looks for
      // it, and makes every response readable. See its doc.
      installStreamlessFetchShim();
      if (__DEV__ && typeof (globalThis as { fetch?: unknown }).fetch !== 'function') {
        console.warn(
          '[ng-lynx] provideLynxHttpClient: this engine has no fetch, global or '
            + '`lynx.fetch`: every HttpClient request will fail.',
        );
      }
    }),
  ]);
}

/**
 * `__DEV__` is replaced at build time by the bundler `define`. Declared here so
 * the source type-checks standalone.
 */
declare const __DEV__: boolean;

export {
  lynxEventSource,
  type LynxEventSourceOptions,
  type LynxServerEvent,
} from './event-source.js';
