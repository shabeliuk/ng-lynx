# Platform APIs — SystemInfo, error reporting, session storage, and more

Small wrappers over parts of [lynxjs.org's API
reference](https://lynxjs.org/api/lynx-api.html).

## `injectSystemInfo()`

Typed access to `SystemInfo` — platform, screen metrics, pixel ratio. It's a
**plain global** the engine sets on both threads (confirmed against
`@lynx-js/web-core`: the Main-Thread global-API factory sets
`SystemInfo: lynxViewInstance.systemInfo`, and the Background-Thread worker
bootstrap does `globalThis.SystemInfo = message.systemInfo` before the app's
own code ever runs) — so reading it needs no cross-thread plumbing.

```ts
import { injectSystemInfo } from 'ng-lynx';

@Component({ … })
export class DeviceAwareComponent {
  private readonly system = injectSystemInfo();
  readonly isTablet = this.system.pixelWidth / this.system.pixelRatio > 600;
  readonly platform = this.system.platform; // 'Android' | 'iOS' | 'macOS' | 'windows' | 'headless'
}
```

`SystemInfo` is static for the process lifetime, so this is a plain typed
getter — no signal. Must be called in an injection context (it's backed by an
`InjectionToken`, `LYNX_SYSTEM_INFO`); override it in tests with a plain
`{ provide: LYNX_SYSTEM_INFO, useValue: {...} }` provider to simulate a
specific device profile.

`runtimeType` (`'v8' | 'jsc' | 'quickjs'`) is Background-Thread only — absent
on the Main Thread.

## `LynxErrorHandler`

`provideLynx()` installs `LynxErrorHandler` as the default `ErrorHandler`.
It calls the real default's `handleError` first (so `console.error` still
happens — nothing regresses for headless tests or the web preview's
DevTools), then forwards to `lynx.reportError()` so the error also reaches
the host's native crash-reporting / DevTool pipeline — otherwise an uncaught
error on-device only ever hits a runtime with no visible console.

```ts
// automatic — provideLynx() (called by bootstrapLynxApplication) installs it
```

Override it like any other Angular provider if an app wants different
behavior:

```ts
bootstrapLynxApplication(AppComponent, {
  providers: [{ provide: ErrorHandler, useClass: MyErrorHandler }],
});
```

`lynx.reportError(error, { level })` accepts `'warning' | 'error' | 'fatal'`;
`LynxErrorHandler` always reports at `'error'`. Errors that aren't already an
`Error` instance are wrapped in one (`reportError` itself only accepts
`string | Error`).

## `LynxSessionStorage`

Cross-**LynxView** shared storage (`lynx.getSessionStorageItem` /
`setSessionStorageItem` / `subscribeSessionStorage` /
`unsubscribeSessionStorage`) — the mechanism for sharing data between a card
and its host page, or between two cards in the same session. Distinct from:

- [`initData`/`globalProps`](17-host-data.md) — per-card data set at load time
  by the host, not written back;
- [native modules](27-native-modules.md) — host-registered bridges, not a
  key/value store.

```ts
import { inject, Injectable } from '@angular/core';
import { LynxSessionStorage } from 'ng-lynx';

@Injectable({ providedIn: 'root' })
export class DraftService {
  private readonly storage = inject(LynxSessionStorage);

  loadDraft(): Promise<string | undefined> {
    return this.storage.get<string>('draft-text');
  }
  saveDraft(text: string): void {
    this.storage.set('draft-text', text);
  }
  watchDraft(onChange: (text: string) => void): () => void {
    return this.storage.subscribe<string>('draft-text', onChange);
  }
}
```

`get` wraps the callback-based real API in a `Promise`; `subscribe` returns an
unsubscribe function (also called automatically when the application/root
injector is destroyed, matching `LynxGlobalEvents.listen`).

## `LynxExposure` — `resumeExposure()` / `stopExposure()`

App-wide control over the same exposure-detection system that drives the
per-element `uiappear`/`uidisappear` events (typed on `LynxStandardElement` in
`ng-lynx/elements`) and the global `exposure` event reachable via
`LynxGlobalEvents` (see [24 — Visibility](24-visibility.md)). Distinct from
`LynxIntersectionObserver`, a separate, more capable imperative observer API
for arbitrary elements/roots.

```ts
import { inject, Injectable } from '@angular/core';
import { LynxExposure } from 'ng-lynx';

@Injectable({ providedIn: 'root' })
export class RouteTransitionService {
  private readonly exposure = inject(LynxExposure);
  onNavigationStart(): void { this.exposure.stopExposure(); }
  onNavigationEnd(): void { this.exposure.resumeExposure(); }
}
```

