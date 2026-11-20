// Derived in part from vue-lynx (https://github.com/Huxpro/vue-lynx), Copyright Xuan Huang,
// Apache-2.0. Changed: rewritten for Angular and ngtsc.
/**
 * @packageDocumentation
 *
 * `pluginAngularLynx` — an rspeedy / rsbuild plugin that builds an Angular app
 * into a Lynx dual-thread bundle.
 *
 * It mirrors the structure of vue-lynx's plugin. Each entry is split into:
 *
 *   • a **Background Thread** bundle — `ng-lynx/entry-background` prepended
 *     to your app code (Angular + LynxRenderer2), and
 *   • a **Main Thread** bundle — `ng-lynx/main-thread` (the PAPI executor).
 *
 * Both are packed into a single `.lynx.bundle` by `@lynx-js/template-webpack-plugin`.
 *
 * @remarks
 * Compilation is **AOT** by default (`ngtsc` through `@ngtools/webpack`, no
 * compiler shipped); `aot: false` falls back to JIT. See
 * `docs/05-build-integration.md`.
 *
 * @example
 * ```ts
 * // lynx.config.ts
 * import { defineConfig } from '@lynx-js/rspeedy';
 * import { pluginAngularLynx } from 'ng-lynx/plugin';
 *
 * export default defineConfig({
 *   environments: { lynx: {}, web: {} },
 *   plugins: [pluginAngularLynx()],
 * });
 * ```
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Lynx packaging plugins are ESM-only — import them statically (they are
// dependencies of this package).
import {
  LynxEncodePlugin,
  LynxTemplatePlugin,
  WebEncodePlugin,
} from '@lynx-js/template-webpack-plugin';
import { RuntimeWrapperWebpackPlugin } from '@lynx-js/runtime-wrapper-webpack-plugin';

import { LAYERS } from './layers.js';

export { LAYERS };

const _dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// The package root: this file lives at <pkgRoot>/plugin/dist/, so go two up.
const angularLynxRoot = path.resolve(_dirname, '../..');

// ---------------------------------------------------------------------------
// Dynamic-component shared-runtime convention.
//
// These MUST stay identical to `runtime/src/shared-runtime.ts`'s
// `DEFAULT_SHARED_MODULES` / `sharedModuleExpression` — the host publishes
// under keys the runtime computes, and this plugin generates the externals
// that read them back, so a drift between the two would produce a bundle
// that silently resolves `undefined` for Angular. They're duplicated rather
// than imported because this plugin is build-time ESM with no project
// reference to the runtime; `verify:dynamic-component-build` asserts the two
// definitions agree, so the duplication can't rot unnoticed.
// ---------------------------------------------------------------------------

/** @see runtime/src/shared-runtime.ts `DEFAULT_SHARED_MODULES` */
const DEFAULT_SHARED_MODULES: readonly string[] = [
  '@angular/core',
  'ng-lynx',
  'ng-lynx/elements',
];

/** @see runtime/src/shared-runtime.ts `sharedModuleExpression` */
function sharedModuleExpression(moduleId: string): string {
  const target = "(typeof lynx !== 'undefined' && lynx ? lynx : globalThis)";
  return `${target}[Symbol.for(${JSON.stringify(`__ANGULAR_LYNX_EXPORTS__(${moduleId})`)})]`;
}

/**
 * Options for {@link pluginAngularLynx}.
 * @public
 */
export interface PluginAngularLynxOptions {
  /** Enable CSS class selector support in the Lynx template. @defaultValue true */
  enableCSSSelector?: boolean;
  /** Enable CSS inheritance (needed for CSS-variable design tokens). @defaultValue false */
  enableCSSInheritance?: boolean;
  /**
   * Re-match combinator selectors (`.parent-on .child`, `.a + .b`) when a
   * class changes after an element was created. Without it, Lynx matches a
   * combinator only against the classes an element had when it was created,
   * so a rule keyed on an ancestor's runtime state never applies.
   * `@lynx-js/template-webpack-plugin` defaults it to `false`. Collecting the
   * affected nodes costs some style-matching time, so an app that never
   * changes an ancestor's class can turn it off.
   *
   * Same option, same default, as ReactLynx's `pluginReactLynx`.
   *
   * @defaultValue true
   */
  enableCSSInvalidation?: boolean;
  /**
   * The oldest Lynx engine the bundle declares it runs on, stamped into the
   * template. An engine older than this refuses the bundle with a version
   * error instead of loading it.
   *
   * Leave it at the default unless the app depends on something newer. The
   * one case this plugin knows about: `pluginLynxConfig({ enableCSSRule: true })`
   * (needed for `@media`) changes how the stylesheet is encoded, and Lynx
   * documents it as needing engine 4.0. An older engine doesn't degrade: on
   * engine 3.7 it logs "unknown Decode Error" and aborts the app. The encoder
   * that ships with this toolchain (`@lynx-js/tasm` 0.0.49, pinned by
   * `@lynx-js/template-webpack-plugin` 0.16.6) accepts at most `'3.9'`, so
   * set that: engines up to 3.8 then reject the bundle cleanly, and only a
   * 3.9 engine is left to try. The build warns when `enableCSSRule` is on
   * with a lower value.
   *
   * Same option, same default, as ReactLynx's `pluginReactLynx`, where
   * `engineVersion` replaced the old name `targetSdkVersion`.
   *
   * @defaultValue '3.2'
   */
  engineVersion?: string;
  /**
   * The old name of {@link PluginAngularLynxOptions.engineVersion}, kept as
   * an alias. `engineVersion` wins when both are set.
   *
   * @deprecated Use `engineVersion`.
   */
  targetSdkVersion?: string;
  /**
   * Set the `ng-ref-{id}` selector attribute on every created element (one
   * extra `__SetAttribute` native call per element on the Main Thread), which
   * is what lets `ElementRef.nativeElement`'s `fields`/`invoke`/
   * `setNativeProps`/`path` and `lynxSelectAll(...)` target a specific
   * element via `lynx.createSelectorQuery()`. It's **not** a
   * Background-Thread-emitted wire op — it costs nothing on the wire either
   * way, only a Main-Thread native call per element (see
   * docs/10-element-queries.md).
   *
   * Three modes:
   * - `'lazy'` (default) — see below.
   * - `true` — every element gets the attribute natively at
   *   `CREATE` time, synchronously, on the Main Thread. Queries always
   *   resolve immediately.
   * - `false` — no element ever gets it. Every selector query becomes a
   *   silent no-op (the selector matches nothing). Only for an app that
   *   provably never calls one anywhere — a footgun for anything else.
   * - `'lazy'` — the attribute is skipped at `CREATE` and instead set, per
   *   element, the first time that element is actually queried
   *   (`fields`/`invoke`/`setNativeProps`/`path`): the Background Thread
   *   emits a real `SET_ATTR` op, flushes it, and awaits the Main Thread's
   *   ack (`whenFlushed()`) before issuing the actual `createSelectorQuery()`
   *   call — so an element that's queried repeatedly still only pays one
   *   extra round-trip, on its first query, and an element that's never
   *   queried never pays the native call at all. Trades a one-time latency
   *   hit on an element's first query for skipping the native call on
   *   elements that turn out to never be queried. `lynxSelectAll(...)`
   *   (a whole-tree CSS-selector query, not `ng-ref`-based) is unaffected by
   *   any of these three modes. The default since 0.1.0-rc.1: most elements
   *   are never queried, so each one used to pay a native call for nothing.
   *
   * @defaultValue 'lazy'
   */
  enableSelectorQueries?: boolean | 'lazy';
  /**
   * Initialise the new gesture handlers. `[lynxGesture]` registers through
   * them, and Lynx only starts them with this flag on.
   * Same option as ReactLynx's `pluginReactLynx`. @defaultValue false
   *
   * @experimental Gestures are experimental, see docs/32-gestures.md.
   */
  enableNewGesture?: boolean;
  /** Same option as ReactLynx's `pluginReactLynx`. @defaultValue false */
  enableAccessibilityElement?: boolean;
  /** Same option as ReactLynx's `pluginReactLynx`. @defaultValue true */
  defaultDisplayLinear?: boolean;
  /** Same option as ReactLynx's `pluginReactLynx`. */
  customCSSInheritanceList?: string[];
  /**
   * Tags the host app registers with its own native UI (Lynx's "Custom Native
   * Component" guide). Any other unknown tag in a template becomes a plain
   * `<view>`, which is what a component selector needs. Use the tags with
   * `CUSTOM_ELEMENTS_SCHEMA` (dashed names) or `NO_ERRORS_SCHEMA`.
   * @defaultValue []
   */
  nativeElements?: string[];
  /** Keep debug info outside the template bundle to shrink it. @defaultValue true */
  debugInfoOutside?: boolean;
  /**
   * Modules to include in the **Main-Thread** bundle (in addition to the
   * executor). Use this to register main-thread worklets — each listed module
   * runs on load and should call `registerWorklet(...)` from
   * `ng-lynx/worklet`. @defaultValue []
   */
  mainThreadModules?: string[];
  /**
   * Compile templates **ahead of time** with `ngtsc` (via `@ngtools/webpack`)
   * instead of bundling `@angular/compiler` for JIT. Smaller bundles, faster
   * startup, and enables initializer APIs (`viewChild()`, `input()`, …).
   * Set `aot: false` to fall back to JIT (bundles `@angular/compiler`).
   * @defaultValue true (AOT)
   */
  aot?: boolean;
  /**
   * Path to the app's `tsconfig.json` (used by AOT / `ngtsc`). Resolved from the
   * project root. @defaultValue 'tsconfig.json'
   */
  tsconfig?: string;
  /**
   * Path to a **first-screen snapshot** (generated by `ng-lynx-capture`,
   * see docs/20-first-screen.md). The snapshot is embedded in the Main-Thread
   * bundle and painted synchronously inside `renderPage()` — the first frame
   * appears before the Background Thread has booted Angular. When the real
   * app's first batch arrives it hydrates in place (or, if it doesn't match,
   * replaces the snapshot). Resolved from the project root.
   */
  firstScreen?: string;
  /**
   * Let dynamic `import()` (Angular lazy routes: `loadComponent` /
   * `loadChildren`) emit **real async chunks**, loaded on demand through
   * Lynx's own chunk-loading runtime (`lynx.requireModuleAsync`) instead of
   * being bundled into their importer. The lazy code's download and parse
   * cost then moves off the critical startup path.
   *
   * The async chunk files are **not** packed into the `.lynx.bundle` — they
   * are sibling assets fetched from `publicPath` at navigation time. The dev
   * server serves them automatically; a production deploy must host them
   * next to the bundle (same constraint as ReactLynx code splitting). See
   * docs/15-routing.md.
   *
   * @defaultValue false — dynamic imports are bundled eagerly (`import()`
   * semantics are kept, but the app ships as one self-contained file that
   * needs no network at navigation time).
   */
  asyncChunks?: boolean;
  /**
   * Build this entry as a **standalone dynamic-component bundle** — a
   * loadable card that some *other* ng-lynx app fetches at runtime with
   * `loadDynamicComponent(source)`, rather than an app that boots itself.
   * Its entry module must `export default` (or export) the component class
   * instead of calling `bootstrapLynxApplication`.
   *
   * This is a whole-build mode, like ReactLynx's own
   * `experimental_isLazyBundle`: run it as a separate `rspeedy build` with
   * its own config file (see docs/38-dynamic-component.md), not alongside a
   * normal app build.
   *
   * What it changes:
   * - packages the output as a Lynx **lazy bundle**
   *   (`appType: 'DynamicComponent'`) rather than a `card`;
   * - marks the shared framework modules (see
   *   {@link PluginAngularLynxOptions.sharedModules}) as **externals** that
   *   resolve to the host's already-loaded instances at runtime, so this
   *   bundle contains no second copy of Angular — which is a hard
   *   requirement, not an optimization: a dynamic bundle carrying its own
   *   `@angular/core` fails with `NG0203` even at the identical version
   *   (tested; see docs/38-dynamic-component.md);
   * - replaces the Main-Thread entry with a **no-op stub**, because the host
   *   already owns the Main-Thread executor — shipping the real one here
   *   would re-register `renderPage`/`ngPatchUpdate` over the host's;
   * - exposes the entry's exports as the bundle's module exports, which is
   *   what `getDynamicComponentExports` hands back to `loadDynamicComponent`.
   *
   * @defaultValue false
   *
   * @experimental Dynamic components are experimental, see docs/38-dynamic-component.md.
   */
  dynamicComponent?: boolean;
  /**
   * Build this app as a **host** for dynamic components: publish its own
   * framework instances into the shared registry
   * (`lynx[Symbol.for('__ANGULAR_LYNX_EXPORTS__(<id>)')]`) so bundles built
   * with {@link PluginAngularLynxOptions.dynamicComponent} resolve against
   * them instead of bundling their own.
   *
   * Only needed by an app that actually calls `loadDynamicComponent`. It
   * costs a small amount of bundle size (the listed modules can no longer be
   * tree-shaken away, since the registry references their whole namespace),
   * which is why it isn't on by default.
   *
   * @defaultValue false
   *
   * @experimental Dynamic components are experimental, see docs/38-dynamic-component.md.
   */
  dynamicComponentHost?: boolean;
  /**
   * The module ids shared between a dynamic-component host and its dynamic
   * components. **Both sides must agree** — a host publishes exactly this
   * list, and a dynamic bundle externalizes exactly this list.
   *
   * Defaults to `DEFAULT_SHARED_MODULES` — `@angular/core`, `ng-lynx`
   * and `ng-lynx/elements`, the identity-critical set every
   * ng-lynx app already contains. Matching is on the **exact request
   * string**, so subpaths need their own entries (`ng-lynx` does not
   * cover `ng-lynx/elements`).
   *
   * Extend it when your dynamic components use more of the framework —
   * `@angular/common`, `@angular/forms`, `ng-lynx/forms`, `@angular/router`,
   * or your own design-system package. Those are not shared by default
   * because a host has to import a shared module's whole namespace, which
   * defeats tree-shaking; only add what you need. A module the producer
   * externalizes but the host never published throws a message naming it at
   * first use, rather than failing obscurely.
   *
   * @experimental Dynamic components are experimental, see docs/38-dynamic-component.md.
   */
  sharedModules?: string[];
  /**
   * Build-time i18n: inline `$localize` messages for **one locale** into this
   * build's output — the same `@angular/localize/tools` translate mechanism
   * Angular CLI's own `--localize` uses, run as an `enforce: 'post'`
   * babel-loader stage matching ngtools' own `.ts`-file rule (see
   * {@link applyI18nInlining}'s doc for why that specific hook point is the
   * one that actually works), so the translated text is already in the
   * packaged `.lynx.bundle`/`.web.bundle` — no separate post-build step, and
   * no dependency on `@angular/localize`'s non-public `Translator`/
   * `SourceFileTranslationHandler` classes (which operate on files on disk,
   * not source modules mid-build, and can't parse Lynx's packaged bundle
   * format anyway — see docs/35-i18n.md).
   *
   * Both message sources work: `$localize\`:@@id:text\`` tagged templates in
   * component code, and the declarative `i18n="..."` template attribute.
   *
   * `ng-lynx-extract-i18n` extracts both. See docs/35-i18n.md.
   *
   * To ship several locales, run `rspeedy build` once per locale with a
   * different `i18n` value and a distinct `output.distPath` each time — this
   * plugin only ever produces a single-locale build per invocation, matching
   * how Angular CLI's classic per-locale output directories work.
   */
  i18n?: {
    /** BCP-47 locale code — informational only (surfaces in diagnostics). */
    locale: string;
    /**
     * Path to a translation file in the `SimpleJsonTranslationParser` format
     * (`{ "locale": "...", "translations": { "message-id": "..." } }`),
     * resolved from the project root.
     */
    translationFile: string;
  };
}

