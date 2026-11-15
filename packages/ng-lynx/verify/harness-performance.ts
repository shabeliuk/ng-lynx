/**
 * Headless verification of the Performance API wrapper (`LynxPerformance`).
 *
 *  - `observe(entryTypes, cb)` registers a native observer for those types and
 *    delivers entries; a signal write from the callback drives zoneless CD.
 *  - the disposer (and app destroy) disconnect the observer.
 *  - tracing passthrough (`profileStart`/`profileEnd`/`profileMark`/
 *    `profileFlowId`/`isProfileRecording`) reaches `lynx.performance`.
 *  - a `[attr.__lynx_timing_flag]` binding reaches the element (the pipeline
 *    naming convention).
 *
 * Run with: `npm run verify:performance`.
 */
import '@angular/compiler';

import { Component, inject, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication, LynxPerformance } from 'ng-lynx';
import 'ng-lynx/main-thread';

import {
  assert,
  findByClass,
  findText,
  firePerformanceEntry,
  getPage,
  installMockPapi,
  performanceObservedTypes,
  performanceTrace,
  tick,
} from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      <text class="fcp">fcp:{{ fcp() ?? '-' }}</text>
      <view class="tagged" [attr.__lynx_timing_flag]="'checkout-render'"></view>
    </view>
  `,
})
export class TestComponent {
  private readonly perf = inject(LynxPerformance);
  readonly fcp = signal<number | undefined>(undefined);
  disposer?: () => void;

  constructor() {
    this.disposer = this.perf.observe(['metric.fcp'], (entry) => {
      this.fcp.set((entry['fcp'] as { duration: number } | undefined)?.duration);
    });
  }
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent);
  await tick();
  await tick();
  const page = getPage();
  const cmp = app.components[0].instance as TestComponent;

  console.log('\n=== observe() registers a native observer ===');
  assert(performanceObservedTypes().includes('metric.fcp'), 'observe(["metric.fcp"]) registered with lynx.performance');
  assert(findText(page, 'fcp:-') != null, 'no metric yet');

  console.log('\n=== entries drive the view (zoneless CD) ===');
  firePerformanceEntry('metric.fcp', { name: 'fcp', fcp: { name: 'fcp', duration: 123 } });
  await tick();
  await tick();
  assert(findText(page, 'fcp:123') != null, 'observer callback ran and the signal updated the view');

  console.log('\n=== __lynx_timing_flag attribute reaches the element ===');
  const tagged = findByClass(page, 'tagged');
  assert(tagged?.attrs['__lynx_timing_flag'] === 'checkout-render', 'pipeline timing flag set on the element');

  console.log('\n=== tracing passthrough ===');
  const perf = app.injector.get(LynxPerformance);
  perf.profileStart('render');
  perf.profileMark('mid');
  perf.profileEnd();
  assert(performanceTrace().join(',') === 'start:render,mark:mid,end', 'profileStart/Mark/End reached lynx.performance in order');
  assert(perf.profileFlowId() > 0, 'profileFlowId() returns a native id');
  assert(perf.isProfileRecording() === true, 'isProfileRecording() passes through');

  console.log('\n=== disposer disconnects ===');
  cmp.disposer?.();
  assert(!performanceObservedTypes().includes('metric.fcp'), 'disposer disconnected the observer');
  // A later entry must not reach the (disposed) callback.
  firePerformanceEntry('metric.fcp', { name: 'fcp', fcp: { name: 'fcp', duration: 999 } });
  await tick();
  await tick();
  assert(findText(page, 'fcp:123') != null, 'no delivery after dispose (view unchanged)');

  app.destroy();
  console.log('\n✅ All performance assertions passed — LynxPerformance works.\n');
}

main().catch((err) => {
  console.error('\n❌ Performance verification failed:\n', err);
  process.exit(1);
});
