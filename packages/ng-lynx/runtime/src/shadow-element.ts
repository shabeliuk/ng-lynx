/**
 * ShadowElement: a lightweight doubly-linked tree node that lives entirely on
 * the Background Thread.
 *
 * Angular's `Renderer2` needs synchronous tree navigation (`parentNode`,
 * `nextSibling`) and a stable node identity to attach views to. The real Lynx
 * elements, however, only exist on the Main Thread. ShadowElement is the cheap
 * BG-thread mirror: the renderer manipulates ShadowElements synchronously and
 * records each mutation as an op; the Main Thread later replays those ops onto
 * real elements.
 *
 * Unlike vue-lynx (whose `nodeOps.patchProp` replaces the whole class/style in
 * one shot), Angular's renderer mutates classes and styles **incrementally**
 * via `addClass` / `removeClass` / `setStyle` / `removeStyle`. So ShadowElement
 * owns a `classes` Set and a `styles` record, and the renderer re-serializes the
 * merged result whenever either changes.
 *
 * id=1 is reserved for the page root (created via __CreatePage on the Main
 * Thread). Regular elements start from id=2.
 */
import type { ScrollToPositionParams, UIMethods } from '@lynx-js/types/element';
import { OP, PAGE_ROOT_ID } from 'ng-lynx/internal/ops';

import { addElementListener } from './element-events.js';
import { scheduleFlush, whenFlushed } from './flush.js';
import { pushOp } from './ops.js';

/**
 * `__ENABLE_SELECTOR_QUERIES__` is replaced at build time by the bundler
 * `define` (`enableSelectorQueries` in `plugin/src/index.ts`, default
 * `true`). Declared here so this file type-checks standalone. Only the
 * `'lazy'` mode is read here — `true`/`false` need no Background-Thread
 * behavior change (the attribute is either always or never set natively at
 * `CREATE` time by ops-apply.ts).
 */
declare const __ENABLE_SELECTOR_QUERIES__: boolean | 'lazy';

export type LynxNodeType = 'element' | 'text' | 'comment';

/**
 * DOM event name → Lynx event name, for {@link ShadowElement.addEventListener}.
 * Deliberately partial: Angular's `@defer (on interaction)` / `(on hover)`
 * triggers call `trigger.addEventListener` with a fixed set of DOM event
 * names (`click`/`keydown` for interaction, `mouseenter`/`mouseover`/
 * `focusin` for hover — see `@angular/core`'s compiled `onInteraction`/
 * `onHover`). Lynx is a touchscreen-first UI with no mouse and no generic
 * keyboard-focus model, so most of these have no coherent native
 * equivalent — only `click` maps to anything real: Lynx's own primary
 * interaction gesture, `tap`. The rest resolve to `undefined` and
 * `addEventListener` silently no-ops for them (matching how `keydown`
 * alongside `click` already behaves: `on interaction` fires on tap and
 * `keydown` never contributes, since Lynx has no physical-keyboard event
 * for arbitrary elements either). See docs/24-visibility.md.
 */
const DOM_EVENT_TO_LYNX: Record<string, string | undefined> = {
  click: 'tap',
};

// ---------------------------------------------------------------------------
// Background-thread `lynx` selector-query surface (module-local ambient).
// The real types come from @lynx-js/types; declared minimally here so the
// runtime type-checks standalone without that dependency.
// ---------------------------------------------------------------------------

interface InvokeOptions {
  method: string;
  params?: Record<string, unknown>;
  success?: (res: unknown) => void;
  fail?: (err: unknown) => void;
}

interface NodesRef {
  invoke(options: InvokeOptions): SelectorQuery;
  fields(
    fields: Record<string, boolean>,
    callback: (res: Record<string, unknown> | null) => void,
  ): SelectorQuery;
  setNativeProps(props: Record<string, unknown>): SelectorQuery;
  path(callback: (res: unknown[] | null) => void): SelectorQuery;
}

/**
 * `selectAll`'s `NodesRef` — same methods, but `fields`' callback receives an
 * **array** (one entry per matched element) rather than a single result.
 */
interface NodesRefAll {
  invoke(options: InvokeOptions): SelectorQuery;
  fields(
    fields: Record<string, boolean>,
    callback: (res: Record<string, unknown>[] | null) => void,
  ): SelectorQuery;
  setNativeProps(props: Record<string, unknown>): SelectorQuery;
}

interface SelectorQuery {
  select(selector: string): NodesRef;
  selectAll(selector: string): NodesRefAll;
  selectRoot(): NodesRef;
  selectUniqueID(uniqueId: string | number): NodesRef;
  exec(): void;
}

