import {
  ChangeDetectionStrategy,
  Component,
  NO_ERRORS_SCHEMA,
  type OnDestroy,
  signal,
} from '@angular/core';

import { GameOfLife } from './game-of-life.js';

/**
 * Conway's Game of Life — the generation step runs as **real, compiled
 * WebAssembly**, not JavaScript.
 *
 * `wasm-src/life.ts` (AssemblyScript) compiles to a 746-byte `.wasm` module
 * embedded in `life-wasm-bytes.ts`; `game-of-life.ts` instantiates it with
 * the exact constructor-only flow Lynx's PrimJS WebAssembly support is
 * documented around (`new WebAssembly.Module()` → `new
 * WebAssembly.Instance()`, no imports object). Each `step()` call runs the
 * whole 8-neighbor rule pass *inside* WASM linear memory; this component just
 * reads the resulting byte grid back and colors native Lynx `<view>` cells.
 *
 * ## Platform support — corrected by an actual device run
 *
 * This comment previously stated flatly that **Lynx's WebAssembly support is
 * Android-only** (per the Lynx 3.8 "initial support" note), and that the iOS
 * Simulator therefore could not exercise it at all — only a real Android
 * device could.
 *
 * **That is not true on Lynx Explorer 4.0.0.** Run on an *iOS* simulator, this
 * example works: the module instantiates through the constructor-only flow
 * (`new WebAssembly.Module()` → `new WebAssembly.Instance()`, no imports
 * object), `step()` executes inside WASM linear memory, and the grid animates
 * (observed running to generation 99 at ~7 gen/s, settling onto a live
 * blinker oscillator).
 *
 * **But a real iPhone has no WebAssembly.** It threw `ReferenceError:
 * WebAssembly is not defined` on open: Explorer runs JavaScriptCore there,
 * which iOS doesn't allow to compile code outside Apple's browser. The
 * simulator runs on the Mac and isn't restricted. So `GameOfLife` now falls
 * back to the same rules in JavaScript, and the subtitle says which ran.
 *
 * Each cell view's position (`transform`) is set once at grid creation and
 * never rewritten — Angular's own per-binding `Object.is` diff then skips it
 * on every subsequent render for free, no manual tracking needed (unlike the
 * other two examples' hand-rolled string-quantization). Only
 * `background-color` is live.
 */

/** Grid dimensions — well under the WASM kernel's MAX_CELLS=1024-per-buffer budget. */
const COLS = 16;
const ROWS = 16;
/** Cell size in px (16x16 grid × 16px = 256px square stage). */
const CELL = 16;
/** Generation interval — a discrete simulation reads fine at a few gen/s, not 30-60fps. */
const STEP_MS = 150;
/** Consecutive zero-change generations before auto-pausing (catches a settled/static board). */
const SETTLE_GENERATIONS = 2;

interface Cell {
  /** Stable index — the `@for` track key AND the never-changing transform's input. */
  i: number;
  /** Set once at grid creation; never rewritten — Angular's diff skips it for free. */
  transform: string;
  color: string;
}

