/**
 * The **dynamic component** build — a separate `rspeedy build` producing a
 * standalone loadable bundle (`remote.lynx.bundle`), not an app.
 *
 * `npm run dev` and `npm run build` run it before the host, and
 * `npm run build:producer` runs it alone: the dev server picks the new
 * bundle up without a restart. It writes into `dist-remote/`, which the host
 * config serves next to its own bundle, since the host's
 * `loadDynamicComponent()` fetches it from the same origin.
 */
import { defineConfig } from '@lynx-js/rspeedy';

import { pluginAngularLynx } from 'angular-lynx/plugin';

export default defineConfig({
  source: {
    entry: {
      // The entry only exports — it does not bootstrap.
      remote: './src/remote-entry.ts',
    },
  },
  output: {
    // Not the host's `dist/`: the dev server writes there, and each build
    // empties its own output folder.
    distPath: { root: 'dist-remote' },
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
      // Only the remote's files: the host's tsconfig leaves them out.
      tsconfig: 'tsconfig.producer.json',
    }),
  ],
});
