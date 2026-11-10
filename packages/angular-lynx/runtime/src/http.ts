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
 *  - the global `fetch` itself;
 *  - `new AbortController()` (request cancellation) and `new TextDecoder()`
 *    (body decoding) — both beyond ES2019, so entry-background.ts ships
 *    guarded polyfills for PrimJS (same class as the `Object.hasOwn` gap that
 *    once crashed `@angular/forms` on-device);
 *  - `response.headers` / `.status` / `.statusText` / `.url`;
 *  - **`response.body` as a ReadableStream** — FetchBackend reads bodies
 *    exclusively via `response.body.getReader()`; there is *no* fallback to
 *    `response.text()`, and the branch is a bare `if (response.body)` with no
 *    `else`, so a stream-less response yields a **silently `null` body**
 *    rather than an error. {@link installStreamlessFetchShim} closes that
 *    hole — see its doc.
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
  arrayBuffer?(): Promise<ArrayBuffer>;
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

/**
 * Wrap the global `fetch` so responses that arrive **without a readable
 * stream** still deliver their body to Angular's `HttpClient`.
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
  const original = g.fetch;
  if (typeof original !== 'function' || original.__angularLynxStreamShim) return false;
  const wrapped = async (...args: unknown[]): Promise<FetchLikeResponse> => {
    const response = await original(...args);
    if (response && !response.body && typeof response.arrayBuffer === 'function') {
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
      if (__DEV__ && typeof (globalThis as { fetch?: unknown }).fetch !== 'function') {
        console.warn(
          '[angular-lynx] provideLynxHttpClient: no global `fetch` is available '
            + 'in this Lynx environment — every HttpClient request will fail. '
            + 'Check that your Lynx runtime version ships the Fetch API.',
        );
      }
      // Guard against a stream-less engine fetch silently producing `null`
      // bodies — a no-op wherever `response.body` is already a real stream.
      installStreamlessFetchShim();
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
