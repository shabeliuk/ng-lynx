# The Main-Thread worklet runtime

A worklet runs on the Main Thread when the engine fires an event bound to it
(see [11 — Worklets](11-worklets.md)). The engine doesn't run the worklet
itself: it calls a JavaScript function, `runWorklet`, that a **worklet
runtime** puts on the Main Thread's `globalThis`. Up to 0.1.0-rc.0, ng-lynx
bundled the one from `@lynx-js/react` (`@lynx-js/react/worklet-runtime/init`).
ng-lynx now ships its own, in `main-thread/src/worklet-runtime/`.

**Why its own.** `@lynx-js/react` is a 24 MB install that pulls a Preact fork
and declares `@types/react` as a peer, for about 1,300 lines ng-lynx used part
of. Most of that runtime serves ReactLynx's compiler: closures captured by
the `'main thread'` directive, its main-thread refs, and its first-screen
hydration. ng-lynx's worklets are explicit functions with their own
equivalents of all three. The new runtime keeps the engine contract
unchanged, adds nothing ng-lynx doesn't use, and has its own tests.

The behaviour of `@lynx-js/react`'s runtime (Apache-2.0, The Lynx Authors),
0.129.3, was the reference for the engine contract below. The code is new.

## The engine contract

What calls into the runtime, read from the engine sources:

| Caller | Call | Reads back |
| --- | --- | --- |
| Native engine, a worklet event (`__AddEvent(el, type, name, { type: 'worklet', value: ctx })`) | `runWorklet(ctx, [event], { source: 1 })` | `result.eventReturnResult`, if `result` is an object: bit `0x1` stops propagation, bit `0x2` stops immediate propagation |
| Native engine, a gesture callback (`__SetGestureDetector`) | `runWorklet(ctx, [event, gestureManager], { source: 2 })` | nothing |
| Web preview (`@lynx-js/web-core`) | `runWorklet(ctx, [event])`, no options | nothing |
| ng-lynx's `registerWorklet` / `defineWorklet` | `registerWorkletInternal('main-thread', id, fn)` | — |

The native side is `TouchEventHandler::TriggerFiberElementWorklet` and
`FireElementWorklet` in `lynx-family/lynx`'s
`core/renderer/events/touch_event_handler.cc`; the `EventResult` and
`RunWorkletType` enums are in `touch_event_handler.h`. The web side is
`WASMJSBinding.runWorklet` in `@lynx-js/web-core`. In every case `ctx` is the
object passed to `__AddEvent` (or listed in the gesture config), and
`event.target` / `event.currentTarget` carry the native element as
`elementRefptr`.

## What the runtime installs

`installWorkletRuntime()` runs once when the Main-Thread bundle loads, before
any `mainThreadModules`. It sets:

| Global | What it is |
| --- | --- |
| `runWorklet(ctx, params, options?)` | The entry point above. |
| `registerWorkletInternal(type, id, fn)`, `registerWorklet(type, id, fn)` | Store `fn` under `id`. Two names, because Lynx's tooling has used both. |
| `lynxWorkletImpl` | `{ _workletMap }`, the same functions by id. ReactLynx checks for this object to see whether a runtime is loaded, so its runtime won't initialise over this one. |
| `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval` | The Main Thread's `lynx` timers, as globals. Only the ones `lynx` has: a missing one is left alone, not set to `undefined`. `clearInterval` falls back to `clearTimeInterval`, Lynx 2.14's spelling. They're copied as they are, not bound to `lynx`: on the web preview they're the browser's own, which throw "Illegal invocation" when called with any other `this`. |
| `requestAnimationFrame`, `cancelAnimationFrame` | `lynx`'s, as globals. |
| `lynx.querySelector`, `lynx.querySelectorAll` | Search the page, returning `MainThreadElement`s: Lynx's documented main-thread API. `mainThreadLynx` has the same two. |

It installs every time it runs, without checking whether it ran before. Hot
reload evaluates the Main-Thread bundle again, and the globals have to point
at the new bundle's registry, not the old one.

## How `runWorklet` runs a worklet

