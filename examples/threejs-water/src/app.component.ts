import {
  ChangeDetectionStrategy,
  Component,
  NO_ERRORS_SCHEMA,
  type OnDestroy,
  signal,
} from '@angular/core';
import {
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
} from 'three';

import { WaterSimulation } from './water-simulation.js';

/**
 * Three.js water — running as **real three.js** inside an Angular Lynx
 * component.
 *
 * Lynx has no WebGL/canvas (yet), so we don't use `THREE.WebGLRenderer`. Instead
 * we build a genuine three.js scene graph — a `PlaneGeometry` water surface in a
 * `Scene`, viewed through a `PerspectiveCamera` — and run the
 * {@link WaterSimulation} (a ported wave-equation solver) on the Background
 * Thread. Each frame we project every surface vertex with `Vector3.project()`
 * (three's own camera math) and render the projected points as native Lynx
 * `<view>` dots, coloured by wave height. So the entire three.js scene-graph +
 * projection pipeline runs on-device; only the GPU rasteriser is swapped for
 * Lynx views.
 *
 * ## Performance on-device
 *
 * Every per-frame view update crosses the Background→Main thread bridge as an
 * op, and the Main Thread re-renders that many native views — so naively
 * pushing all ~169 points every frame freezes a real device. Three things keep
 * it smooth (see the README/example notes):
 *
 *  1. **Op-skipping by value stability.** Projected positions are rounded to
 *     whole pixels and colours quantised, so a *resting* point produces a
 *     byte-identical style string frame-to-frame. Angular diffs binding values
 *     with `Object.is` and skips the DOM op when unchanged — so calm water
 *     emits **zero** ops and only the live ripple ring updates.
 *  2. **No per-frame layout.** The dot size is fixed in CSS; per frame we only
 *     change `transform` (translate) and `background-color` — paint/composite
 *     work, not layout.
 *  3. **Auto-pause.** The render loop stops once the surface settles (and
 *     restarts on a drop / rain), so an idle pool costs no CPU and no ops.
 */

/**
 * Surface resolution: `SEGMENTS × SEGMENTS` quads → `(SEGMENTS+1)²` vertices.
 * This is the main on-device performance knob: every vertex is its own native
 * view, restyled each frame, so the Main-Thread load is `SIDE² × fps`. 11 → a
 * 12×12 grid (144 points), a comfortable default that keeps "Rain" (which
 * disturbs the whole pool continuously, the heaviest case) smooth on-device.
 * Raise it for denser water on a capable device, or lower it / `FRAME_MS` if a
 * device struggles.
 */
const SEGMENTS = 11;
const SIDE = SEGMENTS + 1; // vertices per side → 12×12 = 144 points
/** World size of the (square) water plane. */
const WORLD = 2;
/** How tall a unit of simulated height stands up in world space. */
const HEIGHT_SCALE = 0.16;
/** Pixel size of the (square) render stage. Projection maps NDC into this box. */
const STAGE = 320;
/** Dot diameter in px (must match `.dot` in app.css). Half-offset centres it. */
const DOT = 9;
const HALF = DOT / 2;
/**
 * Frame interval in ms → caps the FPS at `1000 / FRAME_MS`. The render loop is
 * throttled here (not free-running) because every frame costs cross-thread ops,
 * so this directly trades smoothness against on-device load:
 *   50 → ~20 fps   33 → ~30 fps   25 → ~40 fps   16 → ~60 fps
 * Set to ~40 fps. Watch the live load line during a drop / "Rain" — if the fps
 * figure sits well below 40 or stutters, the device is bridge-bound at that
 * load, so raise this (fewer fps) or lower `SEGMENTS` for headroom. The loop
 * still pauses itself when the water is calm, regardless of this value.
 */
const FRAME_MS = 25;
/** While "Rain" is on, add a random drop every N frames. */
const RAIN_EVERY = 6;
/** Quantisation steps for colour — coarse enough that calm points share a tint. */
const COLOR_STEPS = 14;
/**
 * At/below this peak height the surface counts as "at rest" and the loop pauses.
 * Matched to the sim's snap-to-zero so the pause happens at a genuinely flat
 * surface — the paused frame is then pixel-identical to flat water (no frozen
 * mid-ripple), and re-rendering it would emit zero ops.
 */
