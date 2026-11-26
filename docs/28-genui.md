# GenUI: A2UI + OpenUI in ng-lynx

Lynx's GenUI stack (`@lynx-js/genui`, [docs](https://lynxjs.org/next/api/genui/index.html))
has four modules. All four work from an ng-lynx app — two as-is, two
through Angular-native render layers shipped in the **`ng-lynx/genui`**
sub-entry:

| Module | What it is | How ng-lynx uses it |
| --- | --- | --- |
| `a2ui-prompt` | Node: build A2UI system prompts from catalogs | **As-is** — framework-agnostic |
| `a2ui-catalog-extractor` | Node + TypeDoc: `@a2uiCatalog` interfaces → catalog JSON | **As-is** — framework-agnostic |
| `a2ui` | A2UI v1.0 client runtime (protocol store + ReactLynx renderer) | Store reused as-is; **renderer ported to Angular** |
| `openui` | OpenUI-language runtime (lang-core parser + ReactLynx renderer) | Parser reused as-is (via `@openuidev/lang-core`); **renderer ported to Angular** |

Verified by six harnesses (`npm run verify:genui-tools`,
`verify:genui-a2ui`, `verify:genui-openui`, `verify:genui-openui-runtime`,
`verify:genui-openui-parity`, `verify:genui-openui-append`) and the runnable
[`examples/genui`](../examples/genui) app. That app is a retirement planner
driven by a **real LLM** (Gemini through a dev-server proxy), with the A2UI and
OpenUI protocol demos as extra tabs. Everything also runs offline on canned
agents, with no keys needed; see its [README](../examples/genui/README.md).

