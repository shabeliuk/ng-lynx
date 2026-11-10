/**
 * The **host** app build.
 *
 * `dynamicComponentHost: true` publishes this app's own framework instances
 * (Angular + angular-lynx) into the shared registry, so a dynamic-component
 * bundle loaded at runtime resolves against *these* instead of carrying its
 * own copy — which provably cannot work (see docs/38-dynamic-component.md).
 */
import { defineConfig, type RsbuildPlugin } from '@lynx-js/rspeedy';

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginAngularLynx } from 'angular-lynx/plugin';

/**
 * Serves the dynamic bundle from the host's own origin. `npm run dev` and
 * `npm run build` run the producer first (`lynx.config.producer.ts`), which
 * writes `remote.*.bundle` into `dist-remote/`. This adds that folder to
 * rsbuild's static files: the dev server serves it as is, and a build copies
 * it into `dist/`. rspeedy's config has no `server.publicDir`, hence a plugin.
 */
const pluginServeRemoteBundle: RsbuildPlugin = {
  name: 'serve-remote-bundle',
  setup(api) {
    api.modifyRsbuildConfig((config) => {
      config.server = { ...config.server, publicDir: [{ name: 'public' }, { name: 'dist-remote' }] };
    });
  },
};

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
      dynamicComponentHost: true,
    }),
    pluginServeRemoteBundle,
  ],
});
