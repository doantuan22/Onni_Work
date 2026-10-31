import type { RunRecord } from '@onni/api-client'

/**
 * The morning summary (docs/design/unattended-safety.md §7): what happened to the tasks while
 * nobody was watching, grouped by how it ended. Pure — the Inbox passes the run list it already has.
 */

export type DigestKey = 'attention' | 'limit' | 'failed' | 'done'

export interface DigestGroup {
  key: DigestKey
  title: string
  runs: RunRecord[]
}

export interface Digest {
  groups: DigestGroup[]
  costUsd: number
  tokens: number
  total: number
  /** Managers (in the window) that finished without handing any task to a worker. */
  notDelegated: RunRecord[]
  /** Tasks (in the window) whose backend refused something while the task still answered. */
  withDeniedActions: RunRecord[]
  /** Failed tasks (in the window) whose agent is not signed in: they need a login, not a retry. */
  needSignIn: RunRecord[]
}

export const DIGEST_HOURS = [1, 6, 12, 24, 48] as const
export const DEFAULT_DIGEST_HOURS = 12

const TITLES: Record<DigestKey, string> = {
  attention: 'Needs you',
  limit: 'Hit a ceiling',
  failed: 'Failed',
  done: 'Finished',
}

function classify(run: RunRecord): DigestKey | undefined {
  // A ceiling or an expired wait is the reason that matters, whatever status it ended in.
  if (run.limitHit) return 'limit'
  if (run.status === 'waiting' || run.status === 'review' || run.waitExpiredAt) return 'attention'
  if (run.status === 'failed') return 'failed'
  if (run.status === 'done') return 'done'
  return undefined
}

/** When the run last settled, falling back to creation for records that never recorded it. */
function settledAt(run: RunRecord): number {
  return Date.parse(run.finishedAt ?? run.limitHit?.at ?? run.createdAt) || 0
}

export function buildDigest(runs: readonly RunRecord[], now: number, hours: number): Digest {
  const since = now - hours * 3_600_000
  const buckets: Record<DigestKey, RunRecord[]> = { attention: [], limit: [], failed: [], done: [] }
  const notDelegated: RunRecord[] = []
  const withDeniedActions: RunRecord[] = []
  const needSignIn: RunRecord[] = []
  let costUsd = 0
  let tokens = 0
  for (const run of runs) {
    const key = classify(run)
    if (!key || run.archived) continue
    // Anything still waiting on a person is always shown; the rest only if it settled in the window.
    if (key !== 'attention' || run.status !== 'waiting' && run.status !== 'review') {
      if (settledAt(run) < since) continue
    }
    buckets[key].push(run)
    if (run.managerDidNotDelegate) notDelegated.push(run)
    if ((run.deniedActions?.length ?? 0) > 0) withDeniedActions.push(run)
    if (run.status === 'failed' && run.failureClass === 'auth') needSignIn.push(run)
    costUsd += run.costUsd ?? 0
    tokens += run.tokensUsed ?? 0
  }
  const order: DigestKey[] = ['attention', 'limit', 'failed', 'done']
  const groups = order
    .map((key) => ({ key, title: TITLES[key], runs: buckets[key].sort((a, b) => settledAt(b) - settledAt(a)) }))
    .filter((group) => group.runs.length > 0)
  return { groups, costUsd, tokens, total: groups.reduce((n, g) => n + g.runs.length, 0), notDelegated, withDeniedActions, needSignIn }
}