/**
 * Keep only the environments the app config declares. Merging a key into
 * `environments` *creates* that environment, so configuring `web` for every
 * app made a Lynx-only build — e.g. a native iOS app built through
 * Sparkling with `environments: { lynx: {} }` — also build a web bundle and
 * ship it inside the app. With no `environments` at all, everything is kept:
 * that's this plugin's documented `{ lynx: {}, web: {} }` setup, unchanged.
 */
function pickDeclaredEnvironments<T extends Record<string, unknown>>(config: unknown, environments: T): Partial<T> {
  const declared = (config as { environments?: Record<string, unknown> } | null)?.environments;
  if (!declared) return environments;
  return Object.fromEntries(Object.entries(environments).filter(([name]) => name in declared)) as Partial<T>;
}

/** `LynxTemplatePlugin`'s own default, and ReactLynx's. */
const DEFAULT_TARGET_SDK_VERSION = '3.2';

/** `'4.0'` → `[4, 0]`; compares as many parts as both sides have. */
function isOlderVersion(version: string, than: string): boolean {
  const a = version.split('.').map(Number);
  const b = than.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
}

/**
 * The highest `targetSdkVersion` the bundled encoder accepts: `@lynx-js/tasm`
 * 0.0.49 fails the build above it ("current compiler only support lynx
 * version [1.0, 3.9]"). tasm 0.0.51 accepts up to 4.2, but
 * `@lynx-js/template-webpack-plugin` 0.16.6 still pins 0.0.49.
 */
const MAX_ENCODABLE_TARGET_SDK_VERSION = '3.9';

/**
 * `pluginLynxConfig({ enableCSSRule: true })` switches the stylesheet to the
 * unified rule encoding `@media` needs, which Lynx documents as engine 4.0+.
 * An older engine doesn't degrade, it crashes: measured on Lynx Explorer with
 * engine 3.7, the template reader logs "unknown Decode Error" over and over,
 * then the app aborts (SIGABRT). A bundle at the default `targetSdkVersion`
 * (3.2) lets every one of those engines try. The encoder can't declare 4.0,
 * so the best available floor is 3.9; say so at build time.
 */
/**
 * `pluginLynxConfig` taps the template hooks of the `LynxTemplatePlugin` class
 * rspeedy's build engine exposes, while this plugin registers instances of its
 * own import. Hooks are per class, so if the package manager installs two
 * copies of `@lynx-js/template-webpack-plugin`, `pluginLynxConfig({
 * enableCSSRule: true })` silently stops reaching our bundles: `@media` is
 * dropped with no error. One copy is what keeps it working; say so if not.
 */
function warnIfTemplatePluginCopiesDiffer(api: RsbuildApiLike): void {
  let checked = false;
  api.modifyBundlerChain(() => {
    if (checked) return;
    checked = true;
    const exposed = api.useExposed?.<{ LynxTemplatePlugin?: unknown }>(Symbol.for('LynxTemplatePlugin'))?.LynxTemplatePlugin;
    if (!exposed || exposed === LynxTemplatePlugin) return;
    console.warn(
      '[ng-lynx] Two copies of @lynx-js/template-webpack-plugin are installed: the Lynx build engine ' +
        'exposes one and ng-lynx builds with the other. Plugins that tap the template hooks through the ' +
        "build engine, such as pluginLynxConfig, won't reach ng-lynx's bundles. Align the versions so " +
        'one copy is installed.',
    );
  });
}

function warnIfCSSRuleNeedsNewerEngine(api: RsbuildApiLike, targetSdkVersion: string): void {
  let warned = false;
  api.modifyBundlerChain(() => {
    if (warned) return;
    // Read here, not in setup: pluginLynxConfig may be listed after us.
    const lynxConfig = api.useExposed?.<{ config?: { enableCSSRule?: boolean } }>(Symbol.for('lynx.config'))?.config;
    if (!lynxConfig?.enableCSSRule || !isOlderVersion(targetSdkVersion, MAX_ENCODABLE_TARGET_SDK_VERSION)) return;
    warned = true;
    console.warn(
      `[ng-lynx] pluginLynxConfig({ enableCSSRule: true }) needs a Lynx 4.0+ engine, but the bundle declares ` +
        `engine version '${targetSdkVersion}', so older engines will load it, fail to decode the stylesheet, and ` +
        `abort the app. Set pluginAngularLynx({ engineVersion: '${MAX_ENCODABLE_TARGET_SDK_VERSION}' }), the ` +
        `highest the encoder accepts: engines up to 3.8 then reject the bundle instead.`,
    );
  });
}

