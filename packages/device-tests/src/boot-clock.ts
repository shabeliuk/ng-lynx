/**
 * Boot timestamps for the timing screen. `index.ts` imports this first, so
 * `scriptStart` is taken before Angular's own modules evaluate. The polyfills
 * and ng-lynx's Background entry run before it, and nothing on this thread sees
 * the engine's own start.
 */
export const boot: { scriptStart: number; ready?: number; firstFrame?: number } = { scriptStart: Date.now() };
