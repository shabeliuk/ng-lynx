/**
 * Headless verification of data processors, against the contract in Lynx's guide and
 * ReactLynx: the engine calls `globalThis.processData(data, processorName?)` on the Main
 * Thread.
 *
 * What reaches the Background Thread on a real engine is checked by the `host-data` flow
 * in packages/device-tests.
 *
 * Run with: `npm run verify:data-processors`.
 */
import 'angular-lynx/main-thread';
import { mainThreadLynx } from 'angular-lynx/worklet';

import { assert, installMockPapi } from './mock-papi.js';

installMockPapi();
const g = globalThis as unknown as {
  processData(data: unknown, processorName?: string): unknown;
  _ReportError?: (error: Error, info: { errorCode: number }) => void;
};
const reported: { error: Error; errorCode: number }[] = [];
g._ReportError = (error, { errorCode }) => void reported.push({ error, errorCode });

console.log('\n=== Nothing registered ===');
const raw = { pageTitle: 'hello' };
assert(g.processData(raw) === raw, 'data passes through');
assert(g.processData(raw, 'named') === raw, 'a named call passes through too');
const empty = g.processData(undefined) as object;
assert(typeof empty === 'object' && Object.keys(empty).length === 0, 'no data at all gives {}');

console.log('\n=== Registered ===');
mainThreadLynx.registerDataProcessors({
  defaultDataProcessor: (data: { pageTitle: string }) => ({ title: data.pageTitle }),
  dataProcessors: {
    upper: (data: { pageTitle: string }) => ({ title: data.pageTitle.toUpperCase() }),
    nothing: () => undefined,
    broken: () => {
      throw new Error('processor failed');
    },
  },
});
assert((g.processData(raw) as { title: string }).title === 'hello', 'the default processor runs');
assert((g.processData(raw, 'upper') as { title: string }).title === 'HELLO', 'a named processor runs');
assert(g.processData(raw, 'missing') === raw, 'an unknown name passes the data through');
assert(g.processData(raw, 'nothing') === raw, 'a processor returning nothing keeps the data');

console.log('\n=== A processor that throws ===');
const failed = g.processData(raw, 'broken') as object;
assert(Object.keys(failed).length === 0, 'gives {}, not the unprocessed data');
assert(reported.length === 1 && reported[0]!.error.message === 'processor failed', 'is reported');
assert(reported[0]!.errorCode === 1101, 'with the Main Thread error code');

console.log('\n=== A later registration replaces the earlier one ===');
mainThreadLynx.registerDataProcessors({});
assert(g.processData(raw) === raw, 'the old default processor is gone');

console.log('\n✅ All data-processor assertions passed.\n');
