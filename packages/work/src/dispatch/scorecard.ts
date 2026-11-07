import {
  RUNNERS_WITHOUT_COST,
  RUNNERS_WITHOUT_TOKENS,
  WORKER_KINDS,
  rosterWorkerKey,
  type RosterWorker,
  type WorkerKind,
} from '@onni/contract';
import type { RunRecord } from '../runs/store.ts';

export const WORKER_SCORECARD_WINDOW_DAYS = 30;
export const WORKER_SCORECARD_MAX_RUNS = 200;
export const WORKER_SCORECARD_MAX_LINES = 4;
export const WORKER_SCORECARD_MAX_LINE_LENGTH = 160;

const DAY_MS = 24 * 60 * 60 * 1_000;
const SETTLED_STATUSES = new Set(['done', 'review', 'failed', 'cancelled', 'blocked']);
const SUCCESS_STATUSES = new Set(['done', 'review']);
const FAILURE_STATUSES = new Set(['failed', 'cancelled', 'blocked']);

/** One worker's measurements for one dispatch kind. Rates are 0..1; absent means no quality sample. */
export interface WorkerKindScore {
  kind: WorkerKind;
  settledRuns: number;
  qualityRuns: number;
  successes: number;
  failures: number;
  successRate?: number;
  /** Included in `failures`; broken out so manager-initiated stops stay visible. */
  managerCancelledRuns: number;
  /** Excluded from `qualityRuns` and `successRate`. */
  authFailures: number;
  /** Excluded from `qualityRuns` and `successRate`. */
  usageLimitFailures: number;
  medianDurationMs?: number;
  medianTokens?: number;
  /** Undefined for runners that do not report USD, and when no sample reported cost. */
  medianUsd?: number;
}

export interface WorkerScorecard {
  /** Number of dispatched, settled records sampled after applying the time window and cap. */
  sampledRunCount: number;
  /** Only workers and kinds found in the sampled history are present. */
  byWorker: ReadonlyMap<string, Readonly<Partial<Record<WorkerKind, WorkerKindScore>>>>;
}

interface RunSample {
  run: RunRecord;
  timestamp: number;
  workerKey: string;
  runner: string;
  kind: WorkerKind;
}

interface MutableKindScore {
  kind: WorkerKind;
  settledRuns: number;
  qualityRuns: number;
  successes: number;
  failures: number;
  managerCancelledRuns: number;
  authFailures: number;
  usageLimitFailures: number;
  durations: number[];
  tokens: number[];
  costs: number[];
}

/**
 * Build a bounded scorecard from dispatched children only. The clock is injectable so callers can
 * keep the 30-day window deterministic without introducing I/O into the aggregation.
 */
