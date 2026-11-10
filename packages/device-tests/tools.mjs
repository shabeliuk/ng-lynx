// Fetches the two binaries the device tests run, Maestro and Lynx Explorer, into
// a cache outside the repository. Both versions are pinned in tools.json with the
// SHA-256 GitHub records for the release asset, so a changed asset fails the run
// instead of being executed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const tools = JSON.parse(readFileSync(path.join(here, 'tools.json'), 'utf8'));
const cache = process.env.DEVICE_TESTS_CACHE ?? path.join(homedir(), '.cache/angular-lynx-e2e');

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function fetchPinned(url, file, expected) {
  if (existsSync(file) && (await sha256(file)) === expected) return;
  mkdirSync(path.dirname(file), { recursive: true });
  console.log(`  downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
  const actual = await sha256(file);
  if (actual !== expected) {
    rmSync(file);
    throw new Error(`${url} has SHA-256 ${actual}, not the pinned ${expected}. Don't run it until you know why it changed.`);
  }
}

/** Returns the path of the `maestro` launcher. */
export async function ensureMaestro() {
  const { version, asset, sha256: expected } = tools.maestro;
  const dir = path.join(cache, `maestro-${version}`);
  const bin = path.join(dir, 'maestro/bin/maestro');
  if (existsSync(bin)) return bin;
  const zip = path.join(dir, asset);
  await fetchPinned(`https://github.com/mobile-dev-inc/Maestro/releases/download/cli-${version}/${asset}`, zip, expected);
  execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
  rmSync(zip);
  return bin;
}

/** Returns the path of Explorer's `.app` on iOS or `.apk` on Android. */
export async function ensureExplorer(platform) {
  const { version } = tools.explorer;
  const { asset, sha256: expected } = tools.explorer[platform];
  const dir = path.join(cache, `explorer-${version}`);
  const file = path.join(dir, asset);
  await fetchPinned(`https://github.com/lynx-family/lynx/releases/download/${version}/${asset}`, file, expected);
  if (platform === 'android') return file;
  // The tarball holds the bundle's contents without the enclosing folder.
  const app = path.join(dir, 'LynxExplorer.app');
  if (!existsSync(path.join(app, 'Info.plist'))) {
    rmSync(app, { recursive: true, force: true });
    mkdirSync(app, { recursive: true });
    execFileSync('tar', ['-xzf', file, '-C', app]);
  }
  return app;
}