/**
 * A minimal structural type for the rsbuild plugin API surface we touch. The
 * real type is `RsbuildPluginAPI` from `@rsbuild/core`; we keep it loose so the
 * package type-checks without depending on `@rsbuild/core`'s types directly.
 */
interface RsbuildApiLike {
  modifyRsbuildConfig(
    fn: (config: unknown, utils: { mergeRsbuildConfig: (...c: unknown[]) => unknown }) => unknown,
  ): void;
  modifyBundlerChain(
    fn: (
      chain: unknown,
      ctx: {
        environment: { name: string; webSocketToken?: string };
        isDev: boolean;
        isProd: boolean;
      },
    ) => void,
  ): void;
  modifyRspackConfig(
    fn: (
      config: {
        plugins?: unknown[];
        output?: {
          hotUpdateMainFilename?: string;
          hotUpdateChunkFilename?: string;
          chunkFilename?: unknown;
        };
      },
      utils: {
        environment: { name: string };
        isDev: boolean;
        rspack: { HotModuleReplacementPlugin: new () => unknown };
      },
    ) => void,
  ): void;
  /** Populated once the dev server is listening; absent for `build`. */
  context: { devServer?: { hostname: string; port: number; https: boolean } };
  /** What another plugin published with `api.expose` (e.g. `pluginLynxConfig`'s config). */
  useExposed?<T>(id: symbol): T | undefined;
}

interface RsbuildPluginLike {
  name: string;
  pre?: string[];
  setup(api: RsbuildApiLike): void;
}

/**
 * Create the Angular-Lynx rsbuild plugin.
 * @public
 */
