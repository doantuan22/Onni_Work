import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MANAGER_MEMORY_MAX_BYTES } from '@onni/contract';
import {
  appendManagerMemory,
  clampMemoryToTail,
  managerMemoryPath,
  memoryBytes,
  memoryEntryLine,
  memoryReadOf,
  readManagerMemory,
  sanitizeMemoryEntry,
  writeManagerMemory,
} from './memory.ts';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'onni-memory-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('sanitizeMemoryEntry', () => {
  it('flattens newlines and control characters to a single line', () => {
    expect(sanitizeMemoryEntry('first\nsecond\tthird\r\nfourth')).toBe('first second third fourth');
    expect(sanitizeMemoryEntry('a\u0000b\u0007c')).toBe('a b c');
  });

  it('strips markdown markers that would let a lesson pose as the brief’s own headings', () => {
    expect(sanitizeMemoryEntry('## Heading')).toBe('Heading');
    expect(sanitizeMemoryEntry('- bullet')).toBe('bullet');
    expect(sanitizeMemoryEntry('> quote')).toBe('quote');
    expect(sanitizeMemoryEntry('```sh')).toBe('');
    expect(sanitizeMemoryEntry('# one\n- two\n> three')).toBe('one two three');
  });

  it('keeps text that only looks like a marker', () => {
    expect(sanitizeMemoryEntry('#123 is broken')).toBe('#123 is broken');
    expect(sanitizeMemoryEntry('-1 means unknown')).toBe('-1 means unknown');
    expect(sanitizeMemoryEntry('a#b')).toBe('a#b');
  });

  it('redacts through the injected function before returning', () => {
    const secret = 'ghp_live_SECRET_VALUE_1234567890';
    const clean = sanitizeMemoryEntry(`token ${secret}`, (text) => text.replace(secret, '[redacted]'));
    expect(clean).toBe('token [redacted]');
    expect(clean).not.toContain(secret);
  });

  it('collapses whitespace and can end up empty, which the caller refuses', () => {
    expect(sanitizeMemoryEntry('  spaced   out  ')).toBe('spaced out');
    expect(sanitizeMemoryEntry(' \n\t ')).toBe('');
  });
});

describe('memoryEntryLine', () => {
  it('names the task (id8) and the date so Settings can show where a lesson came from', () => {
    const line = memoryEntryLine('run migrations first', 'abcdef1234-5678', new Date('2026-11-03T22:00:00.000Z'));
    expect(line).toBe('- run migrations first (task abcdef12, 2026-11-03)');
  });
});

describe('clampMemoryToTail', () => {
  it('returns content that already fits untouched', () => {
    expect(clampMemoryToTail('one\ntwo')).toBe('one\ntwo');
  });

  it('keeps the newest whole lines, never half a line', () => {
    const content = ['oldest', 'middle', 'newest'].map((line) => `${line}:${'x'.repeat(40)}`).join('\n');
    const tail = clampMemoryToTail(content, 100);
    expect(memoryBytes(tail)).toBeLessThanOrEqual(100);
    expect(tail.endsWith(`${'x'.repeat(40)}`)).toBe(true);
    expect(tail).not.toContain('oldest');
    for (const line of tail.split('\n')) expect(line).toMatch(/:x+$/);
  });

  it('defaults to the shared contract ceiling', () => {
    const content = Array.from({ length: 200 }, (_, i) => `line ${i} ${'y'.repeat(40)}`).join('\n');
    const tail = clampMemoryToTail(content);
    expect(memoryBytes(tail)).toBeLessThanOrEqual(MANAGER_MEMORY_MAX_BYTES);
    expect(tail.endsWith(`${'y'.repeat(40)}`)).toBe(true);
  });
});

describe('readManagerMemory', () => {
  it('reads an absent file as empty with the revision of nothing', async () => {
    expect(await readManagerMemory(tempDir())).toEqual({
      content: '',
      bytes: 0,
      maxBytes: MANAGER_MEMORY_MAX_BYTES,
      revision: memoryReadOf('').revision,
    });
  });

  it('counts bytes, not characters, for a non-ASCII lesson', async () => {
    const dir = tempDir();
    const content = '- Chạy migration trước (task abcdef12, 2026-11-03)\n';
    await writeManagerMemory(dir, { content, revision: memoryReadOf('').revision });
    const read = await readManagerMemory(dir);
    expect(read.bytes).toBe(memoryBytes(content));
    expect(read.bytes).toBeGreaterThan([...content].length);
    expect(read.revision).toBe(memoryReadOf(content).revision);
  });
});