// eslint-disable-next-line no-var
declare var lynx: { createSelectorQuery(): SelectorQuery } | undefined;

// ---------------------------------------------------------------------------
// Typed `invoke()`: the per-element method map from @lynx-js/types.
// ---------------------------------------------------------------------------

type ListScrollToPosition = Extract<UIMethods['list'], { method: 'scrollToPosition' }>;

/**
 * `@lynx-js/types` gives `<list>`'s `scrollToPosition` an `index` param only,
 * but iOS's light list reads `position` and ignores `index` (LynxUIListLight.mm);
 * the other iOS list reads either. Both are accepted here, and `position` is
 * the one that works on every list.
 */
type LynxListUIMethods =
  | Exclude<UIMethods['list'], { method: 'scrollToPosition' }>
  | (Omit<ListScrollToPosition, 'params'> & {
      params: Omit<ScrollToPositionParams, 'index'> & ({ position: number } | { index: number });
    });

/** `@lynx-js/types`' per-element method map, with the corrections above. */
type LynxUIMethods = Omit<UIMethods, 'list'> & { list: LynxListUIMethods };

/**
 * The elements whose native methods are typed: `'video'`, `'scroll-view'`,
 * `'list'`, `'input'`, `'textarea'`, `'text'`, `'image'`, `'refresh'`,
 * `'viewpager'`, and the rest of `@lynx-js/types`' `UIMethods`. @public
 */
export type LynxUIMethodElement = keyof LynxUIMethods;

/**
 * `invoke()` options for one element type: each method with its own `params`
 * and `success` result, from `@lynx-js/types`. @public
 */
export type LynxInvokeOptions<Tag extends LynxUIMethodElement> = LynxUIMethods[Tag];

/**
 * An element handle whose `invoke()` only accepts `Tag`'s methods. From
 * `asLynxElement<'video'>(ref.nativeElement)`. @public
 */
export type LynxElementHandle<Tag extends LynxUIMethodElement> = Omit<ShadowElement, 'invoke'> & {
  /** Call one of this element's native methods. */
  invoke(options: LynxInvokeOptions<Tag>): void;
};

// ---------------------------------------------------------------------------
// Global event-target sentinels.
//
// Angular's template `(window:x)` / `(document:x)` / `(body:x)` bindings compile
// to resolvers that read `el.ownerDocument`, `el.ownerDocument.defaultView`, and
// `el.ownerDocument.body`. Off the DOM those reads would crash, so
// `ShadowElement.ownerDocument` returns these markers; the renderer recognizes
// them (by identity — see `isGlobalTarget`) and routes the listener to Lynx's
// app-level GlobalEventEmitter. Lynx has a single global scope, so all three map
// to it.
// ---------------------------------------------------------------------------

export const GLOBAL_BODY = { __lynxGlobalTarget: 'body' as const };
export const GLOBAL_WINDOW = { __lynxGlobalTarget: 'window' as const };
export const GLOBAL_DOCUMENT = {
  __lynxGlobalTarget: 'document' as const,
  defaultView: GLOBAL_WINDOW,
  body: GLOBAL_BODY,
  head: null,
};

/** True if `t` is a global event target (sentinel object or legacy string). */
export function isGlobalTarget(t: unknown): boolean {
  return (
    t === GLOBAL_WINDOW
    || t === GLOBAL_DOCUMENT
    || t === GLOBAL_BODY
    || t === 'window'
    || t === 'document'
    || t === 'body'
  );
}

export class ShadowElement {
  static nextId = 2; // 1 is reserved for the page root

  readonly id: number;
  /** Lynx tag name ('view', 'text', 'image', …) or '#text' / '#comment'. */
  readonly type: string;
  readonly kind: LynxNodeType;

  parent: ShadowElement | null = null;
  firstChild: ShadowElement | null = null;
  lastChild: ShadowElement | null = null;
  prev: ShadowElement | null = null;
  next: ShadowElement | null = null;

  /** Accumulated class names (Angular adds/removes them one at a time). */
  readonly classes = new Set<string>();
  /** Accumulated inline styles (Angular sets/removes them one at a time). */
  readonly styles: Record<string, string> = {};

  /** The element's `style` attribute, as written; `styles` is layered on top. */
  staticStyle: string | undefined = undefined;

  /** The text of the last `input` event on this field; see `setProperty`. */
  lastInputValue: string | undefined = undefined;

  /** Optional `id` attribute, used by selector-query lookups. */
  domId: string | undefined = undefined;

