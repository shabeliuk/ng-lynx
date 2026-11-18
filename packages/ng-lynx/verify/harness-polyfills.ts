/**
 * Headless verification of `entry-background.ts`'s PrimJS polyfills
 * (`performance`, `queueMicrotask`, `Object.hasOwn`, `TextDecoder`,
 * `AbortController`, `Node`).
 *
 * Node already has all three natively, so just importing `entry-background`
 * here and having things "work" proves nothing — the polyfill assignments are
 * gated behind `typeof x === 'undefined'` and would silently never run. This
 * harness deletes each global *before* importing the module (simulating
 * PrimJS, which lacks them), then asserts the module installs a correctly
 * behaving replacement.
 *
 * `Object.hasOwn` specifically: confirmed missing on-device via
 * `TypeError: Object.hasOwn is not a function` thrown from inside
 * `@angular/forms`'s own compiled output (`ɵɵInheritDefinitionFeature`,
 * called while *defining* one of its built-in directives at module-load
 * time) — crashing `loadCard` before the app ever rendered. See
 * entry-background.ts's polyfill block.
 *
 * Run with: `npm run verify:polyfills`.
 */
import { EngineURL, NodeURL, NodeURLSearchParams } from './engine-globals.js';
import { assert } from './mock-papi.js';

const g = globalThis as Record<string, unknown>;

const realPerformance = g['performance'];
const realQueueMicrotask = g['queueMicrotask'];
const realHasOwn = (Object as unknown as Record<string, unknown>)['hasOwn'];
const realTextDecoder = g['TextDecoder'];
const realAbortController = g['AbortController'];
const realAbortSignal = g['AbortSignal'];
const realNode = g['Node'];

// `engine-globals` has already put the engine's partial `URL` in place, which is what
// the polyfill has to replace.
const RealURL = NodeURL;
const RealURLSearchParams = NodeURLSearchParams;

delete g['performance'];
delete g['queueMicrotask'];
delete (Object as unknown as Record<string, unknown>)['hasOwn'];
delete g['TextDecoder'];
delete g['AbortController'];
delete g['AbortSignal'];
delete g['Node'];

// The language built-ins PrimJS 3.8 lacks (read from its source; see
// runtime/src/es-polyfills.ts). Node 22 has them all, so remove them first.
const TypedArrayProto = Object.getPrototypeOf(Int8Array.prototype) as Record<string, unknown>;
const builtins: [Record<string, unknown>, string][] = [
  [Array.prototype as unknown as Record<string, unknown>, 'at'],
  [String.prototype as unknown as Record<string, unknown>, 'at'],
  [TypedArrayProto, 'at'],
  [Array.prototype as unknown as Record<string, unknown>, 'findLast'],
  [Array.prototype as unknown as Record<string, unknown>, 'findLastIndex'],
  [Array.prototype as unknown as Record<string, unknown>, 'toReversed'],
  [Array.prototype as unknown as Record<string, unknown>, 'toSorted'],
  [Array.prototype as unknown as Record<string, unknown>, 'toSpliced'],
  [Array.prototype as unknown as Record<string, unknown>, 'with'],
  [String.prototype as unknown as Record<string, unknown>, 'replaceAll'],
  [Object as unknown as Record<string, unknown>, 'groupBy'],
  [Map as unknown as Record<string, unknown>, 'groupBy'],
  [Promise as unknown as Record<string, unknown>, 'withResolvers'],
];
for (const [target, name] of builtins) delete target[name];

