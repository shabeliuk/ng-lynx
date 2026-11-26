/**
 * Shared per-element event-listener multiplexing.
 *
 * Extracted from `LynxRenderer2.listen()` (renderer.ts) so the same
 * dedup/dispatch logic backs both Angular template event bindings
 * (`(tap)="…"`) and {@link ShadowElement.addEventListener}'s DOM-shaped API
 * (used by `@defer (on interaction)` — see `visibility.ts`'s module doc).
 * One native `__AddEvent` registration per `(elementId, type, name)`, fanned
 * out to every registered callback — Lynx's element PAPI keeps only the last
 * `__AddEvent` call for a given `(element, type, name)`, so two independent
 * callers registering separately would silently clobber each other without
 * this shared map.
 */
import { OP } from 'ng-lynx/internal/ops';

import { register, unregister } from './event-registry.js';
import { scheduleFlush } from './flush.js';
import { pushOp } from './ops.js';
import type { ShadowElement } from './shadow-element.js';

/** Lynx event registration type — see `renderer.ts`'s `parseEvent` doc. */
export type LynxEventRegType = 'bindEvent' | 'catchEvent' | 'capture-bind' | 'capture-catch' | 'global-bindEvent';

interface ListenerEntry {
  sign: string;
  type: LynxEventRegType;
  name: string;
  targetId: number;
  callbacks: Set<(data: unknown) => void>;
}

const listeners = new Map<string, ListenerEntry>();
/** The keys of `listeners` per element id, so a destroyed element's can be dropped. */
const keysByElement = new Map<number, Set<string>>();

/** How many element listeners are registered. For leak checks (verify:memory). */
export function elementListenerCount(): number {
  return listeners.size;
}

/** How each registration type is written in a template. `global-bindEvent` has its own map. */
const TEMPLATE_PREFIXES: Partial<Record<LynxEventRegType, string>> = {
  bindEvent: '',
  catchEvent: 'catch',
  'capture-bind': 'capture-bind',
  'capture-catch': 'capture-catch',
};

/**
 * The engine keeps an element's events in a map keyed by name, so `(tap)` and
 * `(catchtap)` on one element overwrite each other and nothing reports it. See
 * docs/12-events.md.
 */
function warnOnEventCollision(el: ShadowElement, type: LynxEventRegType, name: string): void {
  const prefix = TEMPLATE_PREFIXES[type];
  if (prefix === undefined) return;
  for (const [otherType, otherPrefix] of Object.entries(TEMPLATE_PREFIXES)) {
    if (otherType !== type && listeners.has(`${el.id}:${otherType}:${name}`)) {
      console.warn(
        `[ng-lynx] <${el.type}> binds both (${otherPrefix}${name}) and (${prefix}${name}). `
          + 'The engine keeps one handler per event name on an element, so only the last one '
          + 'will run. Move one to a parent element. See docs/12-events.md.',
      );
      return;
    }
  }
}

/**
 * Register `callback` for `(el, type, name)`, sharing one native listener
 * across every caller of this function for the same triple. Returns a
 * disposer that removes just this `callback`; the native listener (and its
 * `SET_EVENT`/`REMOVE_EVENT` ops) is only torn down once every caller has
 * disposed.
 */
export function addElementListener(
  el: ShadowElement,
  type: LynxEventRegType,
  name: string,
  callback: (data: unknown) => void,
): () => void {
  const key = `${el.id}:${type}:${name}`;
  let entry = listeners.get(key);
  if (!entry) {
    if (__DEV__) warnOnEventCollision(el, type, name);
    const callbacks = new Set<(data: unknown) => void>();
    const sign = register((data) => {
      // Make the event a little more DOM-like: expose `target` (the element)
      // so host listeners written for the DOM don't crash. Notably
      // `@angular/forms` `DefaultValueAccessor` reads `$event.target.value`;
      // without a `target` it throws on every keystroke.
      if (data !== null && typeof data === 'object' && (data as { target?: unknown }).target === undefined) {
        try {
          (data as { target?: unknown }).target = el;
        } catch {
          // payload frozen — ignore
        }
      }
      if (name === 'input') {
        const text = (data as { detail?: { value?: unknown } } | null)?.detail?.value;
        if (typeof text === 'string') el.lastInputValue = text;
      }
      // Snapshot the set so a handler that unlistens (or adds one) mid-event
      // doesn't disturb the in-progress iteration.
      for (const cb of [...callbacks]) cb(data);
    });
    entry = { sign, type, name, targetId: el.id, callbacks };
    listeners.set(key, entry);
    let keys = keysByElement.get(el.id);
    if (!keys) keysByElement.set(el.id, (keys = new Set()));
    keys.add(key);
    pushOp(OP.SET_EVENT, el.id, type, name, sign);
    scheduleFlush();
  }

  entry.callbacks.add(callback);
  return () => {
    const e = listeners.get(key);
    if (!e || !e.callbacks.delete(callback)) return;
    if (e.callbacks.size === 0) {
      unregister(e.sign);
      listeners.delete(key);
      keysByElement.get(e.targetId)?.delete(key);
      pushOp(OP.REMOVE_EVENT, e.targetId, e.type, e.name);
      scheduleFlush();
    }
  };
}

/**
 * Forget every listener of an element being destroyed. Angular unlistens what it
 * registered when it destroys a view, except `animation*` and `transition*`
 * listeners: it leaves those to the browser, which drops them with the element
 * (`isAnimationEventType` in `@angular/core`), so they can still fire while an
 * element leaves. Here they'd stay in the event registry for good. The element
 * is going, so no REMOVE_EVENT is sent: its DESTROY frees it on the Main Thread.
 */
export function dropElementListeners(id: number): void {
  const keys = keysByElement.get(id);
  if (!keys) return;
  keysByElement.delete(id);
  for (const key of keys) {
    const entry = listeners.get(key);
    if (!entry) continue;
    unregister(entry.sign);
    listeners.delete(key);
  }
}

/** Reset all state — for testing only. */
export function resetElementListeners(): void {
  listeners.clear();
  keysByElement.clear();
}

/** Replaced at build time by the bundler `define`. */
declare const __DEV__: boolean;
