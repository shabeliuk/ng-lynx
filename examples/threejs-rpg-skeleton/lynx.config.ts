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
  // `public/` is served at the app's root (rsbuild's default publicDir) — this
  // is where the glTF model lives, fetched at runtime and handed to GLTFLoader
  // rather than bundled as a JS module (it's binary).
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
    }),
  ],
});