export function buildWorkerScorecard(
  runs: readonly RunRecord[],
  options: { now?: Date } = {},
): WorkerScorecard {
  const nowMs = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(nowMs)) return { sampledRunCount: 0, byWorker: new Map() };
  const cutoff = nowMs - WORKER_SCORECARD_WINDOW_DAYS * DAY_MS;

  const samples: RunSample[] = [];
  for (const run of runs) {
    if (!run.dispatch?.parentRunId || !SETTLED_STATUSES.has(run.status)) continue;
    const workerKey = getWorkerKey(run);
    if (!workerKey) continue;
    const timestamp = parseTimestamp(run.finishedAt) ?? parseTimestamp(run.createdAt);
    if (timestamp === undefined || timestamp < cutoff || timestamp > nowMs) continue;
    samples.push({ run, timestamp, workerKey, runner: getRunner(run, workerKey), kind: getKind(run) });
  }

  samples.sort((a, b) => b.timestamp - a.timestamp || (a.run.id < b.run.id ? -1 : a.run.id > b.run.id ? 1 : 0));
  const sampled = samples.slice(0, WORKER_SCORECARD_MAX_RUNS);
  const groups = new Map<string, Map<WorkerKind, MutableKindScore>>();

  for (const sample of sampled) {
    let byKind = groups.get(sample.workerKey);
    if (!byKind) {
      byKind = new Map();
      groups.set(sample.workerKey, byKind);
    }
    let score = byKind.get(sample.kind);
    if (!score) {
      score = createAccumulator(sample.kind);
      byKind.set(sample.kind, score);
    }

    score.settledRuns += 1;
    const authFailure = sample.run.failureClass === 'auth';
    const usageLimitFailure = sample.run.failureClass === 'usage_limit';
    score.authFailures += Number(authFailure);
    score.usageLimitFailures += Number(usageLimitFailure);
    score.managerCancelledRuns += Number(sample.run.status === 'cancelled' && sample.run.dispatch?.managerCancellation !== undefined);

    if (!authFailure && !usageLimitFailure) {
      score.qualityRuns += 1;
      if (isSuccess(sample.run)) score.successes += 1;
      else if (isFailure(sample.run)) score.failures += 1;
    }

    const start = parseTimestamp(sample.run.startedAt) ?? parseTimestamp(sample.run.createdAt);
    const finish = parseTimestamp(sample.run.finishedAt);
    if (start !== undefined && finish !== undefined && finish >= start) score.durations.push(finish - start);

    if (!RUNNERS_WITHOUT_TOKENS.includes(sample.runner) && Number.isFinite(sample.run.tokensUsed) && sample.run.tokensUsed >= 0) {
      score.tokens.push(sample.run.tokensUsed);
    }
    if (!RUNNERS_WITHOUT_COST.includes(sample.runner) && sample.run.costUsd !== undefined && Number.isFinite(sample.run.costUsd) && sample.run.costUsd >= 0) {
      score.costs.push(sample.run.costUsd);
    }
  }

  const byWorker = new Map<string, Readonly<Partial<Record<WorkerKind, WorkerKindScore>>>>();
  for (const [workerKey, byKind] of groups) {
    const scores: Partial<Record<WorkerKind, WorkerKindScore>> = {};
    for (const [kind, score] of byKind) {
      const medianDurationMs = median(score.durations);
      const medianTokens = median(score.tokens);
      const medianUsd = median(score.costs);
      scores[kind] = {
        kind,
        settledRuns: score.settledRuns,
        qualityRuns: score.qualityRuns,
        successes: score.successes,
        failures: score.failures,
        ...(score.qualityRuns > 0 ? { successRate: score.successes / score.qualityRuns } : {}),
        managerCancelledRuns: score.managerCancelledRuns,
        authFailures: score.authFailures,
        usageLimitFailures: score.usageLimitFailures,
        ...(medianDurationMs !== undefined ? { medianDurationMs } : {}),
        ...(medianTokens !== undefined ? { medianTokens } : {}),
        ...(medianUsd !== undefined ? { medianUsd } : {}),
      };
    }
    byWorker.set(workerKey, scores);
  }

  return { sampledRunCount: sampled.length, byWorker };
}

/**
 * Format up to four roster entries as one privacy-safe line each. If the roster is larger, the
 * final displayed line says how many entries were omitted; output never contains run titles/prompts.
 */
export function formatWorkerScorecard(
  workers: readonly RosterWorker[],
  scorecard: WorkerScorecard,
): string {
  const visible = workers.slice(0, WORKER_SCORECARD_MAX_LINES);
  const lines = visible.map((worker) => formatWorkerLine(worker, scorecard));
  if (workers.length > visible.length && lines.length > 0) {
    lines[lines.length - 1] = appendWithinLimit(lines[lines.length - 1]!, ` · +${workers.length - visible.length} workers omitted`);
  }
  return lines.join('\n');
}

