import { z } from 'zod';
import { runnerSchema } from './health.ts';

/**
 * The DISPATCH family of `/api/v1`: a task may dispatch other tasks (spec
 * `.ai/specs/2026-09-10-dispatch.md`). There are no ranks — any run with the capability on may
 * call `POST /runs/:id/dispatch`, usually from inside its own agent through the `onni task` CLI.
 * A dispatched child runs in its own worktree forked off the parent's branch, reports when it
 * settles, and its unspent budget returns to the parent.
 *
 *  - `dispatchSchema` is a RECORD field (`runRecordSchema.dispatch`), persisted by
 *    `packages/work/src/runs/store.ts` through this very value;
 *  - `dispatchInputSchema` and `dispatchReportSchema` are request bodies.
 */

/**
 * How many of a parked ask's question texts the run record carries (see
 * `dispatchSchema.pendingAsk.questions`). Frozen at 4 on purpose: raising it would make a
 * freshly written `runs.json` unreadable to an older onni's all-or-nothing index reader.
 */
export const PENDING_ASK_MAX_QUESTIONS = 4;

/** What a dispatched task is for. `implement` is the default; `review` judges another task's
 *  branch and answers with a verdict. Nothing else — kinds are cheap to add, expensive to trust. */
export const DISPATCH_KINDS = ['implement', 'review'] as const;
export const dispatchKindSchema = z.enum(DISPATCH_KINDS);
export type DispatchKind = z.infer<typeof dispatchKindSchema>;

/**
 * `POST /runs/:id/merge` — the manager's merge tool (`onni task merge`). Server-checked: the tree's
 * root must have been given "Full quyền manager" (`RunRecord.managerFullAccess`) or it is a 409.
 *  - `into: 'task'` merges one tree member's branch (`source`: run id, short id or its branch) into
 *    the manager's own branch;
 *  - `into: 'base'` brings the base branch into the manager's branch (conflicts are resolved THERE,
 *    never in the user's checkout) and then fast-forwards the local base branch. Never pushes.
 *  - `abort: true` abandons a merge left in progress by an earlier conflict.
 */
export const mergeInputSchema = z
  .object({
    into: z.enum(['task', 'base']).default('task'),
    source: z.string().min(1).max(200).optional(),
    abort: z.boolean().optional(),
  })
  .strict();
export type MergeInput = z.infer<typeof mergeInputSchema>;

export const mergeResultSchema = z.object({
  outcome: z.enum(['merged', 'up-to-date', 'conflict', 'aborted']),
  message: z.string(),
  before: z.string().optional(),
  after: z.string().optional(),
  files: z.array(z.string()).optional(),
});
export type MergeResult = z.infer<typeof mergeResultSchema>;

/**
 * Caps for the surfaces that hand manager-facing text back to a model (`#7` report, `#1` peek,
 * `#9` memory, `#6` plan). One place: the engine's output cap, the contract's array bound and the
 * prompt budget must agree, or a value can be written that the prompt never shows.
 * Declared BEFORE the schemas that read them: these are constants, not hoisted imports.
 */
export const REPORT_FILES_MAX = 15;
export const REPORT_CHECKS_MAX = 10;
export const PEEK_MAX_ENTRIES = 12;
export const PEEK_FILES_MAX = 50;
export const PEEK_TAIL_MAX_LINES = 30;
export const PEEK_TAIL_MAX_CHARS_PER_LINE = 200;
export const PEEK_TAIL_MAX_CHARS_PER_ENTRY = 4_000;
export const PEEK_ALL_MAX_CHARS_TOTAL = 8_000;
/** UTF-8 bytes, for both writing and reading project memory into a prompt (plan v2 §8). */
export const MANAGER_MEMORY_MAX_BYTES = 3_072;
export const MANAGER_MEMORY_ENTRY_MAX_CHARS = 300;
/** The non-blocking manager ask (plan v2 §9): the question the model writes, and the copy that
 *  lives on the run record — cut to the same 400 the Guard's `pendingAsk` uses. */
