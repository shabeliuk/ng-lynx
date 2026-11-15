# Verifying the example

Four complementary checks, in increasing fidelity — all available today:

1. **Type safety** — `npm run typecheck`
2. **Headless runtime** — `npm run verify*` (`npm run verify:all` runs them all)
3. **ES2019 parse gate** — catch PrimJS-incompatible syntax in the built bundles
4. **On device / web** — run it in Lynx Explorer / the browser

## Level 1 — Type safety (works today)

The whole renderer package — including the Angular-dependent `renderer.ts` and
`bootstrap.ts` — type-checks against real Angular.

```bash
cd packages/ng-lynx
npm run typecheck    # tsc -p tsconfig.json ; expect exit 0
```

This proves the renderer correctly implements Angular's `Renderer2` /
`RendererFactory2` contracts and that the bootstrap uses real, current Angular
APIs (`ɵinternalCreateApplication`, `provideZonelessChangeDetection`).

## Level 2 — Headless end-to-end run (works now)

```bash
cd packages/ng-lynx
npm run verify        # the hello-world runtime check
npm run verify:list   # native <list> virtualization (see docs/08-lists.md)
npm run verify:form   # two-way [(lynxModel)] input binding (see docs/09-forms.md)
npm run verify:ngforms   # @angular/forms ngModel + reactive forms (docs/09)
npm run verify:controls  # LynxSelect/-DatePicker/-TimePicker/-Autocomplete (docs/09)
npm run verify:events    # global events + (confirm) submit-on-enter (docs/12)
npm run verify:query  # imperative element access / selector queries (docs/10)
npm run verify:coalesce  # op coalescing (redundant set ops collapsed per flush)
npm run verify:worklet   # main-thread worklets + runOnBackground (docs/11)
npm run verify:mtref     # main-thread refs (cross-element worklet access) (docs/11)
npm run verify:destroy   # node disposal — no MT registry leak (docs/03)
npm run verify:self      # the `.self` event modifier (docs/12)
npm run verify:projection   # <ng-content> default + named slots (docs/14)
npm run verify:router       # @angular/router — provideLynxRouter (docs/15)
npm run verify:list-scroll  # <list> scroll events + scrollToPosition (docs/08)
npm run verify:polyfills    # PrimJS polyfills install correctly when absent, and URL matches Node's (docs/05)
npm run verify:main-thread-api  # runOnMainThread, runOnBackground, bindWorklet, MainThread.Element (docs/11)
npm run verify:gesture      # native gesture detectors (docs/32)
npm run verify:animate      # lynxAnimate tween helper (docs/33)
```

`verify:list` additionally **simulates the native list runtime** — after the ops
batch announces cells via `update-list-info`, it invokes the `componentAtIndex`
callbacks to materialise them — and asserts items are collected (not eagerly
appended), announced with the right item-keys, and rendered as `<list-item>`
cells, including after a dynamic add.

The base `npm run verify` boots the **real** example `AppComponent` through
Angular's JIT compiler in
Node — no rspack, no device — and exercises the whole chain:

```
Angular template compiled (JIT)
  → component instantiated, signals + zoneless CD
    → LynxRenderer2 produces ops
      → flush ships them via a mocked callLepusMethod
        → the real Main-Thread applyOps replays them onto a MOCK element PAPI
          → we read back the reconstructed native tree
            → simulate a tap → CD updates → the view changes
```

`verify/harness.ts` mocks the element PAPI (`__CreateView`, `__AppendElement`,
`__SetAttribute`, `__FlushElementTree`, …) so each call records into an in-memory
tree, mocks `lynx.getNativeApp().callLepusMethod` to forward ops into the real
`applyOps`, then prints the reconstructed tree and asserts it. `verify/build.mjs`
bundles it with esbuild (defining `__DEV__`/`ngDevMode` and aliasing the
`ng-lynx` specifiers to source), then runs it.

Expected output (abridged): the native tree shows `view.app → banner / counter /
parity / list / add`, the `@for` renders both list items, the computed parity
reads `0 is even`, and `(tap)` handlers are registered. After a simulated tap the
counter reads `1`, parity flips to `1 is odd`, and the `.even` class is removed —
proving signals, control flow, class bindings, and the event round-trip.

What it proves: the renderer, the shadow tree, the flat ops protocol, the
Main-Thread PAPI replay, the sign-based event path, zoneless change detection,
**and** the full bootstrap provider set — with the real Angular compiler.

