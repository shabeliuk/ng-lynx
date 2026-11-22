// Runs the device-test flows on a real iPhone connected to this Mac.
//
// Maestro drives simulators only ("Physical iOS devices are not yet supported", 2.11),
// and Lynx Explorer's iOS build runs only on the simulator. So this:
//
//   1. builds the test app with this Mac's Wi-Fi address as its origin, into dist-iphone/,
//   2. serves it on that address (8791, and 8792 answering /main.lynx.bundle with the
//      assets bundle, since the host app always opens that path),
//   3. turns flows/*.yaml into a plan of the same steps,
//   4. runs iphone/DeviceFlows.swift, an XCUITest, in the genui example's native host app
//      (examples/genui/ios), signed with your team from its Signing.local.xcconfig.
//
// The phone must be unlocked, on the same Wi-Fi as this Mac, and set up once with
// `npm run ios:device` in examples/genui (signing, and trusting your developer profile).
// See docs/41-device-testing.md, "On a real iPhone".
//
// Usage:  node iphone.mjs [--flow <name>] [--device <udid>] [--plan]
//         (--plan prints the converted steps and stops)
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { parseAllDocuments } from 'yaml';

import { serve } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const genuiIos = path.join(here, '../../examples/genui/ios');
const { values: args } = parseArgs({
  options: { flow: { type: 'string' }, device: { type: 'string' }, plan: { type: 'boolean' } },
});

const PORT = 8791;
const ASSETS_PORT = 8792;
/** Flows that need Lynx Explorer itself. */
const SKIPPED = {
  'page-exit': "leaves the page through Explorer's back button; the host app has none",
};
/**
 * Steps that check something Explorer provides and the genui host doesn't (2026-11-22). A flow
 * that fails on exactly this text is reported as a host gap, not a failure; any other failure,
 * or a later step of the same flow, still fails the run.
 */
const HOST_GAPS = {
  'host-data': ['Init data: Hello Lynx Explorer', "the host passes no init data; Explorer passes 'Hello Lynx Explorer'"],
  attributes: ['Markdown drawn: yes', "the host doesn't register the <markdown> element"],
  assets: ['Inlined image loaded', "the host's image loader doesn't load data: URLs"],
};

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function wifiAddress() {
  const candidates = Object.entries(networkInterfaces())
    .filter(([name]) => /^en\d+$/.test(name))
    .flatMap(([, addresses]) => addresses ?? [])
    .filter((address) => address.family === 'IPv4' && !address.internal);
  return candidates[0]?.address;
}

function connectedIphone() {
  const file = path.join(tmpdir(), `devicectl-${process.pid}.json`);
  execFileSync('xcrun', ['devicectl', 'list', 'devices', '--json-output', file], { stdio: 'ignore' });
  const { result } = JSON.parse(readFileSync(file, 'utf8'));
  rmSync(file, { force: true });
  const phones = result.devices.filter(
    (device) => device.hardwareProperties?.reality === 'physical' && device.hardwareProperties?.platform === 'iOS',
  );
  const chosen = args.device
    ? phones.find((device) => device.hardwareProperties.udid === args.device || device.identifier === args.device)
    : phones.find((device) => device.connectionProperties?.transportType === 'wired') ?? phones[0];
  return chosen?.hardwareProperties.udid;
}

function signing() {
  const file = path.join(genuiIos, 'Signing.local.xcconfig');
  if (!existsSync(file)) fail('No signing set up: run `npm run ios:device` in examples/genui once.');
  const text = readFileSync(file, 'utf8');
  const get = (key) => new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*(.*?)[ \\t]*$`, 'm').exec(text)?.[1];
  return { team: get('DEVELOPMENT_TEAM'), suffix: get('PLANNER_BUNDLE_ID_SUFFIX(?:\\[sdk=iphoneos\\*\\])?') ?? '' };
}

// --- The plan -------------------------------------------------------------------------

const text = (value) => (value && typeof value === 'object' ? (value.text ?? value.id) : value);

/** Maestro commands → DeviceFlows.swift steps. Android-only branches are dropped. */
function convert(commands) {
  const steps = [];
  for (const command of commands) {
    const [key, value] = typeof command === 'string' ? [command, null] : Object.entries(command)[0];
    switch (key) {
      case 'runFlow':
        if (value.file === 'shared/open.yaml') {
          steps.push({ type: 'open', bundle: value.env.BUNDLE, ready: String(value.env.READY) });
        } else if (value.when?.platform && value.when.platform !== 'iOS') {
          // Android only.
        } else if (value.commands) {
          steps.push(...convert(value.commands));
        } else {
          throw new Error(`runFlow ${JSON.stringify(value)} isn't supported`);
        }
        break;
      case 'extendedWaitUntil':
        steps.push({ type: 'wait', visible: text(value.visible), notVisible: text(value.notVisible), timeout: value.timeout });
        break;
      case 'assertVisible':
      case 'assertNotVisible':
        steps.push({ type: key, text: text(value) });
        break;
      case 'tapOn':
        steps.push(
          typeof value === 'string'
            ? { type: 'tap', text: value }
            : { type: 'tap', text: text(value), point: value.point, optional: value.optional },
        );
        break;
      case 'longPressOn':
        steps.push({ type: 'longPress', text: text(value) });
        break;
      case 'swipe':
        steps.push({ type: 'swipe', from: text(value.from), direction: value.direction, duration: value.duration });
        break;
      case 'scrollUntilVisible':
        steps.push({ type: 'scrollUntilVisible', element: text(value.element), direction: value.direction, timeout: value.timeout });
        break;
      case 'inputText':
        steps.push({ type: 'input', text: String(value) });
        break;
      case 'pressKey':
        steps.push({ type: 'key', key: value });
        break;
      case 'takeScreenshot':
        steps.push({ type: 'screenshot', name: String(value) });
        break;
      case 'retry':
        steps.push({ type: 'retry', maxRetries: value.maxRetries, commands: convert(value.commands) });
        break;
      default:
        throw new Error(`${key} isn't supported on the iPhone runner`);
    }
  }
  return steps;
}

