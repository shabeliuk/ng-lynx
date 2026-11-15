/**
 * Headless verification of the app-event injectables.
 *
 *  - `lynxForeground()` — flips when the engine invokes
 *    `tt.onAppEnterBackground()` / `tt.onAppEnterForeground()` (the Lynx JS
 *    core's lifecycle channel, hooked by installLifecycle with chaining of
 *    any pre-existing implementation).
 *  - `LynxGlobalEvents.listen()` — programmatic GlobalEventEmitter access
 *    with the same payload convention as `(window:x)` bindings; unlisten
 *    works.
 *  - `LynxGlobalEvents.latest()` — the newest payload as a signal, driving
 *    zoneless CD.
 *  - `LynxGlobalEvents.emit()` — reaches `(window:x)` template bindings.
 *
 * Run with: `npm run verify:appevents`.
 */
import '@angular/compiler';

import { Component, computed, inject, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import {
  bootstrapLynxApplication,
  LynxGlobalEvents,
  lynxForeground,
} from 'ng-lynx';
import {
  installLifecycle,
} from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';

import { assert, emitGlobalEvent, findText, getPage, installMockPapi, tick } from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app" (window:ping)="onPing($event)">
      <text class="fg">{{ fgText() }}</text>
      <text class="latest">volume:{{ volume() ?? '-' }}</text>
      <text class="ping">{{ ping() }}</text>
    </view>
  `,
})
export class TestComponent {
  private readonly events = inject(LynxGlobalEvents);
  readonly foreground = lynxForeground();
  readonly fgText = computed(() => (this.foreground() ? 'foreground' : 'background'));
  readonly volume = this.events.latest<number>('volumechanged');
  readonly ping = signal('ping:none');

  onPing(payload: unknown): void {
    this.ping.set(`ping:${String(payload)}`);
  }
}

async function main(): Promise<void> {
  installMockPapi();
  const g = globalThis as Record<string, any>;

  // The engine's tt object with a pre-existing lifecycle handler — the hook
  // must chain it, not clobber it.
  let previousHandlerCalls = 0;
  g.lynxCoreInject = {
    tt: {
      onAppEnterBackground: () => {
        previousHandlerCalls++;
      },
    },
  };
  installLifecycle(); // entry-background does this at bundle start
  g.renderPage({});

  const app = await bootstrapLynxApplication(TestComponent);
  await tick();
  await tick();
  const page = getPage();
  const tt = g.lynxCoreInject.tt as {
    onAppEnterForeground(): void;
    onAppEnterBackground(): void;
  };

  console.log('\n=== Lifecycle: foreground signal ===');
  assert(findText(page, 'foreground') != null, 'starts in the foreground');
  tt.onAppEnterBackground(); // what the JS core calls on __OnAppEnterBackground
  await tick();
  await tick();
  assert(findText(page, 'background') != null, 'onAppEnterBackground flipped the signal (CD ran)');
  assert(previousHandlerCalls === 1, "the tt object's pre-existing handler was chained, not clobbered");
  tt.onAppEnterForeground();
  await tick();
  await tick();
  assert(findText(page, 'foreground') != null, 'onAppEnterForeground flipped it back');

  console.log('\n=== LynxGlobalEvents.latest(): payload as a signal ===');
  emitGlobalEvent('volumechanged', 7);
  await tick();
  await tick();
  assert(findText(page, 'volume:7') != null, 'latest() signal updated the view');

  console.log('\n=== LynxGlobalEvents.listen(): programmatic + unlisten ===');
  const events = app.injector.get(LynxGlobalEvents);
  const seen: unknown[] = [];
  const unlisten = events.listen('custom', (payload) => seen.push(payload));
  emitGlobalEvent('custom', { a: 1 });
  emitGlobalEvent('custom', 'x', 'y'); // multi-arg → delivered as the array
  assert(seen.length === 2, 'listener received both emits');
  assert((seen[0] as { a: number }).a === 1, 'single-arg payload delivered unwrapped');
  assert(Array.isArray(seen[1]) && (seen[1] as unknown[])[1] === 'y', 'multi-arg payload delivered as array');
  unlisten();
  emitGlobalEvent('custom', 'after');
  assert(seen.length === 2, 'unlisten() stopped delivery');

  console.log('\n=== LynxGlobalEvents.emit(): reaches (window:x) bindings ===');
  events.emit('ping', ['hello']);
  await tick();
  await tick();
  assert(findText(page, 'ping:hello') != null, 'service emit reached the template binding');

  console.log('\n✅ All app-event assertions passed — lifecycle + global events work.\n');
}

main().catch((err) => {
  console.error('\n❌ App-events verification failed:\n', err);
  process.exit(1);
});
