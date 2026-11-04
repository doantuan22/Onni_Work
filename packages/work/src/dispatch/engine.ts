/**
 * Task dispatch — the PURE half (spec `.ai/specs/2026-09-10-dispatch.md`).
 *
 * Everything here is a function of its arguments: how much budget a parent has left, what a task
 * order reads like, what a settled child's report says. The stateful half — creating child runs,
 * waking a parent — lives in `RunManager` (`workflows/run.ts`), which owns the store, the queue and
 * the timers. Both turn-end handlers route through ONE helper there, and it stays short because
 * the arithmetic and the prose live here, under test on their own.
 */
import {
  DISPATCH_MAX_IN_FLIGHT,
  REPORT_FILES_MAX,
  type DispatchCheck,
  type DispatchInput,
  type DispatchPendingReport,
  type DispatchReport,
  type RunDispatch,
} from '@onni/contract';
import type { RunRecord } from '../runs/store.ts';

/**
 * Children in flight under ONE parent — the CONTRACT's value, re-exported rather than restated.
 * The schema bounds a user's `inFlight` by it (`dispatchIntentSchema`), `dispatch()` enforces it,
 * and `DISPATCH_PROMPT` tells the agent what it is: three enforcement points for one brake, and a
 * second literal `4` here is how they drift.
 */
export const MAX_CHILDREN_IN_FLIGHT = DISPATCH_MAX_IN_FLIGHT;

/** How many settled-child reports a parent keeps waiting for its next session. A
 *  bound, not a policy: the list is flushed into a PROMPT, and an unbounded one would grow into
 *  a context window no model can read. */
export const MAX_PENDING_REPORTS = 20;

/** A child that still counts against the in-flight cap — anything that has not settled. */
export const IN_FLIGHT_STATUSES: readonly string[] = ['queued', 'running', 'waiting'];

/** The four settled statuses. A child reaching any of them reports to its parent — `cancelled`
 *  included, because a parent waiting on a child a user killed would otherwise wait forever. */
export const TERMINAL_STATUSES: readonly string[] = ['done', 'review', 'failed', 'cancelled'];

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Every run whose `dispatch.parentRunId` names this parent, in store order. */
export function childrenOf(runs: readonly RunRecord[], parentId: string): RunRecord[] {
  return runs.filter((run) => run.dispatch?.parentRunId === parentId);
}

/** The subset still working — what the fan-out cap counts. */
export function inFlightChildren(runs: readonly RunRecord[], parentId: string): RunRecord[] {
  return childrenOf(runs, parentId).filter((run) => IN_FLIGHT_STATUSES.includes(run.status));
}

/**
 * What a parent may still hand out: `budgetUsd − costUsd − Σ children.budgetUsd` (spec §Budget).
 *
 * `undefined` means UNCAPPED — the parent was given no ceiling, which is the pre-existing
 * behaviour of every onni run, so a spawn under it is never refused for cost. Children are read
 * from the store rather than tracked, because a restart must not forget what is already promised;
 * a child with no ceiling of its own consumes nothing here, which is exactly why a spawn is only
 * allowed to omit `max_cost` while something is left.
 */
export function remainingBudgetUsd(parent: RunRecord, children: readonly RunRecord[]): number | undefined {
  const budget = parent.dispatch?.budgetUsd;
  if (budget === undefined) return undefined;
  // A child still in flight reserves its whole ceiling — it may yet spend it. A SETTLED child is
  // charged what it actually cost, so the unspent part of its reservation flows back to the
  // parent. Without this a commander's headroom only ever shrank: three audits lost their final
  // child to a refusal that fired while real budget remained. `costUsd ?? budgetUsd` keeps
  // a settled child with no recorded cost from being under-charged by a data gap.
  const promised = children.reduce((sum, child) => {
    // Zero may be a preliminary/partial report, even within a single step or
    // invocation. We have no cost-completeness evidence, so preserve the pre-zero-
    // reporting budget behavior: zero remains visible but cannot release a reservation.
    const settledCost = child.costUsd !== undefined && child.costUsd > 0
      ? child.costUsd : undefined;
    return sum + (isTerminalStatus(child.status)
      ? (settledCost ?? child.dispatch?.budgetUsd ?? 0)
      : (child.dispatch?.budgetUsd ?? 0));
  }, 0);
  // Rounded to a millionth of a dollar: binary-float sums of cents leave dust (3 − 1.1 − 1.1 is
  // 0.7999999999999998), and the caller compares this to a requested cap with `>`.
  return Math.round((budget - (parent.costUsd ?? 0) - promised) * 1e6) / 1e6;
}

