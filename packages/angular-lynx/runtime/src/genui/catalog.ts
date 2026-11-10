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
 *    (`{ kind: 'function', name, impl, definition? }`), which means
 *    `basicFunctions` from `@lynx-js/genui/a2ui/functions` — a React-free
 *    entry — can be spread straight into an Angular catalog;
 *  - `resolveDynamicValue` / `executeFunctionCall` from
 *    `@lynx-js/genui/a2ui/store` accept the function entries unchanged.
 */
import type { Type } from '@angular/core';

import type { FunctionEntry } from '@lynx-js/genui/a2ui/store';
import { functionRegistry } from '@lynx-js/genui/a2ui/store';

type FunctionDefinition = NonNullable<FunctionEntry['definition']>;

/** Function entry — same shape as upstream `CatalogFunctionEntry`. */
export interface A2uiFunctionEntry {
  kind: 'function';
  name: string;
  impl: FunctionEntry['impl'];
  definition?: FunctionDefinition;
}

/** A named Angular component registered as an A2UI catalog component. */
export interface A2uiComponentEntry {
  /** Protocol component name the agent refers to (e.g. `"Text"`). */
  name: string;
  /** Angular component rendered for that name. */
  component: Type<unknown>;
  /** Optional JSON-Schema manifest announced during agent handshakes. */
  schema?: Record<string, unknown>;
}

/** Inputs accepted by {@link defineA2uiCatalog}. */
export type A2uiCatalogInput =
  | A2uiComponentEntry
  | A2uiFunctionEntry
  /** `[component, { Name: schema }]` pair, mirroring upstream tuples. */
  | readonly [Type<unknown>, Record<string, Record<string, unknown>>];

/** Resolved catalog: what `A2uiSurface` consumes. */
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
 * kind are rejected, and function impls are registered into the shared
 * `functionRegistry` immediately — both mirroring upstream `defineCatalog`.
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
      functionRegistry.register({
        name: input.name,
        impl: input.impl,
        ...(input.definition ? { definition: input.definition } : {}),
      });
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
    if (seenComponents.has(entry.name)) {
      throw new Error(`[a2ui] Duplicate component name in catalog: "${entry.name}".`);
    }
    seenComponents.add(entry.name);
    components.push(entry);
  }
  return { components, functions };
}

/** Name → Angular component lookup used by the node renderer. */
export function resolveA2uiCatalog(catalog: A2uiCatalog): Map<string, Type<unknown>> {
  const map = new Map<string, Type<unknown>>();
  for (const entry of catalog.components) map.set(entry.name, entry.component);
  return map;
}
