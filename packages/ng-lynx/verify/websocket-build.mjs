// Verify that a release build gives the Background Thread a `WebSocket`.
//
// On a device, `WebSocket` is `@lynx-js/websocket`, provided by a ProvidePlugin.
// rspeedy adds that plugin for `rspeedy dev` only, so an app that opened a
// WebSocket worked in dev and had none in a release build: found by a real app
// on Explorer 4.2. pluginAngularLynx now provides it for other lynx builds.
//
// This builds examples/hello-world for production with one more entry module that
// opens a WebSocket, into a temporary folder, and looks for the implementation in
// the lynx bundle. The web bundle runs in a browser worker with its own WebSocket,
// so it must not carry it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const exampleDir = path.join(repoRoot, 'examples/hello-world');
const configFile = 'lynx.verify-websocket.config.ts';
// In src/, where the AOT compiler's tsconfig looks.
const entryFile = 'src/verify-websocket-entry.ts';
const outDir = mkdtempSync(path.join(tmpdir(), 'ng-lynx-websocket-'));

let passed = 0;
function assert(cond, label) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✓ ${label}`);
}

console.log('building examples/hello-world (production, with a WebSocket)…');
writeFileSync(
  path.join(exampleDir, entryFile),
  `import './index.js';
(globalThis as { openSocket?: () => unknown }).openSocket = () => new WebSocket('wss://example.test/stream');
`,
);
writeFileSync(
  path.join(exampleDir, configFile),
  `import base from './lynx.config.ts';
export default {
  ...base,
  source: { ...base.source, entry: { main: './${entryFile}' } },
  output: { ...base.output, distPath: { root: ${JSON.stringify(outDir)} }, cleanDistPath: true },
};
`,
);
try {
  execFileSync('npx', ['rspeedy', 'build', '--config', configFile], { cwd: exampleDir, stdio: 'inherit' });
} finally {
  rmSync(path.join(exampleDir, configFile));
  rmSync(path.join(exampleDir, entryFile));
}

try {
  const lynx = readFileSync(path.join(outDir, 'main.lynx.bundle'), 'latin1');
  const web = readFileSync(path.join(outDir, 'main.web.bundle'), 'latin1');
  assert(lynx.includes('wss://example.test/stream'), 'the lynx bundle contains the code that opens the socket');
  assert(lynx.includes('LynxWebSocketModule'), 'the lynx bundle carries @lynx-js/websocket for it');
  assert(!web.includes('LynxWebSocketModule'), "the web bundle doesn't: the browser worker has its own WebSocket");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(`\nwebsocket-build: all ${passed} assertions passed`);
