// Derived in part from vue-lynx (https://github.com/Huxpro/vue-lynx), Copyright Xuan Huang,
// Apache-2.0. Changed: its op executor, extended for Angular.
/**
 * Main-Thread ops executor.
 *
 * Receives the flat ops buffer that the Background Thread shipped via
 * `callLepusMethod('ngPatchUpdate', { data })` and replays each operation onto a
 * real Lynx element using the element PAPI (`__CreateView`, `__AppendElement`,
 * `__SetAttribute`, …). A single `__FlushElementTree()` at the end commits the
 * whole batch to the native layer.
 *
 * This is the Angular analog of vue-lynx's `ops-apply.ts`. `<list>` children go
 * through `list-apply.ts`, worklets and main-thread refs through
 * `worklet-apply.ts`, gesture detectors through `gesture-apply.ts`.
 */
import { APPEND_ANCHOR, OP, PAGE_ROOT_ID, resolveInterned } from 'angular-lynx/internal/ops';

import { elements, pageUniqueId, setPageUniqueId } from './element-registry.js';
import {
  createListElement,
  flushListUpdates,
  insertListItem,
  isListParent,
  isPlatformInfoAttr,
  removeListItem,
  resetListState,
  setPlatformInfoProp,
} from './list-apply.js';
import { applySetGestureDetector } from './gesture-apply.js';
import { applySetRef, applySetWorkletEvent } from './worklet-apply.js';

/**
 * `__ENABLE_SELECTOR_QUERIES__` is replaced at build time by the bundler
 * `define` (`enableSelectorQueries` in `plugin/src/index.ts`, default
 * `true`). Declared here so this file type-checks standalone. Only the
 * `true` (eager) mode sets the `ng-ref-{id}` attribute here at `CREATE`
 * time — `'lazy'` mode defers it to the Background Thread's
 * `shadow-element.ts`, which emits it as an ordinary `SET_ATTR` op on first
 * query instead.
 */
declare const __ENABLE_SELECTOR_QUERIES__: boolean | 'lazy';

/**
 * `nativeElements` in `plugin/src/index.ts`: tags the host app registers with
 * its own native UI. Absent outside a `pluginAngularLynx` build.
 */
declare const __NATIVE_ELEMENTS__: readonly string[] | undefined;

/**
 * Lynx's built-in element vocabulary
 * (https://lynxjs.org/api/elements/built-in/ and the `@lynx-js/types` element
 * map), plus whatever the host registered through `nativeElements`. A tag
 * outside this set reaching `createTypedElement` is an Angular component
 * selector or `<router-outlet>`, which the native engine doesn't know.
 */
const KNOWN_LYNX_TAGS = new Set([
  'view', 'text', 'image', 'scroll-view', 'list', 'list-item', 'frame',
  'input', 'textarea', 'overlay', 'svg', 'refresh', 'refresh-header',
  'title-bar-view', 'viewpager', 'viewpager-item', 'scroll-coordinator',
  'scroll-coordinator-header', 'scroll-coordinator-slot',
  'scroll-coordinator-slot-drag', 'scroll-coordinator-toolbar', 'blur-view',
  'webview',
  'video', 'markdown', 'filter-image', 'inline-text', 'inline-image', 'inline-truncation',
  'list-row',
  ...(typeof __NATIVE_ELEMENTS__ !== 'undefined' ? __NATIVE_ELEMENTS__ : []),
]);

/**
 * Use typed PAPI creators for known element types — native Lynx sets up
 * type-specific internals (overflow clipping for views, decoding for images)
 * that the generic `__CreateElement` may skip.
 *
 * For a tag outside `KNOWN_LYNX_TAGS` — a component selector (`<app-card>`) or
 * `<router-outlet>`, never a real Lynx element — fall back to a plain `<view>`
 * instead of `__CreateElement(type, …)`. Confirmed on-device: unlike the web
 * target (`@lynx-js/web-core`'s `__CreateElement` falls back to
 * `document.createElement(anyTagName)`), the native engine throws
 * `LynxCreateUIException: … ui not found when create UI` for a tag it doesn't
 * recognize — there is no generic native fallback to rely on.
 */
function createTypedElement(type: string, parentComponentUniqueId: number): LynxElement {
  switch (type) {
    case 'view':
      return __CreateView(parentComponentUniqueId);
    case 'text':
      return __CreateText(parentComponentUniqueId);
    case 'image':
      return __CreateImage(parentComponentUniqueId);
    case 'scroll-view':
      return __CreateScrollView(parentComponentUniqueId);
    default:
      if (KNOWN_LYNX_TAGS.has(type)) return __CreateElement(type, parentComponentUniqueId);
      return __CreateView(parentComponentUniqueId);
  }
}

// The epoch of the Background-Thread session `applyOps` has committed to for
// this page — `null` until the first batch that carries one. Page-lifetime:
// reset by `resetMainThreadState`.
let currentEpoch: string | null = null;

