/**
 * The rest of what a Main-Thread script expects from the worklet runtime: timers
 * and frames as globals, and `lynx.querySelector`. Both engines put timers on the
 * Main Thread's `lynx`, not on `globalThis`.
 */
import { queryPage, queryPageAll } from './element.js';

const TIMERS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;

type MainThreadLynx = Record<string, unknown>;

/**
 * `lynx[name]` as it is, or `undefined` if `lynx` has no such function. Not bound
 * to `lynx`: on the web preview these are the browser's own timers, which throw
 * "Illegal invocation" when called with any `this` but the window.
 */
function lynxFunction(lynxObject: MainThreadLynx, name: string): ((...args: never[]) => unknown) | undefined {
  const fn = lynxObject[name];
  return typeof fn === 'function' ? (fn as (...args: never[]) => unknown) : undefined;
}

/**
 * Copy `lynx`'s timers and frame functions to `globalThis`, unbound, as Lynx's own
 * runtime does. One `lynx` lacks is left as it was; `clearInterval` falls back to
 * `clearTimeInterval`, Lynx 2.14's spelling.
 */
export function installTimers(lynxObject: MainThreadLynx): void {
  const g = globalThis as Record<string, unknown>;
  for (const name of TIMERS) {
    const fn = lynxFunction(lynxObject, name) ?? (name === 'clearInterval' ? lynxFunction(lynxObject, 'clearTimeInterval') : undefined);
    if (fn) g[name] = fn;
  }
}

/** Lynx's documented main-thread `lynx.querySelector` and `lynx.querySelectorAll`. */
export function installQueries(lynxObject: MainThreadLynx): void {
  lynxObject['querySelector'] = queryPage;
  lynxObject['querySelectorAll'] = queryPageAll;
}
