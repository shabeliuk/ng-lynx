// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * Prop resolution for the Angular A2UI renderer: the counterpart of
 * `resolveProperties` / `useResolvedProps` in `@lynx-js/genui/a2ui/react`,
 * for the A2UI v1.0 wire format.
 *
 *  - `{ '@path': '/a/b' }` is a data binding: the current value of that
 *    data-model signal. Relative paths resolve against the data context.
 *  - `{ '@call': 'name', args }` is a function call, run through the catalog
 *    registered on the processor for the component's `@catalogId` (or the
 *    surface's catalog).
 *  - `@@key` escapes a literal key that starts with `@`; any other unknown
 *    `@` directive is an error. A failing prop resolves to `null` and the
 *    error goes to the agent through `processor.reportExpressionError`.
 *  - `action`, `@checks`, `@metadata`, `children` and `__template` stay
 *    unresolved: actions and checks are evaluated at their own execution
 *    boundary, children are interpreted by containers.
 *  - With a catalog schema for the prop, the resolved value is coerced to its
 *    declared `Dynamic*` type, as upstream does.
 *
 * The upstream helpers this needs (`resolveDeepValue`, `coerceDynamic`,
 * `equalJsonValues`, ...) are internal to `@lynx-js/genui/a2ui/store` (not in
 * its `exports`), so they are ported here. Reactivity is in reactivity.ts.
 */
import type { MessageProcessor, Surface } from '@lynx-js/genui/a2ui/store';
import {
  executeFunctionCall,
  isDataBinding,
  isFunctionCall,
  resolveDynamicValue,
} from '@lynx-js/genui/a2ui/store';

import type { A2uiCatalog, A2uiFunctionEntry } from './catalog.js';

/**
 * Marker for props using dynamic syntax this renderer does not support.
 *
 * Every v1.0 dynamic value is supported, so the renderer no longer produces
 * it; it stays exported for custom renderers built on {@link resolveComponentProps}.
 *
 * @experimental
 */
export const UNSUPPORTED_PROP: unique symbol = Symbol('a2ui.unsupported');

/**
 * Result of a resolution pass.
 *
 * @experimental
 */
export interface ResolvedProps {
  props: Record<string, unknown>;
  /** Prop names that used unsupported dynamic syntax. */
  unsupportedFields: string[];
}

/** Keys resolved elsewhere, or not at all. */
const UNRESOLVED_KEYS = new Set(['action', '@checks', '@metadata', 'children', '__template']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function equalEntries(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  equalValue: (x: unknown, y: unknown) => boolean,
): boolean {
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && a.length !== (b as unknown as unknown[]).length) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && equalValue(a[key], b[key]));
}

/** Same container shape and identical children. */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  return isObject(a) && isObject(b) && equalEntries(a, b, Object.is);
}

/** Deep equality for resolved JSON data. */
function equalJsonValues(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!isObject(a) || !isObject(b)) return false;
  const prototype = Object.getPrototypeOf(a);
  if (prototype !== Object.getPrototypeOf(b)) return false;
  if (!Array.isArray(a) && prototype !== Object.prototype && prototype !== null) return false;
  return equalEntries(a, b, equalJsonValues);
}

/** A `@path` binding that isn't a template (`{ path, componentId }`). */
function isPlainDataBinding(value: unknown): value is { '@path': string } {
  return isDataBinding(value) && !('componentId' in (value as object));
}

/**
 * Resolve a possibly-relative binding path against the data context.
 *
 * @experimental
 */
export function resolveBindingPath(rawPath: string, dataContextPath?: string): string {
  if (rawPath.startsWith('/')) return rawPath;
  if (rawPath.startsWith('./')) rawPath = rawPath.slice(2);
  const context = dataContextPath?.endsWith('/') ? dataContextPath.slice(0, -1) : dataContextPath;
  return context ? `${context}/${rawPath}` : `/${rawPath}`;
}

/**
 * Walk a value, resolving `@path` / `@call` leaves and keeping the previous
 * result's identity for anything that didn't change.
 */
function resolveDeepValue(
  value: unknown,
  previous: unknown,
  resolveLeaf: (leaf: unknown) => unknown,
): unknown {
  if (
    value === null || value === undefined
    || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const previousItems = Array.isArray(previous) ? previous : [];
    const next = value.map((item, index) => resolveDeepValue(item, previousItems[index], resolveLeaf));
    return shallowEqual(next, previous) ? previous : next;
  }
  if (isDataBinding(value) && Object.keys(value as object).some((key) => key !== '@path')) {
    throw new Error('Invalid data binding shape');
  }
  if (isObject(value) && !isDataBinding(value) && !isFunctionCall(value)) {
    const previousObject = isObject(previous) ? previous : undefined;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith('@') && !key.startsWith('@@')) {
        throw new Error(`Unknown dynamic directive: ${key}`);
      }
      const literalKey = key.startsWith('@@') ? key.slice(1) : key;
      Object.defineProperty(next, literalKey, {
        value: resolveDeepValue(item, previousObject?.[literalKey], resolveLeaf),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return shallowEqual(next, previousObject) ? previousObject : next;
  }
  return resolveLeaf(value);
}

/**
 * The A2UI v1.0 DynamicBoolean coercion, independent of JavaScript truthiness:
 * `"false"` is false, and a ValidationResult counts as its `valid` field.
 *
 * @experimental
 */
export function coerceA2uiBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return isObject(value) && 'valid' in value && value['valid'] === true;
}

