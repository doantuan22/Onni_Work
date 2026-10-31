import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mockAntigravityPath, resolveAntigravityBin, resolveAntigravityExecutable } from './antigravity-bin.ts';
import {
  clearAntigravityProbeCache,
  discoverAntigravityModels,
  parseAntigravityModels,
  probeAntigravityModels,
  probeAntigravityVersion,
} from './antigravity-cli.ts';

// `agy models` as recorded in the spike (tab-separated; the banner goes to stderr).
const MODELS_OUTPUT = [
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
  '',
].join('\n');

beforeEach(() => clearAntigravityProbeCache());

describe('parseAntigravityModels', () => {
  it('reads id<TAB>label rows', () => {
    expect(parseAntigravityModels(MODELS_OUTPUT)).toEqual([
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', description: '' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)', description: '' },
      { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)', description: '' },
    ]);
  });

  it('skips a banner, blank lines, rows without a tab, and a duplicate id', () => {
    const text = 'Fetching available models...\n\nm1\tOne\nm1\tOne again\nnot a row\nm2\tTwo\n';
    expect(parseAntigravityModels(text).map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('the CLI probes (injected exec; nothing real is spawned)', () => {
  const ok = (stdout: string) => async () => ({ stdout, stderr: '' });

  it('version: the first line of `agy --version`', async () => {
    expect(await probeAntigravityVersion({ bin: 'agy', exec: ok('1.4.12\n') })).toEqual({ ok: true, value: '1.4.12' });
  });

  it('models: a list is a usable login; an empty list is not', async () => {
    expect(await probeAntigravityModels({ bin: 'agy', exec: ok(MODELS_OUTPUT) })).toMatchObject({ ok: true });
    expect(await probeAntigravityModels({ bin: 'agy', exec: ok('Fetching available models...\n') })).toMatchObject({ ok: false });
  });

  it('a missing binary is `notInstalled`, a timeout and a failing exit are not', async () => {
    const enoent = async () => {
      throw Object.assign(new Error('spawn agy ENOENT'), { code: 'ENOENT' });
    };
    expect(await probeAntigravityVersion({ bin: 'agy', exec: enoent })).toMatchObject({ ok: false, notInstalled: true });
    const timeout = async () => {
      throw Object.assign(new Error('timed out'), { killed: true });
    };
    expect(await probeAntigravityModels({ bin: 'agy', exec: timeout })).toMatchObject({
      ok: false,
      notInstalled: false,
      reason: expect.stringContaining('timed out'),
    });
    const failing = async () => {
      throw Object.assign(new Error('exit 1'), { stderr: 'something went wrong\nnot signed in' });
    };
    expect(await probeAntigravityModels({ bin: 'agy', exec: failing })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not signed in'),
    });
  });

  it('discovery throws on failure, like the other runners', async () => {
    await expect(discoverAntigravityModels({ bin: 'agy', exec: ok('') })).rejects.toThrow(/model discovery failed/);
  });

  it('really spawns the bundled mock for --version and models (no real agy)', async () => {
    const bin = mockAntigravityPath();
    expect(await probeAntigravityVersion({ bin, fresh: true })).toEqual({ ok: true, value: '1.4.12-mock' });
    const models = await probeAntigravityModels({ bin, fresh: true });
    expect(models).toMatchObject({ ok: true });
    expect(models.ok && models.value.map((m) => m.id)).toEqual(['mock-fast', 'mock-smart']);
  }, 20_000);
});

describe('resolving the binary', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'onni-agy-bin-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('prefers an explicit option, then ONNI_ANTIGRAVITY_BIN', () => {
    expect(resolveAntigravityBin('/x/agy', { ONNI_ANTIGRAVITY_BIN: '/y/agy' })).toBe('/x/agy');
    expect(resolveAntigravityBin(undefined, { ONNI_ANTIGRAVITY_BIN: '/y/agy' })).toBe('/y/agy');
  });

  it('finds agy on PATH, then in the installer directory (a terminal opened before install has no PATH entry)', () => {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'agy.exe'), '');
    expect(resolveAntigravityBin(undefined, { PATH: bin }, dir, 'win32')).toBe(join(bin, 'agy.exe'));
    const local = join(dir, 'agy', 'bin');
    mkdirSync(local, { recursive: true });
    writeFileSync(join(local, 'agy.exe'), '');
    expect(resolveAntigravityBin(undefined, { PATH: '', LOCALAPPDATA: dir }, dir, 'win32')).toBe(join(local, 'agy.exe'));
    const posix = join(dir, '.local', 'bin');
    mkdirSync(posix, { recursive: true });
    writeFileSync(join(posix, 'agy'), '');
    expect(resolveAntigravityBin(undefined, { PATH: '' }, dir, 'linux')).toBe(join(posix, 'agy'));
  });

  it('falls back to a bare `agy` so a spawn fails with the usual not-found', () => {
    expect(resolveAntigravityBin(undefined, { PATH: '' }, dir, 'linux')).toBe('agy');
  });

  it('a dry run never reaches the real agy: it resolves to the bundled mock', () => {
    const before = { dry: process.env.ONNI_DRY_RUN, bin: process.env.ONNI_ANTIGRAVITY_BIN };
    try {
      delete process.env.ONNI_ANTIGRAVITY_BIN;
      process.env.ONNI_DRY_RUN = '1';
      expect(resolveAntigravityExecutable()).toBe(mockAntigravityPath());
    } finally {
      if (before.dry === undefined) delete process.env.ONNI_DRY_RUN;
      else process.env.ONNI_DRY_RUN = before.dry;
      if (before.bin !== undefined) process.env.ONNI_ANTIGRAVITY_BIN = before.bin;
    }
  });
});
