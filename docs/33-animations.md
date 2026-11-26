# Animations

`@angular/animations` is DOM/WAAPI-bound (`AnimationBuilder`, `animate()`
metadata, the whole trigger system compile down to `Element.animate()` /
`Web Animations API` calls) — none of that exists on Lynx's element PAPI, so
the package doesn't apply here at all; don't add it as a dependency. Nor do
Angular's newer `animate.enter` / `animate.leave`: use
[`lynxEnter` / `lynxLeave`](#enter-and-leave-lynxenter--lynxleave) instead. This
page covers what genuinely does work.

## What already works

### CSS transitions / `@keyframes`, from CSS files

Lynx's build-time CSS engine (`@lynx-js/css-serializer`, the same one behind
[13 — Styling](13-styling.md)) parses `@keyframes` as a first-class rule type
(`KeyframesRule` in its own AST — confirmed by reading the serializer's
compiled source, `dist/types/LynxStyleNode.d.ts` / `dist/parse.js`), so plain
CSS keyframe animations and `transition`/`animation` properties in a `.css`
file are the **native** way to animate — same rules as any other Lynx style:
class-based, no runtime injection, no component `styles`/`styleUrls` (see
[13 — Styling](13-styling.md)). This is confirmed at the CSS-engine level, not
independently re-verified against a rendered, visually-animating element in
this package's own testing — if you rely on it, sanity-check your specific
properties against your engine version.

```css
/* app.component.css */
.card { transition: opacity 200ms ease-out; }
.card.dimmed { opacity: 0.4; }
```

```html
<view class="card" [class.dimmed]="isDimmed()">…</view>
```

### `animate()` via `invoke`

`ShadowElement.invoke({ method, params })` (see
[10 — Element queries](10-element-queries.md)) is a fully generic pass-through
to `NodesRef.invoke(...)` — so `invoke({ method: 'animate', params: { keyframes,
options } })` already reaches the native per-element `animate()` PAPI with no
new ng-lynx code needed. This is the same underlying native method
`lynx.getElementById(id).animate(keyframes, options)` calls (see
[29 — Platform APIs](29-platform-apis.md) for `LynxObject`'s typed
`LynxAnimationKeyframes`/`LynxAnimationOptions` — reuse those types for the
`invoke()` params too), just reached via a selector-query ref instead of an
id lookup.

### Worklet-driven styles for gesture-coupled motion

A [worklet](11-worklets.md) mutating `ctx.setStyle(...)` synchronously, at
gesture rate, with zero Background-Thread round-trip, is the right tool for
motion that must track a finger in real time (drag, pinch-follow) — nothing
new needed; that's the worklet model's whole reason to exist.

## Enter and leave: `lynxEnter` / `lynxLeave`

Angular's own enter and leave animations, `animate.enter` and `animate.leave`,
compile but do nothing on Lynx. `@angular/core` turns them on only where
`document.documentElement.getAnimations` exists, and times them with
`getComputedStyle` and `getAnimations()`. Angular runs on the Background Thread,
which has none of those. ng-lynx has the same pair as two directives, with CSS
classes, like vue-lynx's `<Transition>`:

```ts
import { LynxEnter, LynxLeave } from 'ng-lynx';

@Component({
  imports: [LYNX_ELEMENTS, LynxEnter, LynxLeave],
  template: `
    @for (item of items(); track item) {
      <text class="item" lynxEnter="item-in" lynxLeave="item-out" (tap)="remove(item)">{{ item }}</text>
    }
  `,
})
```

```css
.item-in { animation: item-in 300ms ease-out; }
.item-out { animation: item-out 250ms ease-in forwards; }
@keyframes item-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes item-out { from { opacity: 1; } to { opacity: 0; } }
```

- **`lynxEnter="classes"`** puts the classes on when Angular creates the element,
  on the first render too, and takes them off at the element's own
  `animationend` or `transitionend`.
- **`lynxLeave="classes"`** puts the classes on when Angular removes the
  element, and keeps it on screen until its own `animationend` or
  `transitionend`. Then it's removed, with everything in it. End the animation
  where the element should disappear (`forwards`), or the last frame snaps back
  before it goes.
