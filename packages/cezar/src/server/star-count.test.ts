import { describe, expect, it } from 'vitest';
import { CEZAR_REPO_URL, StarCountReader } from './star-count.ts';

/**
 * Onni Work never reads a star count: `StarCountReader` is the route's only reader and it must
 * answer the frozen unavailable payload without any I/O — no fetch, no cache file, no throw.
 */
describe('star count — always unavailable, never a request', () => {
  it('answers `{ available: false }` in the contract shape', async () => {
    await expect(new StarCountReader().read()).resolves.toEqual({
      available: false,
      url: CEZAR_REPO_URL,
    });
  });

  it('hands the same frozen object to every caller', async () => {
    const reader = new StarCountReader();
    const [first, second] = await Promise.all([reader.read(), reader.read()]);
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