What it does **not** prove: rspack dual-thread bundling and engine compatibility
— that's what levels 3 and 4 cover.

`node scripts/verify-consumer.mjs [angular-major]`, from the repo root, covers the
published package's layout: it packs the tarball, scaffolds every
`create-ng-lynx` template outside the workspace, installs and builds them,
and runs the Vitest quick start from [19 — Testing](19-testing.md).

### Bootstrap provider audit (results)

Bringing Angular up **without** `@angular/platform-browser` (which is mandatory
on Lynx — there is no DOM) surfaced the exact provider set core needs. These now
live in `provideLynx()` (`runtime/src/bootstrap.ts`):

| Provider | Why it's needed off the browser platform |
| --- | --- |
| `ɵINJECTOR_SCOPE: 'root'` | Marks the app injector as the root scope so every `providedIn: 'root'` core service (PendingTasks, ApplicationInitStatus, …) resolves. The single most important one. |
| `provideZonelessChangeDetection()` | Signals-driven CD; no Zone.js. |
| `RendererFactory2 → LynxRendererFactory2` | The Lynx renderer. |
| `ErrorHandler` (default) | Core's error-handler environment initializer requires one (NG0402). |
| `APP_ID` | Read by core initializers; normally platform-supplied. |
| `ɵINTERNAL_APPLICATION_ERROR_HANDLER` | Read during bootstrap; routes uncaught errors to `ErrorHandler`. |

One non-DI runtime requirement also surfaced: Angular core reads `.tagName`
directly on the host element (`locateHostElement`), so `ShadowElement` exposes a
`tagName` getter.

## Level 3 — ES2019 parse gate (catches PrimJS issues locally)

Lynx's Background-Thread engine (PrimJS) is ~ES2019. Modern syntax in the bundle
fails at load on-device with errors like *"Left hand side of operator '=' must be
a reference"*. You can catch this **without a device** by parsing the built
bundles with [acorn](https://github.com/acornjs/acorn) at `ecmaVersion: 2019`:

```js
// after `rspeedy dev`/`build`, against dist/.rspeedy/main/*.js
const acorn = require('acorn');
acorn.parse(code, { ecmaVersion: 2019, sourceType: 'module' });
// throws (with position) on the first ES2020+ construct
```

This is the fast loop that surfaced the real device blockers (the `ngDevMode`
define, the legacy-decorator requirement) before ever opening the simulator. The
build is configured so both `background.js` and `main-thread.js` pass this gate.

One wired-up instance of the gate exists: `npm run verify:lazy-chunks` runs it
against the async chunk emitted for the device by a real `asyncChunks: true`
production build (see
[15 — Routing](15-routing.md#lazy-routes-loadcomponent--loadchildren)) — that
file is fetched and executed by PrimJS at navigation time, so it must satisfy
the same ES2019 bar as the bundles.

## Level 4 — On device / web

```bash
pnpm install
pnpm --filter ng-lynx build
cd examples/hello-world && pnpm rspeedy dev
```

- **Web:** open `http://localhost:3000/__web_preview?casename=main.web.bundle`.
- **iOS simulator:** Lynx Explorer → "Enter Card URL" → paste
  `http://localhost:3000/main.lynx.bundle?fullscreen=true` (no camera on the
  simulator, so paste rather than scan). A physical device can scan the QR code.

What's been run where, and what's left, is in
[41 — Device testing](41-device-testing.md). See the PrimJS gotchas in [05 — Build integration](05-build-integration.md) if you change
the build and something stops loading.

## Quick reference: what each layer is responsible for

| If this breaks… | Look here |
| --- | --- |
| Type errors against Angular | `runtime/src/renderer.ts`, `runtime/src/bootstrap.ts` |
| Wrong native tree | `main-thread/src/ops-apply.ts` + the protocol in `internal/src/ops.ts` |
| Taps don't fire | `runtime/src/event-registry.ts`, `runtime/src/entry-background.ts` |
| Nothing renders at all | page-root wiring in `main-thread/src/entry-main.ts` + `bootstrap.ts` |
| `loadCard failed` / blank on device | PrimJS compatibility — run the ES2019 gate; check the gotchas in [05](05-build-integration.md) (`ngDevMode` literal, missing built-ins) |
| MT bundle never executes | `AngularMarkMainThreadPlugin` in `plugin/src/index.ts` |
