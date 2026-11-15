/**
 * Headless end-to-end verification of the ng-lynx runtime.
 *
 * Boots the REAL example AppComponent through Angular's JIT compiler in Node —
 * no rspack, no device — and proves the full chain works:
 *
 *   Angular template (JIT) → component + signals + zoneless CD
 *     → LynxRenderer2 ops → mocked callLepusMethod
 *       → real Main-Thread applyOps → mock element PAPI → native tree
 *         → simulate a tap → CD update → one SET_TEXT op applied
 *
 * Run with: `npm run verify` (esbuild bundles + executes this).
 */
import '@angular/compiler'; // side-effect: register the JIT compiler facade

import { bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread'; // installs globalThis.renderPage / processData / ngPatchUpdate

import { AppComponent } from '../../../examples/hello-world/src/app.component.js';
import {
  assert,
  findEventSign,
  findText,
  getPage,
  installMockPapi,
  printTree,
  tick,
} from './mock-papi.js';

async function main(): Promise<void> {
  installMockPapi();

  // The Main Thread runs renderPage first to create the page root (id=1).
  (globalThis as Record<string, any>).renderPage({});

  await bootstrapLynxApplication(AppComponent);
  await tick();
  await tick();

  const page = getPage();

  console.log('\n=== Reconstructed native tree (after initial render) ===');
  console.log(printTree(page).join('\n'));

  console.log('\n=== Assertions: initial render ===');
  assert(page.children.length > 0, 'page root has children');
  assert(!!findText(page, 'Angular on Lynx'), 'title text rendered');
  assert(findText(page, '0 is even') != null, 'computed parity shows "0 is even"');
  assert(findText(page, 'Lynx') != null, '@for rendered list item "Lynx"');
  const tapSign = findEventSign(page, 'tap');
  assert(!!tapSign, 'a (tap) handler is registered on an element');

  console.log('\n=== Simulating a tap on the counter ===');
  publishEvent(tapSign!, { type: 'tap' });
  await tick();
  await tick();

  console.log('\n=== Reconstructed native tree (after one tap) ===');
  console.log(printTree(page).join('\n'));

  console.log('\n=== Assertions: after tap ===');
  assert(findText(page, '1 is odd') != null, 'counter incremented → "1 is odd"');

  console.log('\n✅ All assertions passed — runtime works end-to-end.\n');
}

main().catch((err) => {
  console.error('\n❌ Verification failed:\n', err);
  process.exit(1);
});
