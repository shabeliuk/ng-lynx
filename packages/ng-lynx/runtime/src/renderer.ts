/**
 * LynxRenderer2 — the custom Angular renderer that targets Lynx.
 *
 * This is the Angular analog of vue-lynx's `node-ops.ts`. Angular components
 * never touch the platform directly; every DOM-ish operation they perform goes
 * through `Renderer2`. `@angular/platform-browser` ships one implementation
 * (`DomRenderer`) that mutates the real DOM. We ship another that:
 *
 *   1. mirrors the tree as cheap {@link ShadowElement}s on the Background Thread,
 *      and
 *   2. records every mutation as a flat op (see `internal/ops.ts`) to be
 *      replayed against real Lynx elements on the Main Thread.
 *
 * Because all rendering funnels through this one abstraction, the same Angular
 * component code that runs in a browser runs on Lynx unchanged.
 */
import {
  Injectable,
  Renderer2,
  RendererFactory2,
  type RendererStyleFlags2,
  type RendererType2,
} from '@angular/core';

import { APPEND_ANCHOR, OP } from 'ng-lynx/internal/ops';

import { addElementListener, type LynxEventRegType } from './element-events.js';
import { flushOps, scheduleFlush, whenFlushed } from './flush.js';
import { writeInputValue } from './input-value.js';
import { pushOp } from './ops.js';
import {
  clearPendingStyleClass,
  markClassDirty,
  markStyleDirty,
} from './pending-style.js';
import { getPageRoot, isGlobalTarget, ShadowElement } from './shadow-element.js';

// ---------------------------------------------------------------------------
// Event prop classification
// ---------------------------------------------------------------------------

interface EventSpec {
  /** Lynx event registration type. */
  type: LynxEventRegType;
  /** Lynx event name, e.g. 'tap', 'touchstart', 'scroll'. */
  name: string;
  /** `.self` modifier — only fire when the event originated on this element. */
  self: boolean;
}

/**
 * Map an Angular `(eventName)` binding to a Lynx event registration.
 *
 * Conventions (Lynx's documented prefixes; the registration type strings are
 * the ones the engine dispatches on in `core/renderer/events`):
 *   (tap)            → bindEvent        'tap'  (default: bubbling)
 *   (bindtap)        → bindEvent        'tap'  (explicit)
 *   (catchtap)       → catchEvent       'tap'  (stops native bubbling)
 *   (capture-bindx)  → capture-bind     'x'    (capture phase)
 *   (capture-catchx) → capture-catch    'x'    (capture phase, stops propagation)
 *   (global-bindx)   → global-bindEvent 'x'    (fires wherever the event happens)
 *   (tap.self)       → bindEvent        'tap', only when target === currentTarget
 */
function parseEvent(rawName: string): EventSpec {
  let name = rawName;
  let self = false;
  if (name.endsWith('.self')) {
    self = true;
    name = name.slice(0, -'.self'.length);
  }
  if (name.startsWith('global-bind')) {
    return { type: 'global-bindEvent', name: name.slice('global-bind'.length), self };
  }
  if (name.startsWith('capture-bind')) {
    return { type: 'capture-bind', name: name.slice('capture-bind'.length), self };
  }
  if (name.startsWith('capture-catch')) {
    return { type: 'capture-catch', name: name.slice('capture-catch'.length), self };
  }
  if (name.startsWith('catch')) {
    return { type: 'catchEvent', name: name.slice('catch'.length), self };
  }
  if (name.startsWith('bind')) {
    return { type: 'bindEvent', name: name.slice('bind'.length), self };
  }
  return { type: 'bindEvent', name, self };
}

/**
 * `.self` test: did the event originate on the bound element rather than bubble
 * from a descendant? Compares the Lynx event's `target` / `currentTarget` by
 * their native `uid`. Fails open (fires) if the shape is unavailable.
 */
function isSelfEvent(event: unknown): boolean {
  if (event === null || typeof event !== 'object') return true;
  const e = event as { target?: { uid?: unknown }; currentTarget?: { uid?: unknown } };
  const t = e.target;
  const ct = e.currentTarget;
  if (!t || !ct) return true;
  if (t.uid != null && ct.uid != null) return t.uid === ct.uid;
  return t === ct;
}

/**
 * Whether `node`, as a child of `parent`, exists on the Main Thread: comment
 * anchors never do, and under a `<list>` only elements do.
 */
