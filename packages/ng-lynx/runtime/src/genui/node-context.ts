// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * Runtime context handed to every rendered A2UI catalog component.
 *
 * In the ReactLynx renderer, catalog components receive
 * `GenericComponentProps` as a prop spread (`id`, `surface`, `setValue`,
 * `sendAction`, `dataContextPath`, plus the resolved protocol props). Angular
 * components can't take a dynamic prop bag, so the same contract arrives via
 * DI instead: the node renderer provides one `A2uiNodeContext` per component
 * instance, and catalog components read resolved props from the `props()`
 * signal — which updates whenever a bound data-model signal changes, driving
 * zoneless change detection naturally.
 */
import type { Signal, Type } from '@angular/core';
import { InjectionToken } from '@angular/core';

import type { MessageProcessor, Surface } from '@lynx-js/genui/a2ui/store';

import type { A2uiFunctionEntry } from './catalog.js';
import type { A2uiChecksOutcome } from './checks.js';

/**
 * Context injected by A2UI catalog components.
 *
 * @experimental
 */
export interface A2uiNodeContext {
  /** Protocol component instance id. */
  readonly id: string;
  /** The surface this node belongs to. */
  readonly surface: Surface;
  /** Data context for relative bindings (templated lists). */
  readonly dataContextPath: string | undefined;
  /**
   * Resolved protocol props (bindings → current values). Reactive. `action`,
   * `@checks` and `@metadata` stay as sent; `@accessibility` is resolved
   * (apply it with the `a2uiA11y` directive).
   */
  readonly props: Signal<Record<string, unknown>>;
  /**
   * The outcome of the component's `@checks`, re-evaluated when the data the
   * conditions read changes. `{ ok: true }` when it has none.
   */
  readonly checks: Signal<A2uiChecksOutcome>;
  /** Prop names whose dynamic syntax this renderer does not support. */
  readonly unsupportedFields: Signal<string[]>;
  /**
   * Write a value back through the prop's `@path` binding (e.g. a TextField
   * writing `value`). No-op when the prop is not a plain binding.
   */
  setValue(key: string, value: unknown): void;
  /**
   * Run an A2UI action: `{ event: { name, context?, userMessage? } }` is sent
   * to the agent as a v1.0 `action` message once its dynamic values resolve;
   * `{ functionCall }` runs the function as a user-activated call. Settles
   * when the transport (or the function) does. It never rejects: a failure
   * is reported to the agent, logged, and resolves `undefined`.
   */
  sendAction(action: Record<string, unknown>): Promise<unknown>;
}

/** @experimental */
export const A2UI_NODE_CONTEXT = new InjectionToken<A2uiNodeContext>('A2UI_NODE_CONTEXT');

/**
 * Surface-level context shared by all nodes under one `A2uiSurface`.
 *
 * @experimental
 */
export interface A2uiSurfaceContext {
  /** The surface's own catalog's components (the one it registered). */
  readonly componentsByName: ReadonlyMap<string, Type<unknown>>;
  /** The surface's own catalog's functions. */
  readonly functions: readonly A2uiFunctionEntry[];
  readonly processor: MessageProcessor;
}

/** @experimental */
export const A2UI_SURFACE_CONTEXT = new InjectionToken<A2uiSurfaceContext>('A2UI_SURFACE_CONTEXT');
