// Rewrites the workspace's pinned Angular version so CI can run the verify
// suite against more than one Angular major (docs/36-ci.md). angular-lynx ships
// partial-Ivy declarations linked at app-build time, so it's meant to be
// version-independent across its `>=21 <23` peer range — this is how CI proves it.
//
// Usage:  node scripts/set-angular-version.mjs <major>
//   e.g.  node scripts/set-angular-version.mjs 22
//
// It rewrites the `overrides:` block in pnpm-workspace.yaml (pnpm 10+ no longer
// reads `pnpm.overrides` from package.json) to pin the whole Angular toolchain — framework
// packages plus `@angular/compiler-cli` (the AOT compiler + linker) and
// `@ngtools/webpack` (the AOT loader) — to the given major's latest, so a
// `pnpm install --no-frozen-lockfile` resolves a coherent set. `@ngtools/
// webpack` tracks the Angular CLI, whose patch version differs from the
// framework's, so both are pinned by caret range (`^<major>`) and let pnpm
// resolve the newest matching release.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const major = process.argv[2];
if (!/^\d+$/.test(major ?? '')) {
  console.error('usage: node scripts/set-angular-version.mjs <major>   (e.g. 21 or 22)');
  process.exit(1);
}

// The full toolchain angular-lynx touches. Framework packages and
// compiler-cli share the framework version line; @ngtools/webpack is on the
// CLI line (same major, independent patch).
const frameworkPkgs = [
  '@angular/core',
  '@angular/common',
  '@angular/compiler',
  '@angular/compiler-cli',
  '@angular/forms',
  '@angular/router',
  '@angular/localize',
  // Not used by angular-lynx's own bootstrap (it deliberately avoids the
  // browser platform — see docs/07-verifying.md), but pinned so pnpm resolves
  // a coherent tree without cross-major peer warnings.
  '@angular/platform-browser',
];
const range = `^${major}.0.0`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspacePath = path.join(root, 'pnpm-workspace.yaml');
const workspace = readFileSync(workspacePath, 'utf8');

const overrides = {};
for (const name of frameworkPkgs) overrides[name] = range;
overrides['@ngtools/webpack'] = range;
// Angular's compiler pins the TypeScript it accepts: 22 needs 6.0.
overrides.typescript = Number(major) >= 22 ? '~6.0.0' : '~5.9.0';

const block = `overrides:\n${Object.entries(overrides)
  .map(([name, version]) => `  '${name}': '${version}'`)
  .join('\n')}\n`;
// The existing block: `overrides:` and every indented line under it.
const existing = /^overrides:\n(?:[ \t]+.*\n?)*/m;
const next = existing.test(workspace)
  ? workspace.replace(existing, block)
  : `${workspace.trimEnd()}\n\n${block}`;

writeFileSync(workspacePath, next);
console.log(
  `Pinned Angular toolchain to ${range} (${frameworkPkgs.length} framework pkgs + @ngtools/webpack) `
    + 'in pnpm-workspace.yaml. Run: pnpm install --no-frozen-lockfile',
);
