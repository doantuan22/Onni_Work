import { describe, expect, it } from 'vitest';
import { createHiddenInput } from './secrets-cli.ts';

/** Feed byte chunks to the hidden prompt's editor and return the value it ends with. */
function typed(...chunks: Buffer[]): string | 'cancelled' | undefined {
  const input = createHiddenInput();
  for (const chunk of chunks) {
    const outcome = input.feed(chunk);
    if (outcome.status === 'done') return outcome.value;
    if (outcome.status === 'cancelled') return 'cancelled';
  }
  return undefined;
}

const SECRET = 'key-é€🙂-ñ-𝒳';

describe('hidden secret prompt', () => {
  it('keeps every character when a paste is split at any byte offset', () => {
    const bytes = Buffer.from(`${SECRET}\r`, 'utf8');
    for (let cut = 1; cut < bytes.length; cut++) {
      expect(typed(bytes.subarray(0, cut), bytes.subarray(cut)), `cut at byte ${cut}`).toBe(SECRET);
    }
  });

  it('keeps every character when each byte arrives alone', () => {
    const bytes = Buffer.from(`${SECRET}\r`, 'utf8');
    expect(typed(...Array.from(bytes, (byte) => Buffer.from([byte])))).toBe(SECRET);
  });

  it('backspace removes a whole emoji, not half of its surrogate pair', () => {
    expect(typed(Buffer.from('ab🙂\u007f\r'))).toBe('ab');
    expect(typed(Buffer.from('🙂\u007f\r'))).toBe('');
    expect(typed(Buffer.from('𝒳\b\r'))).toBe('');
  });

  it('backspace removes one ordinary character, and nothing from an empty value', () => {
    expect(typed(Buffer.from('abc\u007f\r'))).toBe('ab');
    expect(typed(Buffer.from('\u007f\u007f\r'))).toBe('');
  });

  it('Ctrl-C cancels and Enter submits at either line ending', () => {
    expect(typed(Buffer.from('abc\u0003'))).toBe('cancelled');
    expect(typed(Buffer.from('abc\n'))).toBe('abc');
    expect(typed(Buffer.from('abc'))).toBeUndefined();
  });
});
