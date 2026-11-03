import { describe, expect, it } from 'vitest';
import type { DispatchPeek, DispatchPeekEntry } from '@onni/contract';
import type { RunEvent } from '../runs/store.ts';
import { formatPeek, orderPeekCandidates, peekTail, quietMinutesOf } from './peek.ts';

const event = (seq: number, patch: Record<string, unknown>, ts = '2026-11-03T10:00:00.000Z'): RunEvent =>
  ({ seq, ts, type: 'note', ...patch }) as RunEvent;

const entry = (patch: Partial<DispatchPeekEntry> = {}): DispatchPeekEntry => ({
  id: 'abcd1234-0000',
  title: 'A worker',
  status: 'running',
  tokensUsed: 0,
  files: [],
  filesOmitted: 0,
  filesState: 'ok',
  quietMinutes: 0,
  tail: [],
  tailTruncated: false,
  ...patch,
});

describe('peekTail', () => {
  it('shows one line per event from the whitelist, newest last', () => {
    const { lines, truncated } = peekTail([
      event(1, { text: 'first   line\nwrapped' }),
      event(2, { message: 'second' }),
      event(3, { type: 'tool', tool: 'Bash' }),
      event(4, { title: 'fourth' }),
    ]);
    expect(lines).toEqual(['first line wrapped', 'second', 'fourth']);
    expect(truncated).toBe(false);
  });

  it('caps lines, characters per line and total characters — dropping the OLDEST', () => {
    const events = Array.from({ length: 10 }, (_, i) => event(i, { text: `${i}:${'x'.repeat(50)}` }));
    const capped = peekTail(events, { maxLines: 3, maxCharsPerLine: 10, maxChars: 100 });
    expect(capped.lines).toHaveLength(3);
    expect(capped.lines.at(-1)).toBe('9:xxxxxxxx');
    expect(capped.truncated).toBe(true);
    const byChars = peekTail(events, { maxLines: 10, maxCharsPerLine: 60, maxChars: 30 });
    expect(byChars.lines.join('\n').length).toBeLessThanOrEqual(30);
    expect(byChars.truncated).toBe(true);
  });

  it('redacts before measuring, so a secret can never ride along uncut', () => {
    const secret = 'ghp_live_SECRET_VALUE_1234567890';
    const { lines } = peekTail([event(1, { text: `token is ${secret}` })], {
      redact: (line) => line.replace(secret, '[redacted]'),
    });
    expect(lines.join('\n')).not.toContain(secret);
    expect(lines.join('\n')).toContain('[redacted]');
  });

  it('is empty rather than invented when there is nothing to show', () => {
    expect(peekTail([])).toEqual({ lines: [], truncated: false });
    expect(peekTail([event(1, { type: 'tool' })])).toEqual({ lines: [], truncated: false });
  });
});

describe('quietMinutesOf', () => {
  it('measures silence from the newest event, and says nothing when there is none', () => {
    const now = Date.parse('2026-11-03T10:07:00.000Z');
    expect(quietMinutesOf([event(1, {}, '2026-11-03T10:00:00.000Z')], now)).toBe(7);
    expect(quietMinutesOf([], now)).toBeNull();
    // A clock skew is not negative silence.
    expect(quietMinutesOf([event(1, {}, '2026-11-03T10:30:00.000Z')], now)).toBe(0);
  });
});

describe('orderPeekCandidates', () => {
  it('lists live workers first, then settled ones, oldest first, and counts what it hides', () => {
    const runs = [
      { id: 'done-1', status: 'done', createdAt: '2026-11-03T09:00:00Z' },
      { id: 'run-1', status: 'running', createdAt: '2026-11-03T10:00:00Z' },
      { id: 'queued-1', status: 'queued', createdAt: '2026-11-03T09:30:00Z' },
      { id: 'done-2', status: 'failed', createdAt: '2026-11-03T08:00:00Z' },
    ];
    const { chosen, omitted } = orderPeekCandidates(runs, 3);
    expect(chosen.map((run) => run.id)).toEqual(['queued-1', 'run-1', 'done-2']);
    expect(omitted).toBe(1);
  });
});

describe('formatPeek', () => {
  const peek = (workers: DispatchPeekEntry[], workersOmitted = 0): DispatchPeek => ({ workers, workersOmitted });

  it('prints a compact block: state, cost, quiet time, step, branch and files', () => {
    const text = formatPeek(peek([entry({
      runner: 'codex',
      model: 'gpt-5',
      costUsd: 1.5,
      tokensUsed: 12_000,
      quietMinutes: 4,
      currentStep: { name: 'run tests', status: 'running' },
      branch: 'onni/abcd1234',
      baseBranch: 'main',
      files: ['src/a.ts', 'docs/b.md'],
    })]));
    expect(text).toContain('abcd1234  running — A worker');
    expect(text).toContain('codex (gpt-5) · $1.50 · 12,000 tokens · no new activity for 4m');
    expect(text).toContain('step: run tests (running)');
    expect(text).toContain('branch onni/abcd1234 from main');
    expect(text).toContain('files (2): src/a.ts, docs/b.md');
  });

  it('never lets "unknown" read as "nothing changed"', () => {
    expect(formatPeek(peek([entry({ filesState: 'unavailable' })]))).toContain('NOT "nothing changed"');
    expect(formatPeek(peek([entry({ filesState: 'timeout' })]))).toContain('unknown, not "nothing changed"');
    expect(formatPeek(peek([entry()]))).toContain('files: nothing changed yet');
    expect(formatPeek(peek([entry({ files: ['a'], filesOmitted: 4 })]))).toContain('files (5): a (+4 more)');
  });

  it('adds the requested tail and says when it was cut', () => {
    const text = formatPeek(peek([entry({ tail: ['one', 'two'], tailTruncated: true })]));
    expect(text).toContain('  recent:\n  | one\n  | two\n  | … truncated');
  });

  it('counts the workers it did not show, and handles an empty tree', () => {
    expect(formatPeek(peek([entry()], 3))).toContain('(+3 more workers not shown');
    expect(formatPeek(peek([]))).toBe('no workers in this tree yet');
  });
});
