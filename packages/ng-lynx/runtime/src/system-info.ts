/**
 * Typed access to Lynx's `SystemInfo` — a plain global object exposed by the
 * engine on **both** threads (confirmed against `@lynx-js/web-core`: its
 * Main-Thread global-API factory sets `SystemInfo: lynxViewInstance.systemInfo`
 * and its Background-Thread worker bootstrap does
 * `globalThis.SystemInfo = message.systemInfo` before the app's own code
 * runs) — so a bare `globalThis.SystemInfo` read is correct on the
 * Background Thread, no manual forwarding needed on ng-lynx's part
 * (unlike `SystemInfo` in `main-thread/src/entry-main.ts`, which forwards it
 * only because the worklet-runtime module's own top-level code reads it
 * before anything else does).
 *
 * Wrapped behind an `InjectionToken` (same shape as `injectNativeModule` /
 * `LYNX_NATIVE_MODULES`) so app code gets a typed value and tests can
 * substitute a fake device profile.
 */
import { inject, InjectionToken } from '@angular/core';

/** Shape of the global `SystemInfo` object. @public */
export interface LynxSystemInfo {
  /** Lynx Engine version, `"major.minor"` (e.g. `"3.2"`). */
  engineVersion: string;
  /** Deprecated alias for {@link engineVersion}. */
  lynxSdkVersion: string;
  /** Host OS version string. */
  osVersion: string;
  /** Display height in physical pixels. */
  pixelHeight: number;
  /** Display width in physical pixels. */
  pixelWidth: number;
  /** Device pixel ratio (natural scale factor). */
  pixelRatio: number;
  /** Host platform. `'web'` is the web preview (`@lynx-js/web-core`). */
  platform: 'Android' | 'iOS' | 'macOS' | 'windows' | 'headless' | 'web';
  /** Active JS engine — Background Thread only, absent on the Main Thread. */
  runtimeType?: 'v8' | 'jsc' | 'quickjs';
}

// `SystemInfo` is injected by the Lynx bundle wrapper as a bare global (like
// `lynx` / `NativeModules`), not a `globalThis` property in the type sense —
// declared module-scoped, matching the other runtime modules.
// eslint-disable-next-line no-var
declare var SystemInfo: LynxSystemInfo | undefined;

function readGlobalSystemInfo(): LynxSystemInfo {
  return typeof SystemInfo !== 'undefined' && SystemInfo
    ? SystemInfo
    : ({} as LynxSystemInfo);
}

/**
 * Running in the web preview? For the few attributes web-core reads
 * differently from the native engines. Read at call time, outside DI, so a
 * directive's input setter can use it.
 *
 * @internal
 */
export function isWebPlatform(): boolean {
  return readGlobalSystemInfo().platform === 'web';
}

/**
 * The `SystemInfo` value. Defaults to the engine's global `SystemInfo`;
 * override with a fake in tests via a plain `{ provide: LYNX_SYSTEM_INFO,
 * useValue: {...} }` provider.
 *
 * @public
 */
export const LYNX_SYSTEM_INFO = new InjectionToken<LynxSystemInfo>('LYNX_SYSTEM_INFO', {
  providedIn: 'root',
  factory: readGlobalSystemInfo,
});

/**
 * Inject the host's `SystemInfo` (platform, screen metrics, pixel ratio, …).
 * Must be called in an injection context (constructor, field initializer,
 * `inject`-based factory). `SystemInfo` is static for the process lifetime —
 * no signal needed.
 *
 * @example
 * ```ts
 * export class ScaleAwareComponent {
 *   private readonly system = injectSystemInfo();
 *   readonly isTablet = this.system.pixelWidth / this.system.pixelRatio > 600;
 * }
 * ```
 * @public
 */
export function injectSystemInfo(): LynxSystemInfo {
  return inject(LYNX_SYSTEM_INFO);
}
