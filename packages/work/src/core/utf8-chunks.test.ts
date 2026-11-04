import { describe, expect, it } from 'vitest';
import { utf8Collector } from './utf8-chunks.ts';

const collect = (chunks: Buffer[]) => {
  let text = '';
  const collector = utf8Collector((piece) => (text += piece));
  for (const chunk of chunks) collector.write(chunk);
  collector.end();
  return text;
};

describe('utf8Collector', () => {
  const sample = 'Kiểm tra ệ 日本語 😀 done';
  const bytes = Buffer.from(sample, 'utf8');

  it('rebuilds the text however the bytes are cut — at every offset, and into single bytes', () => {
    for (let cut = 0; cut <= bytes.length; cut += 1) {
      expect(collect([bytes.subarray(0, cut), bytes.subarray(cut)]), `cut at ${cut}`).toBe(sample);
    }
    expect(collect([...bytes].map((byte) => Buffer.from([byte])))).toBe(sample);
  });

  it('is what a per-chunk toString is not: that turns a split character into U+FFFD', () => {
    const cut = bytes.indexOf(Buffer.from('ệ')) + 1;
    const naive = bytes.subarray(0, cut).toString('utf8') + bytes.subarray(cut).toString('utf8');
    expect(naive).toContain('\uFFFD');
    expect(collect([bytes.subarray(0, cut), bytes.subarray(cut)])).not.toContain('\uFFFD');
  });

  it('flushes a stream that ends mid-character, and passes already-decoded strings through', () => {
    expect(collect([bytes.subarray(0, bytes.indexOf(Buffer.from('😀')) + 2)])).toContain('\uFFFD');
    let text = '';
    const collector = utf8Collector((piece) => (text += piece));
    collector.write('already text');
    expect(text).toBe('already text');
  });
});
