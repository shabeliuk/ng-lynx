# Main-thread worklets

Most handlers run on the Background Thread: a tap travels BG-ward, your Angular
code runs, ops travel back. That's fine for logic, but too slow for things that
must track a finger — drag, pinch, scroll-linked effects. A **worklet** is a
function that runs on the **Main Thread**, right where the UI is, so it can read
the event and mutate the element with zero cross-thread latency.

See the runnable [`examples/worklet`](../examples/worklet) and
[`examples/product-detail`](../examples/product-detail), the official
[Product Detail tutorial](https://lynxjs.org/learn/product-detail) in Angular. The
checks are `npm run verify:worklet` and `npm run verify:main-thread-api`. Two features
build directly on this machinery: [32 — Gestures](32-gestures.md) (native pan/tap/
longpress/… detectors, whose callbacks are ordinary worklets) and
[33 — Animations](33-animations.md) (`lynxAnimate` and `lynxTween`, tween helpers a
worklet can call).

**Coming from ReactLynx?**

| ReactLynx | ng-lynx |
| --- | --- |
| `main-thread:bindtap={fn}` | `[lynxMainThread]="{ tap: fn }"` |
| A `'main thread'` closure | `defineWorklet` in a Main-Thread module. Pass what it would capture through [`bindWorklet`](#state-for-each-instance-bindworklet-and-mainthreadref) |
| `useMainThreadRef(value)` | `mainThreadRef(value)`, or `defineMainThreadRef(id, value)` for one shared ref |
| `main-thread:ref={ref}` | `[lynxMainThreadRef]="ref"` |
| `runOnMainThread(fn)(...args)` | [`runOnMainThread(fn)(...args)`](#calling-across-the-threads), with `fn` from `defineMainThreadFunction` |
| `runOnBackground(fn)(...args)` | [`runOnBackground(handle)(...args)`](#calling-across-the-threads), with `handle` from `backgroundFunction(fn)` |
| `MainThread.Element` | [`MainThreadElement`](#the-element-api), the same methods |
| Main-thread `lynx.querySelector`, … | [`mainThreadLynx`](#mainthreadlynx-the-rest-of-the-main-thread-api) |

## The model

ng-lynx uses an **explicit** worklet model: you write the worklet in a
Main-Thread module and bind it from a component. Use `defineWorklet` for a
**typed reference** (recommended) or `registerWorklet` for a string id.

**1. Define the worklet (Main-Thread module):**

```ts
// src/worklets.ts
import { defineWorklet, type WorkletContext } from 'ng-lynx/worklet';

// Registers it AND returns a typed reference to bind — no magic string. The
// registry id comes from the function's own name (`pressFadeMT`) — name it
// (a `function` declaration, not an anonymous arrow) so there's nothing to
// keep in sync by hand. See "Naming worklets" below.
function pressFadeMT(ctx: WorkletContext): void {
  ctx.setStyle('opacity: 0.5');     // mutate the element on the MT, instantly
  ctx.runOnBackground({ pressed: true }); // optional: notify the BG
}
export const pressFade = defineWorklet(pressFadeMT);
```

**2. Tell the build to load it on the Main Thread:**

```ts
// lynx.config.ts
pluginAngularLynx({ mainThreadModules: ['./src/worklets.ts'] })
```

**3. Bind the reference on an element:**

```ts
import { LynxMainThread } from 'ng-lynx';
import { pressFade } from './worklets';

@Component({
  imports: [LynxMainThread],
  template: `
    <view
      [lynxMainThread]="{ tap: pressFade }"
      (mainThreadCallback)="onPressed($event)">
    </view>
  `,
})
export class AppComponent {
  protected readonly pressFade = pressFade; // expose the ref to the template
  onPressed(data: unknown) { /* runs on the BG when the worklet calls runOnBackground */ }
}
```

> Importing the reference pulls the worklet module into the Background bundle too,
> but the worklet body only ever runs on the Main Thread (the BG copy is unused).
> `registerWorklet` detects this case (no Main-Thread-only PAPI globals present)
> and stays silent rather than warning — it only warns if the worklet-runtime is
> genuinely missing on the *real* Main Thread. Prefer `defineWorklet` over a bare
> string id (`{ tap: 'pressFade' }`) — the binding is then type-checked with no
> second string to keep in sync.

### Naming worklets

`defineWorklet`/`registerWorklet` are overloaded — pass just the function, or
an explicit id first, the same as before:

```ts
export const pressFade = defineWorklet(pressFadeMT);          // id: 'pressFadeMT'
export const pressFade = defineWorklet('pressFade', pressFadeMT); // id: 'pressFade'
```

The no-id form derives the registry key from `fn.name`, which only works if
`fn` actually *has* a name — a `function` declaration or named function
expression does; **an anonymous arrow function does not, even when assigned to
a `const`**:

```ts
const pressFade = (ctx) => { ... };  // pressFade.name === 'pressFade' ✅
defineWorklet((ctx) => { ... });     // the arrow's .name === ''        ❌
```

The difference is *where* the function sits relative to the assignment.
JavaScript only infers a name when an (otherwise-anonymous) function
expression is the assignment's *direct* right-hand side — true for the first
line above, false for the second, where the arrow is a call argument one level
removed from any assignment (`defineWorklet`'s own return value is what gets
assigned, not the arrow itself). `defineWorklet`/`registerWorklet` throw
immediately on an empty derived id, rather than letting every anonymous
worklet silently collide on `_workletMap['']` — name the function, or fall
back to the explicit-id form.

**Minified builds keep the names.** The Lynx build engine minifies with
`inline: 2`, which folds a single-use `function pressFadeMT(ctx) {…}` into
`defineWorklet(function (e) {…})`, an anonymous function. Until 2026-10-30
that made every production build that relied on derived ids throw "can't
derive a worklet id" at load (found on Explorer 4.1 and 4.2, Android; dev
builds aren't minified, so they never showed it). When `mainThreadModules`
is set, `pluginAngularLynx` now adds `keep_fnames: true` to the minifier's
`compress` and `mangle` options, and both threads derive the same ids. An
explicit id never depended on it.

Either way, the id (derived or explicit) must be **unique across your whole
Main-Thread bundle** — nothing detects a collision, the same as the
explicit-id form already required.

## The worklet context

A worklet receives a `WorkletContext`:

| Member | Description |
| --- | --- |
| `event` | The native event object. Type it with `WorkletContext<MainThreadTouchEvent>`, for `touches`. |
| `element` | The bound element, as a [`MainThreadElement`](#the-element-api). |
| `params` | What this binding got from [`bindWorklet`](#state-for-each-instance-bindworklet-and-mainthreadref). |
| `gesture` | The detector's state, in a [`[lynxGesture]`](32-gestures.md) phase. `undefined` otherwise. |
| `setStyle(css)` | Set inline styles on the bound element (sync, on the MT). |
| `setAttribute(key, value)` | Set an attribute on the bound element (sync, on the MT). |
| `getComputedStyleProperty(name)` | Read a resolved (computed) style value off the bound element (sync, on the MT) — e.g. animate *from* the current value. |
| `runOnBackground(data)` | Send `data` to the Background Thread → surfaces at `(mainThreadCallback)`. |

`getComputedStyleProperty` is the read counterpart to `setStyle`, backed by the
`__GetComputedStyleByKey` Element PAPI (a pure read — no flush). Returns the
value as a string. The same method is available on a main-thread `ref.current`
(a `MainThreadElement`) below. Verified by `npm run verify:worklet` (the worklet
sets a style, reads it back, and ships it to the BG).

## Main-thread refs (reach another element)

`ctx` only reaches the element the event fired on. A **main-thread ref** lets a
worklet imperatively access *another* element — e.g. tap a button, animate a
card — with no Background round-trip.

```ts
// gestures.mt.ts  (Main-Thread module)
import { defineMainThreadRef, defineWorklet } from 'ng-lynx/worklet';

// defineMainThreadRef always takes an explicit id — there's no function here
// to derive one from, unlike defineWorklet.
export const card = defineMainThreadRef('card');

function resetCardMT(): void {
  card.current?.setStyle('opacity: 1'); // mutate a *different* element
}
export const resetCard = defineWorklet(resetCardMT);
```

```ts
// component
import { LynxMainThread, LynxMainThreadRef } from 'ng-lynx';
import { card, resetCard } from './gestures.mt';

@Component({
  imports: [LynxMainThread, LynxMainThreadRef],
  template: `
    <view [lynxMainThreadRef]="card" class="card">…</view>
    <view [lynxMainThread]="{ tap: resetCard }" class="btn">Reset</view>
  `,
})
export class AppComponent {
  protected readonly card = card;
  protected readonly resetCard = resetCard;
}
```

`ref.current` is a [`MainThreadElement`](#the-element-api) or `null`.
It resolves through the live element registry, so it **auto-nulls** once its
element is destroyed (a worklet using a stale ref is a safe no-op). A ref can
also move to another element: when `@if` swaps two views that bind the same ref,
it ends up on the new one, whichever order Angular changes them in. Demoed in
`examples/worklet`; verified by `npm run verify:mtref`.

A ref can hold a value instead, which stays on the Main Thread:

```ts
export const startX = defineMainThreadRef('startX', 0);
// in a worklet: startX.current = ctx.event.params.clientX;
```

## State for each instance: `bindWorklet` and `mainThreadRef`

`defineMainThreadRef('card')` is one ref with one id, so two copies of a component
would share it. In ReactLynx, a closure gives each instance its own state. An AOT
build can't extract a closure ([why](05-build-integration.md#why-inline-main-thread-worklets-arent-possible-under-aot)),
so pass that state instead:

- `mainThreadRef(value?)`, from a component, makes a new ref per instance. In a field,
  it's released with the component.
- `bindWorklet(worklet, params)` gives one binding its own `ctx.params`. Refs arrive
  live, main-thread functions arrive callable, and the rest has to be JSON-serializable.

```ts
// swiper.mt.ts
export interface SwiperState {
  container: MainThreadRef<MainThreadElement | null>;
  offset: MainThreadRef<number>;
  itemWidth: number;
  easing: (t: number) => number;
}

export const onTouchMove = defineWorklet<MainThreadTouchEvent, SwiperState>(function swiperTouchMoveMT(ctx) {
  const { container, offset } = ctx.params;
  offset.current = ctx.event.touches[0]!.clientX;
  container.current?.setStyleProperty('transform', `translateX(${offset.current}px)`);
});
```

```ts
// swiper.component.ts
@Component({
  imports: [LynxMainThread, LynxMainThreadRef],
  template: `<view [lynxMainThreadRef]="container" [lynxMainThread]="events">…</view>`,
})
export class SwiperComponent {
  readonly container = mainThreadRef<MainThreadElement | null>();
  private readonly offset = mainThreadRef(0);

  readonly events = {
    touchmove: bindWorklet(onTouchMove, {
      container: this.container,
      offset: this.offset,
      itemWidth: 320,
      easing: linear, // from defineMainThreadFunction
    }),
  };
}
```

`bindWorklet` type-checks `params` against the worklet: a `MainThreadRef<number>` on the
Main Thread is a handle from `mainThreadRef(0)` here, and a function is a handle from
`defineMainThreadFunction`.

Keep the result in a field or a `computed`. A new value for `[lynxMainThread]` rebinds
the events that changed, so building one in the template would rebind on every change
detection.

## Calling across the threads

**Background to Main.** `runOnMainThread` calls a function from
`defineMainThreadFunction` and returns its result. Refs and functions in the arguments
arrive live. A throw rejects the promise with its message. Render ops already buffered
are sent first, so the function sees elements created in the same tick.

```ts
// swiper.mt.ts
export const goToIndex = defineMainThreadFunction(function swiperGoToIndexMT(state: SwiperState, index: number) {
  state.container.current?.setStyleProperty('transform', `translateX(${-index * state.itemWidth}px)`);
  return index;
});

// component
const index = await runOnMainThread(goToIndex)(this.state, 2);
```

**Main to Background.** `backgroundFunction` exposes a function to the Main Thread.
Pass the handle in, and call it with `runOnBackground`, which returns the result. In a
field, it's released with the component, and a call that arrives after that resolves
`undefined` rather than hanging.

```ts
// component
readonly onIndexChange = backgroundFunction((index: number) => this.current.set(index));

// swiper.mt.ts
void runOnBackground(state.onIndexChange)(index);
```

`ctx.runOnBackground(data)` with `(mainThreadCallback)` still works, for a worklet that
only reports something.

Arguments and results cross as JSON. A function's `Element` result, for example, can't.

## The element API

`ctx.element`, a ref's `current`, and what `mainThreadLynx` finds are all a
`MainThreadElement`: Lynx's
[`MainThread.Element`](https://lynxjs.org/api/lynx-api/main-thread/main-thread-element),
plus `setStyle` and `getComputedStyleProperty`.

| Method | |
| --- | --- |
| `setStyle(css)` | Replace the whole inline style. |
| `setStyleProperty(name, value)`, `setStyleProperties({ … })` | Change some inline properties, keeping the rest. |
| `setAttribute(name, value)`, `getAttribute(name)`, `getAttributeNames()` | Attributes. `data-*` written from a template is in the dataset, not here. |
| `getComputedStyleProperty(name)` | The resolved value, in the engine's units. |
| `querySelector(selector)`, `querySelectorAll(selector)` | Descendants. Needs `enableCSSSelector`. |
| `invoke(method, params?)` | A UI method such as `scrollTo`. A promise, rejected if the code isn't 0. |
| `animate(keyframes, msOrOptions)` | A native animation, returning `cancel()`, `pause()`, `play()`. |

Writes flush in a microtask, so several in one worklet become one commit.

> **A `[style.x]` binding wins.** The Background Thread writes an element's whole inline
> style when a `[style.x]` binding on it changes, which replaces what a worklet set.
> Don't bind and animate the same element's inline style.

## `mainThreadLynx`: the rest of the main-thread API

| Member | |
| --- | --- |
| `querySelector`, `querySelectorAll` | Search the whole page. Needs `enableCSSSelector`. |
| `requestAnimationFrame`, `cancelAnimationFrame` | Never fires in the web preview, whose Main Thread is a hidden iframe. `lynxTween` runs in both. |
| `getTextInfo(text, { fontSize })` | Measure text without rendering it. On a device only: the web preview has none, and it throws there. |
| `globalProps` | The host's global props. |
| `stopExposure`, `resumeExposure` | Exposure. |
| `getSessionStorageItem`, `setSessionStorageItem`, `subscribeSessionStorage`, `unsubscribeSessionStorage` | Session storage. |
| `registerDataProcessors` | Normalise what the host passes, before the app sees it. See [17 — Host data](17-host-data.md#normalising-host-data-data-processors). |

Run on Lynx Explorer 4.2, on the iOS simulator and the Android emulator:
`runOnMainThread`, `runOnBackground`, `bindWorklet`, value and element refs,
`setStyleProperty`, `setStyleProperties`, `getAttribute`, `getAttributeNames`,
`querySelector`, `querySelectorAll`, `invoke`, `getComputedStyleProperty`, `getTextInfo`,
`registerDataProcessors`.
`animate` was seen mid-fade on Android, and ran without an error on iOS. The session
storage, exposure and `requestAnimationFrame` members have only run against the mock.

## How it works

The engine runs a worklet by calling `runWorklet` on the Main Thread. That function
comes from ng-lynx's **worklet runtime**, which `pluginAngularLynx` bundles into the
Main-Thread entry after the PAPI executor and before your `mainThreadModules`, and
only when there are some. It also puts `lynx`'s timers on `globalThis` and adds the
main-thread `lynx.querySelector`. Up to 0.1.0-rc.0 this was `@lynx-js/react`'s
runtime; ng-lynx now has its own, with the same engine contract.
[42 — The worklet runtime](42-worklet-runtime.md) has the contract, what the runtime
does with each event, and what it leaves out.

- `[lynxMainThread]` emits a `SET_WORKLET_EVENT` op carrying `{ _wkltId,
  _bgCallbackId, _params }` (op code `11`); `[lynxMainThreadRef]` emits `SET_REF`
  (`[13, elementId, refId]`), which maps the ref id to the element id on the MT.
- `runOnMainThread` calls `callLepusMethod`, the same queue as the render ops, so a call
  is ordered after them. The result comes back as a cross-thread event, as do
  `runOnBackground`'s call and result. All of them carry JSON.
- On the Main Thread, `applySetWorkletEvent` calls the real
  `__AddEvent(el, type, name, { type: 'worklet', value: ctx })` — the wire
  shape the engine's `typeof`-based dispatch actually requires (a `string` is
  a cross-thread sign; an `object` routes to the worklet runtime; **a function
  is neither and is silently a no-op** — see the bug note below).
- `registerWorklet`/`defineWorklet` register a small dispatcher function with
  the runtime. When the event fires, `runWorklet` finds it by `ctx._wkltId` and
  calls it with `this` bound to a copy of `ctx` — so the dispatcher recovers `_elId` /
  `_bgCallbackId` from `this` and builds the `WorkletContext` your worklet
  function actually receives (`setStyle`/`setAttribute` wrap the bound element
  directly via the same MT mutators every other imperative API in this
  package uses; there's no Background ops batch for a pure MT mutation —
  asserted by `verify:worklet`).
- `runOnBackground` hops back to the BG through the bridge the background
  bootstrap installs (`entry-background.ts`). ReactLynx's cross-thread closure
  system isn't needed: worklets here are always plain, explicitly-authored
  top-level functions with no captured component-scope state.

### Bug history: an earlier version of this was a no-op on a real engine

An earlier version of `applySetWorkletEvent` passed a **raw JS function** as
`__AddEvent`'s 4th argument, instead of the `{ type: 'worklet', value }` shape
above. Every headless harness passed, because the test mock accepted a
function directly — but on a real engine (web *or* native) `__AddEvent`'s
`typeof`-based dispatch doesn't have a branch for a function, so the listener
was **silently never registered**: tapping a worklet-bound element did
nothing at all. Caught only once a real example (`examples/worklet`) was
actually run in Lynx Explorer — none of the single-component examples had
exercised this path on-device before. `verify/mock-papi.ts`'s `__AddEvent`
mock now mirrors the real `typeof` dispatch (string / worklet-object / silent
no-op for anything else, including a function), so this class of bug fails
`npm run verify:worklet` / `verify:mtref` directly instead of only surfacing
on-device.

### Bug history: `setStyle`/`setAttribute` crashed the WASM context on web

Once binding worked, calling `ctx.setStyle(...)` from inside a worklet crashed
the web preview with `Uncaught Error: recursive use of an object detected
which would lead to unsafe aliasing in rust`. The worklet runs *inside* a call
from the native engine into its WASM context (the web target's
`@lynx-js/web-core` is WASM-backed); `mtElementHandle`'s `setStyle`/
`setAttribute` called `__FlushElementTree` **synchronously**, re-entering that
same WASM context while it was still on the call stack — `wasm-bindgen`'s
borrow guard panics rather than risk a data race. Fixed by deferring the flush
to a microtask (coalescing same-tick mutations into one), so it runs after the
current call stack — including the WASM frame — has unwound. This exactly
mirrors `@lynx-js/react`'s real `Element.flushElementTree`
(`runtime/worklet-runtime/main.js`), which defers the same way; this package's
`mtElementHandle` just hadn't, since it predates the real-runtime integration
above. Not caught by the headless harness — the mock's `__FlushElementTree` is
a no-op with no WASM-reentrancy concept to model, so this one needed the real
web preview to surface.

### Bug history: wrong bundle import order broke the whole app on-device

This was with `@lynx-js/react`'s runtime, which ng-lynx no longer uses. After both
fixes above, the native build failed entirely —
`TypeError: processData is not a function`, thrown from `main-thread.js`
before any UI rendered. The plugin bundled the Main-Thread entry as
`[workletRuntime, entryMain, …]`. The worklet-runtime's top-level code reads
the bare global `SystemInfo` unconditionally (an internal version-check
helper); `entry-main.ts`'s top-level code is what sets `globalThis.SystemInfo`
(copied from `lynx.SystemInfo`). With the runtime loading *first*, that read
threw before `entry-main.ts` ever ran, aborting the whole script — so
`processData`/`renderPage`/everything else it defines were simply never
assigned. The fix was the import order itself: `[entryMain, workletRuntime,
…]` (a detail this package's first pass at the integration got backwards). Worth remembering if this ever needs touching again — the ordering
constraint isn't obvious from either module's public API.

### Bug history: `runOnBackground` silently did nothing on a real engine

With all three fixes above, `setStyle`/`setAttribute`/main-thread refs all
worked correctly on-device — but `ctx.runOnBackground(data)` did nothing: no
error, no effect, the bound Angular signal never updated. The bridge read and
wrote a shared `globalThis.__ngRunOnBackground` property — fine in the
headless harness (one process, one `globalThis`), but **BG and MT do not
share a `globalThis` on a real engine**, confirmed by this exact symptom (a
property set on one side is invisible on the other, with no error either side
could detect).

The real mechanism, confirmed against `@lynx-js/web-core`'s actual
`LynxCrossThreadContext` (the same generic cross-thread pub/sub primitive the
worklet-runtime itself uses for its own `Lynx.Worklet.runWorkletCtx` event):
the Main Thread sends via `lynx.getJSContext().dispatchEvent({ type, data })`;
the Background Thread receives via
`lynx.getCoreContext().addEventListener(type, …)`. Each thread's `lynx` object
only exposes *its own* side of the channel — there's no `getJSContext()` on
the Background Thread or `getCoreContext()` on the Main Thread, by design.
Fixed in both `worklet-apply.ts` (send) and `entry-background.ts` (receive),
under a shared event-type constant (`RUN_ON_BACKGROUND_EVENT`, in
`internal/src/ops.ts`).

One more wrinkle: `entry-background.ts` is prepended first in every
Background bundle, so its top-level code can't assume `lynx` exists yet (the
same ordering class as the Main-Thread `processData` bug above) — the
`addEventListener` call is deferred one microtask, which is enough in
practice (nothing can call `runOnBackground` before the app has rendered at
least once). `verify/mock-papi.ts` now mocks `getJSContext`/`getCoreContext`
as a real (microtask-deferred) pub/sub pair instead of a same-process
shortcut, so `verify:worklet`'s `runOnBackground` assertion now actually
exercises this path.

## ⚠️ Status & limitations

- **Explicit definition only (no inline `'main thread'`).** You author the
  worklet in a Main-Thread module (`defineWorklet`/`registerWorklet`) and bind a
  reference — the ergonomic ceiling under this build pipeline (typed, no magic
  strings, works in AOT + JIT). The inline form — marking a closure
  `'main thread'` and letting the compiler extract it (as in ReactLynx) — isn't
  possible here; see
  [05 — Build integration](05-build-integration.md#why-inline-main-thread-worklets-arent-possible-under-aot)
  for why. Worklets can't capture Background-Thread variables either, so pass them
  through [`bindWorklet`](#state-for-each-instance-bindworklet-and-mainthreadref).
- **Values cross as JSON.** `ctx.params` and the arguments of `runOnMainThread` and
  `runOnBackground` can hold refs, handles and JSON-serializable values, not arbitrary
  objects.
- **`ctx.element` is the bound element.** `ctx.event.currentTarget` is the same
  element, and `ctx.event.target` the one the event started on: both are
  `MainThreadElement`s that also carry the `id`, `uid` and `dataset` the engine sent.
  Up to 0.1.0-rc.0 they were `@lynx-js/react`'s element objects, without `setStyle`
  or those fields.