/** A dollar amount as the transcript and the task order spell it. */
export function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * The task order one child receives: the objective it was given, then everything the parent
 * decided ABOUT it as a labelled block.
 *
 * A child sees this text and nothing else the parent knows — separate session, separate worktree,
 * separate budget — so an omitted field is a field the child will invent for itself. The parent's
 * branch and run id are always listed: the branch is what the child forked from (and what its own
 * work will be merged back into), and the run id is what makes a report traceable.
 */
export function childTaskEnvelope(
  child: DispatchInput,
  parent: { id: string; branch?: string },
  /** Extra order lines the ENGINE composes — the tree directory paths (`treeEnvelopeLines`). */
  extraLines: readonly string[] = [],
): string {
  const lines: string[] = [];
  const kind = child.kind ?? 'implement';
  if (kind === 'review') {
    lines.push('- Kind: review — you review the work named below and give a verdict; you do not implement it');
  }
  if (child.review_of?.length) lines.push(`- Review of: ${child.review_of.join(', ')}`);
  if (child.scope) lines.push(`- Scope: ${child.scope}`);
  if (child.allowed_tools?.length) lines.push(`- Allowed tools: ${child.allowed_tools.join(', ')}`);
  if (child.max_cost !== undefined) lines.push(`- Max cost: ${usd(child.max_cost)}`);
  if (child.success_criteria) lines.push(`- Success criteria: ${child.success_criteria}`);
  if (child.required_evidence) lines.push(`- Required evidence: ${child.required_evidence}`);
  if (child.retry_limit !== undefined) lines.push(`- Retry limit: ${child.retry_limit}`);
  if (parent.branch) lines.push(`- Parent branch (your fork point): ${parent.branch}`);
  if (child.after?.length) {
    lines.push(`- Starts after: ${child.after.join(', ')} — onni holds you queued until they have finished successfully`);
  }
  lines.push(`- Ordered by: run ${parent.id}`);
  lines.push(...extraLines);
  return `${child.objective}\n\n## Task order\n${lines.join('\n')}`;
}

/** Lines of one markdown section of a handoff file, the way `handoffProgressExcerpt` reads the
 *  progress log. Used for the fallback body of a report a child never wrote itself. */
export function handoffSectionExcerpt(text: string, header: string, maxLines = 4): string {
  const idx = text.indexOf(header);
  if (idx < 0) return '';
  const lines: string[] = [];
  for (const line of text.slice(idx + header.length).split('\n')) {
    if (line.startsWith('## ')) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    lines.push(trimmed);
    if (lines.length >= maxLines) break;
  }
  return lines.join('\n');
}

/** What a settled run's onni status means as a REPORT status, for a child that never filed a
 *  report of its own (`onni task report`). `review` is work finished and waiting for a human, not
 *  a failure; `cancelled` is neither done nor failed — somebody stopped it, which is a block. */
function statusToReportStatus(status: string): DispatchReport['status'] {
  if (status === 'done' || status === 'review') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'blocked';
  return 'partial';
}

/**
 * What a manager should do about a worker that settled without a report because it failed. A
 * cause that repeats (permission, sign-in, billing, usage limit) is named as such: sending the same
 * order to the same worker fails the same way, and a manager that quietly does the part itself
 * hides the failure from the user. Pure and exported so the wording is tested.
 */
export function failureAdvice(child: Pick<RunRecord, 'status' | 'error' | 'failureClass' | 'runner'>): { recommended_next_action?: string } {
  if (child.status !== 'failed' && child.status !== 'cancelled') return {};
  const error = child.error ?? '';
  const permission = /permission level|auto-denied|blocked by onni/i.test(error);
  const who = child.runner ? `the ${child.runner} worker` : 'this worker';
  if (permission) {
    return {
      recommended_next_action: `cause: permission — ${who} was denied a command it needs. The same order will fail the same way. Give that part to a worker from your roster with command access, or stop and tell the user to raise the permission level; do not do it yourself without saying so in your final report.`,
    };
  }
  if (child.failureClass === 'transient') {
    return { recommended_next_action: `cause: transient error — re-dispatch the same order once (its retry limit still applies), then report if it fails again.` };
  }
  if (child.failureClass === 'auth' || child.failureClass === 'billing' || child.failureClass === 'usage_limit') {
    return {
      recommended_next_action: `cause: ${child.failureClass} — re-dispatching to ${who} will fail again. Use a different worker from your roster, or report the cause to the user; do not do the part yourself without saying so.`,
    };
  }
  return {};
}

