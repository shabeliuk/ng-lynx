/**
 * CPU water surface — a discrete solution of the 2D wave equation on a square
 * grid. This is the same physics the original
 * [threejs-water](https://github.com/jeantimex/threejs-water/) demo solves on
 * the GPU with ping-pong render targets; here it runs on the Lynx Background
 * Thread (PrimJS) over a coarse grid, and the resulting height field is fed into
 * a real three.js geometry for projection (see app.component.ts).
 *
 * Algorithm (the classic "Hugo Elias" water): each step, every cell relaxes
 * toward the average of its four neighbours minus its previous height — the
 * leapfrog form of the wave equation — then is multiplied by a damping factor
 * so ripples fade. Two buffers are swapped each step: the CPU analogue of the
 * demo's ping-pong textures.
 *
 * Pure math, no three.js dependency — the component bridges this height field
 * onto a `THREE.PlaneGeometry`.
 */
export class WaterSimulation {
  /** Vertices per side (the grid is `side × side`). */
  readonly side: number;
  /** Ripple energy retained per step (0..1; closer to 1 = longer-lived waves). */
  readonly damping: number;

  /** Current heights, row-major: `index = row * side + col`. */
  private curr: Float32Array;
  /** Previous-step heights. */
  private prev: Float32Array;

  constructor(side: number, damping = 0.965) {
    this.side = side;
    this.damping = damping;
    this.curr = new Float32Array(side * side);
    this.prev = new Float32Array(side * side);
  }

  /** The live height field (row-major), for reading into geometry. */
  get heights(): Float32Array {
    return this.curr;
  }

  /** Disturb the surface around (col, row) — a drop / raindrop. */
  drop(col: number, row: number, radius = 2, strength = 1.2): void {
    const { side } = this;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = col + dx;
        const y = row + dy;
        if (x < 0 || x >= side || y < 0 || y >= side) continue;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;
        // Smooth cosine bump so the drop doesn't introduce a hard spike.
        const falloff = 0.5 + 0.5 * Math.cos((dist / radius) * Math.PI);
        this.curr[y * side + x] += strength * falloff;
      }
    }
  }

  /** Advance the simulation by one step. */
  step(): void {
    const { side, curr, prev, damping } = this;
    for (let row = 0; row < side; row++) {
      for (let col = 0; col < side; col++) {
        const i = row * side + col;
        // Reflective boundary: clamp neighbour lookups at the edges.
        const left = curr[col > 0 ? i - 1 : i];
        const right = curr[col < side - 1 ? i + 1 : i];
        const up = curr[row > 0 ? i - side : i];
        const down = curr[row < side - 1 ? i + side : i];
        // Read prev[i] before overwriting it; neighbours come only from `curr`.
        let next = ((left + right + up + down) / 2 - prev[i]) * damping;
        // Snap negligible ripples to a hard zero. Without this the wave decays
        // toward — but never reaches — zero, so the surface would jitter (and
        // keep emitting render ops) forever. Snapping lets it truly come to
        // rest, which is what lets the render loop auto-pause.
        if (next < REST_EPSILON && next > -REST_EPSILON) next = 0;
        prev[i] = next;
      }
    }
    // Swap: `prev` now holds the freshly computed step.
    this.curr = prev;
    this.prev = curr;
  }

  /** Largest absolute height anywhere — the surface's "energy". Zero = at rest. */
  peak(): number {
    let max = 0;
    const { curr } = this;
    for (let i = 0; i < curr.length; i++) {
      const a = curr[i] < 0 ? -curr[i] : curr[i];
      if (a > max) max = a;
    }
    return max;
  }

  /** Flatten the surface. */
  reset(): void {
    this.curr.fill(0);
    this.prev.fill(0);
  }
}

/**
 * Below this height a ripple is snapped to zero so the surface can fully rest.
 * 0.003 height → ~0.0005 world units → sub-pixel once projected, so snapping it
 * is invisible, but it lets the dying tail of a ripple reach a *hard* flat rest
 * (instead of decaying toward zero forever) — which is what lets the component's
 * render loop detect "calm" and pause.
 */
const REST_EPSILON = 0.003;
