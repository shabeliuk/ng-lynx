import { defineConfig } from '@lynx-js/rspeedy';

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginAngularLynx } from 'angular-lynx/plugin';

/**
 * The default control theme (`angular-lynx/forms/theme.css`) is driven by CSS
 * custom properties, which Lynx only cascades when `enableCSSInheritance` is
 * on — so this flag is required for the theme (and any `--var`-based design
 * tokens) to work. See docs/09-forms.md#theming and docs/13-styling.md.
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
    pluginAngularLynx({
      enableCSSSelector: true,
      enableCSSInheritance: true,
    }),
  ],
});
