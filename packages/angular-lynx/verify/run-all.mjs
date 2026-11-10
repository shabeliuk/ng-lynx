// Runs every `verify:*` script in package.json sequentially and reports a
// pass/fail summary — the single command CI (and humans) use to run the whole
// headless suite. Exits non-zero if any harness fails.
//
// Env:
//   VERIFY_ONLY=a,b   run only these harness names (the part after `verify:`)
//   VERIFY_SKIP=a,b   skip these harness names
//   VERIFY_LIST=1     print the harness list and exit (no runs)
//
// The three "heavy" harnesses (i18n, lazy-chunks, schematics) run a real
// rspeedy/schematics build and are much slower than the mock-PAPI ones; they
// still run by default, but `VERIFY_SKIP=i18n,lazy-chunks` gives a fast inner
// loop when iterating on runtime code.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).scripts;

const parse = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const only = new Set(parse(process.env.VERIFY_ONLY));
const skip = new Set(parse(process.env.VERIFY_SKIP));

const all = Object.keys(scripts)
  .filter((k) => k.startsWith('verify:') && k !== 'verify:all')
  .map((k) => k.slice('verify:'.length))
  .filter((name) => (only.size === 0 || only.has(name)) && !skip.has(name));

if (process.env.VERIFY_LIST) {
  console.log(all.join('\n'));
  process.exit(0);
}

console.log(`Running ${all.length} verify harness(es)…\n`);

const failures = [];
const started = Date.now();
for (const name of all) {
  const cmd = scripts[`verify:${name}`];
  const t0 = Date.now();
  process.stdout.write(`▶ verify:${name} … `);
  try {
    execSync(cmd, { cwd: pkgDir, stdio: 'pipe' });
    console.log(`ok (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    console.log(`FAIL (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    // Surface the harness's own output so CI logs show the actual assertion.
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    console.error(out.split('\n').slice(-40).join('\n'));
    failures.push(name);
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${'─'.repeat(48)}`);
if (failures.length === 0) {
  console.log(`✅ All ${all.length} verify harnesses passed (${secs}s).`);
  process.exit(0);
}
console.log(`❌ ${failures.length}/${all.length} failed (${secs}s): ${failures.join(', ')}`);
process.exit(1);
