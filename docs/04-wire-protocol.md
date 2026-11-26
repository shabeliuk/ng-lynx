# Wire protocol

The Background and Main threads communicate with a **flat array of
JSON-serializable primitives**. A whole batch of mutations is stringified once
and shipped in a single `callLepusMethod('ngPatchUpdate', { data, epoch })`
call. A flat array (rather than an array of tuples) minimizes allocation and
payload size.

`epoch` is a sibling field alongside `data`, not part of the ops array itself
— see [Replay-guard epoch](#replay-guard-epoch) below.

Source of truth:
[`packages/ng-lynx/internal/src/ops.ts`](../packages/ng-lynx/internal/src/ops.ts).
Producer: the renderer (`pushOp`). Consumer:
[`main-thread/src/ops-apply.ts`](../packages/ng-lynx/main-thread/src/ops-apply.ts).

## Op codes

Each op is `code` followed by a fixed number of arguments.

| Code | Name | Args | Main-Thread effect |
| ---: | --- | --- | --- |
| 0 | `CREATE` | `id, type` | `__CreateView/Text/Image/ScrollView/Element`. Sets CSS scope + `ng-ref-{id}` selector attr. Angular's comment anchors are never sent ([03](03-renderer-internals.md#comment-anchors)). |
| 1 | `CREATE_TEXT` | `id` | `__CreateRawText('')` (raw text, lives inside `<text>`). |
| 2 | `INSERT` | `parentId, childId, anchorId` | `anchorId === -1` → `__AppendElement`; else `__InsertElementBefore`. `anchorId` is always a node the Main Thread has. |
| 3 | `REMOVE` | `parentId, childId` | `__RemoveElement`. |
| 4 | `SET_ATTR` | `id, key, value` | `key==='id'` → `__SetID`; `data-*` → `__AddDataset`; `key==='style'` → `__SetInlineStyles`; else `__SetAttribute`. |
| 5 | `SET_TEXT` | `id, text` | `__SetAttribute(el, 'text', text)`. |
| 6 | `SET_EVENT` | `id, eventType, eventName, sign` | `__AddEvent`. |
| 7 | `REMOVE_EVENT` | `id, eventType, eventName` | `__AddEvent(…, undefined)` (removes listener). |
| 8 | `SET_STYLE` | `id, cssString` | `__SetInlineStyles`. |
| 9 | `SET_CLASS` | `id, classString` | `__SetClasses`. |
| 10 | `REMOVE_ATTR` | `id, key` | `__SetAttribute(el, key, undefined)`; `data-*` → `__AddDataset(el, key, undefined)`. |
| 11 | `SET_WORKLET_EVENT` | `id, eventType, eventName, workletRef` | binds a native event to a main-thread worklet (see [11 — Worklets](11-worklets.md)). |
| 12 | `DESTROY` | `id` | frees the element from the MT `elements` registry on node destruction (see [renderer internals](03-renderer-internals.md)). The free is applied **after the whole batch**: Angular's hot-swap path ([31 — Hot-swap](31-hot-swap.md)) destroys a view before detaching it, so a same-batch `REMOVE` may follow the `DESTROY` and still needs the id. Safe because ids are never reused within a session. |
| 13 | `SET_REF` | `id, refId` (`-id` unbinds that element) | binds the element to a main-thread ref so worklets can reach it (see [11 — Worklets](11-worklets.md)). |
| 14 | `SET_GESTURE_DETECTOR` | `id, gestureId, gestureType, config, relationMap` | `__SetGestureDetector` (see [32 — Gestures](32-gestures.md)). |
| 15 | `CREATE_MAPPED` | `id, type, nodeIndex` | `CREATE`, with `{ nodeIndex }` passed to the create call when it isn't 0. Sent instead of `CREATE` in a `templateSourceMap` build (see [26 — Debugging](26-debugging.md#from-an-element-to-its-template)). |

Constants: `APPEND_ANCHOR = -1`, `PAGE_ROOT_ID = 1`, `PATCH_METHOD =
'ngPatchUpdate'`.

`eventType` is one of `bindEvent`, `catchEvent`, `capture-bind`, `capture-catch`,
`global-bindEvent`: the strings the engine dispatches on.

## Worked example

Mounting this component's first render:

```html
<view class="card" (tap)="inc()">
  <text class="label">Tapped 0 times</text>
</view>
```

produces (ids start at 2; the page root is id 1):

```jsonc
[
  0, 2, "view",                       // CREATE view  → id 2
  9, 2, "card",                       // SET_CLASS 2 "card"
  6, 2, "bindEvent", "tap", "ng:0",   // SET_EVENT on tap → sign ng:0
  0, 3, "text",                       // CREATE text → id 3
  9, 3, "label",                      // SET_CLASS 3 "label"
  1, 4,                               // CREATE_TEXT → id 4 (raw text)
  5, 4, "Tapped 0 times",             // SET_TEXT 4
  2, 3, 4, -1,                        // INSERT raw-text 4 into text 3 (append)
  2, 2, 3, -1,                        // INSERT text 3 into view 2 (append)
  2, 1, 2, -1                         // INSERT view 2 into page root 1 (append)
]
```

When the user taps, the native runtime calls `publishEvent('ng:0', evt)` on the
Background Thread → Angular runs `inc()` → the signal changes → a change
detection pass updates the text node → at `end()` we flush:

```jsonc
[ 5, 4, "Tapped 1 times" ]            // SET_TEXT 4
```

That's the whole update for an increment — one op.

## Replay-guard epoch

`flush.ts` generates one `SESSION_EPOCH` (a random token) the first time it's
evaluated — stable for the life of one Background-Thread script execution,
different across two separate executions of the same script — and sends it
as the `epoch` field alongside `data` on every flush.

`ops-apply.ts` commits to the first epoch it sees for a page
(`applyOps(ops, epoch)`); a later batch carrying a **different** epoch is a
replay from a different BG-thread execution (the bundle's top-level code ran
twice within one page lifetime, restarting element ids from 2 and re-CREATE-ing
ids the first execution already owns) — dropped whole.

This replaces an earlier heuristic that inferred the same situation from
whether a batch's first op happened to be a `CREATE` targeting an
already-registered id — correct in practice (ids are a monotonic per-session
counter, so a real collision only ever came from a second execution), but
implicit, and blind to a stale batch whose first op *wasn't* a `CREATE`. The
epoch check catches those too, since it doesn't inspect op shape at all.

`epoch` is optional: `first-screen.ts`'s snapshot replay (`applyFirstScreen`)
calls `applyOps` directly, before the Background Thread has booted at all, so
it has no session to check against — that path is untouched by this
mechanism and keeps working exactly as before (see
[20 — First-screen snapshot](20-first-screen.md)). Verified by
`npm run verify:replay-epoch`.

## String table

A batch that mounts many similar elements — a `@for` over N rows, a long
list — repeats the same string over and over: the `CREATE` type (`"view"`,
`"text"`), the `SET_CLASS` class list, attribute keys, event type/name. On a
500-row flat tree, **~18% of the serialized payload** is string *values* that
appear more than once (measured — `npm run verify:wireproto-measure`).

`internStrings` (`internal/src/ops.ts`) deduplicates those repeats into a
shared table. `flush.ts` runs it together with coalescing, as `encodeBatch`, in
one walk over the batch right before `JSON.stringify`. When a batch has anything worth deduping, the wire `data`
becomes a two-element tuple:

```jsonc
[
  ["view", "row", "text", "label", "bindEvent", "tap"],   // the table
  [ 0, 2, 0,  9, 2, 1,  6, 2, 4, 5, "ng:0",  … ]           // ops, with indices
]
```

Each interned string argument is replaced by its **numeric index** into the
table; `resolveInterned` (called on the Main Thread in `ops-apply.ts`, and in
`first-screen.ts` / the test harness) reverses it before anything reads the
ops. The two shapes are unambiguous: a plain batch always starts with a
numeric op code, the interned form always starts with the table array.

Deliberately **not** interned, to keep decode unambiguous and cheap:

- **`SET_ATTR`'s `value`** (only its `key`). A real attribute value can itself
  be a number (`[volume]="1.5"`), which would collide with a table index —
  and attribute values rarely repeat across elements anyway. `SET_TEXT`,
  `SET_STYLE`, and `SET_CLASS`'s single string arg *are* interned (they're
  always strings, never numbers).
