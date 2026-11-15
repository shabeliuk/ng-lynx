#!/usr/bin/env node
/**
 * ng-lynx-extract-i18n — the `ng extract-i18n` equivalent for
 * ng-lynx.
 *
 * Scans your app's TypeScript source for translatable messages and writes a
 * translation-file **template** (every message id → its source text) in the
 * `SimpleJsonTranslationParser` format that `pluginAngularLynx({ i18n })`
 * consumes (see docs/35-i18n.md). Hand the template to a translator; the ids
 * stay yours.
 *
 * Usage:
 *   ng-lynx-extract-i18n <srcDir> [--out messages.json] [--locale en]
 *
 *   <srcDir>       directory scanned recursively for .ts files (e.g. ./src)
 *   --out <file>   where to write the template (default: stdout)
 *   --locale <id>  the "locale" field of the output (default: "en")
 *
 * Both message forms ng-lynx supports are extracted (see docs/35-i18n.md):
 *
 *  1. **`$localize` tagged templates in component TypeScript.** These survive a
 *     plain TS→JS transform untouched, so each file is esbuild-transformed to
 *     JS and run through `@angular/localize/tools`' `MessageExtractor`.
 *  2. **`i18n="..."` / `i18n-<attr>="..."` template attributes.** These live
 *     inside a `@Component`'s `template` (or `templateUrl`) and never become
 *     `$localize` calls without a full template compile, so `MessageExtractor`
 *     alone can't see them. Instead the component's decorator is read with the
 *     TypeScript parser and its template handed to `@angular/compiler`'s own
 *     `parseTemplate`, whose i18n-marked nodes carry a `Message` with exactly
 *     the id and `{$PLACEHOLDER}`-shaped source text `$localize` would produce.
 *
 * Either way: no `rspeedy build`, no dev server, no ngtsc invocation.
 */
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import ts from 'typescript';
import { parseTemplate } from '@angular/compiler';
import { MessageExtractor } from '@angular/localize/tools';
import { NodeJSFileSystem, ConsoleLogger, LogLevel } from '@angular/compiler-cli';

import { loadEsbuild } from './load-esbuild.mjs';

const esbuild = await loadEsbuild('ng-lynx-extract-i18n');

/**
 * Every `template` / `templateUrl` reachable from a decorator call in one
 * source file — i.e. `@Component({ template: '…' })` and friends.
 *
 * Scoped to decorator arguments rather than "any object literal with a
 * `template` key" so an unrelated config object never gets fed to the Angular
 * template parser. A `template` built from a template literal *with*
 * substitutions can't be resolved statically (its value depends on runtime
 * expressions), so it's reported as a warning rather than silently skipped.
 */
function componentTemplatesOf(tsFile, sourceText, warnings) {
  const sourceFile = ts.createSourceFile(tsFile, sourceText, ts.ScriptTarget.Latest, true);
  const templates = [];

  const readTemplate = (prop) => {
    const init = prop.initializer;
    // A plain string or a backtick string with no `${}` in it.
    if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
      templates.push({ text: init.text, fileName: tsFile });
    } else {
      warnings.push(
        `${tsFile}: \`template\` isn't a static string (it uses \`\${}\` substitution or a `
          + `reference), so its i18n messages can't be extracted — inline it or move it to a `
          + `templateUrl file.`,
      );
    }
  };

  const readTemplateUrl = (prop) => {
    const init = prop.initializer;
    if (!ts.isStringLiteral(init) && !ts.isNoSubstitutionTemplateLiteral(init)) {
      warnings.push(`${tsFile}: \`templateUrl\` isn't a static string — skipped.`);
      return;
    }
    const htmlPath = path.resolve(path.dirname(tsFile), init.text);
    if (!existsSync(htmlPath)) {
      warnings.push(`${tsFile}: templateUrl "${init.text}" not found at ${htmlPath} — skipped.`);
      return;
    }
    templates.push({ text: readFileSync(htmlPath, 'utf8'), fileName: htmlPath });
  };

  const visit = (node) => {
    if (ts.isDecorator(node) && ts.isCallExpression(node.expression)) {
      const [arg] = node.expression.arguments;
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (!ts.isPropertyAssignment(prop) || !prop.name) continue;
          const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
            ? prop.name.text
            : undefined;
          if (key === 'template') readTemplate(prop);
          else if (key === 'templateUrl') readTemplateUrl(prop);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return templates;
}

/**
 * Every i18n message in one Angular template, as `{ id, text }`.
 *
 * `parseTemplate` attaches a `Message` to each i18n-marked node, already
 * carrying the resolved id (the `@@custom` one, or Angular's computed digest)
 * and a `messageString` in the same `{$PLACEHOLDER}` shape `$localize` emits —
 * so no separate serializer or id-hashing is needed here.
 *
 * The walk is generic (any array of child nodes, guarded by a visited set)
 * rather than a fixed list of node properties, so control-flow blocks
 * (`@if`/`@for`/`@defer`) and future node types are covered without a change
 * here. Nodes whose `i18n` is a sub-part of an enclosing message (a
 * `Container`, e.g. interpolated text inside a translated element) carry no
 * `id`/`messageString` and are correctly skipped; an ICU legitimately reports
 * the same id+text from two nodes, which de-duplicates on the way out.
 */
function templateMessages(templateText, fileName, warnings) {
  let parsed;
  try {
    parsed = parseTemplate(templateText, fileName, { preserveWhitespaces: false });
  } catch (err) {
    warnings.push(`${fileName}: template failed to parse — ${err?.message ?? err}`);
    return [];
  }
  if (parsed.errors?.length) {
    warnings.push(`${fileName}: template has parse errors — ${parsed.errors[0].msg ?? parsed.errors[0]}`);
    return [];
  }

  const out = [];
  const seen = new Set();
  const skipKeys = new Set([
    'sourceSpan', 'startSourceSpan', 'endSourceSpan', 'keySpan', 'valueSpan', 'i18n',
  ]);

  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const message = node.i18n;
    if (message && typeof message.id === 'string' && typeof message.messageString === 'string') {
      out.push({ id: message.id, text: message.messageString });
    }
    for (const [key, value] of Object.entries(node)) {
      if (skipKeys.has(key) || !value || typeof value !== 'object') continue;
      walk(value);
    }
  };
  walk(parsed.nodes);
  return out;
}