const CALM = 0.003;

interface Point {
  /** Stable vertex index — the `@for` track key, so views are reused, not churned. */
  i: number;
  /**
   * Pre-built inline style. Position is rounded and colour quantised so a
   * resting point yields the *same string* every frame → Angular emits no op.
   */
  style: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      <view class="header">
        <text class="title">Three.js Water</text>
        <text class="load" [class.idle]="load() === 'idle'">{{ load() }}</text>
        <text class="subtitle">Rendered as Lynx views</text>
        <text class="hint">
          {{ SIDE * SIDE }} projected vertices · tap the pool to make ripples
        </text>
      </view>

      <view class="stage" (tap)="onStageTap()">
        @for (p of points(); track p.i) {
          <view class="dot" [attr.style]="p.style"></view>
        }
      </view>

      <view class="controls">
        <view class="btn" (tap)="dropCenter()">
          <text class="btn-label">Drop</text>
        </view>
        <view class="btn" [class.on]="rain()" (tap)="toggleRain()">
          <text class="btn-label">Rain {{ rain() ? 'on' : 'off' }}</text>
        </view>
        <view class="btn" (tap)="calm()">
          <text class="btn-label">Calm</text>
        </view>
      </view>
    </view>
  `,
})
export class AppComponent implements OnDestroy {
  protected readonly SIDE = SIDE;
  protected readonly rain = signal(false);
  protected readonly points = signal<Point[]>([]);
  /**
   * Single live readout: the load formula while animating, "idle" when the
   * loop is paused. One always-present line so the header never jumps.
   * e.g. "~70 live × 40 fps ≈ 2.8k/s real update rate".
   */
  protected readonly load = signal('idle');

  // --- Real three.js objects -------------------------------------------------
  private readonly sim = new WaterSimulation(SIDE);
  private readonly scene = new Scene();
  private readonly geometry = new PlaneGeometry(WORLD, WORLD, SEGMENTS, SEGMENTS);
  private readonly camera = new PerspectiveCamera(48, 1, 0.1, 100);
  private readonly v = new Vector3();

  private running = false;
  private frameCount = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Wall-clock of the previous frame + smoothed FPS, for the live counter. */
  private lastFrame = 0;
  private fpsEMA = 0;
  /** Smoothed count of points that actually changed style last frame (= ops). */
  private opsEMA = 0;
  /** Previous frame's style strings, to count how many actually changed. */
  private prevStyles: string[] = [];

  constructor() {
    // A genuine scene graph: the water mesh lives in a Scene, viewed by a
    // PerspectiveCamera. (We read the geometry directly for projection rather
    // than rasterising the mesh, since there's no WebGL context to draw into.)
    const mesh = new Mesh(
      this.geometry,
      new MeshBasicMaterial({ color: 0x3399ff, wireframe: true }),
    );
    this.scene.add(mesh);

    // Tilted three-quarter view. The plane lies in XY with +Z up, so the
    // camera's up vector is +Z and it looks down at the surface.
    this.camera.position.set(0, -2.7, 1.9);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();

    // Render the flat surface once so the dots exist, then ripple it.
    this.render();
    this.dropCenter();
  }

  ngOnDestroy(): void {
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
  }

  // --- Render loop (self-pausing) --------------------------------------------
  /** Start the loop if it isn't already running (called on every disturbance). */
  private ensureRunning(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setTimeout(this.loop, FRAME_MS);
  }

  private readonly loop = (): void => {
    if (!this.running) return;
    this.frameCount++;

    // Measure the real achieved frame rate (wall-clock between loop runs) and
    // surface a smoothed value. This is the actual on-device throughput — if a
    // device can't keep the FRAME_MS cadence, it reads below 1000/FRAME_MS.
    const now = Date.now();
    if (this.lastFrame !== 0) {
      const dt = now - this.lastFrame;
      if (dt > 0) {
        const inst = 1000 / dt;
        this.fpsEMA = this.fpsEMA === 0 ? inst : this.fpsEMA * 0.8 + inst * 0.2;
      }
    }
    this.lastFrame = now;
    if (this.frameCount % 4 === 0) {
      const f = Math.round(this.fpsEMA);
      const live = Math.round(this.opsEMA);
      // The actual Main-Thread load: how many views changed last frame
      // (op-skipping already excludes resting points) times how often a frame
      // happens — not the theoretical max if every view moved every frame.
      this.load.set(`~${live} live × ${f} fps ≈ ${fmtK(live * f)}/s real update rate`);
    }

    if (this.rain() && this.frameCount % RAIN_EVERY === 0) this.randomDrop();
    this.sim.step();
    this.render();

    // Keep going only while there's something to animate. Once the water is
    // calm and it isn't raining, stop — no timer, no CD, no ops until the next
    // tap. This is the difference between an idle pool costing nothing and it
    // pinning a thread forever.
    if (this.rain() || this.sim.peak() >= CALM) {
      this.timer = setTimeout(this.loop, FRAME_MS);
    } else {
      this.running = false;
      this.lastFrame = 0;
      this.fpsEMA = 0;
      this.opsEMA = 0;
      this.load.set('idle');
    }
  };

  /** Step the geometry's Z from the sim, project every vertex, publish points. */
  private render(): void {
    const pos = this.geometry.attributes.position;
    const heights = this.sim.heights;
    const prevStyles = this.prevStyles;
    const next: Point[] = new Array(pos.count);
    let changed = 0;

    for (let i = 0; i < pos.count; i++) {
      const h = heights[i];
      // Drive the real geometry's Z with the simulated wave height...
      pos.setZ(i, h * HEIGHT_SCALE);
      // ...then project the vertex through the camera (three.js's own math).
      this.v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).project(this.camera);

      // Round to whole pixels: a resting vertex then yields an identical
      // string every frame, so Angular's binding diff skips the op.
      const sx = Math.round((this.v.x * 0.5 + 0.5) * STAGE - HALF);
      const sy = Math.round((0.5 - this.v.y * 0.5) * STAGE - HALF);

      const style = `transform:translate(${sx}px,${sy}px);background-color:${heightColor(h)};`;
      // A point whose string is unchanged emits no op (Angular skips it) — this
      // is the live "actual updates/frame" the badge reports.
      if (style !== prevStyles[i]) changed++;
      prevStyles[i] = style;
      next[i] = { i, style };
    }

    this.opsEMA = this.opsEMA === 0 ? changed : this.opsEMA * 0.8 + changed * 0.2;
    this.points.set(next);
  }

  // --- Interactions ----------------------------------------------------------
  protected dropCenter(): void {
    this.sim.drop((SIDE / 2) | 0, (SIDE / 2) | 0);
    this.ensureRunning();
  }

  protected onStageTap(): void {
    this.randomDrop();
    this.ensureRunning();
  }

  protected toggleRain(): void {
    this.rain.update((on) => !on);
    if (this.rain()) this.ensureRunning();
  }

  protected calm(): void {
    this.rain.set(false);
    this.sim.reset();
    // One frame to flush the now-flat surface; it then auto-pauses.
    this.ensureRunning();
  }

  private randomDrop(): void {
    const col = 1 + ((Math.random() * (SIDE - 2)) | 0);
    const row = 1 + ((Math.random() * (SIDE - 2)) | 0);
    this.sim.drop(col, row);
  }
}

/** Compact thousands: 15360 → "15.4k", 980 → "980". */
function fmtK(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
}

/** Clamp to [0, 1]. */
function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Map a wave height to a deep-blue → bright-cyan water colour, quantised into
 * `COLOR_STEPS` bands so calm points all share one tint (and emit no op).
 */
function heightColor(h: number): string {
  const t = Math.round(clamp01(0.5 + h * 0.6) * COLOR_STEPS) / COLOR_STEPS;
  const r = Math.round(10 + (150 - 10) * t);
  const g = Math.round(50 + (220 - 50) * t);
  const b = Math.round(120 + (255 - 120) * t);
  return `rgb(${r},${g},${b})`;
}
