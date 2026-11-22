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
      // The drag demos' touch handling, which runs on the Main Thread.
      mainThreadModules: [
        './src/components/draggable.mt.ts',
        './src/components/sheet.mt.ts',
        './src/components/sortable.mt.ts',
        './src/components/swipe-action.mt.ts',
        './src/components/swiper.mt.ts',
      ],
    }),
  ],
});