/**
 * A short status table of the tree's workers, appended to each batch of reports so the manager
 * decides with the whole picture: who is working, who is queued, who finished or failed.
 */
export function workerStatusBoard(runs: readonly RunRecord[], rootId: string): string | undefined {
  const workers = runs.filter((r) => r.dispatch?.rootRunId === rootId && r.id !== rootId);
  if (workers.length === 0) return undefined;
  const label = (r: RunRecord) => {
    if (r.status === 'running' || r.status === 'waiting') return 'working';
    if (r.status === 'queued') return 'queued';
    if (r.status === 'done' || r.status === 'review') return 'done';
    if (r.status === 'failed') return 'failed';
    return r.status;
  };
  const lines = workers.map((r) => `- ${r.title} (${r.runner ?? 'unknown'}, ${r.id.slice(0, 8)}): ${label(r)}`);
  return `## Workers now\n${lines.join('\n')}`;
}

/**
 * What the settle site can add to a child's report (plan v2 §6.1). All optional: a caller that
 * cannot read git still hands over a report, with the missing lines simply absent — never a
 * guessed file list that reads as "changed nothing".
 */
export interface SettleReportContext {
  resumeNotes?: string;
  changedFiles?: readonly string[];
  filesOmitted?: number;
  filesState?: 'ok' | 'timeout' | 'unavailable';
  headCommit?: string;
  /** The child's own checks, already redacted by the caller. Prefer these over the stored report. */
  checks?: readonly DispatchCheck[];
  /** #8's formatted remaining-budget line. */
  budgetLine?: string;
}

/** `files: a.ts, b.ts (+12 more)`; an unreadable tree says so instead of reading as empty. */
function filesLine(context: SettleReportContext): string | undefined {
  const state = context.filesState ?? (context.changedFiles ? 'ok' : undefined);
  if (!state) return undefined;
  if (state !== 'ok') return 'files: (not available)';
  const all = context.changedFiles ?? [];
  const shown = all.slice(0, REPORT_FILES_MAX);
  const omitted = Math.max(context.filesOmitted ?? 0, all.length - shown.length);
  const list = shown.length ? shown.join(', ') : 'none';
  return `files: ${list}${omitted > 0 ? ` (+${omitted} more)` : ''}`;
}

function checksLine(checks: readonly DispatchCheck[]): string | undefined {
  if (checks.length === 0) return undefined;
  return `checks (worker-reported, not verified): ${checks.map((check) => `${check.command} → ${check.exitCode}`).join('; ')}`;
}

/**
 * The report a settled child hands its parent, in both shapes it is needed in: the STRUCTURED
 * one (persisted on the parent as a pending report, so a restart cannot lose it) and the PROSE
 * one (delivered into the parent's session, which reads text, not JSON).
 *
 * A child that called `onni task report` reports what it said. One that did not — it crashed, was
 * cancelled, or simply forgot — still reports: its status, its resume notes if it left any, and
 * its error. A silent settle would leave the parent monitoring a child that will never speak.
 */
