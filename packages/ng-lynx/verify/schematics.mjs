// Verify the `ng-add` and `lynx-component` schematics (roadmap item 6,
// docs/21-scaffolding.md).
//
// Two layers, matching the codebase's verification conventions:
//
//   1. Headless assertions via @angular-devkit/schematics/testing's
//      SchematicTestRunner, pointed at the SOURCE collection.json (which
//      references the already-built `dist/` factories — run `npm run build`
//      first). Covers both schematics' logic thoroughly: file generation,
//      package.json merging (idempotent, preserves existing scripts/deps,
//      aligns @angular/compiler-cli to the workspace's @angular/core
//      version), .gitignore handling, name-collision guards, and
//      lynx-component's --flat/--skip-css options.
//   2. One REAL build smoke test for the one genuinely uncertain empirical
//      claim: that `rspeedy --root <dir>` actually resolves `source.entry`
//      relative to `<dir>` rather than the invoking cwd (this matters
//      because ng-add's npm scripts run with cwd = workspace root, while
//      lynx.config.ts + src/ live in a subdirectory). Materializes the
//      schematic's generated files into a scratch folder inside
//      examples/router (already `pnpm install`ed, with ng-lynx/
//      @lynx-js/rspeedy resolvable) and runs a real `rspeedy build` against
//      them — no separate npm install needed.
import { Tree } from '@angular-devkit/schematics';
import { SchematicTestRunner } from '@angular-devkit/schematics/testing/index.js';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const collectionPath = path.join(repoRoot, 'schematics/collection.json');

