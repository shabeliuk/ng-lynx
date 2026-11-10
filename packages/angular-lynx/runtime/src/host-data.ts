/**
 * Host data — `initData` / `updateData` / `globalProps` as Angular signals.
 *
 * A Lynx card is embedded in a native app. The host passes **init data** when
 * it loads the card (surfaced to the Background Thread as `lynx.__initData`)
 * and can push updates later via its `updateData` API. Separately the host
 * exposes app-wide **global props** (`lynx.__globalProps` — theme, locale,
 * host-app context) with its own update channel.
 *
 * Contract, confirmed against both reference implementations:
 *
 *  - `@lynx-js/react` (`snapshot/lynx/tt.js`, `core/lynx-update-data.js`,
 *    `core/globalProps.js`): the engine invokes
 *    `lynxCoreInject.tt.updateCardData(newData, options?)` for host data pushes
 *    and `lynxCoreInject.tt.updateGlobalProps(newData)` for global-prop pushes.
 *    The *framework* is responsible for merging into `lynx.__initData` /
 *    `lynx.__globalProps` (copy-on-write) and for emitting the
 *    `GlobalEventEmitter` events `onDataChanged` (with the changed subset) and
 *    `onGlobalPropsChanged` (with the merged props) — the engine does not emit
 *    them itself.
 *  - `@lynx-js/web-core` (`NativeApp.setCard`): registers RPC endpoints for
 *    `updateCardData` / `updateGlobalProps` **lazily via property setters** on
 *    the `tt` object, so plain assignment from this bundle (see
 *    {@link installHostData}, called by entry-background) is exactly how a
 *    framework hooks them.
 *
 * `updateCardData` extras mirrored from ReactLynx:
 *  - `options.type === 1` (RESET) replaces the data instead of merging.
 *  - a `__lynx_timing_flag` key is stripped (unsupported here — it drives
 *    ReactLynx's pipeline timing), with a dev-mode warning.
 *
 * Signals are the delivery mechanism because angular-lynx is zoneless: a
 * template (or `computed`/`effect`) reading {@link lynxInitData} re-renders
 * automatically when the host pushes new data — no manual change detection.
 */
import { signal, type Signal, type WritableSignal } from '@angular/core';

/** Untyped host data shape. Supply your own interface via the type parameter. */
export type HostData = Record<string, unknown>;

/** Native `updateData` modes (mirrors `@lynx-js/react`'s `NativeUpdateDataType`). */
const NATIVE_UPDATE_DATA_RESET = 1;

let initDataSig: WritableSignal<HostData> | undefined;
let globalPropsSig: WritableSignal<HostData> | undefined;

function readLynxProp(prop: '__initData' | '__globalProps'): HostData {
  const l = typeof lynx !== 'undefined' ? lynx : undefined;
  return (l?.[prop] as HostData | undefined) ?? {};
}

/**
 * The engine sets `lynx.__globalProps`, but hands init data only to the app: a
 * framework has to move it to `lynx.__initData`, with the same merge as ReactLynx.
 * Only the web runtime sets `__initData` itself, so a web preview or a mock of it
 * can't show this going wrong.
 */
function readInitData(): HostData {
  const l = typeof lynx !== 'undefined' ? lynx : undefined;
  if (l && !l.__initData) {
    const params = l.getApp?.()?._params;
    if (params) l.__initData = { ...params.initData, ...params.updateData };
  }
  return readLynxProp('__initData');
}

/**
 * Lazily created on first read so the initial value is taken *after* the
 * engine has populated `lynx.__initData` / `lynx.__globalProps` (module
 * evaluation order in the bundle is not guaranteed relative to that).
 */
function ensureInitDataSig(): WritableSignal<HostData> {
  return (initDataSig ??= signal(readInitData()));
}
function ensureGlobalPropsSig(): WritableSignal<HostData> {
  return (globalPropsSig ??= signal(readLynxProp('__globalProps')));
}

/**
 * The data the native host passed when loading this card, as a **signal** that
 * updates whenever the host pushes new data (`updateData`). Merge semantics
 * match ReactLynx: pushes are shallow-merged over the current value
 * (copy-on-write), unless the host requests a reset.
 *
 * Callable anywhere (component field initializers, services, plain functions)
 * — no injection context required.
 *
 * @example
 * ```ts
 * class AppComponent {
 *   readonly data = lynxInitData<{ title: string }>();
 *   // template: <text>{{ data().title }}</text>
 * }
 * ```
 * @public
 */
export function lynxInitData<T extends object = HostData>(): Signal<T> {
  return ensureInitDataSig().asReadonly() as unknown as Signal<T>;
}

/**
 * The host app's global props (`lynx.__globalProps` — theme, locale, host
 * context), as a **signal** that updates when the host pushes changes.
 *
 * @example
 * ```ts
 * class ThemedComponent {
 *   // Lynx Explorer sends `theme: 'Light' | 'Dark'`; other hosts choose their own key.
 *   readonly globalProps = lynxGlobalProps<{ theme?: string }>();
 *   readonly isDark = computed(() => this.globalProps().theme?.toLowerCase() === 'dark');
 * }
 * ```
 * @public
 */
