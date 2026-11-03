import type { RunRecord } from '@onni/api-client'

import type { ThreadAsk } from './thread-state'

/**
 * Which ask cards are open, and which one wins when a Guard ask and a manager ask coexist
 * (plan v2 §9). A Guard ask is resolved by the next user message (the reducer does that), while a
 * manager ask is non-blocking: its open state lives on the RECORD (`dispatch.softAsk`), so a free
 * message never closes it and it reappears once the Guard card is answered.
 *
 * Pure and table-tested: the transcript shows every card, but only one can be "the question".
 */
export function isManagerAskOpen(
  run: Pick<RunRecord, 'dispatch'>,
  ask: Pick<ThreadAsk, 'id' | 'fromManager'>,
): boolean {
  return ask.fromManager === true && run.dispatch?.softAsk?.requestId === ask.id
}

/** A card is open when the stream has not resolved it, or when the record still holds a manager ask. */
export function askNeedsAnswer(
  run: Pick<RunRecord, 'dispatch'>,
  ask: Pick<ThreadAsk, 'id' | 'fromManager' | 'resolved'>,
): boolean {
  return ask.fromManager === true ? isManagerAskOpen(run, ask) : !ask.resolved
}

/**
 * The one question the UI should point at: a Guard ask first (it parked the run), then the open
 * manager ask. `undefined` when nothing is open.
 */
export function openAskCard(
  run: Pick<RunRecord, 'dispatch'>,
  asks: readonly Pick<ThreadAsk, 'id' | 'fromManager' | 'resolved'>[],
): Pick<ThreadAsk, 'id' | 'fromManager' | 'resolved'> | undefined {
  return asks.find((ask) => ask.fromManager !== true && !ask.resolved)
    ?? asks.find((ask) => askNeedsAnswer(run, ask))
}
