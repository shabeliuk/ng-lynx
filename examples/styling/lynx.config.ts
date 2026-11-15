import { defineConfig } from '@lynx-js/rspeedy';

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginSass } from '@rsbuild/plugin-sass';
import { pluginAngularLynx } from 'ng-lynx/plugin';

/**
 * Sass under ng-lynx — see docs/13-styling.md#sass.
 *
 * `pluginSass()` is a standard Rsbuild plugin; rspeedy's `plugins` array
 * accepts Rsbuild plugins directly (`RsbuildPlugins`). It registers a
 * `.scss`/`.sass` loader *before* the CSS pipeline, so a `.scss` file
 * `import`ed from TS is compiled to plain CSS and then flows through the exact
 * same Lynx stylesheet compilation as a hand-written `.css` file. Nothing
 * ng-lynx-specific is required.
 */
export default defineConfig({
  source: {
    entry: {
      main: './src/index.ts',
    },
  },
  environments: {
    lynx: {},
    web: {},
  },
  plugins: [
    pluginQRCode({
      schema(url) {
        return `${url}?fullscreen=true`;
      },
    }),
    pluginSass(),
    pluginAngularLynx({
      enableCSSSelector: true,
      enableCSSInheritance: true,
    }),
  ],
});
