import { describe, expect, it } from 'vitest';
import { parseCodexLine } from './codex-app-server-runner.ts';
import { parseJunieLine } from './junie-runner.ts';
import { parseOpencodeSseFrame } from './opencode-server-runner.ts';

/**
 * E12 — a line that is valid JSON but not an object (`null`, `42`, `true`…) must be skipped like an
 * unparseable one: the loops that read `.method` / `.type` off it used to throw `TypeError` and end the
 * whole session. claude has a process-level test (`claude-cli-runner.test.ts`); codex and junie speak a
 * handshake protocol too long to stub, so their line step is a pure function tested here, and opencode's
 * SSE frame step likewise.
 */
const STRAY = ['null', '42', 'true', 'false', '"text"', '[]', '[1,2]', '0', 'not json at all', '{"unterminated":', '', '   '];

describe.each([
  { name: 'codex', parse: parseCodexLine, wrap: (line: string) => line, valid: { jsonrpc: '2.0', method: 'turn/started', params: { n: 1 } }, read: (m: Record<string, unknown>) => m.method },
  { name: 'junie', parse: parseJunieLine, wrap: (line: string) => line, valid: { jsonrpc: '2.0', id: 7, result: { ok: true } }, read: (m: Record<string, unknown>) => m.id },
  { name: 'opencode (SSE)', parse: parseOpencodeSseFrame, wrap: (line: string) => `data: ${line}`, valid: { type: 'session.idle', properties: { sessionID: 's1' } }, read: (m: Record<string, unknown>) => m.type },
] as const)('$name line step', ({ parse, wrap, valid, read }) => {
  it.each(STRAY)('skips %j without throwing', (line) => {
    const run = () => parse(wrap(line));
    expect(run).not.toThrow();
    expect(run()).toBeNull();
  });

  it('still returns a real object, so the consumer can read its fields', () => {
    const msg = parse(wrap(JSON.stringify(valid)));
    expect(msg).toEqual(valid);
    expect(read(msg as Record<string, unknown>)).toBe(read(valid));
  });

  it('treats an empty object as an object (nothing to read, nothing thrown)', () => {
    expect(parse(wrap('{}'))).toEqual({});
  });
});

describe('opencode SSE frames', () => {
  it('skips a frame with no data line', () => {
    expect(parseOpencodeSseFrame(': keep-alive\n')).toBeNull();
    expect(parseOpencodeSseFrame('event: ping')).toBeNull();
  });

  it('joins multi-line data before parsing', () => {
    expect(parseOpencodeSseFrame('data: {"type":\ndata: "session.idle"}')).toEqual({ type: 'session.idle' });
  });
});