1. **Check `ctx`.** Not an object, or no `_wkltId`: return `undefined`, as
   Lynx's runtime does. An id nothing registered throws an `Error` that names
   the id and points at `mainThreadModules`; the engine reports it.
2. **Bind the function.** The registered function runs with `this` set to a
   shallow copy of `ctx`, the calling convention ng-lynx's dispatcher (and
   ReactLynx's compiled worklets) rely on. The bound function is cached per
   `ctx` object in a `WeakMap`, so state a worklet keeps on `this` lasts from
   one event to the next, until the id is registered again: after a hot
   reload the new function runs, with a new copy. The copy, not `ctx` itself,
   is what's bound: PrimJS keeps a `WeakMap` value alive while it points back
   at its key.
3. **Make elements live.** Every object in `params[0]` (the event) with an
   `elementRefptr` becomes a `MainThreadElement` for that element, keeping
   the object's other fields: `id`, `uid`, `dataset`. Lynx's runtime replaces
   the object and loses them. Only the event is walked, at most 16 levels
   deep; a gesture's state manager is passed as it came.
4. **Add the event methods.** For a native event (`source: 1`),
   `event.stopPropagation()` and `event.stopImmediatePropagation()` set the
   bits the engine reads back, and the result is
   `{ returnValue, eventReturnResult }`. Gestures and the web preview get the
   worklet's own return value, and no methods: neither reads the bits back.

Exceptions from the worklet aren't caught: they reach the engine, which
reports them with their stack, as before.

## Element handles

