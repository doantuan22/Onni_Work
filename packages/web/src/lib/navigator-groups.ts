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

  return ORDER.flatMap((label) => {
    const bucketRows = rows.get(label)
    return bucketRows?.length ? [{ label, rows: bucketRows }] : []
  })
}
