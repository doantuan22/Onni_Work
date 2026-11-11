import { isNavigatorNeedsYou } from './attention'
import type { QuickListBucket, QuickListRow } from './task-groups'

export type NavigatorBucketLabel = 'Pinned' | 'Needs you' | 'Running' | 'Recent' | 'Archived'
export type NavigatorBucket = Omit<QuickListBucket, 'label'> & { label: NavigatorBucketLabel }

const ORDER: readonly NavigatorBucketLabel[] = ['Pinned', 'Needs you', 'Running', 'Recent', 'Archived']

function needsYou(row: QuickListRow): boolean {
  return row.kind === 'run'
    ? isNavigatorNeedsYou(row.run)
    : row.members.some(isNavigatorNeedsYou)
}

/** Apply Navigator's attention groups while retaining the task list's filtering and row ordering. */
export function groupNavigatorRows(buckets: readonly QuickListBucket[]): NavigatorBucket[] {
  const rows = new Map<NavigatorBucketLabel, QuickListRow[]>()
  const rowByRunId = new Map<string, QuickListRow>()
  for (const bucket of buckets) {
    for (const row of bucket.rows) {
      if (row.kind === 'run') rowByRunId.set(row.run.id, row)
    }
  }
  const push = (label: NavigatorBucketLabel, row: QuickListRow) => {
    const list = rows.get(label)
    if (list) list.push(row)
    else rows.set(label, [row])
  }

  for (const bucket of buckets) {
    for (const row of bucket.rows) {
      const label: NavigatorBucketLabel = bucket.label === 'Working'
        ? 'Running'
        : bucket.label === 'Recent' && needsYou(row)
          ? 'Needs you'
          : bucket.label
      push(label, row)
    }
  }

  // A failed worker must stay under its manager (§12.1). Pull the manager chain into Needs you
  // with the worker, removing those managers from their former buckets to avoid duplicate rows.
  const needsYouRows = rows.get('Needs you') ?? []
  const promoted = new Set<string>()
  for (const row of needsYouRows) {
    if (row.kind !== 'run') continue
    let parentId = row.run.dispatch?.parentRunId
    const seen = new Set([row.run.id])
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = rowByRunId.get(parentId)
      if (parent?.kind !== 'run') break
      if (!promoted.has(parentId)) {
        promoted.add(parentId)
        needsYouRows.unshift(parent)
      }
      parentId = parent.run.dispatch?.parentRunId
    }
  }
  if (promoted.size) {
    for (const [label, bucketRows] of rows) {
      if (label === 'Needs you') continue
      rows.set(label, bucketRows.filter((row) => row.kind !== 'run' || !promoted.has(row.run.id)))
    }
  }

  return ORDER.flatMap((label) => {
    const bucketRows = rows.get(label)
    return bucketRows?.length ? [{ label, rows: [...new Set(bucketRows)] }] : []
  })
}
