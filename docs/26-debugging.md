# Debugging — the op-stream logger & what else exists

Angular DevTools can't attach to a Lynx app (no DOM, no Chrome bridge). Lynx's
own inspector, Lynx DevTool, does work with an ng-lynx page (below), and
ng-lynx ships a few other levers.

## Lynx DevTool

Lynx DevTool is a desktop app with Chrome-style panels. On an ng-lynx page
in Lynx Explorer 4.2 (iOS simulator, 2026-11-09, the `ng-forms` example):

- **Elements** shows the real element tree (`scroll-view`, `view`, `text`,
  `input`, …), and selecting an element highlights it on screen.
- **Console** evaluates on the Background Thread, where Angular runs: `1 + 1`
  and `lynx.__globalProps` both work.
- **Sources** lists the app's own `.ts` files, through the dev build's source
  maps.

To set it up:

1. Install the desktop app: `Lynx-DevTool-<version>-arm64.dmg` (or `x64`) from
   the [lynx-devtool releases](https://github.com/lynx-family/lynx-devtool/releases).
   The newer `devtool.frontend.lynx_*.tar.gz` releases are only its web
   interface, not something you can run.
2. In Lynx Explorer, open Settings → **Lynx DevTool Switches**, turn on
   **Lynx DevTool**, and restart Explorer.
3. Open your page in Explorer, then start the desktop app. It finds Explorer by
   itself: on a simulator, through the port Explorer opens on the Mac (8901);
   on a phone, over USB.

With DevTool on, Explorer runs the Background Thread on **PrimJS** instead of
JavaScriptCore (the settings page shows "Current BTS engine"). That matters on
a real iPhone, where JavaScriptCore has no WebAssembly: check anything
engine-sensitive with DevTool off as well.

## Op-stream logger

Every render the renderer ships a batch of **ops** to the Main Thread
(`CREATE`, `INSERT`, `SET_TEXT`, `SET_CLASS`, …). When a screen renders wrong,
seeing that batch is the fastest way to tell whether the bug is in your
component (wrong ops emitted) or downstream. Turn it on:

```ts
import { enableLynxOpLogging, disableLynxOpLogging } from 'ng-lynx';

enableLynxOpLogging();   // every flush now prints its decoded ops
// … reproduce the issue …
disableLynxOpLogging();
```

Each flush prints a header and one readable line per op:

```
[ng-lynx] flush (10 ops)
  SET_ATTR    #1 ng-version="21.2.17"
  CREATE      #2 view
  INSERT      #2 → #1 (append)
  CREATE      #3 text
  INSERT      #3 → #2 (append)
  CREATE_TEXT #4
  INSERT      #4 → #3 (append)
  SET_TEXT    #4 "Count: 0"
  SET_CLASS   #2 "app"
  SET_CLASS   #3 "label"
```

`#N` is the element id; `→` shows insert parent/child. It reflects the batch
**after** coalescing — so it's exactly what crosses the thread boundary (note
the `SET_CLASS`/`SET_STYLE` ops land at the end of the batch, per the deferred
serialization in [03 — Renderer internals](03-renderer-internals.md)).

**Capture instead of print** — feed a `sink` to route lines anywhere (a file, a
test buffer, an on-screen overlay you build):

```ts
const log: string[] = [];
enableLynxOpLogging({ sink: (line) => log.push(line) });
```

It's **runtime-toggleable and off by default**, not compile-time gated — so it
works in any build when explicitly enabled, and costs one boolean check per
flush when off. Leave the calls out of production, or gate your own
`enableLynxOpLogging()` behind a debug flag.

## Timing & metrics

For *performance* rather than correctness, use
[`LynxPerformance`](25-performance.md): observe `pipeline` / `metric.fcp` /
`metric.actual-fmp` entries, tag a render with `__lynx_timing_flag`, and drive Lynx
DevTool tracing (`profileStart`/`profileEnd`).

## What else is available

- **Lynx DevTool** — the platform's own inspector (layout, network, console)
  when running in Lynx Explorer / a debug build.
- **The web preview** — a real browser tab (`__web_preview`) where you *do*
  get Chrome DevTools for the rendered custom elements, console, and network.
  The Background Thread runs in a Web Worker there, so its `console.log` may
  not surface in the page console — the op-stream logger's `sink` is a way
  around that (route lines through an op or a global the main thread reads).
- **`rspeedy inspect`** — the resolved build config, for diagnosing plugin /
  bundling issues.
- **Headless harnesses** (`npm run verify*`) and `ng-lynx/testing` — the
  fastest loop for reproducing a rendering bug without a device
  ([19 — Testing](19-testing.md)).

## Verifying

`npm run verify:oplog` asserts the logger captures a flush header with an op
count and correctly-formatted `CREATE` / `INSERT` / `SET_TEXT` / `SET_EVENT`
lines, that an update flush logs the changed text, and that
`disableLynxOpLogging()` stops capture while rendering continues.