describe('writeManagerMemory', () => {
  it('writes when the revision matches and reports the new revision', async () => {
    const dir = tempDir();
    const first = await writeManagerMemory(dir, { content: 'one', revision: memoryReadOf('').revision });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await writeManagerMemory(dir, { content: 'two', revision: first.memory.revision });
    expect(second.ok).toBe(true);
    expect(readFileSync(managerMemoryPath(dir), 'utf8')).toBe('two');
  });

  it('refuses a stale revision with 409 and hands back the current file', async () => {
    const dir = tempDir();
    const written = await writeManagerMemory(dir, { content: 'theirs', revision: memoryReadOf('').revision });
    expect(written.ok).toBe(true);
    const stale = await writeManagerMemory(dir, { content: 'mine', revision: memoryReadOf('').revision });
    expect(stale).toEqual({ ok: false, status: 409, error: 'memory changed in another window', current: memoryReadOf('theirs') });
    expect(readFileSync(managerMemoryPath(dir), 'utf8')).toBe('theirs');
  });

  it('refuses to write past the ceiling instead of truncating the user’s text', async () => {
    const dir = tempDir();
    const tooLong = 'z'.repeat(MANAGER_MEMORY_MAX_BYTES + 1);
    const outcome = await writeManagerMemory(dir, { content: tooLong, revision: memoryReadOf('').revision });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(400);
    expect(outcome.error).toContain(String(MANAGER_MEMORY_MAX_BYTES));
    expect(await readManagerMemory(dir)).toEqual(memoryReadOf(''));
  });
});

describe('appendManagerMemory', () => {
  it('appends one sanitized line to the end of the file', async () => {
    const dir = tempDir();
    const outcome = await appendManagerMemory(dir, '# Run migrations first\n', 'abcdef1234-5678');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const content = readFileSync(managerMemoryPath(dir), 'utf8');
    expect(outcome.entry).toBe('Run migrations first');
    expect(content.trimEnd()).toMatch(/^- Run migrations first \(task abcdef12, \d{4}-\d{2}-\d{2}\)$/);
    expect(outcome.memory.bytes).toBe(memoryBytes(content));
  });

  it('refuses an entry that is empty after cleaning', async () => {
    const dir = tempDir();
    expect(await appendManagerMemory(dir, ' \n ## \n', 'run-1')).toEqual({
      ok: false,
      status: 400,
      error: 'the lesson is empty after cleaning',
    });
    expect(await readManagerMemory(dir)).toEqual(memoryReadOf(''));
  });

  it('refuses with 409 when the line would cross the ceiling', async () => {
    const dir = tempDir();
    const filled = `${'a'.repeat(MANAGER_MEMORY_MAX_BYTES - 1)}\n`;
    await writeManagerMemory(dir, { content: filled, revision: memoryReadOf('').revision });
    const outcome = await appendManagerMemory(dir, 'one more lesson', 'run-1');
    expect(outcome).toEqual({ ok: false, status: 409, error: 'memory is full — ask the user to prune it in Settings' });
    expect(readFileSync(managerMemoryPath(dir), 'utf8')).toBe(filled);
  });

  it('loses no line when two managers finish at the same moment', async () => {
    const dir = tempDir();
    const outcomes = await Promise.all([
      appendManagerMemory(dir, 'lesson one', 'aaaa1111'),
      appendManagerMemory(dir, 'lesson two', 'bbbb2222'),
      appendManagerMemory(dir, 'lesson three', 'cccc3333'),
    ]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    const lines = readFileSync(managerMemoryPath(dir), 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines.filter((line) => line.startsWith('- lesson one '))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith('- lesson two '))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith('- lesson three '))).toHaveLength(1);
  });

  it('redacts before writing, so a secret never reaches the file', async () => {
    const dir = tempDir();
    const secret = 'ghp_live_SECRET_VALUE_1234567890';
    const outcome = await appendManagerMemory(dir, `token ${secret}`, 'run-1', (text) => text.replace(secret, '[redacted]'));
    expect(outcome.ok).toBe(true);
    const content = readFileSync(managerMemoryPath(dir), 'utf8');
    expect(content).not.toContain(secret);
    expect(content).toContain('[redacted]');
  });
});
