// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * Prop resolution for the Angular A2UI renderer — the Angular counterpart of
 * `useResolvedProps` in `@lynx-js/genui/a2ui/react`.
 *
 * The upstream React hook re-runs resolution inside a `@preact/signals`
 * `effect()` so any signal read during resolution re-triggers it. Importing
 * `@preact/signals` here would risk a second signals runtime next to the one
 * the genui store instantiates (a classic dual-instance bug: effects in one
 * copy never see writes made through the other). Instead this port *collects
 * the binding paths it touches while resolving* and lets the caller subscribe
 * to exactly those signals via `Signal.prototype.subscribe` — which works on
 * the store's own signal instances, so there is a single runtime by
 * construction.
 *
 * Coverage note: paths read *inside* registered function implementations
 * (via `context.resolveSignal`) are invisible to this collector — only plain
 * data bindings and function-call *arguments* re-resolve automatically. The
 * upstream effect-based approach tracks those too; if a catalog function
 * reads extra signals internally, its prop refreshes on the next structural
 * update instead. Documented in docs/28-genui.md.
 */
import type { MessageProcessor, Surface } from '@lynx-js/genui/a2ui/store';
import {
  executeFunctionCall,
  isDataBinding,
  isFunctionCall,
  resolveDynamicValue,
} from '@lynx-js/genui/a2ui/store';

import type { A2uiFunctionEntry } from './catalog.js';

/** Marker for props using dynamic syntax this renderer does not support. */
export const UNSUPPORTED_PROP: unique symbol = Symbol('a2ui.unsupported');

/** Result of a resolution pass. */
export interface ResolvedProps {
  props: Record<string, unknown>;
  /** Prop names that used unsupported dynamic syntax. */
  unsupportedFields: string[];
  /** Absolute signal paths touched — subscribe to these for reactivity. */
  touchedPaths: Set<string>;
}

function isCallExpression(value: unknown): boolean {
  return (
    isFunctionCall(value)
    && typeof value === 'object'
    && value !== null
    && 'args' in value
    && 'returnType' in value
  );
}

/** Resolve a possibly-relative binding path against the data context. */
export function resolveBindingPath(rawPath: string, dataContextPath?: string): string {
  if (rawPath.startsWith('/')) return rawPath;
  if (dataContextPath) return `${dataContextPath}/${rawPath}`;
  return `/${rawPath}`;
}

/** Collect binding paths inside a function call's argument object. */
function collectArgPaths(value: unknown, dataContextPath: string | undefined, out: Set<string>): void {
  if (isDataBinding(value)) {
    const raw = (value as { path?: unknown })['path'];
    if (typeof raw === 'string') out.add(resolveBindingPath(raw, dataContextPath));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectArgPaths(item, dataContextPath, out);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) collectArgPaths(v, dataContextPath, out);
  }
}

function resolveLeaf(
  leaf: unknown,
  surface: Surface,
  dataContextPath: string | undefined,
  processor: MessageProcessor,
  functions: readonly A2uiFunctionEntry[],
  touched: Set<string>,
): unknown {
  if (isFunctionCall(leaf)) {
    if (isCallExpression(leaf)) return UNSUPPORTED_PROP;
    collectArgPaths((leaf as { args?: unknown })['args'], dataContextPath, touched);
    return resolveDynamicValue(processor, leaf, surface.surfaceId, dataContextPath, {
      functions: functions as never,
      resolveFunctionCall: executeFunctionCall,
    });
  }
  if (isDataBinding(leaf) && !('componentId' in (leaf as object))) {
    const raw = (leaf as { path?: unknown })['path'];
    const path = resolveBindingPath(typeof raw === 'string' ? raw : '', dataContextPath);
    touched.add(path);
    return surface.store.getSignal(path).value;
  }
  return leaf;
}

function resolveDeep(
  value: unknown,
  surface: Surface,
  dataContextPath: string | undefined,
  processor: MessageProcessor,
  functions: readonly A2uiFunctionEntry[],
  touched: Set<string>,
): unknown {
  if (isFunctionCall(value) || isDataBinding(value)) {
    return resolveLeaf(value, surface, dataContextPath, processor, functions, touched);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveDeep(item, surface, dataContextPath, processor, functions, touched));
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveDeep(v, surface, dataContextPath, processor, functions, touched);
    }
    return out;
  }
  return value;
}

/**
 * Resolve every dynamic value in a component instance's props.
 *
 * Mirrors upstream `resolveProperties`: plain data bindings become the
 * current signal value, function calls execute through the registry, and
 * call expressions (unsupported) are reported per-field. `children` /
 * `child` are left untouched — containers interpret those themselves,
 * including template bindings (`{ path, componentId }`), which
 * `isDataBinding` would otherwise flatten.
 */
export function resolveComponentProps(
  component: Record<string, unknown>,
  surface: Surface,
  dataContextPath: string | undefined,
  processor: MessageProcessor,
  functions: readonly A2uiFunctionEntry[],
): ResolvedProps {
  const touched = new Set<string>();
  const props: Record<string, unknown> = {};
  const unsupportedFields: string[] = [];
  for (const [key, value] of Object.entries(component)) {
    if (key === 'children' || key === 'child' || key === '__template') {
      props[key] = value;
      continue;
    }
    const resolved = resolveDeep(value, surface, dataContextPath, processor, functions, touched);
    if (resolved === UNSUPPORTED_PROP) {
      unsupportedFields.push(key);
      continue;
    }
    props[key] = resolved;
  }
  return { props, unsupportedFields, touchedPaths: touched };
}
