import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readStateFile, revisionOf, withPathLock, writeAtomic } from './state-file.ts';

const dirs: string[] = [];

function tempPath(name = 'state.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'onni-state-file-'));
  dirs.push(dir);
  return join(dir, name);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('revisionOf', () => {
  it('is "0" for an absent file and a stable eight-character hash otherwise', () => {
    expect(revisionOf(undefined)).toBe('0');
    expect(revisionOf('')).toHaveLength(8);
    expect(revisionOf('a')).toBe(revisionOf('a'));
    expect(revisionOf('a')).not.toBe(revisionOf('b'));
  });
});

describe('readStateFile', () => {
  it('degrades a missing file to "nothing there" rather than throwing', async () => {
    expect(await readStateFile(tempPath('absent.md'))).toEqual({ revision: '0' });
  });

  it('returns the content with the revision of exactly those bytes', async () => {
    const path = tempPath();
    await writeAtomic(path, 'one\n');
    const read = await readStateFile(path);
    expect(read).toEqual({ content: 'one\n', revision: revisionOf('one\n') });
  });
});

describe('writeAtomic', () => {
  it('creates missing parent directories and replaces an existing file', async () => {
    const path = tempPath(join('nested', 'deep', 'memory.md'));
    await writeAtomic(path, 'first');
    await writeAtomic(path, 'second');
    expect(readFileSync(path, 'utf8')).toBe('second');
  });

  it('leaves no temp file behind', async () => {
    const path = tempPath();
    await writeAtomic(path, 'x');
    expect(readdirSync(join(path, '..'))).toEqual(['state.json']);
  });

  it('writes a private file on POSIX', async () => {
    const path = tempPath();
    await writeAtomic(path, 'x');
    // Windows has no meaningful file mode; the platform check is inside the test, not a skip.
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('withPathLock', () => {
  it('runs two read-modify-writes of one path one after the other, in call order', async () => {
    const path = tempPath();
    await writeAtomic(path, '');
    const bump = (tag: string) =>
      withPathLock(path, async () => {
        const current = readFileSync(path, 'utf8');
        await new Promise((resolve) => setTimeout(resolve, 5));
        await writeAtomic(path, `${current}${tag}`);
      });
    await Promise.all([bump('a'), bump('b'), bump('c')]);
    expect(readFileSync(path, 'utf8')).toBe('abc');
  });

  it('keeps two different paths independent', async () => {
    const one = tempPath('one');
    const two = tempPath('two');
    const order: string[] = [];
    await Promise.all([
      withPathLock(one, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('one');
      }),
      withPathLock(two, async () => {
        order.push('two');
      }),
    ]);
    expect(order).toEqual(['two', 'one']);
  });
});
