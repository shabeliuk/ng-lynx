// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * Angular-side catalog machinery for A2UI (`@lynx-js/genui/a2ui`).
 *
 * The upstream `defineCatalog` lives in `@lynx-js/genui/a2ui/catalog`, whose
 * module graph loads every built-in ReactLynx component (and with them
 * `@lynx-js/react`) at import time — not something an Angular bundle should
 * pull in. The catalog *concept* is framework-agnostic though: a name → local
 * implementation map plus function entries registered into the shared
 * `functionRegistry`. This module re-creates exactly that contract with
 * Angular component classes as the implementations, so:
 *
 *  - function entries use the identical shape as upstream
 *    (`{ kind: 'function', name, impl?, definition? }`), which means
 *    `basicFunctions` from `@lynx-js/genui/a2ui/functions` — a React-free
 *    entry — can be spread straight into an Angular catalog;
 *  - a resolved catalog has upstream's `Catalog` shape (`components` with
 *    `name` and `schema`, plus `functions`), so `A2uiSurface` registers it on
 *    the `MessageProcessor` with `registerCatalog(catalogId, catalog)`. In
 *    A2UI v1.0 that registration, not the global `functionRegistry`, is how
 *    `@call` finds a function: by the surface's (or component's) catalog id.
 */
import type { Type } from '@angular/core';

import type { FunctionEntry } from '@lynx-js/genui/a2ui/store';
import { functionRegistry } from '@lynx-js/genui/a2ui/store';

type FunctionDefinition = NonNullable<FunctionEntry['definition']>;

/**
 * Function entry — same shape as upstream `CatalogFunctionEntry`.
 *
 * @experimental
 */
export interface A2uiFunctionEntry {
  kind: 'function';
  name: string;
  /**
   * Local implementation. Without one, a call is routed to the agent
   * (`callAgentFunction`), so the definition alone declares an agent function.
   */
  impl?: FunctionEntry['impl'];
  definition?: FunctionDefinition;
}

/**
 * The catalog id `<a2ui-surface>` registers its catalog under when none is
 * given: the same default as upstream `<A2UI>`, the published Lynx catalog.
 * A surface renders only when its `createSurface.catalogId` names a
 * registered catalog.
 *
 * @experimental
 */
export const A2UI_DEFAULT_CATALOG_ID = 'https://unpkg.com/@lynx-js/genui/a2ui/dist/catalog.json';

/**
 * A named Angular component registered as an A2UI catalog component.
 *
 * @experimental
 */
export interface A2uiComponentEntry {
  /** Protocol component name the agent refers to (e.g. `"Text"`). */
  name: string;
  /** Angular component rendered for that name. */
  component: Type<unknown>;
  /** Optional JSON-Schema manifest announced during agent handshakes. */
  schema?: Record<string, unknown>;
}

/**
 * Inputs accepted by {@link defineA2uiCatalog}.
 *
 * @experimental
 */
export type A2uiCatalogInput =
  | A2uiComponentEntry
  | A2uiFunctionEntry
  /** `[component, { Name: schema }]` pair, mirroring upstream tuples. */
  | readonly [Type<unknown>, Record<string, Record<string, unknown>>];

/**
 * Resolved catalog: what `A2uiSurface` consumes.
 *
 * @experimental
 */
export interface A2uiCatalog {
  components: A2uiComponentEntry[];
  functions: A2uiFunctionEntry[];
}

function isFunctionEntry(input: A2uiCatalogInput): input is A2uiFunctionEntry {
  return !Array.isArray(input) && (input as A2uiFunctionEntry).kind === 'function';
}

/**
 * Build an Angular A2UI catalog from component entries, `[component,
 * manifest]` pairs, and function entries. Duplicate names within the same
 * kind are rejected, as is the reserved name `Surface`, and function impls
 * are also registered into the shared `functionRegistry` — all mirroring
 * upstream `defineCatalog`.
 *
 * @experimental
 */
