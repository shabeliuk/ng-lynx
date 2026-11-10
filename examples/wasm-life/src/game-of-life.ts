import { LIFE_WASM_BYTES } from './life-wasm-bytes.js';

/** What `GameOfLife` drives: the compiled WASM module, or the same rules in JavaScript. */
interface LifeKernel {
  init(w: number, h: number): void;
  step(): void;
  /** A live view (0/1 per cell, row-major) over the current generation. */
  read(): Uint8Array;
}

/**
 * The compiled module (`wasm-src/life.ts`), through the constructor-only flow
 * Lynx's PrimJS WebAssembly support is documented around
 * (`new WebAssembly.Module(...)` → `new WebAssembly.Instance(module)`, no
 * imports object, no `instantiate()`/`instantiateStreaming()`).
 */
function wasmKernel(cells: number): LifeKernel {
  const module = new WebAssembly.Module(LIFE_WASM_BYTES);
  const instance = new WebAssembly.Instance(module);
  const exports = instance.exports as unknown as {
    init(w: number, h: number): void;
    step(): void;
    getGridPtr(): number;
    memory: WebAssembly.Memory;
  };
  return {
    init: (w, h) => exports.init(w, h),
    step: () => exports.step(),
    read: () => new Uint8Array(exports.memory.buffer, exports.getGridPtr(), cells),
  };
}

/**
 * The same kernel in JavaScript: two buffers, edge-clamped neighbours, B3/S23,
 * exactly as `wasm-src/life.ts`. Only for engines without WebAssembly.
 */
function jsKernel(): LifeKernel {
  let width = 0;
  let height = 0;
  let current = new Uint8Array(0);
  let next = new Uint8Array(0);
  const at = (x: number, y: number) =>
    x < 0 || x >= width || y < 0 || y >= height ? 0 : current[y * width + x]!;
  return {
    init(w, h) {
      width = w;
      height = h;
      current = new Uint8Array(w * h);
      next = new Uint8Array(w * h);
    },
    step() {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const n =
            at(x - 1, y - 1) + at(x, y - 1) + at(x + 1, y - 1) +
            at(x - 1, y) + at(x + 1, y) +
            at(x - 1, y + 1) + at(x, y + 1) + at(x + 1, y + 1);
          const alive = current[y * width + x] !== 0;
          next[y * width + x] = n === 3 || (alive && n === 2) ? 1 : 0;
        }
      }
      [current, next] = [next, current];
    },
    read: () => current,
  };
}

/**
 * Game of Life on the compiled WASM module where the engine has
 * WebAssembly, and on the same rules in JavaScript where it doesn't.
 *
 * **A real iPhone doesn't.** Lynx Explorer runs the Background Thread on
 * JavaScriptCore there, and iOS lets JavaScriptCore compile code only in
 * Apple's own browser, so `WebAssembly` is undefined: the page threw
 * `ReferenceError: WebAssembly is not defined` on open. The iOS simulator runs
 * on the Mac, which has no such restriction, so it does have WebAssembly.
 * Android's PrimJS has it too. `engine` says which one ran.
 *
 * `read()` returns a *live* view, not a copy: read it before the next `step()`.
 */
export class GameOfLife {
  readonly engine: 'webassembly' | 'javascript';
  /** Why WebAssembly wasn't used, when it wasn't. */
  readonly fallbackReason: string = '';
  private readonly kernel: LifeKernel;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    let kernel: LifeKernel | undefined;
    if (typeof WebAssembly === 'undefined') {
      this.fallbackReason = 'this engine has no WebAssembly';
    } else {
      try {
        kernel = wasmKernel(width * height);
      } catch (err) {
        this.fallbackReason = `WebAssembly failed: ${(err as Error)?.message ?? err}`;
      }
    }
    this.engine = kernel ? 'webassembly' : 'javascript';
    this.kernel = kernel ?? jsKernel();
    this.kernel.init(width, height);
  }

  /** Seed the current generation with random noise (written straight into the live grid). */
  randomize(density = 0.35): void {
    const view = this.read();
    for (let i = 0; i < view.length; i++) view[i] = Math.random() < density ? 1 : 0;
  }

  /** Reset to an all-dead grid. */
  clear(): void {
    this.kernel.init(this.width, this.height);
  }

  /** Compute the next generation. */
  step(): void {
    this.kernel.step();
  }

  /** A live `Uint8Array` view (0/1 per cell, row-major) over the current generation. */
  read(): Uint8Array {
    return this.kernel.read();
  }
}
