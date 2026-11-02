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
  /** Calls left; `Infinity` when the subtask counter is switched off. */
  subtasks: number;
  /** The cap `subtasks` counts down from (for the "running low" nudge). */
  subtaskCap?: number;
  maxDepth: number;
}

/** Worker calls left; under 20% it tells the manager to batch the rest for workers instead of doing it itself. */
function subtaskLine(left: RemainingBudget): string {
  if (!Number.isFinite(left.subtasks)) return 'Subtasks: no limit on how many workers you may call in this tree.';
  const n = Math.max(0, left.subtasks);
  const low = left.subtaskCap !== undefined && n <= Math.ceil(left.subtaskCap * 0.2);
  const nudge = low ? ' That is running low: group the remaining work into fewer, larger worker orders instead of doing it yourself.' : '';
  return `Subtasks left in this tree: ${n}.${nudge}`;
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
    + `- ${subtaskLine(left)} Workers run at depth ${left.maxDepth}: a worker cannot dispatch further tasks.\n`
    + `- At most ${DISPATCH_MAX_IN_FLIGHT} workers in flight at once; a worker over its entry's concurrency waits in the queue.`;
}

/**
 * Thresholds the complexity policy states to the manager and the runtime check enforces softly.
 * One place, so the prompt and the warning can never disagree about what "complex" means.
 */
export const COMPLEXITY = {
  simpleMaxFiles: 2,
  simpleMaxLines: 40,
  complexMinFiles: 3,
  complexMinParts: 2,
  /** The runtime warns when an unaided manager has changed at least this many files... */
  warnFiles: 4,
  /** ...or this many lines (added + removed). */
  warnLines: 150,
} as const;

/** True when an unaided manager (no worker dispatched) has changed enough to count as complex work. */
export function managerDoingComplexAlone(stat: { files: number; adds: number; dels: number } | undefined, childCount: number): boolean {
  if (!stat || childCount > 0) return false;
  return stat.files >= COMPLEXITY.warnFiles || stat.adds + stat.dels >= COMPLEXITY.warnLines;
}

export function complexityPolicyBlock(): string {
  const c = COMPLEXITY;
  return `Sizing the work. At the start of every task, judge it and say so in one or two lines ("Assessment: simple|complex — why. Plan: what I do, what each worker does"):
- SIMPLE: at most ${c.simpleMaxFiles} files and about ${c.simpleMaxLines} changed lines, one module, a single step (a small fix, a rename, a style tweak, a quick question). Do it yourself, or hand it to a worker if that is clearly better — both are fine.
- COMPLEX: ${c.complexMinFiles}+ files, more than one module, ${c.complexMinParts}+ independent parts, or many steps. You MUST hand it to workers, or split it: you take one part, workers take the others. You may not do a whole complex task alone.
If your limit on worker calls runs out while complex work remains, do not quietly finish it yourself: tell the user the limit is spent and that "Unlimited worker calls" (Settings → Resources → Advanced) lifts it.`;
}

/** What a manager is told when the user granted it the merge permission. Enforced server-side too. */
export const FULL_ACCESS_BLOCK = `Full manager access is ON for this task: you may merge. Use the merge tool, not raw git, so the server can check and log it:
  onni task merge <worker run id or branch>   merge one worker's branch into YOUR branch
  onni task merge --to-base                   bring the base branch into yours, then fast-forward the LOCAL base branch to yours
  onni task merge --abort                     abandon a merge left in progress
It never pushes, never force-updates, never deletes a branch and never rewrites history; you also must not. Commit first (a dirty worktree is refused). On a conflict the merge is left in progress in your worktree: fix the files, git add, git commit, then run the same merge again — or --abort and report why. Do not leave the repository half-merged. This permission only gathers results: complex work still goes to workers. Merge into the base branch only when the work is verified (run the repository's checks first).`;

