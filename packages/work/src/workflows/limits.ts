import { RUNNERS_WITHOUT_COST, RUNNERS_WITHOUT_TOKENS, type LimitHit, type LimitKind, type RunLimits, type RunLimitsRequest } from '@onni/contract';
import type { RunRecord } from '../runs/store.ts';

/**
 * Cost / token / time / iteration ceilings (docs/design/unattended-safety.md §2). Pure: the
 * manager owns the clock, the timers and the cancel; this file only answers arithmetic questions.
 */

type Limited = Pick<RunRecord, 'id' | 'limits' | 'limitUsage' | 'steps' | 'tokensUsed' | 'costUsd' | 'dispatch' | 'runner'>;

export interface Usage { cost: number; tokens: number; wallMs: number; iterations: number }

const KEY: Record<LimitKind, 'maxCostUsd' | 'maxTokens' | 'maxWallClockMinutes' | 'maxStepIterations'> = {
  cost: 'maxCostUsd', tokens: 'maxTokens', time: 'maxWallClockMinutes', iterations: 'maxStepIterations',
};
export const limitKey = (kind: LimitKind) => KEY[kind];

/** The mode + numbers a new run starts with. A blank number under `capped` stays blank. */
export function resolveLimits(request: RunLimitsRequest | undefined, workspaceDefault: RunLimits): RunLimits {
  if (!request || request.mode === 'default') return { ...workspaceDefault };
  if (request.mode === 'none') return { mode: 'none' };
  const { mode: _mode, ...numbers } = request;
  return { mode: 'capped', ...numbers };
}

export function ownUsage(run: Limited): Usage {
  return {
    cost: run.costUsd ?? 0,
    tokens: run.tokensUsed ?? 0,
    wallMs: run.limitUsage?.wallMs ?? 0,
    iterations: run.steps.reduce((sum, step) => sum + step.iterations, 0),
  };
}

/** The run and every descendant (by `parentRunId`). */
export function subtreeOf<T extends Limited>(runs: readonly T[], rootId: string): T[] {
  const out: T[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const run = runs.find((r) => r.id === id);
    if (run) out.push(run);
    for (const child of runs) {
      if (child.dispatch?.parentRunId === id && !seen.has(child.id)) {
        seen.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return out;
}

/**
 * Usage of a whole subtree. USD counts only runs that reported it (an unreported run adds 0);
 * wall-clock is the root's own: children run concurrently inside it, so summing them would charge
 * the same minute several times.
 */
export function subtreeUsage(runs: readonly Limited[], rootId: string): Usage {
  const total: Usage = { cost: 0, tokens: 0, wallMs: 0, iterations: 0 };
  for (const run of subtreeOf(runs, rootId)) {
    const usage = ownUsage(run);
    total.cost += usage.cost;
    total.tokens += usage.tokens;
    total.iterations += usage.iterations;
    if (run.id === rootId) total.wallMs = usage.wallMs;
  }
  return total;
}

function figure(usage: Usage, kind: LimitKind): number {
  return kind === 'cost' ? usage.cost : kind === 'tokens' ? usage.tokens : kind === 'time' ? usage.wallMs / 60_000 : usage.iterations;
}

/** Whether a ceiling can mean anything for this backend. */
export function measurable(kind: LimitKind, runner: string | undefined): boolean {
  const id = runner ?? 'claude';
  if (kind === 'cost') return !RUNNERS_WITHOUT_COST.includes(id);
  if (kind === 'tokens') return !RUNNERS_WITHOUT_TOKENS.includes(id);
  return true;
}

function firstBreach(limits: RunLimits | undefined, usage: Usage, runner: string | undefined, scope: 'run' | 'tree', at: string): LimitHit | undefined {
  if (!limits || limits.mode !== 'capped') return undefined;
  for (const kind of ['cost', 'tokens', 'time', 'iterations'] as const) {
    const limit = limits[KEY[kind]];
    if (typeof limit !== 'number' || !measurable(kind, runner)) continue;
    const used = figure(usage, kind);
    if (used >= limit) return { kind, limit, used, scope, at };
  }
  return undefined;
}

/**
 * The ceiling `run` has crossed, if any: its own first, then the tree's shared one on the root.
 * A tree total is checked against the root's snapshot, so a child can never spend what its parent
 * was not given, whatever limits the child itself carries.
 */
export function evaluateLimits(run: Limited, runs: readonly Limited[], at: string = new Date().toISOString()): LimitHit | undefined {
  const own = firstBreach(run.limits, subtreeUsage(runs, run.id), run.runner, 'run', at);
  if (own) return own;
  const rootId = run.dispatch?.rootRunId;
  if (!rootId || rootId === run.id) return undefined;
  const root = runs.find((r) => r.id === rootId);
  return root ? firstBreach(root.limits, subtreeUsage(runs, rootId), root.runner, 'tree', at) : undefined;
}

/** A child's snapshot: the parent's mode, each number capped by what the parent subtree has left. */
export function carveChildLimits(parent: Limited, runs: readonly Limited[], requested?: { maxCostUsd?: number }): RunLimits {
  const limits = parent.limits;
  if (!limits || limits.mode !== 'capped') return { mode: 'none' };
  const usage = subtreeUsage(runs, parent.id);
  const left = (kind: LimitKind): number | undefined => {
    const limit = limits[KEY[kind]];
    return typeof limit === 'number' ? Math.max(0, limit - figure(usage, kind)) : undefined;
  };
  const cost = left('cost');
  const tokens = left('tokens');
  const minutes = left('time');
  const iterations = left('iterations');
  const asked = requested?.maxCostUsd;
  const childCost = asked !== undefined ? (cost === undefined ? asked : Math.min(cost, asked)) : cost;
  return {
    mode: 'capped',
    ...(childCost !== undefined ? { maxCostUsd: Math.max(childCost, 0.01) } : {}),
    ...(tokens !== undefined ? { maxTokens: Math.max(1, Math.floor(tokens)) } : {}),
    ...(minutes !== undefined ? { maxWallClockMinutes: Math.max(1, Math.floor(minutes)) } : {}),
    ...(iterations !== undefined ? { maxStepIterations: Math.max(1, Math.floor(iterations)) } : {}),
  };
}

/** The ceiling after "continue anyway": one more allowance of the axis that was hit, from usage. */
export function raiseLimits(limits: RunLimits | undefined, hit: LimitHit): RunLimits | undefined {
  if (!limits || limits.mode !== 'capped') return limits;
  const raised = hit.used + hit.limit;
  const value = hit.kind === 'cost' ? Math.round(raised * 100) / 100 : Math.ceil(raised);
  return { ...limits, [KEY[hit.kind]]: value };
}

export function describeHit(hit: LimitHit): string {
  const name = { cost: 'maxCostUsd', tokens: 'maxTokens', time: 'maxWallClockMinutes', iterations: 'maxStepIterations' }[hit.kind];
  const fmt = (n: number) => (hit.kind === 'cost' ? n.toFixed(2) : String(Math.round(n * 10) / 10));
  return `${name} reached${hit.scope === 'tree' ? ' for the whole task tree' : ''} — used ${fmt(hit.used)} of ${fmt(hit.limit)}`;
}
