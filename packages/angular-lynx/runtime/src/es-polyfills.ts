/**
 * Newer JavaScript built-ins and Web APIs the Lynx engine PrimJS doesn't have.
 * This module imports nothing, and the plugin makes it the very first thing a
 * Background bundle evaluates: `@angular/core` 22 calls `Object.hasOwn` while
 * its own module evaluates.
 *
 * The build downlevels *syntax* to ES2019, but a missing *method* only shows
 * up at runtime, on a device: `e.at is not a function` crashed the genui
 * planner on iOS (Sparkling, Lynx 3.9), while the web preview's browser and
 * Lynx Explorer's JavaScriptCore on iOS have everything.
 *
 * The list isn't a guess. It's read from PrimJS's own source (3.8.0-alpha.6,
 * `src/interpreter/quickjs/source/quickjs.cc`): these names have no
 * `LEPUS_CFUNC_DEF` on the prototype in question. Everything up to ES2020 is
 * there (`flat`, `matchAll`, `Promise.allSettled`/`any`, `Object.fromEntries`,
 * `globalThis`, …). Not covered, as rarely used: `Array.fromAsync`,
 * `String.prototype.isWellFormed`/`toWellFormed`, and the ES2023 copying
 * methods on typed arrays.
 *
 * Each install is guarded, so an engine that has the method keeps its own,
 * and defined like a built-in (non-enumerable), so `for…in` over an array
 * doesn't pick it up. Background thread only: it runs before the app's code
 * from entry-background.ts.
 *
 * @internal
 */

type AnyFn = (...args: never[]) => unknown;

function define(target: object, name: string, value: AnyFn): void {
  if (typeof (target as Record<string, unknown>)[name] === 'function') return;
  Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
}

/** ToIntegerOrInfinity, as the spec's relative-index methods use it. */
function toInteger(value: unknown): number {
  const n = Number(value);
  return n !== n || n === 0 ? 0 : Math.trunc(n);
}

/** Resolve a relative index (`-1` = last) against `length`. */
function relativeIndex(index: unknown, length: number): number {
  const rel = toInteger(index);
  return rel >= 0 ? rel : length + rel;
}

function requireCallable(fn: unknown, method: string): void {
  if (typeof fn !== 'function') throw new TypeError(`${method}: ${String(fn)} is not a function`);
}

interface ArrayLikeOf<T> {
  readonly length: number;
  readonly [index: number]: T;
}

// --- ES2022: at() on arrays, strings and typed arrays ------------------------

function at<T>(this: ArrayLikeOf<T>, index: unknown): T | undefined {
  const k = relativeIndex(index, this.length >>> 0);
  return k < 0 || k >= this.length >>> 0 ? undefined : this[k];
}

define(Array.prototype, 'at', at);
define(String.prototype, 'at', function (this: unknown, index: unknown): string | undefined {
  const s = String(this);
  const k = relativeIndex(index, s.length);
  return k < 0 || k >= s.length ? undefined : s.charAt(k);
});
if (typeof Int8Array !== 'undefined') {
  // Every typed array inherits from the one %TypedArray%.prototype.
  define(Object.getPrototypeOf(Int8Array.prototype) as object, 'at', at);
}

// --- ES2023: findLast / findLastIndex on arrays --------------------------------
// (PrimJS has both on typed arrays only.)

type Predicate<T> = (value: T, index: number, array: ArrayLikeOf<T>) => unknown;

define(Array.prototype, 'findLast', function <T>(this: ArrayLikeOf<T>, predicate: Predicate<T>, thisArg?: unknown) {
  requireCallable(predicate, 'Array.prototype.findLast');
  for (let i = (this.length >>> 0) - 1; i >= 0; i--) {
    if (predicate.call(thisArg, this[i], i, this)) return this[i];
  }
  return undefined;
});
define(Array.prototype, 'findLastIndex', function <T>(this: ArrayLikeOf<T>, predicate: Predicate<T>, thisArg?: unknown) {
  requireCallable(predicate, 'Array.prototype.findLastIndex');
  for (let i = (this.length >>> 0) - 1; i >= 0; i--) {
    if (predicate.call(thisArg, this[i], i, this)) return i;
  }
  return -1;
});

// --- ES2023: copying array methods ---------------------------------------------
// `Array.from` copies holes as `undefined`, as the spec's versions do.

