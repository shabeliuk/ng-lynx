// Verify build-time i18n (docs/35-i18n.md, roadmap-next item 20).
//
// Unlike the harness-*.ts suite (esbuild + mock PAPI), inlining translations
// into `$localize` calls is a real build-pipeline concern (a babel-loader
// stage wired into rspeedy's bundler chain) — there's no PAPI behavior to
// mock here. So this runs two real `rspeedy build`s of examples/i18n (the
// default source-locale config, and lynx.config.uk.ts's Ukrainian-translated
// config) and asserts directly on the packaged bundle content:
//
//   1. Both builds produce a main.web.bundle (dist/ and dist-uk/).
//   2. The source-locale bundle still has the original English text.
//   3. The uk bundle has the real Ukrainian translations in their place —
//      including the interpolated `greeting` message ($localize with a
//      substituted `{$name}` placeholder) — and does NOT still contain the
//      untranslated English source strings (proves substitution actually
//      happened, not just that translated text was appended somewhere).
//
// Bundles are read as 'utf8' (not 'latin1', unlike lazy-chunks.mjs's binary
// asset checks): Node's UTF-8 decoder is lenient about the binary/wide-char
// header preceding the JS payload (docs/35-i18n.md) — it doesn't throw, it
// just produces replacement characters for the header's non-UTF-8 bytes —
// and 'utf8' is required here to compare against real Cyrillic string
// literals (a 'latin1' read reinterprets each UTF-8 byte as its own
// character, which byte-for-byte round-trips ASCII text but never matches a
// genuine multi-byte Cyrillic string literal in this very file).
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const exampleDir = path.join(repoRoot, 'examples/i18n');
const distDir = path.join(exampleDir, 'dist');
const distUkDir = path.join(exampleDir, 'dist-uk');

let passed = 0;
function assert(cond, label) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✓ ${label}`);
}

if (process.env.SKIP_BUILD !== '1') {
  console.log('building examples/i18n — source locale (default config)…');
  execFileSync('npx', ['rspeedy', 'build'], { cwd: exampleDir, stdio: 'inherit' });
  console.log('building examples/i18n — uk locale (lynx.config.uk.ts)…');
  execFileSync('npx', ['rspeedy', 'build', '--config', 'lynx.config.uk.ts'], {
    cwd: exampleDir,
    stdio: 'inherit',
  });
}

assert(existsSync(distDir), 'dist/ (source locale) exists');
assert(existsSync(distUkDir), 'dist-uk/ (uk locale) exists');

const sourceBundle = readFileSync(path.join(distDir, 'main.web.bundle'), 'utf8');
const ukBundle = readFileSync(path.join(distUkDir, 'main.web.bundle'), 'utf8');

// -- source-locale build: original English text, evaluated by the real
// runtime `$localize` (not build-time inlined, since no `i18n` option is set
// on that config) --------------------------------------------------------
assert(sourceBundle.includes('Welcome'), 'source-locale bundle has the English "Welcome" title');
assert(
  sourceBundle.includes('Tap the button below to say hello back.'),
  'source-locale bundle has the English subtitle',
);
assert(sourceBundle.includes('Say hello'), 'source-locale bundle has the English button label');
assert(sourceBundle.includes('Hello to you too!'), 'source-locale bundle has the English response text');

// -- uk build: translations inlined, English source text gone ------------
const ukTranslations = {
  'title → Ласкаво просимо': 'Ласкаво просимо',
  'subtitle → Натисніть кнопку нижче…': 'Натисніть кнопку нижче, щоб привітатися у відповідь.',
  'sayHelloButton → Привітатися': 'Привітатися',
  'helloBack → Привіт і тобі!': 'Привіт і тобі!',
};
for (const [label, text] of Object.entries(ukTranslations)) {
  assert(ukBundle.includes(text), `uk bundle has the translated string (${label})`);
}
// `greeting` interpolates `$name` — check the translated template's static
// parts survive around the (still-dynamic) name substitution.
assert(ukBundle.includes('Привіт, '), 'uk bundle has the translated greeting template ("Привіт, ")');

assert(!ukBundle.includes('Welcome'), 'uk bundle does NOT still contain the untranslated English "Welcome"');
assert(
  !ukBundle.includes('Tap the button below to say hello back.'),
  'uk bundle does NOT still contain the untranslated English subtitle',
);
assert(!ukBundle.includes('Hello to you too!'), 'uk bundle does NOT still contain the untranslated English response');

console.log(`\ni18n-build: all ${passed} assertions passed`);
