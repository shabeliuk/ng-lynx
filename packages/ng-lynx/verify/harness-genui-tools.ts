/**
 * Headless verification of the two build-time GenUI modules against an
 * Angular-flavored source fixture (`fixtures/genui/catalog-fixture.ts`):
 *
 *  - `@lynx-js/genui/a2ui-catalog-extractor` — runs TypeDoc over the fixture
 *    and turns `@a2uiCatalog` interfaces / `@a2uiFunction` functions into
 *    catalog JSON. Framework-agnostic by design (TypeDoc reflection only),
 *    so it works from an ng-lynx repo unchanged.
 *  - `@lynx-js/genui/a2ui-prompt` — assembles those manifests into a
 *    prompt-ready catalog and renders the A2UI system prompt an agent needs.
 *
 * Run with: `npm run verify:genui-tools`.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractCatalogComponents,
  extractCatalogFunctions,
} from '@lynx-js/genui/a2ui-catalog-extractor';
import {
  A2UI_PROTOCOL_VERSION,
  BASIC_CATALOG,
  buildA2UISystemPrompt,
  createA2UICatalogFromManifests,
} from '@lynx-js/genui/a2ui-prompt';

import { assert } from '../testing/src/mock-papi.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(here, 'fixtures/genui');
const fixture = resolve(fixtureDir, 'catalog-fixture.ts');

async function main(): Promise<void> {
  console.log('\n=== a2ui-catalog-extractor: components from @a2uiCatalog interfaces ===');
  const components = await extractCatalogComponents({
    sourceFiles: [fixture],
    tsconfig: resolve(fixtureDir, 'tsconfig.json'),
  });
  assert(components.length === 2, `extracted 2 components (got ${components.length})`);
  const byName = new Map(components.map((c) => [c.name, c]));
  const card = byName.get('ProductCard');
  assert(!!card, 'ProductCard component extracted');
  assert(card!.interfaceName === 'ProductCardProps', 'component name comes from the tag, not the interface');
  const props = card!.schema['properties'] as Record<string, Record<string, unknown>>;
  assert(!!props['title'] && !!props['price'], 'title and price props present in the schema');
  assert(
    Array.isArray(props['title']['oneOf']),
    'a `string | { path }` prop becomes a oneOf (static value or data binding)',
  );
  // Since genui 0.7 the extractor sorts enum values (and `oneOf` branches,
  // record keys) for deterministic catalogs, so compare as a set.
  assert(
    JSON.stringify([...(props['tone']['enum'] as string[])].sort()) ===
      JSON.stringify(['accent', 'neutral', 'warning']),
    'union of literals becomes a JSON-Schema enum',
  );
  const required = card!.schema['required'] as string[];
  assert(
    required.includes('title') && required.includes('price') && !required.includes('tone'),
    'optional props stay out of `required`',
  );
  assert(!!byName.get('RatingRow'), 'RatingRow component extracted');

  console.log('\n=== a2ui-catalog-extractor: functions from @a2uiFunction ===');
  const functions = await extractCatalogFunctions({
    sourceFiles: [fixture],
    tsconfig: resolve(fixtureDir, 'tsconfig.json'),
  });
  assert(functions.length === 1, `extracted 1 function (got ${functions.length})`);
  const fn = functions[0]!;
  assert(fn.name === 'formatPrice', 'function name comes from the tag');
  assert(fn.returnType === 'string', 'return type captured');
  const params = fn.parameters['properties'] as Record<string, Record<string, unknown>>;
  assert(
    params['amount']?.['type'] === 'number' && params['currency']?.['type'] === 'string',
    'parameter types captured in the JSON schema',
  );

  console.log('\n=== a2ui-prompt: catalog manifests -> system prompt ===');
  const catalog = createA2UICatalogFromManifests({
    catalogId: 'ng-lynx-demo',
    componentManifests: components.map((c) => ({ [c.name]: c.schema })),
  });
  const prompt = buildA2UISystemPrompt({ catalog });
  assert(prompt.length > 1000, 'prompt is a substantial document');
  assert(prompt.includes('ProductCard'), 'prompt embeds the extracted ProductCard contract');
  assert(prompt.includes('RatingRow'), 'prompt embeds the extracted RatingRow contract');
  assert(prompt.includes(A2UI_PROTOCOL_VERSION), 'prompt states the protocol version');

  console.log('\n=== a2ui-prompt: built-in basic catalog ===');
  const basicPrompt = buildA2UISystemPrompt({ catalog: BASIC_CATALOG });
  assert(basicPrompt.length > 1000, 'basic-catalog prompt builds');
  assert(basicPrompt.includes('Text') && basicPrompt.includes('Button'), 'basic catalog covers core components');

  console.log('\n✅ GenUI build-time tool assertions passed.\n');
  // TypeDoc leaves worker threads / timers behind; the assertions above have
  // all run, so exit rather than wait on them.
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ GenUI tools verification failed:\n', err);
  process.exit(1);
});
