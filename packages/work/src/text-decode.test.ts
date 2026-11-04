import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { readFileWithRetry } from './fs-rename.ts';
import { decodeText } from './text-decode.ts';

const JSON_TEXT = JSON.stringify({ worktreeRetention: 3, defaultRunner: 'codex', note: 'ünï — 日本語 😀' });
const utf16le = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
const utf16be = (text: string) => {
  const body = Buffer.from(text, 'utf16le');
  return Buffer.concat([Buffer.from([0xfe, 0xff]), body.swap16()]);
};
const utf8Bom = (text: string) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);

/**
 * Windows PowerShell 5.1 writes `>` / `Out-File` as UTF-16LE and `Set-Content -Encoding UTF8` with
 * a BOM, and Notepad offers both. `JSON.parse` takes neither, and every reader of a hand-written
 * file swallows the error — so the file was ignored with no warning.
 */
describe('decodeText', () => {
  it.each([
    ['plain UTF-8', Buffer.from(JSON_TEXT, 'utf8')],
    ['UTF-8 with a BOM', utf8Bom(JSON_TEXT)],
    ['UTF-16LE with a BOM', utf16le(JSON_TEXT)],
    ['UTF-16BE with a BOM', utf16be(JSON_TEXT)],
  ])('reads %s back to the same text', (_name, bytes) => {
    expect(decodeText(bytes)).toBe(JSON_TEXT);
  });

  it('keeps a BOM-looking sequence that is not at the start', () => {
    expect(decodeText(Buffer.from('a\uFEFFb', 'utf8'))).toBe('a\uFEFFb');
  });

  it('is total: empty, one byte, a lone BOM, and a truncated UTF-16BE body never throw', () => {
    expect(decodeText(Buffer.alloc(0))).toBe('');
    expect(decodeText(Buffer.from([0x7b]))).toBe('{');
    expect(decodeText(Buffer.from([0xff, 0xfe]))).toBe('');
    expect(decodeText(Buffer.from([0xef, 0xbb, 0xbf]))).toBe('');
    expect(() => decodeText(Buffer.from([0xfe, 0xff, 0x00]))).not.toThrow();
  });
});

describe.each([
  ['UTF-8 with a BOM', utf8Bom],
  ['UTF-16LE', utf16le],
])('a hand-written config.json saved as %s', (_name, encode) => {
  let repoRoot: string;
  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-encoding-'));
    mkdirSync(join(repoRoot, '.ai/onni'), { recursive: true });
  });
  afterEach(() => rmSync(repoRoot, { recursive: true, force: true }));

  it('still applies its settings', async () => {
    writeFileSync(join(repoRoot, '.ai/onni', 'config.json'), encode(JSON_TEXT));
    const config = await loadConfig(repoRoot);
    expect(config.worktreeRetention).toBe(3);
    expect(config.defaultRunner).toBe('codex');
  });

  it('is read by readFileWithRetry as the same text (the workspace config and ui-state path)', async () => {
    const path = join(repoRoot, 'state.json');
    writeFileSync(path, encode(JSON_TEXT));
    expect(JSON.parse(await readFileWithRetry(path))).toMatchObject({ worktreeRetention: 3 });
  });
});
