// Derived in part from vue-lynx (https://github.com/Huxpro/vue-lynx), Copyright Xuan Huang,
// Apache-2.0. Changed: its op protocol, extended for Angular.
/**
 * Internal (`ng-lynx/internal/ops`): not part of the public API or semver.
 *
 * Flat-array operation codes — the wire protocol between the Background Thread
 * (where Angular and the LynxRenderer2 run) and the Main Thread (where the real
 * Lynx elements live and the element PAPI is applied).
 *
 * The protocol is intentionally a flat array of JSON-serializable primitives so
 * that a whole batch of mutations can be stringified once and shipped across the
 * thread boundary in a single `callLepusMethod` call.
 *
 * Format (all numbers/strings, JSON-serializable):
 *   CREATE:        [0, id, type]                  // type '#comment' → invisible anchor
 *   CREATE_TEXT:   [1, id]                         // raw text node (lives inside <text>)
 *   INSERT:        [2, parentId, childId, anchorId] // anchorId === -1 means append
 *   REMOVE:        [3, parentId, childId]
 *   SET_ATTR:      [4, id, key, value]             // setAttribute + [property] bindings
 *   SET_TEXT:      [5, id, text]
 *   SET_EVENT:     [6, id, eventType, eventName, sign]
 *   REMOVE_EVENT:  [7, id, eventType, eventName]
 *   SET_STYLE:     [8, id, cssString]              // merged inline style string for the element
 *   SET_CLASS:     [9, id, classString]            // merged class list for the element
 *   REMOVE_ATTR:   [10, id, key]
 *   SET_WORKLET_EVENT: [11, id, eventType, eventName, workletRef]  // main-thread handler
 *   DESTROY:       [12, id]                        // node destroyed — free it from the MT registry
 *   SET_REF:       [13, id, refId]                 // bind element to a main-thread ref; -id unbinds it (worklet element access)
 *   SET_GESTURE_DETECTOR: [14, id, gestureId, gestureType, config, relationMap] // main-thread gesture (see gesture.ts)
 *
 * This is the Angular analog of vue-lynx's op protocol.
 *
 * `internStrings`/`resolveInterned` (below) are an optional second encoding
 * pass over an already-built flat array: they dedupe repeated string values
 * (a `CREATE` type, a `SET_CLASS` class list, …) into a shared table, only
 * when a batch actually has repeats worth deduping. See
 * docs/04-wire-protocol.md#string-table.
 */
export const OP = {
  CREATE: 0,
  CREATE_TEXT: 1,
  INSERT: 2,
  REMOVE: 3,
  SET_ATTR: 4,
  SET_TEXT: 5,
  SET_EVENT: 6,
  REMOVE_EVENT: 7,
  SET_STYLE: 8,
  SET_CLASS: 9,
  REMOVE_ATTR: 10,
  SET_WORKLET_EVENT: 11,
  DESTROY: 12,
  SET_REF: 13,
  SET_GESTURE_DETECTOR: 14,
} as const;

export type OpCode = (typeof OP)[keyof typeof OP];

/** Number of arguments that follow each op code (for decoding the flat buffer). */
export const OP_ARITY: Record<number, number> = {
  [OP.CREATE]: 2,
  [OP.CREATE_TEXT]: 1,
  [OP.INSERT]: 3,
  [OP.REMOVE]: 2,
  [OP.SET_ATTR]: 3,
  [OP.SET_TEXT]: 2,
  [OP.SET_EVENT]: 4,
  [OP.REMOVE_EVENT]: 3,
  [OP.SET_STYLE]: 2,
  [OP.SET_CLASS]: 2,
  [OP.REMOVE_ATTR]: 2,
  [OP.SET_WORKLET_EVENT]: 4,
  [OP.DESTROY]: 1,
  [OP.SET_REF]: 2,
  [OP.SET_GESTURE_DETECTOR]: 5,
};

export interface OpRecord {
  code: number;
  args: unknown[];
}

/** Parse the flat ops buffer into structured records. */
export function decodeOps(flat: unknown[]): OpRecord[] {
  const out: OpRecord[] = [];
  let i = 0;
  while (i < flat.length) {
    const code = flat[i++] as number;
    const arity = OP_ARITY[code] ?? 0;
    out.push({ code, args: flat.slice(i, i + arity) });
    i += arity;
  }
  return out;
}

/** Flatten structured records back into the wire buffer. */
export function encodeOps(records: OpRecord[]): unknown[] {
  const flat: unknown[] = [];
  for (const r of records) {
    flat.push(r.code);
    for (const a of r.args) flat.push(a);
  }
  return flat;
}