export function lynxGlobalProps<T extends object = HostData>(): Signal<T> {
  return ensureGlobalPropsSig().asReadonly() as unknown as Signal<T>;
}

/**
 * Emit a `GlobalEventEmitter` event, matching ReactLynx's behavior so
 * listeners written for either framework observe the same events (including
 * angular-lynx's own `(window:onDataChanged)` / `(window:onGlobalPropsChanged)`
 * template bindings — the renderer's global-event path listens on the same
 * emitter).
 */
function emitGlobalEvent(name: string, params: unknown[]): void {
  const emitter =
    typeof lynx !== 'undefined' ? lynx?.getJSModule?.('GlobalEventEmitter') : undefined;
  emitter?.emit?.(name, params);
}

function updateCardData(newData: HostData, options?: { type?: number }): void {
  const { ['__lynx_timing_flag']: timingFlag, ...rest } = newData ?? {};
  if (timingFlag !== undefined && __DEV__) {
    console.warn(
      '[angular-lynx] updateData carried a `__lynx_timing_flag` — pipeline '
        + 'timing flags are not supported yet and the flag was ignored.',
    );
  }
  const base =
    (options?.type ?? 0) === NATIVE_UPDATE_DATA_RESET ? {} : readInitData();
  // Copy-on-write, like ReactLynx: readers holding the old object are unaffected.
  const merged: HostData = { ...base, ...rest };
  if (typeof lynx !== 'undefined' && lynx) lynx.__initData = merged;
  ensureInitDataSig().set(merged);
  emitGlobalEvent('onDataChanged', [rest]);
}

/**
 * `lynx.reload()`'s new init data, merged over the current value the way
 * ReactLynx does. No `onDataChanged`: the app is about to start over.
 *
 * @internal
 */
export function mergeReloadInitData(newData: HostData | undefined): void {
  const merged: HostData = { ...readInitData(), ...(newData ?? {}) };
  if (typeof lynx !== 'undefined' && lynx) lynx.__initData = merged;
  ensureInitDataSig().set(merged);
}

function updateGlobalProps(newData: HostData): void {
  const merged: HostData = { ...readLynxProp('__globalProps'), ...(newData ?? {}) };
  if (typeof lynx !== 'undefined' && lynx) lynx.__globalProps = merged;
  ensureGlobalPropsSig().set(merged);
  emitGlobalEvent('onGlobalPropsChanged', [merged]);
}

/**
 * Install the Background-Thread host-data handlers on `lynxCoreInject.tt`.
 * Called by `entry-background` at bundle start (and by test harnesses after
 * they set up their mocks). Idempotent; a no-op when no `tt` object exists.
 *
 * @internal
 */
export function installHostData(): void {
  if (typeof lynxCoreInject === 'undefined' || !lynxCoreInject?.tt) return;
  const tt = lynxCoreInject.tt as Record<string, unknown>;
  tt['updateCardData'] = (newData: HostData, options?: { type?: number }) =>
    updateCardData(newData, options);
  tt['updateGlobalProps'] = (newData: HostData) => updateGlobalProps(newData);

  // Lynx's guide calls this from the app's entry, which ReactLynx runs on both
  // threads. Here that code only runs on this one, where processors can't work.
  if (typeof lynx !== 'undefined' && lynx && !lynx.registerDataProcessors) {
    lynx.registerDataProcessors = () => {
      console.warn(
        '[angular-lynx] lynx.registerDataProcessors() did nothing: data processors run on '
          + 'the Main Thread. Call mainThreadLynx.registerDataProcessors() from a module in '
          + '`mainThreadModules`. See docs/17-host-data.md.',
      );
    };
  }
}

/** Reset module state — for testing only. @internal */
export function resetHostDataState(): void {
  initDataSig = undefined;
  globalPropsSig = undefined;
}

/**
 * `__DEV__` is replaced at build time by the bundler `define`. Declared here so
 * the source type-checks standalone.
 */
declare const __DEV__: boolean;

// `lynx` / `lynxCoreInject` are injected by the Lynx bundle wrapper (not on
// globalThis). Declared module-scoped (matching flush.ts / entry-background.ts)
// so they don't clash with the main-thread ambients.
// eslint-disable-next-line no-var
declare var lynx:
  | {
      __initData?: Record<string, unknown>;
      __globalProps?: Record<string, unknown>;
      registerDataProcessors?(): void;
      getApp?():
        | {
            _params?: {
              initData?: Record<string, unknown>;
              updateData?: Record<string, unknown>;
            } | null;
          }
        | null
        | undefined;
      getJSModule?(
        name: string,
      ):
        | { emit?(eventName: string, params: unknown[]): void }
        | null
        | undefined;
    }
  | null
  | undefined;
// eslint-disable-next-line no-var
declare var lynxCoreInject: { tt?: object | null } | null | undefined;