const DEAD = '#0c1830';
const ALIVE = '#6fc8ff';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      <view class="header">
        <text class="title">Game of Life — WebAssembly</text>
        <text class="load" [class.idle]="load() === 'idle'">{{ load() }}</text>
        <text class="subtitle">{{ engineLine }}</text>
      </view>

      <view class="stage">
        @for (c of cells(); track c.i) {
          <view class="cell" [style.transform]="c.transform" [style.backgroundColor]="c.color"></view>
        }
      </view>

      <view class="controls">
        <view class="btn" (tap)="togglePlay()">
          <text class="btn-label">{{ playing() ? 'Pause' : 'Play' }}</text>
        </view>
        <view class="btn" (tap)="randomize()">
          <text class="btn-label">Randomize</text>
        </view>
        <view class="btn" (tap)="clear()">
          <text class="btn-label">Clear</text>
        </view>
      </view>

      <text class="hint">
        {{ COLS }}×{{ ROWS }} cells · generation {{ generation() }}
      </text>
    </view>
  `,
})
export class AppComponent implements OnDestroy {
  protected readonly COLS = COLS;
  protected readonly ROWS = ROWS;
  protected readonly cells = signal<Cell[]>([]);
  protected readonly playing = signal(true);
  protected readonly load = signal('idle');
  protected readonly generation = signal(0);

  private readonly life = new GameOfLife(COLS, ROWS);

  /** Which kernel runs `step()`. A real iPhone has no WebAssembly (game-of-life.ts). */
  protected readonly engineLine =
    this.life.engine === 'webassembly'
      ? 'step() runs compiled WebAssembly · rendered as Lynx views'
      : `step() runs in JavaScript: ${this.life.fallbackReason}. Same rules as the WASM module.`;
  private cellList: Cell[] = [];

  private running = false;
  private destroyed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private settledFor = 0;
  private lastTick = 0;
  private gpsEMA = 0; // generations/sec, smoothed
  private opsEMA = 0;

  constructor() {
    this.cellList = Array.from({ length: COLS * ROWS }, (_, i) => ({
      i,
      transform: `translate(${(i % COLS) * CELL}px,${Math.floor(i / COLS) * CELL}px)`,
      color: DEAD,
    }));
    this.life.randomize();
    this.syncFromWasm();
    this.cells.set(this.cellList);
    this.ensureRunning();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
  }

  private ensureRunning(): void {
    if (this.running || !this.playing() || this.destroyed) return;
    this.running = true;
    this.lastTick = Date.now();
    this.timer = setTimeout(this.loop, STEP_MS);
  }

  private readonly loop = (): void => {
    if (!this.running) return;
    const now = Date.now();
    if (this.lastTick !== 0) {
      const dt = now - this.lastTick;
      if (dt > 0) {
        const inst = 1000 / dt;
        this.gpsEMA = this.gpsEMA === 0 ? inst : this.gpsEMA * 0.8 + inst * 0.2;
      }
    }
    this.lastTick = now;

    this.life.step();
    this.generation.update((g) => g + 1);
    const changed = this.syncFromWasm();
    this.opsEMA = this.opsEMA === 0 ? changed : this.opsEMA * 0.8 + changed * 0.2;

    const f = Math.round(this.gpsEMA);
    const live = Math.round(this.opsEMA);
    this.load.set(`~${live} live × ${f} gen/s`);

    // Auto-pause once the board has produced zero changes for a couple of
    // generations in a row — a genuinely settled (or simple still-life)
    // board, the same "stop animating when there's nothing to animate"
    // principle as examples/threejs-water's calm-water auto-pause. A period-2
    // oscillator (e.g. a blinker) keeps `changed > 0` forever, so it correctly
    // keeps running — only a TRULY static board pauses.
    this.settledFor = changed === 0 ? this.settledFor + 1 : 0;
    if (this.settledFor >= SETTLE_GENERATIONS) {
      this.running = false;
      this.load.set('idle (settled)');
      return;
    }

    if (this.playing()) {
      this.timer = setTimeout(this.loop, STEP_MS);
    } else {
      this.running = false;
    }
  };

  /** Read the WASM grid back into the cell list; returns how many cells changed color. */
  private syncFromWasm(): number {
    const grid = this.life.read();
    let changed = 0;
    for (let i = 0; i < this.cellList.length; i++) {
      const color = grid[i] !== 0 ? ALIVE : DEAD;
      if (color !== this.cellList[i].color) {
        this.cellList[i] = { ...this.cellList[i], color };
        changed++;
      }
    }
    this.cells.set(this.cellList);
    return changed;
  }

  protected togglePlay(): void {
    this.playing.update((p) => !p);
    if (this.playing()) {
      this.settledFor = 0;
      this.ensureRunning();
    } else {
      this.load.set('idle');
    }
  }

  protected randomize(): void {
    this.life.randomize();
    this.generation.set(0);
    this.syncFromWasm();
    this.settledFor = 0;
    this.playing.set(true);
    this.ensureRunning();
  }

  protected clear(): void {
    this.life.clear();
    this.generation.set(0);
    this.syncFromWasm();
    this.settledFor = 0;
    this.playing.set(false);
    this.running = false;
    this.load.set('idle');
  }
}
