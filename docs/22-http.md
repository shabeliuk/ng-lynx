# HttpClient — `provideLynxHttpClient`

Angular's default `HttpClient` backend is **XHR**, which doesn't exist on
Lynx. The **fetch backend** does — Lynx exposes a Fetch API on the Background
Thread, and the web preview's worker has the browser's own `fetch`.

```ts
import { withInterceptors } from '@angular/common/http';
import { bootstrapLynxApplication } from 'ng-lynx';
import { provideLynxHttpClient } from 'ng-lynx/http';

bootstrapLynxApplication(AppComponent, {
  providers: [provideLynxHttpClient(withInterceptors([authInterceptor]))],
});
```

`provideLynxHttpClient(...features)` is `provideHttpClient(withFetch(),
...features)` plus a dev-mode boot check that warns immediately if no global
`fetch` exists (instead of every request failing mysteriously). Don't pass
`withFetch()` yourself; all other features (`withInterceptors`, …) pass
through. From there it's plain `@angular/common/http` — typed responses,
interceptors, `HttpErrorResponse`, RxJS — and signal writes from `subscribe`
callbacks drive zoneless change detection like any other.

## What FetchBackend needs from the engine

Verified against `@angular/common@21`'s compiled output (not assumed), a
request touches:

| API | Status on Lynx |
| --- | --- |
| global `fetch` | **Not on a device.** Lynx passes `fetch` to each bundle as a parameter of its wrapper (`fetch = fetch \|\| lynx.fetch`), not as `globalThis.fetch`, which is what FetchBackend calls. Since 1.0.1 `provideLynxHttpClient()` puts `lynx.fetch` there (see below). The web preview's worker has a real one. |
| `AbortController` (cancellation) | **Polyfilled** by entry-background.ts if missing (PrimJS has no `AbortController`). |
| `TextDecoder` (body decoding) | **Polyfilled** (UTF-8, the WHATWG decoder, `stream: true` included) if missing. Neither JavaScriptCore on iOS nor PrimJS on Android has one (Explorer 4.2), so the polyfill is what runs. |
| `response.headers` / `status` / `statusText` | Standard fetch surface. |
| `response.body` **as a ReadableStream** | **Not on a device**, and reading `body` there at all uses the body up. Since 1.0.1 every engine response is read through `text()` instead — see below. |

Both polyfills are guarded (engines that ship the real APIs, and the web
preview, are untouched) and covered by `npm run verify:polyfills` — the same
treatment as the `Object.hasOwn` gap that once crashed `@angular/forms`
on-device.

### On a device: 1.0.0 couldn't make a request

ng-lynx 1.0.0's HttpClient failed on every request on a real device, while the
web preview worked. Found by a real app on Lynx Explorer 4.2 (iOS simulator):

1. **`TypeError: not a function`.** There's no `globalThis.fetch` on the
   Background Thread: the runtime wrapper hands `fetch` to the bundle as a
   variable in its scope. FetchBackend's default is
   `(...args) => globalThis.fetch(...args)`.
2. **Then a `null` body.** Lynx's `Response` has no stream, and the shim below
   built one from `arrayBuffer()`, which Lynx's responses don't serve either.
3. **Then "body used".** Reading `response.body` on Lynx, even to check it, uses
   the body up, so a later `text()` fails or resolves to `undefined`.

`installStreamlessFetchShim()` (run by `provideLynxHttpClient()`) now handles
all three: with no global `fetch`, it installs `lynx.fetch` (bound to `lynx`) as
the global, and wraps each engine response in a one-chunk reader over `text()`,
without ever touching `.body`. `npm run verify:http` fakes exactly that engine:
no global fetch, a `lynx.fetch` whose `body` getter uses the body up.

The harnesses before 1.0.1 ran against Node's `fetch` and the web preview, which
both have a global `fetch` and streaming bodies: that is how this got through.

### The stream caveat

`FetchBackend` reads bodies **exclusively** through
`response.body.getReader()`, behind a bare `if (response.body)` with no
`else`. There is no fallback to `response.text()` — so on an engine whose
fetch returns stream-less responses (`response.body == null`), every request
would *succeed* with a silently `null` body rather than erroring.

**`provideLynxHttpClient()` now closes that hole automatically.** It installs
`installStreamlessFetchShim()`, which wraps the global `fetch` so a response
that arrives without a stream gets a one-chunk `body.getReader()` synthesized
from its `arrayBuffer()`. A response that already streams — the web preview's
real browser fetch, and any compliant engine — is returned untouched, so the
cost is one property check per request and nothing changes where nothing was
wrong.

Two details worth knowing, both verified against `@angular/common`'s compiled
output rather than assumed:

- Installing the shim from an environment initializer (after `FetchBackend`
  already exists) is safe: its default `fetchImpl` is
  `(...args) => globalThis.fetch(...args)`, a lazy read at call time, not a
  binding captured at construction.
- An app that supplies its own `FetchFactory` bypasses the global `fetch`
  entirely, and therefore bypasses this shim too.

`npm run verify:http` covers it end to end: a hand-built stream-less response
(Node's own `Response` always has a stream, so one is faked the way a
non-compliant engine would return it), the synthesized reader yielding the
full body and then terminating, the body being buffered exactly once,
idempotent installation, compliant responses passing through un-wrapped —
and, the part that actually matters, a **real `HttpClient` request** over
that stream-less fetch parsing its JSON body, which without the shim resolves
to `null`.

## Relative URLs don't resolve — use absolute ones

A browser resolves `fetch('/resources/thing.bin')` against the document's
origin. **The native engine has no document and no base URL**, so a
root-relative (or `./`-relative) path reaches the platform networking layer
unchanged and is rejected outright. Confirmed on an iOS simulator:

```
NSURLErrorDomain Code=-1002 "unsupported URL"
NSErrorFailingURLStringKey=/resources/girl/standing_idle.fbx
```

This works fine in the web preview and fails only on device, which makes it
easy to ship by accident — and the failure misdirects: what surfaced when
`examples/threejs-rpg-skeleton` loaded an FBX wasn't a network error but
`THREE.FBXLoader: Cannot find the version number for the file given`, an error
about the file's *contents*, because the rejected request still produced an
(empty) buffer.

`HttpClient` is subject to the same rule — a relative `http.get('/api/…')`
has nothing to resolve against on-device. Give it an absolute URL, or set one
up front:

```ts
provideLynxHttpClient(withInterceptors([
  (req, next) => next(req.url.startsWith('http') ? req : req.clone({ url: API_BASE + req.url })),
]));
```

For assets served alongside your own bundle, use `lynxAssetUrl()`, as
`examples/threejs-rpg-skeleton/src/app.component.ts` does. It resolves against
`__webpack_public_path__`: the dev server's address under `rspeedy dev`, and
`output.assetPrefix` in a production build. **A production build has to set
`output.assetPrefix`** to where its files are hosted. Without it the base is `/`,
`lynxAssetUrl()` returns the path unchanged, and the device rejects it as above.

## Verifying

`npm run verify:http` runs the **real FetchBackend** against a mocked global
`fetch` returning Node's native `Response` objects, so the entire production
read path executes — `AbortController` setup, the stream-reader loop,
`TextDecoder` decoding, JSON parsing. Asserted: a typed JSON GET renders, a
functional interceptor's header reaches the wire, a 500 surfaces as
`HttpErrorResponse` with the parsed error body.