function formatWorkerLine(worker: RosterWorker, scorecard: WorkerScorecard): string {
  const key = rosterWorkerKey(worker);
  const label = safeLabel(key);
  const kinds = scorecard.byWorker.get(key);
  const scores = WORKER_KINDS.flatMap((kind) => kinds?.[kind] ? [kinds[kind]!] : []);
  const settledRuns = scores.reduce((sum, score) => sum + score.settledRuns, 0);
  if (settledRuns < 3) return `${label} — no history`;

  const kindSummary = scores.map(formatKindScore).join(' · ');
  const authFailures = scores.reduce((sum, score) => sum + score.authFailures, 0);
  const usageLimitFailures = scores.reduce((sum, score) => sum + score.usageLimitFailures, 0);
  const managerCancelledRuns = scores.reduce((sum, score) => sum + score.managerCancelledRuns, 0);
  const exclusions = authFailures || usageLimitFailures
    ? ` · excluded auth=${authFailures} limit=${usageLimitFailures}`
    : '';
  const cancellations = managerCancelledRuns ? ` · mgr-cancel=${managerCancelledRuns} failed` : '';
  return truncateLine(`${label} | ${kindSummary}${exclusions}${cancellations}`);
}

function formatKindScore(score: WorkerKindScore): string {
  const kind = score.kind === 'implement' ? 'impl' : score.kind;
  const rate = score.successRate === undefined ? '—' : `${Math.round(score.successRate * 100)}%`;
  const fields = [`${kind} ${rate}/${score.qualityRuns}`];
  if (score.medianDurationMs !== undefined) fields.push(formatDuration(score.medianDurationMs));
  if (score.medianTokens !== undefined) fields.push(`${formatCount(score.medianTokens)} tok`);
  if (score.medianUsd !== undefined) fields.push(`$${score.medianUsd.toFixed(2)}`);
  return fields.join(' ');
}

function getWorkerKey(run: RunRecord): string | undefined {
  const recordedKey = run.dispatch?.workerKey;
  if (recordedKey?.trim()) return recordedKey;
  const runner = run.runner ?? run.dispatch?.order?.backend;
  if (!runner) return undefined;
  const model = run.model ?? run.dispatch?.order?.model;
  return rosterWorkerKey({ runner, model });
}

function getRunner(run: RunRecord, workerKey: string): string {
  return run.runner ?? run.dispatch?.order?.backend ?? workerKey.slice(0, workerKey.indexOf(':') < 0 ? workerKey.length : workerKey.indexOf(':'));
}

function getKind(run: RunRecord): WorkerKind {
  const kind = run.dispatch?.kind ?? run.dispatch?.order?.kind ?? 'implement';
  return (WORKER_KINDS as readonly string[]).includes(kind) ? kind as WorkerKind : 'implement';
}

function createAccumulator(kind: WorkerKind): MutableKindScore {
  return {
    kind,
    settledRuns: 0,
    qualityRuns: 0,
    successes: 0,
    failures: 0,
    managerCancelledRuns: 0,
    authFailures: 0,
    usageLimitFailures: 0,
    durations: [],
    tokens: [],
    costs: [],
  };
}

function isSuccess(run: RunRecord): boolean {
  return SUCCESS_STATUSES.has(run.status) && run.dispatch?.report?.status !== 'failed' && run.dispatch?.report?.status !== 'blocked';
}

function isFailure(run: RunRecord): boolean {
  return FAILURE_STATUSES.has(run.status) || run.dispatch?.report?.status === 'failed' || run.dispatch?.report?.status === 'blocked';
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function safeLabel(value: string): string {
  const oneLine = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return oneLine.length <= 48 ? oneLine : `${oneLine.slice(0, 47)}…`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Number(minutes.toFixed(1))}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Number(hours.toFixed(1))}h`;
  return `${Number((hours / 24).toFixed(1))}d`;
}

function formatCount(value: number): string {
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${Number((value / 1_000).toFixed(1))}k`;
  return `${Number((value / 1_000_000).toFixed(1))}m`;
}

function truncateLine(value: string): string {
  return value.length <= WORKER_SCORECARD_MAX_LINE_LENGTH
    ? value
    : `${value.slice(0, WORKER_SCORECARD_MAX_LINE_LENGTH - 1)}…`;
}

function appendWithinLimit(line: string, suffix: string): string {
  if (line.length + suffix.length <= WORKER_SCORECARD_MAX_LINE_LENGTH) return `${line}${suffix}`;
  const available = Math.max(0, WORKER_SCORECARD_MAX_LINE_LENGTH - suffix.length - 1);
  return `${line.slice(0, available)}…${suffix}`;
}