Dependencies: `@lynx-js/genui` (0.8.1 up to, not including, 0.9), `@openuidev/lang-core`
(0.3+), and `zod` are **optional peers** of ng-lynx — only apps importing
`ng-lynx/genui` need them installed. What moved in GenUI 0.7 is in
[40 — The Lynx 4.2 upgrade](40-lynx-4-2.md#genui-07); the move to A2UI v1.0 is
[below](#migrating-from-a2ui-v09).

## A2UI — agent-driven JSON → trusted Angular components

ng-lynx speaks **A2UI v1.0**, the version the
[A2UI spec](https://a2ui.org/specification/v1.0-a2ui/) marks current, and the only one
`@lynx-js/genui` 0.8 accepts.

The upstream package splits cleanly: `@lynx-js/genui/a2ui/store` is "pure
data logic, no React" (`MessageStore`, `MessageProcessor`, `SignalStore`,
`Resource`, the payload normalizers, function execution), and
`@lynx-js/genui/a2ui/functions` (the basic-catalog client functions) is also
React-free. ng-lynx consumes both directly. Only the render layer —
`<A2UI>`, `NodeRenderer`, and its hooks — is React, and that's what
`ng-lynx/genui` re-creates:

| Upstream (ReactLynx) | ng-lynx |
| --- | --- |
| `<A2UI messageStore catalogs catalogId onAction onMessage>` | `<a2ui-surface [messageStore] [catalog] [catalogId] (action) [messageHandler]>` |
| `NodeRenderer` | `A2uiNode` (`<ng-container [a2uiNode]="..." [a2uiNodeSurface]="...">`) |
| `defineCatalog` / `defineFunction` / `serializeCatalog` | `defineA2uiCatalog` (accepts upstream function entries unchanged, e.g. `basicFunctions`) / `serializeA2uiCatalog` |
| `GenericComponentProps` prop spread + `useAction` / `useResolvedProps` / `useChecks` | `A2UI_NODE_CONTEXT` injection token: `props()`, `checks()`, `setValue()`, `sendAction()` |
| `accessibilityProps(props)` spread on each root | the `a2uiA11y` directive on each root |
| 20 built-in catalog components | **20/20 Angular ports** (the full catalog): Text, Button, Row, Column, Card, Divider, Image, List, Loading, TextField, CheckBox, Slider, Icon, RadioGroup, ChoicePicker, Modal, Tabs, DateTimeInput, LineChart, PieChart |

```ts
import { basicFunctions } from '@lynx-js/genui/a2ui/functions';
import {
  A2UI_BASIC_CATALOG, A2uiSurface, createMessageStore, defineA2uiCatalog,
} from 'ng-lynx/genui';

const store = createMessageStore();
const catalog = defineA2uiCatalog([...A2UI_BASIC_CATALOG, ...basicFunctions]);
```

```html
<a2ui-surface
  [messageStore]="store"
  [catalog]="catalog"
  [messageHandler]="sendToAgent"
  (action)="onAction($event)"
/>
```

The client loop is upstream's exactly: your transport pushes protocol
messages into the store, the surface renders them, and agent responses go
back into the same store. A v1.0 stream looks like this:

```ts
store.push([
  {
    version: '1.0',
    createSurface: {
      surfaceId: 'shop',
      catalogId: A2UI_DEFAULT_CATALOG_ID, // the id <a2ui-surface> registers its catalog under
      components: [
        { id: 'root', component: 'Column', children: ['name', 'buy'] },
        { id: 'name', component: 'Text', text: { '@path': '/product/name' } },
        { id: 'buy-label', component: 'Text', text: 'Buy' },
        {
          id: 'buy', component: 'Button', child: 'buy-label',
          action: { event: { name: 'buy', context: { sku: { '@path': '/product/sku' } } } },
        },
      ],
      dataModel: { product: { name: 'Lynx Hoodie', sku: 'LX-1' } },
    },
  },
]);
```

Every message carries `version: '1.0'`; anything else is rejected with an
`UNSUPPORTED_VERSION` error. Bindings are `{ '@path': '/a/b' }` (relative paths
resolve against a template item), function calls `{ '@call': 'name', args }`.
`@@key` writes a literal key that starts with `@`. Component envelope fields
are `@catalogId`, `@checks`, `@metadata` and `@accessibility`; `children: {
path, componentId }` templates keep a bare `path`. In `updateDataModel`, a
`null` value deletes.

**What the renderer sends.** `messageHandler` receives every message the
renderer sends the agent, as `{ message, metadata }`: `action` (user events),
`error` (validation and expression failures), `callAgentFunction` (a function
the catalog declares without an implementation) and `rendererFunctionResponse`
(answers to the agent's `callRendererFunction`). `metadata` carries the data
model of surfaces created with `sendDataModel: true`. Return a promise to
settle the send; a rejection fails any pending agent function call. `(action)`
is a shortcut that emits just the user actions.

**Catalogs are registered by id.** `<a2ui-surface>` registers `catalog` on its
processor under `catalogId` (default `A2UI_DEFAULT_CATALOG_ID`, upstream's
published Lynx catalog). A surface renders only from the catalog its
`createSurface.catalogId` names (or a component's `@catalogId`), and `@call`
finds functions there too: an unknown id renders "Unsupported component"
notices, as upstream does. To tell an agent about your catalog, send it
`serializeA2uiCatalog(catalog, id)` (every component needs a `schema` for
that; the catalog extractor produces them).

**Swapping stores.** `[messageStore]="null"` renders nothing. Passing a
different store starts a new session: a new processor, with the new store's
messages replayed from the start.

### Custom catalog components

An Angular catalog component injects its runtime contract instead of
receiving a prop spread:

```ts
@Component({
  imports: [A2uiAccessibility],
  template: `<view a2uiA11y (tap)="buy()"><text>{{ title() }}</text></view>`,
})
export class ProductCard {
  private readonly ctx = inject(A2UI_NODE_CONTEXT);
  readonly title = computed(() => String(this.ctx.props()['title'] ?? ''));
  buy(): void {
    void this.ctx.sendAction({ event: { name: 'buy', context: { sku: { '@path': '/sku' } } } });
  }
}
// register: defineA2uiCatalog([{ name: 'ProductCard', component: ProductCard, schema }, …])
```

`ctx.props()` is a signal holding the *resolved* protocol props: `@path`
bindings become current data-model values and `@call`s run through the
catalog's functions. With a `schema` for the component, values are coerced to
their declared `DynamicString` / `DynamicNumber` / `DynamicBoolean` types, as
upstream does (the basic catalog ships without schemas, and its components
normalize their own inputs). `action`, `@checks` and `@metadata` stay as sent.

`ctx.checks()` is the outcome of the component's `@checks`: `{ ok, failures,
firstFailureMessage }`. A rule passes when its condition is `true` or a
ValidationResult with `valid: true`. `ctx.setValue('value', v)` writes back
through a prop's `@path` (how TextField/CheckBox/Slider persist input).
`ctx.sendAction(a)` is upstream's `useAction`: an `event` is sent as a v1.0
`action` once its `context` and `userMessage` resolve (nested `@call`s are
awaited); a `functionCall` runs as a user-activated call. It never rejects:
failures are reported to the agent and logged.

### How reactivity is bridged

The store keeps its data model, and the results of asynchronous function
calls, in `@preact/signals`. Upstream re-resolves a component's props inside
an `effect()`, so any signal read along the way re-renders it: a binding, a
value a function implementation reads, an agent function's answer arriving.

ng-lynx can't import `effect` itself (`@lynx-js/react-signals` isn't its
dependency, and a second signals runtime would never see the store's writes),
but every signal carries its runtime: preact's `Signal.prototype.subscribe(fn)`
is an `effect` that reads `this.value`. `trackA2uiSignals` (reactivity.ts)
calls it with a `this` whose `value` getter runs the resolution, which makes
the resolution the body of a real effect on the store's own runtime. Props and
`@checks` re-resolve exactly when upstream's would; the effect writes Angular
signals, and zoneless change detection takes it from there.

Until ng-lynx 1.1 the port collected the binding paths it read instead, so a
value read inside a function implementation only refreshed on the next
structural update. That gap is gone.

### What's ported vs not (a2ui)

Ported and harness-verified: surface lifecycle (inline `createSurface`,
`updateComponents`, `updateDataModel` with deletes, `deleteSurface`), `@path`
binding and write-back, templated children (`{ path, componentId }` expansion
with scoped relative bindings), `@call` props and action contexts, agent-routed
functions (`callAgentFunction` → `agentFunctionResponse`), `@checks` with
ValidationResult messages, `@accessibility`, the `@@` escape, version
rejection, catalog lookup by id, store swapping, fail-soft unknown components
with the once-per-tag warning, `basicFunctions` reuse, and all 20 built-in
components, including the `LineChart`/`PieChart` SVG builders (ported
near-verbatim as pure functions, rendered via Lynx's native `<svg>` element's
`content` attribute) and `DateTimeInput`'s full calendar-grid + time-stepper
dialog (same pure date/time helpers upstream uses, in `datetime-utils.ts`).

Two deliberate simplifications versus upstream's ReactLynx versions of these
components (documented at each class in `basic-catalog.ts`): `Modal`'s
trigger doesn't get upstream's `suppressActionDispatch` (a trigger that
itself carries an action fires it in addition to opening the modal), and
`ChoicePicker` renders one visual style rather than switching
checkbox-vs-chips chrome (the interaction — filter, single/multi select,
checks — is complete either way).

Also not ported: the `FormContext` cross-input registry (a Button checks its
own `@checks`, not every input in its form), upstream's CSS theme tokens
(style the upstream-compatible class names from your app CSS — see
`examples/genui/src/app.css`), and `compactA2UIMessagesToSnapshot`
(importable from `@lynx-js/genui/a2ui/snapshot` directly if needed — it's
framework-agnostic).

**Bug found and fixed along the way:** `A2uiNode` has no `ngOnChanges` — it
only re-renders in place via a component's per-id `Resource` subscription,
so a container that reassigns which *sibling id* is active (like `Tabs`
switching tabs) needs a track-keyed `@for` instead of `@if`/`as` to force a
fresh `A2uiNode` instance per id (mirrors upstream's own `key={childId}` on
`NodeRenderer` for the same reason). `A2uiTabs` uses this; `A2uiModal` and
`A2uiCard`/`A2uiButton`'s single fixed child don't need it, since their
target id never changes while mounted.

### Migrating from A2UI v0.9

ng-lynx 1.1 requires `@lynx-js/genui` 0.8.1 or later (below 0.9), which only
accepts A2UI v1.0. Agents that emit v0.9 must be regenerated: rebuild their
prompts with `@lynx-js/genui/a2ui-prompt` 0.8 (it states the v1.0 format), or
change hand-written streams:

| v0.9 | v1.0 |
| --- | --- |
| no `version` | `version: '1.0'` on every message |
| `createSurface: { surfaceId }` | `createSurface: { surfaceId, catalogId }` (and optionally `components`, `dataModel` inline) |
| `{ path: '/a' }` | `{ '@path': '/a' }` |
| `{ call: 'fn', args }` | `{ '@call': 'fn', args }` |
| `checks`, `catalogId`, `metadata`, `accessibility` on a component | `@checks`, `@catalogId`, `@metadata`, `@accessibility` |
| `{ userAction: { … } }` from the renderer | `{ version: '1.0', action: { … } }` |

On the Angular side:

- `(action)` still emits the same `UserActionPayload`. Add `[messageHandler]`
  to receive errors and agent function calls too.
- Pass `[catalogId]` if your agent names a catalog other than
  `A2UI_DEFAULT_CATALOG_ID`.
- Custom components: read `ctx.checks()` instead of resolving `checks`
  conditions from `ctx.props()`, add `a2uiA11y` to their root, and expect
  `ctx.sendAction()` to return a promise.
- `ResolvedProps.touchedPaths` is gone: wrap `resolveComponentProps` in
  `trackA2uiSignals` for reactivity.

## OpenUI — streamed UI language → Angular components

Upstream `@lynx-js/genui/openui` is a thin ReactLynx layer over
`@openuidev/lang-core`, which owns the language: parsing (streaming-aware),
prop schemas (zod), `$state` evaluation, ActionPlan semantics. The
`@lynx-js/genui/openui` entry itself pulls in ReactLynx at import time, so
ng-lynx uses **lang-core directly** — the same parser/evaluator, no
fork — and re-creates the render layer:

| Upstream (ReactLynx) | ng-lynx |
| --- | --- |
| `<OpenUiRenderer response library onAction>` | `<openui-renderer [response] [library] [streaming] (action) (parseResult)>` |
| `createOpenUiLibrary` | `createOpenUiLibrary` (same name, Angular components in the `component` slot — lang-core's `defineComponent` is generic over the renderer type) |
| React contexts + hooks (`useOpenUI`, `useTriggerAction`, `useGetFieldValue`, …) | `OPENUI_RENDERER_CONTEXT` / `OPENUI_NODE_CONTEXT` injection tokens |
| The built-in components | **Angular ports of all of them**, every signature checked against upstream's prompt library by `verify:genui-openui-parity`: Stack, Row, Column, List, Card, CardHeader, Text, TextContent, Separator, Divider, Button, Buttons, Tag, Image, Icon, Loading, AudioPlayer, Video, CheckBox, RadioGroup, ChoicePicker, Slider, DateTimeInput, TextField, Modal, Tabs, Canvas (renders upstream's "not supported on this platform" fallback). `Action` isn't a component upstream either — it's a prop schema. |

```ts
import { createOpenUiLibrary, OpenuiRenderer } from 'ng-lynx/genui';
const library = createOpenUiLibrary();          // or extend with your defineComponent()s
```

```html
<openui-renderer [response]="llmText()" [library]="library"
                 [streaming]="isStreaming()" (action)="sendToAgent($event)" />
```

Note: upstream's OpenUI `ChoicePicker` and `DateTimeInput` are simpler than
their *a2ui* namesakes — display/local-selection only, no data-model
write-back or calendar dialog. This port matches that (both protocols made
different design calls here upstream; see `basic-catalog.ts` for a2ui's
richer versions of the same two names).

Note also: `Video` and `AudioPlayer` are **placeholder attachment cards**
upstream too — a static play-icon + title/URL, not a real player. Confirmed
by reading `@lynx-js/genui/openui`'s own `Video`/`AudioPlayer` source before
porting them: neither wires to Lynx's native `<video>` element, so this port
matches that deliberate upstream choice rather than upgrading it. If you
want real playback in your own app (inside or outside a GenUI surface), use
the typed `<video>` element directly — `ng-lynx/elements`' `LynxVideo`,
see [18 — Typed templates](18-typed-templates.md#video).

Feed `response` incrementally while streaming — partial text renders
whatever is parseable and each appended chunk re-renders (nodes keep their
identity where possible: a parent's re-evaluation passes original child
nodes through untouched, so child subtrees and their event listeners
survive form-state changes). Taps are gated while `streaming` is true,
matching upstream.

Verified in the harness: streamed partial rendering, positional-arg → prop
mapping, `Action([@ToAssistant("…")])` → ActionPlan → `(action)` with
`continue_conversation` + attached form state, `$state` refs re-evaluating
when a TextField bound to the same state name changes, unknown components
failing soft, parse errors surfacing via `(parseResult)`.

Two things worth knowing about the language (both upstream behaviors,
confirmed empirically):

- **Props are positional.** `TextField("Name", "", null, null, null, "$name")`
  maps arguments in schema-field order; skipped optional arguments are
  `null`, and an object literal argument maps to the *first* prop, it is not
  named-prop syntax. This is also why the Angular library's zod schemas
  replicate upstream field order exactly — see
  [Staying in step with the prompt](#staying-in-step-with-the-prompt-genui-040).
- **State keys keep the `$`.** `$name = ""` + `Text("Hi " + $name)`
  evaluates via `getState('$name')`, so a TextField binds it with
  `name: "$name"` — the `$` is part of the key, same as upstream.

### Staying in step with the prompt (genui 0.4.0)

A real model learns component signatures from the system prompt, and a
deployment builds that prompt with upstream's `buildOpenUiSystemPrompt`
(`@lynx-js/genui/openui/prompt`). Because props are positional, **any
difference between the prompt's signatures and this library's schemas is a
silent mis-render**. Nothing errors: the arguments just land in the wrong
props.

That has happened. The port was written against genui 0.0.6. By 0.4.0, 19 of
the 26 components had drifted:

- **Argument order changed** for `TextField` (`label, value, variant,
  validationRegexp, action, name`), `Row` and `Column` (`justify, align,
  gap…`). A model writing `TextField("Age", "", "number", null, null, "$age")`
  bound the field to a name of `"number"`.
- **New or renamed props:** `Button` (`type`, `size`), `Image` (`variant`),
  `TextContent` (`size`), `Buttons` (`buttons`), and a wider gap scale
  (`xxs`, `2xl`).
- **`Slider`** was missing entirely.

It surfaced while wiring the planner to Gemini. All of it is synced now, and
**`verify:genui-openui-parity`** compares lang-core's generated signature line
for every component (`library.toSpec().components[name].signature`, the exact
text the model reads) against upstream's. The next upstream change fails there
first.

Related changes that landed with it:

- **One lang-core.** The prompt and the parser must be the same version of
  `@openuidev/lang-core`. lang-core's *runtime* telemetry (prompt-build and parse sampling) is **opt-in**
  (`OPENUI_RUNTIME_TELEMETRY_ENABLED=1`), off by default, confirmed in the
  shipped source; only the install-time postinstall needs `DO_NOT_TRACK`
  (see [36 — CI](36-ci.md)).
- **`Slider` measures nothing.** Upstream drags a lynx-ui `SliderRoot`, which
  needs the track's measured width. That's exactly what `LynxSlider` can't get
  in the web preview, where a layout-sized track reports `width: 0`. The port's
  track is a row of tap targets (one per step, up to 24) plus −/+ steppers, and
  behaves the same on both targets. Values snap to `step` like upstream's
  `fromRatio`.
- **Pre-filled values submit.** Upstream's `useSetDefaultValue` is ported: once
  streaming ends, a named `TextField` / `Slider` / `CheckBox` / `RadioGroup`
  writes its `value` into an **empty** field, so an untouched pre-filled input
  still arrives in the action's form state. There's one deliberate deviation:
  "empty" includes `null` (an undeclared `$variable`), and a field that already
  holds a value — e.g. restored through `initialState` — is never overwritten.
  Upstream also re-writes the prop on every change while the control is
  untouched, and that clobbers an `initialState` restore
  (`verify:genui-openui-runtime` guards against it).
- **Pre-filled `TextField`s show their text on device.** Native `<input>` has
  no `value` attribute, so the value is also written with `setValue` (shared
  with `LynxModel`, see [09 — Forms](09-forms.md#how-it-works)). A native host
  also needs the **XElement** pod for `<input>`/`<textarea>` at all; Lynx
  Explorer ships it, but a Sparkling app's template doesn't
  ([examples/genui README](../examples/genui/README.md)).
- **`TextField` variants:** `number` → `<input type="number">`, `obscured` →
  `password`, `longText` → `<textarea>`; `validationRegexp` shows "Invalid
  value" (a bad pattern never blocks input). Upstream's form-level validation
  gate on primary buttons (`FormContext`) is still not ported.

Page config works too: Lynx's official `@lynx-js/config-rsbuild-plugin`
(`pluginLynxConfig({ … })`) composes with `pluginAngularLynx` unchanged,
because rspeedy's build engine exposes the same `LynxTemplatePlugin` class our
plugin instantiates. The planner uses it for `enableFetchAPIStandardStreaming`,
verified by the flag appearing in `main.lynx.bundle` with the plugin and not
in a control build without it.

### Runtime mode — `toolProvider`, `Query()`/`Mutation()`, `@Run`/`@Set`/`@Reset`

Passing `toolProvider` opts into upstream's *runtime* mode, backed by
`@openuidev/lang-core`'s own `createQueryManager` — the same
framework-agnostic Query/Mutation engine upstream uses, not a reimplementation:

```html
<openui-renderer
  [response]="llmText()"
  [library]="library"
  [toolProvider]="{ list_items: (args) => fetch('/api/items?q=' + args.search).then(r => r.json()) }"
  [initialState]="restoredState()"
  (stateUpdate)="persist($event)"
  (action)="sendToAgent($event)"
/>
```

Given `$title = ""`, `data = Query("list_items", { search: $title }, { rows: [] })`,
and a button with `Action([@Run(save), @Run(data), @Reset($title)])`:

- **`Query()`** renders its `defaults` immediately and re-renders with the
  real result once the `toolProvider` call resolves; it also refetches
  automatically whenever a `$variable` it depends on changes (`$title`
  here) — not just when explicitly `@Run`.
- **`Mutation()`** + `@Run` (mutation): evaluates the mutation's args
  against the *current* state and awaits `queryManager.fireMutation(...)`,
  halting the rest of the ActionPlan if it fails (matches upstream).
- **`@Run`** (query): `queryManager.invalidate([id])` forces an immediate
  refetch.
- **`@Set`** / **`@Reset`**: write (or restore-to-default) a named
  `$variable`, through the same path a bound `TextField` already writes
  through — so a `Query` depending on that variable reacts the same way
  either source changed it.
- **`toolProvider`** accepts either a `{ toolName: (args) => Promise<result> }`
  function map (normalized internally) or a `{ callTool(name, args) }`
  object (including an MCP client). It's a stable indirection cell
  internally — swapping the input later doesn't tear down in-flight query
  state, so it can be lazily created (e.g. after an auth token loads)
  without losing anything already fetched.
- **`initialState`** seeds `$variable`s (and, for non-`$` keys, form-field
  values) before the first render *and* the first `Query` fetch — so a
  Query depending on a restored `$variable` uses the restored value on its
  very first call, not the parsed default. **`stateUpdate`** emits the full
  form-state snapshot after every user-driven change, for round-tripping
  back into a later `initialState`.

Without `toolProvider`, behavior is unchanged from before this feature:
`Query`/`Mutation` simply never resolve (rendering their `defaults`
forever), and `@Run` is a harmless no-op — the same as upstream's own
"parsed" mode.

Verified end-to-end (real `toolProvider`, no mocks on the query engine
itself) by `npm run verify:genui-openui-runtime`.

Form-name scoping (`FormNameContext`) is plumbed through the context but no
Form component sets it yet.

## The two build-time tools

Both run unchanged from an ng-lynx repo (Node ≥ 22):

```ts
// Extract catalog JSON from @a2uiCatalog-tagged interfaces (TypeDoc under the hood)
import { extractCatalogComponents, extractCatalogFunctions } from '@lynx-js/genui/a2ui-catalog-extractor';
// Turn manifests into the system prompt your agent needs
import { buildA2UISystemPrompt, createA2UICatalogFromManifests, BASIC_CATALOG } from '@lynx-js/genui/a2ui-prompt';
```

The extractor consumes plain TypeScript interfaces (your Angular catalog
component's public contract) — see the fixture at
`packages/ng-lynx/verify/fixtures/genui/catalog-fixture.ts` and the
assertions in `harness-genui-tools.ts` for the exact shapes produced
(`string | { path: string }` → `oneOf`, literal unions → `enum`, optionals
kept out of `required`, `@a2uiFunction` → parameter schemas). The
`genui a2ui generate catalog` CLI works too. For OpenUI, prompts come from
the library itself: `library.prompt()` (lang-core `generatePrompt`).

## Layout note

Angular component host elements land in the Lynx element tree as plain
views (unknown tags → `__CreateView`), so a rendered A2UI/OpenUI tree has
one extra view layer per catalog component compared to the ReactLynx
renderer's fragments. Containers set flex on their own root view; the
wrapper views default to stretch. In practice this is invisible with the
example's styling, but pixel-identical parity with upstream's CSS is a
non-goal — theme the class names instead.