Pause detection during a heavy transition to save work, then resume it —
`resumeExposure()` doesn't retroactively fire events for elements whose
visibility hasn't changed since detection was paused.

`setObserverFrameRate({ forPageRect?, forExposureCheck? })` tunes detection
frequency in fps (both default 20): `forPageRect` for LynxView position
changes, `forExposureCheck` for target-node visibility checks.

## `ShadowElement.path()`

The 4th [NodesRef](10-element-queries.md) method, alongside the already-typed
`fields` / `invoke` / `setNativeProps` — queries the path from an element up
to the page root:

```ts
const box = viewChild.required<ElementRef>('box');
asLynxElement(box().nativeElement).path((res) => console.log(res));
```

## `LynxObject`

The remaining assorted `lynx.*` global methods, grouped the way lynxjs.org's
own "Lynx Object" API page groups them — one small injectable rather than one
file per method, since each is a thin, stateless pass-through:

```ts
import { inject, Injectable } from '@angular/core';
import { LynxObject } from 'ng-lynx';

@Injectable({ providedIn: 'root' })
export class ProductCardService {
  private readonly lynx = inject(LynxObject);

  celebrate(boxId: string): void {
    const box = this.lynx.getElementById(boxId);
    box?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  }

  measureLabel(text: string): number {
    return this.lynx.getTextInfo(text, { fontSize: '16px' })?.width ?? 0;
  }

  addedToCart(name: string): void {
    this.lynx.accessibilityAnnounce(`${name} added to cart`);
  }
}
```

| Method | Signature | Notes |
| --- | --- | --- |
| `getElementById(id)` | `(id: string) => LynxNodeRef \| null` | Looks up by the `[id]` input every typed element has. Returns `null` when nothing matches (no throw). |
| `LynxNodeRef.animate(keyframes, options)` | see below | Real playback needs a real device, same class of caveat as `<video>` — the returned `Animation`'s `cancel`/`pause`/`play` are verified as reaching the PAPI, not that anything visibly moves. |
| `getTextInfo(text, info)` | `(text, { fontSize, fontFamily?, maxWidth?, maxLine? }) => { width, content? }` | Measures text without rendering it. `fontSize` is required, px-only. |
| `addFont(fontFace, callback?)` | `({ 'font-family', src }, callback?) => void` | Registers a custom font face. |
| `requestResourcePrefetch(data, config?)` | `({ data: [{ uri, type, params? }] }, config?) => Promise<PrefetchResult>` | Prefetches images/video/audio/fonts. Wrapped in a `Promise` (the real API is callback-based). |
| `cancelResourcePrefetch(data)` | `({ data: [...] }) => Promise<PrefetchResult>` | Cancels a previously requested prefetch. |
| `registerModule(name, module)` / `getJSModule(name)` | `<T>(name, module: T) => void` / `<T>(name) => T \| undefined` | The Background-Thread module registry, scoped to one LynxView. `getJSModule` also resolves host-provided modules (e.g. `GlobalEventEmitter`, used internally by `LynxGlobalEvents`). |
| `accessibilityAnnounce(content)` | `(content: string) => void` | Announces text to screen readers. |
| `beforePublishEvent.add(name, handler)` / `.remove(name, handler)` | `(eventName, handler) => void` | An "event aspect" hook intercepting a named event (e.g. `'tap'`) on the Background Thread before normal dispatch — for cross-cutting concerns like uniform analytics. |
| `reload(initData?)` | `(initData?: object) => Promise<void>` | Reloads the page, like a browser's refresh, with `initData` merged into `lynxInitData()`. See below. |

`element.animate()`'s keyframes are either an array (`[{ opacity: 0 }, { opacity: 1 }]`)
or a percentage-keyed object (`{ '0%': {...}, '100%': {...} }`); `options`
mirrors CSS animations (`duration`, `delay`, `iterations`, `direction`,
`easing`, `fill`, `name`, `play-state`). Animation lifecycle events are the
same as CSS animation events.

**Lower confidence on `beforePublishEvent`**: lynxjs.org's docs for this one
don't specify the handler's parameters, return value, or whether it can
cancel/modify the event — only the `add`/`remove` shape and a `'tap'` usage
example. Verify against your engine version before relying on it for
anything beyond passive observation.

`getElementById`'s handle is explicitly documented as cross-thread-invoke-only
— it doesn't keep the element alive and isn't a replacement for
`ElementRef`/`asLynxElement`, which remain the way to reach `fields`/`invoke`/
`setNativeProps`/`path`.

### `reload()`

