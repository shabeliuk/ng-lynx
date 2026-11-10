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
      // Open the page full-screen in LynxExplorer when scanning the QR code.
      schema(url) {
        return `${url}?fullscreen=true`;
      },
    }),
    pluginAngularLynx({
      enableCSSSelector: true,
      enableCSSInheritance: true,
      // AOT is the default. `three` ships ES2021+ syntax, but the plugin already
      // transpiles node_modules down to ES2019 for PrimJS, so three's core
      // (scene graph + math) parses and runs on the Background Thread.
    }),
  ],
});
