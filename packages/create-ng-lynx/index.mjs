#!/usr/bin/env node
/**
 * create-ng-lynx — scaffold an Angular-on-Lynx app.
 *
 * Usage:
 *   npm create ng-lynx@latest my-app
 *   npm create ng-lynx@latest my-app -- --template router
 *
 * Templates: minimal (default), router, forms. Zero dependencies: the CLI
 * copies `templates/base` + `templates/<name>` into the target directory,
 * substitutes __APP_NAME__, and renames `gitignore` → `.gitignore` (npm
 * strips real dotfiles from published packages).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = ['minimal', 'router', 'forms'];

function usage(code) {
  console.log(`
  create-ng-lynx — scaffold an Angular-on-Lynx app

  Usage:
    npm create ng-lynx@latest <directory> [-- --template <name>]

  Templates:
    minimal   signals counter, typed Lynx elements (default)
    router    @angular/router with a lazy route
    forms     @angular/forms with [(ngModel)] + headless controls
`);
  process.exit(code);
}

// --- parse argv -------------------------------------------------------------
const args = process.argv.slice(2);
let dir;
let template = 'minimal';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--help' || a === '-h') usage(0);
  else if (a === '--template' || a === '-t') template = args[++i];
  else if (a.startsWith('--template=')) template = a.slice('--template='.length);
  else if (a.startsWith('-')) {
    console.error(`Unknown option: ${a}`);
    usage(1);
  } else if (dir === undefined) dir = a;
  else {
    console.error(`Unexpected argument: ${a}`);
    usage(1);
  }
}
if (!dir) {
  console.error('Missing <directory>.');
  usage(1);
}
if (!TEMPLATES.includes(template)) {
  console.error(`Unknown template "${template}". Available: ${TEMPLATES.join(', ')}.`);
  process.exit(1);
}

// --- validate target --------------------------------------------------------
const target = path.resolve(process.cwd(), dir);
if (existsSync(target) && readdirSync(target).length > 0) {
  console.error(`Target directory ${dir} exists and is not empty.`);
  process.exit(1);
}
// Valid npm package name from the directory name.
const appName = path
  .basename(target)
  .toLowerCase()
  .replace(/[^a-z0-9-_.~]+/g, '-')
  .replace(/^[-_.]+|[-_.]+$/g, '') || 'ng-lynx-app';

// --- copy base + template, substitute, fix dotfiles ---------------------------
mkdirSync(target, { recursive: true });
cpSync(path.join(here, 'templates', 'base'), target, { recursive: true });
cpSync(path.join(here, 'templates', template), target, { recursive: true });

for (const file of walk(target)) {
  const text = readFileSync(file, 'utf8');
  if (text.includes('__APP_NAME__')) {
    writeFileSync(file, text.replaceAll('__APP_NAME__', appName));
  }
}
const gitignore = path.join(target, 'gitignore');
if (existsSync(gitignore)) renameSync(gitignore, path.join(target, '.gitignore'));

function* walk(d) {
  for (const entry of readdirSync(d)) {
    const p = path.join(d, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

// --- done ---------------------------------------------------------------------
const rel = path.relative(process.cwd(), target) || '.';
console.log(`
  Scaffolded "${appName}" (${template} template) into ${rel}/

  Next steps:
    cd ${rel}
    npm install
    npm run dev

  Then open the web preview at
    http://localhost:3000/__web_preview?casename=main.web.bundle
  or scan the printed QR code with Lynx Explorer on a device/simulator.

  Docs: https://github.com/shabeliuk/ng-lynx/tree/main/docs
`);