export const MANAGER_ASK_QUESTION_MAX_CHARS = 2_000;
export const MANAGER_ASK_RECORD_QUESTION_MAX_CHARS = 400;
export const MANAGER_ASK_OPTION_LABEL_MAX_CHARS = 120;
export const MANAGER_ASK_OPTION_DESCRIPTION_MAX_CHARS = 500;
export const MANAGER_ASK_OPTIONS_MAX = 10;
export const MANAGER_ASK_TIMEOUT_MINUTES_MAX = 1_440;
export const PLAN_MAX_PARTS = 50;
export const PLAN_PROMPT_MAX_PARTS = 15;
/** `onni task verify` (wave A1): bounds on what a manager can make onni run and read back. */
export const VERIFY_MAX_COMMANDS = 10;
export const VERIFY_MAX_RUNS_PER_WORKER = 3;
export const VERIFY_COMMAND_TIMEOUT_MS = 120_000;
export const VERIFY_TOTAL_TIMEOUT_MS = 280_000;
export const VERIFY_TAIL_MAX_LINES = 40;
export const VERIFY_TAIL_MAX_CHARS_PER_LINE = 200;
export const VERIFY_TAIL_TOTAL_MAX_CHARS = 8_000;
export const VERIFY_WARNINGS_MAX = 5;
/** `onni task conflicts` (wave A2): bounds on a manager-facing overlap and trial report. */
export const CONFLICTS_MAX_PAIRS = 20;
export const CONFLICTS_FILES_MAX = REPORT_FILES_MAX;
export const CONFLICTS_TRIAL_MAX = 8;

/**
 * What is left of a tree's ceilings, JSON-safe (plan v2 §6.2). `null` means "no ceiling on this
 * axis" everywhere — never an absent field, never `Infinity` (which `JSON.stringify` would turn
 * into `null` anyway, but one of the two would be an accident). Negatives are clamped to 0 and
 * remembered as `overBudget`.
 */
export const dispatchBudgetSchema = z.object({
  costUsd: z.number().nonnegative().nullable(),
  tokens: z.number().nonnegative().nullable(),
  minutes: z.number().nonnegative().nullable(),
  steps: z.number().int().nonnegative().nullable(),
  subtasks: z.number().int().nonnegative().nullable(),
  subtaskCap: z.number().int().nullable(),
  maxDepth: z.number().int(),
  overBudget: z.boolean(),
});
export type DispatchBudget = z.infer<typeof dispatchBudgetSchema>;

/**
 * `GET /runs/:id/peek` — a manager looking at a worker that is still running (plan v2 §7). One
 * entry per worker; the compact answer carries no `tail`, only the state, cost, files and how
 * long the transcript has been silent. `filesState` is NOT "nothing changed": `unavailable` and
 * `timeout` both mean the answer is unknown, and the CLI says so in words.
 */
export const dispatchPeekEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  runner: z.string().optional(),
  model: z.string().optional(),
  status: z.string(),
  activity: z.string().optional(),
  branch: z.string().optional(),
  baseBranch: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  costUsd: z.number().optional(),
  tokensUsed: z.number(),
  currentStep: z.object({ name: z.string(), status: z.string() }).optional(),
  files: z.array(z.string().max(300)).max(PEEK_FILES_MAX),
  filesOmitted: z.number().int().nonnegative(),
  filesState: z.enum(['ok', 'timeout', 'unavailable']),
  quietMinutes: z.number().int().nonnegative().nullable(),
  tail: z.array(z.string().max(PEEK_TAIL_MAX_CHARS_PER_LINE)).max(PEEK_TAIL_MAX_LINES),
  tailTruncated: z.boolean(),
});
export type DispatchPeekEntry = z.infer<typeof dispatchPeekEntrySchema>;

export const dispatchPeekSchema = z.object({
  workers: z.array(dispatchPeekEntrySchema).max(PEEK_MAX_ENTRIES),
  workersOmitted: z.number().int().nonnegative(),
});
export type DispatchPeek = z.infer<typeof dispatchPeekSchema>;

