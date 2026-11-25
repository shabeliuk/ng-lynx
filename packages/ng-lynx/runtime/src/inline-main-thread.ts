/**
 * Inline `'main thread'` functions, Background-Thread side. `pluginAngularLynx`
 * rewrites each one as `ɵinlineMainThread(id, capture, fn)` (plugin/src/
 * inline-main-thread.cts); the Main Thread registers the same function under the
 * same id. See docs/11-worklets.md#inline-main-thread-functions.
 *
 * What this returns stands in for the function on the Background Thread. It
 * carries the id, and reads what the function captured when it's bound or called,
 * so a field declared after it is already set by then:
 *
 * - `[lynxMainThread]` and `[lynxGesture]` bind it as a worklet whose `ctx.params`
 *   is what it captured (`toWorkletRef`);
 * - `runOnMainThread(fn)(…args)` sends what it captured ahead of the arguments;
 * - anywhere else it crosses the threads (in another function's captures, in
 *   `bindWorklet` params, in arguments), `toJSON` sends it as a main-thread
 *   function with its captures.
 */

declare const __DEV__: boolean;

const CAPTURE = Symbol('ngLynxInlineMainThread');

/** The stand-in for an inline `'main thread'` function. */
interface InlineMainThreadStub {
  readonly _wkltId: string;
  readonly _mtFnId: string;
  readonly [CAPTURE]: () => Record<string, unknown>;
}

/** Whether `value` is the stand-in for an inline `'main thread'` function. */
export function isInlineMainThread(value: unknown): value is InlineMainThreadStub {
  return typeof value === 'function' && CAPTURE in value;
}

/** What an inline `'main thread'` function captured, read now. */
export function inlineCaptures(value: InlineMainThreadStub): Record<string, unknown> {
  return value[CAPTURE]();
}

function isHandle(value: object): boolean {
  return '_refId' in value || '_mtFnId' in value || '_bgFnId' in value || '_wkltId' in value;
}

/** In a dev build, name each captured value that can't reach the Main Thread. */
function checkCaptures(id: string, captured: Record<string, unknown>): void {
  const check = (name: string, value: unknown): void => {
    if (typeof value === 'function') {
      if (isInlineMainThread(value)) return;
      console.error(
        `[ng-lynx] The 'main thread' function ${id} uses \`${name}\`, a function, which can't reach the Main Thread. `
          + 'A signal? Read it into a const first, or keep the value in a mainThreadRef. '
          + 'A helper? Mark it \'main thread\' too.',
      );
      return;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value) || isHandle(value)) return;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      console.error(
        `[ng-lynx] The 'main thread' function ${id} uses \`${name}\`, a ${proto?.constructor?.name ?? 'class instance'}, `
          + 'which reaches the Main Thread only as JSON. Pass refs, \'main thread\' functions, backgroundFunction handles '
          + 'and plain data.',
      );
    }
  };
  for (const [name, value] of Object.entries(captured)) {
    if (name === 'this' && value && typeof value === 'object') {
      for (const [member, memberValue] of Object.entries(value)) check(`this.${member}`, memberValue);
    } else {
      check(name, value);
    }
  }
}

/**
 * Stand in for an inline `'main thread'` function. Written by `pluginAngularLynx`,
 * not by hand: `fn` is the original function, kept so its type is what the
 * template and the rest of the file see.
 *
 * @internal
 */
export function ɵinlineMainThread<F>(id: string, capture: () => Record<string, unknown>, fn: F): F {
  void fn;
  const stub = function (): never {
    throw new Error(
      `[ng-lynx] ${id} is a 'main thread' function: it runs on the Main Thread. Bind it with [lynxMainThread] or `
        + '[lynxGesture], call it with runOnMainThread, or pass it to another \'main thread\' function.',
    );
  };
  const read = (): Record<string, unknown> => {
    const captured = capture();
    if (__DEV__) checkCaptures(id, captured);
    return captured;
  };
  Object.defineProperties(stub, {
    _wkltId: { value: id },
    _mtFnId: { value: id },
    [CAPTURE]: { value: read },
    toJSON: { value: () => ({ _mtFnId: id, _c: read() }) },
  });
  return stub as unknown as F;
}
