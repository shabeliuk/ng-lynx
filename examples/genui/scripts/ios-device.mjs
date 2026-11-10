#!/usr/bin/env node
/**
 * Build, install and launch the planner on a connected iPhone.
 *
 * `sparkling run:ios` only targets simulators, so this does the device path
 * with Xcode's own tools:
 *
 *   1. find the connected iPhone (`devicectl`), or IOS_DEVICE=<name|udid>
 *   2. find your signing team: IOS_TEAM_ID, else one picked on the target in
 *      Xcode, else ios/Signing.local.xcconfig, else the first team Xcode knows
 *      (a free Apple ID works). It's remembered in Signing.local.xcconfig,
 *      which is gitignored, and never left in the committed project.pbxproj.
 *   3. build the Lynx bundle into the app (`sparkling build --copy`)
 *   4. `xcodebuild` Debug for the device with automatic signing, under a
 *      bundle ID of that team's own (see BUNDLE_ID below)
 *   5. install, then launch pointed at this Mac's dev server over Wi-Fi
 *      (SPARKLING_DEV_SERVER_HOST/PORT, as `run:ios` does for the simulator)
 *
 * Run `npm run ios:dev` first; the phone must be on the same Wi-Fi as this Mac.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_BUNDLE_ID = 'dev.angularlynx.planner';
const DEV_PORT = process.env.SPARKLING_DEV_SERVER_PORT ?? '5969';

const SCHEME = 'SparklingGoInHouse';
const PBXPROJ = join(root, 'ios/SparklingGo.xcodeproj/project.pbxproj');
const LOCAL_SIGNING = join(root, 'ios/Signing.local.xcconfig');

/** DEVELOPMENT_TEAM and PLANNER_BUNDLE_ID_SUFFIX from Signing.local.xcconfig. */
function readLocalSigning() {
  if (!existsSync(LOCAL_SIGNING)) return {};
  const text = readFileSync(LOCAL_SIGNING, 'utf8');
  const get = (key) => new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*(.*?)[ \\t]*$`, 'm').exec(text)?.[1];
  return {
    team: get('DEVELOPMENT_TEAM') || undefined,
    suffix: get('PLANNER_BUNDLE_ID_SUFFIX(?:\\[sdk=iphoneos\\*\\])?'),
  };
}

function writeLocalSigning(team, suffix) {
  writeFileSync(
    LOCAL_SIGNING,
    '// Written by `npm run ios:device`: your signing team, kept out of the\n' +
      '// committed project.pbxproj (see Signing.xcconfig). Gitignored.\n' +
      `DEVELOPMENT_TEAM = ${team}\n` +
      '// Device builds only: the simulator needs no registered ID, and\n' +
      '// `npm run ios` launches it as plain dev.angularlynx.planner.\n' +
      `PLANNER_BUNDLE_ID_SUFFIX[sdk=iphoneos*] = ${suffix}\n`,
  );
}

/** Every team the Xcode accounts list knows (Xcode → Settings → Accounts). */
function xcodeTeams() {
  try {
    const plist = join(process.env.HOME, 'Library/Preferences/com.apple.dt.Xcode.plist');
    const teams = JSON.parse(
      execFileSync('plutil', ['-extract', 'IDEProvisioningTeamByIdentifier', 'json', '-o', '-', plist], { encoding: 'utf8' }),
    );
    return [...new Set(Object.values(teams).flat().map((entry) => entry.teamID).filter(Boolean))];
  } catch {
    return []; // Xcode hasn't recorded any team yet
  }
}

/** DEVELOPMENT_TEAM of `target`'s `configuration`, from a project.pbxproj. */
function teamOfTarget(pbxproj, target, configuration) {
  const native = new RegExp(`/\\* ${target} \\*/ = \\{\\s*isa = PBXNativeTarget;[^}]*?buildConfigurationList = (\\w+)`).exec(pbxproj);
  if (!native) return undefined;
  const list = new RegExp(`${native[1]} /\\*[^*]*\\*/ = \\{\\s*isa = XCConfigurationList;\\s*buildConfigurations = \\(([^)]*)\\)`).exec(pbxproj);
  for (const [id] of list?.[1].matchAll(/\b[0-9A-F]{24}\b/g) ?? []) {
    const block = new RegExp(`${id} /\\* ${configuration} \\*/ = \\{\\s*isa = XCBuildConfiguration;([\\s\\S]*?)\\n\\t\\t\\};`).exec(pbxproj);
    const team = block && /DEVELOPMENT_TEAM = ([A-Z0-9]{10});/.exec(block[1])?.[1];
    if (team) return team;
  }
  return undefined;
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, ...options });
  if (result.status !== 0) fail(`${command} exited with ${result.status}`);
}

// 1. The device.
const devicesJson = join(mkdtempSync(join(tmpdir(), 'planner-ios-')), 'devices.json');
execFileSync('xcrun', ['devicectl', 'list', 'devices', '--json-output', devicesJson], { stdio: 'ignore' });
const devices = JSON.parse(readFileSync(devicesJson, 'utf8')).result.devices.filter(
  // Simulators aren't listed by devicectl; `reality` is only reported once paired.
  (device) => device.hardwareProperties?.platform === 'iOS' && ['iPhone', 'iPad'].includes(device.hardwareProperties?.deviceType),
);
const wanted = process.env.IOS_DEVICE;
const device = wanted
  ? devices.find((d) => [d.identifier, d.hardwareProperties.udid, d.deviceProperties?.name].includes(wanted))
  : devices.find((d) => d.connectionProperties?.tunnelState !== 'unavailable') ?? devices[0];
if (!device) fail('No iPhone found. Connect it with a cable, unlock it, and tap "Trust This Computer".');
const name = device.deviceProperties?.name ?? device.hardwareProperties.marketingName;
if (device.connectionProperties?.pairingState !== 'paired') {
  fail(`"${name}" isn't paired with this Mac yet. Unlock it, tap "Trust This Computer", enter the passcode, then run this again.`);
}
console.log(`Device: ${name} (${device.hardwareProperties.udid})`);