export function pluginAngularLynx(
  options: PluginAngularLynxOptions = {},
): RsbuildPluginLike {
  const {
    enableCSSSelector = true,
    enableCSSInheritance = false,
    enableCSSInvalidation = true,
    engineVersion,
    targetSdkVersion: legacyTargetSdkVersion,
    enableSelectorQueries = 'lazy',
    enableNewGesture,
    enableAccessibilityElement,
    defaultDisplayLinear,
    customCSSInheritanceList,
    nativeElements = [],
    debugInfoOutside = true,
    mainThreadModules = [],
    aot = true,
    tsconfig = 'tsconfig.json',
    firstScreen,
    asyncChunks = false,
    dynamicComponent = false,
    dynamicComponentHost = false,
    sharedModules = [...DEFAULT_SHARED_MODULES],
    i18n,
  } = options;
  const targetSdkVersion = engineVersion ?? legacyTargetSdkVersion ?? DEFAULT_TARGET_SDK_VERSION;
  if (engineVersion && legacyTargetSdkVersion && engineVersion !== legacyTargetSdkVersion) {
    console.warn(
      `[ng-lynx] Both engineVersion ('${engineVersion}') and its old name targetSdkVersion ` +
        `('${legacyTargetSdkVersion}') are set; using engineVersion.`,
    );
  }

  return {
    name: 'lynx:angular',
    // Run after the Lynx config + rsbuild plugin-api plugins so our chain edits
    // see the entries and Lynx hooks they create.
    pre: ['lynx:rsbuild:plugin-api', 'lynx:config'],

    setup(api) {
      // ① Global defines + engine target.
      api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
        mergeRsbuildConfig(config, {
          source: {
            // Compile node_modules JS too: many packages ship ES2021+ syntax
            // the Lynx engine can't parse.
            include: [/\.(?:js|mjs|cjs)$/],
            define: {
              __DEV__: "process.env.NODE_ENV !== 'production'",
              // ngDevMode MUST be a single literal, not an expression: Angular
              // assigns properties to it (e.g. `ngDevMode.x = …`), so an
              // expression define produces `(a !== b) = …` → a syntax error the
              // Lynx engine rejects at load. `false` = Angular production mode;
              // the dev-only blocks become dead code. (Don't define it as an
              // expression even for dev builds.)
              ngDevMode: 'false',
              ngServerMode: 'false',
              // Read by ops-apply.ts (CREATE, Main Thread — only the `true`
              // eager mode sets the attribute there) and shadow-element.ts
              // (Background Thread — the `'lazy'` mode defers it to first
              // query). JSON.stringify (not String) so `'lazy'` round-trips
              // as a quoted string literal in the injected source, not the
              // bare (undefined) identifier `lazy`. See
              // `enableSelectorQueries`'s doc above.
              __ENABLE_SELECTOR_QUERIES__: JSON.stringify(enableSelectorQueries),
              // Read by event-registry.ts (Background Thread): whether to
              // buffer `publishEvent` calls for a not-yet-registered sign
              // (a real pre-boot tap on the first-screen snapshot) instead of
              // dropping them. Only meaningful when `firstScreen` is set — an
              // app without one never has pre-boot-tappable elements, so
              // buffering never activates either way. See
              // docs/20-first-screen.md.
              __HAS_FIRST_SCREEN__: String(Boolean(firstScreen)),
              // Read by ops-apply.ts (Main Thread). See `nativeElements`'s doc.
              __NATIVE_ELEMENTS__: JSON.stringify(nativeElements),
              // Read by slider.ts (Background Thread): whether the Main-Thread
              // bundle has the worklet runtime (applyEntry bundles it for a
              // non-empty `mainThreadModules`), so `<lynx-slider>` can drag
              // there. A dynamic component's Main-Thread part is a stub.
              __WORKLET_RUNTIME__: String(mainThreadModules.length > 0 && !dynamicComponent),
            },
          },
          tools: {
            rspack: {
              output: { iife: false },
              // A dynamic-component bundle must contain NO copy of the
              // framework: it runs in its host's JS realm and its component
              // is mounted by the host's own change detection and DI, which
              // only works when exactly one `@angular/core` exists there (a
              // second copy fails with NG0203 even at an identical version —
              // tested, see docs/38-dynamic-component.md). `var`-type
              // externals turn each shared import into a property read off
              // the namespace the host published, so nothing is bundled and
              // the identity is the host's. See runtime/src/shared-runtime.ts.
              ...(dynamicComponent
                ? {
                    externalsType: 'var' as const,
                    externals: Object.fromEntries(
                      sharedModules.map((id) => [id, sharedModuleExpression(id)]),
                    ),
                  }
                : {}),
              // Dynamic `import()` (Angular lazy routes: `loadComponent` /
              // `loadChildren`) — two modes (docs/15-routing.md):
              //
              // Default (`asyncChunks: false`): `eager` keeps `import()`
              // semantics (deferred evaluation, promise of the module
              // namespace) but bundles the module into its importer, so lazy
              // routes work from the single self-contained `.lynx.bundle` —
              // no network at navigation time.
              //
              // `asyncChunks: true`: leave rspack's default (`lazy`) so
              // dynamic imports emit real async chunks. rspeedy already
              // applies the full loading runtime to every environment
              // (`chunkLoading: 'lynx'` + `chunkFormat: 'commonjs'` via
              // `@lynx-js/chunk-loading-webpack-plugin`), under which
              // `__webpack_require__.e` resolves a chunk through
              // `lynx.requireModuleAsync(publicPath + chunkFile)`. That
              // primitive is real on both targets — on device it's the
              // engine's native loader (the chunk having been wrapped by
              // `RuntimeWrapperWebpackPlugin` below), and on the web preview
              // `@lynx-js/web-core`'s Background worker implements it as
              // fetch + evaluate (`createChunkLoading.js` →
              // `nativeApp.loadScriptAsync`). An earlier note here claimed
              // web-core lacks it — that error actually came from rsbuild's
              // dev client running where `lynx` is a different, minimal
              // object; the Background Thread's `lynx` has it. The chunk
              // files are NOT packed into the `.lynx.bundle` (the template
              // manifest only takes the entrypoint's initial chunks), so
              // they must stay fetchable at `publicPath` — automatic in dev,
              // a documented hosting requirement in production.
              module: {
                parser: {
                  javascript: {
                    dynamicImportMode: asyncChunks ? 'lazy' : 'eager',
                  },
                },
              },
            },
            // NOTE: don't set tools.swc.jsc.target — rspeedy manages the engine
            // target via `env` (mutually exclusive with jsc.target).
          },
          // `defineWorklet(fn)` and `registerWorklet(fn)` take the worklet's id
          // from `fn.name`, on both threads. The Lynx build engine minifies
          // with `inline: 2`, which folds a single-use `function pressFadeMT`
          // into an anonymous `defineWorklet(function (e) {…})`, so a
          // production build threw "can't derive a worklet id" at load.
          // Keeping function names keeps the ids. The engine merges this over
          // its own minifier options; a user's `output.minify: false` stays.
          ...(mainThreadModules.length > 0
            && (config as { output?: { minify?: unknown } }).output?.minify !== false
            ? {
                output: {
                  minify: {
                    jsOptions: {
                      minimizerOptions: {
                        compress: { keep_fnames: true },
                        mangle: { keep_fnames: true },
                      },
                    },
                  },
                },
              }
            : {}),
          // The dev-client error overlay is a DOM-rendered `<div>` injected into
          // the bundle. On the `lynx` environment there's no DOM to render it
          // into (the Background Thread has no `document`) — at best it's a
          // silent no-op, at worst dev-only noise. Scoped to `lynx` only: the
          // `web` environment runs in a real browser tab, where the overlay is
          // genuinely useful. `dev.client` is one of the few keys rsbuild allows
          // overriding per-environment (`AllowedEnvironmentDevKeys`).
          //
          // HMR on `web` (the `@lynx-js/web-core` preview) hard-fails on every
          // change: `TypeError: lynx.requireModuleAsync is not a function` —
          // rsbuild's HMR runtime tries to hot-swap a module through Lynx's own
          // async module-loading primitive, which `@lynx-js/web-core` doesn't
          // implement. `dev.hmr: false` alone isn't enough: it falls back to
          // `dev.liveReload`, whose dev-client websocket listener also crashes
          // — `web-core` runs the Background-Thread bundle in an actual Web
          // Worker (mirroring the real dual-thread engine even in the browser),
          // and rsbuild's live-reload client (injected into *that* bundle too,
          // since it also needs hot-update notifications) calls a bare
          // `location.reload()`, which throws `TypeError: Cannot read
          // properties of undefined (reading 'reload')` inside the worker
          // (which has no `window`/`location`). Both keys are kept `false` so
          // that broken client is never injected into the Worker at all; this
          // is scoped to `web` only via `AllowedEnvironmentDevKeys`.
          //
          // In place of rsbuild's client, `applyEntry` prepends a small custom
          // one (`dev-reload-client.ts`) to the Background bundle of **both**
          // environments, dev builds only: it speaks the same `/rsbuild-hmr`
          // websocket protocol directly (independent of these two flags — the
          // dev server's websocket endpoint is always live) and drives
          // state-preserving component hot-swap. On `web` it can't do more
          // than a console notice when a change isn't swappable — a reload
          // was tried and found unreachable from any thread our code runs on
          // in this web-core version: `lynx.reload()` (the engine's
          // documented BG-thread reload primitive) is a confirmed no-op for
          // picking up new code, and the Main-Thread bundle has no real
          // `window` either (`location` reports `about:srcdoc`, empty
          // host/port — nothing to call `.reload()` on). On `lynx` a reload
          // *is* reachable, so the same fallback asks the DevTool for one
          // (`Page.reload` over CDP). See docs/05-build-integration.md.
          //
          // NOTE `lynx`'s `dev.hmr` is deliberately left at its default
          // (`true`) — unlike `web`'s above. That's what keeps rsbuild's
          // `HotModuleReplacementPlugin` enabled for the environment, which
          // is what emits the hot-update assets our client fetches. It does
          // *not* inject rsbuild's own (crashing) client there: for `lynx`,
          // rspeedy only configures aliases + ProvidePlugins and leaves the
          // actual client import to the framework plugin — verified by
          // inspecting the built `lynx` bundle's module graph, which contains
          // no dev-client modules at all.
          environments: pickDeclaredEnvironments(config, {
            lynx: { dev: { client: { overlay: false } } },
            web: {
              dev: {
                hmr: false,
                liveReload: false,
                // Serve the `web` environment's assets **same-origin**.
                //
                // rspeedy's dev default is an absolute LAN-IP prefix
                // (`http://192.168.1.129:3000/`) so a phone on the same Wi-Fi
                // can fetch them. The `web` environment never runs on the
                // phone — it runs in a browser tab that is almost always
                // opened at `localhost`, and the absolute prefix makes every
                // asset a **cross-origin subresource** there. Two long-standing
                // symptoms, one cause:
                //
                //  - The dev server sends `Cross-Origin-Embedder-Policy:
                //    require-corp`, which blocks those subresources outright
                //    (`ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaulted…`).
                //    That's why `<video>`, `<image>` and `<svg src>` appeared
                //    broken in the web preview — see examples/media and
                //    examples/primitives, which both documented it as an
                //    unavoidable artifact.
                //  - `dev-reload-client.ts` resolves its WebSocket against
                //    `__webpack_require__.p`, so it dialled the LAN IP from a
                //    localhost page, failed the handshake, and retried forever
                //    — tens of `WebSocket connection … failed` errors per boot,
                //    burying every real console message.
                //
                // A bare `'/'` would be the natural "same origin as the page"
                // value, but the Lynx build engine's `printUrls` does
                // `new URL(assetPrefix)` and throws `TypeError: Invalid URL` on
                // a relative one. `<port>` is rsbuild's own placeholder,
                // substituted with the port the dev server actually bound (so
                // it stays correct when 3000 is taken and it falls back to
                // 3001). `lynx` keeps the absolute LAN-IP prefix it needs.
                assetPrefix: 'http://localhost:<port>/',
              },
            },
          }),
        }),
      );

      // ①.5 Hot-update EMISSION for `web` dev builds (rspack's own
      // HotModuleReplacementPlugin) — deliberately decoupled from `dev.hmr`,
      // which stays `false` so rsbuild's dev client (the thing that crashes
      // in the Background Worker, see the `environments.web` comment above)
      // is never injected. With only the plugin enabled, each rebuild emits
      // standard `<hash>.hot-update.json` + `<chunk>.<hash>.hot-update.js`
      // assets containing exactly the module factories that changed — and
      // nothing in the bundle *calls* the hot runtime, so it's inert on its
      // own. Our dev-reload client consumes those assets directly (fetch +
      // evaluate against the live module graph) to drive state-preserving
      // component hot-swap (`hotSwapComponent`, docs/31-hot-swap.md) —
      // bypassing `module.hot.apply()`, whose chunk-loading path is what
      // needed the unimplemented `lynx.requireModuleAsync`.
      api.modifyRspackConfig((config, { environment, isDev, rspack }) => {
        const isWebEnv = environment.name === 'web' || environment.name.startsWith('web-');
        if (!isWebEnv) return;
        // Distinct async-chunk filenames for the `web` environment (same
        // collision family as the hot-update rename below): both envs emit
        // an async chunk under the identical default path — in dev with no
        // contenthash — and on the shared dev server the `lynx` env's copy
        // wins the path. That copy is runtime-wrapped (`tt.define(...)`) for
        // the device, so the web Background worker evaluates it to an empty
        // module.exports and the chunk never installs: the lazy route hangs
        // silently (observed live). The `.web.` infix keeps the two envs'
        // chunks at different URLs; `__webpack_require__.u()` is generated
        // from this template, so the runtime follows automatically.
        config.output ??= {};
        const cf = config.output.chunkFilename;
        if (typeof cf === 'string' && cf.endsWith('.js') && !cf.includes('.web.')) {
          config.output.chunkFilename = `${cf.slice(0, -3)}.web.js`;
        }
        if (!isDev) return;
        (config.plugins ??= []).push(new rspack.HotModuleReplacementPlugin());
        // Distinct names for THIS environment's hot-update assets: the `lynx`
        // env compiles the same entry/chunk names into the same dev-server
        // asset space (its own dev transport has HMR on by rspeedy default),
        // so the default `main.<hash>.hot-update.json` would collide. The
        // bundle's own `__webpack_require__.hmrF()`/`.hu()` pick these
        // templates up automatically, so the dev client never hardcodes them.
        config.output.hotUpdateMainFilename = '[runtime].[fullhash].web.hot-update.json';
        config.output.hotUpdateChunkFilename = '[id].[fullhash].web.hot-update.js';
      });

      // ② Angular compilation (AOT/ngtsc by default, JIT with `aot: false`).
      applyAngularCompiler(api, { aot, tsconfig });

      // ②.5 Link the package's partial-Ivy declarations to full Ivy against the
      // app's Angular version (version-independent package output).
      applyAngularLinker(api);

      // ②.6 Inline one locale's translations into `$localize` calls, if configured.
      // Requires AOT: it hooks onto `angular-aot-ts`, the rule that only
      // exists when `applyAngularCompiler` takes its AOT branch.
      if (i18n) {
        if (!aot) {
          throw new Error(
            "[ng-lynx] pluginAngularLynx({ i18n }) requires AOT (the default) — "
              + "it hooks onto the ngtools AOT compile rule; JIT has no equivalent to hook onto.",
          );
        }
        applyI18nInlining(api, i18n);
      }

      warnIfCSSRuleNeedsNewerEngine(api, targetSdkVersion);
      warnIfTemplatePluginCopiesDiffer(api);

      // ③ Dual-thread entry splitting + Lynx packaging.
      applyEntry(api, {
        enableCSSSelector,
        enableCSSInheritance,
        enableCSSInvalidation,
        // Only what the app set, so `pluginLynxConfig` and the template
        // plugin's defaults still apply to the rest.
        templateOptions: Object.fromEntries(
          Object.entries({
            enableNewGesture,
            enableAccessibilityElement,
            defaultDisplayLinear,
            customCSSInheritanceList,
          }).filter(([, value]) => value !== undefined),
        ),
        targetSdkVersion,
        debugInfoOutside,
        mainThreadModules,
        aot,
        asyncChunks,
        dynamicComponent,
        // The host's publishing module rides in as one more prepended
        // Background import (same shape as the dev-reload client). Never
        // added to a dynamic-component build: that side *consumes* the
        // registry, and publishing there would overwrite nothing (publish is
        // first-wins) but would defeat the externals entirely by bundling
        // the very modules being externalized.
        sharedRuntimeHostModule:
          dynamicComponentHost && !dynamicComponent
            ? createSharedRuntimeHostModule(sharedModules)
            : undefined,
        // A first-screen snapshot rides in as one more Main-Thread module — a
        // generated file calling setFirstScreenOps(<captured ops>). Kept
        // separate from mainThreadModules: a non-empty *that* list is what
        // opts the build into bundling the worklet runtime.
        firstScreenModule: firstScreen ? createFirstScreenModule(firstScreen) : undefined,
      });
    },
  };
}

/**
 * Materialize the first-screen snapshot as a Main-Thread module: a generated
 * file (in the OS temp dir, content-addressed) that hands the captured ops
 * string to `setFirstScreenOps`. The import uses the **absolute path** of the
 * Main-Thread entry so it resolves regardless of where the generated file
 * lives — and dedupes with the entry import of the same file, so both see the
 * same module instance.
 */
function createFirstScreenModule(firstScreenPath: string): string {
  const snapshotFile = path.resolve(process.cwd(), firstScreenPath);
  let ops: string;
  try {
    ops = readFileSync(snapshotFile, 'utf8').trim();
  } catch {
    throw new Error(
      `[ng-lynx] firstScreen snapshot not found at ${snapshotFile}. `
        + 'Generate it with: npx ng-lynx-capture <entry.ts> '
        + `${firstScreenPath} (see docs/20-first-screen.md).`,
    );
  }
  try {
    JSON.parse(ops);
  } catch {
    throw new Error(
      `[ng-lynx] firstScreen snapshot at ${snapshotFile} is not valid JSON — `
        + 'regenerate it with ng-lynx-capture.',
    );
  }
  const entryMain = path.resolve(angularLynxRoot, 'main-thread/dist/entry-main.js');
  const source =
    `import { setFirstScreenOps } from ${JSON.stringify(entryMain)};\n`
    + `setFirstScreenOps(${JSON.stringify(ops)});\n`;
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const dir = path.join(tmpdir(), 'ng-lynx-first-screen');
  mkdirSync(dir, { recursive: true });
  const modulePath = path.join(dir, `first-screen.${hash}.mjs`);
  writeFileSync(modulePath, source);
  return modulePath;
}

