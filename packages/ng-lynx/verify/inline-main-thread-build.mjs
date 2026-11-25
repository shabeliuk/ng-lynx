// Inline 'main thread' functions through a real AOT build.
//
// harness-inline-main-thread.ts applies the two transforms with esbuild. This builds
// packages/device-tests, whose main-thread screen has two such functions, with
// rspeedy and AOT, into a temporary folder, and checks that ngtsc compiled the
// Background form (it reads files through the input file system the plugin wraps,
// not through the loaders) and that the Main-Thread half was bundled: each
// function's id appears once on each thread. strictTemplates passing is part of it.
// The `main-thread` device flow runs both on a real engine.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const appDir = path.join(repoRoot, 'packages/device-tests');
const distDir = mkdtempSync(path.join(tmpdir(), 'ng-lynx-inline-build-'));

let passed = 0;
function assert(cond, label) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✓ ${label}`);
}

console.log('building packages/device-tests (production, AOT)…');
try {
  execFileSync('npx', ['rspeedy', 'build'], {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, DEVICE_TESTS_DIST: distDir },
  });
  const bundle = readFileSync(path.join(distDir, 'main.lynx.bundle'), 'latin1');
  const ids = [...new Set(bundle.match(/__ngInline:src\/main-thread\.component\.ts:\d+:\d+/g) ?? [])];
  assert(ids.length === 2, `two inline functions in the bundle (got ${ids.join(', ') || 'none'})`);
  for (const id of ids) {
    const count = bundle.split(id).length - 1;
    assert(count === 2, `${id} is on both threads (${count} occurrences)`);
  }
  assert(/\(\s*"__ngInline:[^"]+",\s*\(\)\s*=>\s*\(\{/.test(bundle), 'the Background form captures lazily');
  assert(bundle.includes('inlineCount') && bundle.includes('onInlineTap'), 'what it captures is named on the Main Thread');
} finally {
  rmSync(distDir, { recursive: true, force: true });
}

console.log(`\ninline-main-thread-build: all ${passed} assertions passed`);
