/**
 * Entry point of the **dynamic-component bundle**.
 *
 * Unlike an app entry (`index.ts`, which calls `bootstrapLynxApplication`),
 * this one only *exports* — the bundle is loaded by a host, and its exports
 * are what `loadDynamicComponent()` resolves.
 */
export { RemoteCardComponent, default } from './remote-card.component.js';