Lynx reloads a page in three steps: the Main Thread drops the old tree, the
Background Thread is told to start over, and the Main Thread is asked to finish.
ng-lynx destroys the app (`ngOnDestroy` runs, nothing it removes is sent),
merges the new data into `lynxInitData()`, and runs every
`bootstrapLynxApplication` call again. The router starts at its initial URL.

Lynx's own notes apply: data processors don't run on the reload data, and
`lynxGlobalProps()`, `SystemInfo` and JS globals stay as they were. Before this,
`lynx.reload()` failed with `removeComponents is not a function`. Measured on the
iOS simulator (Explorer 4.2, 2026-11-09): the page came back with the new init
data, and taps and navigation worked.

## Server-sent events — `lynxEventSource()`

```ts
import { toSignal } from '@angular/core/rxjs-interop';
import { lynxEventSource } from 'ng-lynx/http';

readonly price = toSignal(lynxEventSource('https://example.com/prices', { events: ['tick'] }));
```

An Observable of `{ type, data, lastEventId? }`. Unnamed events arrive as
`'message'`; named ones only when listed in `events`, as in a browser. Unsubscribing
aborts the request. It completes when the server closes the stream and errors when
the request fails; unlike a browser's `EventSource` it doesn't reconnect by itself,
so add RxJS `retry()` for that.

**On a device it needs fetch's standard streaming**, a page setting:

```ts
// lynx.config.ts
import { pluginLynxConfig } from '@lynx-js/config-rsbuild-plugin';

plugins: [pluginAngularLynx(), pluginLynxConfig({ enableFetchAPIStandardStreaming: true })],
```

Without it there's no stream to read, and the Observable errors saying so.

**Why not Lynx's `lynx.EventSource`:** on iOS it never delivers an event. It asks
fetch for the older `useStreaming` mode, and the stock iOS HTTP service
(`LynxNSUrlSessionDelegate`) parses that stream as raw `Transfer-Encoding: chunked`
framing, which `NSURLSession` has already removed. No chunk is ever found; only the
end of the stream arrives. Upstream fixed this on `develop` on 2026-09-22
([`2cf3d045f7`](https://github.com/lynx-family/lynx/commit/2cf3d045f7), "SSE-aware
streaming": a `text/event-stream` response is split on blank lines), but 4.2.0 doesn't
include it, so it should arrive in the next release cut from `develop`. Until then
`lynx.EventSource` delivers nothing on iOS; `lynxEventSource` works either way.
`lynxEventSource` reads the stream through standard streaming instead, which passes
the bytes through, and parses the events itself. Measured on the iOS simulator
(Explorer 4.2, 2026-11-09): three events arrived with the connection held open.
Android isn't measured yet.

## `WebSocket`

Use the standard `WebSocket` on the Background Thread. On a device it's
`@lynx-js/websocket`, backed by a native module (Lynx 2.16+), and the build
provides it wherever your code says `WebSocket`; the web preview's worker has
the browser's own.

ng-lynx 1.0.0 only had it in `rspeedy dev`: rspeedy's ProvidePlugin is added for
its dev client, so an app's socket worked in dev and was missing from a release
build. Since 1.0.1 `pluginAngularLynx` provides it for every lynx build, checked
by `npm run verify:websocket-build`.

Two things a real app met:

- **Batch your subscriptions.** Servers rate-limit control messages (Binance
  allows five a second and drops the connection past that); re-subscribing a
  list of streams one message each after a change is enough to hit it.
- **`onmessage` data is a string.** Check `typeof event.data === 'string'`
  before parsing.

## Verifying

`npm run verify:event-source` covers the parser (multi-line data, named events,
ids, comments, CRLF, events split across chunks) and the Observable (filtering,
completion, abort on unsubscribe, the missing-stream error). On a device, the
device-tests `platform` flow covers `reload()`, `lynxEventSource()`,
`lynxSelectRoot()` and `lynxSelectUniqueID()`.

`npm run verify:platform` covers everything on this page: `injectSystemInfo()`
reads real typed fields; `LynxErrorHandler` forwards an `Error` to a mocked
`lynx.reportError` at `'error'` level; `LynxSessionStorage` round-trips a
write through `get`/`set`, delivers to `subscribe`, and stops after
`unsubscribe`; `LynxExposure` reaches the mocked PAPI in call order (including
`setObserverFrameRate`); `ShadowElement.path()` delivers a result array
asynchronously through the real selector-query machinery; every `LynxObject`
method (including a real `getElementById` lookup by id, `animate()`,
`registerModule`/`getJSModule` round-tripping a value, and
`beforePublishEvent.add`/`.remove` actually gating delivery) reaches its real
mocked PAPI call.
