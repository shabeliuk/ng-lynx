import { defineConfig } from '@lynx-js/rspeedy';

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginAngularLynx } from 'angular-lynx/plugin';

/**
 * A per-locale build config — see docs/35-i18n.md. Run `rspeedy build
 * --config lynx.config.uk.ts` to produce a Ukrainian-translated build in
 * `dist-uk/`, alongside the default (source-locale) build in `dist/`.
 */
export default defineConfig({
  source: {
    entry: {
      main: './src/index.ts',
    },
  },
  output: {
    distPath: { root: 'dist-uk' },
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
      i18n: {
        locale: 'uk',
        translationFile: './src/locales/uk.json',
      },
    }),
  ],
});
