#!/usr/bin/env node
/**
 * ng-lynx-capture — generate a first-screen snapshot for
 * `pluginAngularLynx({ firstScreen })`.
 *
 * Usage:
 *   ng-lynx-capture <entry.ts> <out.json>
 *
 * `<entry.ts>` is a small module whose **default export is the root
 * component** (optionally a named `providers` export for bootstrap
 * providers):
 *
 *   // src/first-screen-entry.ts
 *   export { AppComponent as default } from './app.component.js';
 *
 * The app's first render runs headlessly in Node (JIT, mock element PAPI —
 * the `ng-lynx/testing` environment) and the exact serialized first ops
 * batch is written to `<out.json>`. Re-run whenever the first screen changes;
 * a stale snapshot is safe (the Main Thread falls back to a teardown +
 * re-render when the real first batch doesn't match) but wastes the fast
 * first frame.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadEsbuild } from './load-esbuild.mjs';

const esbuild = await loadEsbuild('ng-lynx-capture');

const [entryArg, outArg] = process.argv.slice(2);
if (!entryArg || !outArg) {
  console.error('Usage: ng-lynx-capture <entry.ts> <out.json>');
  process.exit(1);
}
const entry = path.resolve(process.cwd(), entryArg);
const out = path.resolve(process.cwd(), outArg);

// The capture program: boot the entry's component against the mock PAPI and
// print the first ops batch. Bundled so the app's TS (decorators, .ts
// imports) and its own node_modules resolve exactly like the real build.
const wrapper = `
import '@angular/compiler';
import 'ng-lynx/main-thread';
import { captureFirstScreenOps } from 'ng-lynx/testing';
import component, * as entryModule from ${JSON.stringify(entry)};

const ops = await captureFirstScreenOps(component, {
  providers: entryModule.providers,
});
const { writeFileSync } = await import('node:fs');
writeFileSync(${JSON.stringify(out)}, ops);
console.log('[ng-lynx-capture] wrote ' + ops.length + ' bytes to ' + ${JSON.stringify(outArg)});
`;

const outfile = path.join(mkdtempSync(path.join(tmpdir(), 'ng-lynx-capture-')), 'capture.mjs');

await esbuild.build({
  stdin: {
    contents: wrapper,
    resolveDir: process.cwd(),
    sourcefile: 'ng-lynx-capture-entry.mjs',
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile,
  logLevel: 'warning',
  // Match the device build: production Angular (ngDevMode off), JIT templates.
  //
  // Every build-time constant the runtime declares must be defined here, not
  // just `__DEV__`. These are read at module scope or on the hot path, so an
  // undefined one doesn't degrade — it throws `ReferenceError` and
  // `npm run capture` fails outright, which is what happened for both of the
  // constants added after this file was written (`__HAS_FIRST_SCREEN__` in
  // event-registry.ts, `__ENABLE_SELECTOR_QUERIES__` in ops-apply.ts and
  // shadow-element.ts). The complete list is every `declare const __X__` under
  // runtime/src and main-thread/src; `pluginAngularLynx` and
  // `verify/build.mjs` are the other two bundlers that have to agree with it.
  define: {
    __DEV__: 'false',
    ngDevMode: 'false',
    ngServerMode: 'false',
    ngJitMode: 'true',
    // Matches `pluginAngularLynx`'s own default. An app that overrides
    // `enableSelectorQueries` should pass the same value here — the capture
    // has to render through the code path the real build will, or the
    // snapshot won't match at hydration time. `JSON.stringify`, not `String`,
    // so `'lazy'` round-trips as a quoted literal instead of a bare
    // (undefined) identifier.
    __ENABLE_SELECTOR_QUERIES__: JSON.stringify(
      process.env.ENABLE_SELECTOR_QUERIES === undefined || process.env.ENABLE_SELECTOR_QUERIES === 'lazy'
        ? 'lazy'
        : process.env.ENABLE_SELECTOR_QUERIES !== 'false',
    ),
    // `true` is the honest value: a capture run only happens for an app that
    // configures a first screen, and it makes the capture exercise the same
    // event-buffering path the real app will.
    __HAS_FIRST_SCREEN__: 'true',
  },
  tsconfigRaw: {
    compilerOptions: {
      experimentalDecorators: true,
      useDefineForClassFields: false,
    },
  },
});

await import(pathToFileURL(outfile).href);

// Sanity: the file must now contain a JSON array of ops.
const written = readFileSync(out, 'utf8');
JSON.parse(written);
if (!written.startsWith('[')) {
  writeFileSync(out, written); // keep, but flag
  console.error('[ng-lynx-capture] warning: output does not look like an ops array');
}
