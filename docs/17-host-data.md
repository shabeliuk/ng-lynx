# Host data — `initData`, `updateData`, `globalProps`

A Lynx card lives inside a native app. The host passes data **at load time**
(init data), can **push updates** afterwards (`updateData`), and exposes
app-wide **global props** (theme, locale, host context) with its own update
channel. angular-lynx surfaces all three as **signals**, so zoneless change
detection picks host pushes up automatically — no manual wiring.

## Reading init data

```ts
import { Component, computed } from '@angular/core';
import { lynxInitData } from 'angular-lynx';

interface CardData {
  title: string;
  items: string[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  template: `<text>{{ data().title }}</text>`,
})
export class AppComponent {
  readonly data = lynxInitData<CardData>();
}
```

`lynxInitData()` is callable anywhere — component field initializers, services,
plain functions. No injection context is required (there is exactly one card
per Background context, so the state is module-level, like the rest of the
runtime).

When the host pushes new data, the signal updates and anything reading it
re-renders. Merge semantics mirror ReactLynx exactly:

- a push is **shallow-merged** over the current value (copy-on-write — an old
  object you captured is never mutated);
- a push with the native RESET flag (`options.type === 1`) **replaces** the
  data instead of merging;
- a `__lynx_timing_flag` key is stripped (ReactLynx's pipeline-timing
  convention — not supported here yet), with a dev-mode warning.

## Reading global props

```ts
import { computed } from '@angular/core';
import { lynxGlobalProps } from 'angular-lynx';

export class ThemedComponent {
  readonly globalProps = lynxGlobalProps<{ theme: 'light' | 'dark' }>();
  readonly isDark = computed(() => this.globalProps().theme === 'dark');
}
```

Host pushes via its update-global-props API merge into the signal the same way.

## Normalising host data: data processors

When several hosts pass differently shaped data, normalise it in one place instead of in every
component. A processor runs on the Main Thread, before the app sees the data, so register it from a
module in `mainThreadModules`, at its top level:

```ts
// src/worklets.ts, listed in `mainThreadModules` in lynx.config.ts
import { mainThreadLynx } from 'angular-lynx/worklet';

mainThreadLynx.registerDataProcessors({
  // Runs on init data, and on any updateData that doesn't name a processor.
  defaultDataProcessor(raw: { pageTitle?: string; page_title?: string }) {
    const { pageTitle, page_title, ...rest } = raw;
    return { ...rest, pageTitle: pageTitle ?? page_title };
  },
  // Run when the host passes this name as its `processorName`.
  dataProcessors: {
    checkout: (raw: { total: number }) => ({ ...raw, total: raw.total / 100 }),
  },
});
```

`lynxInitData()` then gives the processed data. This is
[Lynx's `lynx.registerDataProcessors`](https://lynxjs.org/guide/use-data-from-host-platform.html),
under a different name because of where the code runs: ReactLynx runs the app's entry on both threads,
and here it only runs on the Background Thread. Called there, `lynx.registerDataProcessors()` warns and
does nothing.

- A processor that returns nothing leaves the data as it was.
- A processor that throws reports the error, and the app gets `{}`, not the unprocessed data.
- An unknown `processorName` passes the data through.

The default processor has run on a real engine, on init data
([`host-data` flow](41-device-testing.md#automated-flows)). Named processors and `updateData` need a
native host, and have run from one: see [From a native host](#from-a-native-host).

## Event parity with ReactLynx

Each push also emits the same `GlobalEventEmitter` events ReactLynx emits, so
code (or templates) listening for them behaves identically across frameworks:

- `onDataChanged` — fired with the **changed subset** of an `updateData` push;
- `onGlobalPropsChanged` — fired with the **merged** global props.

Template binding works out of the box via the global-event syntax from
[12 — Events](12-events.md):

```html
<view (window:onDataChanged)="onChanged($event)">…</view>
```

## How it works (the engine contract)

The channels were confirmed against both reference implementations rather than
guessed:

- **`@lynx-js/react`** (`snapshot/lynx/tt.js`, `core/lynx-update-data.js`,
  `core/globalProps.js`): the engine invokes
  `lynxCoreInject.tt.updateCardData(newData, options?)` and
  `lynxCoreInject.tt.updateGlobalProps(newData)` on the Background Thread. The
  *framework* merges into `lynx.__initData` / `lynx.__globalProps` and emits
  the two parity events — the engine emits nothing itself.
- **`@lynx-js/web-core`** (`NativeApp.setCard`): registers the RPC endpoints
  for both methods **lazily via property setters** on `tt`, so a framework
  hooks them by plain assignment.

`entry-background.ts` installs both handlers at bundle start
(`installHostData()`, `runtime/src/host-data.ts`). Initial values are read
lazily on first signal access, so module-evaluation order relative to the
engine's setup doesn't matter. The Background-Thread `updatePage` global stays
inert — data pushes never arrive through it on either engine.

**Where init data comes from differs by engine.** A native engine sets
`lynx.__globalProps`, but hands init data only to `lynx.getApp()._params`, and a
framework moves it to `lynx.__initData`, as ReactLynx does. The web runtime sets
`lynx.__initData` itself, which is why this went unnoticed until it ran on a device:
`lynxInitData()` was empty on every native engine, in the web preview it worked, and
the harness mocked the web's shape.

The signals are the reason this needs no change-detection glue: angular-lynx is
zoneless, and a signal write from the native push handler schedules CD exactly
like one from your own code.

## Verifying

`npm run verify:hostdata` boots a component reading both signals, then drives
`tt.updateCardData` / `tt.updateGlobalProps` the way the engine would and
asserts: initial render from `lynx.__initData`, merge semantics, RESET
semantics, timing-flag stripping, `(window:onDataChanged)` parity, and that
`lynx.__initData` / `lynx.__globalProps` stay in sync (COW) for code that reads
the globals directly. `npm run verify:data-processors` covers the processors.

On a real engine, the [`host-data` flow](41-device-testing.md#automated-flows) reads the
init data Lynx Explorer always passes, through a processor. Explorer can't push updates, so
those run from a native host, below.

### From a native host

The genui example's iOS app ([`examples/genui/ios`](../examples/genui/ios), built with
Sparkling) has debug-only hooks that push to whatever page it shows. Launch it with
`ANGULAR_LYNX_HOST_DATA_HOOKS=1`, pointed at the device-tests page, then post a Darwin
notification for each push:

```bash
SIMCTL_CHILD_ANGULAR_LYNX_HOST_DATA_HOOKS=1 SIMCTL_CHILD_SPARKLING_DEV_SERVER_PORT=8793 \
  xcrun simctl launch booted dev.angularlynx.planner     # serves …:8793/main.lynx.bundle
xcrun simctl spawn booted notifyutil -p dev.angularlynx.hostdata.plain
```

| Notification suffix | Native call | What the page showed (iOS simulator, 2026-11-09) |
| --- | --- | --- |
| `plain` | `updateData(with: ["mockData": …])` | the new value, through the default processor |
| `named` | `updateData(with: ["note": …], processorName: "fromNative")` | `Named: Native note via fromNative`, merged with the rest |
| `globalprops` | `updateGlobalProps(with: ["hostNote": …])` | `Global: Set by the host` |
| `reset` | `resetData(with: LynxTemplateData(…))` | only the reset data, through the default processor; `named` gone, global props kept |

Not yet run this way: a real iPhone, and Android.
