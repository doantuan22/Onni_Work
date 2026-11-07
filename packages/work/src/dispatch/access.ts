/**
 * Who may call a manager–worker route (plan v2 §1.3, H1). Declared once so `merge`, `peek`,
 * `memory`, `ask` and `plan` cannot drift into six slightly different copies of the same check.
 *
 * This is an ORCHESTRATION FENCE, not a sandbox: an agent can still call the HTTP API directly.
 */
import type { RunRecord } from '../runs/store.ts';

export type AccessDenial = { ok: false; denied: string; status: 403 | 404 | 409 };
export type Access = { ok: true } | AccessDenial;

/** The root of the tree a run belongs to; a plain task is its own root. */
export function treeRootOf(run: Pick<RunRecord, 'id' | 'dispatch'>): string {
  return run.dispatch?.rootRunId ?? run.id;
}

/**
 * The root manager of a manager–worker tree: it carries the roster and was not dispatched itself
 * (the same test `mergeFromAgent` has always used). `action` names what was being attempted, so a
 * denial reads as the operation the caller actually tried.
 */
export function requireRootManager(run: RunRecord | undefined, action = 'manage this task tree'): Access {
  if (!run) return { ok: false, denied: 'no such run', status: 404 };
  if (!run.roster || run.dispatch?.parentRunId) {
    return { ok: false, denied: `only the manager of a manager–worker task can ${action}`, status: 403 };
  }
  return { ok: true };
}

/**
 * Resolve a run reference: an exact id, else a prefix of at least 6 characters. Two prefix matches
 * are `'ambiguous'` rather than silently picking the first (`peek`/`merge` keep their older copy).
 */
export function resolveRunRef(runs: readonly RunRecord[], ref: string): RunRecord | 'none' | 'ambiguous' {
  const exact = runs.find((run) => run.id === ref);
  if (exact) return exact;
  if (ref.length < 6) return 'none';
  const matches = runs.filter((run) => run.id.startsWith(ref));
  if (matches.length === 0) return 'none';
  return matches.length === 1 ? matches[0]! : 'ambiguous';
}

/** A target must live in the caller's tree; anything else is a refusal, never a silent empty answer. */
export function requireSameTree(caller: RunRecord, target: RunRecord): Access {
  if (treeRootOf(caller) === treeRootOf(target)) return { ok: true };
  return {
    ok: false,
    denied: `run ${target.id.slice(0, 8)} belongs to another task tree`,
    status: 409,
  };
}