- Each waits 2 seconds at most for that event: `lynxEnterTimeout` and
  `lynxLeaveTimeout`, in milliseconds. They're for classes with no animation in
  them. With an animation, the event ends it.
- An end event bubbled up from a child's animation doesn't count.

Where a leave applies: on an element Angular removes itself, one directly inside
an `@if`, `@for` or `@switch` block, as Vue's `<Transition>` wants a single child.
An element inside one of those goes with its parent, at once. Items of a `<list>`
aren't animated: the list removes its own.

While an element leaves, Angular has already let it go: a new one can come in
beside it (toggle an `@if` twice quickly), and its own listeners are gone, so
a tap on it does nothing.

`examples/hello-world`'s list uses them: "Add item" slides one in, and tapping
an item slides it out.

What was checked: on Explorer 4.2 on the iOS simulator and the Android emulator,
the engine runs the keyframe animations and sends `animationend` and
`transitionend` to the element, and a leaving panel was removed by its
`animationend`, long before its timeout (the `transition` flow, docs/41). In the
web preview an item's enter classes came off and a removed item went 317 ms and
270 ms after they began, the length of their animations. `npm run
verify:transition` covers the rest headlessly.

### `(animationend)` and `(transitionend)` listeners

Angular keeps a template's `animation*` and `transition*` listeners when it
destroys the view, so they still fire while an element leaves: a
`(animationend)` on a `lynxLeave` element sees the leave's end too. On the web
the browser drops them with the element. ng-lynx drops an element's listeners
when it destroys the element (earlier versions kept them registered for good).

## New: `lynxAnimate` — a tiny declarative tween

For a **timed** transition you want to trigger from a worklet (a fade-out
after a tap, a settle animation after a gesture ends) without hand-rolling a
timer loop, `ng-lynx/worklet` exports `lynxAnimate`: tweens a single
number over time, calling your `toStyle(value)` on every tick and applying the
result via `el.setStyle`.

```ts
// gestures.mt.ts (a Main-Thread module)
import { defineWorklet, lynxAnimate, type WorkletContext } from 'ng-lynx/worklet';

function fadeOutMT(ctx: WorkletContext): void {
  lynxAnimate(ctx, (v) => `opacity: ${v};`, { from: 1, to: 0, duration: 250 });
}
export const fadeOut = defineWorklet(fadeOutMT);
```

Call it with a worklet's own `ctx` (mutates the event's element) or a
main-thread ref's `.current` (mutates a *different* element — see
[11 — Worklets](11-worklets.md#main-thread-refs-reach-another-element)):

```ts
function fadeCardMT(): void {
  if (!cardRef.current) return;
  lynxAnimate(cardRef.current, (v) => `opacity: ${v};`, { from: 1, to: 0.15, duration: 400 });
}
```

`LynxAnimateOptions`: `from`/`to` (numbers), `duration` (ms), an optional
`easing` (`(t: number) => number`, `[0,1] → [0,1]`, default linear), and an
optional `onFinish`. Returns a `{ cancel() }` handle — `cancel()` freezes
whatever value was last applied and skips `onFinish`. The first tick (the
`from` value) applies **synchronously**, before the call returns.

Deliberately scoped to a single number: multi-property animation is just
multiple `lynxAnimate` calls, or format several component values into one
`toStyle` string yourself — "a tiny helper," not an animation framework.
Demoed in `examples/worklet` (the "Fade card" button); verified by
`npm run verify:animate`.

### Why `setTimeout`, not `requestAnimationFrame` — a real bug found live

The obvious design reused `requestAnimationFrame`/`cancelAnimationFrame` — and
both genuinely exist on the Main Thread on *both* targets: the worklet
runtime (`pluginAngularLynx` bundles it into every Main-Thread entry with
worklets — see [42 — The worklet runtime](42-worklet-runtime.md)) puts
`lynx.requestAnimationFrame` on `globalThis`, and `lynx` has it natively and on
`@lynx-js/web-core`'s Main-Thread global surface (confirmed present in its
compiled bundle) on web.

