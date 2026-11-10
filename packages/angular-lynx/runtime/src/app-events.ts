/**
 * App-level events as injectables: `LynxGlobalEvents` (the GlobalEventEmitter
 * as a service) and `lynxForeground()` (host lifecycle as a signal).
 *
 * Template bindings (`(window:x)` — see docs/12-events.md) already reach the
 * GlobalEventEmitter, but only from a component's template. Services,
 * interceptors, and plain functions need programmatic access — that's
 * {@link LynxGlobalEvents}.
 *
 * Lifecycle channel, confirmed against the engine (not assumed): the Lynx JS
 * core dispatches internal `__OnAppEnterForeground` / `__OnAppEnterBackground`
 * events and invokes `tt.onAppEnterForeground()` / `tt.onAppEnterBackground()`
 * — no-op methods the framework is expected to override, exactly like
 * `tt.updateCardData` (verified in `@lynx-js/web-core`'s lynx-core chunk;
 * on native these fire when the host calls `lynxView.onEnterForeground()` /
 * `onEnterBackground()`). entry-background.ts installs the hooks at bundle
 * start ({@link installLifecycle}), chaining any previous implementation.
 */
import { Injectable, type OnDestroy, type Signal, signal } from '@angular/core';

// ---------------------------------------------------------------------------
// Lifecycle: foreground/background as a signal
// ---------------------------------------------------------------------------

let foregroundSig: ReturnType<typeof signal<boolean>> | undefined;

function ensureForegroundSig() {
  return (foregroundSig ??= signal<boolean>(true));
}

/**
 * Whether the host app currently has this Lynx view in the **foreground**, as
 * a signal. Starts `true`; flips when the host calls the LynxView's
 * enter-background / enter-foreground lifecycle. Callable anywhere — no
 * injection context required.
 *
 * @example
 * ```ts
 * export class VideoComponent {
 *   readonly foreground = lynxForeground();
 *   private readonly pauseWhenHidden = effect(() => {
 *     if (!this.foreground()) this.pause();
 *   });
 * }
 * ```
 * @public
 */
export function lynxForeground(): Signal<boolean> {
  return ensureForegroundSig().asReadonly();
}

/**
 * Install the `tt.onAppEnterForeground` / `tt.onAppEnterBackground` hooks.
 * Called by `entry-background` at bundle start (and by test harnesses after
 * their mocks are up). Chains any previous implementation; no-op without a
 * `tt` object.
 *
 * @internal
 */
export function installLifecycle(): void {
  if (typeof lynxCoreInject === 'undefined' || !lynxCoreInject?.tt) return;
  const tt = lynxCoreInject.tt as Record<string, unknown>;
  const wrap = (name: string, value: boolean): void => {
    const previous = tt[name];
    tt[name] = function (this: unknown, ...args: unknown[]) {
      if (typeof previous === 'function') {
        (previous as (...a: unknown[]) => void).apply(this, args);
      }
      ensureForegroundSig().set(value);
    };
  };
  wrap('onAppEnterForeground', true);
  wrap('onAppEnterBackground', false);
}

/** Reset module state — for testing only. @internal */
export function resetAppEventsState(): void {
  foregroundSig = undefined;
}

// ---------------------------------------------------------------------------
// GlobalEventEmitter as a service
// ---------------------------------------------------------------------------

interface EmitterLike {
  addListener(name: string, listener: (...args: unknown[]) => void, context?: object): void;
  removeListener(name: string, listener: (...args: unknown[]) => void): void;
  emit?(name: string, params: unknown[]): void;
}

function getEmitter(): EmitterLike | undefined {
  return typeof lynx !== 'undefined'
    ? (lynx?.getJSModule?.('GlobalEventEmitter') as EmitterLike | null | undefined) ?? undefined
    : undefined;
}

/**
 * Injectable access to Lynx's app-level `GlobalEventEmitter` — the same bus
 * the `(window:x)` template bindings use, for code that has no template:
 * services, guards, interceptors.
 *
 * Payload convention matches the template bindings: a single-argument emit
 * arrives as that argument; multi-argument emits arrive as the argument
 * array.
 *
 * @example
 * ```ts
 * export class ThemeService {
 *   private readonly events = inject(LynxGlobalEvents);
 *   // Signal of the latest payload of a host-pushed event:
 *   readonly keyboard = this.events.latest<{ height: number }>('keyboardstatuschanged');
 * }
 * ```
 * @public
 */
@Injectable({ providedIn: 'root' })
export class LynxGlobalEvents implements OnDestroy {
  private readonly unlisteners: (() => void)[] = [];
  private readonly latestSignals = new Map<string, ReturnType<typeof signal<unknown>>>();

  /**
   * Subscribe to a global event. Returns an unlisten function; listeners are
   * also removed when the application (root injector) is destroyed.
   */
  listen(eventName: string, handler: (payload: unknown) => void): () => void {
    const emitter = getEmitter();
    if (!emitter) {
      if (__DEV__) {
        console.warn(
          `[angular-lynx] No GlobalEventEmitter available; the "${eventName}" `
            + 'listener will not fire.',
        );
      }
      return () => {};
    }
    const listener = (...args: unknown[]): void => {
      handler(args.length > 1 ? args : args[0]);
    };
    emitter.addListener(eventName, listener);
    let removed = false;
    const unlisten = (): void => {
      if (removed) return;
      removed = true;
      emitter.removeListener(eventName, listener);
    };
    this.unlisteners.push(unlisten);
    return unlisten;
  }

  /**
   * The latest payload of `eventName` as a **signal** (starts at `initial`,
   * `undefined` by default). One underlying listener per event name, shared
   * across callers, for the life of the app.
   */
  latest<T>(eventName: string, initial?: T): Signal<T | undefined> {
    let sig = this.latestSignals.get(eventName);
    if (!sig) {
      sig = signal<unknown>(initial);
      this.latestSignals.set(eventName, sig);
      this.listen(eventName, (payload) => sig!.set(payload));
    }
    return sig.asReadonly() as Signal<T | undefined>;
  }

  /**
   * Emit on the Background-Thread bus — received by other `listen()`ers and
   * `(window:x)` template bindings (this is also how the framework emits the
   * ReactLynx-parity `onDataChanged` / `onGlobalPropsChanged` events). Note:
   * this does **not** call into native — use a `NativeModule` for JS→host
   * communication.
   */
  emit(eventName: string, params: unknown[] = []): void {
    getEmitter()?.emit?.(eventName, params);
  }

  ngOnDestroy(): void {
    for (const unlisten of this.unlisteners) unlisten();
    this.unlisteners.length = 0;
    this.latestSignals.clear();
  }
}

/**
 * `__DEV__` is replaced at build time by the bundler `define`. Declared here so
 * the source type-checks standalone.
 */
declare const __DEV__: boolean;

// `lynx` / `lynxCoreInject` are injected by the Lynx bundle wrapper (not on
// globalThis). Declared module-scoped, matching the other runtime modules.
// eslint-disable-next-line no-var
declare var lynx:
  | {
      getJSModule?(name: string): unknown;
    }
  | null
  | undefined;
// eslint-disable-next-line no-var
declare var lynxCoreInject: { tt?: object | null } | null | undefined;