/**
 * Replay a batch of ops from the Background Thread. `epoch` is the sending
 * session's identity (see flush.ts) — omit it for batches that don't come
 * from a real BG session (the first-screen snapshot replay in
 * `first-screen.ts` applies synthetic ops before the BG thread has booted at
 * all, so it has no epoch to check against).
 *
 * A batch whose epoch differs from the one already committed to is a replay
 * from a *different* BG-thread execution (the bundle's top-level code ran
 * twice within one page lifetime, restarting element ids from 2) — dropped
 * whole, the same as the guard this replaced, but via an explicit identity
 * check instead of inferring it from whether the batch's first op happened to
 * be a colliding `CREATE` (see docs/04-wire-protocol.md).
 *
 * `rawOps` may be a plain flat ops array, or a `[table, internedFlat]` tuple
 * if the sender's batch had repeated string values worth deduping (see
 * `internal/src/ops.ts`'s string table) — `resolveInterned` normalizes either
 * shape to the plain form before anything below reads it.
 */
export function applyOps(rawOps: unknown[], epoch?: string): void {
  const ops = resolveInterned(rawOps);
  const len = ops.length;
  if (len === 0) return;

  if (epoch !== undefined) {
    if (currentEpoch === null) {
      currentEpoch = epoch;
    } else if (epoch !== currentEpoch) {
      return;
    }
  }

  // Ids DESTROYed in this batch — freed from the registry only after the whole
  // batch has applied (see the OP.DESTROY case for why).
  const destroyedThisBatch: number[] = [];

  let i = 0;
  while (i < len) {
    const code = ops[i++] as number;

    switch (code) {
      case OP.CREATE: {
        const id = ops[i++] as number;
        const type = ops[i++] as string;
        let el: LynxElement;
        if (type === '#comment') {
          // Angular view anchor → invisible raw-text placeholder.
          el = __CreateRawText('');
        } else if (type === 'list') {
          // Native virtualized list (created with item callbacks).
          el = createListElement(id);
          if (__ENABLE_SELECTOR_QUERIES__ === true) __SetAttribute(el, `ng-ref-${id}`, 1);
        } else {
          el = createTypedElement(type, pageUniqueId);
          // Associate with CSS scope 0 (global CSS) so class selectors match.
          __SetCSSId([el], 0);
          // Selector attribute for BG-thread selector queries — skippable via
          // `enableSelectorQueries: false` (one fewer native call per
          // element) for an app that provably never calls one, or deferred
          // to first-query time via `'lazy'` (shadow-element.ts emits it as
          // a SET_ATTR op instead — this eager branch only fires for `true`).
          // See its doc in plugin/src/index.ts.
          if (__ENABLE_SELECTOR_QUERIES__ === true) __SetAttribute(el, `ng-ref-${id}`, 1);
        }
        elements.set(id, el);
        break;
      }

      case OP.CREATE_TEXT: {
        const id = ops[i++] as number;
        // Raw text node — must live inside a <text> element to be visible.
        const el = __CreateRawText('');
        elements.set(id, el);
        break;
      }

      case OP.INSERT: {
        const parentId = ops[i++] as number;
        const childId = ops[i++] as number;
        const anchorId = ops[i++] as number;
        const parent = elements.get(parentId);
        const child = elements.get(childId);
        if (parent && child) {
          if (isListParent(parentId)) {
            // List items are collected, not appended — see list-apply.ts.
            insertListItem(parentId, childId, child, anchorId);
          } else if (anchorId === APPEND_ANCHOR) {
            __AppendElement(parent, child);
          } else {
            const anchor = elements.get(anchorId);
            if (anchor) __InsertElementBefore(parent, child, anchor);
            else __AppendElement(parent, child);
          }
          if (parentId === PAGE_ROOT_ID) pageChildren.add(childId);
        }
        break;
      }

      case OP.REMOVE: {
        const parentId = ops[i++] as number;
        const childId = ops[i++] as number;
        if (isListParent(parentId)) {
          // List children are virtualized — removal goes through update-list-info.
          removeListItem(parentId, childId);
          break;
        }
        const parent = elements.get(parentId);
        const child = elements.get(childId);
        if (parent && child) __RemoveElement(parent, child);
        if (parentId === PAGE_ROOT_ID) pageChildren.delete(childId);
        break;
      }

      case OP.SET_ATTR: {
        const id = ops[i++] as number;
        const key = ops[i++] as string;
        const value = ops[i++];
        if (isPlatformInfoAttr(key)) {
          // list-item placement attrs travel via update-list-info, not __SetAttribute.
          setPlatformInfoProp(id, key, value);
        } else {
          const el = elements.get(id);
          if (el) {
            if (key === 'id') __SetID(el, value == null ? undefined : String(value));
            // `event.target.dataset` is built from the dataset model only; a
            // plain attribute named `data-x` never shows up there.
            else if (key.startsWith('data-')) __AddDataset(el, key.slice('data-'.length), value);
            else if (key === 'style') __SetInlineStyles(el, value as string);
            else __SetAttribute(el, key, value);
          }
        }
        break;
      }

      case OP.REMOVE_ATTR: {
        const id = ops[i++] as number;
        const key = ops[i++] as string;
        const el = elements.get(id);
        if (el) {
          if (key.startsWith('data-')) __AddDataset(el, key.slice('data-'.length), undefined);
          // biome-ignore lint/suspicious/noExplicitAny: undefined clears an attribute in PAPI
          else __SetAttribute(el, key, undefined as any);
        }
        break;
      }

      case OP.SET_TEXT: {
        const id = ops[i++] as number;
        const text = ops[i++] as string;
        const el = elements.get(id);
        if (el) __SetAttribute(el, 'text', text);
        break;
      }

      case OP.SET_EVENT: {
        const id = ops[i++] as number;
        const eventType = ops[i++] as string;
        const eventName = ops[i++] as string;
        const sign = ops[i++] as string;
        const el = elements.get(id);
        if (el) __AddEvent(el, eventType, eventName, sign);
        break;
      }

      case OP.REMOVE_EVENT: {
        const id = ops[i++] as number;
        const eventType = ops[i++] as string;
        const eventName = ops[i++] as string;
        const el = elements.get(id);
        if (el) __AddEvent(el, eventType, eventName, undefined);
        break;
      }

      case OP.SET_STYLE: {
        const id = ops[i++] as number;
        const css = ops[i++] as string;
        const el = elements.get(id);
        if (el) __SetInlineStyles(el, css);
        break;
      }

      case OP.SET_CLASS: {
        const id = ops[i++] as number;
        const cls = ops[i++] as string;
        const el = elements.get(id);
        if (el) __SetClasses(el, cls);
        break;
      }

      case OP.SET_WORKLET_EVENT: {
        const id = ops[i++] as number;
        const eventType = ops[i++] as string;
        const eventName = ops[i++] as string;
        const ref = ops[i++] as { _wkltId: string; _bgCallbackId?: string };
        applySetWorkletEvent(id, eventType, eventName, ref);
        break;
      }

      case OP.DESTROY: {
        // A node was destroyed (not moved). Free it from the registry so the map
        // doesn't grow forever. The native element is detached by its root's
        // REMOVE (subtree nodes go with it); here we only drop the reference —
        // and only once the whole batch has applied: Angular's hot-swap path
        // (`ɵɵreplaceMetadata` → `recreateLView`) destroys the old view BEFORE
        // detaching it, so its DESTROY ops precede the root REMOVE in the same
        // batch, and that REMOVE still needs to resolve both ids. Ids are never
        // reused within a session (they're monotonic; a new session is caught
        // by the epoch guard above), so deferring the delete is always safe.
        const id = ops[i++] as number;
        destroyedThisBatch.push(id);
        break;
      }

      case OP.SET_REF: {
        // Bind an element to a main-thread ref so worklets can reach it.
        const id = ops[i++] as number;
        const refId = ops[i++] as string;
        applySetRef(id, refId);
        break;
      }

      case OP.SET_GESTURE_DETECTOR: {
        const id = ops[i++] as number;
        const gestureId = ops[i++] as number;
        const gestureType = ops[i++] as number;
        const config = ops[i++] as Record<string, unknown>;
        const relationMap = ops[i++] as Record<string, unknown>;
        applySetGestureDetector(id, gestureId, gestureType, config, relationMap);
        break;
      }

      default:
        // Unknown op — skip (forward-compatibility).
        break;
    }
  }

  // Free destroyed ids now that every op in the batch has resolved its lookups.
  for (const id of destroyedThisBatch) elements.delete(id);

  // Announce any newly-inserted list items before committing.
  flushListUpdates();

  // Commit the whole batch to the native layer in one shot.
  __FlushElementTree();
}

/** Reset module state — for testing / hot reload. */
/** The page root's direct children, so a reload can clear the page. */
const pageChildren = new Set<number>();

/**
 * Empty the page for `lynx.reload()`: remove every element the app put on the
 * page root and forget them, keeping the page itself. The Background Thread
 * bootstraps the app again and fills it.
 */
export function clearPageForReload(): void {
  const page = elements.get(PAGE_ROOT_ID);
  if (!page) return;
  for (const id of pageChildren) {
    const child = elements.get(id);
    if (child) __RemoveElement(page, child);
  }
  pageChildren.clear();
  elements.clear();
  resetListState();
  currentEpoch = null;
  elements.set(PAGE_ROOT_ID, page);
}

export function resetMainThreadState(): void {
  pageChildren.clear();
  elements.clear();
  setPageUniqueId(1);
  resetListState();
  currentEpoch = null;
  // NOTE: worklet registrations are bundle-lifetime (registered when the MT
  // bundle loads), not page-lifetime — renderPage must NOT clear them.
}
