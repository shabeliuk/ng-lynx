/**
 * Load a **real, separately-built dynamic-component bundle** into a real
 * host app and mount it — the runtime half of `verify:dynamic-component-build`
 * (the build + static assertions live in `dynamic-component-build.mjs`, which
 * runs this).
 *
 * This is the proof that the producer build mode actually produces something
 * loadable, rather than just something that compiles: the artifact under test
 * is the genuine `rspeedy build` output for `examples/dynamic-component`'s
 * producer config — runtime-wrapped for the device (`tt.define`/`tt.require`),
 * with `@angular/core` and `ng-lynx/elements` externalized to the shared
 * registry — and it is evaluated here exactly the way the engine evaluates
 * it: by calling the wrapper's factory with `(require, module, exports,
 * …injected globals)`, `lynx` among them.
 *
 * The host side is a normal ng-lynx app on the mock PAPI which
 * publishes its own module namespaces first (what
 * `pluginAngularLynx({ dynamicComponentHost: true })` generates a module to
 * do in a real build). If the sharing didn't work, the loaded component would
 * carry its own Angular and fail with `NG0203` — the exact failure documented
 * in docs/38-dynamic-component.md.
 *
 * Env: `DYNAMIC_BUNDLE_JS` — path to the built background chunk.
 */
import '@angular/compiler';

import * as angularCore from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  type Type,
  ViewChild,
  ViewContainerRef,
} from '@angular/core';

import { readFileSync } from 'node:fs';

import { bootstrapLynxApplication, publishSharedModule } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import * as angularLynx from 'ng-lynx';
import * as angularLynxElements from 'ng-lynx/elements';
import 'ng-lynx/main-thread';

import { assert, findByClass, findText, getPage, installMockPapi, tick } from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view class="host"><view #slot></view></view>`,
})
class HostComponent {
  // biome-ignore lint/style/useReadonlyClassProperties: assigned by Angular's ViewChild
  @ViewChild('slot', { read: ViewContainerRef }) slot!: ViewContainerRef;
}

/**
 * Evaluate a runtime-wrapped Lynx background chunk the way the engine does.
 *
 * The wrapper (`@lynx-js/runtime-wrapper-webpack-plugin`) emits
 * `tt.define(id, function (require, module, exports, …injected) { … })`
 * followed by `tt.require(id)`, reading a free `tt` from its scope. So this
 * supplies a `tt`, and resolves each factory parameter **by name** from its
 * own source text — `lynx` being the one that matters, since the shared
 * registry lives on it (see runtime/src/shared-runtime.ts).
 */
function evaluateWrappedBundle(source: string, injected: Record<string, unknown>): Record<string, unknown> {
  const factories = new Map<string, (...args: unknown[]) => void>();
  const cache = new Map<string, Record<string, unknown>>();

  const ttRequire = (id: string): Record<string, unknown> => {
    const cached = cache.get(id);
    if (cached) return cached;
    const factory = factories.get(id);
    if (!factory) throw new Error(`the bundle never defined "${id}"`);
    const module = { exports: {} as Record<string, unknown> };
    cache.set(id, module.exports);
    // Parameter names after the fixed (require, module, exports) trio.
    const params = /^function\s*[^(]*\(([^)]*)\)/.exec(String(factory))?.[1] ?? '';
    const names = params.split(',').map((p) => p.trim()).slice(3);
    const args = names.map((name) => injected[name]);
    factory(ttRequire, module, module.exports, ...args);
    // The factory may reassign module.exports wholesale.
    cache.set(id, module.exports);
    return module.exports;
  };

  const tt = {
    define(id: string, factory: (...args: unknown[]) => void): void {
      factories.set(id, factory);
    },
    require: ttRequire,
  };

  // Evaluate the chunk with a **CommonJS-shaped scope**, not just `tt`.
  //
  // rspack's startup code ends with `var __rspack_exports_target = exports;`
  // to re-export the entry's bindings. Whether that line lands *inside* the
  // `tt.define(…, function (require, module, exports, …))` factory — where
  // `exports` is a parameter — or at the chunk's top level depends on the
  // emitted startup shape, which is not stable across environments: this
  // harness passed locally for exactly that reason while CI hit
  // `ReferenceError: exports is not defined` on the very same construct.
  //
  // A real host evaluates the bundle with these bindings available, so
  // providing them is both faithful and shape-independent. `module.exports` is
  // then the fallback result for a chunk that exports at top level instead of
  // registering a `tt.define` factory.
  const topLevel = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line no-new-func
  new Function(
    'tt',
    'module',
    'exports',
    'require',
    source,
  )(tt, topLevel, topLevel.exports, ttRequire);

  const id = [...factories.keys()][0];
  if (id) return ttRequire(id);
  if (Object.keys(topLevel.exports).length > 0) return topLevel.exports;
  throw new Error('the bundle defined no modules at all');
}

