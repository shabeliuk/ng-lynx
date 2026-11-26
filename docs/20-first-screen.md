# First-screen snapshot — instant first frame (IFR)

ReactLynx paints its first frame **on the Main Thread**, inside `renderPage()`,
before the Background Thread has booted (Lynx calls this Instant First-Frame
Rendering). ng-lynx's first frame normally waits for: BG engine boot →
Angular bootstrap → first change-detection pass → ops across the thread
boundary → Main-Thread replay.

Angular can't run on Lepus — but its first render is (normally)
**deterministic**, so the gap closes with a build-time snapshot:

```
build time                            device, t=0                device, t=BG-ready
──────────                            ───────────                ──────────────────
ng-lynx-capture                  renderPage():              first real ops batch:
  runs the app headlessly    ──►        paint snapshot   ──►       identical? drop it —
  records first ops batch               synchronously              ids & signs already live
                                                                   different? teardown + render
```

## Using it

1. **Create a capture entry** whose default export is the root component:

   ```ts
   // src/first-screen-entry.ts
   export { AppComponent as default } from './app.component.js';
   // optional: export const providers = [...];
   ```

   Exclude it in `tsconfig.json`, or the app build warns that it's "part of the TypeScript
   compilation but it's unused". The capture bundles it with its own settings:

   ```jsonc
   "exclude": ["src/first-screen-entry.ts"]
   ```

2. **Capture** (rerun whenever the first screen changes):

   ```jsonc
   // package.json
   "scripts": { "capture": "ng-lynx-capture src/first-screen-entry.ts src/first-screen.json" }
   ```

   The tool bundles your entry with esbuild, which ng-lynx doesn't install
   for you (it's an optional peer dependency): `npm install --save-dev esbuild`.

3. **Embed**:

   ```ts
   // lynx.config.ts
   pluginAngularLynx({ firstScreen: './src/first-screen.json' })
   ```

That's all — `examples/hello-world` is wired this way.

## How hydration works (and why it's safe)

The captured snapshot is the **exact serialized string** of the first ops
batch. On-device, `renderPage()` applies it synchronously (the same
in-`renderPage` flush pattern ReactLynx uses). When the real app's first batch
arrives, the Main Thread compares it to the snapshot **byte-for-byte**:

- **Match** (the normal case): the batch is dropped. Element ids and event
  signs are deterministic counters that restart on every boot, so the same
  app produces the same string — every id the Background Thread will ever
  reference already maps to a live element, and every `(tap)` the snapshot
  registered natively has a Background handler under the same sign. Verified
  on the real web engine: the **AOT-built** app hydrates against the
  **JIT-captured** snapshot (`[ng-lynx] first-screen snapshot matched —
  hydrated in place` in the dev console) — ngtsc and the runtime compiler
  emit identical renderer-op sequences.
- **Mismatch** (nondeterministic first render — host `initData` read in the
  template, dates, randomness): the snapshot's elements are torn down and the
  real batch applies onto a clean page. You lose the fast first frame, never
  correctness. Dev builds log which path ran.

State lifetimes mirror worklets: the snapshot string is bundle-lifetime; the
expecting/teardown bookkeeping is page-lifetime (reset by `renderPage`).

## Constraints & notes

- **No `firstScreenSyncTiming`.** ReactLynx's option of that name (`'immediately'`, `'jsReady'` or
  `'manual'`) decides when its Main-Thread runtime hands control to the Background Thread, because
  that runtime renders and keeps updating the first screen itself. Here the Main Thread never runs
  component code: it replays the snapshot's ops, and the Background Thread's first batch hydrates it,
  so there is no hand-over to time and no equivalent option.
- **The snapshot renders with default data** — empty `initData`, no
  `globalProps` (ReactLynx IFR has the same constraint). If your first screen
  *displays* host data, the snapshot shows the defaults until hydration — or
  the mismatch fallback runs if the *structure* differs. Design the first
  screen to be data-independent (skeletons count) for the full benefit.