  /**
   * `enableSelectorQueries: 'lazy'` only: whether the `ng-ref-{id}` attribute
   * has already been requested for this element (native ids are never
   * reused within a session, so this never needs to be reset).
   */
  private _refAttrRequested = false;

  /** Lazily created: `addEventListener`/`removeEventListener` bookkeeping. */
  private _domListeners?: Map<string, Map<(event: unknown) => void, () => void>>;

  constructor(type: string, kind: LynxNodeType, forceId?: number) {
    this.id = forceId ?? ShadowElement.nextId++;
    this.type = type;
    this.kind = kind;
  }

  /**
   * Angular core reads `.tagName` directly on the host element (e.g. in
   * `locateHostElement`), so expose it. Mirrors the DOM element property.
   */
  get tagName(): string {
    return this.type;
  }

  /** CSS attribute selector that uniquely identifies this element on the MT. */
  get selector(): string {
    return `[ng-ref-${this.id}]`;
  }

  /**
   * An `#id` selector for this element, giving it an `id` first if it has
   * none. Resolves once the Main Thread has applied it.
   *
   * Lynx's IntersectionObserver finds its target **by id only**: "the target
   * node is specified according to `id`" (Lynx's `observe()` reference), and
   * `@lynx-js/web-core`'s implementation resolves `#id` (or a numeric element
   * id) and returns nothing for any other selector. So {@link selector}'s
   * attribute form, which `createSelectorQuery` handles, observes nothing
   * there: `@defer (on viewport)` stayed on its placeholder in the web
   * preview even after web-core 0.25 added the observer. An id the app set
   * itself is reused.
   */
  idSelector(): Promise<string> {
    if (!this.domId) {
      this.domId = `ng-io-${this.id}`;
      pushOp(OP.SET_ATTR, this.id, 'id', this.domId);
      scheduleFlush();
    }
    return whenFlushed().then(() => `#${this.domId}`);
  }

  /**
   * Angular's `(window:)`/`(document:)`/`(body:)` target resolvers read
   * `ownerDocument` (and its `defaultView` / `body`). Return the global-target
   * sentinel so they resolve to something the renderer maps to Lynx's
   * GlobalEventEmitter, instead of crashing on `undefined` off the DOM.
   */
  get ownerDocument(): typeof GLOBAL_DOCUMENT {
    return GLOBAL_DOCUMENT;
  }

  // -------------------------------------------------------------------------
  // Imperative element access (Lynx NodesRef).
  //
  // `ElementRef.nativeElement` is a ShadowElement, so a template ref / viewChild
  // gives you these directly (cast via `asLynxElement` for typing). Each targets
  // this element by its unique `[ng-ref-{id}]` attribute, set on the Main Thread
  // when the element is created. Results arrive asynchronously via callbacks.
  // -------------------------------------------------------------------------

  /**
   * `enableSelectorQueries: 'lazy'` only: on an element's first query, emit
   * the `ng-ref-{id}` attribute as an ordinary `SET_ATTR` op instead of the
   * native call ops-apply.ts's `CREATE` handler makes eagerly in `true`
   * mode, and defer `run` (the real `createSelectorQuery()` call — a
   * separate, synchronous-firing channel from the buffered ops/flush
   * pipeline, so ordering isn't automatic) until `whenFlushed()` confirms the
   * Main Thread has actually applied that op. `whenFlushed()`'s ack fires
   * only once `ops-apply.ts`'s `applyOps` has run the whole batch to
   * completion (see flush.ts), so by the time `run` executes here, the
   * attribute is guaranteed already set — provably, not by timing luck.
   * Subsequent queries on the same element skip straight to `run()`, so
   * repeated queries (e.g. per-frame `setNativeProps`) only ever pay this
   * once. In `true`/`false` mode this is a passthrough to `run()`.
   */
  private runQuery(run: () => void): void {
    if (__ENABLE_SELECTOR_QUERIES__ === 'lazy' && !this._refAttrRequested) {
      this._refAttrRequested = true;
      pushOp(OP.SET_ATTR, this.id, `ng-ref-${this.id}`, 1);
      scheduleFlush();
      whenFlushed().then(run);
      return;
    }
    run();
  }

  /** Read layout/info fields (e.g. `{ size: true, rect: true }`). */
  fields(
    fields: Record<string, boolean>,
    callback: (res: Record<string, unknown> | null) => void,
  ): void {
    this.runQuery(() => {
      lynx?.createSelectorQuery().select(this.selector).fields(fields, callback).exec();
    });
  }

