import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { extractAssistantPreview, readEventsTailFromPath, RunStore } from '../runs/store.ts';
import { searchTranscripts } from '../runs/transcript-search.ts';

/**
 * Budgets for the paths a user feels: opening a project, previewing a long
 * transcript and searching it. Thresholds are deliberately generous (CI disks
 * vary) — they exist to catch a complexity regression (a full-file read where a
 * bounded tail was intended, an O(n²) merge), not to benchmark the machine.
 */

let root: string;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

function tempDir(): string {
  root = mkdtempSync(join(tmpdir(), 'onni-perf-'));
  return root;
}

function eventLine(seq: number, text: string): string {
  return `${JSON.stringify({ seq, type: 'note', text, ts: '2026-01-01T00:00:00.000Z' })}\n`;
}

describe('transcript tail is bounded, not a full-file read', () => {
  it('reads the last events of a 20 MB transcript without scaling with the file', () => {
    const dataDir = tempDir();
    const runsDir = join(dataDir, 'runs');
    mkdirSync(runsDir, { recursive: true });
    const runId = '2f7b6c1e-8d4a-4f3b-9c2d-1a0b3c4d5e6f';
    const file = join(runsDir, `${runId}.ndjson`);

    const chunk = Array.from({ length: 500 }, (_, i) => eventLine(i, 'x'.repeat(180)));
    const totalLines = 500 * 200;
    // ~100 KB per chunk × 200 ≈ 20 MB, then a distinctive tail.
    writeFileSync(
      file,
      chunk.join('').repeat(200) + eventLine(totalLines - 1, 'needle-tail') + eventLine(totalLines, 'last'),
    );

    const started = performance.now();
    const events = readEventsTailFromPath(file, 50, runsDir);
    const elapsed = performance.now() - started;

    expect(events).toHaveLength(50);
    expect(events.at(-1)?.seq).toBe(totalLines);
    expect(events.some((event) => (event as { text?: string }).text === 'needle-tail')).toBe(true);
    // The 1 MiB read cap means a 20 MB file costs about the same as a 1 MB one.
    expect(elapsed).toBeLessThan(2000);
  });

  it('extracts the assistant preview from a long tail without walking the whole file', () => {
    const dataDir = tempDir();
    const runsDir = join(dataDir, 'runs');
    mkdirSync(runsDir, { recursive: true });
    const runId = '3a8c7d2f-9e5b-4a4c-8d3e-2b1c4d5e6f70';
    const file = join(runsDir, `${runId}.ndjson`);

    const lines = Array.from({ length: 20_000 }, (_, i) => eventLine(i, `step ${i}`));
    lines.push(
      `${JSON.stringify({
        seq: 20_000,
        type: 'text',
        text: 'final answer',
        ts: '2026-01-01T00:00:10.000Z',
      })}\n`,
    );
    writeFileSync(file, lines.join(''));

    const preview = extractAssistantPreview(readEventsTailFromPath(file, 50, runsDir));
    expect(preview).toBe('final answer');
  });
});

describe('transcript search honours its per-run byte budget', () => {
  it('finds a hit inside the budget and stops before one outside it', async () => {
    const dataDir = tempDir();
    const runsDir = join(dataDir, 'runs');
    mkdirSync(runsDir, { recursive: true });
    const runId = '4b9d8e3a-0f6c-4b5d-9e4f-3c2d5e6f7081';
    const file = join(runsDir, `${runId}.ndjson`);

    const filler = Array.from({ length: 5_000 }, (_, i) => eventLine(i, 'filler '.repeat(10)));
    writeFileSync(file, [eventLine(0, 'needle-near-start'), ...filler, eventLine(5_001, 'needle-at-end')].join(''));

    const near = await searchTranscripts(
      { q: 'needle-near-start' },
      [{ projectId: 'p', runId, filePath: file, runsDir }],
    );
    expect(near.items).toHaveLength(1);
    expect(near.items[0]?.seq).toBe(0);

    const bounded = await searchTranscripts(
      { q: 'needle-at-end' },
      [{ projectId: 'p', runId, filePath: file, runsDir }],
      { maxBytesPerRun: 64 * 1024 },
    );
    // Deliberately outside the 64 KiB window: the answer is "not scanned", not "found".
    expect(bounded.items).toHaveLength(0);
  });
});

describe('opening a project with a long run history', () => {
  it('loads and sorts 2,000 records well inside the boot budget', () => {
    const dataDir = tempDir();
    mkdirSync(join(dataDir, 'runs'), { recursive: true });
    const records = Array.from({ length: 2_000 }, (_, i) => ({
      id: `run-${String(i).padStart(4, '0')}`,
      title: `task ${i}`,
      workflow: 'quick-task',
      task: `task ${i}`,
      status: 'done',
      // Deliberately not in input order: listRuns sorts newest-first.
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i % 60, 0)).toISOString(),
      tokensUsed: i,
      archived: false,
      steps: [],
    }));
    writeFileSync(join(dataDir, 'runs.json'), JSON.stringify(records));

    const started = performance.now();
    const store = RunStore.open(dataDir);
    const runs = store.listRuns();
    const elapsed = performance.now() - started;

    expect(runs).toHaveLength(2_000);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i - 1]!.createdAt >= runs[i]!.createdAt).toBe(true);
    }
    expect(store.getRun('run-0000')?.title).toBe('task 0');
    expect(elapsed).toBeLessThan(3000);
  });
});
