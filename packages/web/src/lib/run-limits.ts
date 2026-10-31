import { RUNNERS_WITHOUT_COST, RUNNERS_WITHOUT_TOKENS, type LimitKind, type RunLimits, type RunLimitsRequest, type RunRecord } from '@onni/api-client'

/**
 * Display arithmetic for a run's ceilings (docs/design/unattended-safety.md §2). The engine owns
 * enforcement; this only answers "how much of which ceiling has this run used" for the thread
 * header, the task list and the dashboard.
 */

export interface LimitRow {
  kind: LimitKind
  label: string
  used: number
  limit: number
  /** false when this backend reports nothing for the axis — the ceiling is not applied to it. */
  measured: boolean
  fraction: number
}

const LABEL: Record<LimitKind, string> = { cost: 'Cost', tokens: 'Tokens', time: 'Time', iterations: 'Steps' }

type Usage = Pick<RunRecord, 'costUsd' | 'tokensUsed' | 'steps' | 'limitUsage' | 'runner' | 'limits'>

/** A record that predates limits has no `limits`; it is shown as neither capped nor unlimited. */
export function limitMode(run: Pick<RunRecord, 'limits'>): RunLimits['mode'] | undefined {
  return run.limits?.mode
}

export function limitRows(run: Usage): LimitRow[] {
  const limits = run.limits
  if (!limits || limits.mode !== 'capped') return []
  const runner = run.runner ?? 'claude'
  const used: Record<LimitKind, number> = {
    cost: run.costUsd ?? 0,
    tokens: run.tokensUsed ?? 0,
    time: (run.limitUsage?.wallMs ?? 0) / 60_000,
    iterations: run.steps.reduce((sum, step) => sum + step.iterations, 0),
  }
  const caps: Record<LimitKind, number | undefined> = {
    cost: limits.maxCostUsd,
    tokens: limits.maxTokens,
    time: limits.maxWallClockMinutes,
    iterations: limits.maxStepIterations,
  }
  const rows: LimitRow[] = []
  for (const kind of ['cost', 'tokens', 'time', 'iterations'] as const) {
    const limit = caps[kind]
    if (limit === undefined) continue
    const measured = kind === 'cost' ? !RUNNERS_WITHOUT_COST.includes(runner) : kind === 'tokens' ? !RUNNERS_WITHOUT_TOKENS.includes(runner) : true
    rows.push({ kind, label: LABEL[kind], used: used[kind], limit, measured, fraction: measured ? Math.min(used[kind] / limit, 1) : 0 })
  }
  return rows
}

/** The row closest to its ceiling — the one worth a bar in a crowded list. */
export function tightestRow(rows: readonly LimitRow[]): LimitRow | undefined {
  return rows.filter((row) => row.measured).sort((a, b) => b.fraction - a.fraction)[0]
}

export function formatLimitValue(kind: LimitKind, value: number): string {
  if (kind === 'cost') return `$${value.toFixed(2)}`
  if (kind === 'time') return value >= 60 ? `${(value / 60).toFixed(1)}h` : `${Math.round(value)}m`
  if (kind === 'tokens') return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value))
  return String(Math.round(value))
}

export function describeRow(row: LimitRow): string {
  return row.measured
    ? `${row.label} ${formatLimitValue(row.kind, row.used)} / ${formatLimitValue(row.kind, row.limit)}`
    : `${row.label} not reported by this backend — ceiling not applied`
}

/** The form's local state: strings, because a blank number means "no limit on this axis". */
export interface LimitsDraft {
  mode: 'default' | 'none' | 'capped'
  cost: string
  tokens: string
  time: string
  iterations: string
}

export function draftFromLimits(limits: RunLimits | undefined, mode?: LimitsDraft['mode']): LimitsDraft {
  return {
    mode: mode ?? limits?.mode ?? 'capped',
    cost: limits?.maxCostUsd !== undefined ? String(limits.maxCostUsd) : '',
    tokens: limits?.maxTokens !== undefined ? String(limits.maxTokens) : '',
    time: limits?.maxWallClockMinutes !== undefined ? String(limits.maxWallClockMinutes) : '',
    iterations: limits?.maxStepIterations !== undefined ? String(limits.maxStepIterations) : '',
  }
}

/** Validate the draft into a request, or the first problem in words. */
export function requestFromDraft(draft: LimitsDraft): { ok: true; request: RunLimitsRequest } | { ok: false; error: string } {
  if (draft.mode !== 'capped') return { ok: true, request: { mode: draft.mode } }
  const fields = [
    ['cost', 'Cost', false, 'maxCostUsd'],
    ['tokens', 'Tokens', true, 'maxTokens'],
    ['time', 'Time', true, 'maxWallClockMinutes'],
    ['iterations', 'Steps', true, 'maxStepIterations'],
  ] as const
  const request: Record<string, number | string> = { mode: 'capped' }
  for (const [key, label, integer, field] of fields) {
    const raw = draft[key].trim()
    if (raw === '') continue
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
      return { ok: false, error: `${label} must be a positive ${integer ? 'whole ' : ''}number, or blank for no limit` }
    }
    request[field] = value
  }
  return { ok: true, request: request as RunLimitsRequest }
}
