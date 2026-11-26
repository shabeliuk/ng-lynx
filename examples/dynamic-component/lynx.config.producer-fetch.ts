/**
 * The same dynamic component, packaged for `lynx.fetchBundle`
 * (`dynamicComponentFetcher: 'fetch-bundle'`): `remote-fetch.lynx.bundle`, in
 * `dist-remote-fetch/`. The host loads it with
 * `loadDynamicComponent(source, { fetcher: 'fetch-bundle' })`. Engine 3.9 or
 * higher; the other format, `remote.*.bundle`, loads through `QueryComponent`.
 */
import { defineConfig } from '@lynx-js/rspeedy';

import { pluginAngularLynx } from 'ng-lynx/plugin';

export default defineConfig({
  source: {
    entry: {
      // The entry only exports — it does not bootstrap.
      'remote-fetch': './src/remote-entry.ts',
    },
  },
  output: {
    // Not the host's `dist/`: the dev server writes there, and each build
    // empties its own output folder.
    distPath: { root: 'dist-remote-fetch' },
  },
  environments: {
    lynx: {},
    web: {},
  },
  plugins: [
    pluginAngularLynx({
      enableCSSSelector: true,
      enableCSSInheritance: true,
      dynamicComponent: true,
      dynamicComponentFetcher: 'fetch-bundle',
      // The format ReactLynx's own lazy bundles use, from engine 3.9.
      engineVersion: '3.9',
      // Only the remote's files: the host's tsconfig leaves them out.
      tsconfig: 'tsconfig.producer.json',
    }),
  ],
});
