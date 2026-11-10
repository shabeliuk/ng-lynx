# Gestures

Lynx has a native gesture-recognizer system beyond plain tap/touch events —
pan, fling, longpress, rotation, pinch — plus **relations** between them
(`waitFor`, `simultaneousWith`, `continueWith`) so you can compose things like
"this pan only activates once that tap has failed to recognize." It runs
entirely on the Main Thread, via a dedicated PAPI call:
`__SetGestureDetector(dom, id, type, config, relationMap)`.

`angular-lynx` exposes it as `[lynxGesture]`, reusing the existing worklet
machinery — a gesture's callbacks are ordinary worklets, exactly like
`[lynxMainThread]`'s.

It needs `pluginAngularLynx({ enableNewGesture: true })`: Lynx's new gesture handlers
only initialise with that flag.

**Run on Lynx Explorer 4.2, on the iOS simulator and the Android emulator**, on Angular 21
and 22: a pan fires `onStart`, `onUpdate` for each move, and `onEnd`, and repeats on the next
drag ([`examples/worklet`](../examples/worklet)). Tap, long press, a `waitFor` relation and
`ctx.gesture.fail()`/`end()` have run on the iOS simulator (Explorer 4.2, 2026-11-10), in the
`gesture-lab` device flow. Fling, rotation and pinch, and Android for all of these, haven't.
The web preview has no-op detectors (web-core 0.26), so a gesture never fires there, and
nothing crashes.

What each type fired on the iOS simulator:

| Type | Phases, in order |
| --- | --- |
| `tap` | `onBegin`, `onStart`, `onEnd`, on a quick tap |
| `longpress` | `onBegin`, `onStart`, `onEnd`, on a hold |
| `tap` with `waitFor: ['hold']`, beside a `longpress` | a quick tap fires the tap; a hold fires only the long press |

The phases the engine calls (from its `BaseGestureHandler`, and observed on a device):

| Phase | When |
| --- | --- |
| `onBegin` | The finger went down on the element. |
| `onStart` | The gesture activated: a pan once the finger has moved its minimum distance. |
| `onUpdate` | Each move while active. |
| `onEnd` | The finger lifted, or the gesture failed or ended. |
| `onTouchesDown`, `onTouchesMove`, `onTouchesUp`, `onTouchesCancel` | Raw touches, whatever the gesture's state. |

## Usage

```ts
// gestures.mt.ts (a Main-Thread module)
import { defineMainThreadRef, defineWorklet, type MainThreadGestureEvent, type WorkletContext } from 'angular-lynx/worklet';

const grabX = defineMainThreadRef('grabX', 0);

function onPanStartMT(ctx: WorkletContext<MainThreadGestureEvent>): void {
  grabX.current = ctx.event.params.clientX;
  ctx.element.setStyleProperty('opacity', '0.8');
}
export const onPanStart = defineWorklet(onPanStartMT);

function onPanUpdateMT(ctx: WorkletContext<MainThreadGestureEvent>): void {
  const x = ctx.event.params.clientX - grabX.current;
  ctx.element.setStyleProperty('transform', `translateX(${x}px)`);
}
export const onPanUpdate = defineWorklet(onPanUpdateMT);

function onPanEndMT(ctx: WorkletContext<MainThreadGestureEvent>): void {
  ctx.element.setStyleProperty('opacity', '1');
}
export const onPanEnd = defineWorklet(onPanEndMT);
```

```ts
// component
import { LynxGesture, type LynxGestures } from 'angular-lynx';
import { onPanEnd, onPanStart, onPanUpdate } from './gestures.mt';

@Component({
  imports: [LynxGesture],
  template: `
    <view [lynxGesture]="gestures">…</view>
  `,
})
export class AppComponent {
  protected readonly gestures: LynxGestures = {
    pan: { type: 'pan', callbacks: { onStart: onPanStart, onUpdate: onPanUpdate, onEnd: onPanEnd } },
  };
}
```

`[lynxGesture]`'s value is a `Record<string, LynxGestureDescriptor>` — a local
key per gesture (used only to resolve relations within the same binding, never
sent as-is), each with:

| Field | Meaning |
| --- | --- |
| `type` | `'pan' \| 'fling' \| 'default' \| 'tap' \| 'longpress' \| 'rotation' \| 'pinch' \| 'native'` |
| `callbacks` | `Record<phaseName, WorkletHandle \| string>` — a worklet per gesture phase. `bindWorklet` gives one its own [`ctx.params`](11-worklets.md#state-for-each-instance-bindworklet-and-mainthreadref) |
| `config?` | Native gesture-specific tuning (e.g. pan direction/min-distance), passed through as-is |
| `waitFor?` / `simultaneousWith?` / `continueWith?` | Local keys of *other* gestures in the same map, resolved to their real native ids |

`ctx.runOnBackground(...)` from any gesture's any callback surfaces at a
single shared `(mainThreadCallback)` output on the directive — the same
one-emitter-per-binding model `[lynxMainThread]` uses.

## In a phase

`ctx.event.params` has where the finger is, in logical pixels: `clientX`/`clientY`,
`pageX`/`pageY`, `x`/`y` relative to the element, and the element's `scrollX`, `scrollY`,
`isAtStart` and `isAtEnd`. On Android they're rounded to whole numbers.

`ctx.gesture` is this detector's standing in the engine's gesture arena. A pan activates by
itself, so you only need this to change the outcome:

| Member | |
| --- | --- |
| `active()` | Activate this gesture. |
| `fail()` | Give up, so the next gesture in the arena gets the touch. |
| `end()` | End this gesture for the rest of the touch. |
| `scrollBy(dx, dy)` | Scroll the element, returning what was consumed. |

`active()`, `fail()` and `end()` go through the engine's `__SetGestureState(element, id,
state)`, as `@lynx-js/gesture-runtime` does. Explorer 4.2's state manager has no `fail` or
`end` method of its own: calling those threw `TypeError: not a function`, until 2026-11-10.
Measured on the iOS simulator, with a pan:

- `end()` in the first `onUpdate`: that one update, then `onEnd`, and nothing more for the
  rest of the touch.
- `fail()` in `onStart`: `onEnd` follows at once and no `onUpdate` gets through, but the pan
  starts again on the next move, so a drag logs `start, end` over and over. To stop a
  gesture for the whole touch, use `end()`.

## A gesture's element isn't flattened

`[lynxGesture]` sets `flatten="false"` on its element. On Android (Explorer 4.2), writing a
style to a flattened view during a gesture stopped its detector for good: `onStart` and one
`onUpdate` fired, then nothing, even on the next drag. Gestures usually move their element,
so the directive doesn't leave it to you.

## Composing two related gestures

```html
<view
  [lynxGesture]="{
    pan: { type: 'pan', callbacks: { onStart: onPanStart }, waitFor: ['tap'] },
    tap: { type: 'tap', callbacks: { onStart: onTapStart }, simultaneousWith: ['pan'] }
  }">
