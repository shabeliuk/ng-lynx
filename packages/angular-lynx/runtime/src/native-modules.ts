/**
 * Typed, mockable access to host-registered **native modules**.
 *
 * A Lynx host app registers native modules (toast, storage, analytics, a
 * generic `bridge`, …) exposed to the Background Thread as a bare global
 * `NativeModules` (confirmed against `@lynx-js/types@3.7.0`'s
 * `background-thread/native-modules` and `@lynx-js/web-core`'s
 * `nativeModuleProxy`). Reaching for that global directly from app code is
 * untyped and unmockable.
 *
 * This module wraps it behind a DI token so components/services get typed
 * access and tests substitute fakes with one provider.
 *
 * ```ts
 * interface ToastModule { show(message: string): void }
 *
 * export class NotifyService {
 *   private readonly toast = injectNativeModule<ToastModule>('ToastModule');
 *   notify(msg: string) { this.toast?.show(msg); }
 * }
 *
 * // in a test:
 * bootstrapLynxApplication(App, {
 *   providers: [provideLynxNativeModules({ ToastModule: { show: vi.fn() } })],
 * });
 * ```
 */
import {
  type EnvironmentProviders,
  inject,
  InjectionToken,
  makeEnvironmentProviders,
} from '@angular/core';

/** Shape of the `NativeModules` registry: arbitrary modules + a generic bridge. */
export interface LynxNativeModules {
  [name: string]: unknown;
  /** Generic host bridge (`call(name, params, cb)` / `on(name, cb)`), if present. */
  bridge?: LynxNativeBridge;
}

/** The generic Lynx native bridge. @public */
export interface LynxNativeBridge {
  call(name: string, params: Record<string, unknown>, callback: (...args: unknown[]) => void): void;
  on(name: string, callback: (...args: unknown[]) => void): void;
}

declare const __DEV__: boolean;

// `NativeModules` is injected by the Lynx bundle wrapper as a bare identifier
// (like `lynx` / `lynxCoreInject`), not a `globalThis` property.
// eslint-disable-next-line no-var
declare var NativeModules: LynxNativeModules | undefined;

function readGlobalNativeModules(): LynxNativeModules {
  return typeof NativeModules !== 'undefined' && NativeModules ? NativeModules : {};
}

/**
 * The native-module registry. Defaults to the host's global `NativeModules`;
 * override with {@link provideLynxNativeModules} (tests, custom hosts).
 *
 * @public
 */
export const LYNX_NATIVE_MODULES = new InjectionToken<LynxNativeModules>(
  'LYNX_NATIVE_MODULES',
  { providedIn: 'root', factory: readGlobalNativeModules },
);

/**
 * Inject a host-registered native module by name, typed as `T`. Must be called
 * in an injection context (constructor, field initializer, `inject`-based
 * factory). Returns `undefined` if the host didn't register it (with a
 * dev-mode warning).
 *
 * @public
 */
export function injectNativeModule<T = unknown>(name: string): T | undefined {
  const modules = inject(LYNX_NATIVE_MODULES);
  const mod = modules?.[name];
  if (mod === undefined && __DEV__) {
    console.warn(
      `[angular-lynx] injectNativeModule('${name}'): no such native module is `
        + 'registered by the host (or provide a fake via provideLynxNativeModules).',
    );
  }
  return mod as T | undefined;
}

/**
 * Inject the generic Lynx native `bridge` (`call` / `on`), if the host exposes
 * one. Must be called in an injection context.
 *
 * @public
 */
export function injectNativeBridge(): LynxNativeBridge | undefined {
  return inject(LYNX_NATIVE_MODULES)?.bridge;
}

/**
 * Override the native-module registry — supply fakes in tests, or a curated
 * subset. Add to `bootstrapLynxApplication`'s providers.
 *
 * @public
 */
export function provideLynxNativeModules(modules: LynxNativeModules): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: LYNX_NATIVE_MODULES, useValue: modules }]);
}
