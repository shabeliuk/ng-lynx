# Device testing

What has been run on a real engine, what hasn't, and how to run it. The headless
harnesses ([07 — Verifying](07-verifying.md)) mock the engine, so they can't show
touch feel, native layout, screen readers or performance.

## Setup

**iOS simulator.** Install Xcode. Download `LynxExplorer-arm64.app.tar.gz` from the
[Lynx release](https://github.com/lynx-family/lynx/releases) you want to test, extract
it, and drag the `.app` into the running simulator.

**Android emulator.** Install the `.apk` from the same release with `adb install`.

**Physical phone.** Android can use the release's `.apk`. iOS needs Explorer built from
source, or the community "Lynx Go Dev Explorer" on the App Store. Put the phone on the
same Wi-Fi as the Mac. **No real Android phone has run anything yet: Android results here
are from the emulator.**

**Each app:**

```bash
pnpm install
pnpm --filter ng-lynx build
cd examples/<app> && npm run dev
```

Scan the printed QR code, or paste the printed `main.lynx.bundle` URL into Explorer's
"Enter Card URL". The simulator shares the Mac's `localhost`; a phone needs the LAN IP.

The dev server writes what it serves into the example's `dist/`. Don't run a production build of the
same example while it's running: the phone then loads that build instead, and every
`lynxAssetUrl()` comes out relative ("unsupported URL" on iOS). Restart the dev server to recover.

**Without typing a URL.** Serve a production build's `dist/` with any static server, then:

```bash
xcrun simctl openurl booted "lynx://open?url=http://127.0.0.1:8000/main.lynx.bundle"
```

```bash
adb reverse tcp:8000 tcp:8000
```

```bash
adb shell am start -a android.intent.action.VIEW -d "'lynx://open?url=http://127.0.0.1:8000/main.lynx.bundle'"
```

Don't add `&fullscreen=true` on iOS: Explorer reads it as part of the file path, and reports
"bundle file is broken" for the 404 page it gets back. On Android it works.

**Logs:**

```bash
xcrun simctl spawn booted log show --last 2m --predicate 'process == "LynxExplorer"' | grep -i lynx
```

```bash
idevicesyslog | grep -i lynx
```

```bash
adb logcat | grep -i lynx
```

The Explorer's log line `lynx sdk version: x.y` is the engine that actually ran.

## Automated flows

[`packages/device-tests`](../packages/device-tests) drives a small test app on a real engine with
[Maestro](https://maestro.dev). [`device-tests.yml`](36-ci.md#device-testsyml--weekly-on-a-real-engine)
runs it every night. Nothing here replaces the per-example checks below: it catches a broken engine
contract, not a slider that feels wrong.

```bash
pnpm --filter ng-lynx build
```

```bash
pnpm --filter ng-lynx-device-tests test:android
```

```bash
pnpm --filter ng-lynx-device-tests test:ios
```

Android needs a booted emulator. iOS creates and boots its own simulator, "Angular Lynx Device Tests",
and leaves yours alone. Both need Java 17. `run.mjs` downloads Maestro and Lynx Explorer into
`~/.cache/ng-lynx-e2e` on first use (about 520 MB) and checks each against the SHA-256 in
[`tools.json`](../packages/device-tests/tools.json). Bump Explorer there together with the Lynx
toolchain. Add `--flow <name>` to run one flow. Results land in `packages/device-tests/artifacts/`:
screenshots, the JUnit report, the engine log and every request the device made.

A flow passing on screen isn't enough, so `run.mjs` also fails the run on:

- **An error in the engine log:** a JS exception, an `NG0` error, a numbered `LynxError`, or
  `FiberElement re-insert node`.
- **A missing or failed request:** the bundle, the lazy chunk and the image must each be served, and
  nothing may get a 404.
- **The wrong engine:** the log's `lynx sdk version` must match the pinned Explorer.
- **A page exit with no destroy hook,** on Android. The iOS log doesn't carry the app's console output,
  so on iOS the flow only shows that leaving the page raises no error. Whether iOS Explorer destroys the
  page when you go back is unconfirmed: the log shows no teardown 30 seconds later.

| Flow | What it covers | The bug it guards against |
|---|---|---|
| `counter` | First render, a tap, an update back across the threads | Any boot failure |
| `lazy-route` | A lazy chunk over the network, `Location.back()` | Chunks that never reach the device |
| `route-param` | Router navigation with a param | Angular 22's router skipping every navigation |
| `list` | Scrolling a native list far enough to recycle cells, both ways | Cells appended again on each request |
| `input` | Typing on the native keyboard, Return firing `(confirm)`, and, on Android, typing into the middle of an `[(ngModel)]` field | `(confirm)` needing `confirm-type` on Android; the cursor jumping to the end. iOS has no key to move the cursor with |
| `main-thread` | A worklet on a tap, `runOnBackground`, `runOnMainThread`; a worklet whose `stopPropagation()` keeps its tap from the box around it, reporting a live `currentTarget` with its `dataset` and `uid`; a `<lynx-slider>` dragged both ways on the Main Thread | Worklets not reaching the engine; the worklet runtime's event result or event targets breaking (docs/42); the slider's Main-Thread measurement |
| `gesture` | A native pan, dragged twice | The detector stopping after the first drag on Android |
| `gesture-lab` | Tap and long-press detectors, a tap that waits for a long press, `ctx.gesture.fail()` and `end()` in a pan, and a fling after a fast swipe | `fail()`/`end()` throwing `not a function` |
| `assets` | An image through `lynxAssetUrl()`, with no lazy chunk in the build, and two images imported as modules: one emitted as a file, one inlined as a `data:` URL | Asset URLs staying relative |
| `network` | A lazy route whose chunk's connection is cut, then retried on a slow network | A failed chunk failing every later navigation too, without a request |
| `page-exit` | Leaving the page | `(null) is not a function`, LynxError 20100 |
| `host-data` | Init data from the host, through a data processor | `lynxInitData()` empty on every native engine |
| `attributes` | `(longpress)`, `initial-scroll-index`, `default-value`, `<markdown>` drawing and `<filter-image>` loading (iOS only: Explorer 4.2.0's Android APK crashes on the first and lacks the second, see [18](18-typed-templates.md)), and the engine accepting the other typed attributes and events | Attributes the engine rejects |
| `platform` | `lynxSelectRoot()`, `lynxSelectUniqueID()`, `lynxEventSource()` with the line held open and a `✓` split between two network chunks, and `reload()` with new init data | Lynx's `EventSource` delivering nothing on iOS; `removeComponents is not a function` on reload; a split character decoding as `���` |
| `timing` | Each measurement on the timing screen completes: boot, 50 updates, 1,000 rows, a fling | The timing screen breaking. Its numbers are for a phone: see below |
| `memory` | 1,000 mounts and unmounts of a screen of rows, a slider and a checkbox | The churn crashing or stalling. Memory is read from outside: see below |

**The timing screen** ("Open timing") shows numbers to take from a real phone:

- **Boot:** from the app's script starting, before Angular evaluates, to Angular ready, and to the first
  batch applied on the Main Thread. The engine's own start is before that, and invisible to JavaScript.
- **Updates:** 50 changes of one text binding, each timed from the change until the Main Thread has
  applied it (`whenFlushed()`). The median, p95 and max.
- **Rows:** 1,000 rows, a view and a text each, rendered and applied, then removed.
- **Fling:** scroll the list at the bottom. Frames per second on the Main Thread
  (`requestAnimationFrame`) from the touch to the last scroll event, and the longest frame.

"Applied" means the Main Thread ran the batch and called `__FlushElementTree`; the paint after it can't
be seen from JavaScript. On the iOS simulator and the Android emulator (2026-11-18) they were:

| | iOS simulator | Android emulator |
|---|---|---|
| Boot, to first batch applied | 52 ms | 174 ms |
| Update, median / p95 | 3 / 7 ms | 17 / 39 ms |
| 1,000 rows rendered / removed | 789 / 474 ms | 270 / 89 ms |
| Fling | 60 fps, longest frame 19 ms | 42 fps, longest frame 42 ms |

Simulators and emulators share the Mac's CPU and say little about a phone. Run it on one, release
build of Explorer if you can, and put those numbers here.

**Memory** ("Open memory"): each tap of "Churn 1000" mounts and destroys a screen of 20 rows, each
with an `@if`, `(tap)` handlers, a `<lynx-slider>` and a `<lynx-checkbox>`, 1,000 times, waiting for
each batch to reach the Main Thread. Read the app's memory between taps: on Android
`adb shell dumpsys meminfo com.lynx.explorer` (TOTAL PSS), on the iOS simulator `footprint -p <pid>`
on the Mac. A leak climbs with every round; a heap that's collected rises and falls. Headless,
`verify:memory` checks that 1,000 mounts leave every registry on both threads at its baseline.

| After | Android emulator, PSS | iOS simulator, footprint |
|---|---|---|
| 1,000 mounts | 87.6 MB | 68 MB |
| 2,000 | 92.5 MB | 77 MB |
| 3,000 | 97.3 MB | 76 MB |
| 4,000 | 94.3 MB | 79 MB |
| 5,000 | 92.7 MB | 93 MB |
| 6,000 | 92.4 MB | 96 MB |
| 7,000 | | 104 MB |

Measured 2026-11-20, engine 4.2. Android levels off. The iOS simulator climbs about 4 MB per 1,000
mounts of this 95-element screen, and rose by itself once while idle (79 to 91 MB). Nearly all of it is
`Malloc Small` in `footprint`, native memory, while `verify:memory` shows every registry ng-lynx keeps,
on both threads, back at its baseline. Whether it's the engine's element memory, JavaScriptCore's heap
or the Main Thread's is open: it needs Instruments' allocations on the simulator, or the same churn in
a ReactLynx app to compare. On a phone, run the same and put the numbers here.

**Opening a bundle by hand on the iOS simulator:** leave `&fullscreen=true` off the deep link. Explorer
4.2 on iOS takes it as part of the bundle's URL and fails with error 102, "the template file size is 0".
Android takes it as a flag.

**To try the screens by hand**, on a phone or a simulator: `npm run dev` in `packages/device-tests`,
then scan the printed code with Lynx Explorer. The dev server also serves the `/sse` stream the
platform screen connects to.

**Leave the emulator alone during a run.** A click in its window lands in the app and can fail a flow
with a confusing screenshot. In the engine log, Maestro's touches are on whole numbers, and a person's
are fractional.

**Maestro only sees unflattened elements on Android.** Lynx draws a flattened element into its parent
with no View of its own, so every element a flow taps or reads sets `[flatten]="false"`. iOS doesn't need
it. A new screen that a flow can't find on Android is usually missing this.

**What this doesn't cover:** live editing, which needs a dev server; anything visual, such as the
invisible slider thumb; touch feel, screen readers and performance; the 25 examples, which still run by
hand.

> **"Engine 3.7" below.** Early passes were recorded as "Explorer 4.0.0", but that
> Explorer logged `lynx sdk version: 3.7`: it was installed before 4.0.0's release.

## What has been run

✅ passed, ◐ partly, blank not run. Bundles declare engine 3.2, so one build loads on
every engine here.

| Example | iOS sim 3.7 | iOS sim 4.1 | iOS sim 4.2 | Android emu 4.1 | Android emu 4.2 | Real iPhone | Real Android |
|---|---|---|---|---|---|---|---|
| `hello-world` | ✅ | | ✅ | ✅ | ✅ | ✅ | |
| `product-detail` | | | ✅ | | ✅ | ✅ | |
| `gallery` | | | ✅ | | ✅ | | |
| `list` | ✅ |  | ✅ | ✅ | ✅ | ✅ |  |
| `virtual-list` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `lynx-forms` | ✅ |  | ✅ | ◐ | ✅ | ✅ |  |
| `ng-forms` | ✅ | | ◐ | | ◐ | ✅ | |
| `control-theme` | ✅ |  | ✅ | ✅ | ✅ | ✅ |  |
| `router` | ✅ | ◐ | ✅ | ✅ | ✅ | ✅ | |
| `worklet` | ✅ | | ✅ | ✅ | ✅ | ✅ | |
| `projection` | ✅ |  | ✅ |  | ✅ | ✅ |  |
| `styling` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `tailwind` | ✅ |  | ✅ |  | ✅ | ✅ |  |
| `responsive` | | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `primitives` | ◐ | ✅ | ◐ | ✅ | ◐ | ◐ | |
| `media` |  | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| `ui-gallery` | ✅ |  | ✅ | ✅ | ✅ | ✅ |  |
| `accessibility` | ◐ |  | ◐ |  | ◐ | ✅ VoiceOver |  |
| `i18n` | ✅ |  | ✅ |  | ✅ | ✅ |  |
| `dynamic-component` | ✅ |  | ✅ |  | ✅ | ✅ |  |
| `hot-swap` | ◐ |  | ✅ |  | ✅ | ✅ |  |
| `wasm-life` | ✅ |  | ✅ | ✅ | ✅ | ✅ |  |
| `threejs-water` | ✅ |  | ✅ |  | ✅ | ✅ |  |
| `threejs-rpg-skeleton` | ✅ |  | ✅ |  | ✅ | ✅ |  |
| `genui` | ◐ | | ✅ | ✅ | ✅ | ✅ | |

`genui` also runs as a native iOS app through Sparkling (Lynx 3.9, iOS simulator): see
[its README](../examples/genui/README.md).

**Every example has run on Angular 22** on Explorer 4.2, on both the iOS simulator
(JavaScriptCore) and the Android emulator (PrimJS), as a production build with `output.assetPrefix`.
Each one was driven, not just opened. What each row left out:

- `accessibility` is ◐ on simulators and emulators because no screen reader ran there, only the visuals
  and controls. VoiceOver has run it on a real iPhone. TalkBack hasn't run at all.
- `primitives` is ◐ because `<frame>` needs a host app. On a real iPhone, `<video>`, `<refresh>` and
  `<viewpager>` work, including pull-to-refresh and a `<viewpager>` swipe by finger (2026-11-10).
  `autoStartRefresh()` and every other element ran.
- `ng-forms` is ◐ because only typing and a dialog were tried. Since then, on the iOS simulator:
  "Fill example", "Reset", and typing with the cursor moved mid-field, in a `[formControl]` and an
  `[(ngModel)]` field. The cursor stays where it was put (2026-11-10).
- `genui` ran the offline planner and both protocol tabs, not a real LLM.
- `dynamic-component` on a bad network, both platforms (2026-11-19): with the remote bundle's
  connection cut, loading fails at once with code 160101 and the engine's reason (iOS "The network
  connection was lost", Android "unexpected end of stream"). Retried on a slow network (4 s), it loads
  and the card works. The engine doesn't keep the failure, unlike the lazy-chunk runtime's (see
  `network` above). iOS tried the cut request three times before failing; Android once.
- `threejs-*` ran, but only a phone's frame rate means anything.

### Installing from npm

On 2026-11-19, the published `0.1.0-rc.0`, as a user gets it, outside the repository:

- `npm create ng-lynx@rc` with each template (`minimal`, `router`, `forms`): install, build, and
  run on the iOS simulator and the Android emulator. **Found and fixed:** the page background
  stopped below the content in all three; the `router` nav stacked vertically, since
  `flex-direction` does nothing without `display: flex`; the `forms` select, checkbox and toggle
  were invisible, since the template didn't import the theme, and the theme itself left the
  select's options unstyled and opened its sheet inside the form.
- `ng add ng-lynx@rc` in `ng new` workspaces on Angular 21.2 and 22.3: the Lynx build, the
  workspace's own `ng build`, and the app on both platforms. **Found and fixed:** Node warned on
  every run that `lynx.config.ts` "doesn't parse as CommonJS"; `ng add` now writes
  `lynx.config.mts`.

Not run: `npm run dev` with an edit swapped in, in a created app.

## What to check, per example

Each example lists what only a real engine can show.

**`hello-world`.** The first frame appears at once, with no flash when the live app takes
over (first-screen snapshot). The dev log says the snapshot matched. Counter taps never
miss or double-count. "Add item" appends one row.

**`list`.** Flings feel native. `scrolltolower`/`scrolltoupper` fire at the ends.
"Scroll to top" animates. Rubber-banding at the edges.

**`virtual-list`.** Fling hard and repeatedly: the reachable row keeps advancing, with no
blank gaps. The materialized numbers move steadily and don't flip between two values, even on a
slow scroll. A very fast fling can stop at the window's edge, but the next one must carry on
without scrolling back. Reach row 4999 and back. See the [wall described in docs/30](30-virtual-list.md).

**`lynx-forms`.** The form sits at the bottom of the screen, where the keyboard opens over it. The keyboard
opens and text appears with no lag. The form moves up with the keyboard, so it doesn't cover the
focused field, and moves back when it closes. Return on the soft keyboard fires `(confirm)` and submits.

**`ng-forms`.** Slider: first tap lands, a drag tracks the finger and clamps at both ends,
and a drag mid-scroll claims the gesture. Every dialog opens, picks, and scrolls to the
selected row on reopen. `initial-scroll-to-index` lands the same way in both time columns.
A pre-filled or reset field shows its value.

**`control-theme`.** All six controls share the accent colour, stay themed after a tap, and
the slider fill follows it during a drag.

**`router`.** `uiappear` fires, `@defer (on interaction)` and `(on viewport)` load, route
params resolve, `Location.back()` returns. The lazy route loads from the dev server. For a
production build, set `output.assetPrefix` and serve `static/js/async/`.

**`worklet`.** Tap to dim, `runOnBackground` count, ref reset, and the `lynxAnimate` fade. Drag the
chip: it follows the finger, and the last phase reads `onEnd`, on every drag. Tap "Check
MainThread.Element": the line below it should read `attribute worklet, names true, items 4,
scrollTo ok, text width true, border 2px` (a fraction on Android), the box fades in with a border,
and its list scrolls. Run a production build too: worklet ids come from function names.

**`product-detail`.** The official tutorial. Swipe each carousel: the page follows the finger and
snaps with its own timing (`easeInOut` above, slower and linear below), and each row of dots
follows its own carousel. Tap a dot: the carousel jumps there. A short or slow swipe snaps back.

**`gallery`.** The official Gallery tutorial. The waterfall starts scrolling by itself
(`autoScroll` through `invoke`), in two columns of different heights. Two scrollbars follow it: the
left one from `(scroll)` on the Background Thread, the right one from a worklet on the Main Thread.
Drag the list fast: the right one keeps up and the left one trails. Tap a heart: it turns red with
two ripples.

**`projection`.** Both slots project, and a `(tap)` from the consumer's template works
inside the card.

**`styling`.** The parent-state switch restyles its children at first render and on every
tap. Sass output renders.

**`tailwind`.** One card per family of utilities: colours, typography, shape (rounding, borders,
opacity, shadows), flex layout and transforms. Then classes that change at runtime: the counter, the
On/Off row, and the progress bar's width steps.

**`responsive`.** Portrait and landscape re-evaluate in place. Width and resolution chips.
Dark mode follows the host's `theme` global prop. Open question: what a 3.9 engine does
with the stylesheet.

**`primitives`.** `<svg>`, `<frame>` (needs a host that hands it a bundle), `<overlay>` (close
button, backdrop, Android back key, no error 2298), `<refresh>`, `<viewpager>` swipe and
buttons, `<scroll-coordinator>` collapse and expand inside the page's scroller, `<blur-view>`,
`<webview>`, `<video>`, which starts muted, with a button to turn the sound on. Pull-to-refresh and a
real swipe need a finger: both work on a real iPhone (2026-11-10). `<title-bar-view>` is desktop-only: mounting it on mobile raises LynxError 990100,
`ui not found`, and carries on.

**`media`.** The video shows its first frame and plays on `play()`. `playing`, `paused`,
`ended`, `timeupdate` fire and drive the progress bar. The mp3 plays through the hidden
`<video>`. Reload with Autoplay on starts the new source; with it off, the video waits on its
first frame. On a real iPhone, Autoplay had done nothing at first: Reload didn't change the
source, and the toggle only set an attribute Lynx doesn't have. Fixed and confirmed there.

**`ui-gallery`.** Draggable, Swiper, Sheet, SwipeAction and Sortable with a finger: the page
doesn't scroll underneath. FeedList's pull and load-more. Since 2026-11-20 the five drags run on
the Main Thread ([docs/37](37-ui-gallery.md)): each was dragged on the iOS simulator and the
Android emulator, but the real-iPhone ✅ above is for the earlier, Background-Thread version.

**`accessibility`.** VoiceOver and TalkBack: heading, avatar label, divider skipped, progress
bar and value, Follow button and changing label, message row's custom actions, stepper
buttons. `accessibilityAnnounce()` is audible. Focus order follows the screen. The slider's
swipe-to-adjust is a known engine gap: see [docs/34](34-accessibility.md).

**`i18n`.** `npm run dev` is English, and `npm run dev:ua` (`lynx.config.uk.ts`) is Ukrainian: each
shows its own strings, the interpolated greeting keeps the name, and the button's reply is
translated too. The locale is fixed when the bundle is built, so the phone's language changes
nothing.

**`dynamic-component`.** `npm run dev`, which builds the remote bundle first. Load the remote card,
tap its button, load it again. On a phone, a slow connection and a dropped one (Network Link
Conditioner): it should fail with the engine's reason, not hang, and load on the retry.

**`hot-swap`.** On the dev server, with the app open and visible, edit `CounterCard`'s template and
save: the text changes in place and the counter survives. Save again: it chains. A logic edit isn't
applied. With Explorer's Lynx DevTool switch on, the page reloads by itself, with or without the
desktop app (Explorer shows "Start to download & reload…"; iOS simulator, 2026-11-09 and 2026-11-10).
With the switch off, the console says to reopen the page.

**`wasm-life`.** The grid animates and the generation climbs. The subtitle says which kernel ran: the
WASM module, or on a real iPhone the same rules in JavaScript.

**`threejs-water`, `threejs-rpg-skeleton`.** Only a phone's frame rate means anything: sustained
frame rate, no thermal stall after a minute, rain toggled repeatedly with no leak. The glTF model
loads over the network.

**`genui`.** The offline planner end to end, with a slider, number fields and the results chart.
With a key: streaming builds the screen progressively. Typing on the native keyboard. The A2UI
and OpenUI tabs.

## Known engine limits

- **`prefers-color-scheme`** stays `light` on Explorer 4.1 and 4.2: the host has to report it. Use
  the host's `theme` global prop meanwhile.
- **`display: none` on text still paints it** on engines 4.1 and 4.2. Remove it with `@if`, or collapse a
  wrapping `<view>`.
- **SVG fills from a `<style>` class render black**, on iOS and Android. Use `fill="…"` attributes.
- **`<frame>` never fetches its own `src`** on a native engine: the host hands it a `TemplateBundle`.
- **iOS fires `dismissoverlay`** when an `<overlay>` is created hidden, before it was ever shown.
- **`accessibility-traits="adjustable"`** announces, but swiping up/down doesn't adjust: no hook
  reaches `accessibilityIncrement`.
- **A production build's lazy routes and assets need `output.assetPrefix`**: the device has no base
  URL to resolve them against.
- **Lynx's Background-Thread `URL` is partial** on Explorer 4.2, on both platforms' builds tested:
  `origin` and `pathname` are `undefined`. `es-polyfills.ts` replaces it, because Angular 22's router
  depends on them ([15 — Routing](15-routing.md)).
- **Writing a style to a flattened view stops its native gesture** on Android, on Explorer 4.2.
  `[lynxGesture]` turns `flatten` off for this ([32 — Gestures](32-gestures.md)).
- **A real iPhone has no `WebAssembly`.** Explorer runs JavaScriptCore there, and iOS lets it compile
  code only in Apple's browser, so the global is missing: `wasm-life` threw `ReferenceError` on open.
  The iOS simulator runs on the Mac, which has it, and Android's PrimJS has it. Ship a JavaScript
  fallback, as `wasm-life` now does.
- **`@media` isn't reliably re-evaluated when an iOS device rotates**, on Explorer 4.2: the page resizes,
  and the queries kept their old result on a real iPhone and in one simulator run, and updated in a
  later one. To follow rotation, measure: `examples/responsive` sets its columns from the page's
  `(layoutchange)`, which follows it on both runs. On Android, Explorer recreates the page on
  rotation, so the queries are right and the app's state resets ([13 — Styling](13-styling.md)).
- **`blur-radius` does nothing with `blur-effect="glass"`** on iOS 26: the engine makes a `UIGlassEffect`,
  which has a style (`glass-style`, regular or clear) but no radius. The radius applies to `light`,
  `dark` and `extra-light`. Android has no glass and ignores `blur-effect`.
- **`<video>` on iOS needs a server with HTTP range requests.** Without them it fires `error` and never
  plays. The dev server has them; a minimal static server may not.
- **iOS fails a `selectTab` that's still animating** when a newer one or a touch interrupts it, with
  `break by next selectTab` or `selectTab break by touch`. Without a `fail` callback on the `invoke`, a
  dev build reports that as LynxError 20100. Production builds stay silent.
- **`<input>` doesn't avoid the keyboard on its own,** as Lynx's docs say. Move the content yourself by
  the height in `keyboardstatuschanged`, through `LynxGlobalEvents`: see `examples/lynx-forms`. Explorer 4.2,
  iOS simulator and Android emulator, and a real iPhone.
- **`(confirm)` needs `confirm-type` on Android.** Without it, Return does nothing
  ([12 — Events](12-events.md)).
- **`<video>` has no `autoplay`, and iOS ignores a `src` equal to the current one.** Call `play` from
  `(firstframe)`, and change the URL to load the same file again ([18 — Typed templates](18-typed-templates.md#video)).
- **`<video>` fires both `pause` and `paused` on iOS**, and only one on Android, so binding both, as
  `examples/media` does, counts a pause twice on iOS.
- **Explorer keeps images on disk between launches,** on both platforms, so a repeated URL loads without
  a request. Change the URL to prove a fresh load.
- **Log lines that don't mean a failure:** `[List] Fail to erase item holder` when `LynxVirtualFor`
  moves its window while scrolling back, and `DestroyLayoutNodeBeforeRemoveFromParent` when a view is
  destroyed. Both engines log them, and nothing on screen changes.