  /** Call a native UI method on this element (e.g. `scrollIntoView`, `focus`). */
  invoke(options: {
    method: string;
    params?: Record<string, unknown>;
    success?: (res: unknown) => void;
    fail?: (err: unknown) => void;
  }): void {
    this.runQuery(() => {
      lynx?.createSelectorQuery().select(this.selector).invoke(options).exec();
    });
  }

  /** Imperatively set native props without a re-render (e.g. fast scroll sync). */
  setNativeProps(props: Record<string, unknown>): void {
    this.runQuery(() => {
      lynx?.createSelectorQuery().select(this.selector).setNativeProps(props).exec();
    });
  }

  /** Query the path from this element up to the page root. */
  path(callback: (res: unknown[] | null) => void): void {
    this.runQuery(() => {
      lynx?.createSelectorQuery().select(this.selector).path(callback).exec();
    });
  }

  // -------------------------------------------------------------------------
  // DOM-`EventTarget`-shaped listener API.
  //
  // Angular's `@defer (on interaction)` calls this directly on the trigger
  // node (no `Renderer2` indirection — see `visibility.ts`'s module doc and
  // docs/24-visibility.md). Only DOM event names with a real Lynx equivalent
  // (currently just `click` → `tap`) actually register anything; the rest
  // are a harmless no-op. `options` (Angular passes `{ passive: true, capture:
  // true }`) is accepted for signature compatibility and ignored — Lynx has
  // no capture-phase concept at this level.
  // -------------------------------------------------------------------------

  addEventListener(type: string, listener: (event: unknown) => void, _options?: unknown): void {
    const lynxName = DOM_EVENT_TO_LYNX[type];
    if (!lynxName) return;
    const byType = (this._domListeners ??= new Map());
    let byListener = byType.get(type);
    if (!byListener) {
      byListener = new Map();
      byType.set(type, byListener);
    }
    if (byListener.has(listener)) return; // already registered
    byListener.set(listener, addElementListener(this, 'bindEvent', lynxName, listener));
  }

  removeEventListener(type: string, listener: (event: unknown) => void, _options?: unknown): void {
    const dispose = this._domListeners?.get(type)?.get(listener);
    if (!dispose) return;
    dispose();
    this._domListeners!.get(type)!.delete(listener);
  }

  insertBefore(child: ShadowElement, anchor: ShadowElement | null): void {
    // Detach from current parent first (Angular may move nodes).
    if (child.parent) {
      child.parent.removeChild(child);
    }
    child.parent = this;

    if (anchor) {
      const prev = anchor.prev;
      child.next = anchor;
      child.prev = prev;
      anchor.prev = child;
      if (prev) {
        prev.next = child;
      } else {
        this.firstChild = child;
      }
    } else {
      // Append at the end.
      if (this.lastChild) {
        this.lastChild.next = child;
        child.prev = this.lastChild;
      } else {
        this.firstChild = child;
        child.prev = null;
      }
      this.lastChild = child;
      child.next = null;
    }
  }

  removeChild(child: ShadowElement): void {
    const prev = child.prev;
    const next = child.next;
    if (prev) {
      prev.next = next;
    } else {
      this.firstChild = next;
    }
    if (next) {
      next.prev = prev;
    } else {
      this.lastChild = prev;
    }
    child.parent = null;
    child.prev = null;
    child.next = null;
  }

  /** Serialize the merged class set into a single space-joined string. */
  classString(): string {
    return Array.from(this.classes).join(' ');
  }
}

// ---------------------------------------------------------------------------
// Tree-wide multi-element query — `lynxSelectAll`.
//
// `ShadowElement`'s methods above are element-scoped (each targets one element
// by its `[ng-ref-{id}]`). `lynxSelectAll` is the multi-element counterpart:
// it resolves an arbitrary CSS selector against the *whole* Main-Thread tree
// and applies `fields`/`invoke`/`setNativeProps` to every match — Lynx's
// native `selectorQuery.selectAll(...)`. The `fields` callback receives an
// **array** (one entry per matched element), so you can batch-measure e.g.
// every `.item` in one round-trip instead of one query per element.
//
// Class/tag selectors work on the native engine when `enableCSSSelector` is on
// (the examples set it); results still arrive asynchronously via callback.
// ---------------------------------------------------------------------------

/**
 * A tree-wide multi-element query returned by {@link lynxSelectAll}.
 * @public
 */
