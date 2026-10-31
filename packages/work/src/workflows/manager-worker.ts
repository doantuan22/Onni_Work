import { rosterWorkerKey, type Roster, type RosterWorker } from '@onni/contract';
import { DISPATCH_MAX_IN_FLIGHT } from '@onni/contract';
import { REVIEW_PROMPT } from '../dispatch/prompts.ts';
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

// ---- prompts (docs/design/manager-worker.md R3, R11) -----------------------------------------

/** What is left of the tree's ceilings, worded for the manager. Absent axes are simply not named. */
export interface RemainingBudget {
  /** true when the root runs without ceilings. */
  unlimited: boolean;
  costUsd?: number;
  tokens?: number;
  minutes?: number;
  steps?: number;
  subtasks: number;
  maxDepth: number;
}

function remainingLines(left: RemainingBudget): string {
  const parts: string[] = [];
  if (left.unlimited) parts.push('cost, tokens, time and steps: no ceiling is set for this tree');
  else {
    if (left.costUsd !== undefined) parts.push(`$${Math.max(0, left.costUsd).toFixed(2)} of budget`);
    if (left.tokens !== undefined) parts.push(`${Math.max(0, Math.round(left.tokens)).toLocaleString('en-US')} tokens`);
    if (left.minutes !== undefined) parts.push(`${Math.max(0, Math.round(left.minutes))} minutes of running time`);
    if (left.steps !== undefined) parts.push(`${Math.max(0, left.steps)} agent steps`);
  }
  const shared = left.unlimited ? '' : ' — shared by you and every worker; the whole tree stops when a ceiling is reached';
  return `- Remaining at the start of this session: ${parts.join(', ')}${shared}.\n`
    + `- Subtasks left in this tree: ${Math.max(0, left.subtasks)}. Workers run at depth ${left.maxDepth}: a worker cannot dispatch further tasks.\n`
    + `- At most ${DISPATCH_MAX_IN_FLIGHT} workers in flight at once; a worker over its entry's concurrency waits in the queue.`;
}

/** The manager's whole dispatch brief: roster, syntax, reports, integration procedure, limits. */
export function managerPrompt(roster: Roster, left: RemainingBudget): string {
  const workers = roster.workers.map((w) => {
    const name = describeWorker(w);
    return `- ${name}${w.role ? ` — ${w.role}` : ''}. Up to ${w.maxConcurrent} at once.`;
  }).join('\n');
  const manager = describeWorker(roster.manager);
  return `Manager mode. The user chose you (${manager}) to MANAGE this task: you plan, hand independent parts to workers, review what they return and integrate it. You are not one of the workers.

Your workers. You may give tasks ONLY to these — the server refuses any other backend or model with a 409 that lists the allowed ones (a fence for orchestration, not a security boundary; do not try to get around it):
${workers}

Giving work. From your shell, always through the cockpit's own binary, node "$ONNI_BIN" (every "onni task …" below means node "$ONNI_BIN" task …):

  onni task create "<objective>" --backend <worker backend> [--model <model>] --scope "<files or dirs it may touch>" --success "<how it knows it is done>" [--title "…"] [--budget <usd>] [--evidence "<what it must show>"] [--kind implement|review] [--review-of <branch or run id>]

- Name --backend for every task. Where the same backend appears twice in your roster, name --model too; an entry that fixes a model keeps it.
- The objective is the WHOLE assignment: the worker sees its order and the tree directory, nothing else you know. Give the goal, the context it needs and what finished means.
- Match the part to the worker's role above. Give workers that run at the same time DISJOINT file scopes — two workers editing one file is the failure this design cannot recover from, so split by directory or by module, never by line.
- Omit --budget unless the user asked for a cost limit; a worker's share is carved from the remainder below.
- onni commits your uncommitted work (labelled "onni: wip before dispatch") on your branch before it forks a worker, but commit your own clean state first. A worker forks the tip of YOUR branch.
- If you can finish a part faster than describing it, do it yourself; dispatch only independent work.

Waiting. After dispatching, end your turn with a line containing exactly ONNI:MONITORING. onni parks you, frees your slot for the workers, and delivers each worker's report into this session when it settles. Do not poll or sleep.

Integrating. A report is a CLAIM: status (done, partial, failed, blocked), result, evidence, the worker's branch (onni/<id8>) and its cost. For each report, in the order they arrive:
1. Read the branch's diff (git diff <your branch>...<worker branch>) and run the tests it names.
2. Do NOT merge a worker whose status is failed or blocked, or whose evidence does not hold. Re-dispatch it with a sharper order, do the part yourself, or leave it out and say so.
3. Merge accepted branches into YOUR OWN branch, in your worktree, one at a time: git merge --no-ff <worker branch>. Resolve any conflict yourself, keeping both sides' intent.
4. Run the repository's checks after EACH merge; fix or revert before the next one.
5. When every part is in (or consciously left out), run the full checks once more and report the final result: what each worker delivered, what you changed, what is not done.
Never merge into the repository's base branch and never push; your branch goes through the usual review.

${remainingLines(left)}

Remember the Guard: before anything irreversible or outside your scope, end the turn with ONNI:ASK and stop.`;
}

/** What a worker in a roster tree is told: report-only, no dispatching. */
export const WORKER_PROMPT = `Worker mode. A manager task dispatched you. Do the assignment in your task order, inside the scope it names, on your own branch (onni/<id8>); COMMIT your work before you finish — the manager merges your branch, not your working tree. You cannot dispatch further tasks, so do not look for a way to: do the work yourself or report that it is blocked.

When your assignment is settled, report before finishing (always through the cockpit's own binary, node "$ONNI_BIN"):

  onni task report --status done|partial|failed|blocked --result "<what you did and the state now>" [--evidence "…" …] [--suggestions "…" …] [--confidence 0.8]

Be honest: a done that is not done costs your manager a whole extra round trip. Evidence is commands you ran and what they printed, files you changed, tests that passed. The tree directory (ONNI_TREE_DIR) holds brief.md (the manager's objective) and your order.md; write your running notes in notes.md.

Processes. Put a time limit on anything that could hang. Stop a process you started by its pid, never with pkill -f on a generic pattern. Before you report, stop anything you started that is still running.

The Guard. Before anything irreversible or outside your scope — pushing, merging into the base branch, deleting a branch, spending beyond your budget — end the turn with ONNI:ASK and stop.`;

export function workerPrompt(kind: string | undefined): string {
  return kind === 'review' ? `${WORKER_PROMPT}\n\n${REVIEW_PROMPT}` : WORKER_PROMPT;
}
