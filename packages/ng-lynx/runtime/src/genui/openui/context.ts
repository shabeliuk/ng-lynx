// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * DI contracts for the Angular OpenUI renderer.
 *
 * Upstream (`@lynx-js/genui/openui`) shares runtime state through React
 * contexts plus ~10 hooks (`useOpenUI`, `useTriggerAction`,
 * `useGetFieldValue`, `useIsStreaming`, …). Angular components get the same
 * capabilities from two injection tokens:
 *
 *  - {@link OPENUI_RENDERER_CONTEXT} — renderer-wide: the library, form
 *    state / actions ({@link OpenUiState}), and streaming flag. The
 *    counterpart of `OpenUIContextValue`.
 *  - {@link OPENUI_NODE_CONTEXT} — per rendered node: the `ElementNode` and
 *    its (evaluated, reactive) props. The counterpart of
 *    `ComponentRenderProps`; children render through `[openuiNode]`.
 */
import type { Signal, Type } from '@angular/core';
import { InjectionToken } from '@angular/core';

import type { ElementNode, Library } from '@openuidev/lang-core';

import type { OpenUiState } from './state.js';

/**
 * Renderer-wide OpenUI context (≈ upstream `OpenUIContextValue`).
 *
 * @experimental
 */
export interface OpenuiRendererContext {
  readonly library: Library<Type<unknown>>;
  readonly state: OpenUiState;
  readonly isStreaming: Signal<boolean>;
  /** Nearest form name for field scoping (undefined at top level). */
  readonly formName: string | undefined;
}

/** @experimental */
export const OPENUI_RENDERER_CONTEXT = new InjectionToken<OpenuiRendererContext>(
  'OPENUI_RENDERER_CONTEXT',
);

/**
 * Per-node OpenUI context (≈ upstream `ComponentRenderProps`).
 *
 * @experimental
 */
export interface OpenuiNodeContext {
  /**
   * The parsed element node being rendered. Always the current one: a new
   * node for the same element replaces it in place (see `OpenuiNode`).
   */
  readonly node: ElementNode;
  /** Evaluated props — `$state` refs resolved, re-evaluated on state change. */
  readonly props: Signal<Record<string, unknown>>;
}

/** @experimental */
export const OPENUI_NODE_CONTEXT = new InjectionToken<OpenuiNodeContext>('OPENUI_NODE_CONTEXT');
