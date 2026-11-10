// Bundles verify/harness.ts (with the runtime source) into a runnable ESM file
// and executes it. esbuild handles: __DEV__ define, legacy Angular decorators,
// and aliasing the `angular-lynx` specifiers to the package source.
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');

// Exact-match resolver for the `angular-lynx` specifiers → source files.
const aliasMap = {
  'angular-lynx/internal/ops': resolve(pkg, 'internal/src/ops.ts'),
  'angular-lynx/main-thread': resolve(pkg, 'main-thread/src/entry-main.ts'),
  'angular-lynx/worklet': resolve(pkg, 'main-thread/src/worklet-apply.ts'),
  'angular-lynx/entry-background': resolve(pkg, 'runtime/src/entry-background.ts'),
  'angular-lynx/forms': resolve(pkg, 'runtime/src/forms-public.ts'),
  'angular-lynx/elements': resolve(pkg, 'runtime/src/elements.ts'),
  'angular-lynx/testing': resolve(pkg, 'testing/src/index.ts'),
  'angular-lynx/router': resolve(pkg, 'runtime/src/router.ts'),
  'angular-lynx/http': resolve(pkg, 'runtime/src/http.ts'),
  'angular-lynx/genui': resolve(pkg, 'runtime/src/genui.ts'),
  'angular-lynx': resolve(pkg, 'runtime/src/index.ts'),
};

const aliasPlugin = {
  name: 'angular-lynx-alias',
  setup(build) {
    build.onResolve({ filter: /^angular-lynx(\/|$)/ }, (args) => {
      const target = aliasMap[args.path];
      if (target) return { path: target };
      return null;
    });
  },
};

// Which harness to run (default: the hello-world runtime check).
const entry = process.argv[2] ?? 'harness.ts';
const outfile = resolve(here, 'out.mjs');

// Mirrors `enableSelectorQueries` (plugin/src/index.ts) — default on, a
// harness that needs the opt-out path sets `ENABLE_SELECTOR_QUERIES=false`,
// or the lazy path sets `ENABLE_SELECTOR_QUERIES=lazy`. `define`'s value is
// injected as raw source text, so `true`/`false` pass through as literal
// booleans, but `lazy` must be quoted here or it substitutes the bare
// (undefined) identifier `lazy` instead of the string `'lazy'`.
const enableSelectorQueriesEnv = process.env.ENABLE_SELECTOR_QUERIES ?? 'true';
const enableSelectorQueries =
  enableSelectorQueriesEnv === 'lazy' ? '"lazy"' : enableSelectorQueriesEnv;

await esbuild.build({
  entryPoints: [resolve(here, entry)],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile,
  logLevel: 'info',
  // The example component lives outside this package; resolve bare imports
  // (e.g. @angular/core) from this package's node_modules.
  nodePaths: [resolve(pkg, 'node_modules')],
  // Build in production mode, like a shipped Lynx bundle: this strips Angular's
  // dev-only checks (ngDevMode) and our renderer's dev warnings (__DEV__), unless a
  // harness of a dev warning sets `VERIFY_DEV=true`.
  define: {
    __DEV__: process.env.VERIFY_DEV === 'true' ? 'true' : 'false',
    ngDevMode: 'false',
    ngServerMode: 'false',
    ngJitMode: 'true',
    __ENABLE_SELECTOR_QUERIES__: enableSelectorQueries,
    // Always on for the harness suite (mirrors `Boolean(firstScreen)` in the
    // real plugin) — harmless for harnesses that never touch first-screen at
    // all (nothing calls `publishEvent` for an unregistered sign before its
    // handler is registered, so the buffering path never activates), and
    // exercised for real by harness-ifr.ts.
    __HAS_FIRST_SCREEN__: 'true',
  },
  // GenUI stays unbundled: typedoc (used by the catalog extractor) breaks
  // under bundling, and @preact/signals must stay a single runtime instance —
  // the genui store creates signals, so any harness (or runtime/src/genui
  // code pulled in by one) must observe them through that same copy.
  external: ['@lynx-js/genui', '@lynx-js/genui/*', '@openuidev/lang-core', 'typedoc'],
  tsconfigRaw: {
    compilerOptions: {
      experimentalDecorators: true,
      useDefineForClassFields: false,
    },
  },
  plugins: [aliasPlugin],
});

// Run it.
await import(pathToFileURL(outfile).href);
