/**
 * Dev op-stream logger — the renderer's "Elements panel" for a platform with
 * no DOM inspector.
 *
 * Angular DevTools can't attach to a Lynx app (no DOM, no Chrome bridge), so
 * when a screen renders wrong it's hard to see *what* the renderer actually
 * sent. Enable this and every flush prints its decoded ops in a readable form:
 *
 * ```
 * [ng-lynx] flush (7 ops)
 *   CREATE      #2 view
 *   INSERT      #2 → #1
 *   CREATE_TEXT #3
 *   SET_TEXT    #3 "Count: 0"
 *   INSERT      #3 → #2
 *   SET_CLASS   #2 "app"
 *   SET_STYLE   #2 "opacity: 1"
 * ```
 *
 * It is **runtime-toggleable** (default off), not compile-time gated, so it
 * works in any build when explicitly enabled and can be driven by tests. When
 * off, the cost per flush is a single boolean check.
 */
import { coalesceOps, decodeOps, OP } from 'ng-lynx/internal/ops';

/** Reverse map: op code → name, built once from the OP table. */
const OP_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(OP).map(([name, code]) => [code, name]),
);

/** Where formatted lines go. Default is `console.log`; overridable for tests. */
export type OpLogSink = (line: string) => void;

let sink: OpLogSink | null = null;

/**
 * Start logging the op stream. Each flush prints a header plus one line per op.
 * Pass a `sink` to capture lines instead of printing (tests, a custom overlay).
 *
 * @public
 */
export function enableLynxOpLogging(options: { sink?: OpLogSink } = {}): void {
  sink = options.sink ?? ((line) => console.log(line));
}

/**
 * Stop logging the op stream.
 * @public
 */
export function disableLynxOpLogging(): void {
  sink = null;
}

/** Format one decoded op into a fixed-width, readable line. */
function formatOp(code: number, args: unknown[]): string {
  const name = (OP_NAME[code] ?? `OP_${code}`).padEnd(11);
  switch (code) {
    case OP.CREATE:
      return `${name} #${args[0]} ${args[1]}`;
    case OP.CREATE_MAPPED:
      return `${name} #${args[0]} ${args[1]}${args[2] ? ` (nodeIndex ${args[2]})` : ''}`;
    case OP.CREATE_TEXT:
      return `${name} #${args[0]}`;
    case OP.INSERT: {
      const anchor = args[2] === -1 ? 'append' : `before #${args[2]}`;
      return `${name} #${args[1]} → #${args[0]} (${anchor})`;
    }
    case OP.REMOVE:
      return `${name} #${args[1]} from #${args[0]}`;
    case OP.SET_ATTR:
      return `${name} #${args[0]} ${args[1]}=${JSON.stringify(args[2])}`;
    case OP.REMOVE_ATTR:
      return `${name} #${args[0]} ${args[1]}`;
    case OP.SET_TEXT:
    case OP.SET_STYLE:
    case OP.SET_CLASS:
      return `${name} #${args[0]} ${JSON.stringify(args[1])}`;
    case OP.SET_EVENT:
    case OP.SET_WORKLET_EVENT:
      return `${name} #${args[0]} ${args[1]} ${args[2]}`;
    case OP.REMOVE_EVENT:
      return `${name} #${args[0]} ${args[1]} ${args[2]}`;
    case OP.DESTROY:
      return `${name} #${args[0]}`;
    case OP.SET_REF:
      return `${name} #${args[0]} → ref ${args[1]}`;
    default:
      return `${name} ${args.map((a) => JSON.stringify(a)).join(' ')}`;
  }
}

/**
 * Log one flush's ops, coalesced. Called by `flushOps`. A no-op (single
 * boolean check) when logging is disabled.
 *
 * @internal
 */
export function logFlush(flat: unknown[]): void {
  if (!sink) return;
  const records = decodeOps(coalesceOps(flat));
  sink(`[ng-lynx] flush (${records.length} ops)`);
  for (const { code, args } of records) sink(`  ${formatOp(code, args)}`);
}

/** Reset module state — for testing only. @internal */
export function resetOpLogger(): void {
  sink = null;
}
