/**
 * Streamed bodies must decode on Lynx's PrimJS, not just in a browser: no
 * `TextDecoder`, `TextCodecHelper.decode(ArrayBuffer)` only, and chunks that
 * arrive as `ArrayBuffer`s. The first reader assumed browser `Uint8Array`
 * chunks and turned a good model response into "" on the iOS simulator.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chunkBytes, createUtf8Decoder, StreamText } from '../src/planner/stream-text.ts';

const SCREEN = 'root = Stack([t])\nt = Text("Pot needed: £1,058,048 · €12")';

/** Split `text`'s UTF-8 bytes into chunks of `size`, cutting through multi-byte characters. */
function chunks(text: string, size: number, as: 'arraybuffer' | 'uint8' | 'dataview'): unknown[] {
  const bytes = new TextEncoder().encode(text);
  const out: unknown[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    const piece = bytes.slice(i, i + size);
    out.push(as === 'arraybuffer' ? piece.buffer : as === 'dataview' ? new DataView(piece.buffer) : piece);
  }
  return out;
}

/** What Lynx's PrimJS offers: no TextDecoder, a helper that only takes an ArrayBuffer. */
const primjs = {
  TextCodecHelper: {
    decode(buffer: ArrayBuffer): string {
      if (!(buffer instanceof ArrayBuffer)) throw new TypeError('TextCodecHelper.decode expects an ArrayBuffer');
      return new TextDecoder().decode(buffer);
    },
  },
};

describe('StreamText', () => {
  for (const size of [1, 3, 7, 64]) {
    it(`PrimJS: ArrayBuffer chunks of ${size} bytes decode exactly`, () => {
      const stream = new StreamText(createUtf8Decoder(primjs)!);
      let last = '';
      for (const chunk of chunks(SCREEN, size, 'arraybuffer')) last = stream.push(chunk);
      assert.equal(last, SCREEN);
      assert.equal(stream.text(), SCREEN);
    });
  }

  it('browser: Uint8Array chunks with TextDecoder', () => {
    const stream = new StreamText(createUtf8Decoder()!);
    for (const chunk of chunks(SCREEN, 5, 'uint8')) stream.push(chunk);
    assert.equal(stream.text(), SCREEN);
  });

  it('other views (DataView) and plain strings', () => {
    const stream = new StreamText(createUtf8Decoder(primjs)!);
    for (const chunk of chunks('root = Stack([])', 4, 'dataview')) stream.push(chunk);
    assert.equal(stream.text(), 'root = Stack([])');
    const text = new StreamText(createUtf8Decoder(primjs)!);
    text.push('root = ');
    assert.equal(text.push('Stack([])'), 'root = Stack([])');
  });

  it('hands TextCodecHelper an exact ArrayBuffer for a view into a larger buffer', () => {
    const big = new TextEncoder().encode('xxxxhello£yyyy');
    const view = new Uint8Array(big.buffer, 4, 'hello£'.length + 1);
    assert.equal(createUtf8Decoder(primjs)!(view), 'hello£');
  });

  it('ignores chunk shapes it cannot read instead of corrupting the text', () => {
    assert.equal(chunkBytes({ length: 3 }), undefined);
    const stream = new StreamText(createUtf8Decoder(primjs)!);
    stream.push({ length: 3 });
    assert.equal(stream.push(new TextEncoder().encode('ok').buffer), 'ok');
  });

  it('no decoder available → undefined (caller falls back to res.text())', () => {
    assert.equal(createUtf8Decoder({}), undefined);
  });
});