export interface LynxNodesQueryAll {
  /**
   * Read layout/info fields for **every** matched element. The callback gets an
   * array (one result per match), or `null` if the query couldn't run.
   */
  fields(
    fields: Record<string, boolean>,
    callback: (results: Record<string, unknown>[] | null) => void,
  ): void;
  /** Call a native UI method on every matched element. */
  invoke(options: InvokeOptions): void;
  /** Imperatively set native props on every matched element without a re-render. */
  setNativeProps(props: Record<string, unknown>): void;
}

/**
 * Query **all** elements matching `selector` across the Main-Thread tree, for
 * batch reads/writes — the multi-element counterpart to `ShadowElement`'s own
 * (single-element) `fields`/`invoke`/`setNativeProps`. See
 * docs/10-element-queries.md.
 *
 * ```ts
 * lynxSelectAll('.item').fields({ size: true }, (rects) => {
 *   // rects: one { width, height, … } per matched `.item`
 * });
 * ```
 *
 * @public
 */
export function lynxSelectAll(selector: string): LynxNodesQueryAll {
  return {
    fields(fields, callback): void {
      lynx?.createSelectorQuery().selectAll(selector).fields(fields, callback).exec();
    },
    invoke(options): void {
      lynx?.createSelectorQuery().selectAll(selector).invoke(options).exec();
    },
    setNativeProps(props): void {
      lynx?.createSelectorQuery().selectAll(selector).setNativeProps(props).exec();
    },
  };
}

// ---------------------------------------------------------------------------
// Single-node queries not tied to an Angular element — `lynxSelectRoot`,
// `lynxSelectUniqueID`.
// ---------------------------------------------------------------------------

/**
 * A query on one node, returned by {@link lynxSelectRoot} and
 * {@link lynxSelectUniqueID}. Results arrive asynchronously via callback.
 * @public
 */
export interface LynxNodesQuery {
  /** Read layout/info fields. The callback gets `null` if the query couldn't run. */
  fields(
    fields: Record<string, boolean>,
    callback: (result: Record<string, unknown> | null) => void,
  ): void;
  /** Call a native UI method on the node. */
  invoke(options: InvokeOptions): void;
  /** Set native props on the node without a re-render. */
  setNativeProps(props: Record<string, unknown>): void;
  /** The node's path from the page root. */
  path(callback: (result: unknown[] | null) => void): void;
}

function nodesQuery(select: (query: SelectorQuery) => NodesRef): LynxNodesQuery {
  return {
    fields(fields, callback): void {
      const query = lynx?.createSelectorQuery();
      if (query) select(query).fields(fields, callback).exec();
    },
    invoke(options): void {
      const query = lynx?.createSelectorQuery();
      if (query) select(query).invoke(options).exec();
    },
    setNativeProps(props): void {
      const query = lynx?.createSelectorQuery();
      if (query) select(query).setNativeProps(props).exec();
    },
    path(callback): void {
      const query = lynx?.createSelectorQuery();
      if (query) select(query).path(callback).exec();
    },
  };
}

/**
 * The page's root element (`<page>`), for page-wide effects:
 *
 * ```ts
 * lynxSelectRoot().setNativeProps({ filter: 'grayscale(100%)' });
 * ```
 *
 * Lynx's `selectorQuery.selectRoot()`. @public
 */
export function lynxSelectRoot(): LynxNodesQuery {
  return nodesQuery((query) => query.selectRoot());
}

/**
 * The element with Lynx's own unique id: the `uid` an event carries on
 * `event.target.uid`. Useful when a handler on a parent needs the exact child
 * that was touched:
 *
 * ```ts
 * onTap(event: LynxTouchEvent) {
 *   lynxSelectUniqueID(event.target.uid).setNativeProps({ 'background-color': 'red' });
 * }
 * ```
 *
 * Lynx's `selectorQuery.selectUniqueID()`. @public
 */
export function lynxSelectUniqueID(uid: string | number): LynxNodesQuery {
  return nodesQuery((query) => query.selectUniqueID(uid));
}

// ---------------------------------------------------------------------------
// Page root (id=1)
// ---------------------------------------------------------------------------

let _pageRoot: ShadowElement | null = null;

/**
 * The singleton page-root ShadowElement (id=1).
 *
 * The corresponding real element is created on the Main Thread by
 * `__CreatePage` inside `renderPage`, so the renderer never emits a CREATE op
 * for it — it only ever inserts children into it.
 */
export function getPageRoot(): ShadowElement {
  if (!_pageRoot) {
    _pageRoot = new ShadowElement('page', 'element', PAGE_ROOT_ID);
  }
  return _pageRoot;
}

/** Reset module state — for testing only. */
export function resetShadowTreeState(): void {
  _pageRoot = null;
  ShadowElement.nextId = 2;
}
