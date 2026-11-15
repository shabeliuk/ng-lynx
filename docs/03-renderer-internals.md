# Renderer internals

This explains how `LynxRenderer2` (in
[`packages/ng-lynx/runtime/src/renderer.ts`](../packages/ng-lynx/runtime/src/renderer.ts))
turns Angular rendering into Lynx ops. Read
[01 — Architecture](01-architecture.md) first.

## The `Renderer2` surface, mapped

Angular calls these methods; each maps to a shadow-tree update plus one or more
ops. `scheduleFlush()` is called after every mutation.

| `Renderer2` method | Shadow-tree effect | Op(s) emitted |
| --- | --- | --- |
| `createElement(name)` | new `ShadowElement('element')` | `CREATE id name` |
| `createComment(v)` | new comment node (view anchor) | `CREATE id '#comment'` |
| `createText(v)` | new raw-text node | `CREATE_TEXT id` (+ `SET_TEXT` if non-empty) |
| `appendChild(p, c)` | link `c` last under `p` | `INSERT p c -1` |
| `insertBefore(p, c, ref)` | link `c` before `ref` | `INSERT p c ref?.id ?? -1` |
| `removeChild(p, c)` | unlink `c` | `REMOVE p c` |
| `setAttribute(el, 'class', v)` | replace class set | `SET_CLASS id merged` (at flush) |
| `setAttribute(el, 'style', v)` | keep as `staticStyle` | `SET_STYLE id cssString` (at flush) |
| `setAttribute(el, k, v)` | track `id` if `k==='id'` | `SET_ATTR id k v` |
| `removeAttribute(el, k)` | — | `REMOVE_ATTR id k` |
| `addClass` / `removeClass` | mutate class set | `SET_CLASS id merged` (at flush) |
| `setStyle` / `removeStyle` | mutate style record | `SET_STYLE id cssString` (at flush) |
| `setProperty(el, k, v)` | `id`, `style`, `className` as their attribute forms | `SET_ATTR id k v`; `value` on a text field also calls `setValue` |
| `setValue(node, v)` | — | `SET_TEXT id v` |
| `listen(el, name, cb)` | register sign | `SET_EVENT id type name sign` |
| `parentNode` / `nextSibling` | read shadow tree | (none) |
| `selectRootElement(sel)` | return page root | (none) |

### Classes and styles are accumulated, not replaced

Angular's renderer mutates **one class or one style property at a time**
(`addClass('active')`, `setStyle('color', 'red')`). So `ShadowElement` owns:

- `classes: Set<string>` — `addClass`/`removeClass` mutate it.
- `styles: Record<string, string>` — `setStyle`/`removeStyle` mutate it.
- `staticStyle` — the `style="…"` attribute as written. Lynx has one inline-style
  slot per element, so it's serialized first and the bindings after it, which is
  also why a `[style.x]` binding wins over a static declaration of `x`.

These methods **don't serialize eagerly**. They mark the element dirty
(`pending-style.ts`); the flush serializes each dirty element **once** — the
joined class string (`SET_CLASS`) and the CSS declaration string (camelCase →
dash-case, custom properties preserved; `SET_STYLE`). Serializing per-mutation
would be O(N²) string building for N bindings on one element in a single CD
pass, all but the last thrown away. Deferring to flush emits exactly one op per
element with the final value.

Sending a CSS *string* (rather than an object) keeps `__SetInlineStyles` happy
regardless of engine-specific key-casing rules.

## Text handling

Angular models text as explicit text nodes appended to an element. For
`<text>Hello {{name}}</text>` Angular does: `createElement('text')`,
`createText('Hello ')`, `createText(name)`, append both. On the Main Thread,
`CREATE_TEXT` makes a **raw text** node (`__CreateRawText`) so it can live inside
a `<text>` element; `SET_TEXT` updates it via `__SetAttribute(el, 'text', …)`.

`__SetAttribute('text', …)` is confirmed as the canonical update path, not a
workaround: `lynx-family/lynx`'s native engine source
(`core/renderer/dom/fiber/raw_text_element.cc`) shows `RawTextElement`
special-cases the `"text"` attribute key directly in `SetAttributeInternal` —
there's no separate `__UpdateRawText` PAPI exposed to JS at all.

## The flush cycle

