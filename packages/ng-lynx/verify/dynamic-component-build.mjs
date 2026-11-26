// Verify the dynamic-component PRODUCER build mode
// (`pluginAngularLynx({ dynamicComponent: true })`, docs/38-dynamic-component.md).
//
// Unlike the harness-*.ts suite (esbuild + mock PAPI), this needs the real
// rspack/rspeedy pipeline: externals, the runtime wrapper, the library export
// and the lazy-bundle packaging are all build-time concerns. So it runs a real
// `rspeedy build` of examples/dynamic-component's producer config and asserts
// on the emitted artifacts:
//
//   1. The plugin's duplicated shared-runtime convention still matches the
//      runtime's own (they can't be imported across the build boundary, so a
//      drift here would silently produce a bundle that resolves `undefined`
//      for Angular).
//   2. The framework is genuinely EXTERNALIZED, not bundled: the chunk reads
//      `lynx[Symbol.for('__ANGULAR_LYNX_EXPORTS__(…)')]` for the shared ids
//      and contains none of Angular's own implementation. This is the whole
//      point of the mode — a bundled second copy fails at runtime with
//      NG0203 even at an identical version (docs/38).
//   3. The Main-Thread part is the no-op stub: it must NOT re-register
//      `renderPage`/`ngPatchUpdate`, which belong to the host.
//   4. The packaged artifact exists and is far smaller than an app bundle.
//
// Then it hands the built chunk to `harness-dynamic-component-load.ts`, which
// evaluates it the way the engine does and mounts it in a real host app —
// the end-to-end proof that the artifact is actually loadable.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const repoRoot = path.resolve(pkgRoot, '../..');
const exampleDir = path.join(repoRoot, 'examples/dynamic-component');

// Both builds go to a temp folder, through configs that wrap the example's own.
// Never the example's `dist/` or `dist-remote/`: its dev server writes and
// serves those, and a build there breaks a session someone has open.
const outRoot = mkdtempSync(path.join(tmpdir(), 'ng-lynx-dynamic-component-'));
const remoteDir = path.join(outRoot, 'remote');
const hostDir = path.join(outRoot, 'host');
function wrapConfig(name, config, distRoot) {
  const file = path.join(outRoot, name);
  writeFileSync(
    file,
    `import base from ${JSON.stringify(path.join(exampleDir, config))};\n` +
      `export default { ...base, output: { ...base.output, distPath: { root: ${JSON.stringify(distRoot)} } } };\n`,
  );
  return file;
}

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

