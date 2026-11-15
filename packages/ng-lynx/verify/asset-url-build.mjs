// Verify that lynxAssetUrl() gets a base in a real production build.
//
// harness-asset-url.ts sets the public path by hand, so it can't see whether the
// bundler sets it. It didn't: `lynxAssetUrl()` read `__webpack_require__.p`, which
// the bundler only sets when something uses `__webpack_public_path__`. The dev
// client does, so every device pass on `rspeedy dev` was fine, and in a production
// build with no lazy chunks every asset URL stayed relative and failed on a device.
//
// This builds examples/accessibility, which uses lynxAssetUrl() and has no lazy
// chunks, with an `output.assetPrefix`, and looks for the runtime code that sets
// the base in both bundles.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const exampleDir = path.join(repoRoot, 'examples/accessibility');
const distDir = path.join(exampleDir, 'dist');
const configFile = 'lynx.verify-asset-url.config.ts';
const prefix = 'http://assets.example.test/app/';

let passed = 0;
function assert(cond, label) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✓ ${label}`);
}

console.log('building examples/accessibility (production, with assetPrefix)…');
writeFileSync(
  path.join(exampleDir, configFile),
  `import base from './lynx.config.ts';
export default { ...base, output: { ...base.output, assetPrefix: '${prefix}' } };
`,
);
try {
  execFileSync('npx', ['rspeedy', 'build', '--config', configFile], { cwd: exampleDir, stdio: 'inherit' });
} finally {
  rmSync(path.join(exampleDir, configFile));
}

const setsBase = new RegExp(`\\.p\\s*=\\s*"${prefix.replace(/[/.]/g, '\\$&')}"`);
for (const name of ['main.lynx.bundle', 'main.web.bundle']) {
  const bundle = readFileSync(path.join(distDir, name), 'latin1');
  assert(bundle.includes('media/avatar.jpg'), `${name} contains the lynxAssetUrl() call`);
  assert(setsBase.test(bundle), `${name} sets the public path to output.assetPrefix`);
}

console.log(`\nasset-url-build: all ${passed} assertions passed`);
