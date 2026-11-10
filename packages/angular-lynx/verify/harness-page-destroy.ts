/**
 * Headless verification of page teardown (runtime/src/page-destroy.ts).
 *
 * On a real engine, leaving a page calls `tt.callDestroyLifetimeFun`. Without a
 * hook, the JS core threw `(null) is not a function` (LynxError 20100) on every
 * exit and `ngOnDestroy` never ran: found on the Android emulator, invisible in
 * every other harness because nothing here ever destroyed the page.
 *
 * Run with: `npm run verify:page-destroy`.
 */
import '@angular/compiler';

import {
  Component,
  DestroyRef,
  inject,
  Injectable,
  NO_ERRORS_SCHEMA,
  type OnDestroy,
} from '@angular/core';

import { bootstrapLynxApplication } from 'angular-lynx';
import 'angular-lynx/main-thread';

import { assert, installMockPapi, opsLogMark, opsSince, tick } from './mock-papi.js';

const destroyed: string[] = [];

@Injectable()
class ScopedService implements OnDestroy {
  ngOnDestroy(): void {
    destroyed.push('service');
  }
}

@Injectable()
class ThrowingService implements OnDestroy {
  ngOnDestroy(): void {
    destroyed.push('throwing');
    throw new Error('thrown on purpose by the harness');
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  providers: [ScopedService],
  template: `<view><text>alive</text></view>`,
})
class TestComponent implements OnDestroy {
  private readonly service = inject(ScopedService);

  constructor() {
    inject(DestroyRef).onDestroy(() => destroyed.push('destroy-ref'));
    void this.service;
  }

  ngOnDestroy(): void {
    destroyed.push('component');
  }
}

async function main(): Promise<void> {
  installMockPapi();
  const g = globalThis as Record<string, any>;
  // Set before the entry evaluates, which is why this import is dynamic: that's
  // when it installs its hooks on `tt`.
  g.lynxCoreInject = { tt: {} };
  await import('angular-lynx/entry-background');
  g.renderPage({});

  const tt = g.lynxCoreInject.tt as { callDestroyLifetimeFun?: () => void };

  console.log('\n=== The engine has a hook to call ===');
  assert(typeof tt.callDestroyLifetimeFun === 'function', 'tt.callDestroyLifetimeFun is installed');
  tt.callDestroyLifetimeFun!();
  assert(true, 'calling it before any app has bootstrapped does nothing');

  // That call stopped flushing, as a real page exit would, so re-arm the module
  // the way a test would need to before booting the app under test.
  const { resetFlushState } = await import('../runtime/src/flush.js');
  resetFlushState();

  console.log('\n=== Destroying the page destroys the app ===');
  // Bootstrapped first, so it's destroyed first: its exception mustn't stop the other.
  const throwing = await bootstrapLynxApplication(TestComponent, { providers: [ThrowingService] });
  throwing.injector.get(ThrowingService);
  const app = await bootstrapLynxApplication(TestComponent);
  await tick();
  await tick();
  destroyed.length = 0;
  const mark = opsLogMark();

  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => logged.push(args);
  tt.callDestroyLifetimeFun!();
  console.error = originalError;

  assert(throwing.destroyed, 'the first app is destroyed');
  assert(destroyed.includes('throwing'), "its service's ngOnDestroy ran and threw");
  assert(logged.length === 1, 'the exception was logged, not rethrown into the engine');
  assert(app.destroyed, 'the second app is still destroyed');
  assert(destroyed.includes('component'), 'component ngOnDestroy ran');
  assert(destroyed.includes('destroy-ref'), 'DestroyRef callback ran');
  assert(destroyed.includes('service'), 'component-scoped service ngOnDestroy ran');

  console.log('\n=== Nothing is sent to the native tree that is going away ===');
  await tick();
  await tick();
  assert(opsSince(mark).length === 0, 'the teardown sent no ops to the Main Thread');

  console.log('\n=== The engine calling it twice is harmless ===');
  tt.callDestroyLifetimeFun!();
  assert(true, 'a second call does not throw');

  console.log('\nAll page-destroy checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