export const VERIFY_STATES = ['passed', 'failed', 'unavailable'] as const;
export const VERIFY_SOURCES = ['required-checks', 'discovered', 'none'] as const;
export const VERIFY_UNAVAILABLE_CODES = ['no-bash', 'no-commands', 'no-worktree', 'dry-run', 'git-unreadable'] as const;
export const VERIFY_OUTCOMES = ['passed', 'failed', 'timed-out', 'skipped'] as const;

/**
 * `POST /runs/:id/verify` — `:id` is the calling manager (the caller convention of `merge`/`peek`),
 * `target` the settled worker. There is deliberately no `command` field: `only` can merely SELECT
 * among the commands the server resolved, so the route is not a remote-exec endpoint.
 */
export const dispatchVerifyInputSchema = z
  .object({
    target: z.string().trim().min(1).max(200),
    only: z.array(z.string().trim().min(1).max(2_000)).max(VERIFY_MAX_COMMANDS).optional(),
  })
  .strict();
export type DispatchVerifyInput = z.input<typeof dispatchVerifyInputSchema>;

export const dispatchVerifyCommandResultSchema = z.object({
  command: z.string().max(300),
  outcome: z.enum(VERIFY_OUTCOMES),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  timedOut: z.boolean(),
  tail: z.array(z.string().max(VERIFY_TAIL_MAX_CHARS_PER_LINE)).max(VERIFY_TAIL_MAX_LINES),
  tailTruncated: z.boolean(),
});
export type DispatchVerifyCommandResult = z.infer<typeof dispatchVerifyCommandResultSchema>;

export const dispatchVerifyResultSchema = z.object({
  state: z.enum(VERIFY_STATES),
  reasonCode: z.enum(VERIFY_UNAVAILABLE_CODES).optional(),
  reason: z.string().max(400).optional(),
  source: z.enum(VERIFY_SOURCES),
  headCommit: z.string().max(40).optional(),
  startedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  results: z.array(dispatchVerifyCommandResultSchema).max(VERIFY_MAX_COMMANDS),
  runsUsed: z.number().int().nonnegative(),
  runsMax: z.number().int().positive(),
  warnings: z.array(z.string().max(300)).max(VERIFY_WARNINGS_MAX),
});
export type DispatchVerifyResult = z.infer<typeof dispatchVerifyResultSchema>;

export const CONFLICT_FILES_STATES = ['ok', 'timeout', 'unavailable'] as const;
export const CONFLICT_SCOPE_STATES = ['none', 'free-text', 'checked'] as const;
export const CONFLICT_TRIAL_STATES = ['clean', 'conflict', 'unavailable', 'timeout'] as const;

export const dispatchConflictWorkerSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  branch: z.string().optional(),
  headCommit: z.string().max(40).optional(),
  filesCount: z.number().int().nonnegative(),
  filesTruncated: z.boolean(),
  filesState: z.enum(CONFLICT_FILES_STATES),
  scopeState: z.enum(CONFLICT_SCOPE_STATES),
  outsideScope: z.array(z.string().max(300)).max(CONFLICTS_FILES_MAX),
  outsideScopeOmitted: z.number().int().nonnegative(),
});
export type DispatchConflictWorker = z.infer<typeof dispatchConflictWorkerSchema>;

export const dispatchConflictOverlapSchema = z.object({
  a: z.string(),
  b: z.string(),
  files: z.array(z.string().max(300)).max(CONFLICTS_FILES_MAX),
  filesOmitted: z.number().int().nonnegative(),
});
export type DispatchConflictOverlap = z.infer<typeof dispatchConflictOverlapSchema>;

export const dispatchTrialMergeSchema = z.object({
  kind: z.enum(['worker-worker', 'into-manager']),
  left: z.string(),
  right: z.string(),
  leftHead: z.string().max(40).optional(),
  rightHead: z.string().max(40).optional(),
  state: z.enum(CONFLICT_TRIAL_STATES),
  files: z.array(z.string().max(300)).max(CONFLICTS_FILES_MAX),
  filesOmitted: z.number().int().nonnegative(),
  reason: z.string().max(300).optional(),
});
export type DispatchTrialMerge = z.infer<typeof dispatchTrialMergeSchema>;

