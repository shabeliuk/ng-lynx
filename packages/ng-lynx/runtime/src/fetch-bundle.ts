/**
 * `fetchBundle` — the Promise form of `lynx.fetchBundle`, which downloads a
 * Lynx bundle into the engine's cache so its named sections can be read with
 * `lynx.loadScript`. It is what ReactLynx's own lazy bundles use from engine
 * 3.9 (`@lynx-js/react`'s `core/lynx/lazy-bundle.ts`), and what
 * `@lynx-js/externals-loading-webpack-plugin` uses for shared libraries.
 *
 * What the engines do, read from `@lynx-js/types`, from web-core's
 * implementation and from ReactLynx's consumer:
 *
 * - `lynx.fetchBundle(url, options)` returns a handler, not a Promise:
 *   `handler.then(callback)` takes one callback and returns nothing, and
 *   `handler.wait(seconds)` blocks until the bundle is there and returns the
 *   result. The result is `{ url, code, error_msg }`, and `code` is `0` on
 *   success. `url` is the bundle's name, what `loadScript` calls `bundleName`.
 * - On the web preview, `fetchBundle` returns a real Promise of
 *   `{ url, code, errorMsg }` (`code` is `-1` on failure), and `wait` doesn't
 *   exist.
 * - `lynx.loadScript(section, { bundleName })` evaluates one section of a
 *   fetched bundle and returns its `module.exports`. It's synchronous, and it
 *   caches by section.
 *
 * Neither engine rejects: a failure is a result with a `code`. This module
 * turns it into a rejection, with the code and the engine's words on the error.
 */

import { ADOPT_STYLE_SHEET_METHOD } from 'ng-lynx/internal/ops';

import { flushOps } from './flush.js';

/** What `lynx.fetchBundle`'s result looks like on a device (`error_msg`) and on the web (`errorMsg`). */
interface EngineBundleResult {
  url?: string;
  code?: number;
  error_msg?: string;
  errorMsg?: string;
}

interface EngineBundleHandler {
  then: (callback: (result: EngineBundleResult) => void) => unknown;
  wait?: (timeoutSeconds: number) => EngineBundleResult;
}

// `lynx` is a parameter of the bundle wrapper, not a property of `globalThis`
// (see flush.ts), so it's declared here the way dynamic-component.ts does.
// eslint-disable-next-line no-var
declare var lynx:
  | {
    fetchBundle?: (url: string, options?: object) => EngineBundleHandler;
    loadScript?: <T = unknown>(section: string, options?: { bundleName?: string }) => T;
    getNativeLynx?: () =>
      | {
        fetchBundle?: (url: string, options?: object) => EngineBundleHandler;
      }
      | undefined;
    getNativeApp?: () =>
      | { callLepusMethod?(method: string, params: unknown, callback: () => void): void }
      | null
      | undefined;
  }
  | undefined;

/** How `fetchBundle` waits for the engine. */
export interface FetchBundleOptions {
  /**
   * Block this thread until the bundle is there, instead of waiting for it.
   * Only on a device: the web preview has no synchronous form, and rejects.
   *
   * @defaultValue false
   */
  sync?: boolean;
  /**
   * Seconds to wait before giving up, with `0` for never. A synchronous fetch
   * hands this to the engine, which answers with a non-zero code on a timeout.
   * An asynchronous one has to watch the clock itself: on the Android engine
   * (Explorer 4.2), a bundle the server answers with a 404 never calls back, so
   * without a limit the Promise never settles. iOS answers with an error.
   *
   * @defaultValue 5 when `sync` is set, 30 otherwise
   */
  timeout?: number;
}

const DEFAULT_SYNC_TIMEOUT = 5;
const DEFAULT_ASYNC_TIMEOUT = 30;

/** A bundle the engine has downloaded. */
export interface FetchedBundle {
  /** The bundle's name in the engine, which `lynx.loadScript` calls `bundleName`. */
  readonly name: string;
  /**
   * Evaluate one section of the bundle and return its exports. Synchronous.
   * Throws if the bundle has no such section.
   */
  loadScript<T = unknown>(section: string): T;
  /**
   * Apply the bundle's own stylesheet, its `CSS` custom section, to the page. The engine
   * doesn't do it when a bundle is fetched (measured on Explorer 4.2): a component that
   * imports CSS is unstyled until this runs. `loadDynamicComponent` calls it for you.
   *
   * It goes to the Main Thread on the same channel as the render ops, so what is created
   * after it is styled by it. Once per bundle; a bundle with no CSS has nothing to apply.
   */
  adoptStyleSheet(): void;
}

/** `lynx.fetchBundle` failed: the engine answered with a non-zero `code`, or isn't there. */
export class LynxBundleError extends Error {
  /** The engine's own result code, `-1` when it never answered. */
  readonly code: number;
  /** The bundle that failed. */
  readonly bundleUrl: string;

  constructor(url: string, code: number, detail: string) {
    super(`[ng-lynx] fetchBundle(${url}) failed${code === -1 ? '' : ` with code ${code}`}${detail ? `: ${detail}` : '.'}`);
    this.name = 'LynxBundleError';
    this.code = code;
    this.bundleUrl = url;
  }
}