/**
 * Write a generated module to the OS temp dir, content-addressed so repeated
 * builds reuse the same file (and so two different contents never collide).
 * Shared by the generated first-screen / dev-reload / dynamic-component
 * modules below.
 */
function writeGeneratedModule(dir: string, basename: string, source: string, baseDir = tmpdir()): string {
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const outDir = path.join(baseDir, dir);
  mkdirSync(outDir, { recursive: true });
  const modulePath = path.join(outDir, `${basename}.${hash}.mjs`);
  writeFileSync(modulePath, source);
  return modulePath;
}

/**
 * Materialize the **host** side of the dynamic-component shared runtime: a
 * Background-Thread module that imports each shared module's namespace and
 * publishes it into the registry a dynamic bundle reads from (see
 * `runtime/src/shared-runtime.ts` for why this is required rather than an
 * optimization).
 *
 * Imported as a namespace (`import * as ns`) so the whole module object is
 * published — a dynamic component may use any export, and the host can't
 * know which in advance. That's also why this costs bundle size and is
 * opt-in: it defeats tree-shaking for the listed modules.
 */
function createSharedRuntimeHostModule(modules: readonly string[]): string {
  const runtimeEntry = path.resolve(angularLynxRoot, 'runtime/dist/shared-runtime.js');
  const lines = [`import { publishSharedModule } from ${JSON.stringify(runtimeEntry)};`];
  modules.forEach((moduleId, i) => {
    lines.push(`import * as ns${i} from ${JSON.stringify(moduleId)};`);
  });
  modules.forEach((moduleId, i) => {
    lines.push(`publishSharedModule(${JSON.stringify(moduleId)}, ns${i});`);
  });
  // Written inside the app's own `node_modules`, NOT the OS temp dir the
  // other generated modules use: this one imports the shared ids as **bare
  // specifiers**, which must resolve through the app's own dependency tree so
  // that what gets published is the app's own instance of each module —
  // exactly the identity a dynamic component then reuses. From the OS temp
  // dir they don't resolve at all (`Module not found: Can't resolve
  // '@angular/core'`), and resolving them to absolute paths here instead
  // would risk picking a *different* file (e.g. a package's CJS entry) than
  // the one the app itself imports, quietly reintroducing the two-instance
  // split this whole mechanism exists to prevent.
  return writeGeneratedModule(
    '.ng-lynx',
    'shared-host',
    `${lines.join('\n')}\n`,
    path.resolve(process.cwd(), 'node_modules'),
  );
}

/**
 * Materialize the Main-Thread entry of a **dynamic-component** bundle: a
 * deliberate no-op.
 *
 * A dynamic component renders through its *host's* Main-Thread executor —
 * the host owns the page root, the element registry and the
 * `renderPage`/`ngPatchUpdate` globals, and the component's elements reach
 * the Main Thread as ordinary wire ops inside the host's own flush. Shipping
 * the real `entry-main.js` here would re-register those globals over the
 * host's live ones the moment the bundle is evaluated, which is why this
 * exists instead of simply reusing it. The chunk still has to be *present*,
 * because Lynx's template packaging expects a Lepus part.
 */
function createDynamicComponentMainThreadStub(): string {
  const source =
    '// Dynamic-component bundles render through the HOST\'s Main-Thread\n'
    + '// executor — see createDynamicComponentMainThreadStub in the plugin.\n'
    + 'export {};\n';
  return writeGeneratedModule('ng-lynx-dynamic-mt', 'dynamic-main-thread', source);
}

/**
 * Materialize a tiny Background-Thread shim (generated, content-addressed,
 * same pattern as {@link createFirstScreenModule}) that imports
 * {@link installDevReloadClient} from the runtime's compiled output and calls
 * it with the dev server's `/rsbuild-hmr` websocket URL baked in as a literal
 * — this bundle has no reachable real `location` to discover it from at
 * runtime (see the `environments.web` comment above). `0.0.0.0`/`::` (an
 * all-interfaces bind address, not something a client can connect to) is
 * normalized to `localhost`, the same normalization rsbuild's own server does
 * internally when it prints a browsable URL.
 *
 * Only the **path and query** of this URL are load-bearing on device: the
 * client prefers the origin the running bundle was actually served from
 * (`__webpack_require__.p`, the absolute LAN `publicPath` rspeedy resolves)
 * over the host baked in here, because `localhost` on a phone means the
 * phone. See `resolveSocketUrl` in dev-reload-client.ts.
 */
function createDevReloadModule(devServer: { hostname: string; port: number; https: boolean }, token: string | undefined): string {
  const hostname =
    devServer.hostname === '0.0.0.0' || devServer.hostname === '::' ? 'localhost' : devServer.hostname;
  const protocol = devServer.https ? 'wss' : 'ws';
  const url = new URL(`${protocol}://${hostname}:${devServer.port}/rsbuild-hmr`);
  if (token) url.searchParams.set('token', token);
  const clientEntry = path.resolve(angularLynxRoot, 'runtime/dist/dev-reload-client.js');
  const source =
    `import { installDevReloadClient } from ${JSON.stringify(clientEntry)};\n`
    + `installDevReloadClient(${JSON.stringify(url.toString())});\n`;
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const dir = path.join(tmpdir(), 'ng-lynx-dev-reload');
  mkdirSync(dir, { recursive: true });
  const modulePath = path.join(dir, `dev-reload.${hash}.mjs`);
  writeFileSync(modulePath, source);
  return modulePath;
}

/**
 * ES2019 downleveling for the Lynx engine (PrimJS). rspeedy forbids
 * `jsc.target`, so the transforms are forced via `env.include`. Applied in both
 * JIT and AOT modes.
 */
const ES2019_DOWNLEVEL = {
  env: {
    include: [
      'transform-logical-assignment-operators',
      'transform-optional-chaining',
      'transform-nullish-coalescing-operator',
      'transform-class-properties',
    ],
  },
} as const;

/**
 * Run the **Angular linker** over partial-Ivy declarations at app-build time.
 *
 * `ng-lynx` ships its runtime compiled in **partial** Ivy mode (`ngc`
 * `compilationMode: "partial"`), i.e. `ɵɵngDeclare*` calls rather than full
 * `ɵfac`/`ɵcmp`/`ɵprov` definitions. That keeps the published package
 * **version-independent**: the linker, which is part of the *app's* installed
 * `@angular/compiler-cli`, finalizes those declarations against whatever Angular
 * version the app uses. The same pass also links the partial declarations that
 * `@angular/*` framework packages ship in their fesm bundles.
 *
 * Implemented as an `enforce: 'pre'` `babel-loader` running only the linker
 * plugin (no presets, no module transform), so it sees the original ES modules
 * and rspeedy's SWC still downlevels the linked output to ES2019. The linker
 * matches partial declarations by **callee name** (`x.ɵɵngDeclareComponent` →
 * `ɵɵngDeclareComponent`), so it is robust to SWC renaming the core import.
 *
 * Requires `@babel/core` + `babel-loader` (deps) and the app's
 * `@angular/compiler-cli` (peer).
 */
function applyAngularLinker(api: RsbuildApiLike): void {
  const { createEs2015LinkerPlugin } = require('@angular/compiler-cli/linker/babel') as {
    createEs2015LinkerPlugin: (o: unknown) => unknown;
  };
  const { NodeJSFileSystem, ConsoleLogger, LogLevel } = require('@angular/compiler-cli') as {
    NodeJSFileSystem: new () => unknown;
    ConsoleLogger: new (l: number) => unknown;
    LogLevel: { warn: number };
  };
  const linkerPlugin = createEs2015LinkerPlugin({
    fileSystem: new NodeJSFileSystem(),
    logger: new ConsoleLogger(LogLevel.warn),
    linkerJitMode: false,
  });
  api.modifyBundlerChain((chain) => {
    const c = chain as {
      module: {
        rule: (n: string) => {
          test: (re: RegExp) => { enforce: (e: string) => void };
          include: { add: (re: RegExp) => { add: (re: RegExp) => void } };
          use: (n: string) => {
            loader: (l: string) => { options: (o: unknown) => void };
          };
        };
      };
    };
    const rule = c.module.rule('angular-linker');
    rule.test(/\.m?js$/).enforce('pre');
    // Only the files that carry partial declarations: Angular framework packages
    // and ng-lynx's own runtime.
    rule.include.add(/[\\/]@angular[\\/+]/).add(/[\\/]ng-lynx[\\/]/);
    rule
      .use('babel-linker')
      .loader(require.resolve('babel-loader'))
      .options({
        babelrc: false,
        configFile: false,
        browserslistConfigFile: false,
        compact: false,
        sourceType: 'unambiguous',
        inputSourceMap: false,
        plugins: [linkerPlugin],
      });
  });
}

