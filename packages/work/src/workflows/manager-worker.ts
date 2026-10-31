import { rosterWorkerKey, type Roster, type RosterWorker } from '@onni/contract';
import type { RunRecord } from '../runs/store.ts';

/**
 * Manager / Worker roster arithmetic (docs/design/manager-worker.md). Pure: `dispatch()` owns the
 * refusal text, notes and the child record; this file only decides which roster entry an order
 * maps onto. The roster is an orchestration fence — the server refuses a dispatch outside it — and
 * NOT a security boundary: an agent can still call a CLI or the HTTP API directly.
 */

export function describeWorker(worker: Pick<RosterWorker, 'runner' | 'model'>): string {
  return worker.model ? `${worker.runner} (${worker.model})` : worker.runner;
}

/** "codex (gpt-5) — backend tests; opencode — docs" for refusal messages and prompts. */
export function allowedWorkers(roster: Roster): string {
  return roster.workers.map((w) => `${describeWorker(w)}${w.role ? ` — ${w.role}` : ''}`).join('; ');
}

export type WorkerChoice =
  | { ok: true; worker: RosterWorker; runner: RosterWorker['runner']; model: string | undefined; key: string }
  | { refused: string };

/**
 * Map an order's `--backend` / `--model` onto a roster entry. A model-less entry accepts any model
 * the order names; an entry with a model fixes it. Several entries on one backend are told apart by
 * the model — an order that does not say which is ambiguous and refused, never guessed.
 */
export function resolveWorker(roster: Roster, order: { runner?: string | undefined; model?: string | undefined }): WorkerChoice {
  const allowed = `allowed workers: ${allowedWorkers(roster)}`;
  const named = order.runner;
  if (!named) {
    if (roster.workers.length === 1) {
      const only = roster.workers[0]!;
      return { ok: true, worker: only, runner: only.runner, model: only.model ?? order.model, key: rosterWorkerKey(only) };
    }
    return { refused: `name the worker backend with --backend; ${allowed}` };
  }
  const sameBackend = roster.workers.filter((w) => w.runner === named);
  if (sameBackend.length === 0) {
    return { refused: `${named} is not an allowed worker for this task; ${allowed}` };
  }
  const exact = order.model ? sameBackend.find((w) => w.model === order.model) : undefined;
  const open = sameBackend.find((w) => w.model === undefined);
  const chosen = exact ?? (order.model ? open : sameBackend.length === 1 ? sameBackend[0] : undefined);
  if (!chosen) {
    if (order.model) {
      return { refused: `${named} with model ${order.model} is not an allowed worker for this task; ${allowed}` };
    }
    return { refused: `${named} has several worker entries — name the model with --model; ${allowed}` };
  }
  return { ok: true, worker: chosen, runner: chosen.runner, model: chosen.model ?? order.model, key: rosterWorkerKey(chosen) };
}

/** Tasks of one roster entry that are running or starting right now, anywhere in the root's tree. */
export function workersInFlight(
  runs: readonly Pick<RunRecord, 'id' | 'dispatch'>[],
  rootId: string,
  key: string,
  isLive: (runId: string) => boolean,
): number {
  return runs.filter((r) => r.dispatch?.rootRunId === rootId && r.dispatch.workerKey === key && isLive(r.id)).length;
}
