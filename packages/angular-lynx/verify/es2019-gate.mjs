// ES2019 parse gate (docs/07-verifying.md#level-3) — a **local dev-time**
// helper. Lynx's Background-Thread engine (PrimJS) is ~ES2019, so a bundle
// carrying ES2020+ syntax fails at load on-device. This parses the dual-thread
// JS with acorn at `ecmaVersion: 2019` and fails on the first newer construct.
//
// IMPORTANT — this reads the *un-packaged* intermediate JS under
// `dist/.rspeedy/main/` (background.js + main-thread.js), which only the **dev
// server** (`rspeedy dev`) writes. A production `rspeedy build` packages
// everything into the `.lynx.bundle`/`.web.bundle` TASM container (a binary
// header + JS islands interleaved with binary sections — acorn can't read it,
// confirmed), and does NOT leave those plain intermediates behind. So run this
// after `rspeedy dev` has emitted them, as a fast local check.
//
// It is deliberately **NOT** wired into CI, because CI runs `build`, not
// `dev`. The build-time ES2019 gate that DOES run in CI is
// `npm run verify:lazy-chunks`, which acorn-parses (at ES2019) the async chunk
// a real `rspeedy build` emits as plain JS — see docs/36-ci.md.
//
// Usage:  node verify/es2019-gate.mjs <example-dir>   (after `rspeedy dev`)
//   e.g.  node verify/es2019-gate.mjs ../../examples/hello-world
// The <example-dir> is resolved relative to the package root
// (packages/angular-lynx), so `../../examples/<name>` points at an example
// regardless of the caller's cwd.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const acorn = require('acorn');

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleDir = path.resolve(pkgDir, process.argv[2] ?? '../../examples/hello-world');
const rspeedyDir = path.join(exampleDir, 'dist/.rspeedy/main');

if (!existsSync(rspeedyDir)) {
  console.error(
    `✗ ${rspeedyDir} not found. These intermediates are only written by the dev\n`
      + `  server — run \`rspeedy dev\` in the example once, then re-run this. (A\n`
      + `  production \`rspeedy build\` packages them away; CI's ES2019 gate is\n`
      + `  \`npm run verify:lazy-chunks\` instead — see docs/36-ci.md.)`,
  );
  process.exit(1);
}

// background.<hash>.js + main-thread.js (names carry a contenthash in prod).
const files = readdirSync(rspeedyDir).filter((f) => f.endsWith('.js'));
if (files.length === 0) {
  console.error(`✗ no .js files under ${rspeedyDir}`);
  process.exit(1);
}

let checked = 0;
for (const file of files) {
  const full = path.join(rspeedyDir, file);
  const code = readFileSync(full, 'utf8');
  try {
    acorn.parse(code, { ecmaVersion: 2019, sourceType: 'script' });
    console.log(`  ✓ ${file} parses as ES2019 (${(code.length / 1024).toFixed(0)} kB)`);
    checked += 1;
  } catch (err) {
    // acorn reports a 1-based line/col; surface the offending source line.
    const line = typeof err.loc?.line === 'number' ? code.split('\n')[err.loc.line - 1] : '';
    console.error(`  ✗ ${file}: ${err.message}`);
    if (line) console.error(`      ${line.trim().slice(0, 160)}`);
    process.exit(1);
  }
}

console.log(`\n✅ ES2019 gate passed — ${checked} dual-thread bundle(s) parse at ecmaVersion 2019.`);