/**
 * Inline one locale's translations into every `$localize` call, at
 * app-build time — see {@link PluginAngularLynxOptions.i18n}.
 *
 * Uses `makeEs2015TranslatePlugin` from `@angular/localize/tools` — its
 * *public*, documented export, unlike the `Translator`/
 * `SourceFileTranslationHandler` classes a post-build inlining step would
 * need, which aren't exported from `@angular/localize`'s package entry point
 * at all. Confirmed empirically that post-build inlining is a dead end here
 * anyway: Lynx's packaged `.lynx.bundle`/`.web.bundle` isn't plain JS (a
 * binary header precedes the JS payload), so Babel can't even parse it after
 * packaging. Running the translate plugin *during* the build instead means
 * the packaged bundle already contains the translated text.
 *
 * **Where this hooks in matters, and is easy to get wrong** — found by
 * testing, not assumed: `$localize` calls live in the *app's own* component
 * code, which AOT compiles via a rule matching `.ts` files directly
 * (`applyAngularCompiler`'s `angular-aot-ts` rule, `enforce: 'pre'`) — the
 * ngtools loader transforms TypeScript straight to compiled JS in place, so
 * that module's resolved request path stays `.ts` through its whole loader
 * chain. A naive rule matching `/\.m?js$/` (mirroring the linker's own
 * rule, which only ever touches real `.js` files already sitting in
 * `node_modules`) **never sees the app's own compiled output at all** —
 * confirmed by a real build producing byte-identical output whether or not
 * this function ran. The fix: match `.ts` files directly (the same pattern
 * `angular-aot-ts` uses) with `enforce: 'post'`, which webpack/rspack always
 * runs after every `'pre'` and normal loader for a module, regardless of
 * which rule registered it or in what order — so this doesn't depend on
 * being wired in before or after `applyAngularCompiler`'s own call.
 *
 * No `include` restriction — `$localize` calls can appear in any of the
 * app's own compiled modules, and the plugin is a no-op on files with none.
 */
function applyI18nInlining(
  api: RsbuildApiLike,
  opts: { locale: string; translationFile: string },
): void {
  const { Diagnostics, makeEs2015TranslatePlugin, SimpleJsonTranslationParser } = require(
    '@angular/localize/tools',
  ) as {
    Diagnostics: new () => { messages: { type: string; message: string }[] };
    makeEs2015TranslatePlugin: (
      diagnostics: unknown,
      translations: Record<string, unknown>,
      options?: { missingTranslation?: 'error' | 'warning' | 'ignore' },
    ) => unknown;
    SimpleJsonTranslationParser: new () => {
      analyze(filePath: string, contents: string): { canParse: boolean; hint?: unknown };
      parse(
        filePath: string,
        contents: string,
        hint: unknown,
      ): { locale?: string; translations: Record<string, unknown>; diagnostics: { messages: unknown[] } };
    };
  };

  const translationPath = path.resolve(process.cwd(), opts.translationFile);
  const contents = readFileSync(translationPath, 'utf8');
  const parser = new SimpleJsonTranslationParser();
  const analysis = parser.analyze(translationPath, contents);
  if (!analysis.canParse) {
    throw new Error(
      `[ng-lynx] i18n: could not parse translation file as SimpleJson: ${translationPath}`,
    );
  }
  const bundle = parser.parse(translationPath, contents, analysis.hint);
  if (bundle.diagnostics.messages.length > 0) {
    console.warn(
      `[ng-lynx] i18n (${opts.locale}): translation file diagnostics:`,
      bundle.diagnostics.messages,
    );
  }

  const diagnostics = new Diagnostics();
  const translatePlugin = makeEs2015TranslatePlugin(diagnostics, bundle.translations, {
    missingTranslation: 'ignore',
  });

  api.modifyBundlerChain((chain) => {
    const c = chain as {
      module: {
        rule: (n: string) => {
          test: (re: RegExp) => { enforce: (e: string) => void };
          use: (n: string) => {
            loader: (l: string) => { options: (o: unknown) => void };
          };
        };
      };
    };
    const rule = c.module.rule('ng-lynx-i18n');
    // Same test pattern as `angular-aot-ts` (`applyAngularCompiler`) — the
    // app's own component code is requested as `.ts`, never `.js`, through
    // its whole loader chain. `enforce: 'post'` guarantees this runs after
    // that rule's `enforce: 'pre'` ngtools loader has already compiled it.
    rule.test(/\.[cm]?ts$/).enforce('post');
    rule
      .use('babel-i18n')
      .loader(require.resolve('babel-loader'))
      .options({
        babelrc: false,
        configFile: false,
        browserslistConfigFile: false,
        compact: false,
        sourceType: 'unambiguous',
        inputSourceMap: false,
        plugins: [translatePlugin],
      });
  });
}

/**
 * Configure Angular compilation.
 *
 * **AOT (the default).** `ngtsc` precompiles templates at build time via
 * `@ngtools/webpack`'s `AngularWebpackPlugin` — no compiler is shipped. The
 * ngtools loader runs as a **pre-loader** so rspeedy's SWC still downlevels its
 * emitted JS to ES2019.
 *
 * **JIT (`aot: false`).** Components keep their `@Component` decorators; the
 * bundled `@angular/compiler` (added to the Background Thread by
 * {@link applyEntry}) compiles templates at runtime. SWC must emit Angular's
 * *legacy* decorators.
 */
function loadNgtools(): {
  AngularWebpackPlugin: new (o: Record<string, unknown>) => unknown;
  AngularWebpackLoaderPath: string;
} {
  try {
    return require('@ngtools/webpack');
  } catch (err) {
    // An optional peer, because `aot: false` doesn't need it, but the default build does.
    const { code, message } = err as { code?: string; message?: string };
    if (code === 'MODULE_NOT_FOUND' && message?.includes("'@ngtools/webpack'")) {
      throw new Error(
        '[ng-lynx] The default AOT build needs @ngtools/webpack, which isn\'t installed.\n'
          + 'Install the version matching your Angular major, for example:\n'
          + '  npm install -D @ngtools/webpack@22\n'
          + 'Or pass `aot: false` to pluginAngularLynx() to compile at runtime instead.',
      );
    }
    throw err;
  }
}

function applyAngularCompiler(
  api: RsbuildApiLike,
  opts: { aot: boolean; tsconfig: string },
): void {
  if (!opts.aot) {
    api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
      mergeRsbuildConfig(config, {
        source: { define: { ngJitMode: 'true' } },
        tools: {
          swc: {
            jsc: {
              parser: { syntax: 'typescript', decorators: true },
              transform: { legacyDecorator: true, decoratorMetadata: true },
              keepClassNames: true,
            },
            ...ES2019_DOWNLEVEL,
          },
        },
      }),
    );
    return;
  }

  // --- AOT ---
  api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
    mergeRsbuildConfig(config, {
      source: { define: { ngJitMode: 'false' } },
      tools: { swc: { ...ES2019_DOWNLEVEL } },
    }),
  );

  const tsconfigPath = path.resolve(process.cwd(), opts.tsconfig);
  const { AngularWebpackPlugin, AngularWebpackLoaderPath } = loadNgtools();

  api.modifyBundlerChain((chain) => {
    // biome-ignore lint/suspicious/noExplicitAny: rspack-chain isn't typed here
    const c = chain as any;
    c.module
      .rule('angular-aot-ts')
      .test(/\.[cm]?ts$/)
      .enforce('pre')
      .use('ngtools')
      .loader(AngularWebpackLoaderPath)
      .end();
    // Compat shim runs before AngularWebpackPlugin (see class doc).
    c.plugin('angular-rspack-compat').use(RspackResolverCompatPlugin, []).end();
    c.plugin('angular-webpack-plugin')
      .use(AngularWebpackPlugin, [
        { tsconfig: tsconfigPath, jitMode: false, directTemplateLoading: true },
      ])
      .end();
  });
}

/**
 * rspack's `compiler.resolverFactory` doesn't expose the
 * `hooks.resolveOptions` HookMap that webpack does. `AngularWebpackPlugin` uses
 * it only to register `TypeScriptPathsPlugin` (tsconfig `paths` resolution),
 * which rspack handles natively via `resolve.tsConfig`. Stub the hook so the
 * plugin's `apply()` doesn't crash. Registered before AngularWebpackPlugin so
 * the stub exists when its `afterResolvers` tap fires.
 */
class RspackResolverCompatPlugin {
  // biome-ignore lint/suspicious/noExplicitAny: webpack/rspack Compiler not typed here
  apply(compiler: any): void {
    const rf = compiler?.resolverFactory;
    if (!rf) return;
    if (!rf.hooks) rf.hooks = {};
    if (!rf.hooks.resolveOptions) {
      rf.hooks.resolveOptions = { for: () => ({ tap: () => undefined }) };
    }
  }
}

/**
 * Split each entry into a Background-Thread bundle and a Main-Thread bundle, then
 * pack both into a `.lynx.bundle` with the Lynx template plugin
 * (`@lynx-js/template-webpack-plugin` + `@lynx-js/runtime-wrapper-webpack-plugin`,
 * both declared dependencies and imported statically at the top of this file).
 */