function isSentTo(parent: ShadowElement, node: ShadowElement): boolean {
  if (node.kind === 'comment') return false;
  return parent.type !== 'list' || node.kind === 'element';
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * A single shared renderer instance backs every component. Lynx has one element
 * tree and one ops stream, so there is no per-component renderer state to
 * isolate (style encapsulation is handled at build/CSS time — see the roadmap).
 */
class LynxRenderer2 extends Renderer2 {
  // `Renderer2.data` is an abstract getter, so implement it as one (a property
  // field would trigger TS2611).
  private readonly _data: { [key: string]: unknown } = Object.create(null);
  override get data(): { [key: string]: unknown } {
    return this._data;
  }

  override destroy(): void {
    // No per-renderer resources to release; the shadow tree and registries are
    // module-global and torn down on app unmount.
  }

  // Angular calls `destroyNode` for every node of a view being destroyed (a
  // distinct pass from move/remove — see core's `applyView` action 3), so it is
  // the safe hook to free the element from the Main Thread's registry. Without
  // it the MT `elements` map grows forever as `@if`/`@for` content churns
  // (`removeChild` can't be used — it also fires for moves). Event listeners are
  // freed separately by Angular calling the `unlisten` returns from `listen()`.
  //
  // Declared as a field (not a method): `Renderer2` ships `destroyNode = null` as
  // an instance field, so a prototype method would be shadowed by that `null`
  // after `super()` — Angular would then see `null` and skip the hook.
  //
  // Angular only calls this for a view's *root* node(s) (it relies on the DOM to
  // cascade removal to descendants), so walk the shadow subtree and free every
  // node. DESTROY is idempotent on the Main Thread, so re-visiting a node (if
  // Angular also descends) is harmless.
  override destroyNode = (node: ShadowElement): void => {
    const stack: ShadowElement[] = [node];
    while (stack.length > 0) {
      const n = stack.pop() as ShadowElement;
      // Drop any pending style/class serialization for this node so the flush
      // doesn't emit a set op targeting a Main-Thread element we're freeing.
      clearPendingStyleClass(n);
      // Comment anchors never reached the Main Thread (see createComment).
      if (n.kind !== 'comment') pushOp(OP.DESTROY, n.id);
      for (let c = n.firstChild; c; c = c.next) stack.push(c);
    }
    scheduleFlush();
  };

  override createElement(name: string, _namespace?: string | null): ShadowElement {
    const el = new ShadowElement(name, 'element');
    pushOp(OP.CREATE, el.id, name);
    scheduleFlush();
    return el;
  }

  override createComment(_value: string): ShadowElement {
    // Angular uses comment nodes as view anchors (`@if`, `@for`, `@switch`,
    // `<ng-container>`, `<ng-template>` boundaries). They live only in the
    // shadow tree, where Angular navigates them; the Main Thread never sees
    // them. An insert anchored on one is resolved forward to the next sibling
    // that the Main Thread has (emitInsert). Before 1.0.0 every anchor
    // was a native raw-text node: one element and two native calls each.
    return new ShadowElement('#comment', 'comment');
  }

  override createText(value: string): ShadowElement {
    const el = new ShadowElement('#text', 'text');
    pushOp(OP.CREATE_TEXT, el.id);
    if (value) pushOp(OP.SET_TEXT, el.id, value);
    scheduleFlush();
    return el;
  }

  override appendChild(parent: ShadowElement, newChild: ShadowElement): void {
    this.emitInsert(parent, newChild, null);
  }

  override insertBefore(
    parent: ShadowElement,
    newChild: ShadowElement,
    refChild: ShadowElement | null,
    _isMove?: boolean,
  ): void {
    if (!parent) return;
    this.emitInsert(parent, newChild, refChild ?? null);
  }

  /**
   * Shared insert path. The shadow tree is always updated (Angular relies on it
   * for navigation), but what we send to the Main Thread depends on the parent:
   *
   * Comment anchors are never sent (see createComment), so an insert
   * anchored on one is resolved forward to the next sibling that was sent. The
   * shadow tree's order is the Main Thread's order minus those nodes, so that
   * sibling is already in place there, and `null` (append) is right when
   * nothing follows.
   *
   * Lynx's native `<list>` only accepts real `<list-item>` element children,
   * so under a `<list>` text nodes are skipped too, both as children and as
   * anchors.
   */
  private emitInsert(
    parent: ShadowElement,
    child: ShadowElement,
    anchor: ShadowElement | null,
  ): void {
    parent.insertBefore(child, anchor);

    if (!isSentTo(parent, child)) return;

    let resolved = anchor;
    while (resolved && !isSentTo(parent, resolved)) resolved = resolved.next;

    pushOp(OP.INSERT, parent.id, child.id, resolved ? resolved.id : APPEND_ANCHOR);
    scheduleFlush();
  }

  override removeChild(
    parent: ShadowElement | null,
    oldChild: ShadowElement,
    _isHostElement?: boolean,
  ): void {
    const realParent = parent ?? oldChild.parent;
    if (!realParent) return;
    const parentId = realParent.id;
    realParent.removeChild(oldChild);
    // Nodes that were never sent to the Main Thread get no REMOVE either.
    if (!isSentTo(realParent, oldChild)) return;
    pushOp(OP.REMOVE, parentId, oldChild.id);
    scheduleFlush();
  }

  override selectRootElement(
    selectorOrNode: string | ShadowElement,
    _preserveContent?: boolean,
  ): ShadowElement {
    // Lynx has a single page root. Whether Angular hands us the root component's
    // selector string or an explicit node, we always anchor to the page root
    // (id=1), created on the Main Thread by __CreatePage.
    if (typeof selectorOrNode !== 'string') return selectorOrNode;
    return getPageRoot();
  }

  override parentNode(node: ShadowElement): ShadowElement | null {
    return node.parent;
  }

  override nextSibling(node: ShadowElement): ShadowElement | null {
    return node.next;
  }

  override setAttribute(
    el: ShadowElement,
    name: string,
    value: string,
    _namespace?: string | null,
  ): void {
    if (name === 'class') {
      el.classes.clear();
      for (const cls of value.split(/\s+/)) {
        if (cls) el.classes.add(cls);
      }
      markClassDirty(el);
    } else if (name === 'style') {
      // Kept beside the `[style.x]` bindings and serialized with them: Lynx has
      // one inline-style slot per element, so sending this on its own would be
      // overwritten by the next `setStyle`.
      el.staticStyle = value;
      markStyleDirty(el);
    } else {
      if (name === 'id') el.domId = value;
      pushOp(OP.SET_ATTR, el.id, name, value);
    }
    scheduleFlush();
  }

  override removeAttribute(
    el: ShadowElement,
    name: string,
    _namespace?: string | null,
  ): void {
    if (name === 'style') {
      el.staticStyle = undefined;
      markStyleDirty(el);
    } else {
      if (name === 'id') el.domId = undefined;
      pushOp(OP.REMOVE_ATTR, el.id, name);
    }
    scheduleFlush();
  }

  override addClass(el: ShadowElement, name: string): void {
    el.classes.add(name);
    markClassDirty(el);
    scheduleFlush();
  }

  override removeClass(el: ShadowElement, name: string): void {
    el.classes.delete(name);
    markClassDirty(el);
    scheduleFlush();
  }

  override setStyle(
    el: ShadowElement,
    style: string,
    value: string,
    _flags?: RendererStyleFlags2,
  ): void {
    el.styles[style] = value == null ? '' : String(value);
    markStyleDirty(el);
    scheduleFlush();
  }

  override removeStyle(
    el: ShadowElement,
    style: string,
    _flags?: RendererStyleFlags2,
  ): void {
    delete el.styles[style];
    markStyleDirty(el);
    scheduleFlush();
  }

  override setProperty(el: ShadowElement, name: string, value: unknown): void {
    // Angular `[prop]="..."` bindings. Lynx exposes element configuration via
    // attributes, so property bindings are forwarded as SET_ATTR. `id`, `style`
    // and `className` hold state on the shadow element, so they take the same
    // path as their attribute forms. (The typed directives' `[id]` lands here.)
    if (name === 'id' || name === 'style') {
      if (value == null) this.removeAttribute(el, name);
      else this.setAttribute(el, name, String(value));
      return;
    }
    if (name === 'className') {
      this.setAttribute(el, 'class', value == null ? '' : String(value));
      return;
    }
    // The native text fields have no `value` attribute (see input-value.ts).
    // `lastInputValue` is the echo of the user's own typing: writing that back
    // would only move their cursor.
    if (name === 'value' && (el.type === 'input' || el.type === 'textarea')) {
      const next = value == null ? '' : String(value);
      if (next !== el.lastInputValue) writeInputValue(el, next);
      el.lastInputValue = undefined;
    }
    pushOp(OP.SET_ATTR, el.id, name, value);
    scheduleFlush();
  }

  override setValue(node: ShadowElement, value: string): void {
    // Text-node content update (interpolation change). Dev-mode Angular also
    // writes `bindings={…}` into structural-directive comments; those have no
    // Main-Thread node.
    if (node.kind === 'comment') return;
    pushOp(OP.SET_TEXT, node.id, value);
    scheduleFlush();
  }

  override listen(
    target: 'window' | 'document' | 'body' | ShadowElement,
    eventName: string,
    callback: (event: unknown) => boolean | void,
  ): () => void {
    if (isGlobalTarget(target)) {
      // `(window:x)` / `(document:x)` / `(body:x)` → Lynx's app-level
      // GlobalEventEmitter (Background-Thread, no Main-Thread round-trip). Lynx
      // has a single global scope, so all three targets map to it. Used to
      // receive custom events that native (or other BG code) emits via
      // `lynx.getJSModule('GlobalEventEmitter').emit(name, …)`.
      const emitter =
        typeof lynx !== 'undefined' ? lynx?.getJSModule?.('GlobalEventEmitter') : undefined;
      if (!emitter) {
        if (__DEV__) {
          console.warn(
            `[ng-lynx] No GlobalEventEmitter available; the global "${eventName}" `
              + `listener will not fire.`,
          );
        }
        return () => {};
      }
      const listener = (...args: unknown[]): void => {
        callback(args.length > 1 ? args : args[0]);
      };
      emitter.addListener(eventName, listener);
      return () => emitter.removeListener(eventName, listener);
    }

    const el = target as ShadowElement;
    const spec = parseEvent(eventName);
    // `(tap)` and `(tap.self)` resolve to the same Lynx event (type + name)
    // and so share one native listener via `addElementListener` — keyed by
    // the resolved event, not the raw binding — with the `.self` filter
    // applied per callback below. `(tap)` and `(catchtap)` stay separate here,
    // but the engine keeps one handler per name, so on one element the last
    // one registered wins (docs/12-events.md).
    const cb = spec.self
      ? (data: unknown): void => {
          if (isSelfEvent(data)) callback(data);
        }
      : (data: unknown): void => {
          callback(data);
        };
    return addElementListener(el, spec.type, spec.name, cb);
  }
}

/**
 * Produces {@link LynxRenderer2} instances for Angular's rendering machinery and
 * drives the ops flush at the end of every change-detection cycle.
 */
@Injectable()
export class LynxRendererFactory2 extends RendererFactory2 {
  private readonly renderer = new LynxRenderer2();

  override createRenderer(
    _hostElement: unknown,
    type: RendererType2 | null,
  ): Renderer2 {
    if (__DEV__ && type && type.styles && type.styles.length > 0) {
      // Component `styles` / `styleUrls` can't reach Lynx's CSS engine: Lynx
      // compiles CSS at build time (no runtime rule injection) and the AOT
      // compiler reads component sources from disk, so there's no hook to extract
      // them. Put styles in a `.css` file imported into the build instead.
      console.warn(
        '[ng-lynx] Component `styles`/`styleUrls` are ignored on Lynx. '
          + "Move them to a CSS file (e.g. `import './app.css'`) — see "
          + 'docs/13-styling.md.',
      );
    }
    return this.renderer;
  }

  /** Called by Angular before each change-detection pass. */
  override begin(): void {
    // Nothing to set up — ops accumulate lazily as the renderer is called.
  }

  /** Called by Angular after each change-detection pass — flush ops now. */
  override end(): void {
    flushOps();
  }

  override whenRenderingDone(): Promise<unknown> {
    return whenFlushed();
  }
}

/**
 * `__DEV__` is replaced at build time by the bundler `define`. Declared here so
 * the source type-checks standalone.
 */
declare const __DEV__: boolean;

// `lynx` is injected by the Lynx bundle wrapper (not on globalThis). Declared
// module-scoped (matching flush.ts) so it doesn't clash with the main-thread
// `lynx` ambient. Here we only need the GlobalEventEmitter for global events.
// eslint-disable-next-line no-var
declare var lynx:
  | {
      getJSModule(
        name: string,
      ):
        | {
            addListener(eventName: string, listener: (...args: unknown[]) => void, context?: object): void;
            removeListener(eventName: string, listener: (...args: unknown[]) => void): void;
          }
        | null
        | undefined;
    }
  | null
  | undefined;