define(Array.prototype, 'toReversed', function <T>(this: ArrayLikeOf<T>): T[] {
  return Array.from(this).reverse();
});
define(Array.prototype, 'toSorted', function <T>(this: ArrayLikeOf<T>, compare?: (a: T, b: T) => number): T[] {
  if (compare !== undefined) requireCallable(compare, 'Array.prototype.toSorted');
  return Array.from(this).sort(compare);
});
define(Array.prototype, 'toSpliced', function <T>(this: ArrayLikeOf<T>, ...args: unknown[]): T[] {
  const copy = Array.from(this);
  if (args.length === 0) return copy;
  const start = toInteger(args[0]);
  if (args.length === 1) {
    copy.splice(start);
  } else {
    copy.splice(start, toInteger(args[1]), ...(args.slice(2) as T[]));
  }
  return copy;
});
define(Array.prototype, 'with', function <T>(this: ArrayLikeOf<T>, index: unknown, value: T): T[] {
  const length = this.length >>> 0;
  const k = relativeIndex(index, length);
  if (k < 0 || k >= length) throw new RangeError(`Array.prototype.with: index ${String(index)} out of range`);
  const copy = Array.from(this);
  copy[k] = value;
  return copy;
});

// --- ES2021: String.prototype.replaceAll -----------------------------------------

define(String.prototype, 'replaceAll', function (
  this: unknown,
  search: string | RegExp,
  replacement: string | ((substring: string, ...args: unknown[]) => string),
): string {
  const s = String(this);
  if (search instanceof RegExp) {
    // As specified: a non-global RegExp is an error, not a single replace.
    if (!search.global) throw new TypeError('String.prototype.replaceAll called with a non-global RegExp argument');
    return s.replace(search, replacement as string);
  }
  // A string pattern, escaped into a global RegExp. With no capture groups,
  // `$&`, `` $` `` and `$'` substitute exactly as in the spec, and `$1` stays
  // literal, as it does there.
  const pattern = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  return s.replace(pattern, replacement as string);
});

// --- ES2024: Object.groupBy / Map.groupBy -----------------------------------------

type KeyOf<T, K> = (item: T, index: number) => K;

