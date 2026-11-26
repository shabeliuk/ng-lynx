/**
 * The rspack loader behind `templateSourceMap` (docs/26-debugging.md): records
 * where each element of a compiled template is, for `debug-metadata.json`. See
 * template-source-map.cts. It runs after `@ngtools/webpack`'s loader and returns
 * the source unchanged.
 */
import { collectRecords, UI_SOURCE_MAP_RECORDS_BUILD_INFO } from './template-source-map.cjs';

interface LoaderContext {
  resourcePath: string;
  _module?: { buildInfo?: Record<string, unknown> };
}

function templateSourceMapLoader(this: LoaderContext, source: string): string {
  const buildInfo = this._module?.buildInfo;
  if (buildInfo && source.includes('attachSourceLocations')) {
    const records = collectRecords(source, this.resourcePath);
    if (records.length > 0) buildInfo[UI_SOURCE_MAP_RECORDS_BUILD_INFO] = records;
    else delete buildInfo[UI_SOURCE_MAP_RECORDS_BUILD_INFO];
  }
  return source;
}

export = templateSourceMapLoader;
