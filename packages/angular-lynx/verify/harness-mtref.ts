/**
 * Headless verification of main-thread refs (`defineMainThreadRef` +
 * `[lynxMainThreadRef]`).
 *
 * A worklet bound to one element (the button) reaches a DIFFERENT element (the
 * target) through a ref and mutates it on the Main Thread. Asserts the target —
 * not the button — is changed, and that the ref auto-nulls once its element is
 * destroyed.
 *
 * Run with: `npm run verify:mtref`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication, LynxMainThread, LynxMainThreadRef } from 'angular-lynx';
import 'angular-lynx/main-thread';
import { defineMainThreadRef, defineWorklet } from 'angular-lynx/worklet';

import {
  assert,
  findByClass,
  fireWorklet,
  getPage,
  installMockPapi,
  tick,
} from './mock-papi.js';

// Authored as if in a Main-Thread module. `defineMainThreadRef` has no
// worklet-runtime dependency (SET_REF is pure bookkeeping — see
// worklet-apply.ts's module doc), but `defineWorklet` registers via
// `registerWorkletInternal`, which only exists after `installMockPapi()` —
// matching the real bundle, where the worklet-runtime always loads before
// user worklet modules (see plugin/src/index.ts). So the actual registration
// is deferred into `main()`, after `installMockPapi()`; only the ref (handle)
// needs to exist this early, for the component class below to reference it.
const targetRef = defineMainThreadRef('mtref-target');
let fadeTarget: ReturnType<typeof defineWorklet>;
// Named (not an anonymous arrow) so defineWorklet can derive its id from
// `fadeTargetMT.name` — see worklet-apply.ts's resolveIdAndFn doc.
function fadeTargetMT(): void {
  targetRef.current?.setStyle('opacity: 0.2');
}
function registerHarnessWorklet(): void {
  fadeTarget = defineWorklet(fadeTargetMT);
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [LynxMainThread, LynxMainThreadRef],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    @if (showTarget()) {
      <view class="target" [lynxMainThreadRef]="targetRef"><text>target</text></view>
    }
    <view class="btn" [lynxMainThread]="{ tap: fadeTarget }"><text>tap</text></view>
  `,
})
export class TestComponent {
  protected readonly targetRef = targetRef;
  protected readonly fadeTarget = fadeTarget;
  readonly showTarget = signal(true);
}

async function main(): Promise<void> {
  installMockPapi();
  registerHarnessWorklet();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent);
  await tick();
  await tick();
  const cmp = app.components[0]?.instance as TestComponent;
  const page = getPage();

  const target = findByClass(page, 'target');
  const btn = findByClass(page, 'btn');
  assert(!!target && !!btn, 'target + button rendered');

  console.log('\n=== Tap the button → worklet mutates the *target* via the ref ===');
  fireWorklet(btn!, 'tap', { type: 'tap' });
  await tick();
  assert(target!.style === 'opacity: 0.2', `ref target mutated by the worklet (got ${target!.style})`);
  assert(btn!.style === undefined, 'the button (event element) was NOT mutated');

  console.log('\n=== Ref auto-nulls after its element is destroyed ===');
  cmp.showTarget.set(false);
  await tick();
  await tick();
  assert(!findByClass(page, 'target'), 'target removed');
  // Worklet now resolves ref.current to null and is a no-op (no throw).
  let threw = false;
  try {
    fireWorklet(btn!, 'tap', { type: 'tap' });
  } catch {
    threw = true;
  }
  assert(!threw, 'worklet with a destroyed ref is a safe no-op (current === null)');

  console.log('\n✅ All main-thread-ref assertions passed — cross-element worklet access works.\n');
}

main().catch((err) => {
  console.error('\n❌ Main-thread-ref verification failed:\n', err);
  process.exit(1);
});