export const dispatchConflictsSchema = z.object({
  workers: z.array(dispatchConflictWorkerSchema).max(PEEK_MAX_ENTRIES),
  workersOmitted: z.number().int().nonnegative(),
  overlaps: z.array(dispatchConflictOverlapSchema).max(CONFLICTS_MAX_PAIRS),
  overlapsOmitted: z.number().int().nonnegative(),
  trialMerges: z.array(dispatchTrialMergeSchema).max(CONFLICTS_TRIAL_MAX),
  trialMergesSkipped: z.number().int().nonnegative(),
  trialState: z.enum(['ran', 'unavailable']),
  trialReason: z.string().max(300).optional(),
  checkedAt: z.string(),
});
export type DispatchConflicts = z.infer<typeof dispatchConflictsSchema>;

/**
 * Project memory (plan v2 §8): durable lessons a manager leaves for later tasks in this
 * repository, in `<dataDir>/manager-memory.md`. `bytes` is UTF-8, not characters — a Vietnamese
 * lesson costs more bytes than its `length` — and `maxBytes` travels with every answer so the
 * Settings counter and the CLI cannot each invent their own ceiling.
 */
export const managerMemoryReadSchema = z.object({
  content: z.string(),
  bytes: z.number().int().nonnegative(),
  maxBytes: z.number().int().positive(),
  revision: z.string(),
});
export type ManagerMemoryRead = z.infer<typeof managerMemoryReadSchema>;

/** `PUT /manager-memory` (Settings): `revision` is the read the user edited, so a save over a
 *  concurrent one is a 409 instead of a silently lost lesson. */
export const managerMemoryPutSchema = z.object({
  content: z.string(),
  revision: z.string(),
});
export type ManagerMemoryPut = z.infer<typeof managerMemoryPutSchema>;

/** `POST /runs/:id/memory` (`onni task memory add`): one lesson, one line. */
export const managerMemoryAddSchema = z.object({
  entry: z.string().trim().min(1).max(MANAGER_MEMORY_ENTRY_MAX_CHARS),
});
export type ManagerMemoryAdd = z.infer<typeof managerMemoryAddSchema>;

/**
 * `POST /runs/:id/ask` (plan v2 §9): a root manager asking the user a question WITHOUT parking its
 * turn. `timeoutMinutes` is the manager choosing its own deadline; absent means the question stays
 * open until answered or the task is cancelled.
 */
export const managerAskInputSchema = z.object({
  question: z.string().trim().min(1).max(MANAGER_ASK_QUESTION_MAX_CHARS),
  options: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(MANAGER_ASK_OPTION_LABEL_MAX_CHARS),
        description: z.string().max(MANAGER_ASK_OPTION_DESCRIPTION_MAX_CHARS).optional(),
      }),
    )
    .max(MANAGER_ASK_OPTIONS_MAX)
    .optional(),
  timeoutMinutes: z.number().int().min(1).max(MANAGER_ASK_TIMEOUT_MINUTES_MAX).optional(),
});
export type ManagerAskInput = z.infer<typeof managerAskInputSchema>;

/** The id the user's answer must carry back as `replyTo`. */
export const managerAskResponseSchema = z.object({ requestId: z.string() });
export type ManagerAskResponse = z.infer<typeof managerAskResponseSchema>;

/**
 * The tree plan (plan v2 §10, `#6A`): what the manager intends to do, in `<treeDir>/plan.json`.
 * Display and restore only — the engine's order still comes from `after` and the queue, so a stale
 * plan costs the manager nothing but its own confusion.
 */
export const PLAN_PART_STATUSES = ['planned', 'assigned', 'done', 'dropped'] as const;
export const planPartStatusSchema = z.enum(PLAN_PART_STATUSES);
export type PlanPartStatus = z.infer<typeof planPartStatusSchema>;

export const treePlanPartSchema = z.object({
  id: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(300),
  status: planPartStatusSchema,
  /** A roster key (`backend:model`) or a backend that names exactly one entry, for display. */
  worker: z.string().max(80).optional(),
  /** The run this part was handed to. Checked against the tree before it is stored. */
  runId: z.string().optional(),
  /** Other part ids this one waits for. Cycles are refused by `findPlanCycle`, not by Zod. */
  after: z.array(z.string()).max(10).optional(),
});
export type TreePlanPart = z.infer<typeof treePlanPartSchema>;