- **Singletons.** A value used exactly once isn't tabled — moving it costs the
  same string bytes plus the wrapper and index, a net loss.
- **A batch with no repeats.** `internStrings` returns the original array
  `===`-unchanged, so `JSON.stringify` produces byte-for-byte the same payload
  as before this feature existed. A tiny incremental update (`[5, 4, "1"]` for
  a one-character text change) pays **zero** format overhead.

That last property matters beyond performance: the [first-screen
snapshot](20-first-screen.md) hydrates by comparing the live app's first batch
to the captured snapshot **byte-for-byte**. Interning is deterministic (table
indices assigned in first-appearance order), so the same ops always produce
the same compressed bytes — the snapshot (compressed once at capture) and the
live batch (compressed again at runtime) still match exactly. Verified by
`npm run verify:wireproto-intern` (encode/decode contract, edge cases) and
`npm run verify:wireproto-measure` (real 500-row byte savings + round-trip
correctness); the `ifr` harness covers a compressed snapshot hydrating in
place end-to-end.

## Versioning & forward-compat

`applyOps` ignores unknown op codes (the `default` branch falls through), so new
ops can be added without breaking older Main-Thread bundles. New ops take the next
free code.

## Measuring payload size

`npm run verify:wireproto-measure` renders a 500-row flat tree and both
**measures** the first batch's real byte breakdown and **asserts** the
[string table](#string-table)'s effect on it: that `ng-ref-{id}` still costs 0
wire bytes (it's a Main-Thread-only native call, never a
Background-Thread-emitted op), and that the table shrinks the repetitive batch
by ≥10% versus its uncompressed equivalent (~18% in practice) while decoding
back to exactly the expected per-row structure.

Next: [05 — Build integration](05-build-integration.md).
