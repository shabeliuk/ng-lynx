/**
 * Unit-level verification of the wire-protocol string table
 * (`internStrings`/`resolveInterned`, `internal/src/ops.ts`) — the edge cases
 * a full render doesn't reliably exercise. Where `harness-wireproto-measure`
 * proves the end-to-end effect through a real 500-row render, this pins down
 * the encoder/decoder contract directly:
 *
 *  1. round-trip identity — `resolveInterned(internStrings(x))` deep-equals
 *     `x` for a representative batch;
 *  2. numeric `SET_ATTR` *values* are never mistaken for table indices (the
 *     one ambiguity the design deliberately excludes — a real attribute value
 *     can itself be a number, e.g. `[volume]="1.5"`);
 *  3. singleton strings stay inline (interning a once-used value is a net loss);
 *  4. a batch with nothing repeated is returned `===`-unchanged, so its
 *     serialized bytes are byte-for-byte identical to the pre-feature protocol
 *     (the first-screen snapshot's byte-equality hydration depends on this);
 *  5. table indices are assigned in first-appearance order, so identical ops
 *     always produce an identical table + payload (also required for the
 *     snapshot's byte-for-byte match);
 *  6. an empty batch is a no-op;
 *  7. `resolveInterned` is idempotent on an already-plain array (callers may
 *     resolve twice — see `first-screen.ts`).
 *
 * Pure functions, no PAPI/render needed. Run: `npm run verify:wireproto-intern`.
 */
import { encodeOps, internStrings, OP, resolveInterned } from 'angular-lynx/internal/ops';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`  ✓ ${msg}`);
}
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function main(): void {
  console.log('\n=== Round-trip identity (repeated strings) ===');
  {
    // Two rows: same CREATE type ("view"/"text"), same class ("row"/"label"),
    // same event type/name — everything that repeats across rows.
    const flat = [
      OP.CREATE, 2, 'view', OP.SET_CLASS, 2, 'row', OP.SET_EVENT, 2, 'bindEvent', 'tap', 'ng:0',
      OP.CREATE, 3, 'text', OP.SET_CLASS, 3, 'label', OP.SET_TEXT, 3, 'row 0',
      OP.CREATE, 4, 'view', OP.SET_CLASS, 4, 'row', OP.SET_EVENT, 4, 'bindEvent', 'tap', 'ng:1',
      OP.CREATE, 5, 'text', OP.SET_CLASS, 5, 'label', OP.SET_TEXT, 5, 'row 1',
    ];
    const wire = internStrings(flat);
    assert(Array.isArray(wire[0]), 'repeated batch took the [table, ops] shape');
    const table = wire[0] as string[];
    assert(table.includes('view') && table.includes('row') && table.includes('label') && table.includes('tap'),
      'table holds the repeated strings (view/row/label/tap)');
    assert(!table.includes('row 0') && !table.includes('row 1'),
      'unique per-row SET_TEXT values are NOT in the table');
    assert(!table.includes('ng:0') && !table.includes('ng:1'),
      'unique event signs are NOT interned (each is used once)');
    assert(eq(resolveInterned(wire), flat), 'resolveInterned(internStrings(flat)) deep-equals the original');
    assert(JSON.stringify(wire).length < JSON.stringify(flat).length, 'the compressed form is smaller');
  }

  console.log('\n=== Numeric SET_ATTR values are never confused with table indices ===');
  {
    // Two elements both set attr key "volume" (repeats → interned) to numeric
    // values 0 and 1 (which collide with table indices 0/1 if misread).
    const flat = [
      OP.SET_ATTR, 2, 'volume', 0,
      OP.SET_ATTR, 3, 'volume', 1,
      OP.SET_ATTR, 4, 'volume', 2,
    ];
    const wire = internStrings(flat);
    assert(Array.isArray(wire[0]), '"volume" key repeated → interned');
    const restored = resolveInterned(wire);
    assert(eq(restored, flat), 'numeric attr values 0/1/2 survive the round-trip unchanged');
    // Explicitly confirm the values are still the raw numbers, not table lookups.
    assert(restored[3] === 0 && restored[7] === 1 && restored[11] === 2,
      'attr values read back as the literal numbers 0, 1, 2 — not resolved as table[0/1/2]');
  }

  console.log('\n=== Singleton strings stay inline ===');
  {
    // Every string used exactly once — nothing worth a table.
    const flat = [OP.CREATE, 2, 'view', OP.SET_CLASS, 2, 'header', OP.SET_TEXT, 2, 'hello'];
    const wire = internStrings(flat);
    assert(wire === flat, 'a batch with no repeats is returned ===-unchanged (no table wrapper)');
    assert(typeof wire[0] === 'number', 'the unchanged batch still starts with a plain op code');
  }

  console.log('\n=== Byte-stability: same ops → same bytes (first-screen hydration) ===');
  {
    const build = () => [
      OP.CREATE, 2, 'view', OP.SET_CLASS, 2, 'card',
      OP.CREATE, 3, 'view', OP.SET_CLASS, 3, 'card',
    ];
    const a = JSON.stringify(internStrings(build()));
    const b = JSON.stringify(internStrings(build()));
    assert(a === b, 'identical ops produce byte-for-byte identical compressed payloads');
    // First-appearance order: "view" is seen before "card", so table = [view, card].
    const table = (internStrings(build())[0]) as string[];
    assert(eq(table, ['view', 'card']), 'table indices are assigned in first-appearance order');
  }

  console.log('\n=== Empty batch is a no-op ===');
  {
    assert(eq(internStrings([]), []), 'internStrings([]) === []');
    assert(eq(resolveInterned([]), []), 'resolveInterned([]) === []');
  }

  console.log('\n=== resolveInterned is idempotent on a plain array ===');
  {
    const flat = encodeOps([{ code: OP.CREATE, args: [2, 'view'] }]);
    assert(eq(resolveInterned(flat), flat), 'resolving an already-plain array returns it unchanged');
    assert(eq(resolveInterned(resolveInterned(internStrings(
      [OP.CREATE, 2, 'view', OP.CREATE, 3, 'view'],
    ))), [OP.CREATE, 2, 'view', OP.CREATE, 3, 'view']),
      'resolving twice (plain → plain) is safe');
  }

  console.log(`\n✅ String-table encode/decode verified — all ${passed} assertions passed.\n`);
  process.exit(0);
}

main();
