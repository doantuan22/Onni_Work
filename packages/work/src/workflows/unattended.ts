import type { RunRecord } from '../runs/store.ts';

/**
 * A run nobody is watching (spec unattended-safety): it carries `autonomous`, or it is a task
 * dispatched by another run (children always run autonomously). The one definition every
 * unattended-only brake reads, so a new gate cannot pick its own.
 */
export function isUnattended(run: Pick<RunRecord, 'autonomous' | 'dispatch'> | undefined): boolean {
  return run?.autonomous === true || run?.dispatch?.parentRunId !== undefined;
}
