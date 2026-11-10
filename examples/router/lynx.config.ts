import { defineConfig } from '@lynx-js/rspeedy';

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginAngularLynx } from 'angular-lynx/plugin';

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
    pluginAngularLynx({
      enableCSSSelector: true,
      enableCSSInheritance: true,
      // Real code splitting: the /lazy route's dynamic import() emits an
      // async chunk fetched on first navigation (lynx.requireModuleAsync)
      // instead of being bundled eagerly. See docs/15-routing.md.
      asyncChunks: true,
    }),
  ],
});
