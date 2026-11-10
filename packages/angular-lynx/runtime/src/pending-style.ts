/**
 * Deferred style/class serialization.
 *
 * Angular mutates an element's classes and styles **incrementally** —
 * `addClass` / `removeClass` / `setStyle` / `removeStyle` are each called once
 * per changed token during a change-detection pass. Serializing the element's
 * *entire* merged class list / style string on every one of those calls is
 * O(N²) string building on the Background Thread for an element with N styled
 * bindings — and the flush's coalescing pass then throws all but the last
 * result away.
 *
 * Instead, those renderer methods just update the {@link ShadowElement}'s
 * `classes` / `styles` and mark the element dirty here. The flush serializes
 * each dirty element **once** (`materializePendingStyleClass`, called by
 * `flushOps` before it drains the buffer), emitting exactly one
 * `SET_CLASS` / `SET_STYLE` op per element with the final value — same output
 * as before, without the intermediate work.
 *
 * This module is intentionally dependency-light (only `ops` + the op codes) so
 * both the renderer and the flush can import it without a cycle.
 */
import { OP } from 'angular-lynx/internal/ops';

import { pushOp } from './ops.js';
import type { ShadowElement } from './shadow-element.js';

const styleDirty = new Set<ShadowElement>();
const classDirty = new Set<ShadowElement>();

const CUSTOM_PROP = /^--/;

/** Convert a camelCase style key to dash-case (custom props pass through). */
function dashCase(key: string): string {
  if (CUSTOM_PROP.test(key)) return key;
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Serialize an element's accumulated styles into a CSS declaration string.
 * Lynx's `__SetInlineStyles` reliably accepts a CSS text string, so we send
 * that rather than an object (whose key-casing rules are engine-dependent).
 *
 * The `style` attribute goes first so a `[style.x]` binding wins over a static
 * declaration of the same property, as it does on the DOM.
 */
function serializeStyles(el: ShadowElement): string {
  const parts: string[] = [];
  const statics = el.staticStyle?.trim().replace(/;$/, '');
  if (statics) parts.push(statics);
  for (const key of Object.keys(el.styles)) {
    parts.push(`${dashCase(key)}: ${el.styles[key]}`);
  }
  return parts.join('; ');
}

/** Mark an element's inline style as changed; serialized once at flush. */
export function markStyleDirty(el: ShadowElement): void {
  styleDirty.add(el);
}

/** Mark an element's class list as changed; serialized once at flush. */
export function markClassDirty(el: ShadowElement): void {
  classDirty.add(el);
}

/**
 * Drop any pending style/class work for a node (called when it is destroyed),
 * so the flush doesn't emit a no-op op targeting a freed Main-Thread element.
 */
export function clearPendingStyleClass(el: ShadowElement): void {
  styleDirty.delete(el);
  classDirty.delete(el);
}

/**
 * Emit one `SET_STYLE` / `SET_CLASS` op per dirty element into the ops buffer,
 * then clear the dirty sets. Called by `flushOps` before `takeOps`, so these
 * ops ride out in the same batch (after the element's CREATE/INSERT, which
 * were pushed earlier in the change-detection pass — order within the batch is
 * irrelevant for these absolute set ops, which the Main Thread applies before
 * its single `__FlushElementTree`).
 */
export function materializePendingStyleClass(): void {
  if (styleDirty.size > 0) {
    for (const el of styleDirty) pushOp(OP.SET_STYLE, el.id, serializeStyles(el));
    styleDirty.clear();
  }
  if (classDirty.size > 0) {
    for (const el of classDirty) pushOp(OP.SET_CLASS, el.id, el.classString());
    classDirty.clear();
  }
}

/** Reset module state — for testing only. */
export function resetPendingStyleClass(): void {
  styleDirty.clear();
  classDirty.clear();
}
