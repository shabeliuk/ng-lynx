import { defineConfig } from '@lynx-js/rspeedy';

import { pluginLynxConfig } from '@lynx-js/config-rsbuild-plugin';
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginAngularLynx } from 'angular-lynx/plugin';

/**
 * CSS `@media` queries on Lynx 4.0+ — see docs/13-styling.md#media-queries.
 *
 * Two settings, and both matter:
 *
 *  - `enableCSSRule: true` makes the build encode `@media` blocks at all.
 *    Without it they're left out of the bundle, silently.
 *  - `engineVersion: '3.9'`, because that encoding is new in engine 4.0.
 *    An older engine can't decode it and aborts the app; an engine below the
 *    declared version refuses the bundle with a version error instead. 4.0
 *    would be the honest floor, but the encoder that ships with this
 *    toolchain accepts at most 3.9 (it fails the build above that), so a
 *    3.9 engine can still try. That's why this is its own example rather
 *    than part of `examples/styling`, which keeps loading on 3.x engines.
 */
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
    pluginLynxConfig({ enableCSSRule: true }),
    pluginAngularLynx({
      enableCSSSelector: true,
      engineVersion: '3.9',
    }),
  ],
});