/**
 * Structural invariants of a part list: ids unique, every `after` pointing at a part that exists.
 * Attached to the ARRAY (not the file object) so the PUT body and the stored file are held to the
 * same rules. Cycles are a separate, pure check (`dispatch/tree-fs.ts`), as the plan requires.
 */
function refinePlanParts(parts: TreePlanPart[], ctx: z.RefinementCtx): void {
  const ids = new Set<string>();
  parts.forEach((part, index) => {
    if (ids.has(part.id)) {
      ctx.addIssue({ code: 'custom', path: [index, 'id'], message: `duplicate plan part id "${part.id}"` });
    }
    ids.add(part.id);
  });
  parts.forEach((part, index) => {
    part.after?.forEach((ref, refIndex) => {
      if (!ids.has(ref)) {
        ctx.addIssue({ code: 'custom', path: [index, 'after', refIndex], message: `after "${ref}" names no part in this plan` });
      }
    });
  });
}

export const treePlanPartsSchema = z.array(treePlanPartSchema).max(PLAN_MAX_PARTS).superRefine(refinePlanParts);

/** GET/PUT `/runs/:id/plan`, and the file itself. An absent plan reads as `{ parts: [], updatedAt: '', revision: '0' }`. */
export const treePlanSchema = z.object({
  parts: treePlanPartsSchema,
  updatedAt: z.string(),
  revision: z.string(),
});
export type TreePlan = z.infer<typeof treePlanSchema>;

/** `PUT /runs/:id/plan` — replace every part. `revision` is the read the manager edited, so a save
 *  over a concurrent one is a 409 instead of a silently merged plan. The server stamps `updatedAt`. */
export const treePlanPutSchema = z.object({
  parts: treePlanPartsSchema,
  revision: z.string(),
});
export type TreePlanPut = z.infer<typeof treePlanPutSchema>;

/** `PATCH /runs/:id/plan/parts/:partId` — one part's status and/or the run it was handed to. */
export const treePlanPatchSchema = z.object({
  status: planPartStatusSchema.optional(),
  /** `''` clears the link (a part that was un-dispatched); any other value is resolved in the tree. */
  runId: z.string().optional(),
});
export type TreePlanPatch = z.infer<typeof treePlanPatchSchema>;

/** One command a worker says it ran, and the exit code it saw (plan v2 §6.1). Never verified by
 *  onni — the report label says `worker-reported`, and `#4` is where real verification lives. */
export const dispatchCheckSchema = z.object({
  command: z.string().trim().min(1).max(300),
  exitCode: z.number().int(),
});
export type DispatchCheck = z.infer<typeof dispatchCheckSchema>;

/** `POST /runs/:id/report` — how a dispatched task reports upward (the `onni task report` CLI). */
export const dispatchReportSchema = z.object({
  status: z.enum(['done', 'partial', 'failed', 'blocked']),
  result: z.string().max(4000),
  evidence: z.array(z.string().max(400)).max(12).default([]),
  confidence: z.number().min(0).max(1).optional(),
  side_effects: z.array(z.string().max(400)).max(12).default([]),
  errors: z.array(z.string().max(400)).max(12).default([]),
  recommended_next_action: z.string().max(1000).optional(),
  /** Commands the worker says it ran, with their exit codes. A CLAIM, not a verified result. */
  checks: z.array(dispatchCheckSchema).max(10).default([]),
  /** A REVIEW task's verdict on the branch it reviewed. The parent merges only after `approve`. */
  verdict: z.enum(['approve', 'changes', 'reject']).optional(),
  /** What the ROOT task should know that lies outside this task's order. Forwarded to the root's
   *  inbox at settle. Suggest, never redefine: the objective stays the user's. */
  suggestions: z.array(z.string().max(400)).max(8).default([]),
});
export type DispatchReport = z.infer<typeof dispatchReportSchema>;

