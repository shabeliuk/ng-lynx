import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pluginLynxConfig } from '@lynx-js/config-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginAngularLynx } from 'ng-lynx/plugin';

import { plannerDefines } from './server/embed.js';
import { pluginPlannerApi } from './server/llm-proxy.js';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  source: {
    entry: {
      main: './src/index.ts',
    },
    // `__PLANNER_EMBEDDED__`: null, unless `.env.local` sets
    // PLANNER_EMBED_KEY=true — then the key ships inside the bundle (demo
    // builds only; see README.md).
    define: plannerDefines(root),
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
    // Stream `fetch` bodies on device, so the planner's answer builds up
    // screen-by-screen as the model writes it (the web preview streams
    // regardless). Experimental in Lynx; without it the app falls back to
    // reading the whole response (src/planner/agent.ts).
    pluginLynxConfig({ enableFetchAPIStandardStreaming: true }),
    // The planner's /api/health + /api/chat LLM proxy (dev and preview
    // servers only). Reads GEMINI_API_KEY from .env.local — see README.md.
    pluginPlannerApi({ root }),
  ],
});
