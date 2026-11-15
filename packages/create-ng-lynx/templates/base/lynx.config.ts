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
    // `lynx` builds the on-device bundle; `web` builds the browser preview.
    lynx: {},
    web: {},
  },
  plugins: [
    pluginQRCode({
      // Open the page full-screen in Lynx Explorer when scanning the QR code.
      schema(url) {
        return `${url}?fullscreen=true`;
      },
    }),
    pluginAngularLynx({
      enableCSSSelector: true,
      enableCSSInheritance: true,
      // AOT (ngtsc) is the default. See the ng-lynx docs for
      // `firstScreen` (instant first frame) and other options.
    }),
  ],
});