/** A report that arrived while its parent had no open session. Persisted on the parent, flushed
 *  into the prompt when the parent's next session opens. */
export const dispatchPendingReportSchema = z.object({
  fromRunId: z.string(),
  title: z.string(),
  report: dispatchReportSchema,
  at: z.string(),
});
export type DispatchPendingReport = z.infer<typeof dispatchPendingReportSchema>;

/** The engine's own ceiling on children in flight per task; a user's `inFlight` may only lower it. */
export const DISPATCH_MAX_IN_FLIGHT = 4;
/** The most subtasks a user may ask a root for through the composer. */
export const DISPATCH_MAX_SUBTASKS = 100;

/**
 * What the USER asked for when starting a task with the composer's Dispatch toggle: this task is
 * the one that fans out, within these limits. Every field optional — the bare toggle is
 * `{}`, and means "split it, engine defaults for everything". Sent on `POST /runs` as
 * `dispatch`, persisted as `dispatch.intent` on the root, read by the prompt (the intent block)
 * and by `dispatch()` (the caps and the child defaults).
 */
export const dispatchIntentSchema = z.strictObject({
  /** Ceiling on children under this ROOT, in total, across the whole tree. */
  maxSubtasks: z.number().int().min(1).max(DISPATCH_MAX_SUBTASKS).optional(),
  /** Ceiling on children in flight per task — lowers the engine's own, never raises it. */
  inFlight: z.number().int().min(1).max(DISPATCH_MAX_IN_FLIGHT).optional(),
  /** Runner for children whose order names none. Absent = the parent's. */
  runner: runnerSchema.optional(),
  /** Model for children whose order names none. Absent = the parent's. */
  model: z.string().max(120).optional(),
  /** Budget in USD for children whose order names none. Absent = the parent's remainder. */
  budgetUsd: z.number().positive().max(10_000).optional(),
});
export type DispatchIntent = z.infer<typeof dispatchIntentSchema>;

/**
 * The `dispatch` object on a run record. Present on every run that dispatched or was dispatched;
 * absent on a plain task, which then behaves exactly as it always has.
 */