/**
 * Extract every translatable message from the `.ts` files under `srcDir` —
 * both `$localize` calls and `i18n=` template attributes (see this file's doc
 * comment). Returns
 * `{ messages: Map<id, text>, conflicts: Array<{id, a, b}>, warnings: string[] }`.
 * Exported so the verify harness can drive it without spawning the CLI.
 */
export function extractI18nMessages(srcDir) {
  const fs = new NodeJSFileSystem();
  const logger = new ConsoleLogger(LogLevel.error);
  const tmp = mkdtempSync(path.join(tmpdir(), 'ng-lynx-i18n-'));

  const tsFiles = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) tsFiles.push(full);
    }
  })(path.resolve(srcDir));

  const messages = new Map();
  const conflicts = [];
  const warnings = [];

  /** Record one message, flagging a genuine id collision (same id, different text). */
  const record = (id, text) => {
    const existing = messages.get(id);
    if (existing !== undefined && existing !== text) {
      conflicts.push({ id, a: existing, b: text });
    }
    messages.set(id, text);
  };

  for (const tsFile of tsFiles) {
    const source = readFileSync(tsFile, 'utf8');

    // 1. `$localize` tagged templates. TS → JS strips types/decorators and
    //    keeps them verbatim (esbuild doesn't know or touch them).
    const js = esbuild.transformSync(source, {
      loader: 'ts',
      tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    }).code;
    const jsFile = path.join(tmp, `${path.basename(tsFile, '.ts')}.${messages.size}.js`);
    writeFileSync(jsFile, js);

    const extractor = new MessageExtractor(fs, logger, {
      basePath: fs.resolve(tmp),
      useSourceMaps: false,
    });
    for (const m of extractor.extractMessages(fs.resolve(jsFile))) record(m.id, m.text);

    // 2. `i18n=` attributes in the component's own template, which never
    //    became `$localize` calls for the pass above to find.
    for (const tpl of componentTemplatesOf(tsFile, source, warnings)) {
      for (const m of templateMessages(tpl.text, tpl.fileName, warnings)) record(m.id, m.text);
    }
  }
  return { messages, conflicts, warnings };
}

/** Serialize to the SimpleJson translation-file format the plugin reads. */
export function toSimpleJson(messages, locale) {
  const translations = {};
  // Stable, first-seen order → deterministic output (matches internStrings'
  // determinism reasoning: reproducible files diff cleanly).
  for (const [id, text] of messages) translations[id] = text;
  return `${JSON.stringify({ locale, translations }, null, 2)}\n`;
}

// --- CLI ---------------------------------------------------------------------
// Run only when invoked directly (not when imported by the verify harness).
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const srcDir = args.find((a) => !a.startsWith('--'));
  const outIdx = args.indexOf('--out');
  const localeIdx = args.indexOf('--locale');
  const out = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const locale = localeIdx >= 0 ? args[localeIdx + 1] : 'en';

  if (!srcDir) {
    console.error('usage: ng-lynx-extract-i18n <srcDir> [--out messages.json] [--locale en]');
    process.exit(1);
  }

  const { messages, conflicts, warnings } = extractI18nMessages(srcDir);
  for (const w of warnings) console.error(`[ng-lynx] i18n: ${w}`);
  for (const c of conflicts) {
    console.error(
      `[ng-lynx] i18n: message id "${c.id}" has two different source texts `
        + `(${JSON.stringify(c.a)} vs ${JSON.stringify(c.b)}) — the last wins.`,
    );
  }
  const json = toSimpleJson(messages, locale);
  if (out) {
    writeFileSync(path.resolve(process.cwd(), out), json);
    console.error(`[ng-lynx] extracted ${messages.size} message(s) → ${out}`);
  } else {
    process.stdout.write(json);
  }
}