// 2. The signing team.
// A team picked in Xcode → target → Signing & Capabilities is the newest
// choice, so it wins over the one remembered in Signing.local.xcconfig. But
// Xcode writes it into project.pbxproj, which is committed, so it moves to
// the local file (below). The committed project has no team of its own.
const local = readLocalSigning();
let pbxproj = readFileSync(PBXPROJ, 'utf8');
const pickedInXcode = teamOfTarget(pbxproj, SCHEME, 'Debug');
let team = process.env.IOS_TEAM_ID || pickedInXcode || local.team;
if (!team) {
  const teams = xcodeTeams();
  team = teams[0];
  if (teams.length > 1) console.log(`Xcode knows teams ${teams.join(', ')}; using ${team}. Set IOS_TEAM_ID to pick another.`);
}
if (!team) {
  fail(
    'No signing team. Add your Apple ID in Xcode → Settings → Accounts (a free "Personal Team" works), ' +
      'then run this again. Or set IOS_TEAM_ID.',
  );
}
console.log(`Signing team: ${team}`);

const xcodeTeamLine = /\n\t+DEVELOPMENT_TEAM = [A-Z0-9]{10};/g;
if (xcodeTeamLine.test(pbxproj)) {
  pbxproj = pbxproj.replace(xcodeTeamLine, '');
  writeFileSync(PBXPROJ, pbxproj);
  console.log('Took the team Xcode wrote out of project.pbxproj (committed); it lives in ios/Signing.local.xcconfig (gitignored).');
}

// A bundle ID belongs to the first team that registers it, across all of
// Apple — so `dev.angularlynx.planner` can only ever sign for one team, and
// every other Apple ID fails with "cannot be registered to your development
// team because it is not available". Give each team its own, stable ID (the
// SparklingGoInHouse target reads PLANNER_BUNDLE_ID_SUFFIX). Stable matters:
// a free team may create only 10 app IDs a week, and the phone keeps one app.
// IOS_BUNDLE_ID_SUFFIX overrides it ('' for the plain ID, if it's yours), and
// a suffix edited into Signing.local.xcconfig sticks for that team.
const suffix =
  process.env.IOS_BUNDLE_ID_SUFFIX ??
  (local.team === team && local.suffix !== undefined ? local.suffix : `.${team.toLowerCase()}`);
const BUNDLE_ID = `${BASE_BUNDLE_ID}${suffix}`;
console.log(`Bundle ID: ${BUNDLE_ID}`);
// Remembered for next time, and for Xcode's own Run button.
if (local.team !== team || local.suffix !== suffix) writeLocalSigning(team, suffix);

// 3. The Mac's LAN address the phone will load the dev bundle from.
const lanIp = Object.values(networkInterfaces())
  .flat()
  // 169.254.x is link-local — e.g. the USB link to the phone itself.
  .find((address) => address?.family === 'IPv4' && !address.internal && !address.address.startsWith('169.254.'))?.address;
if (!lanIp) fail('No LAN IPv4 address — is this Mac on Wi-Fi?');

// The phone loads the bundle and reaches the LLM proxy at this address, so
// check it before a multi-minute build: a dev server that isn't running (or a
// Mac on a different network) leaves the app stuck in offline mode.
const devServer = `http://${lanIp}:${DEV_PORT}`;
try {
  const health = await (await fetch(`${devServer}/api/health`, { signal: AbortSignal.timeout(3_000) })).json();
  console.log(`Dev server: ${devServer} (${health.configured ? `LLM: ${health.provider} · ${health.model}` : 'no LLM configured — offline agent'})`);
} catch {
  fail(
    `The dev server isn't reachable at ${devServer}. Start it with \`npm run ios:dev\`, ` +
      'check the phone is on the same Wi-Fi, then run this again.',
  );
}

// 4. Bundle + native build.
run('npx', ['sparkling-app-cli', 'build', '--copy']);
const derived = join(root, 'ios/build-device');
run(
  'xcodebuild',
  [
    '-workspace', 'ios/SparklingGo.xcworkspace',
    '-scheme', SCHEME,
    '-configuration', 'Debug',
    '-destination', `id=${device.hardwareProperties.udid}`,
    '-derivedDataPath', derived,
    '-allowProvisioningUpdates',
    '-allowProvisioningDeviceRegistration',
    `DEVELOPMENT_TEAM=${team}`,
    `PLANNER_BUNDLE_ID_SUFFIX=${suffix}`,
    'CODE_SIGN_STYLE=Automatic',
    'build',
  ],
  { env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } },
);
const app = join(derived, 'Build/Products/Debug-iphoneos/SparklingGoInHouse.app');
if (!existsSync(app)) fail(`Build finished but ${app} is missing.`);

// 5. Install + launch against the dev server.
run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device.identifier, app]);
const env = JSON.stringify({ SPARKLING_DEV_SERVER_HOST: lanIp, SPARKLING_DEV_SERVER_PORT: DEV_PORT });
run('xcrun', [
  'devicectl', 'device', 'process', 'launch', '--device', device.identifier,
  '--terminate-existing', '--environment-variables', env, BUNDLE_ID,
]);
console.log(`
✓ Launched on ${name}, loading from http://${lanIp}:${DEV_PORT}/main.lynx.bundle

  First time only, on the phone:
  "Untrusted Developer"? Settings → General → VPN & Device Management → trust your Apple ID.
`);
