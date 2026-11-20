// Derived from `@lynx-js/genui` (https://github.com/lynx-family/lynx-stack),
// Copyright The Lynx Authors, Apache-2.0. Changed: ported from ReactLynx to Angular.
/**
 * The OpenUI data builtins `@lynx-js/genui` adds on top of lang-core's own.
 *
 * genui 0.7 teaches the model `@Append(array, item)`: its system prompt
 * lists it beside `@Count`, `@Sum` and the rest. It registers the builtin
 * into lang-core's shared `BUILTINS` table from its prompt library and its
 * ReactLynx renderer, and neither runs inside an Angular Lynx bundle. Without
 * this, a response written against a genui 0.7 prompt would parse
 * `@Append(...)` as an unknown component. lang-core's parser and evaluator
 * read the table at call time, so registering before the first parse is
 * enough.
 *
 * The definition is upstream's (`openui/dist/shared/builtins.js`), word for
 * word, and registration uses `??=`: whichever side registers first, both see
 * the same builtin. Upstream's `registerOpenUIBuiltins` isn't exported.
 */
import { BUILTIN_NAMES, BUILTINS } from '@openuidev/lang-core';

/**
 * Register the genui OpenUI builtins (`@Append`) in lang-core. Idempotent.
 *
 * @experimental
 */
export function registerOpenUiBuiltins(): void {
  BUILTINS['Append'] ??= {
    name: 'Append',
    signature: 'Append(array, item) → new array',
    description:
      'Returns a new array with one item appended, without modifying the input. An array item stays nested; it is not flattened. Requires an array and exactly one item.',
    fn: (...args: unknown[]) => {
      const [array, item] = args;
      if (args.length !== 2 || !Array.isArray(array)) {
        throw new TypeError('@Append requires an array and exactly one item');
      }
      return [...array, item];
    },
  };
  BUILTIN_NAMES.add('Append');
}
