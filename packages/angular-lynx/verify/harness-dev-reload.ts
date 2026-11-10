/**
 * Headless verification of the `web`-preview dev client
 * (`runtime/src/dev-reload-client.ts`) — the piece that replaces rsbuild's own
 * (crashing) dev client on the `web` preview's Background bundle and now
 * drives **state-preserving component hot-swap** on rebuilds, with a console
 * notice as the fallback (docs/31-hot-swap.md).
 *
 * Two layers are exercised:
 *
 *  1. the websocket message protocol (a fake `WebSocket` drives the same
 *     shapes the real dev server sends over `/rsbuild-hmr`; there's no
 *     webpack runtime here, so every hot-apply attempt falls back to the
 *     notice — which is exactly the fallback path under test);
 *  2. the hot-update machinery itself — `evaluateUpdateChunk` (both rspack
 *     chunk formats) and `applyModuleUpdates` (donor evaluation against a
 *     fake module graph, component matching, skip reporting) — with a spy
 *     standing in for `hotSwapComponent`.
 *
 * Run with: `npm run verify:dev-reload`.
 */
import {
  applyModuleUpdates,
  CDP_ANSWER_TIMEOUT_MS,
  evaluateUpdateChunk,
  installDevReloadClient,
  isRuntimeWrappedChunk,
  loadWrappedChunk,
  type ModuleFactory,
  requestDeviceReload,
  resolveSocketUrl,
} from '../runtime/src/dev-reload-client.js';
import { assert } from '../testing/src/mock-papi.js';

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readonly OPEN = 1;
  readyState = 1;
  url: string;
  private readonly listeners = new Map<string, Array<(e: any) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, cb: (e: any) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }
  send(): void {}
  emit(type: string, data?: unknown): void {
    for (const cb of this.listeners.get(type) ?? []) cb({ data });
  }
}

