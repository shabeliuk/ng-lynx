# Architecture

## Lynx is dual-threaded

Lynx splits a running app across two JS contexts:

- **Main Thread (a.k.a. Lepus)** — owns the UI. It creates and mutates the real
  native elements through the **element PAPI**: global functions like
  `__CreateView`, `__AppendElement`, `__SetAttribute`, `__AddEvent`, and
  `__FlushElementTree`. It runs first, before your app logic.
- **Background Thread** — runs your application's JavaScript: state, effects,
  event handlers, framework code.

The two threads communicate by message passing, not shared memory. The
Background Thread asks the Main Thread to mutate UI; the Main Thread tells the
Background Thread when events fire. Keeping heavy app logic off the UI thread is
what makes Lynx feel responsive.

A framework binding's job is to (1) run on the Background Thread and decide
*what the UI should be*, and (2) express that as instructions the Main Thread
can apply. ReactLynx does this for React. **angular-lynx does it for Angular.**

## The pattern: a custom renderer that emits ops

Angular never talks to the DOM directly. Every element/text/attribute/event
operation a component performs goes through the
[`Renderer2`](https://angular.dev/api/core/Renderer2) abstraction.
`@angular/platform-browser` ships a `Renderer2` that mutates the DOM; this is
exactly the seam non-DOM platforms (NativeScript, etc.) replace.

angular-lynx provides **`LynxRenderer2`** (+ `LynxRendererFactory2`). It runs on
the Background Thread and does two things per operation:

1. updates a cheap **shadow tree** of `ShadowElement` nodes (so Angular can
   navigate `parentNode` / `nextSibling` synchronously), and
2. appends a compact **op** to a buffer (`[CREATE, id, 'view']`, `[INSERT, …]`,
   `[SET_ATTR, …]`, …).

At the end of each change-detection pass, the buffered ops are JSON-serialized
and shipped to the Main Thread in one `callLepusMethod('ngPatchUpdate', …)`
call. The Main Thread replays them against real elements and calls
`__FlushElementTree()` once to commit.

```
┌─────────────────────── Background Thread ───────────────────────┐
│                                                                  │
│   Angular component (signals)                                    │
│        │  render                                                 │
│        ▼                                                         │
│   LynxRenderer2 ──► ShadowElement tree (BG-only mirror)          │
│        │  pushOp(...)                                            │
│        ▼                                                         │
│   ops buffer  ──(end of CD pass)──► flushOps()                   │
│                                          │                       │
└──────────────────────────────────────────┼──────────────────────┘
                                            │ callLepusMethod('ngPatchUpdate', {data})
                                            ▼
┌─────────────────────────── Main Thread (Lepus) ─────────────────┐
│   ngPatchUpdate(ops) ──► applyOps()                              │
│        │   __CreateView / __AppendElement / __SetAttribute / …   │
│        ▼                                                         │
│   real Lynx elements ──► __FlushElementTree()  ──► native UI     │
└──────────────────────────────────────────────────────────────────┘
            ▲                                          │
            │  publishEvent(sign, data)                │ user taps
            └──────────────── event sign registry ◄────┘
```

## Why zoneless + signals

Angular's classic change detection relies on **Zone.js**, which monkey-patches
timers, promises, and many globals to know when to re-check the view. On Lynx's
PrimJS engine that patching is risky and heavyweight. angular-lynx therefore
targets **zoneless** Angular (`provideZonelessChangeDetection()`):

- Reading a signal in a template registers a dependency.
- Writing a signal (or calling `markForCheck()`) schedules a change-detection
  pass via Angular's built-in scheduler.
- After the pass renders (producing renderer ops), Angular calls
  `RendererFactory2.end()` — our cue to **flush** ops to the Main Thread.

Flushing once per change-detection pass keeps the
runtime decoupled from Zone.js entirely. See
[docs/03-renderer-internals.md](03-renderer-internals.md) for the flush details.

## Events: the sign registry

Binding `(tap)="onTap()"` calls `LynxRenderer2.listen(el, 'tap', cb)`. The
renderer:

1. registers `cb` in a Background-Thread table and gets back a unique **sign**
   string,
2. emits `[SET_EVENT, elementId, 'bindEvent', 'tap', sign]`.

On the Main Thread that becomes `__AddEvent(el, 'bindEvent', 'tap', sign)`. When
the user taps, the native runtime calls `publishEvent(sign, data)` back on the
Background Thread, which looks up `cb` and runs it. Only the small event payload
crosses the boundary — the handler body never does.

Continue to [02 — Getting started](02-getting-started.md).