async function main(): Promise<void> {
  // Side-effecting import — this is what installs the polyfills.
  await import('ng-lynx/entry-background');

  console.log('\n=== PrimJS polyfills installed by entry-background.ts ===');

  assert(typeof g['performance'] === 'object', 'performance was installed');
  const perf = g['performance'] as { now(): number; mark(): void };
  assert(typeof perf.now() === 'number', 'performance.now() returns a number');
  perf.mark(); // must not throw — this is what provideZonelessChangeDetection calls

  assert(typeof g['queueMicrotask'] === 'function', 'queueMicrotask was installed');
  let ran = false;
  (g['queueMicrotask'] as (cb: () => void) => void)(() => {
    ran = true;
  });
  await Promise.resolve();
  assert(ran, 'the installed queueMicrotask actually schedules the callback');

  const hasOwn = (Object as unknown as Record<string, unknown>)['hasOwn'] as
    | ((o: object, v: PropertyKey) => boolean)
    | undefined;
  assert(typeof hasOwn === 'function', 'Object.hasOwn was installed');
  assert(hasOwn!({ a: 1 }, 'a') === true, "Object.hasOwn({a:1}, 'a') === true");
  assert(hasOwn!({ a: 1 }, 'b') === false, "Object.hasOwn({a:1}, 'b') === false");
  assert(
    hasOwn!(Object.create({ inherited: 1 }), 'inherited') === false,
    'Object.hasOwn does not walk the prototype chain (unlike `in`)',
  );

  // `Node` — only its numeric constants, read by Angular's i18n op-code
  // runtime. Without it `ɵɵi18nStart` throws `ReferenceError: Node is not
  // defined` and the render stops at the first `i18n`-attributed element
  // (docs/35-i18n.md); `verify:i18n-attr` covers the rendering itself.
  const NodePoly = g['Node'] as (Function & Record<string, number>) | undefined;
  assert(typeof NodePoly === 'function', 'Node was installed');
  assert(NodePoly!['ELEMENT_NODE'] === 1, 'Node.ELEMENT_NODE === 1');
  assert(NodePoly!['TEXT_NODE'] === 3, 'Node.TEXT_NODE === 3');
  assert(NodePoly!['COMMENT_NODE'] === 8, 'Node.COMMENT_NODE === 8');
  assert(
    (({} as unknown) instanceof (NodePoly as Function)) === false,
    'it is callable, so `x instanceof Node` evaluates (to false) instead of throwing',
  );

  // HttpClient (FetchBackend) polyfills — see runtime/src/http.ts for why.
  type TD = new () => { decode(b?: Uint8Array): string };
  const TextDecoderPoly = g['TextDecoder'] as TD | undefined;
  assert(typeof TextDecoderPoly === 'function', 'TextDecoder was installed');
  const decoder = new TextDecoderPoly!();
  assert(decoder.decode(new Uint8Array([72, 105])) === 'Hi', 'TextDecoder decodes ASCII');
  assert(
    decoder.decode(new Uint8Array([0xe2, 0x9c, 0x93])) === '✓',
    'TextDecoder decodes 3-byte UTF-8 (✓)',
  );
  assert(
    decoder.decode(new Uint8Array([0xf0, 0x9f, 0x98, 0x80])) === '\u{1f600}',
    'TextDecoder decodes 4-byte UTF-8 (😀, surrogate pair)',
  );
  assert(
    decoder.decode(new Uint8Array([0xff, 65])) === '�A',
    'TextDecoder replaces malformed bytes with U+FFFD',
  );
  assert(decoder.decode() === '', 'TextDecoder tolerates a missing argument');

  // Streaming: `lynxEventSource()` decodes each network chunk with
  // `{ stream: true }`, and a chunk can end in the middle of a character.
  type StreamTD = new () => { decode(b?: Uint8Array, o?: { stream?: boolean }): string };
  const text = 'Hi ✓ 😀 Привіт, ще трохи тексту ✓✓ 😀😀 end';
  const encoded = new TextEncoder().encode(text);
  let everySplitWhole = true;
  for (let cut = 0; cut <= encoded.length; cut++) {
    const streaming = new (TextDecoderPoly as unknown as StreamTD)();
    const joined =
      streaming.decode(encoded.subarray(0, cut), { stream: true })
      + streaming.decode(encoded.subarray(cut), { stream: true })
      + streaming.decode();
    if (joined !== text) everySplitWhole = false;
  }
  assert(everySplitWhole, 'with { stream: true }, a character split between two chunks at any byte stays whole');
  const byteByByte = new (TextDecoderPoly as unknown as StreamTD)();
  let oneAtATime = '';
  for (const byte of encoded) oneAtATime += byteByByte.decode(new Uint8Array([byte]), { stream: true });
  assert(oneAtATime + byteByByte.decode() === text, 'with { stream: true }, one byte per chunk decodes the same text');
  const cutShort = new (TextDecoderPoly as unknown as StreamTD)();
  cutShort.decode(new Uint8Array([0xe2, 0x9c]), { stream: true });
  assert(cutShort.decode() === '\ufffd', 'a stream that ends mid-character ends in U+FFFD');
  // Malformed input gives the same U+FFFDs as Node's own decoder, which follows
  // the same standard.
  const NativeTD = realTextDecoder as new () => { decode(b: Uint8Array): string };
  let seed = 11;
  const random = (n: number): number => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  let matchesNative = true;
  for (let t = 0; t < 3000 && matchesNative; t++) {
    const sample = new Uint8Array(random(12));
    for (let k = 0; k < sample.length; k++) sample[k] = [random(256), 0x80 + random(64), 0xe0 + random(21)][random(3)]!;
    if (new TextDecoderPoly!().decode(sample) !== new NativeTD().decode(sample)) matchesNative = false;
  }
  assert(matchesNative, "3,000 random byte strings, valid and not, decode as Node's TextDecoder does");
  const big = 'ab✓😀'.repeat(20000);
  assert(new TextDecoderPoly!().decode(new TextEncoder().encode(big)) === big, 'a 200 kB body decodes whole');

  type AC = new () => {
    signal: {
      aborted: boolean;
      reason: unknown;
      addEventListener(t: string, l: () => void): void;
      throwIfAborted(): void;
    };
    abort(reason?: unknown): void;
  };
  const AbortControllerPoly = g['AbortController'] as AC | undefined;
  assert(typeof AbortControllerPoly === 'function', 'AbortController was installed');
  const controller = new AbortControllerPoly!();
  assert(controller.signal.aborted === false, 'signal starts non-aborted');
  let abortFired = false;
  controller.signal.addEventListener('abort', () => {
    abortFired = true;
  });
  controller.abort('cancelled');
  assert(controller.signal.aborted === true, 'abort() flips signal.aborted');
  assert(controller.signal.reason === 'cancelled', 'abort(reason) is exposed on the signal');
  assert(abortFired, "the 'abort' listener fired");
  let threw = false;
  try {
    controller.signal.throwIfAborted();
  } catch {
    threw = true;
  }
  assert(threw, 'throwIfAborted() throws once aborted');

  console.log('\n=== Language built-ins PrimJS 3.8 lacks (es-polyfills.ts) ===');
  for (const [target, name] of builtins) {
    assert(typeof target[name] === 'function', `${name} was installed`);
  }
  assert(
    !Object.keys(Object.getOwnPropertyDescriptors(Array.prototype)).some(
      (k) => k === 'at' && Object.getOwnPropertyDescriptor(Array.prototype, 'at')!.enumerable,
    ),
    'installed non-enumerable, like a built-in (for…in over an array skips it)',
  );
  // Called through a loose type: the package's lib (ES2020) doesn't declare them.
  type Loose = Record<string, (...args: unknown[]) => unknown>;
  const arr = [1, 2, 3, 4] as unknown as Loose;
  assert(arr['at']!(-1) === 4, '[1,2,3,4].at(-1) === 4');
  assert(arr['at']!(0) === 1 && arr['at']!(9) === undefined, 'at(0) / at(out of range)');
  assert(arr['at']!('1') === 2 && arr['at']!(NaN) === 1, 'at() coerces its index like the spec');
  assert(('héllo' as unknown as Loose)['at']!(-1) === 'o', "'héllo'.at(-1) === 'o'");
  assert((new Uint8Array([7, 8, 9]) as unknown as Loose)['at']!(-1) === 9, 'Uint8Array.at(-1) === 9');

  const isEven = (n: unknown) => (n as number) % 2 === 0;
  assert(arr['findLast']!(isEven) === 4, 'findLast(isEven) === 4');
  assert(arr['findLastIndex']!(isEven) === 3, 'findLastIndex(isEven) === 3');
  assert(arr['findLastIndex']!((n: unknown) => (n as number) > 9) === -1, 'findLastIndex with no match === -1');

  const source = [3, 1, 2];
  const sourceLoose = source as unknown as Loose;
  assert(String(sourceLoose['toSorted']!()) === '1,2,3', 'toSorted() sorts a copy');
  assert(String(sourceLoose['toReversed']!()) === '2,1,3', 'toReversed() reverses a copy');
  assert(String(sourceLoose['toSpliced']!(1, 1, 'x', 'y')) === '3,x,y,2', 'toSpliced(1, 1, x, y)');
  assert(String(sourceLoose['toSpliced']!(1)) === '3', 'toSpliced(start) removes to the end');
  assert(String(sourceLoose['with']!(-1, 9)) === '3,1,9', 'with(-1, 9)');
  assert(String(source) === '3,1,2', 'none of them touched the original array');
  let rangeError = false;
  try {
    sourceLoose['with']!(5, 0);
  } catch (e) {
    rangeError = e instanceof RangeError;
  }
  assert(rangeError, 'with() out of range throws RangeError');

  const str = 'a.b.c' as unknown as Loose;
  assert(str['replaceAll']!('.', '-') === 'a-b-c', "'a.b.c'.replaceAll('.', '-') escapes the pattern");
  assert(str['replaceAll']!(/b/g, 'B') === 'a.B.c', 'replaceAll with a global RegExp');
  assert(('ab' as unknown as Loose)['replaceAll']!('', '_') === '_a_b_', "replaceAll('') inserts between every character");
  assert(('aa' as unknown as Loose)['replaceAll']!('a', '[$&]') === '[a][a]', 'replaceAll keeps $& substitution');
  let typeError = false;
  try {
    str['replaceAll']!(/b/, 'B');
  } catch (e) {
    typeError = e instanceof TypeError;
  }
  assert(typeError, 'replaceAll with a non-global RegExp throws TypeError, as specified');

  const groupBy = (Object as unknown as Loose)['groupBy']!;
  const byParity = groupBy([1, 2, 3, 4], (n: unknown) => ((n as number) % 2 ? 'odd' : 'even')) as Record<string, number[]>;
  assert(String(byParity['odd']) === '1,3' && String(byParity['even']) === '2,4', 'Object.groupBy groups by key');
  assert(Object.getPrototypeOf(byParity) === null, 'Object.groupBy returns a null-prototype object');
  const mapGroups = (Map as unknown as Loose)['groupBy']!([1, 2, 3], (n: unknown) => (n as number) > 1) as Map<boolean, number[]>;
  assert(String(mapGroups.get(true)) === '2,3' && String(mapGroups.get(false)) === '1', 'Map.groupBy groups by key');

  const { promise, resolve } = (Promise as unknown as Loose)['withResolvers']!() as {
    promise: Promise<string>;
    resolve: (v: string) => void;
  };
  resolve('done');
  assert((await promise) === 'done', 'Promise.withResolvers() resolves from outside');

  console.log('\n=== URL matches the real one ===');
  const PolyURL = g['URL'] as typeof URL;
  assert((PolyURL as unknown) !== EngineURL && PolyURL !== RealURL, 'the polyfill replaced the engine\'s partial URL');
  const fields = ['href', 'origin', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'] as const;
  const describe = (Ctor: typeof URL, input: string, base?: string): string => {
    try {
      const url = new Ctor(input, base);
      return JSON.stringify(fields.map((field) => url[field]));
    } catch {
      return 'throws';
    }
  };
  const cases: [string, string?][] = [
    ...[
      'http://fake/users', 'https://Example.COM:443/a/b?x=1#y', 'http://example.com:8080', 'http://example.com',
      'HTTP://EXAMPLE.com/A', 'http://user:pa%20ss@example.com/', 'http://user@example.com/', 'http://a/b/../c/./d',
      'http://a/b/%2e%2E/c', 'http://a/b/..', 'http://a/b/.', 'http://a/?', 'http://a/#', 'http://a/?#',
      'http://a/p a?q r#f g', 'http://a/é?é#é', "http://a/?it's", 'http:/a/b', 'http:a/b', 'http:///a',
      'http:\\\\a\\b', 'ws://a:80/', 'wss://a:443/', 'ftp://a:21/x', 'file:///a/b', 'file:///a/../b',
      'file://localhost/a', 'mailto:me@example.com', 'data:text/plain,hi', 'foo://bar/baz/../q', 'foo://bar', 'foo:/x',
      'about:blank', 'lynx://open?url=1', 'http://[::1]:3000/', 'http://a:b/', 'http://a:99999/', 'http://', 'http:// a/',
      '', 'nope', '/relative', '//x', '  http://a/  ', 'ht\ntp://a/\tb',
    ].map((input): [string] => [input]),
    ...[
      '/users', '/users/1?x=2#h', '//evil.com', '///evil.com', '/\\evil.com', '\\\\evil.com', '/', '/a//b', '//', 'https://other/',
      'javascript:alert(1)', '?q=1', '#f', '', 'x', '../x', './x', 'http:foo', 'https:foo', '/(a:b)', '/a;x=1', '/a:b',
      '/%2F%2Fevil.com', '/\t/evil.com',
    ].map((input): [string, string] => [input, 'http://fake']),
    ...['d', '../d', '../../../d', './', '..', '', '?x', '#x', '/z', 'http:d', '//k/z'].map((input): [string, string] => [input, 'http://h/a/b/c?q=1#f']),
    ...['#y', 'z', ''].map((input): [string, string] => [input, 'mailto:x']),
    ...['c', '/d', '//k/e'].map((input): [string, string] => [input, 'foo://h/a/b']),
    ['c', 'foo:/a/b'],
  ];
  const mismatches = cases.filter(([input, base]) => describe(PolyURL, input, base) !== describe(RealURL, input, base));
  for (const [input, base] of mismatches) {
    console.log(`  ${JSON.stringify(input)} on ${base}\n    real ${describe(RealURL, input, base)}\n    ours ${describe(PolyURL, input, base)}`);
  }
  assert(mismatches.length === 0, `${cases.length} URLs parse as the real URL does`);

  const url = new PolyURL('http://a/b?x=1&y=2#h');
  url.searchParams.set('x', '9');
  url.searchParams.append('z', 'a b');
  assert(url.search === '?x=9&y=2&z=a+b', 'searchParams changes the URL');
  url.search = '?q=2';
  assert(url.searchParams.get('q') === '2' && !url.searchParams.has('x'), 'search changes searchParams');
  url.pathname = 'c/../d';
  url.hash = 'e';
  assert(url.href === 'http://a/d?q=2#e', 'pathname and hash setters normalize');
  assert(JSON.stringify({ url }) === '{"url":"http://a/d?q=2#e"}' && String(url) === url.href, 'it serializes as its href');
  assert(PolyURL.canParse('http://a') && !PolyURL.canParse('nope'), 'URL.canParse');

  console.log('\n=== URLSearchParams matches the real one ===');
  const PolyParams = g['URLSearchParams'] as typeof URLSearchParams;
  const paramsCases = ['a=1&b=2&a=3', '?x=%20y+z', 'a&b=', 'bad=%zz', 'é=ü', "s=!'()~*-._", '&&a=1&', 'c=3&a=2&b=1'];
  const describeParams = (Ctor: typeof URLSearchParams, input: string): string => {
    const params = new Ctor(input);
    const before = [params.toString(), [...params], params.getAll('a'), params.get('a'), params.has('b'), params.size];
    params.sort();
    const sorted = params.toString();
    params.set('a', 'new');
    params.delete('b');
    return JSON.stringify([before, sorted, params.toString()]);
  };
  const paramsMismatches = paramsCases.filter((input) => describeParams(PolyParams, input) !== describeParams(RealURLSearchParams, input));
  for (const input of paramsMismatches) {
    console.log(`  ${JSON.stringify(input)}\n    real ${describeParams(RealURLSearchParams, input)}\n    ours ${describeParams(PolyParams, input)}`);
  }
  assert(paramsMismatches.length === 0, `${paramsCases.length} queries behave as the real URLSearchParams does`);
  assert(new PolyParams({ a: '1' }).toString() === 'a=1' && new PolyParams([['a', '1']]).toString() === 'a=1', 'it takes an object or pairs');

  console.log('\n✅ All PrimJS polyfill assertions passed.\n');
}

main()
  .catch((err) => {
    console.error('\n❌ Polyfill verification failed:\n', err);
    process.exit(1);
  })
  .finally(() => {
    // Restore Node's real globals so nothing downstream in the same process is affected.
    if (realPerformance !== undefined) g['performance'] = realPerformance;
    if (realQueueMicrotask !== undefined) g['queueMicrotask'] = realQueueMicrotask;
    if (realHasOwn !== undefined) (Object as unknown as Record<string, unknown>)['hasOwn'] = realHasOwn;
    if (realTextDecoder !== undefined) g['TextDecoder'] = realTextDecoder;
    if (realAbortController !== undefined) g['AbortController'] = realAbortController;
    if (realAbortSignal !== undefined) g['AbortSignal'] = realAbortSignal;
    g['URL'] = RealURL;
    g['URLSearchParams'] = RealURLSearchParams;
  g['Node'] = realNode;
  });
