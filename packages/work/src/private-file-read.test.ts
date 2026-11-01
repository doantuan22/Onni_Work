import { existsSync, mkdirSync, mkdtempSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readWindowsPrivateFile } from './private-file-read.ts';

it('reads bounded regular Windows files by handle and rejects missing or oversized files', async () => {
  if (process.platform !== 'win32') return;
  const root = mkdtempSync(join(tmpdir(), 'onni-private-read-'));
  const file = join(root, 'd\u1eef li\u1ec7u ri\u00eang.txt');
  try {
    writeFileSync(file, 'n\u1ed9i dung th\u1eed');
    await expect(readWindowsPrivateFile(file, 64)).resolves.toBe('n\u1ed9i dung th\u1eed');
    await expect(readWindowsPrivateFile(file, 2)).rejects.toMatchObject({ code: 'EFBIG' });
    await expect(readWindowsPrivateFile(join(root, 'missing'), 64)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    unlinkSync(file);
    rmdirSync(root);
  }
}, 20_000);

it('reads a Unicode Windows path longer than the legacy path limit', async () => {
  if (process.platform !== 'win32') return;
  const root = mkdtempSync(join(tmpdir(), 'onni-private-long-'));
  const first = join(root, 'a'.repeat(110));
  const second = join(first, 'b'.repeat(110));
  const file = join(second, 'd\u1eef-li\u1ec7u-'.repeat(6) + '.txt');
  try {
    mkdirSync(first);
    mkdirSync(second);
    writeFileSync(file, 'synthetic data');
    expect(file.length).toBeGreaterThan(260);
    await expect(readWindowsPrivateFile(file, 64)).resolves.toBe('synthetic data');
  } finally {
    if (existsSync(file)) unlinkSync(file);
    if (existsSync(second)) rmdirSync(second);
    if (existsSync(first)) rmdirSync(first);
    rmdirSync(root);
  }
}, 20_000);

it('rejects a final-component Windows symlink without reading its target', async () => {
  if (process.platform !== 'win32') return;
  const root = mkdtempSync(join(tmpdir(), 'onni-private-link-'));
  const target = join(root, 'target');
  const link = join(root, 'link');
  let linked = false;
  try {
    writeFileSync(target, 'synthetic data');
    try {
      symlinkSync(target, link, 'file');
      linked = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    await expect(readWindowsPrivateFile(link, 64)).rejects.toMatchObject({ code: 'ELOOP' });
  } finally {
    if (linked) unlinkSync(link);
    unlinkSync(target);
    rmdirSync(root);
  }
}, 20_000);
