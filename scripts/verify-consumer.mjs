// The flow a user goes through, against what npm would really publish: pack the
// package, scaffold each create-angular-lynx template outside this workspace,
// `npm install` the tarball, and build. Then run the Vitest quick start from
// docs/19-testing.md the same way.
//
// Usage:  node scripts/verify-consumer.mjs [angular-major]   (default: the templates' own)
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const major = process.argv[2];
const work = mkdtempSync(path.join(tmpdir(), 'angular-lynx-consumer-'));
const env = { ...process.env, DO_NOT_TRACK: '1' };
const run = (command, cwd) => execSync(command, { cwd, env, stdio: 'pipe', encoding: 'utf8' });

const packed = run(`npm pack --pack-destination ${work} --silent`, path.join(root, 'packages/angular-lynx')).trim().split('\n').pop();
const tarball = path.join(work, packed);

function pin(pkg) {
  pkg.dependencies['angular-lynx'] = `file:${tarball}`;
  if (!major) return;
  for (const deps of [pkg.dependencies, pkg.devDependencies]) {
    for (const name of Object.keys(deps)) {
      if (/^@angular\/|^@ngtools\//.test(name)) deps[name] = `^${major}.0.0`;
    }
  }
  pkg.devDependencies.typescript = Number(major) >= 22 ? '~6.0.0' : '~5.9.0';
}

const failures = [];
function step(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`✗ ${name}\n${err.stdout ?? ''}${err.stderr ?? err.message}`);
  }
}

for (const template of ['minimal', 'router', 'forms']) {
  const app = path.join(work, template);
  step(`${template}: scaffold, install, build`, () => {
    run(`node ${path.join(root, 'packages/create-angular-lynx/index.mjs')} ${template} --template ${template}`, work);
    const file = path.join(app, 'package.json');
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    pin(pkg);
    writeFileSync(file, JSON.stringify(pkg, null, 2));
    run('npm install --no-audit --no-fund', app);
    run('npm run build', app);
    for (const bundle of ['dist/main.lynx.bundle', 'dist/main.web.bundle']) {
      if (statSync(path.join(app, bundle)).size === 0) throw new Error(`${bundle} is empty`);
    }
  });
}

step('static asset import builds (the quick start imports images)', () => {
  const app = path.join(work, 'minimal');
  mkdirSync(path.join(app, 'src/assets'), { recursive: true });
  writeFileSync(path.join(app, 'src/assets/logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(path.join(app, 'src/logo.ts'), "import logo from './assets/logo.png';\nexport const logoUrl: string = logo;\n");
  const index = path.join(app, 'src/index.ts');
  writeFileSync(index, `${readFileSync(index, 'utf8')}\nimport { logoUrl } from './logo.js';\nconsole.info(logoUrl);\n`);
  run('npm run build', app);
});

step('the Vitest quick start from docs/19-testing.md passes', () => {
  const app = path.join(work, 'vitest');
  mkdirSync(app);
  // The templates' own major when none is given: they're on 22.
  const angularMajor = Number(major ?? 22);
  const version = `^${angularMajor}.0.0`;
  writeFileSync(path.join(app, 'package.json'), JSON.stringify({
    name: 'consumer-vitest',
    private: true,
    type: 'module',
    dependencies: {
      '@angular/common': version,
      '@angular/compiler': version,
      '@angular/core': version,
      'angular-lynx': `file:${tarball}`,
    },
    devDependencies: {
      '@angular/compiler-cli': version,
      '@lynx-js/rspeedy': '^0.18.4',
      typescript: angularMajor >= 22 ? '~6.0.0' : '~5.9.0',
      vitest: '^3.2.0',
    },
  }));
  writeFileSync(path.join(app, 'vitest.config.ts'), `import { defineConfig } from 'vitest/config';
export default defineConfig({
  esbuild: { tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } } },
});
`);
  writeFileSync(path.join(app, 'counter.test.ts'), `import '@angular/compiler';
import 'angular-lynx/main-thread';
import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { renderLynxComponent } from 'angular-lynx/testing';
import { expect, it } from 'vitest';

@Component({
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: '<view class="btn" (tap)="inc()"><text>Count: {{ count() }}</text></view>',
})
class CounterComponent {
  readonly count = signal(0);
  inc() { this.count.update((n) => n + 1); }
}

it('increments on tap', async () => {
  const fixture = await renderLynxComponent(CounterComponent);
  expect(fixture.findText('Count: 0')).toBeDefined();
  await fixture.fire(fixture.findByClass('btn'), 'tap', { detail: { x: 1, y: 1 } });
  expect(fixture.findText('Count: 1')).toBeDefined();
  fixture.destroy();
});
`);
  run('npm install --no-audit --no-fund', app);
  run('npx vitest run', app);
});

step('the Jest quick start from docs/19-testing.md passes', () => {
  const app = path.join(work, 'jest');
  mkdirSync(app);
  const angularMajor = Number(major ?? 22);
  const version = `^${angularMajor}.0.0`;
  writeFileSync(path.join(app, 'package.json'), JSON.stringify({
    name: 'consumer-jest',
    private: true,
    type: 'module',
    dependencies: {
      '@angular/common': version,
      '@angular/compiler': version,
      '@angular/core': version,
      'angular-lynx': `file:${tarball}`,
    },
    devDependencies: {
      '@angular/compiler-cli': version,
      '@lynx-js/rspeedy': '^0.18.4',
      '@swc/core': '^1.7.0',
      '@swc/jest': '^0.2.36',
      jest: '^30.0.0',
      typescript: angularMajor >= 22 ? '~6.0.0' : '~5.9.0',
    },
  }));
  // Angular and angular-lynx are ESM only, so Jest runs in its ESM mode.
  writeFileSync(path.join(app, 'jest.config.js'), `export default {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\\\.ts$': ['@swc/jest', {
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, useDefineForClassFields: false },
        target: 'es2022',
      },
      module: { type: 'es6' },
    }],
  },
};
`);
  writeFileSync(path.join(app, 'counter.test.ts'), `import '@angular/compiler';
import 'angular-lynx/main-thread';
import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { renderLynxComponent } from 'angular-lynx/testing';

@Component({
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: '<view class="btn" (tap)="inc()"><text>Count: {{ count() }}</text></view>',
})
class CounterComponent {
  readonly count = signal(0);
  inc() { this.count.update((n) => n + 1); }
}

it('increments on tap', async () => {
  const fixture = await renderLynxComponent(CounterComponent);
  await fixture.fire(fixture.getByText('Count: 0'), 'tap');
  expect(fixture.queryByText('Count: 1')).not.toBeNull();
  fixture.destroy();
});
`);
  run('npm install --no-audit --no-fund', app);
  run('node --experimental-vm-modules node_modules/jest/bin/jest.js', app);
});

rmSync(work, { recursive: true, force: true });
if (failures.length > 0) {
  console.error(`\n${failures.length} consumer step(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nAll consumer steps passed.');
