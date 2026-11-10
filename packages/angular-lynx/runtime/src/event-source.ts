/**
 * Server-sent events — `lynxEventSource()`.
 *
 * Lynx has an `EventSource` (`lynx.EventSource`, engine 3.5+), but on iOS it
 * never delivers an event. It asks fetch for the older `useStreaming` mode, and
 * the stock iOS HTTP service parses that stream as raw `Transfer-Encoding:
 * chunked` framing, which `NSURLSession` has already removed: no chunk is ever
 * found, and only the end of the stream gets through (measured on Explorer 4.2,
 * iOS simulator, 2026-11-09). Upstream fixed it on `develop` on 2026-09-22
 * (2cf3d045f7, "SSE-aware streaming"); 4.2.0 doesn't include it.
 *
 * So this reads the stream itself, through fetch's standard streaming mode,
 * which passes the bytes through, and parses the events here. That mode is a
 * page setting:
 *
 * ```ts
 * // lynx.config.ts
 * import { pluginLynxConfig } from '@lynx-js/config-rsbuild-plugin';
 * plugins: [pluginAngularLynx(), pluginLynxConfig({ enableFetchAPIStandardStreaming: true })]
 * ```
 *
 * Without it, the response has no stream to read, and the Observable errors
 * saying so. The web preview's worker uses the browser's own fetch, which
 * always streams.
 */
import { Observable } from 'rxjs';

/** One server-sent event. @public */
export interface LynxServerEvent {
  /** The event's name: `'message'` for unnamed events. */
  type: string;
  /** The event's data: its `data:` lines, joined with `\n`. */
  data: string;
  /** The `id:` field, when the server sent one. */
  lastEventId?: string;
}

/** Options for {@link lynxEventSource}. @public */
export interface LynxEventSourceOptions {
  /**
   * Named events to receive (`event: <name>` in the stream). Unnamed events
   * always arrive, as `'message'`; named ones only when listed, as in a browser.
   */
  events?: readonly string[];
  /** Extra request headers. `Accept: text/event-stream` is always sent. */
  headers?: Record<string, string>;
}

interface StreamReader {
  read(): Promise<{ done: boolean; value?: ArrayBuffer | Uint8Array }>;
  cancel?(reason?: unknown): unknown;
}

interface StreamingResponse {
  ok: boolean;
  status: number;
  readonly body: { getReader(): StreamReader } | null;
}

type FetchFn = (url: string, init?: Record<string, unknown>) => Promise<StreamingResponse>;

// eslint-disable-next-line no-var
declare var lynx: { fetch?: FetchFn } | null | undefined;

function fetchFn(): FetchFn | undefined {
  const fromLynx = typeof lynx !== 'undefined' ? lynx?.fetch : undefined;
  if (fromLynx) return fromLynx.bind(lynx);
  const global = (globalThis as { fetch?: FetchFn }).fetch;
  return global?.bind(globalThis);
}

/** Decode UTF-8 chunk by chunk, keeping a character split across chunks whole. */
function utf8Decoder(): (chunk: Uint8Array) => string {
  const Decoder = (globalThis as { TextDecoder?: new () => { decode(b: Uint8Array, o?: { stream: boolean }): string } })
    .TextDecoder;
  if (Decoder) {
    const decoder = new Decoder();
    return (chunk) => decoder.decode(chunk, { stream: true });
  }
  // Lynx's own helper, which the engine's fetch uses: no streaming option.
  const helper = (globalThis as { TextCodecHelper?: { decode(b: ArrayBuffer | Uint8Array): string } }).TextCodecHelper;
  return (chunk) => helper?.decode(chunk) ?? '';
}

/**
 * Split a server-sent-events text stream into events, per the WHATWG rules:
 * blank lines end an event, `:` lines are comments, and `data:` lines join
 * with `\n`. Feed it text as it arrives; it calls `onEvent` for each complete
 * event and keeps the rest for the next chunk.
 *
 * @internal Exported for the verify harness.
 */
export function createSseParser(onEvent: (event: LynxServerEvent) => void): (text: string) => void {
  let buffer = '';
  let data: string[] = [];
  let type = '';
  let id: string | undefined;
  const dispatch = (): void => {
    if (data.length > 0) {
      onEvent({ type: type || 'message', data: data.join('\n'), ...(id !== undefined ? { lastEventId: id } : {}) });
    }
    data = [];
    type = '';
  };
  return (text) => {
    buffer += text;
    // Keep a trailing '\r' back: it may be the first half of a '\r\n'.
    let lineEnd: number;
    while ((lineEnd = buffer.search(/\r\n|\r(?=[^\n])|\n/)) !== -1) {
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + (buffer.startsWith('\r\n', lineEnd) ? 2 : 1));
      if (line === '') {
        dispatch();
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'event') type = value;
      else if (field === 'id' && !value.includes('\0')) id = value;
    }
  };
}

/**
 * Listen to a server-sent events stream.
 *
 * ```ts
 * readonly prices = toSignal(lynxEventSource('https://example.com/prices'));
 * ```
 *
 * - The Observable completes when the server closes the stream, and errors
 *   when the request fails. Unlike a browser's `EventSource`, it doesn't
 *   reconnect on its own: add RxJS `retry()` or `repeat()` for that.
 * - Unsubscribing aborts the request.
 * - On a device it needs fetch's standard streaming mode (see this module's
 *   doc, and docs/29-platform-apis.md).
 *
 * @public
 */
export function lynxEventSource(
  url: string,
  options: LynxEventSourceOptions = {},
): Observable<LynxServerEvent> {
  return new Observable<LynxServerEvent>((subscriber) => {
    const fetch = fetchFn();
    if (!fetch) {
      subscriber.error(new Error('[angular-lynx] lynxEventSource: this engine has no fetch.'));
      return undefined;
    }
    const wanted = new Set(['message', ...(options.events ?? [])]);
    const parse = createSseParser((event) => {
      if (wanted.has(event.type)) subscriber.next(event);
    });
    const decode = utf8Decoder();
    const Abort = (globalThis as { AbortController?: new () => { signal: unknown; abort(): void } }).AbortController;
    const controller = Abort ? new Abort() : undefined;
    let reader: StreamReader | undefined;
    let stopped = false;

    void (async () => {
      try {
        const response = await fetch(url, {
          headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache', ...options.headers },
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (!response.ok) throw new Error(`[angular-lynx] lynxEventSource: HTTP ${response.status} from ${url}`);
        const body = response.body;
        if (!body?.getReader) {
          throw new Error(
            '[angular-lynx] lynxEventSource: the response has no stream to read. On a device, turn on '
              + "fetch's standard streaming: pluginLynxConfig({ enableFetchAPIStandardStreaming: true }) "
              + 'in lynx.config.ts. See docs/29-platform-apis.md.',
          );
        }
        reader = body.getReader();
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) parse(decode(value instanceof Uint8Array ? value : new Uint8Array(value)));
        }
        if (!stopped) subscriber.complete();
      } catch (err) {
        if (!stopped) subscriber.error(err);
      }
    })();

    return () => {
      stopped = true;
      controller?.abort();
      void reader?.cancel?.();
    };
  });
}