/** Coerce a resolved value to its catalog-declared type. */
function coerceDynamic(value: unknown, schema: Record<string, unknown>, previous: unknown): unknown {
  const ref = typeof schema['$ref'] === 'string' ? schema['$ref'] : '';
  if (ref.endsWith('/DynamicBoolean')) return coerceA2uiBoolean(value);
  if (ref.endsWith('/DynamicString')) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '';
  }
  if (ref.endsWith('/DynamicNumber')) {
    if (value === null || value === undefined) return 0;
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  if (Array.isArray(value) && isObject(schema['items'])) {
    const items = schema['items'];
    const previousItems = Array.isArray(previous) ? previous : [];
    const next = value.map((item, index) => coerceDynamic(item, items, previousItems[index]));
    return shallowEqual(next, previous) ? previous : next;
  }
  if (isObject(value) && !Array.isArray(value)) {
    const properties = schema['properties'] as Record<string, Record<string, unknown>> | undefined;
    const previousObject = isObject(previous) ? previous : undefined;
    const next = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        properties?.[key] ? coerceDynamic(item, properties[key], previousObject?.[key]) : item,
      ]),
    );
    return shallowEqual(next, previous) ? previous : next;
  }
  return value;
}

/**
 * The catalog a component resolves against: its own `@catalogId`, else the
 * surface's.
 *
 * @experimental
 */
export function componentCatalog(
  component: Record<string, unknown>,
  surface: Surface,
  processor: MessageProcessor,
): A2uiCatalog | undefined {
  const id = typeof component['@catalogId'] === 'string' ? component['@catalogId'] : surface.catalogId;
  return processor.getCatalog(id) as unknown as A2uiCatalog | undefined;
}

/**
 * Resolve every dynamic value in a component instance's props.
 *
 * Pass the previous result as `previous` to keep the identity of everything
 * that didn't change (and of the whole object when nothing did). Run it
 * inside {@link trackA2uiSignals} to re-resolve when any signal it read
 * changes.
 *
 * @experimental
 */
export function resolveComponentProps(
  component: Record<string, unknown>,
  surface: Surface,
  dataContextPath: string | undefined,
  processor: MessageProcessor,
  functions: readonly A2uiFunctionEntry[],
  previous?: Record<string, unknown>,
): ResolvedProps {
  const schema = componentCatalog(component, surface, processor)?.components
    .find((entry) => entry.name === component['component'])?.schema;
  const schemas = schema?.['properties'] as Record<string, Record<string, unknown>> | undefined;

  const resolve = (value: unknown, prev: unknown, propSchema: Record<string, unknown> | undefined): unknown => {
    let hasFunctionCall = false;
    const resolved = resolveDeepValue(value, prev, (leaf) => {
      if (isFunctionCall(leaf)) {
        hasFunctionCall = true;
        return resolveDynamicValue(processor, leaf, surface.surfaceId, dataContextPath, {
          functions: functions as never,
          resolveFunctionCall: executeFunctionCall,
        });
      }
      if (isPlainDataBinding(leaf)) {
        if (!leaf['@path']) return undefined;
        const path = resolveBindingPath(leaf['@path'], dataContextPath);
        return surface.store.getSignal(path).value;
      }
      return leaf;
    });
    const next = propSchema
      ? (propSchema['type'] === 'boolean' && (isPlainDataBinding(value) || isFunctionCall(value))
        ? coerceA2uiBoolean(resolved)
        : coerceDynamic(resolved, propSchema, prev))
      : resolved;
    // A call can return fresh JSON on every read; keep the old value if equal.
    return hasFunctionCall && equalJsonValues(next, prev) ? prev : next;
  };

  const props: Record<string, unknown> = {};
  const unsupportedFields: string[] = [];
  for (const [key, value] of Object.entries(component)) {
    if (UNRESOLVED_KEYS.has(key)) {
      props[key] = value;
      continue;
    }
    try {
      const resolved = resolve(value, previous?.[key], schemas?.[key]);
      if (resolved === UNSUPPORTED_PROP) {
        unsupportedFields.push(key);
        continue;
      }
      props[key] = resolved;
    } catch (error) {
      props[key] = null;
      processor.reportExpressionError(error, surface.surfaceId);
    }
  }
  return {
    props: previous && shallowEqual(props, previous) ? previous : props,
    unsupportedFields,
  };
}
