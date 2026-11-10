/**
 * Sparkling config: the native iOS app (`ios/`), built by `sparkling-app-cli`.
 *
 * It wraps the same `lynx.config.ts` the web preview uses, so there is one
 * planner codebase. Sparkling runs *our* rspeedy with it (the CLI spawns
 * `rspeedy` from PATH — this package's 0.17.x, not the CLI's own 0.13), so
 * the Angular build is exactly the one `npm run dev` / `npm run build` do.
 *
 *   npm run ios         build the bundle, pod install, build + launch the
 *                       simulator app (Debug loads from the dev server)
 *   npm run ios:dev     the dev server the Debug app loads from (port 5969)
 *   npm run ios:bundle  build + copy the bundle into ios/LynxResources
 *                       (what a Release build ships)
 *
 * See README.md → "iOS app".
 */
import type { AppConfig } from 'sparkling-app-cli';

import lynxConfig from './lynx.config.js';

/**
 * rspeedy sets NODE_ENV from its command (`dev` → development) before it
 * loads this file. The dev server gets its own output folder because it
 * serves bundles from disk, and `npm run ios` always runs a production
 * `sparkling build` into `dist/` (the CLI copies release assets from there,
 * hard-coded) — sharing the folder meant that build overwrote the bundle the
 * running dev server was handing the Debug app, `asset:///` prefix and all.
 */
const devServer = process.env['NODE_ENV'] === 'development';

const config: AppConfig = {
  lynxConfig: {
    ...lynxConfig,
    // The app only needs the Lynx bundle — no web-preview bundle inside it.
    environments: { lynx: {} },
    // Release builds load bundles from the app's own resources…
    output: {
      ...lynxConfig.output,
      assetPrefix: 'asset:///',
      ...(devServer ? { distPath: { root: '.sparkling/dev-dist' } } : {}),
    },
    // …but a Debug app loads from the dev server, and its bundle must know
    // that server's URL: the planner finds its LLM proxy through it
    // (`lynxAssetUrl('/api/chat')`). Rsbuild's `dev.assetPrefix` otherwise
    // follows `output.assetPrefix`, so without this the dev bundle also got
    // `asset:///` and every `/api/…` call was an "unsupported URL" on iOS.
    dev: { ...lynxConfig.dev, assetPrefix: true },
  },
  // No `host`: the dev server already listens on every interface, so an
  // iPhone on the same Wi-Fi reaches it (`npm run ios:device`). Measured
  // with lsof (`*:5969`), despite Rsbuild 2's config default of `localhost`
  // and its "use --host to expose" hint. Setting `0.0.0.0` changes nothing
  // but makes the CLI print a wildcard-host warning on every start. Anyone
  // on the network can reach the LLM proxy (and so the key), so keep to
  // trusted Wi-Fi.
  dev: { server: { port: 5969 } },
  devtool: true,
  appName: 'Retirement Planner',
  platform: {
    ios: { bundleIdentifier: 'dev.angularlynx.planner' },
    android: { packageName: 'dev.angularlynx.planner' },
  },
  paths: {
    iosAssets: 'ios/LynxResources',
    // iOS only for now; the CLI copies to both platforms, so park Android's
    // copy somewhere ignored.
    androidAssets: '.sparkling/android-assets',
  },
};

export default config;