function plan() {
  const names = args.flow
    ? [args.flow]
    : readdirSync(path.join(here, 'flows'))
        .filter((file) => file.endsWith('.yaml'))
        .map((file) => file.slice(0, -5))
        .sort();
  const flows = [];
  for (const name of names) {
    if (SKIPPED[name]) {
      console.log(`  skipping ${name}: it ${SKIPPED[name]}`);
      continue;
    }
    const docs = parseAllDocuments(readFileSync(path.join(here, 'flows', `${name}.yaml`), 'utf8'));
    flows.push({ name, steps: convert(docs.at(-1).toJS()) });
  }
  return flows;
}

// --- The run --------------------------------------------------------------------------

if (args.plan) {
  console.log(JSON.stringify(plan(), null, 2));
  process.exit(0);
}

const udid = connectedIphone();
if (!udid) fail('No iPhone connected. Plug it in, unlock it, and trust this Mac.');
const host = wifiAddress();
if (!host) fail("This Mac has no Wi-Fi address for the phone to reach.");
const { team, suffix } = signing();
const flows = plan();
console.log(`iPhone ${udid}, server http://${host}:${PORT}/, ${flows.length} flow(s)`);

console.log('Building the test app');
const dist = path.join(here, 'dist-iphone');
execFileSync('pnpm', ['exec', 'rspeedy', 'build'], {
  cwd: here,
  stdio: 'pipe',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    DO_NOT_TRACK: '1',
    DEVICE_TESTS_ORIGIN: `http://${host}:${PORT}/`,
    DEVICE_TESTS_DIST: dist,
  },
});

const main = await serve(dist, PORT, { host: '0.0.0.0' });
const assets = await serve(dist, ASSETS_PORT, { host: '0.0.0.0', main: 'assets' });

const runner = path.join(genuiIos, 'SparklingGoUITests/DeviceFlows.swift');
copyFileSync(path.join(here, 'iphone/DeviceFlows.swift'), runner);
const results = [];
let code = 1;
try {
  console.log('Building and running the flows on the phone (the first build takes a while)');
  code = await new Promise((resolve) => {
    const child = spawn(
      'xcodebuild',
      [
        'test',
        '-workspace', 'SparklingGo.xcworkspace',
        '-scheme', 'SparklingGoUITests',
        '-configuration', 'Debug',
        '-destination', `id=${udid}`,
        '-derivedDataPath', process.env.IPHONE_DERIVED_DATA ?? path.join(genuiIos, 'build-device-tests'),
        '-only-testing:SparklingGoUITests/DeviceFlows/testFlows',
        '-allowProvisioningUpdates',
        `DEVELOPMENT_TEAM=${team}`,
        `PLANNER_BUNDLE_ID_SUFFIX=${suffix}`,
        'CODE_SIGN_STYLE=Automatic',
        // Xcode 27 rejects the pods' own deployment targets (8.0 to 12.0).
        'IPHONEOS_DEPLOYMENT_TARGET=15.0',
      ],
      {
        cwd: genuiIos,
        env: {
          ...process.env,
          LANG: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
          TEST_RUNNER_FLOW_PLAN: Buffer.from(JSON.stringify(flows)).toString('base64'),
          TEST_RUNNER_FLOW_HOST: host,
          TEST_RUNNER_FLOW_PORT: String(PORT),
          TEST_RUNNER_FLOW_ASSETS_PORT: String(ASSETS_PORT),
        },
      },
    );
    let log = '';
    const onData = (chunk) => {
      log += chunk;
      for (const line of chunk.toString().split('\n')) {
        const match = /FLOW (PASS|FAIL) ([\w-]+)(.*)/.exec(line);
        if (!match) continue;
        const [, verdict, name, rest] = match;
        const gap = HOST_GAPS[name];
        if (verdict === 'FAIL' && gap && rest.includes(gap[0])) {
          results.push(`FLOW GAP ${name}`);
          console.log(`  ~ ${name}: host gap, ${gap[1]}`);
        } else {
          results.push(match[0]);
          console.log(`  ${verdict === 'PASS' ? '✓' : '✗'} ${name}${rest}`);
        }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (exit) => {
      writeFileSync(path.join(here, 'artifacts-iphone.log'), log);
      resolve(exit ?? 1);
    });
  });
} finally {
  rmSync(runner, { force: true });
  main.close();
  assets.close();
}

const missing = [...main.requests, ...assets.requests].filter(
  ({ status }) => status !== 200 && status !== 'dropped',
);
for (const { pathname, status } of missing) console.error(`  the phone got ${status} for ${pathname}`);
const passed = results.filter((line) => line.startsWith('FLOW PASS')).length;
const gaps = results.filter((line) => line.startsWith('FLOW GAP')).length;
const failed = results.filter((line) => line.startsWith('FLOW FAIL')).length;
const summary = `${passed}/${flows.length} flows passed on the iPhone${gaps ? `, ${gaps} stopped at a known host gap` : ''}`;
// xcodebuild exits non-zero for any failed flow, gaps included, so count the flows instead.
if (failed || missing.length || passed + gaps !== flows.length) {
  fail(`${summary}. The xcodebuild log is in artifacts-iphone.log.`);
}
console.log(`\n✓ ${summary}`);
