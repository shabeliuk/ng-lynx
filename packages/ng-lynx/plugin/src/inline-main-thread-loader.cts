/**
 * The rspack loader for inline `'main thread'` functions (inline-main-thread.cts):
 *
 * - `main-thread`: `file.ts?ng-lynx-main-thread`, the file's Main-Thread half.
 * - `background`: the file as the Background Thread compiles it. Only for JIT
 *   builds: under AOT, ngtsc reads files itself, through the input file system
 *   `pluginAngularLynx` wraps.
 * - `index`: the Main-Thread module importing every file's half. It rescans when a
 *   file in the scanned folders changes, so a new file with a `'main thread'`
 *   function is picked up while the dev server runs.
 */
import { readFileSync } from 'node:fs';

import {
  extractForMainThread,
  loadTypeScript,
  MAIN_THREAD_QUERY,
  relativeId,
  scanForMainThreadFiles,
  transformForBackground,
} from './inline-main-thread.cjs';

interface Options {
  mode: 'main-thread' | 'background' | 'index';
  root: string;
  roots?: string[];
  exclude?: string[];
}

interface LoaderContext {
  resourcePath: string;
  getOptions(): Options;
  addDependency(file: string): void;
  addContextDependency(dir: string): void;
  cacheable?(flag?: boolean): void;
}

function inlineMainThreadLoader(this: LoaderContext, source: string): string {
  const { mode, root, roots = [], exclude = [] } = this.getOptions();
  if (mode === 'index') {
    for (const dir of roots) this.addContextDependency(dir);
    const files = scanForMainThreadFiles(roots, new Set(exclude));
    for (const file of files) this.addDependency(file);
    return files.map((file) => `import ${JSON.stringify(`${file}?${MAIN_THREAD_QUERY}`)};`).join('\n') + '\n';
  }
  const ts = loadTypeScript(root);
  const relativePath = relativeId(root, this.resourcePath);
  if (mode === 'main-thread') {
    // From disk: what the loader was handed may already be the Background form.
    const text = readFileSync(this.resourcePath, 'utf8');
    return extractForMainThread(ts, this.resourcePath, text, relativePath);
  }
  return transformForBackground(ts, this.resourcePath, source, relativePath) ?? source;
}

export = inlineMainThreadLoader;
