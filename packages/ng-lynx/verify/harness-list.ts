/**
 * Headless verification of native `<list>` support — creation, virtualized
 * collection, item-keys, and dynamic add / remove / reorder.
 *
 * After each ops batch the harness SIMULATES the native list runtime: it reads
 * the pending `update-list-info` and invokes the `componentAtIndex` callbacks
 * (via `driveList`) to materialise the visible cells, then asserts the resulting
 * order matches the component. Removal/reorder are announced as a full resync
 * (removeAction + insertAction); append is incremental.
 *
 * Run with: `npm run verify:list`.
 */
import '@angular/compiler';

import { bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import 'ng-lynx/main-thread';

import { AppComponent } from '../../../examples/list/src/app.component.js';
import {
  assert,
  driveList,
  findByClass,
  findByType,
  findText,
  getPage,
  installMockPapi,
  type MockEl,
  printTree,
  tick,
} from './mock-papi.js';

let listEl: MockEl;

/** Pending update-list-info (before it's consumed by driveList). */
function pending(): { insertAction: unknown[]; removeAction: unknown[] } | undefined {
  return listEl.attrs['update-list-info'] as
    | { insertAction: unknown[]; removeAction: unknown[] }
    | undefined;
}

/** Ordered cell names currently materialised in the native list. */
function names(): string[] {
  return listEl.children.map((item) => {
    const nameEl = findByClass(item, 'name');
    return (nameEl && findText(nameEl, '')) || '?';
  });
}

/** Tap the button with the given class and let change detection settle. */
async function tap(btnClass: string): Promise<void> {
  const sign = findByClass(getPage(), btnClass)?.events['tap']?.sign;
  if (!sign) throw new Error(`no (tap) handler on .${btnClass}`);
  publishEvent(sign, { type: 'tap' });
  await tick();
  await tick();
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>).renderPage({});

  await bootstrapLynxApplication(AppComponent);
  await tick();
  await tick();

  listEl = findByType(getPage(), 'list')!;

  // ---- initial render -----------------------------------------------------
  console.log('\n=== Assertions: initial render ===');
  assert(!!listEl, '<list> created via __CreateList');
  assert(listEl.children.length === 0, 'items collected, not eagerly appended (virtualized)');
  assert((pending()?.insertAction.length ?? 0) === 3, 'update-list-info announced 3 items');
  driveList(listEl);
  assert(
    names().join(',') === 'Ada Lovelace,Alan Turing,Grace Hopper',
    'three cells materialise in order',
  );
  assert(listEl.children.every((c) => c.type === 'list-item'), 'all cells are <list-item>');

  // ---- append (fast path) -------------------------------------------------
  console.log('\n=== Assertions: add (append) ===');
  await tap('btn-add');
  assert(pending()!.removeAction.length === 0, 'append is incremental (no removeAction)');
  assert(pending()!.insertAction.length === 1, 'only the new item is announced');
  driveList(listEl);
  assert(names().length === 4 && names()[3] === 'Contact 4', 'new cell appended at the end');

  // ---- remove (resync) ----------------------------------------------------
  console.log('\n=== Assertions: remove first (resync) ===');
  await tap('btn-remove');
  const ra = pending()!.removeAction as unknown[];
  assert(ra.length > 0, 'removal triggers a resync (removeAction present)');
  // The native <list> walks removeAction with `children[position - i]`, so the
  // entries must be ascending plain numbers — objects or descending order leave
  // cells un-removed and duplicate item-keys (device error 2202/220208).
  assert(ra.every((p) => typeof p === 'number'), 'removeAction entries are plain numbers');
  assert(
    ra.every((p, i) => i === 0 || (p as number) > (ra[i - 1] as number)),
    'removeAction positions are ascending',
  );
  driveList(listEl);
  assert(
    names().join(',') === 'Alan Turing,Grace Hopper,Contact 4',
    'first cell removed; remaining order preserved (no duplicated cells)',
  );

  // ---- reorder (resync) ---------------------------------------------------
  console.log('\n=== Assertions: reverse (reorder) ===');
  await tap('btn-reverse');
  assert(pending()!.removeAction.length > 0, 'reorder triggers a resync');
  // A reorder moves cells via REMOVE + INSERT of the same childId. The moved
  // cells must keep their real item-key (the contact id), not fall back to the
  // BG element id — otherwise the native <list> sees the whole keyset replaced.
  const movedKeys = (pending()!.insertAction as Record<string, unknown>[]).map((a) =>
    String(a['item-key']),
  );
  assert(
    movedKeys.every((k) => ['2', '3', '4'].includes(k)),
    `moved cells keep their item-key (got ${JSON.stringify(movedKeys)}, expected contact ids)`,
  );
  driveList(listEl);
  console.log(printTree(listEl).join('\n'));
  assert(
    names().join(',') === 'Contact 4,Grace Hopper,Alan Turing',
    'cells reordered to match the reversed signal',
  );

  console.log('\n✅ All list assertions passed — add / remove / reorder work end-to-end.\n');
}

main().catch((err) => {
  console.error('\n❌ List verification failed:\n', err);
  process.exit(1);
});
