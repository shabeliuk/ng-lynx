/**
 * Sign-based event handler registry for the Background Thread.
 *
 * When `LynxRenderer2.listen()` binds a handler it gets a unique `sign` string.
 * The Main Thread stores that sign against the native element via
 * `__AddEvent(el, type, name, sign)`. When the native runtime fires the event it
 * calls `publishEvent(sign, data)` back on the Background Thread, which looks up
 * the handler and runs it directly — there is no cross-thread round-trip for the
 * handler body itself, only the lightweight event payload.
 *
 * State is stored on `globalThis` under a well-known key so that even if the
 * bundle materialises this module more than once (separate entry graphs), every
 * copy of `register` / `publishEvent` sees the same handler table.
 *
 * ---
 *
 * **Pre-boot event queueing** (docs/20-first-screen.md). A first-screen
 * snapshot paints real, tappable elements before the Background Thread has
 * even started executing — so a tap in that window calls `publishEvent(sign,
 * …)` for a sign no handler has registered yet (the app hasn't booted). Today
 * that's silently dropped. When `__HAS_FIRST_SCREEN__` is true (the app
 * configured `pluginAngularLynx({ firstScreen })`), `publishEvent` instead
 * buffers such calls until `resolveFirstScreenEvents(matched)` — called once,
 * from the cross-thread `FIRST_SCREEN_RESOLVED_EVENT` the Main Thread sends
 * after `consumeFirstScreenBatch` resolves (`entry-background.ts`) — tells it
 * what happened:
 *
 * - **matched**: the real app's own first render is byte-identical to the
 *   snapshot, which is only true because both produced the exact same
 *   deterministic sequence of signs from a fresh `register()` counter — so
 *   the handlers just registered *are* what the queued signs meant. Replay.
 * - **mismatched**: the snapshot was torn down; the real app's own signs,
 *   while assigned from the same counter, don't correspond to what the
 *   snapshot's elements meant (a numeric collision is possible but
 *   meaningless). Discard — replaying could misfire a stale tap onto an
 *   unrelated live handler.
 *
 * When `__HAS_FIRST_SCREEN__` is false (the common case — no snapshot
 * configured at all), buffering never activates: `publishEvent` behaves
 * exactly as it always has, since no snapshot means no pre-boot-tappable
 * elements exist for an unregistered sign to ever come from.
 */

interface RegistryState {
  signCounter: number;
  handlers: Map<string, (data: unknown) => void>;
}

const REGISTRY_STATE_KEY = '__ANGULAR_LYNX_EVENT_REGISTRY__';

type RegistryGlobal = typeof globalThis & {
  __ANGULAR_LYNX_EVENT_REGISTRY__?: RegistryState;
};

/**
 * `__HAS_FIRST_SCREEN__` is replaced at build time by the bundler `define`
 * (`Boolean(firstScreen)` in `plugin/src/index.ts`). Declared here so this
 * file type-checks standalone.
 */
declare const __HAS_FIRST_SCREEN__: boolean;

/**
 * Read at module scope, so a plain `import 'angular-lynx'` outside a
 * `pluginAngularLynx` build (a Vitest or Jest run) must not throw.
 */
function hasFirstScreen(): boolean {
  return typeof __HAS_FIRST_SCREEN__ !== 'undefined' && __HAS_FIRST_SCREEN__;
}

/** Buffered pre-boot events, awaiting `resolveFirstScreenEvents`. */
let awaitingFirstScreenResolution = hasFirstScreen();
let pendingFirstScreenEvents: { sign: string; data: unknown }[] = [];

function getRegistryState(): RegistryState {
  const g = globalThis as RegistryGlobal;
  let state = g[REGISTRY_STATE_KEY];
  if (!state) {
    state = {
      signCounter: 0,
      handlers: new Map<string, (data: unknown) => void>(),
    };
    Object.defineProperty(g, REGISTRY_STATE_KEY, {
      value: state,
      configurable: true,
      enumerable: false,
      writable: true,
    });
  }
  return state;
}

export function register(handler: (data: unknown) => void): string {
  const state = getRegistryState();
  const sign = `ng:${state.signCounter++}`;
  state.handlers.set(sign, handler);
  return sign;
}

export function unregister(sign: string): void {
  getRegistryState().handlers.delete(sign);
}

/** Called by the Lynx native runtime when an event fires on the BG Thread. */
export function publishEvent(sign: string, data: unknown): void {
  const state = getRegistryState();
  const handler = state.handlers.get(sign);
  if (handler) {
    handler(data);
    return;
  }
  // No handler yet. If a first-screen snapshot is in play and we haven't
  // heard back yet whether it matched, this could be a real pre-boot tap on
  // the snapshot's UI — buffer it instead of dropping it. See this module's
  // doc for why the resolution (not a timeout) is what's authoritative.
  if (awaitingFirstScreenResolution) {
    pendingFirstScreenEvents.push({ sign, data });
  }
}

/**
 * Called once, from the cross-thread `FIRST_SCREEN_RESOLVED_EVENT` listener
 * (`entry-background.ts`), once the Main Thread has resolved whether the
 * first-screen snapshot matched the real app's own first render. See this
 * module's doc for why `matched` (not just "the queue is non-empty") decides
 * replay vs. discard.
 */
export function resolveFirstScreenEvents(matched: boolean): void {
  awaitingFirstScreenResolution = false;
  const queued = pendingFirstScreenEvents;
  pendingFirstScreenEvents = [];
  if (!matched) return;
  const state = getRegistryState();
  for (const { sign, data } of queued) state.handlers.get(sign)?.(data);
}

/** Reset all state — for testing only. */
export function resetRegistry(): void {
  const state = getRegistryState();
  state.signCounter = 0;
  state.handlers.clear();
  awaitingFirstScreenResolution = hasFirstScreen();
  pendingFirstScreenEvents = [];
}
