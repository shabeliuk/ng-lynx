/**
 * Data processors: normalising what a native host passes, before the app sees it
 * (https://lynxjs.org/guide/use-data-from-host-platform). The engine calls
 * `globalThis.processData(data, processorName?)` on the Main Thread for init data
 * and for each `updateData`, then hands the result to the Background Thread.
 *
 * The definition is held here and read on each call, so a processor registered from
 * a `mainThreadModules` module works whichever order it and the entry evaluate in.
 */

/** Takes what the host passed and returns what the app should see. @public */
// biome-ignore lint/suspicious/noExplicitAny: each app has its own host data shape
export type LynxDataProcessor = (rawData: any) => any;

/** The argument of `mainThreadLynx.registerDataProcessors()`. @public */
export interface LynxDataProcessorDefinition {
  /** Runs on init data and on any `updateData` that doesn't name a processor. */
  defaultDataProcessor?: LynxDataProcessor;
  /** Run when the host names one with its `processorName`. */
  dataProcessors?: Record<string, LynxDataProcessor>;
}

/** `LYNX_ERROR_CODE_LEPUS` in the engine's `base/debug/error_code.h`. */
const LEPUS_ERROR_CODE = 1101;

let definition: LynxDataProcessorDefinition | undefined;

export function registerDataProcessors(next: LynxDataProcessorDefinition): void {
  definition = next;
}

/** Installed as `globalThis.processData`. Same contract as ReactLynx's. */
export function processData(data: unknown, processorName?: string): unknown {
  try {
    const processor = processorName
      ? definition?.dataProcessors?.[processorName]
      : definition?.defaultDataProcessor;
    return processor?.(data) ?? data ?? {};
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (typeof _ReportError === 'function') _ReportError(error, { errorCode: LEPUS_ERROR_CODE });
    else console.warn(error);
    // As if the processor returned nothing the app can use, not the raw data.
    return {};
  }
}
