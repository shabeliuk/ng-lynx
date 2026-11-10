/**
 * Streamed response body → text, on both runtimes the planner ships to.
 *
 * - **Browser / web preview:** chunks are `Uint8Array`s; `TextDecoder` exists.
 * - **Lynx on device (PrimJS):** there is no `TextDecoder`; Lynx provides
 *   `TextCodecHelper.decode(arraybuffer)`, and streamed chunks arrive as
 *   `ArrayBuffer`s (Lynx docs → Networking → "Using Streaming Fetch").
 *
 * The first version of this code assumed browser `Uint8Array` chunks: on
 * device `value.length` was `undefined` on an `ArrayBuffer`, every chunk was
 * silently dropped, and a perfectly good model response arrived as `""` —
 * reported as "there is no root statement". Found on the iOS simulator;
 * `test/stream-text.test.ts` simulates PrimJS so it can't regress.
 *
 * Chunks are re-decoded as one buffer each time, so a `£`/`€` split across
 * two chunks is never mangled (responses are a few kB, so that's cheap).
 */

export type Utf8Decoder = (bytes: Uint8Array) => string;

interface CodecGlobals {
  TextDecoder?: new () => { decode(bytes: Uint8Array): string };
  TextCodecHelper?: { decode(buffer: ArrayBuffer): string };
}

/** The exact bytes of a view as a standalone `ArrayBuffer` (what `TextCodecHelper` wants). */
function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

/** `TextDecoder` where it exists, else Lynx's `TextCodecHelper`, else nothing. */
export function createUtf8Decoder(globals: CodecGlobals = globalThis as CodecGlobals): Utf8Decoder | undefined {
  const Decoder = globals.TextDecoder;
  if (Decoder) return (bytes) => new Decoder().decode(bytes);
  const helper = globals.TextCodecHelper;
  if (helper) return (bytes) => helper.decode(exactBuffer(bytes));
  return undefined;
}

/** A stream chunk as bytes, whatever shape the runtime delivered it in. */
export function chunkBytes(chunk: unknown): Uint8Array | undefined {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  return undefined;
}

/** Accumulates streamed chunks; `push` returns the full text so far. */
export class StreamText {
  private bytes = new Uint8Array(0);
  private strings = '';
  private readonly decode: Utf8Decoder;

  constructor(decode: Utf8Decoder) {
    this.decode = decode;
  }

  push(chunk: unknown): string {
    // Some runtimes hand back text directly.
    if (typeof chunk === 'string') {
      this.strings += chunk;
      return this.text();
    }
    const next = chunkBytes(chunk);
    if (next && next.byteLength > 0) {
      const merged = new Uint8Array(this.bytes.byteLength + next.byteLength);
      merged.set(this.bytes);
      merged.set(next, this.bytes.byteLength);
      this.bytes = merged;
    }
    return this.text();
  }

  text(): string {
    return this.strings + (this.bytes.byteLength > 0 ? this.decode(this.bytes) : '');
  }

  get byteLength(): number {
    return this.bytes.byteLength + this.strings.length;
  }
}
