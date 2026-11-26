/**
 * Headless verification of `fetchBundle` (runtime/src/fetch-bundle.ts) and of
 * `loadDynamicComponent(source, { fetcher: 'fetch-bundle' })`, against a mock of
 * `lynx.fetchBundle` / `lynx.loadScript`.
 *
 * The mock has the two shapes the engines have, read from `@lynx-js/types` and
 * web-core's implementation:
 *
 * - a device returns a handler: `then(callback)` takes one callback and returns
 *   nothing, `wait(seconds)` blocks, and the result is `{ url, code, error_msg }`;
 * - the web preview returns a Promise of `{ url, code, errorMsg }`, and has no `wait`.
 *
 * What the Android engine does with a bundle that 404s (it never calls back) was
 * measured on Explorer 4.2, and is what the timeout cases stand in for; the
 * `bundle` device flow runs the real thing.
 *
 * Run with: `npm run verify:fetch-bundle`.
 */
import 'ng-lynx/main-thread';

import {
  fetchBundle,
  hasFetchBundle,
  loadBundleScript,
  loadDynamicComponent,
  LynxBundleError,
  ɵresetFetchedBundles,
} from 'ng-lynx';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

interface Result {
  url?: string;
  code?: number;
  error_msg?: string;
  errorMsg?: string;
}

type Handler = { then: (cb: (r: Result) => void) => void; wait?: (seconds: number) => Result };

const g = globalThis as { lynx?: unknown; globDynamicComponentEntry?: string };
const calls: string[] = [];
const lepusCalls: { method: string; params: unknown }[] = [];
const scripts: { section: string; bundleName: string | undefined; entry: string | undefined; self: unknown }[] = [];
let answer: (url: string) => Handler = () => ({ then: () => {} });
let sections: Record<string, () => unknown> = {};

function installEngine(extra: Record<string, unknown> = {}): void {
  const lynx = {
    fetchBundle(url: string): Handler {
      calls.push(url);
      return answer(url);
    },
    loadScript(section: string, options?: { bundleName?: string }): unknown {
      scripts.push({ section, bundleName: options?.bundleName, entry: g.globDynamicComponentEntry, self: this });
      const load = sections[section];
      if (!load) throw new Error(`no section "${section}"`);
      return load();
    },
    getNativeApp: () => ({
      callLepusMethod(method: string, params: unknown, callback: () => void): void {
        lepusCalls.push({ method, params });
        callback();
      },
    }),
    ...extra,
  };
  g.lynx = lynx;
}

/** What a device answers: a handler whose callback runs on the next tick. */
function device(result: (url: string) => Result): (url: string) => Handler {
  return (url) => ({
    then: (cb) => void setTimeout(() => cb(result(url)), 1),
    wait: () => result(url),
  });
}

/** What the web preview answers: a Promise. */
function web(result: (url: string) => Result): (url: string) => Handler {
  return (url) => Promise.resolve(result(url)) as unknown as Handler;
}

