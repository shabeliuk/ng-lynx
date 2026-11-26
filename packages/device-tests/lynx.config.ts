import { defineConfig, type RsbuildPlugin } from '@lynx-js/rspeedy';

import { pluginLynxConfig } from '@lynx-js/config-rsbuild-plugin';
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginAngularLynx } from 'ng-lynx/plugin';

import { sendServerEvents } from './server.mjs';

/** `npm run dev`: serve the platform screen's /sse, as run.mjs's server does. */
const pluginServerEvents: RsbuildPlugin = {
  name: 'device-tests-server-events',
  setup(api) {
    api.modifyRsbuildConfig((config) => {
      const setup = config.server?.setup;
      config.server = {
        ...config.server,
        setup: [
          ...(Array.isArray(setup) ? setup : setup ? [setup] : []),
          (context) => {
            if (context.action !== 'dev') return;
            context.server.middlewares.use((req, res, next) => {
              if (req.url?.split('?')[0] === '/sse') sendServerEvents(res);
              else next();
            });
          },
        ],
      };
    });
  },
};

export default defineConfig({
  source: {
    entry: {
      main: './src/index.ts',
      // A second bundle with no lazy chunks: lynxAssetUrl() once only worked in
      // a production build that had one.
      assets: './src/assets.ts',
    },
  },
  environments: {
    lynx: {},
  },
  output: {
    // run.mjs serves dist/ here. A device has no base URL of its own to resolve
    // lazy chunks and assets against. `npm run dev` uses the dev server's own
    // address instead. iphone.mjs builds with this Mac's Wi-Fi address, into
    // its own folder, since a phone can't reach 127.0.0.1.
    assetPrefix: process.env.DEVICE_TESTS_ORIGIN ?? 'http://127.0.0.1:8791/',
    ...(process.env.DEVICE_TESTS_DIST ? { distPath: { root: process.env.DEVICE_TESTS_DIST } } : {}),
  },
  plugins: [
    // `npm run dev` prints a code to scan with Lynx Explorer on a phone.
    pluginQRCode(),
    pluginAngularLynx({
      enableCSSSelector: true,
      enableCSSInheritance: true,
      enableNewGesture: true,
      asyncChunks: true,
      mainThreadModules: ['./src/worklets.ts'],
      // The `bundle` screen loads a component from a bundle built on its own.
      dynamicComponentHost: true,
    }),
    // lynxEventSource reads its stream through fetch's standard streaming.
    pluginLynxConfig({ enableFetchAPIStandardStreaming: true }),
    pluginServerEvents,
  ],
});
