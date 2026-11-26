/**
 * What the `templateSourceMap` loader (template-source-map-loader.cts) reads from
 * a compiled module. Kept apart so the harness can call it. See docs/26-debugging.md.
 *
 * With source locations on, Angular's compiler adds one call to each compiled
 * template: `ɵɵattachSourceLocations(templatePath, [[slot, offset, line, column], …])`,
 * one entry per element. At runtime it sets `data-ng-source-location` on each
 * element, and ng-lynx creates the element with a `nodeIndex` hashed from that
 * value (runtime/src/renderer.ts).
 *
 * This loader reads the same calls from ngtsc's output and records, for every
 * index, where the element is in its template, on the module's `buildInfo` key
 * that `@lynx-js/debug-metadata-rsbuild-plugin` collects into the `uiSourceMap`
 * of `debug-metadata.json`. That is ReactLynx's contract
 * (`@lynx-js/react-webpack-plugin`'s main-thread loader), so DevTool resolves an
 * ng-lynx element the way it resolves a ReactLynx one.
 *
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

/** `UI_SOURCE_MAP_RECORDS_BUILD_INFO` in `@lynx-js/debug-metadata`. */
export const UI_SOURCE_MAP_RECORDS_BUILD_INFO = 'lynxUiSourceMapRecords';

/** One `UiSourceMapRecord` of `@lynx-js/debug-metadata`. */
export interface UiSourceMapRecord {
  uiSourceMap: number;
  filename: string;
  lineNumber: number;
  columnNumber: number;
}

/**
 * A copy of `sourceLocationNodeIndex` in internal/src/ops.ts, which the runtime
 * uses: this CommonJS loader can't import that ES module. `verify:template-source-map`
 * checks that the two agree.
 */
export function sourceLocationNodeIndex(location: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < location.length; i++) {
    hash ^= location.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 1) || 1;
}

// `i0.ɵɵattachSourceLocations("src/app.component.html", [[0, 0, 0, 0], …])`.
// The prefix may come out escaped, depending on the printer.
const CALL = /(?:ɵɵ|\\u0275\\u0275)attachSourceLocations\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*(\[[\d\s,[\]]*\])\s*\)/g;

/**
 * The template file a `templatePath` names. ngtsc makes it relative to the
 * project's root dirs, which the loader doesn't know, so it is looked for from
 * the component's own folder up. An inline template's path is the component file.
 */
function resolveTemplateFile(resourcePath: string, templatePath: string): string {
  const relative = templatePath.split('/').join(path.sep);
  if (resourcePath.endsWith(path.sep + relative) || resourcePath === relative) return resourcePath;
  let dir = path.dirname(resourcePath);
  for (;;) {
    const candidate = path.join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(relative);
    dir = parent;
  }
}

/** The records for one compiled module. Exported for the harness. */
export function collectRecords(source: string, resourcePath: string): UiSourceMapRecord[] {
  const records: UiSourceMapRecord[] = [];
  for (const match of source.matchAll(CALL)) {
    const templatePath = JSON.parse(`"${match[2]}"`) as string;
    let locations: unknown;
    try {
      locations = JSON.parse(match[3]);
    } catch {
      continue;
    }
    if (!Array.isArray(locations)) continue;
    const filename = resolveTemplateFile(resourcePath, templatePath);
    for (const entry of locations) {
      if (!Array.isArray(entry) || entry.length < 4) continue;
      const [, offset, line, column] = entry as number[];
      records.push({
        uiSourceMap: sourceLocationNodeIndex(`${templatePath}@o:${offset},l:${line},c:${column}`),
        filename,
        // Angular's are 0-based; the debug-metadata format's are 1-based, as in an editor.
        lineNumber: line + 1,
        columnNumber: column + 1,
      });
    }
  }
  return records;
}
