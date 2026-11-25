// Runs the Maestro flows in flows/ on a real Lynx engine, in the pinned Lynx Explorer,
// then checks what only shows outside the screen: what the device fetched from the
// server, and what the engine logged. See docs/41-device-testing.md.
//
// Usage:  node run.mjs --platform <ios|android> [--flow <name>] [--timeout <minutes>]
//                     [--screen <ci|device>]
//
// The app's build is run first, so build ng-lynx before this. Android needs a
// booted emulator or device; iOS boots its own simulator and leaves yours alone.
//
// On Android the run uses CI's screen size (--screen ci, the default) and puts the
// device's own size back afterwards; --screen device keeps the device's.
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { serve } from './server.mjs';
import { ensureExplorer, ensureMaestro, tools } from './tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    platform: { type: 'string' },
    flow: { type: 'string' },
    timeout: { type: 'string', default: '35' },
    screen: { type: 'string', default: 'ci' },
  },
});
const { platform } = args;
if (args.screen !== 'ci' && args.screen !== 'device') {
  console.error('--screen is ci or device');
  process.exit(1);
}
if (platform !== 'ios' && platform !== 'android') {
  console.error('usage: node run.mjs --platform <ios|android> [--flow <name>] [--timeout <minutes>] [--screen <ci|device>]');
  process.exit(1);
}

const PORT = 8791; // lynx.config.ts's assetPrefix
/**
 * The CI emulator's screen: android-emulator-runner with no `profile` creates a
 * generic AVD, 320x640 at 160 dpi. Flows that passed on a phone-sized emulator
 * failed there (a slider right above the navigation handle), so every Android run
 * uses this size, and passing here means passing on CI.
 */
const CI_SCREEN = { size: '320x640', density: '160' };
const SIMULATOR = 'Angular Lynx Device Tests';
const appId = tools.explorer[platform].appId;
const artifacts = path.join(here, 'artifacts', platform);
const run = (command, argv, options) => execFileSync(command, argv, { encoding: 'utf8', stdio: 'pipe', ...options });

const adbPath = () => {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(homedir(), 'Library/Android/sdk');
  const adb = path.join(sdk, 'platform-tools/adb');
  return existsSync(adb) ? adb : 'adb';
};

/** Puts the Android device's own screen size back. Set once the size is changed. */
let restoreScreen = () => {};

/** A plain "iPhone <n> Pro": Explorer's page ignores taps on some newer screen shapes. */
function bootSimulator() {
  const simctl = (...argv) => run('xcrun', ['simctl', ...argv]);
  const { devices } = JSON.parse(simctl('list', 'devices', 'available', '-j'));
  let udid = Object.values(devices).flat().find((device) => device.name === SIMULATOR)?.udid;
  if (!udid) {
    const { runtimes } = JSON.parse(simctl('list', 'runtimes', 'available', '-j'));
    const candidates = runtimes
      .filter((runtime) => runtime.platform === 'iOS')
      .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
      .flatMap((runtime) =>
        runtime.supportedDeviceTypes
          .filter((type) => /^iPhone \d+ Pro$/.test(type.name))
          .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
          .map((type) => [type.identifier, runtime.identifier]),
      );
    if (!candidates.length) throw new Error('No iOS runtime with an iPhone Pro is installed.');
    udid = simctl('create', SIMULATOR, ...candidates[0]).trim();
  }
  try {
    simctl('boot', udid);
  } catch (err) {
    if (!/current state: Booted/.test(err.stderr)) throw err;
  }
  simctl('bootstatus', udid, '-b');
  return udid;
}

