/**
 * Step 3 of `runWorklet`: give the worklet live elements instead of the engine's
 * element objects.
 *
 * Both engines describe an element in an event as a plain object with the native
 * element under `elementRefptr`: `event.target` and `event.currentTarget` always,
 * and anything else that names an element. Each such object becomes a
 * {@link MainThreadEventTargetImpl} keeping the object's other fields.
 * `@lynx-js/react`'s runtime does the same, but replaces the object outright and
 * loses `id`, `uid` and `dataset`.
 */
import { MainThreadElementImpl, MainThreadEventTargetImpl } from './element.js';

/**
 * How deep the walk goes. Events from either engine are a few levels deep; the
 * limit only stops a cycle from overflowing the stack.
 */
export const MAX_EVENT_DEPTH = 16;

interface ElementObject {
  elementRefptr: LynxElement;
  [key: string]: unknown;
}

function isElementObject(value: object): value is ElementObject {
  return (value as Partial<ElementObject>).elementRefptr !== undefined;
}

/** Replace, in place, every element object in `value` with a live element. */
export function hydrateEventTargets(value: unknown, depth = 0): void {
  if (depth >= MAX_EVENT_DEPTH || typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const child = record[key];
    if (typeof child !== 'object' || child === null || child instanceof MainThreadElementImpl) continue;
    if (isElementObject(child)) record[key] = new MainThreadEventTargetImpl(child.elementRefptr, child);
    else hydrateEventTargets(child, depth + 1);
  }
}
