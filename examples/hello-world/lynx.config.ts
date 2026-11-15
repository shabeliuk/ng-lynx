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
      // Open the page full-screen in LynxExplorer when scanning the QR code.
      schema(url) {
        return `${url}?fullscreen=true`;
      },
    }),
    pluginAngularLynx({
      enableCSSSelector: true,
      enableCSSInheritance: true,
      // AOT is the default; pass `aot: false` to fall back to JIT.
      // First frame painted on the Main Thread before Angular boots —
      // regenerate the snapshot with `npm run capture` after UI changes.
      firstScreen: './src/first-screen.json',
    }),
  ],
});
