// Verify split-bundle lazy loading (docs/15-routing.md, roadmap-next item 4).
//
// Unlike the harness-*.ts suite (esbuild + mock PAPI), this check needs the
// real rspack pipeline — chunk splitting, the Lynx chunk-loading runtime, the
// runtime wrapper, and the template packaging are all build-time concerns. So
// it runs a production `rspeedy build` of examples/router (whose /lazy route
// is a genuine `loadComponent` + dynamic `import()` with `asyncChunks: true`)
// and asserts on the emitted artifacts:
//
//   1. Both environments emit a real async chunk, at distinct paths
//      (`.web.` infix for the web env — same-path emissions collide on the
//      shared dev server, and the lynx env's runtime-wrapped copy would win).
//   2. The lazy component's code is in the chunks and NOT in either bundle —
//      the split is real, not cosmetic.
//   3. The lynx chunk is runtime-wrapped (`tt.define(...)`) — the format the
//      device's `lynx.requireModuleAsync` executes — and parses as ES2019
//      (the acorn gate, docs/07-verifying.md level 3: PrimJS is ~ES2019).
//   4. The web chunk is a plain CommonJS chunk. We execute it the same way
//      `@lynx-js/web-core`'s Background worker does (function body with
//      `module`/`exports` params) and assert it yields `{ids, modules}` with
//      function factories — the exact shape `installChunk` consumes.
//   5. Each bundle's app-service carries the loading runtime: the
//      `lynx.requireModuleAsync` ensure-chunk handler and a chunk-filename
//      function pointing into `static/js/async/`.
//
// The live half of the proof (the web preview fetching the chunk at
// navigation time and rendering the route) is a browser check — see
// docs/15-routing.md's verification notes.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const acorn = require('acorn');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const exampleDir = path.join(repoRoot, 'examples/router');
const distDir = path.join(exampleDir, 'dist');

let passed = 0;
function assert(cond, label) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✓ ${label}`);
}

// -- build -------------------------------------------------------------------
if (process.env.SKIP_BUILD !== '1') {
  console.log('building examples/router (production)…');
  execFileSync('npm', ['run', 'build'], { cwd: exampleDir, stdio: 'inherit' });
}
assert(existsSync(distDir), 'dist/ exists');

// -- 1. chunk assets exist, distinct per environment -------------------------
const asyncDir = path.join(distDir, 'static/js/async');
const chunkFiles = existsSync(asyncDir) ? readdirSync(asyncDir).filter((f) => f.endsWith('.js')) : [];
const webChunks = chunkFiles.filter((f) => f.endsWith('.web.js'));
const lynxChunks = chunkFiles.filter((f) => !f.endsWith('.web.js'));
assert(lynxChunks.length === 1, `one lynx async chunk emitted (${lynxChunks.join(', ')})`);
assert(webChunks.length === 1, `one web async chunk emitted (${webChunks.join(', ')})`);

const lynxChunk = readFileSync(path.join(asyncDir, lynxChunks[0]), 'utf8');
const webChunk = readFileSync(path.join(asyncDir, webChunks[0]), 'utf8');
const lynxBundle = readFileSync(path.join(distDir, 'main.lynx.bundle'), 'latin1');
const webBundle = readFileSync(path.join(distDir, 'main.web.bundle'), 'latin1');

// -- 2. the split is real ----------------------------------------------------
// A string that exists only in the lazy component's template.
const marker = 'loaded via loadComponent';
assert(lynxChunk.includes(marker), 'lazy code is in the lynx chunk');
assert(webChunk.includes(marker), 'lazy code is in the web chunk');
assert(!lynxBundle.includes(marker), 'lazy code is NOT in main.lynx.bundle');
assert(!webBundle.includes(marker), 'lazy code is NOT in main.web.bundle');

// -- 3. lynx chunk: device format + ES2019 -----------------------------------
// Minification renames the `tt` binding, but the wrapper always registers the
// chunk under its own filename: `<x>.define("<chunk file>", factory)`.
assert(lynxChunk.includes(`.define("${lynxChunks[0]}"`), 'lynx chunk is runtime-wrapped (define(<own filename>))');
try {
  acorn.parse(lynxChunk, { ecmaVersion: 2019, sourceType: 'script' });
  assert(true, 'lynx chunk parses as ES2019 (acorn gate)');
} catch (err) {
  assert(false, `lynx chunk parses as ES2019 (acorn gate): ${err.message}`);
}

// -- 4. web chunk: CommonJS shape, executable the way web-core executes it ---
assert(!webChunk.includes(`.define("`), 'web chunk is NOT runtime-wrapped');
{
  // Mirror @lynx-js/web-core createChunkLoading.js: the chunk source becomes a
  // function body with `module`/`exports` in scope; `module.exports` is what
  // `installChunk` receives.
  const module = { exports: {} };
  new Function('module', 'exports', webChunk)(module, module.exports);
  const out = module.exports;
  assert(Array.isArray(out.ids) && out.ids.length > 0, `web chunk exports ids (${JSON.stringify(out.ids)})`);
  const factories = Object.values(out.modules ?? {});
  assert(
    factories.length > 0 && factories.every((f) => typeof f === 'function'),
    `web chunk exports ${factories.length} module factory(ies)`,
  );
}

// -- 5. both bundles carry the loading runtime -------------------------------
for (const [name, bundle] of [['main.lynx.bundle', lynxBundle], ['main.web.bundle', webBundle]]) {
  assert(bundle.includes('requireModuleAsync'), `${name} has the requireModuleAsync ensure-chunk handler`);
  assert(bundle.includes('static/js/async/'), `${name} has the async chunk-filename template`);
}
// The web runtime must point at the renamed chunks, the lynx one at the plain
// names — each app-service embeds its own filename template.
assert(webBundle.includes('.web.js"'), 'main.web.bundle chunk-filename template targets .web.js');

console.log(`\nlazy-chunks: all ${passed} assertions passed`);