export function childSettleReport(
  child: RunRecord,
  context: SettleReportContext = {},
): { text: string; report: DispatchReport } {
  const own = child.dispatch?.report;
  // The settle site redacts each command before handing it over (a worker can echo a token in a
  // test command). The copy — not the stored one — is what reaches the parent, here and in
  // `pendingReportsBlock` after a restart.
  const ownReport = own && context.checks ? { ...own, checks: [...context.checks] } : own;
  // A run that settled while still parked on its own question never got its answer: that is a
  // BLOCK, whatever onni's terminal status says. A restart force-settles every `waiting` run as
  // `done`, and reporting that upward as success would turn "I stopped and asked before doing
  // something irreversible" into a clean `done` nobody ever answered — the Guard's whole premise.
  const unanswered = ownReport ? undefined : child.dispatch?.pendingAsk;
  const report: DispatchReport =
    ownReport ??
    (unanswered
      ? ({
          status: 'blocked',
          // The record keeps at most 4 of the question texts (see `pendingAsk`), so say how many
          // more there were rather than letting the parent read a truncated list as the whole ask.
          result: `unanswered question — the run settled (${child.status}) before a reply arrived: ${unanswered.questions.join(' | ')}${unanswered.omittedQuestions ? ` (+${unanswered.omittedQuestions} more)` : ''}`,
          evidence: [],
          side_effects: [],
          errors: child.error ? [child.error] : [],
          checks: [],
          suggestions: [],
        } satisfies DispatchReport)
      : ({
          status: statusToReportStatus(child.status),
          result:
            context.resumeNotes?.trim() ||
            child.error?.trim() ||
            'no structured report — the run settled without calling `onni task report`',
          evidence: [],
          side_effects: [],
          errors: child.error ? [child.error] : [],
          checks: [],
          suggestions: [],
          ...failureAdvice(child),
        } satisfies DispatchReport));

  const where = child.branch
    ? `${child.id}, branch ${child.branch}${child.baseBranch ? ` off ${child.baseBranch}` : ''}`
    : `${child.id}, no branch — it ran in the repository working tree`;
  const parts: string[] = [`status ${report.status} (onni: ${child.status})`, report.result];
  if (report.evidence.length) parts.push(`evidence: ${report.evidence.join(' · ')}`);
  if (report.errors.length) parts.push(`errors: ${report.errors.join(' · ')}`);
  if (report.side_effects.length) parts.push(`side effects: ${report.side_effects.join(' · ')}`);
  if (report.verdict) parts.push(`verdict: ${report.verdict}`);
  const files = filesLine(context);
  if (files) parts.push(files);
  if (context.headCommit) parts.push(`head: ${context.headCommit}`);
  const checks = checksLine(context.checks ?? report.checks);
  if (checks) parts.push(checks);
  if (report.recommended_next_action) parts.push(`recommended next: ${report.recommended_next_action}`);
  if (report.suggestions.length) parts.push(`suggestions for the root: ${report.suggestions.join(' · ')}`);
  if (child.costUsd !== undefined) parts.push(`cost ${usd(child.costUsd)}`);
  if (context.budgetLine) parts.push(context.budgetLine);
  if (child.diffStat) {
    parts.push(`diff ${child.diffStat.files} files, +${child.diffStat.adds} -${child.diffStat.dels}`);
  }
  const text = `Report from task "${child.title}" (${where}): ${parts.join('; ')}`;
  return { text, report };
}

/** Append a report to a parent's pending list, keeping the newest `MAX_PENDING_REPORTS`. */
export function withPendingReport(dispatch: RunDispatch, entry: DispatchPendingReport): RunDispatch {
  const pendingReports = [...(dispatch.pendingReports ?? []), entry].slice(-MAX_PENDING_REPORTS);
  return { ...dispatch, pendingReports };
}

/**
 * The block prepended to a parent's prompt when its session opens holding pending reports.
 * Rendered as prose rather than JSON for the same reason the delivered message is:
 * a commander reads its children's reports, it does not parse them.
 */
export function pendingReportsBlock(reports: readonly DispatchPendingReport[]): string | undefined {
  if (reports.length === 0) return undefined;
  const lines = reports.map((entry) => {
    const parts = [`status ${entry.report.status}`, entry.report.result];
    if (entry.report.evidence.length) parts.push(`evidence: ${entry.report.evidence.join(' · ')}`);
    if (entry.report.errors.length) parts.push(`errors: ${entry.report.errors.join(' · ')}`);
    const checks = checksLine(entry.report.checks);
    if (checks) parts.push(checks);
    return `- "${entry.title}" (${entry.fromRunId}, ${entry.at}): ${parts.join('; ')}`;
  });
  return `## Reports from your dispatched tasks\n${lines.join('\n')}`;
}

/** Generations between a run and its tree's root: the root is 0, its children 1, and so on. */
export function dispatchDepth(runs: readonly Pick<RunRecord, 'id' | 'dispatch'>[], run: Pick<RunRecord, 'id' | 'dispatch'>): number {
  let depth = 0;
  let current = run;
  const seen = new Set<string>([run.id]);
  while (current.dispatch?.parentRunId) {
    const next = runs.find((r) => r.id === current.dispatch?.parentRunId);
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    depth++;
    current = next;
  }
  return depth;
}
