import { ApplicationRef, ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { backgroundFunction, bindWorklet, LynxMainThread, whenFlushed } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import { BackButtonComponent } from './back-button.component.js';
import { boot } from './boot-clock.js';
import { flingScroll, flingTouch, type FlingResult } from './worklets.js';

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const ms = (value: number): string => `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`;

/** The value at `fraction` of the way through the sorted samples. */
function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

/**
 * Numbers to take from a phone: boot, an update's trip to the Main Thread,
 * a large render, and the Main Thread's frame rate while its list scrolls.
 * Each is shown on screen. "Applied" means the Main Thread has run the batch
 * and committed it with `__FlushElementTree`; the paint that follows isn't
 * visible to JavaScript.
 */
@Component({
  selector: 'app-timing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LYNX_ELEMENTS, LynxMainThread],
  host: { class: 'fill' },
  template: `
    <view class="page fill">
      <app-back-button></app-back-button>
      <text class="title" [flatten]="false">Timing</text>
      <text class="line" [flatten]="false">Boot: {{ bootLine }}</text>

      <view class="button" [flatten]="false" accessibility-label="Measure updates" (tap)="measureUpdates()">
        <text class="button-label">Measure updates</text>
      </view>
      <text class="line" [flatten]="false">Updates: {{ updates() }}</text>
      <text class="timing-probe" [flatten]="false">{{ probe() }}</text>

      <view class="button" [flatten]="false" accessibility-label="Render 1,000 rows" (tap)="measureRows()">
        <text class="button-label">Render 1,000 rows</text>
      </view>
      <text class="line" [flatten]="false">Rows: {{ rows() }}</text>
      <view class="timing-rows">
        @for (row of rowList(); track row) {
          <view class="timing-row"><text class="timing-row-label">Row {{ row }}</text></view>
        }
      </view>

      <text class="line" [flatten]="false">Fling: {{ fling() }}</text>
      <scroll-view
        class="timing-scroller"
        scroll-orientation="vertical"
        accessibility-label="Fling list"
        [lynxMainThread]="flingEvents"
      >
        @for (row of scrollRows; track row) {
          <view class="timing-row"><text class="timing-row-label">Fling row {{ row }}</text></view>
        }
      </scroll-view>
    </view>
  `,
})
export class TimingComponent {
  private readonly appRef = inject(ApplicationRef);

  protected readonly bootLine =
    boot.ready === undefined
      ? 'not measured'
      : `script start to Angular ready ${boot.ready - boot.scriptStart} ms, to first batch applied ${(boot.firstFrame ?? boot.ready) - boot.scriptStart} ms`;

  protected readonly updates = signal('not run');
  protected readonly probe = signal(0);
  protected readonly rows = signal('not run');
  protected readonly rowList = signal<number[]>([]);
  protected readonly fling = signal('scroll the list below');
  protected readonly scrollRows = Array.from({ length: 200 }, (_, i) => i);

  private readonly onFling = backgroundFunction((result: FlingResult) => {
    const fps = result.ms > 0 ? (result.frames * 1000) / result.ms : 0;
    this.fling.set(`${Math.round(fps)} fps over ${ms(result.ms)}, longest frame ${ms(result.longest)}, ${result.scrolls} scroll events`);
  });
  protected readonly flingEvents = { touchstart: bindWorklet(flingTouch, { report: this.onFling }), scroll: flingScroll };

  /** Fifty updates of one text binding, each timed from the change to the Main Thread's ack. */
  protected async measureUpdates(): Promise<void> {
    this.updates.set('running');
    this.appRef.tick();
    await whenFlushed();
    const samples: number[] = [];
    for (let i = 1; i <= 50; i++) {
      const start = now();
      this.probe.set(i);
      this.appRef.tick();
      await whenFlushed();
      samples.push(now() - start);
    }
    samples.sort((a, b) => a - b);
    this.updates.set(
      `median ${ms(percentile(samples, 0.5))}, p95 ${ms(percentile(samples, 0.95))}, max ${ms(samples[samples.length - 1]!)} (50 updates)`,
    );
  }

  /** 1,000 rows, each a view and a text, rendered and then removed. */
  protected async measureRows(): Promise<void> {
    this.rows.set('running');
    this.rowList.set([]);
    this.appRef.tick();
    await whenFlushed();
    let start = now();
    this.rowList.set(Array.from({ length: 1000 }, (_, i) => i));
    this.appRef.tick();
    await whenFlushed();
    const render = now() - start;
    start = now();
    this.rowList.set([]);
    this.appRef.tick();
    await whenFlushed();
    this.rows.set(`rendered and applied in ${ms(render)}, removed in ${ms(now() - start)}`);
  }
}
