/**
 * Background Thread bootstrap entry.
 *
 * Internal (`ng-lynx/entry-background`): the plugin adds it to your build. Don't import
 * it, and don't rely on it across releases.
 *
 * The build plugin prepends this module to every background bundle. It wires the
 * native event pipeline to our {@link publishEvent}: when a native gesture fires,
 * Lynx calls into this thread with the event's `sign`, and we dispatch to the
 * Angular handler registered for that sign.
 *
 * Lynx routes events via `lynxCoreInject.tt.publishEvent` on modern runtimes and
 * `globalThis.publishEvent` on older ones, so we install both.
 */
// First, so what PrimJS lacks exists before any other module runs. Imports are
// hoisted, so a polyfill in this file's body would run after `@angular/core`
// has evaluated, and Angular 22 calls `Object.hasOwn` while it does.
import './es-polyfills.js';
import { FIRST_SCREEN_RESOLVED_EVENT, RUN_ON_BACKGROUND_EVENT } from 'ng-lynx/internal/ops';

import { installLifecycle } from './app-events.js';
import { publishEvent, resolveFirstScreenEvents } from './event-registry.js';
import { installHostData } from './host-data.js';
import { destroyApplications } from './page-destroy.js';
import { reloadApplications } from './reload.js';
import { installThreadCalls } from './thread-calls.js';
import { installIntersectionObserver } from './visibility.js';

// `lynxCoreInject` is injected by the runtime wrapper as a parameter of the
// outer bundle callback — available as a bare identifier in every module.
// eslint-disable-next-line no-var
declare var lynxCoreInject:
  | {
      tt?: {
        publishEvent?: (handlerName: string, data: unknown) => void;
        [key: string]: unknown;
      };
    }
  | null
  | undefined;

/**
 * The Background Thread's end of a cross-thread event channel —
 * `addEventListener` receives events the *other* thread (the Main Thread's
 * `getJSContext()`) dispatches. Confirmed against `@lynx-js/web-core`'s real
 * `LynxCrossThreadContext`.
 */
interface LynxCoreContext {
  addEventListener(type: string, listener: (event: { data: unknown }) => void): void;
  dispatchEvent(event: { type: string; data?: unknown }): void;
}

// eslint-disable-next-line no-var
declare var lynx: { getCoreContext?(): LynxCoreContext } | undefined;

/** `typeof lynx !== 'undefined'`-guarded, since `lynx` is a bare ambient identifier. */
function coreContext(): LynxCoreContext | undefined {
  return typeof lynx !== 'undefined' ? lynx?.getCoreContext?.() : undefined;
}

const g = globalThis as Record<string, unknown>;

// Primary path: lynxCoreInject.tt.publishEvent (modern Lynx).
if (typeof lynxCoreInject !== 'undefined' && lynxCoreInject?.tt) {
  lynxCoreInject.tt.publishEvent = publishEvent;
  lynxCoreInject.tt['publicComponentEvent'] = (
    _cid: string,
    sign: string,
    data: unknown,
  ) => {
    publishEvent(sign, data);
  };
  lynxCoreInject.tt['callDestroyLifetimeFun'] = destroyApplications;
  lynxCoreInject.tt['onAppReload'] = (initData?: Record<string, unknown>) => {
    void reloadApplications(initData);
  };
}

// Fallback: some older Lynx SDKs call globalThis.publishEvent directly.
g['publishEvent'] = publishEvent;

// Host data pushes: install `tt.updateCardData` / `tt.updateGlobalProps` so
// native `updateData` / global-prop updates reach the signals exposed by
// `lynxInitData()` / `lynxGlobalProps()` (see host-data.ts for the confirmed
// engine contract on both native and web).
installHostData();

// Host lifecycle: hook `tt.onAppEnterForeground` / `tt.onAppEnterBackground`
// (invoked by the Lynx JS core — same override pattern as updateCardData) so
// `lynxForeground()` reflects the host's foreground/background state.
installLifecycle();

// Visibility: a `globalThis.IntersectionObserver` polyfill over
// `lynx.createIntersectionObserver`, so Angular's `@defer (on viewport)` (and
// userland DOM-style observers) work. Guarded — the web preview's worker
// already has a real one. See visibility.ts.
installIntersectionObserver();

// Bridge a Main-Thread worklet's `ctx.runOnBackground(data)` back to the
// Background event registry. BG and MT don't share a `globalThis` on a real
// engine (confirmed on-device — a `globalThis` property poke here used to be
// the whole bridge, and silently did nothing for it). The Main Thread sends
// via `lynx.getJSContext().dispatchEvent({ type: RUN_ON_BACKGROUND_EVENT,
// data: { sign, value } })` (worklet-apply.ts); receive it the matching way.
//
// Deferred one microtask: this module is prepended first in the bundle, so it
// runs before `lynx` is necessarily ready (the same class of ordering issue
// fixed on the Main-Thread side — see worklet-apply.ts's module doc). Nothing
// can call `runOnBackground` before the app has rendered at least once, which
// takes far longer than one microtask, so the defer is free in practice.
queueMicrotask(() => {
  coreContext()?.addEventListener(RUN_ON_BACKGROUND_EVENT, (event) => {
    const { sign, value } = event.data as { sign: string; value: unknown };
    publishEvent(sign, value);
  });
  // The Main Thread's other half of pre-boot event queueing
  // (event-registry.ts's module doc) — tells us whether a first-screen
  // snapshot, if one was in play, matched the real app's own first render.
  coreContext()?.addEventListener(FIRST_SCREEN_RESOLVED_EVENT, (event) => {
    const { matched } = event.data as { matched: boolean };
    resolveFirstScreenEvents(matched);
  });
  // `runOnMainThread`'s results and `runOnBackground`'s calls.
  installThreadCalls(coreContext());
});

// Legacy global kept inert: real host data pushes arrive via
// `tt.updateCardData` (wired above by installHostData) — both the native
// runtime wrapper and @lynx-js/web-core deliver through `tt`, never through
// this global. Kept defined so an older SDK probing for it sees a function.
g['updatePage'] = function (_data: unknown): void {
  // no-op
};
