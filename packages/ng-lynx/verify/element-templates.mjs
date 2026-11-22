// Compile two components against the built `ng-lynx/elements` with ngc and
// `strictTemplates`: templates/ok.component.ts must compile, and every
// binding in templates/bad.component.ts must be an error. Checks the element
// directives' typed inputs and outputs the way an app's AOT build sees them.
// Run `npm run build` first: ngc reads the built declarations.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const ngc = path.join(pkg, 'node_modules/.bin/ngc');

function compile(config) {
  const result = spawnSync(ngc, ['-p', path.join(here, 'templates', config)], { cwd: pkg, encoding: 'utf8' });
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ngc colours its output
  return { status: result.status, output: `${result.stdout}${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, '') };
}

let failed = false;
const ok = compile('tsconfig.json');
if (ok.status === 0) {
  console.log('✓ templates/ok.component.ts compiles with strictTemplates');
} else {
  console.error(`✗ templates/ok.component.ts doesn't compile:\n${ok.output}`);
  failed = true;
}

const bad = compile('tsconfig.bad.json');
const source = readFileSync(path.join(here, 'templates/bad.component.ts'), 'utf8').split('\n');
const template = source.findIndex((line) => line.includes('template: `'));
const end = source.findIndex((line, i) => i > template && line.trim() === '`,');
for (let i = template + 1; i < end; i++) {
  const line = i + 1;
  const reported = new RegExp(`bad\\.component\\.ts:${line}:\\d+ - error`).test(bad.output);
  console[reported ? 'log' : 'error'](`${reported ? '✓' : '✗'} line ${line} is an error: ${source[i].trim()}`);
  if (!reported) failed = true;
}

if (failed) process.exit(1);
console.log('\nelement templates: typed inputs and outputs check as expected');