/**
 * The coalescing "slot" for an op whose value is absolute (only the last write
 * in a batch is observable on the Main Thread), or `null` for ops whose order /
 * identity must be preserved (create / insert / remove / events).
 */
function coalesceKey(r: OpRecord): string | null {
  switch (r.code) {
    case OP.SET_CLASS:
      return `class:${r.args[0]}`;
    case OP.SET_STYLE:
      return `style:${r.args[0]}`;
    case OP.SET_TEXT:
      return `text:${r.args[0]}`;
    case OP.SET_ATTR:
    case OP.REMOVE_ATTR:
      return `attr:${r.args[0]}:${r.args[1]}`;
    default:
      return null;
  }
}

/**
 * Drop redundant absolute "set" ops within a batch, keeping only the last write
 * to each (element, slot) in its original position. Create/insert/remove/event
 * ops are never touched. Safe because the Main Thread never reads back an
 * intermediate attribute/class/style/text value.
 */
export function coalesceOps(flat: unknown[]): unknown[] {
  const records = decodeOps(flat);
  const lastIndex = new Map<string, number>();
  records.forEach((r, idx) => {
    const k = coalesceKey(r);
    if (k) lastIndex.set(k, idx);
  });
  const kept = records.filter((r, idx) => {
    const k = coalesceKey(r);
    return k === null || lastIndex.get(k) === idx;
  });
  return encodeOps(kept);
}

// ---------------------------------------------------------------------------
// String table — dedupe repeated string values in a batch
// (docs/04-wire-protocol.md#string-table).
//
// A batch of many similar elements (e.g. a `@for` over N rows) repeats the
// same `CREATE` type string, `SET_CLASS` class list, attribute key, or event
// name once per row. `internStrings` replaces each *repeated* occurrence with
// a small numeric index into a table shipped alongside the batch, and
// `resolveInterned` reverses it on the Main Thread.
// ---------------------------------------------------------------------------

/**
 * Which argument indices of each op code are **always** a string in the
 * uncompressed protocol — never a number — so a number found there at decode
 * time is unambiguously a table index, never a real value. `SET_ATTR`'s
 * `value` argument (index 2) is deliberately excluded: it's `unknown`, and a
 * real attribute value can itself be a number (e.g. `[volume]="1.5"`), which
 * would collide with a table index. `SET_GESTURE_DETECTOR`'s `config`/
 * `relationMap` (objects, not simple string args) are excluded for the same
 * reason — there's no fixed string slot to intern there.
 */
const INTERNABLE_ARGS: Partial<Record<number, readonly number[]>> = {
  [OP.CREATE]: [1], // type
  [OP.SET_ATTR]: [1], // key (not value — see above)
  [OP.REMOVE_ATTR]: [1], // key
  [OP.SET_TEXT]: [1], // text
  [OP.SET_STYLE]: [1], // css string
  [OP.SET_CLASS]: [1], // class string
  [OP.SET_EVENT]: [1, 2], // eventType, eventName (not sign — always unique, see flush.ts)
  [OP.REMOVE_EVENT]: [1, 2], // eventType, eventName
  [OP.SET_WORKLET_EVENT]: [1, 2], // eventType, eventName (not workletRef — an object)
  [OP.SET_REF]: [1], // refId
};

/**
 * Build a string table for values that repeat **more than once** across
 * internable slots in this batch, and rewrite those occurrences (only) into
 * numeric indices into that table. Table indices are assigned in
 * first-appearance order, so the same ops always produce the same table —
 * required for the first-screen snapshot's byte-for-byte replay match (see
 * `main-thread/src/first-screen.ts`).
 *
 * Singleton strings are left inline: moving a value used exactly once into
 * the table costs the same bytes for the string itself, plus the wrapper and
 * the index — a net loss, not a gain. When nothing in the batch repeats, this
 * returns the **original array unchanged** (`===`-identical), so
 * `JSON.stringify`ing it produces byte-for-byte the same payload as before
 * this feature existed — zero overhead for the common small-incremental-update
 * case, which rarely has anything worth deduping.
 */