/** The manager's whole dispatch brief: roster, syntax, reports, integration procedure, limits. */
export function managerPrompt(roster: Roster, left: RemainingBudget, opts: { complexityPolicy?: boolean; fullAccess?: boolean } = {}): string {
  const workers = roster.workers.map((w) => {
    const name = describeWorker(w);
    return `- ${name}${w.role ? ` — ${w.role}` : ''}. Up to ${w.maxConcurrent} at once.`;
  }).join('\n');
  const manager = describeWorker(roster.manager);
  return `Manager mode. The user chose you (${manager}) to MANAGE this task: you plan, hand independent parts to workers, review what they return and integrate it. You are not one of the workers.

Your workers. You may give tasks ONLY to these — the server refuses any other backend or model with a 409 that lists the allowed ones (a fence for orchestration, not a security boundary; do not try to get around it):
${workers}

Giving work. From your shell, always through the cockpit's own binary, node "$ONNI_BIN" (every "onni task …" below means node "$ONNI_BIN" task …):

  onni task create "<objective>" --backend <worker backend> [--model <model>] [--after "<earlier order title>"] --scope "<files or dirs it may touch>" --success "<how it knows it is done>" [--title "…"] [--budget <usd>] [--evidence "<what it must show>"] [--kind implement|review] [--review-of <branch or run id>]

- Parts that need an earlier part's result (tests after the code they test, docs after the API) get --after "<title of that order>": onni holds them queued, using no slot, and starts them on top of that order's branch once it finishes well. If it fails, the dependent is cancelled and you hear why. Independent parts get no --after and run in parallel.
- Name --backend for every task. Where the same backend appears twice in your roster, name --model too; an entry that fixes a model keeps it.
- The objective is the WHOLE assignment: the worker sees its order and the tree directory, nothing else you know. Give the goal, the context it needs and what finished means.
- Match the part to the worker's role above. Give workers that run at the same time DISJOINT file scopes — two workers editing one file is the failure this design cannot recover from, so split by directory or by module, never by line.
- Omit --budget unless the user asked for a cost limit; a worker's share is carved from the remainder below.
- onni commits your uncommitted work (labelled "onni: wip before dispatch") on your branch before it forks a worker, but commit your own clean state first. A worker forks the tip of YOUR branch.
- Prefer workers: a manager that does the work itself defeats the point. Do a part yourself only when it is a few lines AND no worker fits, and say so in your final report. Dispatch only independent work, and never send the same order twice while its worker is still going.
- If a worker fails for a cause that will repeat (permission denied, not signed in, billing, usage limit), its report says so. Do not quietly redo the part yourself: send it to a different worker, or stop and tell the user the cause.

Waiting. Dispatch EVERY independent part first — workers run in parallel, and each one you hold back is time lost — then end your turn with a line containing exactly ONNI:MONITORING. onni parks you, frees your slot for the workers, and delivers each worker's report into this session when it settles. Do not poll or sleep, and do not end the turn with ONNI:DONE while any worker you dispatched has not reported and been integrated (or consciously left out).

Integrating. A report is a CLAIM: status (done, partial, failed, blocked), result, evidence, the worker's branch (onni/<id8>) and its cost. For each report, in the order they arrive:
1. Read the branch's diff (git diff <your branch>...<worker branch>) and run the tests it names.
2. Do NOT merge a worker whose status is failed or blocked, or whose evidence does not hold. Re-dispatch it with a sharper order, do the part yourself, or leave it out and say so.
3. Merge accepted branches into YOUR OWN branch, in your worktree, one at a time: git merge --no-ff <worker branch>. Resolve any conflict yourself, keeping both sides' intent.
4. Run the repository's checks after EACH merge; fix or revert before the next one.
5. When every part is in (or consciously left out), run the full checks once more and report the final result: what each worker delivered, what you changed, what is not done.
${opts.fullAccess ? FULL_ACCESS_BLOCK : "Never merge into the repository's base branch and never push; your branch goes through the usual review. (`onni task merge` is refused unless the user switched on \"Full quyền manager\"; if you need a merge you may not do, tell the user to merge by hand.)"}

${remainingLines(left)}
${opts.complexityPolicy === false ? '' : `\n${complexityPolicyBlock()}\n`}
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