</view>
```

Each key gets its own native gesture id (assigned in registration order); a
`waitFor`/`simultaneousWith`/`continueWith` list of local keys is resolved to
the *other* gesture's real id before the `SET_GESTURE_DETECTOR` op ships —
verified by `npm run verify:gesture` (asserts the relation maps land with the
correct cross-referenced ids, not just the raw local keys).

## Why no `'composed'` gesture type

The real engine also supports a `COMPOSED` gesture kind — a nested AND-group
of sub-gestures under one id, used by ReactLynx's `Gesture` builder for e.g.
`Gesture.Race(...)`/`Gesture.Simultaneous(...)` combinators. Reading
`processGesture.js` showed this is the *less* common path — its own "fast
path" is a single base gesture, and its general path is multiple **independent**
`__SetGestureDetector` calls related via `waitFor`/`simultaneousWith`/
`continueWith` (exactly what `[lynxGesture]`'s multi-key map already produces).
So `[lynxGesture]` deliberately doesn't expose `COMPOSED` — every gesture you
declare gets its own detector, related as needed. A true composed-tree builder
API is a follow-up if a real use case needs the AND-group semantics
specifically, not assumed necessary here.

## Binds once

`[lynxGesture]` registers its gestures at `ngOnInit` only, so a new value for it later has no
effect. The element's own destruction takes the detector with it, and the directive releases
its `(mainThreadCallback)` handler then. `[lynxMainThread]`, by contrast, rebinds when its
value changes.

## A drag inside a scroll-view: `pan-intercept-*`

A drag handled with touch events inside a `<scroll-view>` also scrolls the
page. `(catchtouchmove)` doesn't help: it stops the *event* from bubbling to
JS listeners, while the scroll-view's own native pan recognizer claims the
touch regardless. The fix is declarative, on the element the drag starts on:

```html
<view
  class="drag-surface"
  [pan-intercept-direction]="1"
  [pan-intercept-scope]="1"
  [flatten]="false"
  (catchtouchmove)="onMove($event)"
>
```

`pan-intercept-direction` picks the swipe direction to keep from native
gestures (`0` horizontal, `1` vertical, `2` none), and `pan-intercept-scope`
picks where (`1` = ancestors; `0` self, `2` descendants, `3`–`5` combinations,
`6` none). Both are typed on every element in `angular-lynx/elements`.

**Measured** on Lynx Explorer (engine 3.7, iOS simulator), on
`examples/ui-gallery`'s Draggable demo:

- Without the attributes, a vertical drag in the field scrolled the page.
- With them, the box followed the finger and the page stayed put.
- A drag that started outside the field still scrolled the page.

Available on iOS since 3.4 and Android since 3.6. On Android, Lynx's docs say
it applies only to `view`, `scroll-view` and `list`, and may need `flatten`
off. Android is unmeasured here.

**On its own it isn't enough.** On a real iPhone (Explorer 4.2), picking the box up
sometimes still scrolled the page. The iOS simulator never did, so the cause is
unconfirmed. In the engine's source, iOS settles the direction once, after 10px,
and only blocks ancestors that scroll in that direction, so a drag that starts
sideways isn't blocked from scrolling a vertical page.

So also switch the ancestor's `[enable-scroll]` off from `touchstart` until
`touchend` or `touchcancel`, as every ui-gallery drag demo does
(`drag-lock.service.ts`). Handle `touchcancel` too, or an interrupted touch leaves
the page unable to scroll. Engine 4.1 adds
`ios-pan-intercept-gesture-class`, `-view-class` and `-view-tag` for
intercepting another platform gesture recognizer by class. They're typed
too, but unmeasured.

## Verifying

`npm run verify:gesture` covers: two related gesture detectors reaching the
Main Thread as real `__SetGestureDetector` calls with the right numeric type
codes; relation maps resolving local keys to the correct cross-referenced
ids; each gesture's callbacks running as real worklets (mutating the element,
reaching the Background Thread via `runOnBackground`) — independently, so two
detectors on one element don't clobber each other; and the safe, warning-only
degradation path when `__SetGestureDetector` is unavailable (simulated by
temporarily deleting the mock global and re-mounting the bound element).

Continue to [33 — Animations](33-animations.md).
