import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { isJsonObject, readNdjson } from './ndjson.ts';

const collect = async (chunks: Array<Buffer | string>): Promise<string[]> => {
  const lines: string[] = [];
  for await (const line of readNdjson(Readable.from(chunks, { objectMode: false }))) lines.push(line);
  return lines;
};

describe('readNdjson', () => {
  const text = '{"a":"Kiểm tra ệ"}\n\n  {"b":2}  \r\n{"c":"😀"}\n{"d":4}';
  const expected = ['{"a":"Kiểm tra ệ"}', '{"b":2}', '{"c":"😀"}', '{"d":4}'];

  it('yields trimmed non-empty lines, including an unterminated last one', async () => {
    expect(await collect([Buffer.from(text)])).toEqual(expected);
  });

  it('gives the same lines however the bytes are cut into chunks — every offset, and byte by byte', async () => {
    const bytes = Buffer.from(text);
    for (let cut = 0; cut <= bytes.length; cut += 1) {
      expect(await collect([bytes.subarray(0, cut), bytes.subarray(cut)]), `cut at ${cut}`).toEqual(expected);
    }
    expect(await collect([...bytes].map((byte) => Buffer.from([byte])))).toEqual(expected);
  });

  it('finds a newline that arrives alone in its own chunk', async () => {
    expect(await collect(['{"a":1}', '\n', '{"b":2}', '\n'])).toEqual(['{"a":1}', '{"b":2}']);
  });

  // The buffer used to be re-scanned from its start on every chunk, so one long line (a big tool
  // result) cost time quadratic in its size, all of it on the event loop: 32 MB took ~2 s, 64 MB ~8 s.
  it('reads one very long line in time linear in its size', async () => {
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const chunks = Array.from({ length: 512 }, () => chunk); // 32 MB without a newline
    const started = performance.now();
    const lines = await collect([...chunks, Buffer.from('\n')]);
    expect(performance.now() - started).toBeLessThan(750);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(32 * 1024 * 1024);
  }, 30_000);
});

describe('isJsonObject', () => {
  it.each(['null', '42', '0', 'true', '"text"', '[]', '[1,2]'])('refuses the valid JSON %s', (text) => {
    expect(isJsonObject(JSON.parse(text))).toBe(false);
  });

  it('accepts an object, including an empty one', () => {
    expect(isJsonObject(JSON.parse('{}'))).toBe(true);
    expect(isJsonObject(JSON.parse('{"type":"result"}'))).toBe(true);
  });
});
