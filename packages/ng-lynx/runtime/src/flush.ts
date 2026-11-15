/**
 * Flush coordinator: batches Background-Thread ops and ships them to the Main
 * Thread in a single cross-thread call.
 *
 * Two things trigger a flush:
 *
 *   1. A microtask scheduled by `scheduleFlush()`. Every renderer mutation calls
 *      this; the first call in a tick schedules the drain, subsequent calls are
 *      no-ops. This batches everything produced during one synchronous burst
 *      (e.g. a full Angular change-detection pass) into one payload.
 *
 *   2. `LynxRendererFactory2.end()` calling `flushOps()` directly at the end of
 *      each change-detection cycle, so updates land promptly without waiting for
 *      the microtask. `flushOps()` is idempotent — if the buffer is empty it
 *      does nothing.
 *
 * This is the Angular analog of vue-lynx's `flush.ts`, which hooks Vue's
 * `queuePostFlushCb`. We use a microtask instead so the runtime stays decoupled
 * from Angular's scheduler internals.
 */
import { coalesceOps, internStrings, PATCH_METHOD } from 'ng-lynx/internal/ops';

import { logFlush } from './op-logger.js';
import { takeOps } from './ops.js';
import { materializePendingStyleClass } from './pending-style.js';

// `lynx` is injected by the Lynx runtime wrapper as a parameter to the bundle's
// AMD-style callback — it is NOT on globalThis. Declared module-scoped (not a
// global .d.ts) so it doesn't clash with the main-thread `lynx` ambient.
// eslint-disable-next-line no-var
declare var lynx:
  | {
      getNativeApp():
        | { callLepusMethod(method: string, params: unknown, callback: () => void): void }
        | null
        | undefined;
    }
  | null
  | undefined;

let scheduled = false;

// ---------------------------------------------------------------------------
// Session epoch — an explicit replay-guard identifier.
//
// Generated once when this module is first evaluated, so it's stable for the
// life of one Background-Thread script execution and (overwhelmingly likely
// to be) different across two separate executions of the same script — the
// scenario that actually matters here: the bundle's top-level code running
// twice within one Main-Thread page lifetime, which restarts element ids from
// 2 and would otherwise re-CREATE ids the first execution already owns. Sent
// as a sibling field alongside `data` on every flush; `ops-apply.ts` compares
// it against the epoch of the first batch it accepted and drops a batch
// carrying a different one — an explicit session-identity check replacing
// what used to be inferred from whether the batch's first op was a colliding
// CREATE (see docs/04-wire-protocol.md).
// ---------------------------------------------------------------------------
function generateEpoch(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
const SESSION_EPOCH = generateEpoch();

// ---------------------------------------------------------------------------
// Main-thread acknowledgement tracking
//
// `callLepusMethod` ships ops asynchronously. Code that wants to read back the
// materialised native tree (e.g. a selector query in `afterNextRender`) needs
// to know when the Main Thread has actually applied the batch. We expose
// `whenFlushed()` which resolves on the MT callback.
// ---------------------------------------------------------------------------

// Batches can overlap: the Main Thread ack for one flush can still be in
// transit when another change-detection cycle produces and sends the next
// one. A single shared `resolve` slot would get clobbered by the second
// batch before the first's ack arrived, permanently orphaning whoever was
// awaiting it (found live: a `fields()` read in `afterNextRender` hung
// forever). Track the number of batches currently in flight instead, and
// queue every `whenFlushed()` waiter; acks are delivered in the order their
// batches were sent (same MessageChannel), so draining the queue once the
// count reaches zero always satisfies "the batch that was in flight when I
// called `whenFlushed()` has landed" for every queued waiter.
let inFlightCount = 0;
let waiters: Array<() => void> = [];

/**
 * Resolves once every ops batch in flight as of this call has been applied
 * on the Main Thread. If nothing is in flight, resolves immediately.
 */
export function whenFlushed(): Promise<void> {
  if (inFlightCount === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
  });
}

export function scheduleFlush(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flushOps);
}

// Set while the page is being destroyed: ops produced by the app's teardown have
// no native tree left to land on. See page-destroy.ts.
let stopped = false;

/** Discard every later batch. */
export function stopFlushing(): void {
  stopped = true;
}

/** Ship batches again after {@link stopFlushing}, for `lynx.reload()`. */
export function resumeFlushing(): void {
  stopped = false;
}

/**
 * Drain the ops buffer and ship it to the Main Thread. Idempotent: safe to call
 * even when nothing is buffered. Called both by the scheduled microtask and
 * synchronously by `LynxRendererFactory2.end()`.
 */
export function flushOps(): void {
  scheduled = false;
  // Serialize deferred style/class changes into the buffer first (once per
  // dirty element), so a batch whose only changes were styles isn't seen as
  // empty below. See pending-style.ts.
  materializePendingStyleClass();
  const raw = takeOps();
  if (raw.length === 0 || stopped) return;
  // Drop redundant same-target set ops accumulated during this batch.
  const ops = coalesceOps(raw);

  // Dev op-stream logging (no-op unless enabled via enableLynxOpLogging) —
  // logs the real, human-readable values, so it must see `ops` (pre-interning),
  // not the wire-compressed form.
  logFlush(ops);

  // Mark this batch in flight BEFORE sending so any `whenFlushed()` called
  // after this point queues behind it instead of resolving immediately.
  inFlightCount++;

  // Dedupe repeated string values (CREATE types, class lists, attr keys, …)
  // into a shared table — a no-op (byte-for-byte unchanged) unless something
  // in this batch actually repeats. See internal/src/ops.ts.
  const wireOps = internStrings(ops);

  const app = lynx?.getNativeApp?.();
  app?.callLepusMethod?.(PATCH_METHOD, { data: JSON.stringify(wireOps), epoch: SESSION_EPOCH }, () => {
    inFlightCount--;
    if (inFlightCount === 0) {
      const toResolve = waiters;
      waiters = [];
      for (const resolve of toResolve) resolve();
    }
  });
}

/** Reset module state — for testing only. */
export function resetFlushState(): void {
  scheduled = false;
  stopped = false;
  inFlightCount = 0;
  waiters = [];
}
