import { describe, expect, it } from 'vitest';
import type { RosterWorker } from '@onni/contract';
import type { RunRecord } from '../runs/store.ts';
import {
  buildWorkerScorecard,
  formatWorkerScorecard,
  WORKER_SCORECARD_MAX_LINE_LENGTH,
  WORKER_SCORECARD_MAX_LINES,
} from './scorecard.ts';

const NOW = new Date('2026-11-07T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1_000;

describe('worker scorecard', () => {
  it('returns an empty scorecard and labels roster workers with no history', () => {
    const scorecard = buildWorkerScorecard([], { now: NOW });

    expect(scorecard.sampledRunCount).toBe(0);
    expect(scorecard.byWorker.size).toBe(0);
    expect(formatWorkerScorecard([worker('claude', 'sonnet')], scorecard)).toBe('claude:sonnet — no history');
    expect(formatWorkerScorecard(
      [worker('claude', 'sonnet')],
      buildWorkerScorecard([child('one'), child('two')], { now: NOW }),
    )).toBe('claude:sonnet — no history');
  });

  it('does not turn a cost-less backend into a reported $0 median', () => {
    const workerEntry = worker('codex', 'gpt-5');
    const runs = [1, 2, 3].map((index) => child(`codex-${index}`, {
      runner: 'codex',
      model: 'gpt-5',
      workerKey: 'codex:gpt-5',
      costUsd: 0,
    }));
    const scorecard = buildWorkerScorecard(runs, { now: NOW });
    const score = scorecard.byWorker.get('codex:gpt-5')?.implement;

    expect(score?.medianUsd).toBeUndefined();
    expect(formatWorkerScorecard([workerEntry], scorecard)).not.toContain('$');
  });

  it('groups mixed kinds and calculates medians and success rates per kind', () => {
    const runs = [
      child('impl-1', { durationMs: 1_000, tokensUsed: 100, costUsd: 0.01 }),
      child('impl-2', { durationMs: 2_000, tokensUsed: 300, costUsd: 0.03, status: 'failed' }),
      child('review-1', { kind: 'review', durationMs: 9_000, tokensUsed: 200, costUsd: 0.05 }),
    ];
    const scorecard = buildWorkerScorecard(runs, { now: NOW });
    const scores = scorecard.byWorker.get('claude:sonnet');

    expect(scores?.implement).toMatchObject({
      settledRuns: 2,
      qualityRuns: 2,
      successes: 1,
      failures: 1,
      successRate: 0.5,
      medianDurationMs: 1_500,
      medianTokens: 200,
      medianUsd: 0.02,
    });
    expect(scores?.review).toMatchObject({
      settledRuns: 1,
      qualityRuns: 1,
      successRate: 1,
      medianDurationMs: 9_000,
      medianTokens: 200,
      medianUsd: 0.05,
    });
    expect(formatWorkerScorecard([worker('claude', 'sonnet')], scorecard)).toContain('impl 50%/2');
    expect(formatWorkerScorecard([worker('claude', 'sonnet')], scorecard)).toContain('review 100%/1');
  });

  it('counts manager cancellations as failures and excludes auth and usage-limit failures from quality', () => {
    const cancelledAt = new Date(NOW.getTime() - DAY_MS).toISOString();
    const runs = [
      child('done-1'),
      child('done-2'),
      child('auth', { status: 'failed', failureClass: 'auth' }),
      child('limit', { status: 'failed', failureClass: 'usage_limit' }),
      child('manager-cancel', {
        status: 'cancelled',
        dispatch: {
          rootRunId: 'root',
          parentRunId: 'parent',
          kind: 'implement',
          workerKey: 'claude:sonnet',
          managerCancellation: { byRunId: 'manager', requestedAt: cancelledAt },
        },
      }),
    ];
    const score = buildWorkerScorecard(runs, { now: NOW }).byWorker.get('claude:sonnet')?.implement;

    expect(score).toMatchObject({
      settledRuns: 5,
      qualityRuns: 3,
      successes: 2,
      failures: 1,
      successRate: 2 / 3,
      managerCancelledRuns: 1,
      authFailures: 1,
      usageLimitFailures: 1,
    });
    const line = formatWorkerScorecard([worker('claude', 'sonnet')], buildWorkerScorecard(runs, { now: NOW }));
    expect(line).toContain('excluded auth=1 limit=1');
    expect(line).toContain('mgr-cancel=1 failed');
  });

  it('ignores non-dispatched, root, unsettled, and older-than-30-day runs', () => {
    const base = child('base');
    const notDispatched = { ...base, id: 'plain', dispatch: undefined } as RunRecord;
    const root = { ...base, id: 'root', dispatch: { rootRunId: 'root', intent: {} } } as RunRecord;
    const unsettled = { ...base, id: 'active', status: 'running' } as RunRecord;
    const old = child('old', { ageDays: 31 });

    const scorecard = buildWorkerScorecard([notDispatched, root, unsettled, old], { now: NOW });

    expect(scorecard.sampledRunCount).toBe(0);
    expect(scorecard.byWorker.size).toBe(0);
  });

  it('uses the newest 200 runs and caps formatted output at four lines of 160 characters', () => {
    const runs = Array.from({ length: 210 }, (_, index) => child(`run-${index}`, {
      ageDays: index / 10,
      tokensUsed: index + 1,
      costUsd: (index + 1) / 100,
    }));
    const scorecard = buildWorkerScorecard(runs, { now: NOW });
    const score = scorecard.byWorker.get('claude:sonnet')?.implement;
    const roster = [
      worker('claude', 'sonnet'),
      ...Array.from({ length: 5 }, (_, index) => worker('claude', `model-${index}-${'x'.repeat(180)}`)),
    ];
    const lines = formatWorkerScorecard(roster, scorecard).split('\n');

    expect(scorecard.sampledRunCount).toBe(200);
    expect(score?.settledRuns).toBe(200);
    expect(score?.medianTokens).toBe(100.5);
    expect(lines).toHaveLength(WORKER_SCORECARD_MAX_LINES);
    expect(lines.every((line) => line.length <= WORKER_SCORECARD_MAX_LINE_LENGTH)).toBe(true);
    expect(lines[3]).toContain('+2 workers omitted');
    expect(lines.join('\n')).not.toContain('Private title');
    expect(lines.join('\n')).not.toContain('secret prompt');
  });
});

function worker(runner: string, model?: string): RosterWorker {
  return { runner, ...(model ? { model } : {}), role: '', maxConcurrent: 1 } as RosterWorker;
}

function child(
  id: string,
  overrides: Partial<RunRecord> & { ageDays?: number; durationMs?: number; workerKey?: string; kind?: 'implement' | 'review' } = {},
): RunRecord {
  const { ageDays, durationMs, workerKey, kind, ...runOverrides } = overrides;
  const finish = new Date(NOW.getTime() - (ageDays ?? 1) * DAY_MS);
  const start = new Date(finish.getTime() - (durationMs ?? 60_000));
  const runner = runOverrides.runner ?? 'claude';
  const model = runOverrides.model ?? 'sonnet';
  const dispatch = runOverrides.dispatch ?? {
    rootRunId: 'root',
    parentRunId: 'parent',
    kind: kind ?? 'implement',
    workerKey: workerKey ?? `${runner}:${model}`,
  };
  return {
    id,
    title: `Private title ${id}`,
    task: `secret prompt ${id}`,
    workflow: 'default',
    runner,
    model,
    status: 'done',
    createdAt: start.toISOString(),
    startedAt: start.toISOString(),
    finishedAt: finish.toISOString(),
    tokensUsed: 100,
    costUsd: 0.02,
    dispatch,
    ...runOverrides,
  } as RunRecord;
}