`MainThreadElement` (in `worklet-runtime/element.ts`) wraps a native element
for worklets, refs, event targets, `mainThreadLynx` and `lynx.querySelector`.
Writes (`setStyle`, `setStyleProperty`, `setStyleProperties`, `setAttribute`,
`invoke`) defer `__FlushElementTree` to one microtask, shared by every
element: see [11 — Worklets](11-worklets.md#bug-history-setstylesetattribute-crashed-the-wasm-context-on-web)
for why it can't be synchronous.

The native element is kept in a property that isn't enumerable, and
`toJSON()` returns `{ id, uid, dataset }`. So `console.log(event)` and
`runOnBackground(event)` never touch the native object: Lynx 2.15 and older
crashed when one was printed or sent between threads.

`getComputedStyleProperty` needs `__GetComputedStyleByKey`, which Lynx 3.5
added. Where it's missing, the call throws an error saying so.

## What it leaves out

Everything below is in `@lynx-js/react`'s runtime, for ReactLynx's compiler
or for engines ng-lynx doesn't support:

| In Lynx's runtime | Why ng-lynx doesn't need it |
| --- | --- |
| Walking `ctx` for captured closures (`_c`), nested worklets, `_wvid` refs and `_jsFn` handles | Those are what ReactLynx's `'main thread'` directive compiles to. ng-lynx's `ctx` is its own: `bindWorklet`'s params, and what an inline `'main thread'` function captures, carry `_refId`, `_mtFnId` and `_bgFnId` handles, made live by `worklet-apply.ts`. |
| `MainThreadRef` / `MainThreadObject` storage and init-value patches | ng-lynx's refs are bound with `SET_REF` ops and resolved from the element registry. |
| First-screen hydration (`_hydrateCtx`, negative ref ids, delayed `runOnBackground`) | ng-lynx's first screen is a byte-identical snapshot of the first batch, so nothing needs hydrating. See [20 — First screen](20-first-screen.md). |
| `JsFunctionLifecycleManager` and `Lynx.Worklet.releaseBackgroundWorkletCtx` | Releases ReactLynx's `runOnBackground` closures when they're collected. ng-lynx's `backgroundFunction` handles end with their owner. |
| `Lynx.Worklet.runWorkletCtx`, `FunctionCallRet`, `releaseWorkletRef` | ReactLynx's `runOnMainThread` channel. ng-lynx's uses `callLepusMethod` and its own events. |
| `_lepusWorkletHash` and the delayed-event queue | Worklets compiled before ReactLynx 0.99. |
| `_eomImpl.setShouldFlush` | Lets ReactLynx's renderer hold back the element flush while it renders. ng-lynx's renderer flushes once per batch on its own. |
| `__LoadLepusChunk('worklet-runtime')` | How a ReactLynx dynamic component loads the runtime. An ng-lynx dynamic component uses its host's. |
| `lynxSdkVersion` gates below 3.2 | ng-lynx's default `targetSdkVersion` is 3.2. The one newer gate, `getComputedStyleProperty`, is a feature check instead. |
| A flush-loop detector in development builds | Not ported yet. A worklet that keeps writing from `requestAnimationFrame` isn't a loop: it yields every frame. |

A ReactLynx bundle that expects its own runtime on the same Main Thread won't
work alongside this one. That isn't a supported setup.

## Layout

| File | Contents |
| --- | --- |
| `worklet-runtime/index.ts` | `installWorkletRuntime()`, `clearWorklets()`. Internal: `ng-lynx/internal/worklet-runtime`. |
| `worklet-runtime/init.ts` | Calls `installWorkletRuntime()`. Public as `ng-lynx/worklet-runtime`, for a build that doesn't use `pluginAngularLynx`. |
| `worklet-runtime/registry.ts` | Functions by id, and whether the runtime is installed on this thread. |
| `worklet-runtime/run-worklet.ts` | `runWorklet`: steps 1, 2 and 4. |
| `worklet-runtime/event-targets.ts` | Step 3. |
| `worklet-runtime/element.ts` | `MainThreadElement`, the event-target handle, the shared flush, page queries. |
| `worklet-runtime/api-env.ts` | Timers, frames, `lynx.querySelector`. |
| `worklet-runtime/types.ts` | The engine's shapes: `ctx`, `RunWorkletOptions`, `RunWorkletSource`, `EventResult`. |

`pluginAngularLynx` adds `worklet-runtime/init.js` to the Main-Thread entry,
after `entry-main.js` and before the app's `mainThreadModules`, when
`mainThreadModules` isn't empty, as it did with Lynx's runtime. A Background
Thread copy of a worklet module (pulled in by importing a `WorkletHandle`)
finds the runtime not installed and registers nothing.

## Tests

- **`npm run verify:worklet-runtime`**, the runtime on its own, against the
  mock PAPI: registration and the compatibility globals; `ctx` checks, the
  unknown-id error, `this` being a cached copy; the event-result bits for each
  source; element handles from `elementRefptr`, with their fields, nesting,
  the depth limit, and JSON; timers, frames and `lynx.querySelector`; the
  shared flush.
- **The existing harnesses** (`verify:worklet`, `verify:gesture`,
  `verify:mtref`, `verify:animate`, `verify:main-thread-api` and the rest):
  `ng-lynx/testing`'s mock now installs this runtime instead of a stand-in,
  and fires events and gestures with the `source` the native engine sends.
- **Device flows**, on the iOS simulator and the Android emulator: all 15 of
  `packages/device-tests`, of which `main-thread`, `gesture`, `gesture-lab`
  and `timing` drive worklets. `main-thread` also checks the event result: a
  worklet's `stopPropagation()` keeps its tap from a Background `(tap)` on the
  box around it, and `currentTarget` arrives live, with its `dataset` and
  `uid`. With the bits zeroed in the runtime, that flow fails. See
  [41 — Device testing](41-device-testing.md).
- **A consumer install**, in `scripts/verify-consumer.mjs`: an app scaffolded
  from the packed tarball, with a worklet in `mainThreadModules`, builds with
  no `@lynx-js/react` installed.

Run on Lynx Explorer 4.2 on 2026-11-18, iOS simulator and Android emulator: all
15 flows pass.

Run in the web preview on 2026-11-18, `examples/worklet`: the dim, the tap
count from `runOnBackground`, the reset through a ref, the `lynxAnimate` fade
and the element check all work. The gesture doesn't fire there: web-core's
detectors are no-ops ([32 — Gestures](32-gestures.md)). That run found a bug
no other test had: the timers were first installed bound to `lynx`, and the
browser's own `setTimeout` threw "Illegal invocation", so `lynxAnimate`
painted its first frame and stopped. The unit harness now uses timers that
throw the same way.