export function internStrings(flat: unknown[]): unknown[] {
  const records = decodeOps(flat);

  const counts = new Map<string, number>();
  for (const r of records) {
    const slots = INTERNABLE_ARGS[r.code];
    if (!slots) continue;
    for (const idx of slots) {
      const v = r.args[idx];
      if (typeof v === 'string') counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }

  let hasRepeats = false;
  for (const n of counts.values()) {
    if (n > 1) {
      hasRepeats = true;
      break;
    }
  }
  if (!hasRepeats) return flat;

  const table: string[] = [];
  const indexOf = new Map<string, number>();
  const interned = records.map((r): OpRecord => {
    const slots = INTERNABLE_ARGS[r.code];
    if (!slots) return r;
    const args = r.args.slice();
    for (const idx of slots) {
      const v = args[idx];
      if (typeof v !== 'string' || (counts.get(v) ?? 0) < 2) continue;
      let tableIndex = indexOf.get(v);
      if (tableIndex === undefined) {
        tableIndex = table.length;
        table.push(v);
        indexOf.set(v, tableIndex);
      }
      args[idx] = tableIndex;
    }
    return { code: r.code, args };
  });

  return [table, encodeOps(interned)];
}

/**
 * Reverse `internStrings`: given the parsed `data` payload — either a plain
 * flat ops array (nothing repeated, or a batch from before this feature
 * shipped) or a `[table, internedFlat]` tuple — return the plain flat ops
 * array with every table reference resolved back to its real string.
 *
 * The two shapes are unambiguous: a real op code (`parsed[0]`) is always a
 * plain number; the interned form's first element is always the table, an
 * array. Idempotent on an already-plain array, so callers that may see either
 * an already-resolved array or a raw parsed payload (e.g.
 * `first-screen.ts`, which resolves once for its own scan and then passes the
 * result to `applyOps`, which resolves again) don't need to track which.
 */
export function resolveInterned(parsed: unknown[]): unknown[] {
  if (parsed.length === 0 || typeof parsed[0] === 'number') return parsed;
  const [table, flat] = parsed as [string[], unknown[]];
  const records = decodeOps(flat);
  for (const r of records) {
    const slots = INTERNABLE_ARGS[r.code];
    if (!slots) continue;
    for (const idx of slots) {
      const v = r.args[idx];
      if (typeof v === 'number') r.args[idx] = table[v];
    }
  }
  return encodeOps(records);
}

/** anchorId sentinel meaning "append at the end" (no reference sibling). */
export const APPEND_ANCHOR = -1;

/**
 * The name of the Lepus (Main Thread) method invoked by the Background Thread
 * to ship an ops batch. Must match the global registered in entry-main.ts.
 */
export const PATCH_METHOD = 'ngPatchUpdate';

/** Reserved id of the page root. Created on the Main Thread via __CreatePage. */
export const PAGE_ROOT_ID = 1;

/**
 * Cross-thread-context event type for a worklet's `ctx.runOnBackground(data)`.
 * The Main Thread sends via `lynx.getJSContext().dispatchEvent({ type,
 * data })`; the Background Thread receives via
 * `lynx.getCoreContext().addEventListener(type, …)` — confirmed against
 * `@lynx-js/web-core`'s real `LynxCrossThreadContext` (the same generic
 * cross-thread pub/sub primitive the worklet-runtime itself uses for
 * `Lynx.Worklet.runWorkletCtx`). Not a `globalThis` property: BG and MT don't
 * share one on a real engine — confirmed on-device (an earlier version of this
 * bridge assumed they did, and silently did nothing as a result).
 */
export const RUN_ON_BACKGROUND_EVENT = '__ngRunOnBackground';

/**
 * Cross-thread-context event type the Main Thread dispatches once it has
 * resolved whether a first-screen snapshot (`main-thread/src/first-screen.ts`)
 * matched the Background Thread's real first batch or not — `data: {
 * matched: boolean }`. Same channel as {@link RUN_ON_BACKGROUND_EVENT}, just
 * the other direction of information (MT telling BG something, rather than
 * BG asking MT to run something). Lets `event-registry.ts` know when it's
 * safe to replay (match) or must discard (mismatch) any `publishEvent` calls
 * that arrived for a not-yet-registered sign — i.e. a tap on the
 * snapshot-painted UI before the real app has booted. See
 * docs/20-first-screen.md.
 */
export const FIRST_SCREEN_RESOLVED_EVENT = '__ngFirstScreenResolved';

// ---------------------------------------------------------------------------
// Calls between the threads — `runOnMainThread` / `runOnBackground`.
//
// Lynx's own versions take any closure, because a compiler transform extracts
// it. The AOT pipeline can't run that transform (docs/05-build-integration.md),
// so functions and refs cross the threads as these handles instead, and arrive
// on the Main Thread as live refs and callable functions. See docs/11-worklets.md.
// ---------------------------------------------------------------------------

/**
 * Lepus method the Background Thread calls to run a main-thread function. Same
 * channel as the render ops, so a call can rely on the ops sent before it.
 */
export const RUN_ON_MAIN_THREAD_METHOD = 'ngRunOnMainThread';

/** Lepus method the Background Thread calls when a `mainThreadRef()` is disposed. */
export const RELEASE_MAIN_THREAD_REF_METHOD = 'ngReleaseMainThreadRef';

/** Main Thread → Background: the outcome of a `runOnMainThread` call. */
export const MAIN_THREAD_RESULT_EVENT = '__ngMainThreadResult';

/** Main Thread → Background: `runOnBackground(handle)(...args)`. */
export const BACKGROUND_CALL_EVENT = '__ngBackgroundCall';

/** Background → Main Thread: the outcome of a `runOnBackground` call. */
export const BACKGROUND_RESULT_EVENT = '__ngBackgroundResult';

/**
 * A function defined on the Main Thread with `defineMainThreadFunction`.
 * `runOnMainThread(handle)(...args)` calls it from the Background Thread. Inside
 * a worklet's `ctx.params`, or a main-thread function's arguments, it arrives as
 * a plain callable function.
 *
 * @public
 */
export interface MainThreadFunctionHandle<A extends unknown[] = never[], R = unknown> {
  readonly _mtFnId: string;
  /** Type-only: never set at runtime. */
  readonly _mtFnType?: (...args: A) => R;
}

/**
 * A Background-Thread function exposed with `backgroundFunction(fn)`.
 * `runOnBackground(handle)(...args)` calls it from the Main Thread.
 *
 * @public
 */
export interface BackgroundFunctionHandle<A extends unknown[] = never[], R = unknown> {
  readonly _bgFnId: string;
  /** Type-only: never set at runtime. */
  readonly _bgFnType?: (...args: A) => R;
}

/**
 * A ref on its way to the Main Thread, from `mainThreadRef()` or
 * `defineMainThreadRef()`. Bind it to an element with `[lynxMainThreadRef]`, or
 * use it to hold a value. Inside a worklet's `ctx.params` it arrives as a live
 * {@link MainThreadRef}.
 *
 * @public
 */
export interface MainThreadRefHandle<T = unknown> {
  readonly _refId: string;
  /** The value `current` starts with. */
  readonly _init?: T;
}

/**
 * A live ref on the Main Thread. `current` is the bound element while
 * `[lynxMainThreadRef]` holds one (`null` once it's destroyed), and otherwise the
 * value you last stored. Like ReactLynx's `useMainThreadRef`.
 *
 * @public
 */
export interface MainThreadRef<T = unknown> extends MainThreadRefHandle<T> {
  current: T;
}

/**
 * The Background Thread's form of a value the Main Thread sees as `T`: a
 * {@link MainThreadRef} is sent as its handle, a function as its
 * {@link MainThreadFunctionHandle}. Everything else has to be JSON-serializable.
 *
 * @public
 */
export type ToMainThread<T> = T extends MainThreadRef<infer V>
  ? MainThreadRefHandle<V>
  : T extends BackgroundFunctionHandle<infer A, infer R>
    ? BackgroundFunctionHandle<A, R>
    : T extends (...args: infer A) => infer R
      ? MainThreadFunctionHandle<A, R>
      : T extends readonly unknown[]
        ? { [K in keyof T]: ToMainThread<T[K]> }
        : T extends object
          ? { [K in keyof T]: ToMainThread<T[K]> }
          : T;

/**
 * A worklet from `defineWorklet`. `P` is the type of `ctx.params`, the values
 * {@link bindWorklet} gives each binding.
 *
 * @public
 */
export interface WorkletHandle<P = unknown> {
  readonly _wkltId: string;
  /** Type-only: never set at runtime. */
  readonly _wkltParams?: (params: P) => void;
}

/**
 * A worklet plus the values one binding gives it. See {@link bindWorklet}.
 *
 * @public
 */
export interface BoundWorklet<P = unknown> extends WorkletHandle<P> {
  readonly _params: ToMainThread<P>;
}

/**
 * Give one binding of a worklet its own values, available as `ctx.params`. This
 * is what a closure does for a ReactLynx worklet, for several instances of a
 * component to share one worklet: refs and `backgroundFunction`s arrive live, and
 * main-thread functions arrive callable. The rest has to be JSON-serializable.
 *
 * Keep the result in a field, since a new one for `[lynxMainThread]` rebinds the event:
 *
 * ```ts
 * readonly card = mainThreadRef();
 * readonly events = { tap: bindWorklet(fade, { card: this.card, to: 0.5 }) };
 * ```
 *
 * @public
 */
export function bindWorklet<P>(worklet: WorkletHandle<P>, params: ToMainThread<P>): BoundWorklet<P> {
  return { _wkltId: worklet._wkltId, _params: params };
}
