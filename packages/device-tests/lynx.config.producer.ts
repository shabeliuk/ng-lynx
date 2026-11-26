/**
 * The bundles the `bundle` screen loads: the same component, packaged twice.
 * `DEVICE_TESTS_FETCHER` picks the packaging, and run.mjs builds both after the app,
 * into `<dist>/remote/`:
 *
 * - `fetch-bundle` (default): `remote-fetch.lynx.bundle`, which the host fetches with
 *   `lynx.fetchBundle` and reads with `lynx.loadScript`;
 * - `query-component`: `remote-query.lynx.bundle`, which `lynx.QueryComponent` loads.
 */
import path from 'node:path';

import { defineConfig, type RsbuildPlugin } from '@lynx-js/rspeedy';
import { pluginAngularLynx } from 'ng-lynx/plugin';

/** The app's public/ files are the app's: this build copies none of them. */
const pluginNoPublicDir: RsbuildPlugin = {
  name: 'device-tests-no-public-dir',
  setup(api) {
    api.modifyRsbuildConfig((config) => {
      config.server = { ...config.server, publicDir: false };
    });
  },
};

const appDist = process.env.DEVICE_TESTS_DIST ?? 'dist';
const fetcher = process.env.DEVICE_TESTS_FETCHER === 'query-component' ? 'query-component' : 'fetch-bundle';
const name = fetcher === 'query-component' ? 'remote-query' : 'remote-fetch';

export default defineConfig({
  source: { entry: { [name]: './src/remote/remote-entry.ts' } },
  // Both builds write here, so neither may empty it.
  output: { distPath: { root: path.join(appDist, 'remote') }, cleanDistPath: false },
  environments: { lynx: {} },
  plugins: [
    pluginNoPublicDir,
    pluginAngularLynx({
      enableCSSSelector: true,
      enableCSSInheritance: true,
      dynamicComponent: true,
      dynamicComponentFetcher: fetcher,
      ...(fetcher === 'fetch-bundle' ? { engineVersion: '3.9' } : {}),
      tsconfig: 'tsconfig.producer.json',
    }),
  ],
});