define(Object, 'groupBy', function <T>(items: Iterable<T>, keyOf: KeyOf<T, PropertyKey>) {
  requireCallable(keyOf, 'Object.groupBy');
  const groups = Object.create(null) as Record<PropertyKey, T[]>;
  let index = 0;
  for (const item of items) {
    const key = keyOf(item, index++);
    const name = typeof key === 'symbol' ? key : String(key);
    if (groups[name as string]) groups[name as string].push(item);
    else groups[name as string] = [item];
  }
  return groups;
});
define(Map, 'groupBy', function <T, K>(items: Iterable<T>, keyOf: KeyOf<T, K>) {
  requireCallable(keyOf, 'Map.groupBy');
  const groups = new Map<K, T[]>();
  let index = 0;
  for (const item of items) {
    let key = keyOf(item, index++);
    // SameValueZero, as a Map key: -0 groups with +0.
    if ((key as unknown) === 0) key = 0 as K;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
});

// --- ES2024: Promise.withResolvers ------------------------------------------------

define(Promise, 'withResolvers', function <T>(this: PromiseConstructor) {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new this<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
});

const g = globalThis as Record<string, unknown>;

// ---------------------------------------------------------------------------
// PrimJS polyfills.
//
// Lynx's Background-Thread engine (PrimJS) lacks some Web/Node globals that
// Angular and our runtime use. This module is prepended to the background
// bundle, so these run before Angular is imported/bootstrapped.
//   - `performance`: Angular's performanceMarkFeature() (called from
//     provideZonelessChangeDetection) does performance.mark(...).
//   - `queueMicrotask`: our flush scheduler batches via queueMicrotask.
//   - `Object.hasOwn` (ES2022): `@angular/forms`' own compiled output calls it
//     from `ɵɵInheritDefinitionFeature` while *defining* one of its built-in
//     directives (module-load time, not template-driven) — confirmed on
//     device via `TypeError: Object.hasOwn is not a function` inside
//     `forms.mjs`, crashing `loadCard` before the app ever renders. Cast
//     through `Record<string, unknown>` since the package's `lib` (ES2020)
//     doesn't declare `Object.hasOwn` either.
// ---------------------------------------------------------------------------
if (typeof (g as { performance?: unknown }).performance === 'undefined') {
  g['performance'] = {
    now: () => Date.now(),
    mark: () => undefined,
    measure: () => undefined,
    getEntriesByName: () => [],
    getEntriesByType: () => [],
    clearMarks: () => undefined,
    clearMeasures: () => undefined,
  };
}
if (typeof (g as { queueMicrotask?: unknown }).queueMicrotask === 'undefined') {
  g['queueMicrotask'] = (cb: () => void): void => {
    Promise.resolve().then(cb);
  };
}
const objectCtor = Object as unknown as Record<string, unknown>;
if (typeof objectCtor['hasOwn'] === 'undefined') {
  objectCtor['hasOwn'] = (obj: object, prop: PropertyKey): boolean =>
    Object.prototype.hasOwnProperty.call(obj, prop);
}

// ---------------------------------------------------------------------------
// `Node` — the DOM interface, needed *only* for its numeric node-type
// constants.
//
// Angular's i18n runtime reads them off the bare global: `ɵɵi18nStart` →
// `applyCreateOpCodes` → `applyMutableOpCodes` calls
// `_locateOrCreateNode(lView, index, opCode, Node.TEXT_NODE)`. There is no DOM
// on either target — PrimJS has none, and the web preview's Background Thread
// is a Web Worker, which has no DOM interfaces either — so that read throws
// `ReferenceError: Node is not defined` and the render stops dead at the
// first `i18n`-attributed element, **with no error surfacing anywhere**
// (docs/35-i18n.md documented exactly that symptom live, root cause unknown
// at the time; this is it, reproduced headlessly by `verify:i18n-attr`).
//
// Only the constants are needed, so this is deliberately minimal — but it is
// a **class**, not a plain object, because `instanceof Node` appears in
// Angular's own code and `instanceof` against a non-callable throws. Nothing
// in this package ever produces a real DOM node, so `x instanceof Node` is
// correctly always `false`:
//   - `assertDomNode` is the main consumer, and all 8 of its call sites are
//     `ngDevMode && assertDomNode(...)` — dead code under our
//     `ngDevMode: false` define;
//   - the one production-reachable site, `isPropertyValid`, already special-
//     cases a missing `Node` (`typeof Node === 'undefined' || … ||
//     !(element instanceof Node)`) and reaches the identical result with this
//     polyfill installed, so adding it changes no existing behavior.
// Values are the standard DOM constants.
// ---------------------------------------------------------------------------
if (typeof (g as { Node?: unknown }).Node === 'undefined') {
  class NodePolyfill {
    static readonly ELEMENT_NODE = 1;
    static readonly TEXT_NODE = 3;
    static readonly COMMENT_NODE = 8;
    static readonly DOCUMENT_FRAGMENT_NODE = 11;
    /** Bitmask from `compareDocumentPosition`; read by Angular's DOM utils. */
    static readonly DOCUMENT_POSITION_CONTAINED_BY = 16;
  }
  g['Node'] = NodePolyfill;
}

// ---------------------------------------------------------------------------
// HttpClient (FetchBackend) polyfills.
//
// Angular's fetch backend calls `new TextDecoder()` for every response body
// and `new AbortController()` per request (confirmed against
// @angular/common@21's compiled output) — both are Web APIs beyond ES2019
// that PrimJS may not ship. Guarded, so engines that provide them natively
// (and the web preview's worker) are untouched.
//
//   - TextDecoder: UTF-8 only, one-shot decode with U+FFFD replacement. The
//     `stream` option is accepted but partial multi-byte sequences are not
//     buffered across calls — FetchBackend only streams for progress events;
//     final bodies are decoded in one shot, which this handles correctly.
//   - AbortController/AbortSignal: enough surface for FetchBackend's
//     cancellation path (`signal.aborted`, abort listeners, `throwIfAborted`).
//     A fetch implementation that ignores `signal` degrades to
//     non-cancellable requests rather than crashing.
// ---------------------------------------------------------------------------
if (typeof (g as { TextDecoder?: unknown }).TextDecoder === 'undefined') {
  g['TextDecoder'] = class TextDecoderPolyfill {
    readonly encoding = 'utf-8';
    decode(input?: ArrayBufferView | ArrayBuffer, _options?: { stream?: boolean }): string {
      if (!input) return '';
      const bytes =
        input instanceof Uint8Array
          ? input
          : ArrayBuffer.isView(input)
            ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
            : new Uint8Array(input);
      const n = bytes.length;
      let out = '';
      let i = 0;
      const cont = (k: number): boolean => k < n && (bytes[k]! & 0xc0) === 0x80;
      while (i < n) {
        const b0 = bytes[i++]!;
        let cp = 0xfffd; // replacement char for anything malformed
        if (b0 < 0x80) {
          cp = b0;
        } else if (b0 >= 0xc2 && b0 < 0xe0 && cont(i)) {
          cp = ((b0 & 0x1f) << 6) | (bytes[i++]! & 0x3f);
        } else if (b0 >= 0xe0 && b0 < 0xf0 && cont(i) && cont(i + 1)) {
          cp = ((b0 & 0x0f) << 12) | ((bytes[i]! & 0x3f) << 6) | (bytes[i + 1]! & 0x3f);
          i += 2;
          if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd; // lone surrogates are invalid
        } else if (b0 >= 0xf0 && b0 < 0xf5 && cont(i) && cont(i + 1) && cont(i + 2)) {
          cp =
            ((b0 & 0x07) << 18)
            | ((bytes[i]! & 0x3f) << 12)
            | ((bytes[i + 1]! & 0x3f) << 6)
            | (bytes[i + 2]! & 0x3f);
          i += 3;
          if (cp > 0x10ffff) cp = 0xfffd;
        }
        out += String.fromCodePoint(cp);
      }
      return out;
    }
  };
}
if (typeof (g as { AbortController?: unknown }).AbortController === 'undefined') {
  class AbortSignalPolyfill {
    aborted = false;
    reason: unknown = undefined;
    onabort: ((event: unknown) => void) | null = null;
    private readonly listeners = new Set<(event: unknown) => void>();
    addEventListener(type: string, listener: (event: unknown) => void): void {
      if (type === 'abort') this.listeners.add(listener);
    }
    removeEventListener(type: string, listener: (event: unknown) => void): void {
      if (type === 'abort') this.listeners.delete(listener);
    }
    throwIfAborted(): void {
      if (this.aborted) throw this.reason;
    }
    /** @internal */
    _fire(): void {
      const event = { type: 'abort', target: this };
      this.onabort?.(event);
      for (const listener of [...this.listeners]) listener(event);
    }
  }
  class AbortControllerPolyfill {
    readonly signal = new AbortSignalPolyfill();
    abort(reason?: unknown): void {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      this.signal.reason =
        reason !== undefined ? reason : new Error('signal is aborted without reason');
      this.signal._fire();
    }
  }
  g['AbortController'] = AbortControllerPolyfill;
  g['AbortSignal'] = AbortSignalPolyfill;
}

// ---------------------------------------------------------------------------
// `URL` and `URLSearchParams`.
//
// Lynx's Background Thread has a `URL`, but only its `href` works: `origin` and
// `pathname` are `undefined` (Explorer 4.2). Angular 22's `DefaultUrlSerializer`
// checks every URL with `new URL(url, base).origin` and treats a mismatch as unsafe,
// so on that `URL` every route serializes to `/` and the router skips the navigation,
// silently. So these test what's there rather than whether it exists.
//
// Follows the WHATWG URL standard for what apps pass around: absolute and relative
// URLs, dot segments, default ports, backslashes in special schemes, percent-encoding.
// It doesn't do IDNA or the IPv4 number forms (`http://0x7f.1`): a host is lowercased
// and kept. `verify:polyfills` compares it with Node's real `URL`.
// ---------------------------------------------------------------------------
const urlWorks = (): boolean => {
  try {
    const url = new (g['URL'] as typeof URL)('/b?c=1#d', 'http://a');
    return url.origin === 'http://a' && url.pathname === '/b' && url.search === '?c=1' && url.hash === '#d';
  } catch {
    return false;
  }
};
const urlSearchParamsWorks = (): boolean => {
  try {
    const params = new (g['URLSearchParams'] as typeof URLSearchParams)('a=1&b=2');
    return params.get('b') === '2' && params.toString() === 'a=1&b=2';
  } catch {
    return false;
  }
};
if (!urlWorks() || !urlSearchParamsWorks()) {
  const DEFAULT_PORTS: Record<string, string> = {
    'http:': '80',
    'https:': '443',
    'ws:': '80',
    'wss:': '443',
    'ftp:': '21',
    'file:': '',
  };
  const isSpecial = (protocol: string): boolean => protocol in DEFAULT_PORTS;

  /** Percent-encode the ASCII characters in `set`, controls, and everything non-ASCII. */
  const encodeSet = (input: string, set: string): string => {
    let out = '';
    for (const char of input) {
      const code = char.codePointAt(0)!;
      if (code > 0x7e) out += encodeURIComponent(char);
      else if (code < 0x20 || set.includes(char)) out += `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
      else out += char;
    }
    return out;
  };
  const PATH_SET = ' "#<>?`{}^';
  const QUERY_SET = ' "#<>';
  const SPECIAL_QUERY_SET = ` "#<>'`;
  const FRAGMENT_SET = ' "<>`';
  const USERINFO_SET = ' "#<>?`{}/:;=@[\\]^|';

  const isSingleDot = (segment: string): boolean => /^(\.|%2e)$/i.test(segment);
  const isDoubleDot = (segment: string): boolean => /^(\.|%2e){2}$/i.test(segment);

  const normalizePath = (path: string, special: boolean): string => {
    const input = special ? path.replace(/\\/g, '/') : path;
    const segments = input.split('/').slice(1);
    const out: string[] = [];
    segments.forEach((segment, index) => {
      const last = index === segments.length - 1;
      if (isDoubleDot(segment)) {
        out.pop();
        if (last) out.push('');
      } else if (isSingleDot(segment)) {
        if (last) out.push('');
      } else {
        out.push(encodeSet(segment, PATH_SET));
      }
    });
    return `/${out.join('/')}`;
  };

  class URLSearchParamsPolyfill {
    private list: [string, string][] = [];
    /** @internal Tells the owning URL that its query changed. */
    _onChange: (() => void) | undefined;

    constructor(init?: string | Iterable<[string, string]> | Record<string, string>) {
      if (typeof init === 'string') {
        this.list = URLSearchParamsPolyfill.parse(init);
      } else if (init && typeof (init as Iterable<[string, string]>)[Symbol.iterator] === 'function') {
        for (const [name, value] of init as Iterable<[string, string]>) this.list.push([String(name), String(value)]);
      } else if (init) {
        for (const name of Object.keys(init)) this.list.push([name, String((init as Record<string, string>)[name])]);
      }
    }

    private static decode(input: string): string {
      const spaced = input.replace(/\+/g, ' ');
      try {
        return decodeURIComponent(spaced);
      } catch {
        // A stray `%`: decode what's decodable, and keep the rest as it is.
        return spaced.replace(/(%[0-9a-f]{2})+/gi, (run) => {
          try {
            return decodeURIComponent(run);
          } catch {
            return run;
          }
        });
      }
    }

    private static parse(query: string): [string, string][] {
      const input = query.startsWith('?') ? query.slice(1) : query;
      const list: [string, string][] = [];
      for (const pair of input.split('&')) {
        if (pair === '') continue;
        const equals = pair.indexOf('=');
        const name = equals < 0 ? pair : pair.slice(0, equals);
        const value = equals < 0 ? '' : pair.slice(equals + 1);
        list.push([URLSearchParamsPolyfill.decode(name), URLSearchParamsPolyfill.decode(value)]);
      }
      return list;
    }

    /** @internal Replaces the list from a URL's query, without telling the URL. */
    _reset(query: string): void {
      this.list = URLSearchParamsPolyfill.parse(query);
    }

    get size(): number {
      return this.list.length;
    }
    append(name: string, value: string): void {
      this.list.push([String(name), String(value)]);
      this._onChange?.();
    }
    delete(name: string): void {
      this.list = this.list.filter((entry) => entry[0] !== name);
      this._onChange?.();
    }
    get(name: string): string | null {
      const found = this.list.find((entry) => entry[0] === name);
      return found ? found[1] : null;
    }
    getAll(name: string): string[] {
      return this.list.filter((entry) => entry[0] === name).map((entry) => entry[1]);
    }
    has(name: string): boolean {
      return this.list.some((entry) => entry[0] === name);
    }
    set(name: string, value: string): void {
      const index = this.list.findIndex((entry) => entry[0] === name);
      if (index < 0) {
        this.list.push([String(name), String(value)]);
      } else {
        this.list[index]![1] = String(value);
        this.list = this.list.filter((entry, i) => i <= index || entry[0] !== name);
      }
      this._onChange?.();
    }
    sort(): void {
      // `Array.prototype.sort` is stable, and compares by UTF-16 code unit as the standard asks.
      this.list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      this._onChange?.();
    }
    forEach(callback: (value: string, name: string, params: URLSearchParamsPolyfill) => void): void {
      for (const [name, value] of this.list) callback(value, name, this);
    }
    *entries(): IterableIterator<[string, string]> {
      for (const entry of this.list) yield [entry[0], entry[1]];
    }
    *keys(): IterableIterator<string> {
      for (const entry of this.list) yield entry[0];
    }
    *values(): IterableIterator<string> {
      for (const entry of this.list) yield entry[1];
    }
    [Symbol.iterator](): IterableIterator<[string, string]> {
      return this.entries();
    }
    toString(): string {
      const encode = (input: string): string =>
        encodeURIComponent(input)
          .replace(/[!'()~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
          .replace(/%20/g, '+');
      return this.list.map(([name, value]) => `${encode(name)}=${encode(value)}`).join('&');
    }
  }

  const invalid = (url: string): TypeError => new TypeError(`Invalid URL: ${url}`);

  class URLPolyfill {
    protocol = '';
    username = '';
    password = '';
    hostname = '';
    port = '';
    private opaque = false;
    private path = '';
    /** Without their `?` and `#`. `null` and empty differ only in `href`: `http://a/?`. */
    private query: string | null = null;
    private fragment: string | null = null;
    private params: URLSearchParamsPolyfill | undefined;

    constructor(url: string | { toString(): string }, base?: string | { toString(): string }) {
      const input = String(url);
      this.parse(input, base === undefined ? undefined : new URLPolyfill(base));
    }

    static canParse(url: string, base?: string): boolean {
      try {
        new URLPolyfill(url, base);
        return true;
      } catch {
        return false;
      }
    }

    private parse(raw: string, base: URLPolyfill | undefined): void {
      let rest = raw.replace(/^[\0-\x20]+|[\0-\x20]+$/g, '').replace(/[\t\n\r]/g, '');

      const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(rest);
      const protocol = scheme ? `${scheme[1]!.toLowerCase()}:` : base?.protocol;
      if (protocol === undefined || !base && !scheme) throw invalid(raw);
      const special = isSpecial(protocol);

      const hashAt = rest.indexOf('#');
      let fragment: string | undefined;
      if (hashAt >= 0) {
        fragment = rest.slice(hashAt + 1);
        rest = rest.slice(0, hashAt);
      }
      const queryAt = rest.indexOf('?');
      let query: string | undefined;
      if (queryAt >= 0) {
        query = rest.slice(queryAt + 1);
        rest = rest.slice(0, queryAt);
      }
      if (special) rest = rest.replace(/\\/g, '/');

      let hierarchical: string;
      // `http:foo` is relative to a base with the same scheme, and absolute otherwise.
      const relative = !scheme || (special && base?.protocol === protocol && !rest.slice(scheme[0].length).startsWith('/'));
      if (relative) {
        hierarchical = scheme ? rest.slice(scheme[0].length) : rest;
        if (base!.opaque && !(hierarchical === '' && query === undefined && fragment !== undefined)) throw invalid(raw);
      } else {
        hierarchical = rest.slice(scheme[0].length);
      }
      // A special scheme takes any number of slashes before its authority, so
      // `///evil.com` on an `http:` base is the host `evil.com`.
      if (special && protocol !== 'file:' && (!relative || hierarchical.startsWith('//'))) {
        hierarchical = `//${hierarchical.replace(/^\/*/, '')}`;
      }

      this.protocol = protocol;
      if (hierarchical.startsWith('//')) {
        const after = hierarchical.slice(2);
        const slash = after.indexOf('/');
        this.parseAuthority(slash < 0 ? after : after.slice(0, slash), raw, special);
        if (slash >= 0) this.path = normalizePath(after.slice(slash), special);
        else this.path = special ? '/' : '';
      } else if (relative) {
        this.username = base!.username;
        this.password = base!.password;
        this.hostname = base!.hostname;
        this.port = base!.port;
        this.opaque = base!.opaque;
        if (hierarchical.startsWith('/')) {
          this.path = normalizePath(hierarchical, special);
        } else if (hierarchical === '') {
          this.path = base!.path;
          if (query === undefined && base!.query !== null) query = base!.query;
        } else {
          const basePath = base!.path.slice(0, base!.path.lastIndexOf('/') + 1);
          this.path = normalizePath(`${basePath}${hierarchical}`, special);
        }
      } else if (hierarchical.startsWith('/')) {
        this.path = normalizePath(hierarchical, special);
      } else if (protocol === 'file:') {
        this.path = normalizePath(`/${hierarchical}`, special);
      } else {
        this.opaque = true;
        this.path = hierarchical;
      }

      this.query = query === undefined ? null : encodeSet(query, special ? SPECIAL_QUERY_SET : QUERY_SET);
      this.fragment = fragment === undefined ? null : encodeSet(fragment, FRAGMENT_SET);
      this.params?._reset(this.query ?? '');
    }

    private parseAuthority(authority: string, raw: string, special: boolean): void {
      const at = authority.lastIndexOf('@');
      const userinfo = at < 0 ? '' : authority.slice(0, at);
      const hostPort = at < 0 ? authority : authority.slice(at + 1);
      const colon = userinfo.indexOf(':');
      this.username = encodeSet(colon < 0 ? userinfo : userinfo.slice(0, colon), USERINFO_SET);
      this.password = colon < 0 ? '' : encodeSet(userinfo.slice(colon + 1), USERINFO_SET);

      const portMatch = /:(\d*)$/.exec(hostPort);
      const host = portMatch ? hostPort.slice(0, portMatch.index) : hostPort;
      if (!portMatch && /:[^\]]*$/.test(hostPort)) throw invalid(raw);
      if (host === '' && special && this.protocol !== 'file:') throw invalid(raw);
      if (/[\0-\x20#%/:<>?@\\^|]/.test(host.replace(/^\[.*\]$/, ''))) throw invalid(raw);
      this.hostname = special ? host.toLowerCase() : host;
      if (this.protocol === 'file:' && this.hostname === 'localhost') this.hostname = '';

      const port = portMatch ? portMatch[1]! : '';
      if (port !== '' && Number(port) > 65535) throw invalid(raw);
      const normalized = port === '' ? '' : String(Number(port));
      this.port = normalized === DEFAULT_PORTS[this.protocol] ? '' : normalized;
    }

    get host(): string {
      return this.port === '' ? this.hostname : `${this.hostname}:${this.port}`;
    }
    get origin(): string {
      return isSpecial(this.protocol) && this.protocol !== 'file:' ? `${this.protocol}//${this.host}` : 'null';
    }
    get pathname(): string {
      return this.path;
    }
    set pathname(value: string) {
      if (this.opaque) return;
      const special = isSpecial(this.protocol);
      const input = String(value);
      this.path = normalizePath(input.startsWith('/') || (special && input.startsWith('\\')) ? input : `/${input}`, special);
    }
    get search(): string {
      return this.query ? `?${this.query}` : '';
    }
    set search(value: string) {
      const input = String(value).replace(/^\?/, '');
      this.query = input === '' ? null : encodeSet(input, isSpecial(this.protocol) ? SPECIAL_QUERY_SET : QUERY_SET);
      this.params?._reset(this.query ?? '');
    }
    get hash(): string {
      return this.fragment ? `#${this.fragment}` : '';
    }
    set hash(value: string) {
      const input = String(value).replace(/^#/, '');
      this.fragment = input === '' ? null : encodeSet(input, FRAGMENT_SET);
    }
    get searchParams(): URLSearchParamsPolyfill {
      if (!this.params) {
        this.params = new URLSearchParamsPolyfill(this.query ?? '');
        this.params._onChange = () => {
          const query = this.params!.toString();
          this.query = query === '' ? null : query;
        };
      }
      return this.params;
    }
    get href(): string {
      const credentials = this.username || this.password
        ? `${this.username}${this.password ? `:${this.password}` : ''}@`
        : '';
      const authority = this.opaque || (!isSpecial(this.protocol) && this.hostname === '' && !credentials && this.port === '')
        ? ''
        : `//${credentials}${this.host}`;
      const query = this.query === null ? '' : `?${this.query}`;
      const fragment = this.fragment === null ? '' : `#${this.fragment}`;
      return `${this.protocol}${authority}${this.path}${query}${fragment}`;
    }
    set href(value: string) {
      const input = String(value);
      this.username = this.password = this.hostname = this.port = this.path = '';
      this.opaque = false;
      this.parse(input, undefined);
    }
    toString(): string {
      return this.href;
    }
    toJSON(): string {
      return this.href;
    }
  }

  if (!urlWorks()) g['URL'] = URLPolyfill;
  if (!urlSearchParamsWorks()) g['URLSearchParams'] = URLSearchParamsPolyfill;
}