But clicking the live demo showed nothing happening at all — no error, the
card just never faded. Tracing it down (inspecting the web preview's actual
Main-Thread realm via its `contentWindow`) found the cause: **`@lynx-js/
web-core` runs the Main Thread inside a `display: none` iframe**
(`contentWindow.document.visibilityState === 'hidden'`), and browsers never
fire `requestAnimationFrame` callbacks for a hidden document — the call
registers without throwing, but the callback simply never runs. No headless
harness could have caught this (the mock PAPI has no concept of document
visibility), and reading source alone said rAF should work fine — this needed
clicking the actual live demo to surface.

`setTimeout`, tested the same way, fires normally regardless of the iframe's
hidden state — so `lynxAnimate` drives its loop with a fixed-interval
`setTimeout` chain instead, tracking elapsed time as a self-maintained counter
(one tick = one assumed frame interval) rather than reading a real clock. This
also makes it exactly reproducible in tests, with zero wall-clock dependency.

**Web-preview timing caveat** (also found live, not assumed): a hidden
document is exactly the case Chrome throttles nested `setTimeout` chains for
— so on the web preview, a `lynxAnimate` tween still **completes correctly**
(settles on exactly `to`, still calls `onFinish`) but its real wall-clock
duration can run many times longer than the `duration` you asked for (a
`duration: 400` tween took several seconds to visibly settle in the web
preview during this testing, while landing on the exact right final value
throughout). On-device, the Main Thread isn't a hidden document, so this
throttling doesn't apply — the web preview is the one target where this
helper's *timing* fidelity, not its *correctness*, is honestly degraded.

## `lynxTween` — when one value drives more than one thing

`lynxAnimate` writes a style string. `lynxTween` hands you the number, which is what
the swiper in [`examples/product-detail`](../examples/product-detail) needs: each frame of
its snap moves the row and may change the page index. Its `easing` can come from
`bindWorklet`, as a function from `defineMainThreadFunction`.

```ts
state.animation.current = lynxTween({
  from: state.offset.current,
  to: nearestPage,
  duration: 300,
  easing: state.easing,
  onUpdate: (offset) => moveTo(state, offset),
});
// on the next touchstart: state.animation.current?.cancel();
```

## `element.animate()` — native keyframes

For an animation the engine should run by itself, with no work on each frame:

```ts
const animation = ctx.element.animate(
  [{ opacity: 0.2 }, { opacity: 1 }],
  { duration: 600, easing: 'ease-out' }, // or a duration in ms
);
animation.pause();
animation.play();
animation.cancel();
```

Seen mid-fade on Explorer 4.2 on the Android emulator. On iOS it ran without an error, but
no frame was captured.

## `lynxRequestAnimationFrame` — a portable frame scheduler

For a hand-rolled frame loop (rather than the declarative `lynxAnimate`),
`lynxRequestAnimationFrame(cb)` / `lynxCancelAnimationFrame(handle)` give you a
scheduler that works everywhere ng-lynx runs:

```ts
import { lynxRequestAnimationFrame, lynxCancelAnimationFrame } from 'ng-lynx';

let handle = lynxRequestAnimationFrame(function tick(t) {
  // …update per frame…
  handle = lynxRequestAnimationFrame(tick);
});
// later: lynxCancelAnimationFrame(handle);
```

It uses the native `requestAnimationFrame` when present and otherwise
**degrades to a ~60fps `setTimeout` timer** — because, as the section above
explains, rAF isn't available (or doesn't fire) everywhere: the web-preview
Background Thread runs in a **Web Worker** with no `requestAnimationFrame` at
all, and the Main-Thread iframe is hidden (where a real rAF never fires). The
fallback means a frame callback still runs on the web preview rather than
silently never firing — with the same hidden-document timing caveat noted
above. Most apps won't need this: signals + zoneless change detection already
batch UI updates, and `lynxAnimate` covers worklet-driven animation. Verified
by `npm run verify:raf` (both the native-delegation and `setTimeout`-fallback
paths).

## Verifying

`npm run verify:animate` covers: the first tick applying synchronously,
interpolation settling exactly on `to`, `onFinish` firing and reaching the
Background Thread via `runOnBackground`, and `cancel()` freezing the value
and suppressing `onFinish` — using real (short) `setTimeout` delays rather
than a fake clock, since Node has real timers already. Live-verified in
`examples/worklet`'s web preview (the "Fade card" button dims the card and
settles at the target opacity — see the timing caveat above).

Back to [32 — Gestures](32-gestures.md).