- **Taps before the Background Thread is ready are queued, not dropped** —
  see [Pre-boot event queueing](#pre-boot-event-queueing) below.
- A **development build** maps elements to their templates (`templateSourceMap`,
  see [26 — Debugging](26-debugging.md#from-an-element-to-its-template)), which
  the snapshot doesn't have. Its first batch is compared without that mapping, so
  it still matches.
- A **stale snapshot** (component changed, capture not re-run) is safe — it
  hits the mismatch path. Wire `npm run capture` into your build to avoid
  paying the fallback.

  > "Safe" is why a stale snapshot can go unnoticed for a long time, so check
  > the dev console for which path ran. `examples/hello-world`'s committed
  > snapshot was silently stale: `ng-lynx-capture` had stopped working
  > (it didn't `define` two build-time constants the runtime added later, so
  > the capture bundle threw `ReferenceError` before rendering), the wire
  > format then gained string interning, and with no way to re-capture, the
  > checked-in JSON stayed in the pre-interning format. Every boot logged
  > `first-screen snapshot did NOT match the real first render` and paid the
  > teardown. Fixed by defining all three constants in the capture bin and
  > re-capturing; it now logs `matched — hydrated in place`.
- The capture runs **JIT in Node** against the mock PAPI
  (`ng-lynx/testing`'s environment — deterministic ids/signs come from
  its per-render counter resets). It must `define` **every** build-time
  constant the runtime declares — today `__DEV__`,
  `__ENABLE_SELECTOR_QUERIES__` and `__HAS_FIRST_SCREEN__` — because they're
  read at module scope, so a missing one throws rather than degrading. If you
  add another `declare const __X__`, add it to `bin/capture-first-screen.mjs`,
  `plugin/src/index.ts` and `verify/build.mjs` together.

## Pre-boot event queueing

The snapshot's elements are real and tappable from `t=0` — but the handler
for a tap lives in the not-yet-booted Background Thread app, which doesn't
exist yet as far as `event-registry.ts`'s sign → handler table is concerned.
A tap in that window used to be silently dropped; it's queued instead now.

`event-registry.ts`'s `publishEvent(sign, data)` — the entry point every
native event calls into on the Background Thread — buffers the call instead
of dropping it whenever no handler is registered for `sign` yet *and* a
first-screen snapshot is configured (`__HAS_FIRST_SCREEN__`, set from
`Boolean(firstScreen)` at build time — an app without one never has
pre-boot-tappable elements in the first place, so buffering never activates
for it, at no cost). Resolution comes from the Main Thread: once
`consumeFirstScreenBatch` (above) decides match or mismatch, it dispatches a
`FIRST_SCREEN_RESOLVED_EVENT` over the same cross-thread-context channel
worklets use for `ctx.runOnBackground(data)` (`lynx.getJSContext().
dispatchEvent(...)` → `lynx.getCoreContext().addEventListener(...)`, real on
both native and web). `event-registry.ts`'s `resolveFirstScreenEvents(matched)`
then either:

- **replays** every queued event, in order, against the now-populated handler
  table (**match**) — safe because a byte-identical batch is only possible
  because both the snapshot's capture run and the real app's own first render
  produced the exact same deterministic sequence of signs from a fresh
  counter, so the handlers just registered really are what the queued signs
  meant; or
- **discards** the queue outright (**mismatch**) — the snapshot's elements
  were torn down, and while the real (different) app's own signs are assigned
  from an identically-reset counter, a numeric match (e.g. both trees'
  first-ever sign being `ng:0`) doesn't mean the same *thing* — replaying
  could misfire a stale tap onto a live but completely unrelated handler.

## Measured on-device — how much does it actually buy?

Measured on an iOS simulator (iPhone 17 Pro, Explorer on engine 3.7) running
`examples/hello-world` from a LAN dev server, A/B with the `firstScreen`
option enabled and commented out, **3 launches each**, timestamps taken from
the native engine log:

| | `LoadTemplate` | `LoadTemplate` end → first Angular ops batch |
| --- | --- | --- |
| snapshot **on** | 11.7 ms | 70.0 ms |
| snapshot **off** | 3.7 ms | 76.7 ms |

The snapshot is applied synchronously inside `renderPage()`, so with it on
there is content on screen by the end of `LoadTemplate`; with it off nothing
can paint until the first real ops batch arrives from the Background Thread.

- **First painted content: ~11.7 ms vs ~80.3 ms after load start — roughly
  69 ms earlier.**
- **Cost: ~8 ms** of extra `LoadTemplate` work to apply the snapshot.
- **Control:** total load-start → first Angular batch is essentially unchanged
  (81.7 ms vs 80.3 ms), i.e. carrying the snapshot does **not** meaningfully
  delay Angular's own boot — the win is real, not borrowed.

Read that as an order of magnitude, not a promise: it's a simulator on a fast
machine with a warm dev-server fetch. On real hardware the Background-Thread
boot (the ~77 ms half) is the part that grows, so the gap IFR covers gets
*wider*, not narrower.

### Re-measured on engine 4.2

Same A/B on 2026-11-10: `examples/hello-world`, production builds with `firstScreen` on and off,
iOS simulator (iPhone 17 Pro, Explorer 4.2), 3 launches each, from the native log. First paint
is the first `OnPatchFinishForFiber WithPatch`; with the snapshot on, Angular's first batch is
the `__ngFirstScreenResolved` event, because a matched snapshot hydrates in place and that
batch changes nothing on screen (no patch at all).

| Background Thread | | `LoadTemplate` | First paint | First Angular batch |
| --- | --- | --- | --- | --- |
| JavaScriptCore (DevTool off) | snapshot **on** | 5.3 ms | 2.7 ms | 47.0 ms |
| | snapshot **off** | 2.3 ms | 46.7 ms | 46.7 ms |
| PrimJS (DevTool on) | snapshot **on** | 7.7 ms | 4.7 ms | 81.0 ms |
| | snapshot **off** | 2.7 ms | 84.3 ms | 84.3 ms |

All times are from the start of `LoadTemplate`. So the snapshot puts content up about 44 ms
earlier on JavaScriptCore and about 80 ms earlier on PrimJS, for 3 to 5 ms more
`LoadTemplate` work, and Angular's own boot isn't delayed by it. The same shape as on 3.7.

> **Caveat on what this measures.** These numbers time *first paint*. Whether
> the snapshot then **matched** and hydrated in place (rather than being torn
> down and re-rendered) is not observable in the native log — ng-lynx's
> own Lepus-side logs don't reach `os_log`. That half is covered by
> `verify:ifr` headlessly and by the web preview's "matched — hydrated in
> place" message, below.

> **The Performance API is not how this was measured, because it doesn't
> work here.** The obvious approach — `LynxPerformance.observe(['pipeline',
> 'metric.fcp', …])` — was tried first and produced **nothing**.
> `lynx.performance` exists on the Background Thread and
> `typeof performance.createObserver === 'function'` is true, and
> `observe()` accepts the documented entry types (`pipeline`, `metric.fcp`,
> `init.container`, `metric.actual-fmp`, `load.bundle`, …) without throwing —
> but **no entry is ever delivered**, neither at startup nor on later taps
> that definitely run a render pipeline. Subscribing to the
> `GlobalEventEmitter` timing events the native log shows
> (`lynx.performance.timing.onSetup`) doesn't help either: they fire before
> app code runs. See [25 — Performance](25-performance.md).
>
> One incidental finding worth knowing: **`globalThis.lynx` is `undefined` on
> the Background Thread** — only the bare `lynx` identifier is bound. Code
> reaching for `globalThis.lynx` silently gets nothing. The runtime's own
> `getPerformance()` already uses the bare identifier and is correct.

## Verifying

`npm run verify:ifr` simulates the full lifecycle headlessly: capture → paint
with **no Angular app running** → boot the real app (batch matched & dropped,
no duplicate UI, a tap on the snapshot-registered sign reaches the live
handler) → boot a *different* app (snapshot torn down, single clean render) →
a tap queued before boot reaches the handler once hydration matches → a tap
queued before boot is discarded, not misfired onto an unrelated handler under
the same sign, when hydration mismatches. On the real engine:
`examples/hello-world` on the web preview logs the "matched — hydrated in
place" path, renders once, and increments exactly once per tap.
