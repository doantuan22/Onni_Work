import type { RunRecord } from '@onni/api-client'

import { isNeedsYouStatus } from './attention'

/**
 * The compact "Needs you" strip's data (plan v2 §9). One row per run that wants a human: a run an
 * open manager question is waiting on — even a settled one, because the question outlives the
 * manager's turn — or a run in the ordinary needs-you states (`lib/attention.ts`).
 *
 * Pure and dependency-free on purpose: the strip paints what this returns, and a test pins the
 * selection without a browser, a clock or a socket. `runs` already arrives over SSE.
 */
export interface NeedsYouItem {
  run: RunRecord
  /** The open manager question, when the run is waiting on an answer (plan v2 §9). */
  question?: string
  expiresAt?: string
}

export function needsYou(runs: readonly RunRecord[]): NeedsYouItem[] {
  const items: NeedsYouItem[] = []
  for (const run of runs) {
    if (run.archived) continue
    const soft = run.dispatch?.softAsk
    if (soft) {
      items.push({
        run,
        question: soft.question,
        ...(soft.expiresAt !== undefined ? { expiresAt: soft.expiresAt } : {}),
      })
    } else if (isNeedsYouStatus(run)) {
      items.push({ run })
    }
  }
  // Open questions first: they carry something to read and answer. Stable within each half, so the
  // caller's own ordering still governs rows of the same kind.
  return items.filter((item) => item.question !== undefined)
    .concat(items.filter((item) => item.question === undefined))
}
