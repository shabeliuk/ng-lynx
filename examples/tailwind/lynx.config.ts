import { defineConfig } from '@lynx-js/rspeedy';

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginTailwindCSS } from 'rsbuild-plugin-tailwindcss';
import { pluginAngularLynx } from 'ng-lynx/plugin';

/**
 * Tailwind under ng-lynx — see docs/13-styling.md#tailwind.
 *
 * `pluginTailwindCSS` (the Lynx-recommended integration) wires Tailwind into
 * rsbuild's PostCSS step: it reads `tailwind.config.ts`, scans the `content`
 * globs for class names, and generates a stylesheet that then flows through
 * the same Lynx CSS compilation as any other `.css`. `@lynx-js/tailwind-preset`
 * keeps Tailwind's output to only Lynx-supported utilities.
 *
 * Order matters: `pluginTailwindCSS()` must run so the `@tailwind` directives
 * in `tailwind.css` are expanded before `pluginAngularLynx` packages the
 * bundle.
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
    pluginTailwindCSS({
      config: 'tailwind.config.ts',
    }),
    pluginAngularLynx({
      enableCSSSelector: true,
      enableCSSInheritance: true,
    }),
  ],
});
