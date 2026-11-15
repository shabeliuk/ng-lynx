#!/usr/bin/env node
// Node resolves a file's module system from the nearest ancestor
// package.json's `"type"` field. ng-lynx's own package.json declares
// `"type": "module"`, but schematics/tsconfig.json compiles to CommonJS
// (required by the Angular CLI schematics engine — see its own `//` comment)
// — so `dist/` needs its own `"type": "commonjs"` override, generated here
// rather than committed since `dist/` itself is build output (gitignored).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
mkdirSync(dist, { recursive: true });
writeFileSync(path.join(dist, 'package.json'), '{\n  "type": "commonjs"\n}\n');