function applyEntry(
  api: RsbuildApiLike,
  opts: {
    enableCSSSelector: boolean;
    enableCSSInheritance: boolean;
    enableCSSInvalidation: boolean;
    templateOptions: Record<string, unknown>;
    targetSdkVersion: string;
    debugInfoOutside: boolean;
    mainThreadModules: string[];
    aot: boolean;
    asyncChunks: boolean;
    firstScreenModule?: string;
    dynamicComponent: boolean;
    sharedRuntimeHostModule?: string;
  },
): void {
  api.modifyBundlerChain((chain, { environment, isProd, isDev }) => {
    const isLynx = environment.name === 'lynx' || environment.name.startsWith('lynx-');
    const isWeb = environment.name === 'web' || environment.name.startsWith('web-');
    if (!isLynx && !isWeb) return;

    // Dev-only save-to-swap client, for **both** targets — see the
    // `environments.web` comment above and `createDevReloadModule`'s doc.
    // `api.context.devServer` is only populated once the dev server is
    // actually listening (absent for `build`), which is exactly the condition
    // we need alongside `isDev`.
    //
    // `lynx` (device/simulator) needs the same client, not a different one:
    // rspeedy points that environment's dev client at the *same*
    // `/rsbuild-hmr` endpoint over a plain WebSocket (providing the socket
    // itself via a `ProvidePlugin` → `@lynx-js/websocket`), and already
    // enables `HotModuleReplacementPlugin` + an absolute dev `publicPath`
    // there. What it does NOT do is import any client — rspeedy leaves that
    // to the framework plugin (ReactLynx and vue-lynx both prepend
    // `@lynx-js/webpack-dev-transport/client` to their Background entry). So
    // without this, the `lynx` target has no dev loop at all: no hot swap,
    // no reload, not even a notice. See runtime/src/dev-reload-client.ts.
    const devServer = api.context.devServer;
    const devReloadModule =
      (isWeb || isLynx) && isDev && devServer
        ? createDevReloadModule(devServer, environment.webSocketToken)
        : undefined;

    // The chain is rspack-chain; typed loosely here. The real wiring mirrors
    // vue-lynx/plugin/src/entry.ts almost exactly — only the loaders differ
    // (Angular's compiler instead of vue-loader).
    type EntryChain = { add(v: unknown): EntryChain; prepend(v: unknown): EntryChain; end(): void };
    const c = chain as {
      entryPoints: { entries(): Record<string, { values(): Iterable<unknown> }>; clear(): void };
      entry(name: string): EntryChain;
      plugin(name: string): { use(ctor: unknown, args: unknown[]): { end(): void } };
    };

    const entries = c.entryPoints.entries() ?? {};
    c.entryPoints.clear();

    // Output filenames of the main-thread bundles — marked as Lepus code below.
    const mainThreadFilenames: string[] = [];

    // One `rspeedy build` compiles the `lynx` and `web` environments **in
    // parallel into the same `dist/`**, so the two must not name their
    // intermediate entry chunks identically — they'd race on the same path and
    // whichever finished last (or a torn interleave of both) would be what
    // lands on disk. The shipped bundles were never affected: each
    // environment's LynxTemplatePlugin packs the assets it holds in memory,
    // not what's on disk. But anything that *reads* the intermediates does
    // see it — `verify:dynamic-component-build` started failing
    // intermittently with `SyntaxError: Unexpected token 'if'` from a torn
    // `background.js` after the Lynx 4.1 toolchain bump shifted the two
    // builds' timings. Same `.web` infix fix, and same reason, as the async
    // chunks and hot-update files (see docs/15-routing.md, docs/31-hot-swap.md).
    const envInfix = isWeb ? '.web' : '';

    const esPolyfills = path.resolve(angularLynxRoot, 'runtime/dist/es-polyfills.js');
    const entryBackground = path.resolve(angularLynxRoot, 'runtime/dist/entry-background.js');
    const entryMain = path.resolve(angularLynxRoot, 'main-thread/dist/entry-main.js');
    // ng-lynx's worklet runtime (`runWorklet`, the worklet registry, timers on
    // `globalThis`): `[lynxMainThread]` worklets and gesture callbacks never run
    // without it. See docs/42-worklet-runtime.md.
    //
    // Only bundled when `mainThreadModules` is non-empty — that's the only
    // documented use for the option (worklet registration modules), so an
    // empty list is a reliable signal the app doesn't use worklets at all, and
    // an app that never touches `[lynxMainThread]` doesn't pay for it: about
    // 10 kB of Lynx bundle, measured on examples/ng-forms. `<lynx-slider>`
    // drags on the Main Thread when it's there (`__WORKLET_RUNTIME__`).
    const workletRuntime = opts.mainThreadModules.length > 0
      ? path.resolve(angularLynxRoot, 'main-thread/dist/worklet-runtime/init.js')
      : undefined;

    for (const [entryName, entryPoint] of Object.entries(entries)) {
      const imports: string[] = [];
      for (const v of entryPoint.values()) {
        if (typeof v === 'string') imports.push(v);
        else if (v && typeof v === 'object' && 'import' in v) {
          const imp = (v as { import?: string | string[] }).import;
          if (Array.isArray(imp)) imports.push(...imp);
          else if (imp) imports.push(imp);
        }
      }

      const mainThreadEntry = `${entryName}__main-thread`;
      const mainThreadFilename = `.rspeedy/${entryName}/main-thread${envInfix}.js`;
      mainThreadFilenames.push(mainThreadFilename);

      // Main-Thread bundle: the PAPI executor first — its top-level code sets
      // `globalThis.SystemInfo` from `lynx.SystemInfo` (guarded; works whether
      // or not `lynx` is ready yet) and assigns `renderPage`/`processData`, so
      // nothing that loads after it can stop those being set. Then the worklet
      // runtime, then the worklet modules (they call registerWorklet, which
      // needs the runtime already in place). With `@lynx-js/react`'s runtime
      // the order mattered more: its top-level code read the bare `SystemInfo`
      // global, and loading it first aborted the script (docs/11-worklets.md).
      // A dynamic-component bundle gets a no-op Main-Thread part instead:
      // its host already owns the executor and the page, and re-registering
      // `renderPage`/`ngPatchUpdate` from a loaded bundle would clobber the
      // live ones. See createDynamicComponentMainThreadStub.
      const mtImports = opts.dynamicComponent
        ? [createDynamicComponentMainThreadStub()]
        : workletRuntime
          ? [entryMain, workletRuntime, ...opts.mainThreadModules]
          : [entryMain, ...opts.mainThreadModules];
      // The first-screen module must evaluate after entryMain (it imports
      // setFirstScreenOps from it); renderPage runs later, at engine time.
      if (opts.firstScreenModule && !opts.dynamicComponent) mtImports.push(opts.firstScreenModule);
      c.entry(mainThreadEntry)
        .add({
          layer: LAYERS.MAIN_THREAD,
          import: mtImports,
          filename: mainThreadFilename,
        })
        .end();

      // Background bundle: event bootstrap (+ PrimJS polyfills) + Angular
      // runtime + app. In JIT mode `@angular/compiler` is also prepended so the
      // runtime template compiler is registered before any component is
      // instantiated; in AOT mode templates are precompiled by ngtsc, so the
      // compiler is not shipped.
      const bgEntry = c
        .entry(entryName)
        .add({
          layer: LAYERS.BACKGROUND,
          import: imports,
          filename: `.rspeedy/${entryName}/background${envInfix}${isProd ? '.[contenthash:8]' : ''}.js`,
          // A dynamic-component bundle's entry exports ARE the bundle's
          // exports — what the engine hands back from
          // `getDynamicComponentExports(schema)` and therefore what
          // `loadDynamicComponent()` resolves. Without a library type the
          // entry's exports are compiled away as unused, and the load
          // resolves an empty object.
          ...(opts.dynamicComponent
            ? { library: { type: 'commonjs' as const, export: undefined } }
            : {}),
        });
      // A dynamic component runs inside its host's already-booted runtime, so
      // it must NOT re-run the Background bootstrap: `entry-background.ts`
      // installs the event pipeline, host-data channels, polyfills and the
      // cross-thread bridges onto `tt`/`lynx`, all of which the host already
      // owns — re-installing them from a loaded bundle would replace live
      // handlers mid-session. Its own `ng-lynx` imports resolve to the
      // host's instance through the shared-runtime externals instead.
      if (!opts.dynamicComponent) {
        bgEntry.prepend({ layer: LAYERS.BACKGROUND, import: entryBackground });
      }
      // AOT is the default and the only supported mode for dynamic
      // components (`@angular/compiler` is deliberately not shared, so a JIT
      // dynamic bundle would have to bundle its own compiler and compile
      // against the host's core — the cross-instance split this whole
      // mechanism exists to avoid).
      if (!opts.aot && !opts.dynamicComponent) {
        bgEntry.prepend({ layer: LAYERS.BACKGROUND, import: '@angular/compiler' });
      }
      // Publish the host's framework instances before anything can ask for
      // them (a dynamic component can be loaded during the first render).
      if (opts.sharedRuntimeHostModule) {
        bgEntry.prepend({ layer: LAYERS.BACKGROUND, import: opts.sharedRuntimeHostModule });
      }
      // Connect before anything else runs, so a rebuild during Angular's own
      // bootstrap is still caught.
      if (devReloadModule) {
        bgEntry.prepend({ layer: LAYERS.BACKGROUND, import: devReloadModule });
      }
      // Ahead of all of the above, each of which can pull in `@angular/core`,
      // which needs `Object.hasOwn` while it evaluates (Angular 22).
      if (!opts.dynamicComponent) {
        bgEntry.prepend({ layer: LAYERS.BACKGROUND, import: esPolyfills });
      }
      bgEntry.end();

      // Pack both bundles into a single Lynx template.
      if ((isLynx || isWeb) && LynxTemplatePlugin) {
        c.plugin(`lynx:angular-template-${entryName}`).use(LynxTemplatePlugin, [
          {
            ...((LynxTemplatePlugin as { defaultOptions?: object }).defaultOptions ?? {}),
            dsl: 'react_nodiff',
            chunks: [mainThreadEntry, entryName],
            filename: `${entryName}.${environment.name}.bundle`,
            intermediate: `.rspeedy/${entryName}`,
            debugInfoOutside: opts.debugInfoOutside,
            enableCSSSelector: opts.enableCSSSelector,
            enableCSSInheritance: opts.enableCSSInheritance,
            enableCSSInvalidation: opts.enableCSSInvalidation,
            ...opts.templateOptions,
            targetSdkVersion: opts.targetSdkVersion,
            // Package as a Lynx **lazy bundle** rather than a card: this
            // flips the template's `appType` to `'DynamicComponent'`, which
            // is what `LynxEncodePlugin` keys its lazy-bundle encoding off
            // (confirmed in @lynx-js/template-webpack-plugin's own source)
            // and what makes the artifact loadable via `QueryComponent`
            // instead of bootable as an app. Marked `@alpha` upstream —
            // it's the same switch ReactLynx's own
            // `experimental_isLazyBundle` sets.
            ...(opts.dynamicComponent ? { experimental_isLazyBundle: true } : {}),
          },
        ]).end();
      }
    }

    // Keep `asyncChunks: true` on the plain async-chunk path (see
    // AngularLynxAsyncChunkPlugin's doc comment for why this is now needed).
    if ((isLynx || isWeb) && opts.asyncChunks) {
      c.plugin('lynx:angular-async-chunks').use(AngularLynxAsyncChunkPlugin, []).end();
    }

    // Mark the main-thread assets as Lepus code so LynxTemplatePlugin routes
    // them to the MT runtime (and force their startup execution). Without this
    // the MT bundle is packaged but never runs — renderPage/ngPatchUpdate never
    // get defined, so nothing renders.
    if ((isLynx || isWeb) && mainThreadFilenames.length > 0) {
      c.plugin('lynx:angular-mark-main-thread')
        .use(AngularMarkMainThreadPlugin, [mainThreadFilenames])
        .end();
    }

    if (isLynx && RuntimeWrapperWebpackPlugin) {
      // Wrap background.js (not main-thread.js) with the Lynx runtime wrapper.
      c.plugin('lynx:angular-runtime-wrapper')
        .use(RuntimeWrapperWebpackPlugin, [
          { test: /^(?!.*main-thread(?:\.[A-Fa-f0-9]*)?\.js$).*\.js$/ },
        ])
        .end();
      if (LynxEncodePlugin) c.plugin('lynx:angular-encode').use(LynxEncodePlugin, [{}]).end();
    }
    if (isWeb) {
      c.plugin('lynx:angular-web-encode').use(WebEncodePlugin, []).end();
    }
  });
}

