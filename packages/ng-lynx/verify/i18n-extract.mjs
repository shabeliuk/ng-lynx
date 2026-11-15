// Verify the i18n message extractor (bin/extract-i18n.mjs, docs/35-i18n.md) —
// the `ng extract-i18n` equivalent for ng-lynx.
//
// Unlike the mock-PAPI harnesses this exercises the real extraction path
// (esbuild TS→JS + `@angular/localize/tools`' MessageExtractor) over the
// examples/i18n source, and ties it back to the actual translate pipeline:
//
//   1. Every `$localize` message in the source is extracted, with the right id
//      and source text.
//   2. The interpolated `greeting` message keeps its `{$name}` placeholder.
//   3. The extracted template is valid SimpleJson — it parses with the SAME
//      `SimpleJsonTranslationParser` that `pluginAngularLynx({ i18n })` uses to
//      read a translation file, so an extracted template is directly fillable.
//   4. The extracted ids exactly match the hand-authored uk.json's keys — i.e.
//      a translator handed this template would produce a file the translate
//      pipeline (verified by verify:i18n) already consumes.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractI18nMessages, toSimpleJson } from '../bin/extract-i18n.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const srcDir = path.join(repoRoot, 'examples/i18n/src');
const ukPath = path.join(srcDir, 'locales/uk.json');

let passed = 0;
function assert(cond, label) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`  ✓ ${label}`);
}

console.log('\n=== Extract $localize messages from examples/i18n/src ===');
const { messages, conflicts } = extractI18nMessages(srcDir);

assert(conflicts.length === 0, `no conflicting duplicate ids (got ${conflicts.length})`);

const expected = {
  title: 'Welcome',
  subtitle: 'Tap the button below to say hello back.',
  sayHelloButton: 'Say hello',
  greeting: 'Hello, {$name}!',
  helloBack: 'Hello to you too!',
  language: 'Language: English',
  about:
    "This screen was translated when the app was built, not on your phone. npm run dev builds it in English and npm run dev:ua in Ukrainian. Each bundle holds one language, so changing the phone's language changes nothing here. The greeting puts a name into a translated sentence.",
};
assert(messages.size === Object.keys(expected).length, `extracted ${Object.keys(expected).length} messages (got ${messages.size})`);
for (const [id, text] of Object.entries(expected)) {
  assert(messages.get(id) === text, `message "${id}" = ${JSON.stringify(text)}`);
}
assert(messages.get('greeting').includes('{$name}'), 'the greeting keeps its {$name} placeholder');

console.log('\n=== Extracted template is valid, plugin-consumable SimpleJson ===');
const json = toSimpleJson(messages, 'en');
const { SimpleJsonTranslationParser } = await import('@angular/localize/tools');
const parser = new SimpleJsonTranslationParser();
const analysis = parser.analyze('messages.json', json);
assert(analysis.canParse, 'output parses with SimpleJsonTranslationParser (same parser the plugin uses)');
const parsed = parser.parse('messages.json', json, analysis.hint);
assert(parsed.locale === 'en', `parsed locale is "en" (got ${JSON.stringify(parsed.locale)})`);
assert(Object.keys(parsed.translations).length === messages.size, 'all messages survived the round-trip');

console.log('\n=== Extracted ids match the hand-authored uk.json keys ===');
const uk = JSON.parse(readFileSync(ukPath, 'utf8'));
const extractedIds = [...messages.keys()].sort();
const ukIds = Object.keys(uk.translations).sort();
assert(
  JSON.stringify(extractedIds) === JSON.stringify(ukIds),
  `extracted ids === uk.json keys (${extractedIds.join(', ')})`,
);

// The `i18n="..."` template attribute is the *other* supported message form
// (docs/35-i18n.md). It never becomes a `$localize` call without a full
// template compile, so it needs its own extraction path — these assertions are
// what keeps that path honest. Driven from a temp fixture rather than
// examples/i18n so the assertions above (which pin that example's exact
// message set) stay meaningful.
console.log('\n=== `i18n=` template attributes are extracted too ===');
const fixture = mkdtempSync(path.join(tmpdir(), 'ng-lynx-i18n-attr-'));
writeFileSync(
  path.join(fixture, 'a.component.ts'),
  [
    `import { Component } from '@angular/core';`,
    `@Component({`,
    `  selector: 'app-a',`,
    '  template: `',
    `    <view>`,
    `      <text i18n="@@attrTitle">Attribute Title</text>`,
    `      <text i18n="An instruction@@attrSub">Tap below.</text>`,
    `      <text i18n="@@attrGreet">Hello, {{ name() }}!</text>`,
    `      <view i18n-alt="@@attrAlt" alt="A picture"></view>`,
    `      @if (flag()) { <text i18n="@@inIfBlock">Inside a block</text> }`,
    `      <text>untranslated</text>`,
    `    </view>`,
    '  `,',
    `})`,
    `export class AComponent {`,
    '  readonly tsMessage = $localize`:@@tsOnly:From TypeScript`;',
    `}`,
  ].join('\n'),
);
// A component whose template lives in a separate file, referenced by templateUrl.
writeFileSync(
  path.join(fixture, 'b.component.ts'),
  [
    `import { Component } from '@angular/core';`,
    `@Component({ selector: 'app-b', templateUrl: './b.html' })`,
    `export class BComponent {}`,
  ].join('\n'),
);
writeFileSync(
  path.join(fixture, 'b.html'),
  `<text i18n="@@fromTemplateUrl">From a templateUrl file</text>\n`,
);

const attr = extractI18nMessages(fixture);
assert(attr.warnings.length === 0, `no extraction warnings (got ${JSON.stringify(attr.warnings)})`);
assert(attr.conflicts.length === 0, `no conflicting ids (got ${attr.conflicts.length})`);

const expectedAttr = {
  // Both forms land in one output — a `$localize` field alongside attributes.
  tsOnly: 'From TypeScript',
  attrTitle: 'Attribute Title',
  // The `description@@id` form: only the id becomes the key.
  attrSub: 'Tap below.',
  // An interpolation becomes a placeholder, exactly as `$localize` would emit.
  attrGreet: 'Hello, {$INTERPOLATION}!',
  // `i18n-<attr>` translates an attribute's value, not element content.
  attrAlt: 'A picture',
  // Control-flow blocks (@if/@for/@defer) are walked, not skipped.
  inIfBlock: 'Inside a block',
  // A templateUrl file is resolved relative to its component and read.
  fromTemplateUrl: 'From a templateUrl file',
};
assert(
  attr.messages.size === Object.keys(expectedAttr).length,
  `extracted ${Object.keys(expectedAttr).length} messages across both forms (got ${attr.messages.size})`,
);
for (const [id, text] of Object.entries(expectedAttr)) {
  assert(attr.messages.get(id) === text, `message "${id}" = ${JSON.stringify(text)}`);
}
// The untranslated `<text>` must NOT appear — only i18n-marked nodes are messages.
assert(
  ![...attr.messages.values()].includes('untranslated'),
  'text without an i18n marker is not extracted',
);

console.log(`\ni18n-extract: all ${passed} assertions passed`);