function reset(): void {
  ɵresetFetchedBundles();
  calls.length = 0;
  lepusCalls.length = 0;
  scripts.length = 0;
  sections = {};
  installEngine();
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

const OK = (url: string): Result => ({ url, code: 0, error_msg: '' });

console.log('\n=== A device: success ===');
reset();
answer = device(OK);
{
  const bundle = await fetchBundle('http://host/a.lynx.bundle');
  assert(bundle.name === 'http://host/a.lynx.bundle', "the bundle's name is the url the engine reported");
  sections['background'] = () => ({ default: 'exports' });
  assert(
    (bundle.loadScript('background') as { default: string }).default === 'exports',
    'bundle.loadScript(section) returns what lynx.loadScript returns',
  );
  assert(
    scripts[0]?.section === 'background' && scripts[0].bundleName === bundle.name,
    'and asks for the section by the bundle name',
  );
  assert(scripts[0]?.self === g.lynx, 'lynx.loadScript is called on lynx, as a method');
  assert(
    loadBundleScript('background', bundle.name) !== undefined && scripts.length === 2,
    'loadBundleScript(section, name) is the same call',
  );
}

console.log('\n=== A bundle is fetched once ===');
reset();
answer = device(OK);
{
  const [first, second] = await Promise.all([fetchBundle('http://host/b.bundle'), fetchBundle('http://host/b.bundle')]);
  assert(first === second && calls.length === 1, 'two calls at once share one engine request');
  const third = await fetchBundle('http://host/b.bundle');
  assert(third === first && calls.length === 1, 'a later call returns the same result without asking the engine');
  await fetchBundle('http://host/b.bundle?v=2');
  assert(calls.length === 2, 'another url is another fetch');
}

console.log('\n=== A device: failure ===');
reset();
answer = device((url) => ({ url, code: 160102, error_msg: 'Load lazy bundle failed: template binary is empty' }));
{
  const error = await rejection(fetchBundle('http://host/c.bundle'));
  assert(error instanceof LynxBundleError, 'a non-zero code rejects with a LynxBundleError');
  const e = error as LynxBundleError;
  assert(e.code === 160102 && e.bundleUrl === 'http://host/c.bundle', 'with the engine code and the bundle url');
  assert(e.message.includes('template binary is empty') && e.message.includes('160102'), 'and the engine words in the message');
  answer = device(OK);
  const bundle = await fetchBundle('http://host/c.bundle');
  assert(bundle.name === 'http://host/c.bundle' && calls.length === 2, 'a failure is not remembered: the next call asks again');
}

console.log('\n=== The web preview: a Promise, errorMsg ===');
reset();
answer = web(OK);
{
  const bundle = await fetchBundle('http://host/d.web.bundle');
  assert(bundle.name === 'http://host/d.web.bundle', 'a Promise handler resolves through then(callback) too');
  answer = web((url) => ({ url, code: -1, errorMsg: 'Invalid Magic Header' }));
  const error = (await rejection(fetchBundle('http://host/e.web.bundle'))) as LynxBundleError;
  assert(error.code === -1 && error.message.includes('Invalid Magic Header'), 'a failure reads errorMsg, not error_msg');
  const sync = (await rejection(fetchBundle('http://host/f.web.bundle', { sync: true }))) as LynxBundleError;
  assert(
    sync instanceof LynxBundleError && /synchronous/.test(sync.message),
    'sync: true says it has no synchronous form here, instead of calling wait',
  );
}

console.log('\n=== A silent engine ===');
reset();
answer = () => ({ then: () => {} });
{
  const started = Date.now();
  const error = (await rejection(fetchBundle('http://host/g.bundle', { timeout: 0.05 }))) as LynxBundleError;
  assert(error instanceof LynxBundleError && error.code === -1, 'no answer in time rejects with code -1');
  assert(/did not answer within 0\.05 seconds/.test(error.message), 'and says how long it waited');
  assert(Date.now() - started < 1000, 'after that time, not the 30 s default');
  answer = device(OK);
  assert((await fetchBundle('http://host/g.bundle')).name === 'http://host/g.bundle', 'the next call tries again');
  answer = (url) => ({ then: (cb) => void setTimeout(() => cb(OK(url)), 120) });
  const slow = await fetchBundle('http://host/h.bundle', { timeout: 0 });
  assert(slow.name === 'http://host/h.bundle', 'timeout: 0 waits for as long as the engine takes');
}

console.log('\n=== A synchronous fetch ===');
reset();
{
  const waits: number[] = [];
  answer = (url) => ({
    then: () => {},
    wait: (seconds) => {
      waits.push(seconds);
      return OK(url);
    },
  });
  const bundle = await fetchBundle('http://host/i.bundle', { sync: true });
  assert(bundle.name === 'http://host/i.bundle' && waits[0] === 5, 'wait() gets 5 seconds by default');
  await fetchBundle('http://host/j.bundle', { sync: true, timeout: 2 });
  assert(waits[1] === 2, 'and the timeout it is given');
  answer = (url) => ({ then: () => {}, wait: () => ({ url, code: 160101, error_msg: 'timed out' }) });
  const error = (await rejection(fetchBundle('http://host/k.bundle', { sync: true }))) as LynxBundleError;
  assert(error.code === 160101, "the engine's non-zero code on a timeout rejects");
}

console.log('\n=== No engine support ===');
reset();
g.lynx = {};
{
  assert(!hasFetchBundle(), 'hasFetchBundle() is false without lynx.fetchBundle');
  const error = (await rejection(fetchBundle('http://host/l.bundle'))) as LynxBundleError;
  assert(error instanceof LynxBundleError && /not available/.test(error.message), 'fetchBundle says so');
  let threw = '';
  try {
    loadBundleScript('background', 'x');
  } catch (e) {
    threw = (e as Error).message;
  }
  assert(/lynx\.loadScript is not available/.test(threw), 'and so does loadBundleScript');
  reset();
  answer = device(OK);
  assert(hasFetchBundle(), 'hasFetchBundle() is true with it');
  g.lynx = { getNativeLynx: () => ({ fetchBundle: (url: string) => device(OK)(url) }) };
    assert(hasFetchBundle(), 'also through getNativeLynx(), where lynx.fetchBundle is wired from');
  reset();
  answer = () => {
    throw new Error('Dispatch failed');
  };
  const thrown = (await rejection(fetchBundle('http://host/m.bundle'))) as LynxBundleError;
  assert(thrown instanceof LynxBundleError && /Dispatch failed/.test(thrown.message), 'a throw from the engine is a rejection');
}

console.log("\n=== loadDynamicComponent(source, { fetcher: 'fetch-bundle' }) ===");
reset();
answer = device(OK);
class Card {}
sections['background'] = () => ({ default: Card, Card });
{
  const source = 'http://host/card.lynx.bundle';
  const mod = await loadDynamicComponent<typeof Card>(source, { fetcher: 'fetch-bundle' });
  assert(mod.default === Card, "it resolves the background section's exports, with the component as default");
  assert(scripts.length === 1 && scripts[0]!.section === 'background', 'it read the "background" section');
  assert(scripts[0]!.entry === source, 'with globDynamicComponentEntry set to the source while the bundle ran');
  assert(g.globDynamicComponentEntry === undefined, 'and put back afterwards');
  const again = await loadDynamicComponent<typeof Card>(source, { fetcher: 'fetch-bundle' });
  assert(again === mod && scripts.length === 1 && calls.length === 1, 'a second load is the same module, with no fetch and no evaluation');

  const bad = 'http://host/failing.lynx.bundle';
  answer = device((url) => ({ url, code: 160103, error_msg: 'Decode error' }));
  const error = (await rejection(loadDynamicComponent(bad, { fetcher: 'fetch-bundle' }))) as LynxBundleError;
  assert(error instanceof LynxBundleError && error.code === 160103, 'a failed fetch rejects with its LynxBundleError');

  answer = device(OK);
  sections['background'] = () => {
    throw new Error('no such section');
  };
  const wrong = (await rejection(loadDynamicComponent('http://host/wrong.lynx.bundle', { fetcher: 'fetch-bundle' }))) as Error;
  assert(
    /could not read its "background" section/.test(wrong.message) && /dynamicComponentFetcher: 'fetch-bundle'/.test(wrong.message),
    "a bundle of the other format says what it was built wrong, naming the plugin option",
  );
  assert(g.globDynamicComponentEntry === undefined, 'and the global is put back after a throw');

  sections['background'] = () => undefined;
  const empty = (await rejection(loadDynamicComponent('http://host/empty.lynx.bundle', { fetcher: 'fetch-bundle' }))) as Error;
  assert(/exported nothing/.test(empty.message), 'a section that exports nothing is named');
}

console.log("\n=== The bundle's own stylesheet ===");
reset();
answer = device(OK);
sections['background'] = () => ({ default: Card });
{
  const bundle = await fetchBundle('http://host/styled.lynx.bundle');
  assert(lepusCalls.length === 0, 'fetching a bundle applies no stylesheet by itself');
  bundle.adoptStyleSheet();
  bundle.adoptStyleSheet();
  const adoptCalls = lepusCalls.filter((c) => c.method === 'ngAdoptStyleSheet');
  assert(adoptCalls.length === 1, 'adoptStyleSheet() asks the Main Thread once per bundle');
  assert(
    (adoptCalls[0]!.params as { bundleName: string }).bundleName === 'http://host/styled.lynx.bundle',
    'for that bundle, by name',
  );

  reset();
  answer = device(OK);
  sections['background'] = () => ({ default: Card });
  await loadDynamicComponent('http://host/styled-card.lynx.bundle', { fetcher: 'fetch-bundle' });
  assert(
    lepusCalls.some((c) => c.method === 'ngAdoptStyleSheet'),
    'loadDynamicComponent adopts it before it resolves, so the component is created styled',
  );
  const before = lepusCalls.length;
  await loadDynamicComponent('http://host/styled-card.lynx.bundle', { fetcher: 'fetch-bundle' });
  assert(lepusCalls.length === before, 'and a second load does not do it again');

  reset();
  answer = device((url) => ({ url, code: 160103, error_msg: 'Decode error' }));
  await rejection(loadDynamicComponent('http://host/styled-bad.lynx.bundle', { fetcher: 'fetch-bundle' }));
  assert(!lepusCalls.some((c) => c.method === 'ngAdoptStyleSheet'), 'a bundle that failed to load adopts nothing');
}

console.log('\n=== The default packaging adopts the CSS section too ===');
{
  reset();
  const query = (source: string, callback: (r: unknown) => void): void => {
    callback({ code: 0, data: { url: source }, detail: { schema: `${source}#schema` } });
  };
  (g.lynx as Record<string, unknown>)['QueryComponent'] = query;
  const inject = globalThis as Record<string, unknown>;
  inject['lynxCoreInject'] = { tt: { getDynamicComponentExports: () => ({ default: Card }) } };
  const mod = await loadDynamicComponent<typeof Card>('http://host/q.lynx.bundle');
  assert(mod.default === Card, 'a QueryComponent bundle still resolves its exports');
  const adoptCalls = lepusCalls.filter((c) => c.method === 'ngAdoptStyleSheet');
  assert(adoptCalls.length === 1, 'and its CSS section is adopted, before it resolves');
  assert(
    (adoptCalls[0]!.params as { bundleName: string }).bundleName === 'http://host/q.lynx.bundle#schema',
    "under the name the engine gave the bundle (the schema, which is what exports are read by)",
  );
  delete inject['lynxCoreInject'];
}

console.log('\n=== The Main Thread applies the CSS section ===');
{
  const m = globalThis as Record<string, unknown>;
  const adopt = m['ngAdoptStyleSheet'] as (params: { bundleName: string; section?: string }) => void;
  assert(typeof adopt === 'function', 'the Main-Thread entry registers ngAdoptStyleSheet');
  const loads: [string, string][] = [];
  const adopted: unknown[] = [];
  m['__LoadStyleSheet'] = (section: string, bundleName: string) => {
    loads.push([section, bundleName]);
    return bundleName.endsWith('none') ? null : { sheet: bundleName };
  };
  m['__AdoptStyleSheet'] = (sheet: unknown) => void adopted.push(sheet);
  adopt({ bundleName: 'http://host/a.bundle' });
  assert(
    loads[0]?.[0] === 'CSS' && loads[0][1] === 'http://host/a.bundle' && adopted.length === 1,
    "it loads the bundle's 'CSS' section and adopts what it returns",
  );
  adopt({ bundleName: 'http://host/none' });
  assert(adopted.length === 1, 'a bundle with no CSS (null) adopts nothing');
  delete m['__LoadStyleSheet'];
  delete m['__AdoptStyleSheet'];
  adopt({ bundleName: 'http://host/b.bundle' });
  assert(adopted.length === 1, 'an engine without the two calls (the web preview) is left alone, with no error');
}

console.log('\n✅ fetch-bundle verified.\n');