/** Let the client's async hot-apply attempt settle before asserting. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function main(): Promise<void> {
  (globalThis as Record<string, unknown>)['WebSocket'] = FakeWebSocket;
  (globalThis as Record<string, unknown>)['__webpack_hash__'] = 'buildA';
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(' '));
  };

  console.log('\n=== installDevReloadClient connects and wires listeners ===');
  installDevReloadClient('ws://fake-host/rsbuild-hmr?token=abc');
  assert(FakeWebSocket.instances.length === 1, 'constructed exactly one WebSocket');
  const socket = FakeWebSocket.instances[0]!;
  assert(socket.url === 'ws://fake-host/rsbuild-hmr?token=abc', 'connected to the URL it was given');

  console.log('\n=== initial connect: server reports the same hash — no notice ===');
  socket.emit('open');
  socket.emit('message', JSON.stringify({ type: 'hash', data: 'buildA' }));
  socket.emit('message', JSON.stringify({ type: 'ok' }));
  await settle();
  assert(warnings.length === 0, 'no notice when the reported hash matches the running bundle');

  console.log('\n=== a real rebuild with no webpack runtime: falls back to the notice ===');
  socket.emit('message', JSON.stringify({ type: 'hash', data: 'buildB' }));
  socket.emit('message', JSON.stringify({ type: 'ok' }));
  await settle();
  assert(warnings.length === 1, 'exactly one notice for the new-hash + ok sequence');
  assert(warnings[0]!.includes('new build is ready'), 'the notice is the expected message');

  console.log('\n=== repeat ok for the same (already-attempted) build — no duplicate ===');
  socket.emit('message', JSON.stringify({ type: 'ok' }));
  await settle();
  assert(warnings.length === 1, 'no duplicate notice for a hash already processed');

  console.log('\n=== static-changed fires unconditionally ===');
  warnings.length = 0;
  installDevReloadClient('ws://fake-host/rsbuild-hmr?token=abc');
  const socket2 = FakeWebSocket.instances[1]!;
  socket2.emit('open');
  socket2.emit('message', JSON.stringify({ type: 'hash', data: 'buildA' }));
  socket2.emit('message', JSON.stringify({ type: 'static-changed' }));
  await settle();
  assert(warnings.length === 1, 'static-changed notifies even though the hash never changed');

  console.log('\n=== errors do not trigger a notice ===');
  warnings.length = 0;
  installDevReloadClient('ws://fake-host/rsbuild-hmr?token=abc');
  const socket3 = FakeWebSocket.instances[2]!;
  socket3.emit('open');
  socket3.emit('message', JSON.stringify({ type: 'errors', data: { text: ['boom'] } }));
  await settle();
  assert(warnings.length === 0, "an 'errors' message alone doesn't notify — wait for a fix, matching rsbuild");
  console.warn = originalWarn;

  console.log('\n=== evaluateUpdateChunk: rspack require-style chunk format ===');
  const requireStyle = `
    "use strict";
    exports.ids = ["main"];
    exports.modules = {
      "(angular:background)/./src/app.component.ts"(module, exports2, require2) {
        exports2.marker = 'new-module-code';
      },
    };
    exports.runtime = function (wr) { wr.__runtimePatched = true; };
  `;
  const parsedRequire = evaluateUpdateChunk(requireStyle);
  assert(!!parsedRequire.modules && Object.keys(parsedRequire.modules).length === 1, 'require-style: one changed module extracted');
  assert(typeof parsedRequire.runtime === 'function', 'require-style: runtime patch extracted');

  console.log('\n=== evaluateUpdateChunk: jsonp/global chunk format ===');
  const jsonpStyle = `
    self["webpackHotUpdatetest_app"]("main", {
      "./src/thing.ts": function (module, exports, require) {}
    }, function (wr) {});
  `;
  const parsedJsonp = evaluateUpdateChunk(jsonpStyle);
  assert(!!parsedJsonp.modules && './src/thing.ts' in parsedJsonp.modules, 'jsonp-style: changed module extracted via the global hook');
  assert(!('webpackHotUpdatetest_app' in (globalThis as Record<string, unknown>)), 'jsonp-style: the global hook is cleaned up');

  console.log('\n=== The lynx target: runtime-wrapped chunks go through the engine ===');
  // The shape the runtime-wrapper plugin emits. Evaluating it exports nothing,
  // which is why every hot update on a real engine used to do nothing at all.
  const wrapped = `(function(){
    var g = globalThis;
    function __init_card_bundle__(lynxCoreInject) {
      var tt = lynxCoreInject.tt;
      tt.define("main.abc.hot-update.js", function(require, module, exports) {
        exports.modules = { "./src/app.component.ts": function () {} };
      });
      return tt.require("main.abc.hot-update.js");
    }
    g.__bundle__holder = { init: __init_card_bundle__ };
  })();`;
  assert(isRuntimeWrappedChunk(wrapped), 'a wrapped chunk is recognised');
  assert(!isRuntimeWrappedChunk(requireStyle), "the web target's plain chunk isn't");
  assert(evaluateUpdateChunk(wrapped).modules === undefined, 'evaluating a wrapped chunk yields no modules');
  delete (globalThis as Record<string, unknown>)['__bundle__holder'];

  const lynxGlobal = globalThis as Record<string, any>;
  const previousLynx = lynxGlobal['lynx'];
  await loadWrappedChunk('http://dev/main.abc.hot-update.js').then(
    () => assert(false, 'no requireModuleAsync: rejects'),
    () => assert(true, 'no requireModuleAsync: rejects, so the client falls back to a reload'),
  );
  const loaded: string[] = [];
  lynxGlobal['lynx'] = {
    requireModuleAsync(url: string, cb: (error: unknown, exports: unknown) => void) {
      loaded.push(url);
      cb(null, { modules: { './src/app.component.ts'() {} } });
    },
  };
  const update = await loadWrappedChunk('http://dev/main.abc.hot-update.js');
  assert(loaded[0] === 'http://dev/main.abc.hot-update.js', 'the engine loads the chunk by its URL');
  assert(!!update.modules && './src/app.component.ts' in update.modules, 'its exports are the update');
  lynxGlobal['lynx'].requireModuleAsync = (_url: string, cb: (error: unknown, exports: unknown) => void) =>
    cb(new Error('network'), undefined);
  await loadWrappedChunk('http://dev/main.abc.hot-update.js').then(
    () => assert(false, 'a load error rejects'),
    () => assert(true, 'a load error rejects'),
  );
  if (previousLynx === undefined) delete lynxGlobal['lynx'];
  else lynxGlobal['lynx'] = previousLynx;

  console.log('\n=== applyModuleUpdates: swaps only the component whose template actually changed ===');
  class OldCmp {}
  (OldCmp as unknown as Record<string, unknown>)['ɵcmp'] = { template: 'function t(rf,ctx){ text("v1") }', decls: 2, vars: 1 };
  class SiblingCmp {}
  (SiblingCmp as unknown as Record<string, unknown>)['ɵcmp'] = { template: 'function t(rf,ctx){ text("sibling") }', decls: 1, vars: 0 };
  class PlainService {}
  const swaps: Array<[unknown, unknown]> = [];
  const fakeRequire = Object.assign((id: string) => fakeRequire.c![id]?.exports, {
    c: {
      'mod-a': { exports: { OldCmp, SiblingCmp, helper: () => 1 } as Record<string, unknown> },
      'mod-svc': { exports: { PlainService } as Record<string, unknown> },
      'mod-logic': { exports: { OldCmp } as Record<string, unknown> },
    } as Record<string, { exports: Record<string, unknown> } | undefined>,
    m: {} as Record<string, ModuleFactory>,
  });
  const donorFactory: ModuleFactory = (_module, exports2) => {
    // The edited component: same shape, NEW compiled template.
    class OldCmp2 {}
    (OldCmp2 as unknown as Record<string, unknown>)['ɵcmp'] = { template: 'function t(rf,ctx){ text("v2 EDITED") }', decls: 2, vars: 1 };
    exports2['OldCmp'] = OldCmp2;
    // Re-emitted but UNCHANGED sibling (fresh class, identical compiled def)
    // — must NOT be swapped, or its live view (and any child state under it)
    // would be pointlessly rebuilt.
    class SiblingCmp2 {}
    (SiblingCmp2 as unknown as Record<string, unknown>)['ɵcmp'] = { template: 'function t(rf,ctx){ text("sibling") }', decls: 1, vars: 0 };
    exports2['SiblingCmp'] = SiblingCmp2;
    exports2['helper'] = () => 2;
  };
  const applied = applyModuleUpdates(
    { 'mod-a': donorFactory },
    fakeRequire,
    (prev, next) => swaps.push([prev, next]),
  );
  assert(applied.swapped.length === 1 && applied.swapped[0] === 'OldCmp', 'only the edited component was swapped');
  assert(swaps.length === 1 && swaps[0]![0] === OldCmp, 'swap() received the LIVE class as the target');
  assert(applied.skipped.length === 0, 'nothing skipped for a component-bearing module with a real template change');

  console.log('\n=== applyModuleUpdates: a logic-only edit (no def change) is skipped, not swapped ===');
  const logicOnly = applyModuleUpdates(
    {
      'mod-logic': (_m, exports2) => {
        class OldCmp3 {}
        (OldCmp3 as unknown as Record<string, unknown>)['ɵcmp'] = { template: 'function t(rf,ctx){ text("v1") }', decls: 2, vars: 1 };
        exports2['OldCmp'] = OldCmp3;
      },
    },
    fakeRequire,
    (prev, next) => swaps.push([prev, next]),
  );
  assert(logicOnly.swapped.length === 0 && logicOnly.skipped.length === 1, 'identical compiled template → logic-only change → skipped (→ notice fallback)');
  assert(swaps.length === 1, 'no swap call for the logic-only change');

  console.log('\n=== applyModuleUpdates: non-component modules are reported, not swapped ===');
  const svcResult = applyModuleUpdates(
    { 'mod-svc': (_m, exports2) => { exports2['PlainService'] = class {}; } },
    fakeRequire,
    (prev, next) => swaps.push([prev, next]),
  );
  assert(svcResult.swapped.length === 0 && svcResult.skipped.length === 1, 'a service-only module is skipped (→ notice fallback)');
  assert(swaps.length === 1, 'no extra swap calls for the service module');

  console.log('\n=== applyModuleUpdates: a newly-added module is installed, not skipped ===');
  const addResult = applyModuleUpdates(
    { 'mod-new': (_m, exports2) => { exports2['x'] = 1; } },
    fakeRequire,
    () => {},
  );
  assert(addResult.skipped.length === 0, 'an unseen module id is not reported as unswappable');
  assert(typeof fakeRequire.m['mod-new'] === 'function', 'its factory was installed into require.m for donor imports');

  console.log('\n=== resolveSocketUrl: prefers the served origin over the baked host (device correctness) ===');
  assert(
    resolveSocketUrl('ws://localhost:3000/rsbuild-hmr?token=abc', 'http://192.168.1.7:3000/')
      === 'ws://192.168.1.7:3000/rsbuild-hmr?token=abc',
    'the LAN origin the bundle was served from replaces the baked `localhost` (which on a phone means the phone)',
  );
  assert(
    resolveSocketUrl('ws://localhost:3000/rsbuild-hmr?token=abc', 'https://example.test:8443/base/')
      === 'wss://example.test:8443/rsbuild-hmr?token=abc',
    'an https public path upgrades the socket scheme to wss and keeps the baked path + query',
  );
  assert(
    resolveSocketUrl('ws://localhost:3000/rsbuild-hmr?token=abc', undefined)
      === 'ws://localhost:3000/rsbuild-hmr?token=abc',
    'no public path (headless / build) → the baked URL is used unchanged',
  );
  assert(
    resolveSocketUrl('ws://localhost:3000/rsbuild-hmr', '/static/')
      === 'ws://localhost:3000/rsbuild-hmr',
    'a relative public path is not an origin — the baked URL is kept',
  );

  console.log('\n=== requestDeviceReload: no DevTool module (web preview) → not reloadable ===');
  const g = globalThis as Record<string, unknown>;
  assert(requestDeviceReload() === false, 'returns false when NativeModules is absent entirely');
  g['NativeModules'] = {};
  assert(requestDeviceReload() === false, 'returns false when the DevTool module is not registered');

  console.log('\n=== requestDeviceReload: DevTool present (device) → issues a Page.reload CDP command ===');
  const cdpCalls: string[] = [];
  g['NativeModules'] = {
    LynxDevToolSetModule: {
      invokeCdp(message: string, callback?: (result: string) => void): void {
        cdpCalls.push(message);
        callback?.('');
      },
    },
  };
  assert(requestDeviceReload() === true, 'returns true once the DevTool module can be invoked');
  assert(cdpCalls.length === 1, 'exactly one CDP command was issued');
  const cdp = JSON.parse(cdpCalls[0]!) as { method: string; params?: { ignoreCache?: boolean } };
  assert(cdp.method === 'Page.reload', 'the command is Page.reload — the same one @lynx-js/webpack-dev-transport uses');
  assert(cdp.params?.ignoreCache === true, 'it reloads ignoring cache, so the new build is actually picked up');

  console.log('\n=== requestDeviceReload: the alternate `Devtool` capitalization is probed too ===');
  cdpCalls.length = 0;
  g['NativeModules'] = {
    LynxDevtoolSetModule: {
      invokeCdp(message: string): void {
        cdpCalls.push(message);
      },
    },
  };
  assert(requestDeviceReload() === true, 'the lowercase-t spelling is accepted (engine builds differ; upstream probes both)');
  assert(cdpCalls.length === 1, 'the alternate spelling issued the command too');

  console.log('\n=== an unswappable change on device asks the DevTool to reload, and says what to do if it can\'t ===');
  cdpCalls.length = 0;
  const warns: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void warns.push(args.join(' '));
  installDevReloadClient('ws://fake-host/rsbuild-hmr');
  const deviceSocket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
  deviceSocket.emit('open');
  deviceSocket.emit('message', JSON.stringify({ type: 'hash', data: 'buildDevice' }));
  deviceSocket.emit('message', JSON.stringify({ type: 'ok' }));
  await settle();
  assert(cdpCalls.length === 1, 'the unswappable rebuild triggered exactly one DevTool reload');
  assert(warns.length === 0, 'nothing is printed while the DevTool may still answer');
  // This module never calls back, like Explorer 4.2 with its DevTool switch off.
  await new Promise((resolve) => setTimeout(resolve, CDP_ANSWER_TIMEOUT_MS + 100));
  assert(warns.some((m) => m.includes('Reopen the page')), 'unanswered: it says to reopen the page');
  assert(warns.some((m) => m.includes('Lynx DevTool Switches')), 'and which Explorer switch makes reloads work');

  console.log('\n=== an answered reload stays quiet ===');
  warns.length = 0;
  let answeredCalls = 0;
  g['NativeModules'] = {
    LynxDevToolSetModule: {
      invokeCdp(_message: string, callback?: (result: string) => void): void {
        answeredCalls++;
        callback?.('{"id":0,"result":{}}');
      },
    },
  };
  assert(requestDeviceReload(() => console.warn('unanswered')) === true, 'the reload is requested');
  await new Promise((resolve) => setTimeout(resolve, CDP_ANSWER_TIMEOUT_MS + 100));
  console.warn = realWarn;
  assert(answeredCalls === 1 && warns.length === 0, 'an answered Page.reload prints nothing');
  delete g['NativeModules'];

  console.log('\n✅ Dev-reload / hot-update client assertions passed.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Dev-reload verification failed:\n', err);
  process.exit(1);
});
