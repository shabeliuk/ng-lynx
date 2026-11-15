import { defineConfig } from '@lynx-js/rspeedy';

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginAngularLynx } from 'ng-lynx/plugin';

export default defineConfig({
  source: {
    entry: {
      // The main demo page.
      main: './src/index.ts',
      // A tiny second page, embedded by the <frame> section below — kept as
      // its own bundle (not the `main` entry) so the demo can't accidentally
      // recurse into itself.
      nested: './src/nested-entry.ts',
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
    }),
  ],
});