export const dispatchSchema = z.object({
  /** The tree's root run id (the root names itself). */
  rootRunId: z.string(),
  /** On a worker started under a roster: which roster entry it occupies (`backend:model`). */
  workerKey: z.string().optional(),
  /** On a ROOT started with the composer's Dispatch toggle: what the user asked for. */
  intent: dispatchIntentSchema.optional(),
  /** Absent on the root; present on every dispatched child. */
  parentRunId: z.string().optional(),
  /** What this task is for. Absent = `implement`. */
  kind: dispatchKindSchema.optional(),
  /** Sibling run ids that must settle successfully before this one starts (the order's `after`). */
  after: z.array(z.string().max(120)).max(8).optional(),
  /** For a `review` task: the run ids or branches it reviews. */
  reviewOf: z.array(z.string().max(120)).max(8).optional(),
  /** This task's spend ceiling in USD, carved out of its parent's. Absent = none of its own. */
  budgetUsd: z.number().nonnegative().optional(),
  /** This task's own report — last one wins. */
  report: dispatchReportSchema.optional(),
  /** Reports from settled children waiting for this task's next session. */
  pendingReports: z.array(dispatchPendingReportSchema).optional(),
  /** ISO-8601 watermark: inbox files newer than this are "new" for the next digest or wake. */
  inboxSeenAt: z.string().optional(),
  /** The question this run is parked on (the Guard), cleared when an answer is delivered. */
  pendingAsk: z
    .object({
      requestId: z.string().optional(),
      /**
       * At most `PENDING_ASK_MAX_QUESTIONS` texts, and that bound does NOT follow
       * `ASK_MAX_QUESTIONS` upward. This is a persisted record field, and
       * `readRunIndexFromDisk` is all-or-nothing (`return []` on a parse failure): a
       * record written with more entries than an older onni's copy of this schema
       * accepts empties that onni's WHOLE project index — every task gone from the
       * palette and from search — over one parked question. The writer truncates and
       * counts the rest in `omittedQuestions` instead; the parent gets every question
       * in full through the Guard inbox message, which is a markdown file under no
       * schema.
       */
      questions: z.array(z.string().max(400)).max(PENDING_ASK_MAX_QUESTIONS),
      /**
       * Additive: how many of the ask's questions are NOT in `questions[]` above,
       * written only when the list was truncated. Absent means nothing was omitted,
       * which is exactly how every record written before this field replays.
       */
      omittedQuestions: z.number().int().positive().optional(),
      askedAt: z.string(),
    })
    .optional(),
  /** Set at turn end once `costUsd ≥ budgetUsd`: the run parks and stops auto-continuing. */
  overBudget: z.boolean().optional(),
  /**
   * A manager question the user has not answered yet (plan v2 §9). Unlike `pendingAsk` it never
   * parks the run, so it is not cleared by a free message — only by the answer that carries this
   * `requestId` as `replyTo`, by expiry, or by cancel. Kept on settle so the user still sees it.
   */
  softAsk: z
    .object({
      requestId: z.string(),
      askedAt: z.string(),
      /** ISO deadline; absent when the manager asked with no `timeoutMinutes`. */
      expiresAt: z.string().optional(),
      question: z.string().max(MANAGER_ASK_RECORD_QUESTION_MAX_CHARS),
      optionCount: z.number().int().nonnegative(),
    })
    .optional(),
  /** `onni task verify` bookkeeping on the WORKER's record (wave A1): runs used and the last verdict. No tails. */
  /** The manager's original dispatch scope, retained for advisory conflicts reports (wave A2). */
  scope: z.string().max(1_000).optional(),
  verify: z
    .object({
      runs: z.number().int().nonnegative(),
      last: z
        .object({
          at: z.string(),
          headCommit: z.string().max(40).optional(),
          state: z.enum(['passed', 'failed']),
          source: z.enum(['required-checks', 'discovered']),
          results: z
            .array(
              z.object({
                command: z.string().max(300),
                outcome: z.enum(VERIFY_OUTCOMES),
                exitCode: z.number().int().nullable(),
              }),
            )
            .max(VERIFY_MAX_COMMANDS),
        })
        .optional(),
    })
    .optional(),
});
export type RunDispatch = z.infer<typeof dispatchSchema>;
export type DispatchPendingAsk = NonNullable<RunDispatch['pendingAsk']>;

/**
 * `POST /runs/:id/dispatch` — the task order for ONE child. `.strict()`: an unknown key here is a
 * brake that did not fire (a misspelled `max_cost` would spawn an uncapped child).
 */
export const dispatchInputSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    objective: z.string().min(1).max(4000),
    kind: dispatchKindSchema.optional(),
    review_of: z.array(z.string().max(120)).max(8).optional(),
    scope: z.string().max(1000).optional(),
    allowed_tools: z.array(z.string().max(80)).max(16).optional(),
    max_cost: z.number().positive().optional(),
    success_criteria: z.string().max(1000).optional(),
    required_evidence: z.string().max(1000).optional(),
    retry_limit: z.number().int().min(0).max(3).optional(),
    /** Sibling orders (titles or short ids) that must finish first; this one waits queued until they have. */
    after: z.array(z.string().max(120)).max(8).optional(),
    /** The tree-plan part this order fills. The server marks it `assigned` with the child's id,
     *  atomically with the dispatch; an unknown part is a refusal, never a silent new one. */
    partId: z.string().trim().min(1).max(40).optional(),
    /** The worker backend — the primary name; `runner` stays as the compatible alias. */
    backend: runnerSchema.optional(),
    /** The child's backend and model. Absent = the parent's. */
    runner: runnerSchema.optional(),
    model: z.string().max(200).optional(),
  })
  .strict();
export type DispatchInput = z.infer<typeof dispatchInputSchema>;

/** `POST /runs/:id/dispatch` → the child's id and branch (the branch is what the parent merges). */
export const dispatchResponseSchema = z.object({
  id: z.string(),
  branch: z.string().optional(),
});
export type DispatchResponse = z.infer<typeof dispatchResponseSchema>;
