// AssemblyScript source — NOT plain TypeScript (i32/u8/load/store are
// AssemblyScript-only) and NOT compiled by this app's own build (it lives
// outside src/, which is all `tsconfig.json` includes). This is the
// authoritative source for the bytes embedded in `src/life-wasm-bytes.ts`.
// Recompile with: `npx assemblyscript@0.28.19 asc life.ts --outFile
// life.wasm -O --noAssert --initialMemory 1`, then re-embed the output.
//
// Conway's Game of Life kernel, compiled to WebAssembly (AssemblyScript).
//
// Stays entirely in raw linear-memory ops (load<u8>/store<u8> at fixed
// offsets) — no AssemblyScript-managed runtime/GC, no dynamic allocation.
// That keeps the compiled module tiny and lets the JS side interact with it
// purely via typed-array views over `instance.exports.memory.buffer`, which
// is exactly the "common-case usage of WebAssembly.Memory" Lynx's PrimJS
// integration is documented to support — no imports object, no managed-
// runtime exports needed.
//
// Memory layout: two fixed double-buffers, each MAX_CELLS bytes (one byte per
// cell: 0 = dead, 1 = alive). `step()` reads the CURRENT buffer, writes the
// next generation into the OTHER one, then flips which is current —
// `getGridPtr()` always returns the offset of whichever buffer is live, so
// the JS side reads a consistent generation and never tears mid-step.

const MAX_CELLS: i32 = 1024;

let width: i32 = 0;
let height: i32 = 0;
let currentIsA: bool = true;

function bufferOffset(isA: bool): i32 {
  return isA ? 0 : MAX_CELLS;
}

/** (Re)initialize the grid: sets dimensions and zeroes both buffers. */
export function init(w: i32, h: i32): void {
  width = w;
  height = h;
  currentIsA = true;
  for (let i: i32 = 0; i < MAX_CELLS * 2; i++) {
    store<u8>(i, 0);
  }
}

/** Memory offset of the CURRENT (most recently computed) generation. */
export function getGridPtr(): i32 {
  return bufferOffset(currentIsA);
}

function cellAt(buf: i32, x: i32, y: i32): i32 {
  if (x < 0 || x >= width || y < 0 || y >= height) return 0; // edge-clamped, not wraparound
  return load<u8>(buf + y * width + x);
}

/** Compute the next generation (the classic B3/S23 ruleset). */
export function step(): void {
  const src = bufferOffset(currentIsA);
  const dst = bufferOffset(!currentIsA);

  for (let y: i32 = 0; y < height; y++) {
    for (let x: i32 = 0; x < width; x++) {
      let n: i32 = 0;
      n += cellAt(src, x - 1, y - 1);
      n += cellAt(src, x, y - 1);
      n += cellAt(src, x + 1, y - 1);
      n += cellAt(src, x - 1, y);
      n += cellAt(src, x + 1, y);
      n += cellAt(src, x - 1, y + 1);
      n += cellAt(src, x, y + 1);
      n += cellAt(src, x + 1, y + 1);

      const alive = cellAt(src, x, y) != 0;
      let next: u8 = 0;
      if (alive) {
        if (n == 2 || n == 3) next = 1;
      } else {
        if (n == 3) next = 1;
      }
      store<u8>(dst + y * width + x, next);
    }
  }

  currentIsA = !currentIsA;
}
