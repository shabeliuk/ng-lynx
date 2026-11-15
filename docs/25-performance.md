# Performance API — `LynxPerformance`

Lynx exposes a standardized performance interface on the Background Thread
(`lynx.performance`): a **PerformanceObserver** for pipeline and metric entries
(FCP, TTI, actual-FMP, per-update render pipelines) and a **tracing** API that
feeds Lynx DevTool. `LynxPerformance` (`providedIn: 'root'`) surfaces both to
Angular code and disconnects observers on app teardown.

## Observing metrics & pipelines

```ts
import { inject, Injectable, signal } from '@angular/core';
import { LynxPerformance } from 'ng-lynx';

@Injectable({ providedIn: 'root' })
export class MetricsService {
  private readonly perf = inject(LynxPerformance);
  readonly fcp = signal<number | undefined>(undefined);

  constructor() {
    this.perf.observe(['metric.fcp', 'metric.actual-fmp'], (entry) => {
      if (entry.entryType === 'metric.fcp') {
        this.fcp.set((entry['fcp'] as { duration: number }).duration);
      }
    });
  }
}
```

`observe(entryTypes, callback)` returns a disposer; observers are also
disconnected when the app is destroyed. Because the callback is a normal async
callback, a signal write from it schedules zoneless change detection like any
other.

Entry types, as spelled by
[Lynx's PerformanceObserver docs](https://lynxjs.org/api/lynx-api/performance-api/performance-observer.html)
— they are **dot-separated**, and an earlier version of this page got several
wrong (`loadBundle`, `metric.actualFmp`), which matters because an unknown
type doesn't throw, it just silently never matches:

`pipeline` · `metric.fcp` · `metric.actual-fmp` · `init.container` ·
`init.lynxview` · `init.background-runtime` · `load.bundle` · `lazy.bundle` ·
`reload.bundle`

> ## ⚠️ No entries were delivered on Explorer with engines 3.7 and 4.2 (iOS)
>
> Measured directly, and it is worth knowing before you build on this: on an
> iOS simulator running Explorer on engine 3.7, **`observe()` never fired**.
> Re-measured on 4.2 (2026-11-10): `observe(['pipeline', 'metric', 'init',
> 'load', 'resource'])` is accepted, and nothing arrives in the first 4 s, through
> startup and two renders.
>
> Not a wiring problem on our side — every precondition checks out:
> `lynx.performance` exists on the Background Thread,
> `typeof performance.createObserver === 'function'` is `true`, and
> `observe([...])` accepts the exact documented entry types above without
> throwing. It simply delivers nothing — not during startup, and not on later
> taps that demonstrably run a render pipeline (which `pipeline` should
> report).
>
> Subscribing to the older listener path instead doesn't rescue it: the native
> log does emit `GlobalEventEmitter` → `lynx.performance.timing.onSetup`, but
> that fires **before** any app code runs, so a Background-Thread listener
> attaches too late to ever see it.
>
> Practical guidance: **don't rely on `observe()` for anything load-bearing
> on-device yet** — treat a metric that never arrives as the expected case and
> keep a fallback. This is the same shape of gap as `fields()` in
> [10 — Element queries](10-element-queries.md): correctly wired, verified
> headlessly, and inert on the real engine. For a worked example of measuring
> first-paint *without* this API — using native engine log timestamps instead
> — see [20 — First-screen](20-first-screen.md).
>
> Incidental but useful: **`globalThis.lynx` is `undefined` on the Background
> Thread**; only the bare `lynx` identifier is bound. `LynxPerformance`
> already reads the bare one and is correct, but hand-written code reaching
> for `globalThis.lynx` gets `undefined` silently.

## Naming a render pipeline (`__lynx_timing_flag`)

To measure a *specific* update, tag an element the update touches with a
`__lynx_timing_flag` — the resulting `pipeline` entry carries it as
`identifier`:

```html
<view [attr.__lynx_timing_flag]="'checkout-render'">…</view>
```

The attribute rides through the renderer like any other (no special support
needed). Observe `'pipeline'` entries and filter by `identifier` to time that
update's full pipeline (framework render → resolve → layout → paint).

## Tracing (Lynx DevTool)

```ts
const perf = inject(LynxPerformance);
const flow = perf.profileFlowId();
perf.profileStart('load-feed', { flowId: flow });
// … work …
perf.profileEnd();
perf.profileMark('feed-ready', { flowId: flow });
```

`profileStart`/`profileEnd`/`profileMark`/`profileFlowId`/`isProfileRecording`
pass straight through to `lynx.performance`; spans show up in Lynx DevTool's
trace timeline. `isProfileRecording()` lets you cheaply skip instrumentation
when no trace is being captured.

## Measuring the runtime's own work

Two internal pipelines are worth watching with this:

- **First screen (IFR)** — how much sooner the snapshot paints vs. a
  cold Background-Thread boot ([20 — First-screen](20-first-screen.md)).
- **Update flushes** — after the deferred style/class serialization change
  ([03 — Renderer internals](03-renderer-internals.md)), tag a style-heavy
  screen's root with a timing flag and compare pipeline durations.

## Verifying

`npm run verify:performance` covers `observe()` registration + entry delivery
driving zoneless CD, the disposer/destroy disconnect, tracing passthrough
(order preserved), and that a `[attr.__lynx_timing_flag]` binding reaches the
element.

> **What that harness does and doesn't prove.** It drives a mock that
> implements `createObserver` and feeds entries back, so it verifies *our*
> half — registration, dispatch, disposal, CD scheduling — and would catch a
> regression in any of it. It cannot prove the engine ever emits an entry, and
> on Explorer with engines 3.7 and 4.2 (iOS) it demonstrably did not (see the
> warning above).