export function defineA2uiCatalog(inputs: readonly A2uiCatalogInput[]): A2uiCatalog {
  const components: A2uiComponentEntry[] = [];
  const functions: A2uiFunctionEntry[] = [];
  const seenComponents = new Set<string>();
  const seenFunctions = new Set<string>();
  for (const input of inputs) {
    if (isFunctionEntry(input)) {
      if (seenFunctions.has(input.name)) {
        throw new Error(`[a2ui] Duplicate function name in catalog: "${input.name}".`);
      }
      seenFunctions.add(input.name);
      functions.push(input);
      if (input.impl) {
        functionRegistry.register({
          name: input.name,
          impl: input.impl,
          ...(input.definition ? { definition: input.definition } : {}),
        });
      }
      continue;
    }
    let entry: A2uiComponentEntry;
    if (Array.isArray(input)) {
      const [component, manifest] = input as readonly [
        Type<unknown>,
        Record<string, Record<string, unknown>>,
      ];
      const name = Object.keys(manifest)[0];
      if (!name) {
        throw new Error(
          '[a2ui] Empty manifest passed to defineA2uiCatalog; expected `{ <ComponentName>: schema }`.',
        );
      }
      const schema = manifest[name];
      entry = schema !== undefined ? { name, component, schema } : { name, component };
    } else {
      entry = input as A2uiComponentEntry;
    }
    if (entry.name === 'Surface') {
      throw new Error('[a2ui] Surface is a reserved A2UI component name.');
    }
    if (seenComponents.has(entry.name)) {
      throw new Error(`[a2ui] Duplicate component name in catalog: "${entry.name}".`);
    }
    seenComponents.add(entry.name);
    components.push(entry);
  }
  return { components, functions };
}

/**
 * Name → Angular component lookup used by the node renderer.
 *
 * @experimental
 */
export function resolveA2uiCatalog(catalog: A2uiCatalog): Map<string, Type<unknown>> {
  const map = new Map<string, Type<unknown>>();
  for (const entry of catalog.components) map.set(entry.name, entry.component);
  return map;
}

/**
 * The catalog an agent is told about during the handshake: port of upstream
 * `serializeCatalog`. Every component entry needs a `schema` (from the
 * catalog extractor, or written by hand); the basic catalog's components
 * have none, so serialize your own catalogs, or announce the published Lynx
 * catalog by its id ({@link A2UI_DEFAULT_CATALOG_ID}).
 *
 * @experimental
 */
export function serializeA2uiCatalog(
  catalog: A2uiCatalog,
  catalogId: string = A2UI_DEFAULT_CATALOG_ID,
): A2uiSerializedCatalog {
  const components = Object.fromEntries(catalog.components.map((entry) => {
    if (!entry.schema) {
      throw new Error(`[a2ui] Cannot serialize component "${entry.name}" without a schema.`);
    }
    const properties = entry.schema['properties'] as Record<string, unknown> | undefined;
    const required = entry.schema['required'] as string[] | undefined;
    return [entry.name, {
      ...entry.schema,
      type: 'object',
      properties: { ...properties, component: { const: entry.name } },
      required: [...new Set(['component', ...(required ?? [])])],
    }];
  }));
  const functions = Object.fromEntries(catalog.functions.filter((fn) => fn.definition).map((fn) => {
    const { description, parameters, returnType, allowedCallers, requiresUserActivation } = fn.definition!;
    const args: Record<string, unknown> = { ...parameters };
    delete args['$schema'];
    return [fn.name, {
      type: 'object',
      ...(description ? { description } : {}),
      returnType,
      ...(allowedCallers || requiresUserActivation ? { allowedCallers: allowedCallers ?? 'rendererOnly' } : {}),
      ...(requiresUserActivation === undefined ? {} : { requiresUserActivation }),
      properties: { '@call': { const: fn.name }, args },
      required: ['@call', 'args'],
    }];
  }));
  const references = (section: string, schemas: Record<string, unknown>): Record<string, unknown> =>
    Object.keys(schemas).length > 0
      ? {
        oneOf: Object.keys(schemas).map((name) => ({
          $ref: `#/${section}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`,
        })),
      }
      : { not: {} };
  return {
    $id: catalogId,
    catalogId,
    $defs: {
      anyComponent: references('components', components),
      anyFunction: references('functions', functions),
    },
    protocolVersion: '1.0',
    components,
    ...(Object.keys(functions).length > 0 ? { functions } : {}),
  };
}

/**
 * What {@link serializeA2uiCatalog} returns: upstream's `SerializedCatalog`.
 *
 * @experimental
 */
export interface A2uiSerializedCatalog {
  $id: string;
  catalogId: string;
  $defs: Record<string, Record<string, unknown>>;
  protocolVersion: '1.0';
  components: Record<string, Record<string, unknown>>;
  functions?: Record<string, Record<string, unknown>>;
}
