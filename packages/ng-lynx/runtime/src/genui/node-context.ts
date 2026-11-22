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
  /** Resolved protocol props (bindings → current values). Reactive. */
  readonly props: Signal<Record<string, unknown>>;
  /** Prop names whose dynamic syntax this renderer does not support. */
  readonly unsupportedFields: Signal<string[]>;
  /**
   * Write a value back through the prop's data binding (e.g. a TextField
   * writing `value`). No-op when the prop is not a plain binding.
   */
  setValue(key: string, value: unknown): void;
  /** Dispatch an A2UI action (`{ event: ... }` or `{ functionCall: ... }`). */
  sendAction(action: Record<string, unknown>): void;
}

/** @experimental */
export const A2UI_NODE_CONTEXT = new InjectionToken<A2uiNodeContext>('A2UI_NODE_CONTEXT');

/**
 * Surface-level context shared by all nodes under one `A2uiSurface`.
 *
 * @experimental
 */
export interface A2uiSurfaceContext {
  readonly componentsByName: ReadonlyMap<string, Type<unknown>>;
  readonly functions: readonly A2uiFunctionEntry[];
  readonly processor: MessageProcessor;
}

/** @experimental */
export const A2UI_SURFACE_CONTEXT = new InjectionToken<A2uiSurfaceContext>('A2UI_SURFACE_CONTEXT');