// --- 1. the duplicated convention still agrees -----------------------------
console.log('\n=== Plugin and runtime agree on the shared-runtime convention ===');
const { DEFAULT_SHARED_MODULES, sharedModuleExpression } = await import(
  path.join(pkgRoot, 'runtime/dist/shared-runtime.js')
);
const pluginSource = readFileSync(path.join(pkgRoot, 'plugin/dist/index.js'), 'utf8');
// The plugin's own copies, read straight out of its compiled output.
const pluginList = /DEFAULT_SHARED_MODULES = \[([^\]]*)\]/.exec(pluginSource)?.[1] ?? '';
const pluginIds = [...pluginList.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
assert(
  JSON.stringify(pluginIds) === JSON.stringify([...DEFAULT_SHARED_MODULES]),
  `default shared module lists match (${pluginIds.join(', ')})`,
);
const pluginExprFn = /function sharedModuleExpression\(moduleId\) \{([\s\S]*?)\n\}/.exec(pluginSource)?.[1] ?? '';
// Re-create the plugin's expression builder from its own compiled body and
// compare against the runtime's for a representative id.
const pluginExpr = new Function('moduleId', pluginExprFn)('@angular/core');
assert(
  pluginExpr === sharedModuleExpression('@angular/core'),
  'both sides build the identical external expression for a shared module',
);

// --- 2. build the producer ------------------------------------------------
console.log('\n=== Building the standalone dynamic-component bundle ===');
// `--mode development` so the un-packaged intermediates survive on disk (a
// production build cleans them); the mode doesn't change externals, the
// runtime wrapper, or the packaging under test here.
// NG_LYNX_DEBUG_DYNAMIC_CSS: the plugin says what its CSS-section tap saw. Kept, and repeated
// next to the CSS checks below, since a CI log shows only a harness's last lines.
const producerLog = execFileSync(
  'npx',
  ['rspeedy', 'build', '--config', wrapConfig('producer.config.ts', 'lynx.config.producer.ts', remoteDir), '--mode', 'development'],
  { cwd: exampleDir, stdio: ['inherit', 'pipe', 'inherit'], env: { ...process.env, NG_LYNX_DEBUG_DYNAMIC_CSS: '1' } },
).toString();
process.stdout.write(producerLog);
const dynamicCssLog = producerLog.split('\n').filter((line) => line.includes('[ng-lynx] dynamic-css:'));

const bgChunk = path.join(remoteDir, '.rspeedy/remote/background.js');
const mtChunk = path.join(remoteDir, '.rspeedy/remote/main-thread.js');
const packaged = path.join(remoteDir, 'remote.lynx.bundle');
assert(existsSync(bgChunk), 'the producer emitted a Background chunk');
assert(existsSync(packaged), 'the producer emitted a packaged remote.lynx.bundle');

const bg = readFileSync(bgChunk, 'utf8');
// Snapshot the built chunk for the load test below.
const bgSnapshot = path.join(tmpdir(), `ng-lynx-dynamic-component-${process.pid}.js`);
writeFileSync(bgSnapshot, bg);

// --- 3. the framework is externalized, not bundled -------------------------
console.log('\n=== The framework is shared from the host, not bundled ===');
for (const id of ['@angular/core', 'ng-lynx/elements']) {
  assert(
    bg.includes(`__ANGULAR_LYNX_EXPORTS__(${id})`),
    `"${id}" resolves through the shared registry`,
  );
}
// Angular's own implementation must be absent. These identifiers exist only
// in @angular/core's source, never in a component's compiled output — a
// component only *references* core via the external namespace.
for (const marker of ['R3Injector', 'createInjector', 'ApplicationRef', 'NG0203']) {
  assert(!bg.includes(marker), `no bundled copy of Angular's implementation (${marker} absent)`);
}
assert(
  !bg.includes('LynxStandardElement'),
  "no bundled copy of ng-lynx/elements either (it's shared too)",
);
// Sanity: the component's OWN compiled output is present.
assert(bg.includes('Loaded from a separate bundle'), "the component's own template IS in the bundle");

// --- 4. the Main-Thread part is an inert stub ------------------------------
console.log('\n=== The Main-Thread part is a no-op (the host owns the executor) ===');
const mt = readFileSync(mtChunk, 'utf8');
assert(
  !mt.includes('ngPatchUpdate') && !mt.includes('__CreatePage'),
  'it registers no renderPage/ngPatchUpdate and creates no page — it cannot clobber the host',
);

// --- 5. size sanity --------------------------------------------------------
const packagedSize = statSync(packaged).size;
assert(
  packagedSize < 200_000,
  `the packaged bundle is small (${(packagedSize / 1024).toFixed(0)} kB — an app bundle carrying its own Angular is several hundred kB)`,
);

// --- 5b. the fetch-bundle packaging ---------------------------------------
console.log('\n=== The same component, packaged for lynx.fetchBundle ===');
const fetchDir = path.join(outRoot, 'remote-fetch');
execFileSync(
  'npx',
  ['rspeedy', 'build', '--config', wrapConfig('producer-fetch.config.ts', 'lynx.config.producer-fetch.ts', fetchDir), '--mode', 'development'],
  { cwd: exampleDir, stdio: 'inherit' },
);
const fetchPackaged = path.join(fetchDir, 'remote-fetch.lynx.bundle');
assert(existsSync(fetchPackaged), 'dynamicComponentFetcher: "fetch-bundle" emitted remote-fetch.lynx.bundle');
const fetchTasm = path.join(fetchDir, '.rspeedy/remote-fetch/tasm.json');
assert(existsSync(fetchTasm), 'and its tasm.json, to read the sections from');
const sections = Object.keys(JSON.parse(readFileSync(fetchTasm, 'utf8')).customSections ?? {});
// The names lynx.loadScript is asked for: loadDynamicComponent reads 'background', ReactLynx's loader
// reads all three.
assert(sections.includes('background'), `the bundle has a "background" section (${sections.join(', ')})`);
assert(sections.includes('main-thread'), 'and a "main-thread" section');
const fetchBg = readFileSync(path.join(fetchDir, '.rspeedy/remote-fetch/background.js'), 'utf8');
assert(fetchBg.includes('Loaded from a separate bundle'), "the component's own template is in it");
assert(
  fetchBg.includes('__ANGULAR_LYNX_EXPORTS__(@angular/core)') && !fetchBg.includes('R3Injector'),
  'it shares Angular with the host here too, rather than bundling it',
);
const queryTasm = JSON.parse(readFileSync(path.join(remoteDir, '.rspeedy/remote/tasm.json'), 'utf8'));
console.log(`  (the CSS-section tap: ${dynamicCssLog.length ? dynamicCssLog.join(' | ') : 'never ran'}; default packaging's sections: ${
  Object.keys(queryTasm.customSections ?? {}).join(', ') || 'none'
}; its style info: ${Object.keys(queryTasm.css?.cssMap ?? {}).length} css id(s))`);
// The card imports its own stylesheet (remote-card.css). Both packagings carry it as a CSS section
// the host adopts, and nothing else is a section in the default one.
assert(sections.includes('CSS'), "the fetch-bundle packaging carries the card's own CSS as a CSS section");
assert(
  Object.keys(queryTasm.customSections ?? {}).join() === 'CSS',
  'the default packaging has only that CSS section, and no background or main-thread one: the formats are not mixed up',
);
const ruleSelectors = (tasm) =>
  (tasm.customSections?.CSS?.content?.ruleList ?? []).map((rule) => rule.selectorText?.value).filter(Boolean);
assert(
  ruleSelectors(queryTasm).includes('.remote-note') && ruleSelectors(queryTasm).join() === ruleSelectors(JSON.parse(readFileSync(fetchTasm, 'utf8'))).join(),
  'the same rules in both (.remote-note from remote-card.css)',
);
assert(
  Object.keys(queryTasm.css?.cssMap ?? {}).length > 0,
  "and the default packaging still has the template's own style info, as before",
);

// --- 6. the HOST side publishes what the producer externalizes -------------
console.log('\n=== Building the host (dynamicComponentHost: true) ===');
execFileSync('npx', ['rspeedy', 'build', '--config', wrapConfig('host.config.ts', 'lynx.config.ts', hostDir), '--mode', 'development'], {
  cwd: exampleDir,
  stdio: 'inherit',
});
const hostChunk = path.join(hostDir, '.rspeedy/main/background.js');
assert(existsSync(hostChunk), 'the host emitted a Background chunk');
const hostBg = readFileSync(hostChunk, 'utf8');
for (const id of DEFAULT_SHARED_MODULES) {
  assert(
    hostBg.includes(`publishSharedModule)("${id}"`) || hostBg.includes(`publishSharedModule("${id}"`),
    `the host publishes "${id}" — exactly what the producer externalizes`,
  );
}
// The host must carry the REAL framework (it's the instance being shared);
// only the producer externalizes.
assert(
  hostBg.includes('R3Injector') && hostBg.includes('ApplicationRef'),
  "the host bundles Angular itself — it's the instance everything else borrows",
);

if (failures > 0) {
  console.error(`\n❌ ${failures} dynamic-component build assertion(s) failed.\n`);
  process.exit(1);
}

// --- 7. end-to-end: load the artifact into a real host ---------------------
console.log('\n=== Loading the built artifact into a real host app ===');
execFileSync('node', [path.join(here, 'build.mjs'), 'harness-dynamic-component-load.ts'], {
  cwd: pkgRoot,
  stdio: 'inherit',
  env: { ...process.env, DYNAMIC_BUNDLE_JS: bgSnapshot },
});

rmSync(bgSnapshot, { force: true });
rmSync(outRoot, { recursive: true, force: true });
console.log('\n✅ Dynamic-component producer build verified end-to-end.\n');
