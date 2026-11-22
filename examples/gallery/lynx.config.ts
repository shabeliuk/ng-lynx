import { defineConfig } from '@lynx-js/rspeedy';

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginAngularLynx } from 'ng-lynx/plugin';

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
      // The scrollbar that follows the list on the Main Thread.
      mainThreadModules: ['./src/scrollbar.mt.ts'],
    }),
  ],
});