async function prepareDevice() {
  const explorer = await ensureExplorer(platform);
  if (platform === 'ios') {
    const udid = bootSimulator();
    run('xcrun', ['simctl', 'install', udid, explorer]);
    const log = spawn('xcrun', ['simctl', 'spawn', udid, 'log', 'stream', '--level', 'debug', '--style', 'compact',
      '--predicate', 'process == "LynxExplorer"']);
    return { id: udid, log };
  }
  const adb = adbPath();
  const id = run(adb, ['devices']).split('\n').find((line) => /\tdevice$/.test(line))?.split('\t')[0];
  if (!id) throw new Error('No booted Android device. Start an emulator first.');
  if (args.screen === 'ci') {
    run(adb, ['-s', id, 'shell', 'wm', 'size', CI_SCREEN.size]);
    run(adb, ['-s', id, 'shell', 'wm', 'density', CI_SCREEN.density]);
    restoreScreen = () => {
      restoreScreen = () => {};
      for (const setting of ['size', 'density']) {
        try {
          run(adb, ['-s', id, 'shell', 'wm', setting, 'reset']);
        } catch {}
      }
    };
    process.once('SIGINT', () => {
      restoreScreen();
      process.exit(130);
    });
    console.log(`  screen ${CI_SCREEN.size} at ${CI_SCREEN.density} dpi, as on CI`);
  }
  run(adb, ['-s', id, 'install', '-r', explorer]);
  run(adb, ['-s', id, 'reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
  run(adb, ['-s', id, 'logcat', '-c']);
  return { id, log: spawn(adb, ['-s', id, 'logcat', '-v', 'time']) };
}

function javaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  return ['/opt/homebrew/opt/openjdk@17', '/Applications/Android Studio.app/Contents/jbr/Contents/Home'].find(existsSync);
}

function runMaestro(maestro, deviceId) {
  const targets = args.flow ? [path.join(here, 'flows', `${args.flow}.yaml`)] : [path.join(here, 'flows')];
  const argv = ['--device', deviceId, 'test',
    '--format', 'junit', '--output', path.join(artifacts, 'report.xml'),
    '--test-output-dir', path.join(artifacts, 'maestro'),
    '-e', `APP_ID=${appId}`, '-e', `ORIGIN=http://127.0.0.1:${PORT}/`,
    ...targets];
  const env = {
    ...process.env,
    JAVA_HOME: javaHome(),
    MAESTRO_CLI_NO_ANALYTICS: '1',
    // A cold driver install on a CI emulator takes longer than the default.
    MAESTRO_DRIVER_STARTUP_TIMEOUT: '180000',
  };
  return new Promise((resolve) => {
    const child = spawn(maestro, argv, { env, stdio: 'inherit', cwd: artifacts });
    const timer = setTimeout(() => {
      console.error(`Maestro was still running after ${args.timeout} minutes. Stopping it.`);
      child.kill('SIGKILL');
    }, Number(args.timeout) * 60_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

/** What each flow leaves on the server. A failing flow's own failure is reported by Maestro. */
const SERVED = [
  { flow: 'counter', label: 'the main bundle', test: /^\/main\.lynx\.bundle$/ },
  { flow: 'lazy-route', label: 'the lazy route chunk', test: /^\/static\/js\/async\/lazy-route\.[^/]+\.js$/ },
  { flow: 'assets', label: 'the image from lynxAssetUrl()', test: /^\/square\.png$/ },
  { flow: 'assets', label: 'the image imported as a module', test: /^\/static\/image\/imported-photo\.[0-9a-f]+\.png$/ },
  { flow: 'platform', label: 'the server-sent events stream', test: /^\/sse$/ },
  { flow: 'network', label: 'the lazy chunk on a slow network', test: /^\/static\/js\/async\/lazy-route\.[^/]+\.js$/ },
  { flow: 'network', label: "HttpClient's GET to the headers echo", test: /^\/__headers\/get$/ },
];

function checkRequests(requests) {
  const failures = [];
  for (const { flow, label, test } of SERVED) {
    if (args.flow && args.flow !== flow) continue;
    if (!requests.some(({ pathname, status }) => status === 200 && test.test(pathname))) {
      failures.push(`The server never served ${label}.`);
    }
  }
  // The network screen's HttpClient requests, each with the Content-Type it should carry.
  for (const { pathname, contentType, expect } of requests) {
    if (expect != null && contentType !== expect) {
      failures.push(`${pathname} arrived with Content-Type: ${contentType}, expected ${expect}.`);
    }
  }
  for (const { pathname, status } of requests) {
    // The network flow cuts the lazy chunk's connection on purpose.
    if (status !== 200 && status !== 'dropped') failures.push(`The device got ${status} for ${pathname}.`);
  }
  return failures;
}

// Lines that mean a failure on either engine. Noise is listed in docs/41-device-testing.md.
const ENGINE_ERRORS = [
  /\b(Uncaught|TypeError|ReferenceError|RangeError|SyntaxError)\b/,
  /is not a function/,
  /\bNG0\d{3,}/,
  /LynxError.*\b\d{4,}\b/,
  /FiberElement re-insert node/,
];
// The last one is the network flow cutting the lazy chunk's connection on purpose.
const NOISE = /Duplicated Behavior|timing_map|lynx_plugin: load original|load external js script failed! url: http:\/\/127\.0\.0\.1:8791\/static\/js\/async\/lazy-route\./;

function checkLog(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const failures = lines
    .filter((line) => /lynx/i.test(line) && !NOISE.test(line) && ENGINE_ERRORS.some((pattern) => pattern.test(line)))
    .map((line) => `Engine log: ${line.slice(0, 300)}`);
  // Android only: the iOS log doesn't carry the app's console output, so there the
  // flow can only show that leaving the page raises no error.
  const wantsDestroy = platform === 'android' && (!args.flow || args.flow === 'page-exit');
  if (wantsDestroy && !lines.some((line) => line.includes('[device-tests] app destroyed'))) {
    failures.push("Leaving the page never ran the app's destroy hook.");
  }
  const version =lines.map((line) => /lynx sdk version: ?([\d.]+)/i.exec(line)?.[1]).find(Boolean);
  const pinned = tools.explorer.version.split('.').slice(0, 2).join('.');
  if (!version) console.warn(`  (the log didn't name the engine, pinned ${pinned})`);
  else if (version !== pinned) failures.push(`The engine reports ${version}, but Explorer ${pinned} is pinned.`);
  else console.log(`  engine ${version}`);
  return failures;
}

rmSync(artifacts, { recursive: true, force: true });
mkdirSync(artifacts, { recursive: true });

console.log('Building the test app');
run('pnpm', ['exec', 'rspeedy', 'build'], { cwd: here, env: { ...process.env, NODE_ENV: 'production', DO_NOT_TRACK: '1' } });
console.log('Preparing the tools and the device');
const maestro = await ensureMaestro();
const device = await prepareDevice();
const logFile = path.join(artifacts, 'engine.log');
const logStream = createWriteStream(logFile);
device.log.stdout.pipe(logStream);
const server = await serve(path.join(here, 'dist'), PORT);

console.log(`Running the flows on ${platform} (${device.id})`);
const flowsPassed = await runMaestro(maestro, device.id);

device.log.kill();
server.close();
restoreScreen();
await new Promise((resolve) => logStream.end(resolve));
writeFileSync(path.join(artifacts, 'requests.json'), JSON.stringify(server.requests, null, 2));

const failures = [
  ...(flowsPassed ? [] : ['A Maestro flow failed: see the output above and artifacts/.']),
  ...checkRequests(server.requests),
  ...checkLog(logFile),
];
if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s) on ${platform}:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`\n✓ every check passed on ${platform}`);
process.exit(0);