[`flush.ts`](../packages/ng-lynx/runtime/src/flush.ts) batches ops. Two
triggers, both calling the idempotent `flushOps()`:

1. **Microtask** — `scheduleFlush()` queues a microtask the first time it's
   called in a tick; further calls no-op until it runs. This batches an entire
   synchronous burst (e.g. a full change-detection pass) into one payload.
2. **`LynxRendererFactory2.end()`** — Angular calls `end()` at the close of each
   change-detection cycle; we flush synchronously so updates don't wait for the
   microtask.

`flushOps()` drains the buffer, **coalesces** it, JSON-stringifies it, and calls
`callLepusMethod('ngPatchUpdate', { data }, ack)`. Coalescing (`coalesceOps` in
`internal/ops.ts`) drops redundant same-target "set" ops — `SET_CLASS`,
`SET_STYLE`, `SET_TEXT`, `SET_ATTR`/`REMOVE_ATTR` — keeping only the last write
to each (element, slot). It's safe because the Main Thread never reads back an
intermediate value, and it noticeably shrinks the payload when Angular toggles
several class/style bindings on one element in a tick. It also records a promise that
`whenFlushed()` resolves when the Main-Thread `ack` fires — use it when you need
to read back the materialized native tree.

`whenFlushed()` tracks an **in-flight count**, not a single promise: batches can
overlap (a second change-detection cycle can send its own batch before the
first one's ack arrives), and an earlier single-shared-`resolve`-slot design
let a later batch's ack silently orphan an earlier caller's promise forever —
found live while building `examples/ui-gallery` (a `fields()` read in
`afterNextRender` hung indefinitely). See `packages/ng-lynx/verify/harness-flush-race.ts`
for the regression test (it patches the mock's ack to land asynchronously,
since the mock's default same-tick ack can never reproduce overlapping
batches) and `docs/10-element-queries.md` for the full story.

`enableSelectorQueries: 'lazy'` (`shadow-element.ts`'s `ShadowElement.runQuery()`)
is a second `whenFlushed()` consumer, and the reason it's implementable at
all: it emits an element's `ng-ref-{id}` attribute as an ordinary `SET_ATTR`
op instead of a native call, then defers the real `createSelectorQuery()`
call — a synchronous channel entirely separate from the ops/flush pipeline —
until `whenFlushed()` proves the Main Thread has actually applied it. See
[10 — Element queries](10-element-queries.md#deferring-per-element--enableselectorqueries-lazy).

## Events

`listen(target, eventName, cb)`:

- **Element target** → parse the name (`tap`, `catchtap`, `bindtap`,
  `capture-bindtap`, `capture-catchtap`, `global-bindfoo`), register `cb` to get
  a `sign`, emit `SET_EVENT id type name sign`, and return an unlisten that emits
  `REMOVE_EVENT` and frees the sign. Angular automatically calls the returned
  unlisten when the view is destroyed. See [12 — Events](12-events.md).
- **Global target** (`window`/`document`/`body`) → Lynx's `GlobalEventEmitter`,
  on the Background Thread.

The handler table lives on `globalThis` (keyed `__ANGULAR_LYNX_EVENT_REGISTRY__`)
so a doubly-evaluated bundle still shares one table.

## Bootstrap & the page root

`bootstrapLynxApplication` uses Angular's private `ɵinternalCreateApplication`
(the same primitive `bootstrapApplication` is built on) with the DOM-free
provider set from `provideLynx()`: the **root injector scope**, zoneless change
detection, the Lynx `RendererFactory2`, a default `ErrorHandler`, `APP_ID`, and
the internal application error handler. (Browser apps get these from
`@angular/platform-browser`, which Lynx can't use — there's no DOM.) The full
audit table is in [07 — Verifying](07-verifying.md#bootstrap-provider-audit-results).

Angular core also reads `.tagName` directly on the host element during
component creation, so `ShadowElement` exposes a `tagName` getter (returning its
Lynx tag) in addition to the renderer-driven mutations.

The **page root** is reserved as `ShadowElement` id `1`. Its real element is
created on the Main Thread by `__CreatePage` inside `renderPage` — so the
renderer *never* emits a `CREATE` for it, only `INSERT`s into it.
`selectRootElement()` always resolves to this root, ignoring the component's CSS
selector (Lynx has exactly one root).

Next: [04 — Wire protocol](04-wire-protocol.md).