/** Whether this engine has `lynx.fetchBundle` (a device from engine 3.4.2, and the web preview). */
export function hasFetchBundle(): boolean {
  return typeof (lynx?.fetchBundle ?? lynx?.getNativeLynx?.()?.fetchBundle) === 'function';
}

const fetched = new Map<string, FetchedBundle>();
const pending = new Map<string, Promise<FetchedBundle>>();

function describeFailure(url: string, result: EngineBundleResult | undefined): LynxBundleError {
  const code = typeof result?.code === 'number' ? result.code : -1;
  const message = result?.error_msg ?? result?.errorMsg ?? '';
  return new LynxBundleError(url, code, message);
}

function toBundle(source: string, result: EngineBundleResult | undefined): FetchedBundle {
  if (result?.code !== 0) throw describeFailure(source, result);
  const name = result.url ?? source;
  return {
    name,
    loadScript: <T>(section: string): T => loadBundleScript<T>(section, name),
    adoptStyleSheet: () => ɵadoptBundleStyleSheet(name),
  };
}

/**
 * Download the bundle at `url` and resolve once the engine has it. A bundle is
 * fetched once: a second call for the same URL returns the same result, and a
 * failure isn't remembered, so calling again retries.
 *
 * Read what's in it with `bundle.loadScript(section)`.
 *
 * @experimental
 */
export function fetchBundle(url: string, options: FetchBundleOptions = {}): Promise<FetchedBundle> {
  const known = fetched.get(url);
  if (known) return Promise.resolve(known);
  const inFlight = pending.get(url);
  if (inFlight) return inFlight;

  const fetchFn = lynx?.fetchBundle ?? lynx?.getNativeLynx?.()?.fetchBundle;
  if (typeof fetchFn !== 'function') {
    return Promise.reject(
      new LynxBundleError(url, -1, 'lynx.fetchBundle is not available on this engine (it needs engine 3.4.2 or higher).'),
    );
  }

  const settle = (result: EngineBundleResult | undefined): FetchedBundle => {
    const bundle = toBundle(url, result);
    fetched.set(url, bundle);
    return bundle;
  };

  const promise = new Promise<FetchedBundle>((resolve, reject) => {
    let handler: EngineBundleHandler;
    try {
      handler = fetchFn.call(lynx, url, {});
    } catch (error) {
      reject(new LynxBundleError(url, -1, error instanceof Error ? error.message : String(error)));
      return;
    }
    if (options.sync) {
      if (typeof handler.wait !== 'function') {
        reject(new LynxBundleError(url, -1, 'a synchronous fetch is not supported on the web preview.'));
        return;
      }
      try {
        resolve(settle(handler.wait(options.timeout ?? DEFAULT_SYNC_TIMEOUT)));
      } catch (error) {
        reject(error);
      }
      return;
    }
    const seconds = options.timeout ?? DEFAULT_ASYNC_TIMEOUT;
    const timer = seconds > 0
      ? setTimeout(() => {
        reject(new LynxBundleError(url, -1, `the engine did not answer within ${seconds} seconds.`));
      }, seconds * 1000)
      : undefined;
    handler.then((result) => {
      if (timer !== undefined) clearTimeout(timer);
      try {
        resolve(settle(result));
      } catch (error) {
        reject(error);
      }
    });
  }).finally(() => {
    pending.delete(url);
  });
  pending.set(url, promise);
  return promise;
}

/**
 * Evaluate one section of a bundle `fetchBundle` has downloaded, and return its
 * exports. `bundleName` is `bundle.name`. Synchronous; throws when the bundle
 * isn't there or has no such section.
 *
 * @experimental
 */
export function loadBundleScript<T = unknown>(section: string, bundleName: string): T {
  const load = lynx?.loadScript;
  if (typeof load !== 'function') {
    throw new Error('[ng-lynx] lynx.loadScript is not available on this engine (it needs engine 3.7 or higher).');
  }
  return load.call(lynx, section, { bundleName }) as T;
}

const adopted = new Set<string>();

/**
 * Apply a bundle's `CSS` section to the page, once per bundle. `fetchBundle`'s bundles do it
 * through `bundle.adoptStyleSheet()`, and `loadDynamicComponent` does it for the default
 * `QueryComponent` packaging too, under the name the engine gave the bundle.
 *
 * @internal
 */
export function ɵadoptBundleStyleSheet(bundleName: string): void {
  if (adopted.has(bundleName)) return;
  const app = lynx?.getNativeApp?.();
  if (!app?.callLepusMethod) return;
  adopted.add(bundleName);
  // Queued behind the ops already sent, and ahead of the ones that follow.
  flushOps();
  app.callLepusMethod(ADOPT_STYLE_SHEET_METHOD, { bundleName }, () => {});
}

/** Forget what was fetched, so the next call asks the engine again. For tests. @internal */
export function ɵresetFetchedBundles(): void {
  fetched.clear();
  pending.clear();
  adopted.clear();
}