// ---------------------------------------------------------------------------
// AngularLynxAsyncChunkPlugin
//
// Keeps `asyncChunks: true` on the plain async-chunk path, which is the only
// one ng-lynx's lazy routes can load.
//
// Background. Up to `@lynx-js/template-webpack-plugin@0.12`, an **unnamed**
// dynamic `import()` produced an ordinary async JS chunk: the chunk group had
// no name, `#getAsyncChunkGroups` grouped it under `''`, and
// `#generateAsyncTemplate` skipped it (`if (!filename) return`). The chunk was
// emitted as a normal asset at `static/js/async/<id>.<hash>.js` and loaded at
// navigation time through `lynx.requireModuleAsync` — see docs/15-routing.md.
//
// Since 0.13 (the lazy-bundle dedup change, lynx-stack#2961) an unnamed group
// is instead named from its resolved modules (`resourcesToLazyBundleName`), so
// **every** dynamic import became a Lynx *lazy bundle*:
//
//   1. the JS chunk is renamed into the per-bundle intermediate directory
//      (`.rspeedy/lazy-bundle/<name>/background.js`), and
//   2. `LynxEncodePlugin` force-inlines every manifest chunk of a lazy bundle
//      (`appType === 'DynamicComponent'` bypasses `inlineScripts`) and then
//      deletes the inlined assets from the compilation.
//
// The net effect, measured on `examples/router` before and after the bump:
// production `dist/` gains `lazy-bundle/<name>.<hash>.bundle` and **loses**
// `static/js/async/<chunk>.js` entirely, while the app-service still asks for
// that path — so a lazy route 404s. Dev builds hide it: the delete is gated on
// `!isDev`, so only production is affected.
//
// The fix uses the template plugin's own public `asyncChunkName` waterfall.
// Returning `''` from it reproduces the pre-0.13 state at all three places
// that consult it: the chunk group groups under `''` (so no async template is
// generated), `#getAsyncChunkLayout` skips `name === ''` (so the JS chunk keeps
// rsbuild's default `static/js/async/[name].js` template and stays a real dist
// asset), and `LynxAsyncChunksRuntimeModule` maps `''` to `undefined` (so the
// runtime never points at a lazy bundle).
//
// The catch: that hook only runs for chunk groups that HAVE a name — an
// unnamed group goes straight to `resourcesToLazyBundleName`. So each lazy
// `import()` must carry a `webpackChunkName` magic comment, and this plugin
// fails the build with an actionable error when one doesn't, rather than
// letting a silently-broken production bundle ship. (This inverts the advice
// docs/15-routing.md used to give — naming a chunk used to be what *opted in*
// to lazy-bundle routing; now it's what opts out.)
// ---------------------------------------------------------------------------

const PLUGIN_ASYNC_CHUNKS = 'lynx:angular-async-chunks';

/** The failure branch of the runtime's `lynx.requireModuleAsync` callback. */
const CHUNK_LOAD_FAILURE = /if \(err\) \{(\s*)reject\(err\);/;

type RuntimeModuleHook = {
  tap(name: string, cb: (module: { name?: string; source?: { source: Buffer | string } }) => void): void;
};

interface WpChunkGroup {
  name?: string | null;
  chunks: { id?: string | number | null }[];
  isInitial(): boolean;
  origins?: { module?: { identifier?(): string } | null; request?: string }[];
}

class AngularLynxAsyncChunkPlugin {
  apply(compiler: {
    hooks: { thisCompilation: { tap(name: string, cb: (c: unknown) => void): void } };
    webpack: {
      WebpackError: new (message: string) => Error;
      Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: number };
    };
  }): void {
    compiler.hooks.thisCompilation.tap(PLUGIN_ASYNC_CHUNKS, (compilation) => {
      const hooks = (
        LynxTemplatePlugin as unknown as {
          getLynxTemplatePluginHooks(c: unknown): {
            asyncChunkName: { tap(name: string, cb: (n: string) => string): void };
          };
        }
      ).getLynxTemplatePluginHooks(compilation);
      // Opt every *named* async chunk group out of lazy-bundle treatment.
      hooks.asyncChunkName.tap(PLUGIN_ASYNC_CHUNKS, () => '');

      // Lynx's chunk-loading runtime keeps a chunk that failed to load as "loading"
      // for good: its `installedChunks` entry holds the rejected promise, so every
      // later `import()` of it fails at once, without a request, until the app
      // restarts. A lazy route that met a dropped network stayed broken after the
      // network came back. Clear the entry before rejecting, so the next `import()`
      // asks again. Found on Explorer 4.2 with `@lynx-js/chunk-loading-webpack-plugin`
      // 0.4.3; the patch does nothing if the runtime's text changes.
      (compilation as { hooks: { runtimeModule?: RuntimeModuleHook } }).hooks.runtimeModule?.tap(
        PLUGIN_ASYNC_CHUNKS,
        (module) => {
          const source = module.source?.source;
          if (!source || module.name?.toLowerCase() !== 'lynx chunk loading') return;
          const text = source.toString();
          const patched = text.replace(CHUNK_LOAD_FAILURE, 'if (err) {$1installedChunks[chunkId] = undefined;$1reject(err);');
          if (patched !== text) module.source!.source = Buffer.from(patched);
        },
      );

      const c = compilation as {
        chunkGroups: WpChunkGroup[];
        errors: Error[];
        hooks: {
          processAssets: { tap(o: { name: string; stage: number }, cb: () => void): void };
        };
      };
      // Report the groups the hook above can't reach. Checked from
      // `processAssets` (rspack has no `afterOptimizeChunkIds`), which is late
      // enough that empty async groups — a module also imported statically —
      // have already been dropped by RemoveEmptyChunksPlugin, matching the
      // filter `#getAsyncChunkGroups` itself applies.
      c.hooks.processAssets.tap({
        name: PLUGIN_ASYNC_CHUNKS,
        stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
      }, () => {
        for (const group of c.chunkGroups) {
          if (group.isInitial() || group.chunks.length === 0) continue;
          if (group.name !== null && group.name !== undefined) continue;
          const from =
            group.origins
              ?.map((o) => o.request)
              .filter((r): r is string => typeof r === 'string' && r.length > 0)
              .join(', ') || 'an unnamed dynamic import()';
          c.errors.push(
            new compiler.webpack.WebpackError(
              `[ng-lynx] ${from}: a dynamic import() under \`asyncChunks: true\` needs a `
                + 'webpackChunkName magic comment:\n\n'
                + "    import(/* webpackChunkName: \"my-route\" */ './my.component.js')\n\n"
                + 'Without a name, @lynx-js/template-webpack-plugin (>= 0.13) packs the chunk '
                + 'into a Lynx lazy bundle and deletes the JS chunk from dist/ in production '
                + 'builds, so the chunk this app asks for through lynx.requireModuleAsync is '
                + 'never emitted and the route fails to load at navigation time. See '
                + 'docs/15-routing.md.',
            ),
          );
        }
      });
    });
  }
}

// ---------------------------------------------------------------------------
// AngularMarkMainThreadPlugin
//
// 1. Marks each main-thread asset with `lynx:main-thread: true` so
//    LynxTemplatePlugin routes it to the Lepus (Main Thread) runtime.
// 2. Forces startup-code generation for the MT entry chunk so its module
//    factory actually executes (rspeedy sets chunkLoading: 'lynx', which
//    otherwise skips the startup call for entries without async deps).
//
// Ported from vue-lynx's VueMarkMainThreadPlugin. Webpack/Rspack types kept
// minimal so the plugin compiles without importing @rspack/core.
// ---------------------------------------------------------------------------

const PLUGIN_MARK_MT = 'lynx:angular-mark-main-thread';

interface WpChunk {
  getEntryOptions(): { layer?: string } | undefined;
}
interface WpCompilation {
  hooks: {
    processAssets: { tap(o: { name: string; stage: number }, cb: () => void): void };
    additionalTreeRuntimeRequirements: {
      tap(name: string, cb: (chunk: WpChunk, set: Set<string>) => void): void;
    };
  };
  getAsset(f: string): { source: unknown; info: Record<string, unknown> } | undefined;
  updateAsset(f: string, source: unknown, info: Record<string, unknown>): void;
}
interface WpCompiler {
  webpack: {
    Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: number };
    RuntimeGlobals: { startup: string; require: string };
  };
  hooks: { thisCompilation: { tap(name: string, cb: (c: WpCompilation) => void): void } };
}

class AngularMarkMainThreadPlugin {
  constructor(private readonly mainThreadFilenames: string[]) {}

  apply(compiler: WpCompiler): void {
    const { RuntimeGlobals } = compiler.webpack;
    compiler.hooks.thisCompilation.tap(PLUGIN_MARK_MT, (compilation) => {
      compilation.hooks.additionalTreeRuntimeRequirements.tap(
        PLUGIN_MARK_MT,
        (chunk, set) => {
          if (chunk.getEntryOptions()?.layer === LAYERS.MAIN_THREAD) {
            set.add(RuntimeGlobals.startup);
            set.add(RuntimeGlobals.require);
          }
        },
      );
      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_MARK_MT,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          for (const filename of this.mainThreadFilenames) {
            const asset = compilation.getAsset(filename);
            if (asset) {
              compilation.updateAsset(filename, asset.source, {
                ...asset.info,
                'lynx:main-thread': true,
              });
            }
          }
        },
      );
    });
  }
}