async function main(): Promise<void> {
  const bundlePath = process.env['DYNAMIC_BUNDLE_JS'];
  if (!bundlePath) throw new Error('set DYNAMIC_BUNDLE_JS to the built background chunk');

  installMockPapi();
  (globalThis as Record<string, any>).renderPage({});

  console.log('\n=== The host publishes its framework instances (what dynamicComponentHost generates) ===');
  publishSharedModule('@angular/core', angularCore);
  publishSharedModule('ng-lynx', angularLynx);
  publishSharedModule('ng-lynx/elements', angularLynxElements);
  assert(true, 'host published @angular/core, ng-lynx and ng-lynx/elements');

  const host = await bootstrapLynxApplication(HostComponent);
  await tick();
  await tick();
  const page = getPage();
  assert(findByClass(page, 'host') != null, 'the host app rendered');
  assert(findByClass(page, 'remote-card') == null, 'the dynamic component is not present before loading');

  console.log('\n=== Evaluate the REAL built bundle exactly as the engine does ===');
  const source = readFileSync(bundlePath, 'utf8');
  const exports = evaluateWrappedBundle(source, {
    // The registry lives on `lynx`, which the engine injects as a factory
    // parameter — the same object the host published onto above.
    lynx: (globalThis as Record<string, unknown>)['lynx'],
    tt: {},
    NativeModules: {},
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    global: globalThis,
  });
  assert(typeof exports['default'] === 'function', 'the bundle exported a default (the component class)');
  assert(
    typeof exports['RemoteCardComponent'] === 'function',
    'the bundle exported its named export too (the whole namespace is what the engine hands back)',
  );

  console.log('\n=== Mount it into the live host tree ===');
  const instance = (host as any).components?.[0]?.instance as HostComponent | undefined;
  const slot = instance?.slot;
  if (!slot) throw new Error('could not resolve the host ViewContainerRef');
  slot.createComponent(exports['default'] as Type<unknown>);
  await tick();
  await tick();

  assert(
    findByClass(page, 'remote-card') != null,
    'the separately-built component mounted into the host tree — sharing worked (a bundled second Angular fails here with NG0203)',
  );
  assert(
    findText(page, 'Loaded from a separate bundle') != null,
    "the loaded component's own template rendered",
  );
  assert(findText(page, 'Tapped 0×') != null, "its own signal state initialized");

  console.log('\n=== It is genuinely live: its own event handler and signal work ===');
  const sign = findByClass(page, 'remote-button')?.events['tap']?.sign;
  assert(typeof sign === 'string', 'its (tap) binding registered a real native listener through the host renderer');
  publishEvent(sign as string, { type: 'tap' });
  await tick();
  await tick();
  assert(
    findText(page, 'Tapped 1×') != null,
    "a tap ran the loaded component's handler and re-rendered through the host's change detection",
  );

  console.log('\n✅ A separately-built dynamic-component bundle loads, mounts and is fully interactive.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Dynamic-component load verification failed:\n', err);
  process.exit(1);
});