let passed = 0;
function assert(cond, label) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✓ ${label}`);
}
async function assertThrows(fn, label) {
  try {
    await fn();
    console.error(`✗ ${label} (did not throw)`);
    process.exit(1);
  } catch {
    passed += 1;
    console.log(`✓ ${label}`);
  }
}

function fixtureTree(pkgOverrides = {}) {
  const tree = Tree.empty();
  const pkg = {
    name: 'demo-app',
    version: '0.0.0',
    dependencies: { '@angular/core': '^21.2.0' },
    devDependencies: {},
    scripts: { start: 'ng serve' },
    ...pkgOverrides,
  };
  tree.create('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  return tree;
}

const runner = new SchematicTestRunner('ng-lynx', collectionPath);

// -- ng-add: defaults ---------------------------------------------------------
{
  const tree = await runner.runSchematic('ng-add', {}, fixtureTree());
  assert(tree.exists('lynx/lynx.config.mts'), 'ng-add creates lynx/lynx.config.mts (default directory; .mts since the workspace is not ESM)');
  assert(tree.exists('lynx/tsconfig.json'), 'ng-add creates lynx/tsconfig.json');
  assert(tree.exists('lynx/src/index.ts'), 'ng-add creates lynx/src/index.ts');
  assert(tree.exists('lynx/src/app.component.ts'), 'ng-add creates lynx/src/app.component.ts');
  assert(tree.exists('lynx/src/app.css'), 'ng-add creates lynx/src/app.css');
  assert(tree.exists('lynx/src/rspeedy-env.d.ts'), 'ng-add creates lynx/src/rspeedy-env.d.ts');
  assert(
    tree.readContent('lynx/src/app.component.ts').includes('demo-app'),
    'app.component.ts interpolates the workspace package name',
  );
  assert(
    tree.readContent('lynx/lynx.config.mts').includes("entry: {\n      main: './src/index.ts',"),
    'lynx.config.mts points its entry at ./src/index.ts',
  );

  const pkg = JSON.parse(tree.readContent('package.json'));
  assert(
    pkg.scripts['lynx:dev'] === 'rspeedy dev --root lynx --config lynx.config.mts',
    'adds lynx:dev script (--config relative to --root, confirmed empirically — see below)',
  );
  assert(
    pkg.scripts['lynx:build'] === 'rspeedy build --root lynx --config lynx.config.mts',
    'adds lynx:build script (--config relative to --root)',
  );
  assert(
    tree.readContent('lynx/lynx.config.mts').includes("tsconfig: 'lynx/tsconfig.json'"),
    "lynx.config.mts pins tsconfig explicitly, workspace-root-relative (npm scripts' cwd)",
  );
  assert(pkg.scripts.start === 'ng serve', 'existing scripts are preserved');
  for (const dep of ['@lynx-js/rspeedy', '@lynx-js/qrcode-rsbuild-plugin', '@angular/compiler-cli', '@ngtools/webpack']) {
    assert(typeof pkg.devDependencies[dep] === 'string', `adds devDependency ${dep}`);
  }
  assert(
    pkg.devDependencies['@angular/compiler-cli'] === '^21.2.0',
    "aligns @angular/compiler-cli to the workspace's @angular/core version",
  );
  assert(
    tree.exists('.gitignore') && tree.readContent('.gitignore').includes('lynx/dist/'),
    'creates .gitignore with lynx/dist/',
  );
}

// -- ng-add: an ESM workspace keeps .ts --------------------------------------------
{
  const tree = await runner.runSchematic('ng-add', {}, fixtureTree({ type: 'module' }));
  assert(tree.exists('lynx/lynx.config.ts') && !tree.exists('lynx/lynx.config.mts'), 'a "type": "module" workspace gets lynx.config.ts');
  const pkg = JSON.parse(tree.readContent('package.json'));
  assert(pkg.scripts['lynx:dev'] === 'rspeedy dev --root lynx --config lynx.config.ts', 'and its scripts name lynx.config.ts');
}

// -- ng-add: custom directory -------------------------------------------------
{
  const tree = await runner.runSchematic('ng-add', { directory: 'mobile' }, fixtureTree());
  assert(tree.exists('mobile/lynx.config.mts'), '--directory mobile scaffolds into mobile/ instead of lynx/');
  assert(!tree.exists('lynx/lynx.config.mts'), '--directory mobile does not also create lynx/');
}

// -- ng-add: preserves an existing devDependency pin -------------------------
{
  const tree = await runner.runSchematic(
    'ng-add',
    {},
    fixtureTree({ devDependencies: { '@lynx-js/rspeedy': '0.14.2' } }),
  );
  const pkg = JSON.parse(tree.readContent('package.json'));
  assert(
    pkg.devDependencies['@lynx-js/rspeedy'] === '0.14.2',
    'does not overwrite an already-pinned devDependency version',
  );
}

// -- ng-add: idempotency + error paths ---------------------------------------
{
  const first = await runner.runSchematic('ng-add', {}, fixtureTree());
  await assertThrows(
    () => runner.runSchematic('ng-add', {}, first),
    're-running ng-add on the same tree throws (directory already exists)',
  );
}
await assertThrows(
  () => runner.runSchematic('ng-add', {}, Tree.empty()),
  'ng-add throws without a package.json at the workspace root',
);
await assertThrows(
  () => runner.runSchematic('ng-add', { directory: '../escape' }, fixtureTree()),
  'ng-add rejects a --directory that escapes the workspace root',
);

// -- lynx-component: defaults -------------------------------------------------
{
  const tree = await runner.runSchematic('lynx-component', { name: 'product-card' }, fixtureTree());
  assert(tree.exists('src/product-card.component.ts'), 'lynx-component creates src/product-card.component.ts (flat)');
  assert(tree.exists('src/product-card.component.css'), 'lynx-component creates a companion .css file by default');
  const content = tree.readContent('src/product-card.component.ts');
  assert(content.includes("selector: 'product-card'"), 'dasherizes a multi-word name into the selector');
  assert(content.includes('export class ProductCardComponent'), 'classifies the name into the component class');
  assert(content.includes("import './product-card.component.css'"), 'imports the companion CSS file');
  assert(content.includes('LYNX_ELEMENTS'), 'imports LYNX_ELEMENTS for typed templates');
}

// -- lynx-component: --path, --flat=false, --skip-css ------------------------
{
  const tree = await runner.runSchematic(
    'lynx-component',
    { name: 'Widget', path: 'app', flat: false, skipCss: true },
    fixtureTree(),
  );
  assert(tree.exists('app/widget/widget.component.ts'), '--flat=false nests the component in its own subfolder');
  assert(!tree.exists('app/widget/widget.component.css'), '--skip-css skips the companion CSS file');
  assert(
    !tree.readContent('app/widget/widget.component.ts').includes(".component.css'"),
    '--skip-css also omits the CSS import line',
  );
}

// -- lynx-component: error paths ---------------------------------------------
await assertThrows(
  () => runner.runSchematic('lynx-component', {}, fixtureTree()),
  'lynx-component throws without a name',
);
{
  const seeded = fixtureTree();
  seeded.create('src/dup.component.ts', '// existing file');
  await assertThrows(
    () => runner.runSchematic('lynx-component', { name: 'dup' }, seeded),
    'lynx-component throws on a name collision',
  );
}

console.log(`\n${passed} headless assertions passed. Running the real build smoke test…\n`);

// -- real build smoke test: --root actually resolves entry relative to it ---
const routerDir = path.join(repoRoot, '../../examples/router');
const scratchName = '_ng-add-smoke';
const scratchDir = path.join(routerDir, scratchName);
rmSync(scratchDir, { recursive: true, force: true });

const generated = await runner.runSchematic('ng-add', { directory: scratchName }, fixtureTree());
for (const file of generated.files.filter((f) => f.startsWith(`/${scratchName}/`))) {
  const rel = file.slice(1); // strip leading '/'
  const dest = path.join(routerDir, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, generated.readContent(file));
}
assert(existsSync(path.join(scratchDir, 'lynx.config.mts')), 'materialized the generated lynx.config.mts onto disk');

try {
  execFileSync(
    './node_modules/.bin/rspeedy',
    ['build', '--root', scratchName, '--config', 'lynx.config.mts'],
    { cwd: routerDir, stdio: 'pipe' },
  );
  assert(
    existsSync(path.join(scratchDir, 'dist/main.lynx.bundle')) && existsSync(path.join(scratchDir, 'dist/main.web.bundle')),
    'a real `rspeedy build --root <dir> --config lynx.config.mts` (cwd = workspace root) finds src/index.ts and produces both bundles',
  );
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}

console.log(`\nschematics: all ${passed} assertions passed`);
