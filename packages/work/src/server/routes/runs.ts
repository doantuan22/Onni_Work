import { basename, join, posix } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import {
  ATTACHMENT_IMAGES_TOO_LARGE,
  ATTACHMENT_UPLOAD_MISSING,
  attachmentListSchema,
  clearProjectDataInputSchema,
  continueInputSchema,
  markViewedInputSchema,
  runHistoryQuerySchema,
  runIdParamSchema,
  runsListQuerySchema,
  hasTaskOrAttachments,
  TASK_OR_ATTACHMENTS_ISSUE,
  dispatchIntentSchema,
  rosterSchema,
  rosterUpdateInputSchema,
  runLimitsRequestSchema,
  type AttachmentEntry,
  type ClearProjectDataResult,
  type ContinueResponse,
  type MessageResponse,
  MAX_ATTACHMENTS_TOTAL_BASE64,
  isImageMediaType,
} from '@onni/contract';
import { z } from 'zod';
import { jsonZodValidator, paramZodValidator, queryZodValidator } from '../validators.ts';
import { HistoryCursorError, deriveRunContextEvents, readRunHistoryPage } from '../../runs/event-history.ts';
import type { ProjectContext } from '../project-context.ts';
import type { RunRecord } from '../../runs/store.ts';
import type { ContentBlock, RunnerId } from '../../core/agent-runner.ts';
import { RUNNER_IDS } from '../../core/agent-runner.ts';
import {
  foldedLength,
  imageChars,
  MAX_FOLDED_TASK_CHARS,
  MAX_QUEUED_ATTACHMENTS,
  QUEUED_IMAGES_TOO_LARGE,
  queuedImageChars,
  queuedStackRefusal,
} from '../../workflows/queued-bounds.ts';
import { checkoutGitStatus } from '../../workflows/landing.ts';
import { removeWorktree, worktreeDiff } from '../../git-worktree.ts';
import { protectedByLiveTree } from '../../runs/retention.ts';
import { lifecycleError } from '../worktree-lifecycle.ts';
import { getRepoInfo } from '../git.ts';
import {
  collectChanges,
  collectCommitChanges,
  collectRunCommits,
  commitAll,
  imageMimeType,
  isOsOpenableImage,
  listRepoPaths,
  isCommitSha,
  readImageAtRev,
  pushCurrentBranch,
  worktreeGitStatus,
  readWorktreePath,
} from '../git-changes.ts';
import { loadConfig } from '../../config.ts';
import { DEFAULT_AGENT_ACCOUNT_ID } from '../../workspace/agent-accounts.ts';
import { resolveProfileEnvForRoot } from '../../workspace/agent-profiles.ts';
import { forgetRefStatus, refNumberFromUrl } from '../github.ts';
import { agentCliRunner, withResolvedClaudeBin } from '../open-in-app.ts';
import { createDraftPr, type DraftPrOutcome } from '../pr.ts';
import { findBranchPr, resolvePrTarget } from '../forge/github.ts';
import {
  providerForActiveRun,
  providerForExistingRun,
  providersRequiredByWorkflow,
  recordedProfileFor,
  type ProviderAccountScope,
} from '../provider-action-gate.ts';
import { AGENT_MODELS_LOCKED_ERROR, agentModelsLocked } from '../../core/agent-model-policy.ts';
import { loadWorkflows } from '../../workflows/load.ts';
import { stepsIssue, workflowStepSchema, type WorkflowDef } from '../../workflows/types.ts';
import { readHandoff } from '../../handoff.ts';
import { readUpload } from '../../uploads.ts';
import { toPastedContent, type PastedContent } from '../../workflows/run.ts';
import { MessageReceipts } from '../message-receipts.ts';
import type { ProviderId } from '../../core/provider-auth.ts';
import type { Capabilities } from '@onni/contract';
import type { ResolvedAgentProfile } from '../../workspace/agent-profiles.ts';
import type { ProcessUsage } from '../../core/process-usage.ts';
import type { RunsQueryValueSchema } from '../server.ts';

// A run starts from a named workflow OR an inline chain of steps (spec 008 —
// the approved plan is posted as-is, never written to a file).
const startRunSchema = z
  .object({
    workflow: z.string().min(1).optional(),
    steps: z.array(workflowStepSchema).min(1).max(8).optional(),
    // The primary agent prompt handed to the spawned runner. Bounded like the
    // other prompt fields (`systemPrompt` 20k, message `text` 100k) so an
    // unbounded body can't be piped into a spawned process (#429). 100k chars
    // (~25k tokens) is well past any hand-written task. May be empty when attachments carry the
    // task (telemetry 18c930de) — the refine below requires one or the other.
    task: z.string().max(100_000, 'must be at most 100000 characters'),
    model: z.string().optional(),
    // Agent backend for this task (falls back to config `defaultRunner`).
    runner: z.enum(RUNNER_IDS).optional(),
    // Agent account for this task (spec 2026-07-29-agent-profiles). Falls back to the project's
    // own selection, then the discovered default. Bounded like a profile id in the workspace
    // schema, so a value this route accepts can never be degraded away by the next load.
    agentProfile: z.string().max(64).optional(),
    // Parallel variants (spec 010): ×2/×3 runs the task as 2–3 competing
    // agents in separate worktrees; the user compares diffs and picks one.
    variants: z.number().int().min(1).max(3).optional(),
    // Composer worktree opt-out (#worktree-toggle): false runs in the repo
    // working tree. Ignored when variants > 1.
    worktree: z.boolean().optional(),
    // With worktree:false, switch the checkout to a branch forked from base first
    // (spec 2026-10-19-repo-git-sync); `branch` names it.
    newBranch: z.boolean().optional(),
    branch: z.string().trim().min(1).max(200).optional(),
    // A read-only Ask task (spec 2026-10-20-trunk-based-projects): in place, no lease, no writes.
    readOnly: z.boolean().optional(),
    // Autonomous mode (#autonomous): the run never parks at `waiting` — it
    // auto-continues until the agent signals done. No "needs you" is raised.
    autonomous: z.boolean().optional(),
    // Cost / token / time / iteration ceilings (docs/design/unattended-safety.md). Omitted =
    // the workspace default; refused when the request comes from inside an agent task.
    limits: runLimitsRequestSchema.optional(),
    // Manager–worker (docs/design/manager-worker.md): this task manages the listed workers.
    roster: rosterSchema.optional(),
    // "Full quyền manager": the manager may merge (needs a roster). Omitted = the workspace default (off).
    managerFullAccess: z.boolean().optional(),
    // Generate follow-up inbox entries (spec 007, #444). Honoured only while
    // the `followups` capability is on (#471) — off, the server pins it to
    // false whatever the client asked for. Omitted still means "enabled" for
    // old clients, but only within an already-enabled server. The handoff
    // journal is unaffected either way.
    generateFollowups: z.boolean().optional(),
    // Per-run system-prompt override (R2 2.3) — programmatic callers only
    // (bookmarklets, scripts); deliberately NOT a composer-UI control. Wins
    // over the config.json default; whitespace-only degrades to absent.
    systemPrompt: z
      .string()
      .trim()
      .max(20_000, 'must be at most 20000 characters')
      .optional()
      .transform((s) => (s ? s : undefined)),
    // Attachments pasted into the new-task form — same shape and limits as a
    // live-session message; delivered with the first agent step's opening.
    images: attachmentListSchema.optional(),
    // Inbox follow-up (#374): the todo the composer was prefilled from
    // (`/new?skill=&ref=&todo=t1`). On a successful start the entry is marked
    // started — the same bookkeeping POST /api/todos/:id/start does, so the
    // audit trail survives the composer detour. Bounded like every other
    // string here; a todo id is a short generated key.
    todoId: z.string().min(1).max(200, 'must be at most 200 characters').optional(),
    // The composer's Dispatch toggle (spec 2026-09-10-dispatch): this task is the root of a
    // dispatch tree, within the user's limits. Dropped — not refused — when the capability is
    // off: the task itself is still perfectly valid as an ordinary run.
    dispatch: dispatchIntentSchema.optional(),
  })
  .refine((b) => Boolean(b.workflow) !== Boolean(b.steps), {
    message: 'provide either "workflow" or "steps", not both',
  })
  .refine(hasTaskOrAttachments, TASK_OR_ATTACHMENTS_ISSUE);

// Editable titles (#389), and the initial prompt while the run is still queued
// (#472 — rejected with 409 on any other status by the handler).
const patchRunSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  task: z.string().trim().min(1).max(100_000).optional(),
});

// `POST /runs/:id/pr`: `draft` defaults to true — a bodyless POST still opens the draft PR every
// caller got before the flag existed (the review gate's Draft PR); the run header's Create PR asks
// for a ready-for-review one with `draft: false`.
const createPrSchema = z.object({ draft: z.boolean().optional() });

// Session commit (redesign R5 — §"Git/session API additions").
const gitCommitSchema = z.object({
  message: z.string().trim().min(1, 'must not be empty').max(5_000),
});

// "Open in…" (#open-in / #365): `target` selects the app; `path` (optional, worktree-relative)
// narrows the target's own worktree/repo-root default to one file — used by the diff pane's
// "open in default app" action for images. Containment is re-checked server-side via
// `readWorktreePath`; this schema only shapes the request.
const openInSchema = z.object({
  // A short bound (#429): matched against a downstream allowlist, so an editor id is never long.
  target: z.string().trim().min(1, 'target required').max(200),
  path: z.string().max(1_000).optional(),
});

// Attachment-carrying bodies validate with the CONTRACT's `attachmentListSchema` (#950) —
// images plus the short PDF/TXT/MD allowlist, ~5 MB each once base64-decoded. Imported rather
// than mirrored here, so the wire cannot drift from what the cockpit compiles against.
const messageSchema = z
  .object({
    text: z.string().max(100_000).default(''),
    images: attachmentListSchema.default([]),
    idempotencyKey: z.string().uuid().optional(),
    /** The manager-ask `requestId` this message answers (plan v2 §9). Absent for a free message. */
    replyTo: z.string().min(1).max(120).optional(),
  })
  .refine((m) => m.text.trim().length > 0 || m.images.length > 0, {
    message: 'message needs text or at least one attachment',
  });

// Run ids are unique across projects, so one workspace-wide receipt book serves every mount.
const messageReceipts = new MessageReceipts<MessageResponse>();
const continueReceipts = new MessageReceipts<ContinueResponse>();

// PATCH semantics are load-bearing here: an omitted field keeps its current value.
// In particular, the cockpit edits text without re-uploading existing attachments.
const queuedMessagePatchSchema = z
  .object({
    text: z.string().max(100_000).optional(),
    images: attachmentListSchema.optional(),
  })
  .refine((m) => m.text !== undefined || m.images !== undefined, {
    message: 'message edit needs text or attachments',
  });

/** A message's attachments as engine content, staged uploads read back from the store
 *  (telemetry 7054e5f2). A string is the refusal: `ATTACHMENT_UPLOAD_MISSING` when a referenced
 *  upload is gone (the composer re-stages), or the image budget — images reach the provider
 *  inline in one turn, so references count toward it too. */
function resolveAttachments(entries: AttachmentEntry[]): PastedContent[] | string;
function resolveAttachments(entries: AttachmentEntry[] | undefined): PastedContent[] | undefined | string;
function resolveAttachments(entries: AttachmentEntry[] | undefined): PastedContent[] | undefined | string {
  if (entries === undefined) return undefined;
  const out: PastedContent[] = [];
  let imageChars = 0;
  for (const entry of entries) {
    const attachment = 'data' in entry ? entry : readUpload(entry.uploadId);
    if (!attachment) return ATTACHMENT_UPLOAD_MISSING;
    if (isImageMediaType(attachment.mediaType)) imageChars += attachment.data.length;
    out.push(toPastedContent('data' in entry || !entry.name ? attachment : { ...attachment, name: entry.name }));
  }
  if (imageChars > MAX_ATTACHMENTS_TOTAL_BASE64) return ATTACHMENT_IMAGES_TOO_LARGE;
  return out;
}

// "Continue"/"Send back" body: the contract's own schema, so the wire cannot drift from the client.
const continueSchema = continueInputSchema;

// `POST /api/runs/:id/archive` (#429) — no body archives; `{archived:false}`
// un-archives. A tiny schema so the route follows the safeParse convention.
const archiveSchema = z.object({
  archived: z.boolean().optional(),
});

// `POST /api/v1/runs/:id/pin` (#935) — no body pins; `{pinned:false}` unpins. The archive
// route's shape, deliberately: it is the same kind of per-task flag, and a second spelling for
// "absent means do the thing" would be one more rule for a client to remember.
const pinSchema = z.object({
  pinned: z.boolean().optional(),
});

/** In-flight `POST /runs/:id/pr` publishes, keyed by data dir + run id. */
const prPublishes = new Map<string, Promise<{ outcome: DraftPrOutcome; branch: string }>>();

type ProjectApiEnv = { Variables: { project: ProjectContext } };
type DeleteRunResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string }
  | { ok: false; status: 'lifecycle'; error: unknown };
type RunsRouteDeps = {
  FILE_FORMATS: readonly string[];
  FILE_TYPES: Record<string, string>;
  IMAGE_TYPES: Record<string, string>;
  NO_WORKTREE: string;
  capabilities: () => Capabilities;
  deleteRunFully: (project: ProjectContext, id: string) => Promise<DeleteRunResult>;
  handoffEnv: (provider: ProviderId, profileId: string | undefined) => Promise<{ env: Record<string, string> } | { error: string }>;
  handoffFallbackCommand: (cwd: string, command: string, env: Record<string, string>) => string | null;
  legacyWorktreeMutation: <T>(project: ProjectContext, runId: string, mutate: () => Promise<T>) => Promise<T>;
  negotiate: <O extends string>(accept: string | undefined, offers: readonly O[]) => O | null;
  noteTodoStarted: (dataDir: string, todoId: string, taskId: string) => Promise<void>;
  openApp: typeof import('../open-in-app.ts').openInApp;
  openFile: typeof import('../open-in-app.ts').openFileInDefaultApp;
  openTerminal: typeof import('../open-in-terminal.ts').openInTerminal;
  providerActionError: (required: readonly ProviderId[], scope?: ProviderAccountScope) => Promise<string | null>;
  queryValue: RunsQueryValueSchema;
  resolveWorkspaceProfile: (provider: ProviderId, profileId?: string) => Promise<{ profile: ResolvedAgentProfile } | { error: string }>;
  resumeCommand: (runner: string | undefined, sessionId: string) => string | null;
  runPrNumbers: (run: RunRecord) => number[];
  stopTaskProcesses: (runId: string) => void;
  withUsage: (run: RunRecord) => RunRecord & { usage?: ProcessUsage };
  withWorktreeMutation: <T>(project: ProjectContext, runId: string, mutate: () => Promise<T>) => Promise<T>;
  workingDirectoryOf: (run: RunRecord, repoRoot: string) => string | null;
  worktreeOf: (run: RunRecord) => string | null;
};

/** The project-scoped run API. Shared lifecycle, terminal and provider closures stay in createApp and enter through deps. */
export function createRunsRoutes(deps: RunsRouteDeps) {
  const {
    FILE_FORMATS,
    FILE_TYPES,
    IMAGE_TYPES,
    NO_WORKTREE,
    capabilities,
    deleteRunFully,
    handoffEnv,
    handoffFallbackCommand,
    legacyWorktreeMutation,
    negotiate,
    noteTodoStarted,
    openApp,
    openFile,
    openTerminal,
    providerActionError,
    queryValue,
    resolveWorkspaceProfile,
    resumeCommand,
    runPrNumbers,
    stopTaskProcesses,
    withUsage,
    withWorktreeMutation,
    workingDirectoryOf,
    worktreeOf,
  } = deps;
  return new Hono<ProjectApiEnv>()
    // `workflowDef` is ~1.3 MB per run; the list leaves it out (`?full=1` opts back in, GET /runs/:id is always complete).
    .get('/runs', queryZodValidator(runsListQuerySchema), (c) => {
      const full = c.req.valid('query').full === '1';
      return c.json(
        c
          .get('project')
          .store.listRuns()
          .map((run) => withUsage(full || !run.workflowDef ? run : { ...run, workflowDef: undefined })),
      );
    })

    /** Replace a live manager–worker tree's roster. Existing children continue; future dispatches use the update. */
    .put('/runs/:id/roster', jsonZodValidator(rosterUpdateInputSchema), async (c) => {
      if (!capabilities().dispatch) {
        return c.json({ error: 'manager–worker needs task dispatch, which this cockpit has turned off (ONNI_DISPATCH=0)' }, 409);
      }
      const { store, root: repoRoot, manager } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'no such run' }, 404);
      const roster = c.req.valid('json').roster;
      const backends = [...new Set([roster.manager.runner, ...roster.workers.map((worker) => worker.runner)])];
      const unavailable = await providerActionError(backends, { repoRoot });
      if (unavailable) return c.json({ error: unavailable }, 409);
      const outcome = manager.updateRosterFromUser(run.id, roster);
      if ('denied' in outcome) return c.json({ error: outcome.denied }, outcome.status);
      return c.json({ roster: outcome.roster });
    })

    // Registered before the `/:id/...` routes so "archive-finished" and "read-all"
    // never match as a run id.
    .post('/runs/archive-finished', (c) => {
      const { store } = c.get('project');
      const open = store.listRuns().filter((run) => !run.archived).map((run) => run.id);
      const archived = store.archiveFinished();
      // The sweep is an archive like any other: each task it took loses its terminals (spec §6).
      if (archived > 0) for (const id of open) if (store.getRun(id)?.archived) stopTaskProcesses(id);
      return c.json({ archived });
    })

    // The read-receipt sweep (#unread-done-items) — the mark-read twin of the archive
    // sweep above, and under the same registration-order guard.
    .post('/runs/read-all', (c) => c.json({ read: c.get('project').store.markAllRead() }))

    .post('/runs/:id/archive', jsonZodValidator(archiveSchema, { absent: ({}) }), async (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      // An empty/absent body archives (the common case); a malformed body degrades
      // to `{}` just as before, but a wrong-typed `archived` is now a 400 (#429).
      // Archiving also retires any pending usage-limit resume, but that rule belongs to
      // `setArchived` itself — the bulk sweep must obey it too (spec
      // 2026-08-03-auto-resume-after-usage-limit).
      const parsed = { data: c.req.valid('json') };
      const retiresQuestion = parsed.data.archived !== false && store.getRun(id)?.awaitingAnswerSince !== undefined;
      const run = store.setArchived(id, parsed.data.archived !== false);
      if (run && parsed.data.archived !== false) stopTaskProcesses(id);
      if (run && retiresQuestion) manager.notifyQuestionRetired?.(id);
      return run ? c.json(run) : c.json({ error: 'not found' }, 404);
    })

    // Pin one task to the top of this project's list, or unpin it (#935). The archive route's
    // twin in every respect: an absent body pins (the common case), the answer is the updated
    // record, and the change rides the existing `run` SSE because `setPinned` touches. No new
    // event and no new response shape.
    .post('/runs/:id/pin', jsonZodValidator(pinSchema, { absent: ({}) }), (c) => {
      const { store } = c.get('project');
      const { pinned: pin } = c.req.valid('json');
      const pinned = pin !== false;
      const run = store.setPinned(c.req.param('id'), pinned);
      return run ? c.json(run) : c.json({ error: 'not found' }, 404);
    })

    // The per-task off switch for that resume (the workspace setting is Settings → Resources).
    // Idempotent: a run with nothing pending answers 200 too, because "this task will not
    // resume itself" is equally true either way.
    .delete('/runs/:id/auto-resume', (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
      manager.cancelAutoResume(id);
      return c.json({ cancelled: true as const });
    })

    .post('/runs/:id/read', (c) => {
      // No body: opening a thread marks it read, full stop. Stamps `seenAt = now` and
      // returns the updated record (which also rides the `run` SSE via `touch`).
      const run = c.get('project').store.setRead(c.req.param('id'));
      return run ? c.json(run) : c.json({ error: 'not found' }, 404);
    })

    .post('/runs/:id/unread', (c) => {
      // The mark-unread twin (#775) — bodyless like its read counterpart: clearing the
      // receipt is the whole action, so there is nothing to say about it. Sits under
      // `/runs/:id/`, so the `read-all` registration-order caveat above does not apply.
      const run = c.get('project').store.setUnread(c.req.param('id'));
      return run ? c.json(run) : c.json({ error: 'not found' }, 404);
    })

    .post(
      '/runs/:id/viewed',
      paramZodValidator(runIdParamSchema),
      jsonZodValidator(markViewedInputSchema),
      (c) => {
        const { id } = c.req.valid('param');
        const { seq } = c.req.valid('json');
        const run = c.get('project').store.markViewed(id, seq);
        return run ? c.json(run) : c.json({ error: 'not found' }, 404);
      },
    )

    .post('/runs', jsonZodValidator(startRunSchema), async (c) => {
      const { root: repoRoot, dataDir, manager } = c.get('project');
      const parsed = { data: c.req.valid('json') };
      if (agentModelsLocked(repoRoot) && parsed.data.model?.trim()) {
        return c.json({ error: AGENT_MODELS_LOCKED_ERROR }, 409);
      }
      let workflow: WorkflowDef | undefined;
      if (parsed.data.steps) {
        // Inline chain (spec 008): an approved plan runs as an ad-hoc workflow.
        const issue = stepsIssue(parsed.data.steps);
        if (issue) return c.json({ error: issue }, 400);
        workflow = {
          name: '(planned)',
          source: 'built-in',
          steps: parsed.data.steps,
        };
      } else {
        const { workflows } = await loadWorkflows(repoRoot);
        workflow = workflows.find((w) => w.name === parsed.data.workflow);
        if (!workflow) return c.json({ error: `unknown workflow: ${parsed.data.workflow}` }, 404);
      }
      const roster = parsed.data.roster;
      if (roster) {
        if (!capabilities().dispatch) {
          return c.json({ error: 'manager–worker needs task dispatch, which this cockpit has turned off (ONNI_DISPATCH=0)' }, 409);
        }
        if ((parsed.data.variants ?? 1) > 1) return c.json({ error: 'a manager–worker task cannot also run as parallel variants' }, 400);
        if (!(await getRepoInfo(repoRoot))) {
          return c.json({ error: 'manager–worker needs a git repository: every worker runs in its own worktree' }, 400);
        }
        // Only backends that are connected and enabled right now may be chosen — the roster is a
        // list of agents the user picked from what this machine can actually run.
        const rosterBackends = [...new Set([roster.manager.runner, ...roster.workers.map((w) => w.runner)])];
        const unavailable = await providerActionError(rosterBackends, { repoRoot });
        if (unavailable) return c.json({ error: unavailable }, 409);
      }
      const fallback = roster ? roster.manager.runner : parsed.data.runner ?? (await loadConfig(repoRoot)).defaultRunner;
      const blocked = await providerActionError(providersRequiredByWorkflow(workflow, fallback), {
        repoRoot,
        profileFor: (provider) => (provider === fallback ? parsed.data.agentProfile : undefined),
      });
      if (blocked) return c.json({ error: blocked }, 409);
      // A composer override names an account the user just picked, so a stale id (deleted since
      // the page loaded) is answered honestly instead of quietly running on the default — the
      // opposite of how RESOLUTION treats a dangling reference, and deliberately so: a run
      // replaying a stored id has no better answer than the default, a user does.
      if (parsed.data.agentProfile !== undefined) {
        const account = await resolveWorkspaceProfile(fallback, parsed.data.agentProfile);
        if ('error' in account) return c.json({ error: account.error }, 400);
      }
      const variants = parsed.data.variants ?? 1;
      if (variants > 1) {
        // Variants require git worktrees to isolate their changes.
        const repo = await getRepoInfo(repoRoot);
        if (!repo) {
          return c.json(
            {
              error:
                'parallel variants need a git repository (each variant runs in its own worktree) — run ×1 here, or start onni inside a git repo',
            },
            400,
          );
        }
      }
      const images = resolveAttachments(parsed.data.images);
      if (typeof images === 'string') return c.json({ error: images }, 400);
      const input = {
        task: parsed.data.task,
        model: parsed.data.model,
        runner: parsed.data.runner,
        agentProfile: parsed.data.agentProfile,
        images,
        systemPrompt: parsed.data.systemPrompt,
        worktree: parsed.data.worktree,
        newBranch: parsed.data.newBranch,
        branch: parsed.data.branch,
        ...(parsed.data.readOnly ? { readOnly: true } : {}),
        autonomous: parsed.data.autonomous,
        ...(parsed.data.limits ? { limits: parsed.data.limits } : {}),
        ...(roster ? { roster } : {}),
        ...(roster && parsed.data.managerFullAccess !== undefined ? { managerFullAccess: parsed.data.managerFullAccess } : {}),
        // Opt-in inbox (#471): the capability is the ceiling, so a client asking
        // for follow-ups on a server that has them off gets a plain `false`
        // rather than an error — the run is still perfectly valid without them.
        // One decision here feeds the run record, the system prompt and
        // ONNI_TODOS_FILE alike (RunManager.agentEnv).
        generateFollowups: capabilities().followups ? parsed.data.generateFollowups : false,
        ...(parsed.data.dispatch && capabilities().dispatch ? { dispatchIntent: parsed.data.dispatch } : {}),
      };
      if (variants > 1) {
        const runs = manager.startVariants(workflow, input, variants);
        // The entry points at the first variant — the thread the composer navigates to.
        const first = runs[0];
        if (parsed.data.todoId && first) await noteTodoStarted(dataDir, parsed.data.todoId, first.id);
        return c.json({ runs }, 201);
      }
      const run = manager.startRun(workflow, input);
      if (parsed.data.todoId) await noteTodoStarted(dataDir, parsed.data.todoId, run.id);
      return c.json(run, 201);
    })

    .get('/runs/:id', (c) => {
      const { store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      return run ? c.json(withUsage(run)) : c.json({ error: 'not found' }, 404);
    })

    .get(
      '/runs/:id/history',
      paramZodValidator(runIdParamSchema),
      queryZodValidator(runHistoryQuerySchema),
      async (c) => {
        const { store, dataDir } = c.get('project');
        const { id } = c.req.valid('param');
        if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
        try {
          return c.json(
            await readRunHistoryPage(join(dataDir, 'runs', `${id}.ndjson`), c.req.valid('query').cursor),
          );
        } catch (error) {
          if (error instanceof HistoryCursorError) return c.json({ error: error.message }, error.status);
          throw error;
        }
      },
    )

    .get(
      '/runs/:id/history-context',
      paramZodValidator(runIdParamSchema),
      async (c) => {
        const { store, dataDir } = c.get('project');
        const { id } = c.req.valid('param');
        if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
        return c.json(await deriveRunContextEvents(join(dataDir, 'runs', `${id}.ndjson`)));
      },
    )

    // Editable titles (#389). The UI displays `titleSummary ?? title`, so a
    // user edit sets BOTH: `title` (the record's own name — the raw task stops
    // being it the moment the user renames the run) and `titleSummary` (what
    // actually displays). The auto-summarizer only ever fills an *unset*
    // titleSummary (RunManager.recordTurnEnd), so an edit wins over any past or
    // future auto-summary. Answers the updated record.
    .patch('/runs/:id', jsonZodValidator(patchRunSchema), async (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
      const parsed = { data: c.req.valid('json') };
      // The prompt is editable only while the run is still queued (#472). Checked
      // BEFORE the title write so a rejected PATCH is a no-op rather than a partial
      // one. `title` itself keeps working on any status — no regression to #389.
      if (parsed.data.task !== undefined) {
        const foldedChars = foldedLength(parsed.data.task, store.getRun(id)?.queuedMessages ?? []);
        if (foldedChars > MAX_FOLDED_TASK_CHARS) {
          return c.json(
            {
              error: `prompt too long — ${MAX_FOLDED_TASK_CHARS} character limit across the task and its queued messages (would be ${foldedChars})`,
            },
            400,
          );
        }
        if (!manager.editTask(id, parsed.data.task)) {
          return c.json({ error: 'run already started' }, 409);
        }
      }
      if (parsed.data.title !== undefined) {
        // titleOrigin 'user' permanently stops the namer's live updates for this run
        // (spec 2026-07-17-task-auto-naming).
        store.updateRun(id, {
          title: parsed.data.title,
          titleSummary: parsed.data.title,
          titleOrigin: 'user',
        });
      }
      return c.json(store.getRun(id));
    })

    .post('/runs/:id/cancel', (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
      const cancelled = manager.cancel(id);
      return c.json({ cancelled });
    })

    // "Start now": jump a queued run past the `maxParallel` cap.
    .post('/runs/:id/start-now', async (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
      const outcome = await manager.startNow(id);
      if (outcome === 'not-queued') return c.json({ error: 'run is not queued' }, 409);
      if (outcome === 'held') return c.json({ error: 'the agent account is held by a usage limit' }, 409);
      return c.json({ started: true as const });
    })

    // Live-session participation (spec 002): deliver a user message (text +
    // pasted screenshots) into the run's open claude session.
    .post('/runs/:id/messages', jsonZodValidator(messageSchema), async (c) => {
      const { root: repoRoot, dataDir, store, manager } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      const parsed = { data: c.req.valid('json') };
      // A retried POST whose first attempt already landed answers as it did (message-receipts.ts).
      const receipt = parsed.data.idempotencyKey ? await messageReceipts.claim(`${id}:${parsed.data.idempotencyKey}`) : undefined;
      if (receipt && 'prior' in receipt) return c.json(receipt.prior);
      let answered: MessageResponse | undefined;
      try {
        // Stacking onto a queued prompt mutates an existing task and invokes no provider.
        // Provider availability still gates live delivery after the record leaves `queued`, but
        // must not strand prompt authoring just because an unrelated fallback provider is
        // disconnected (provider-auth spec: disabling never blocks existing-task mutations).
        // In the dequeue race, the ladder below safely turns this into a starting-state buffer.
        if (run.status !== 'queued') {
          const blocked = await providerActionError([providerForActiveRun(run)], {
            repoRoot,
            profileFor: (provider) => recordedProfileFor(run, provider),
          });
          if (blocked) return c.json({ error: blocked }, 409);
        }
        const attachments = resolveAttachments(parsed.data.images);
        if (typeof attachments === 'string') return c.json({ error: attachments }, 400);
        const content: PastedContent[] = [
          ...attachments,
          ...(parsed.data.text.trim() ? [{ type: 'text', text: parsed.data.text } satisfies ContentBlock] : []),
        ];
        // Three-rung delivery ladder (#472). Branch on the ENGINE's answer rather
        // than a status read here: the handler cannot observe the dequeue safely
        // (the record is written a tick later), the engine can.
        //   live session → delivered · still queued → folded into the prompt
        //   starting up or between sessions → buffered (1408d7cb) · anything else → 409
        if (manager.sendMessage(id, content, parsed.data.replyTo)) return c.json((answered = { delivered: true as const }));

        const currentRun = store.getRun(id);
        // Bounds apply only to a message that is actually about to be stacked. Without this
        // gate an over-long message posted to a *finished* run would answer `400 prompt too
        // long` when the truthful answer is `409 session closed`. The status read is safe
        // here because it only decides whether to reject EARLY — `enqueueMessage` still
        // re-checks against the engine's own queue before writing anything.
        if (currentRun?.status === 'queued') {
          const refusal = queuedStackRefusal(dataDir, currentRun, content, parsed.data.text);
          if (refusal) return c.json({ error: refusal }, 400);
        }

        const queued = manager.enqueueMessage(id, content);
        if (queued) return c.json((answered = { queued: true as const, message: queued }));
        if (manager.deferMessage(id, content)) return c.json((answered = { deferred: true as const }));
        return c.json({ error: 'session closed' }, 409);
      } finally {
        if (receipt && 'settle' in receipt) receipt.settle(answered);
      }
    })

    // Edit / remove a stacked message (#472). Registered before any conflicting
    // `/:id` route so `queued-messages` never matches as a run id.
    .patch('/runs/:id/queued-messages/:msgId', jsonZodValidator(queuedMessagePatchSchema), async (c) => {
      const { dataDir, store, manager } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      const parsed = { data: c.req.valid('json') };
      const msgId = c.req.param('msgId');
      const stack = run.queuedMessages ?? [];
      const existing = stack.find((m) => m.id === msgId);
      if (!existing) return c.json({ error: 'not found' }, 404);

      const effectiveText = parsed.data.text ?? existing.text;
      const effectiveImageCount = parsed.data.images?.length ?? existing.images?.length ?? 0;
      if (!effectiveText.trim() && effectiveImageCount === 0) {
        return c.json({ error: 'message needs text or at least one attachment' }, 400);
      }

      const others = stack.filter((m) => m.id !== msgId);
      const stackedImages = others.reduce((n, m) => n + (m.images?.length ?? 0), 0);
      if (stackedImages + effectiveImageCount > MAX_QUEUED_ATTACHMENTS) {
        return c.json({ error: `too many queued attachments — ${MAX_QUEUED_ATTACHMENTS} attachment limit across the stack` }, 400);
      }
      const prospective = foldedLength(run.task, [...others, { text: effectiveText }]);
      if (prospective > MAX_FOLDED_TASK_CHARS) {
        return c.json(
          {
            error: `prompt too long — ${MAX_FOLDED_TASK_CHARS} character limit across the task and its queued messages (would be ${prospective})`,
          },
          400,
        );
      }

      if (run.status !== 'queued') return c.json({ error: 'run already started' }, 409);
      const images = resolveAttachments(parsed.data.images);
      if (typeof images === 'string') return c.json({ error: images }, 400);
      if (images !== undefined) {
        const opening = [...(run.taskImages ?? []), ...others.flatMap((m) => m.images ?? [])];
        if (queuedImageChars(dataDir, id, opening) + imageChars(images) > MAX_ATTACHMENTS_TOTAL_BASE64) {
          return c.json({ error: QUEUED_IMAGES_TOO_LARGE }, 400);
        }
      }
      const message = manager.editQueuedMessage(id, msgId, {
        ...(parsed.data.text !== undefined ? { text: parsed.data.text } : {}),
        ...(images !== undefined ? { images } : {}),
      });
      if (!message) return c.json({ error: 'run already started' }, 409);
      return c.json({ message });
    })

    .delete('/runs/:id/queued-messages/:msgId', (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      const msgId = c.req.param('msgId');
      if (!(run.queuedMessages ?? []).some((m) => m.id === msgId)) {
        return c.json({ error: 'not found' }, 404);
      }
      if (!manager.removeQueuedMessage(id, msgId)) return c.json({ error: 'run already started' }, 409);
      return c.json({ removed: true });
    })

    // "Finish": gracefully close a waiting session — the run completes as done.
    .post('/runs/:id/finish', (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      const before = store.getRun(id);
      if (!before) return c.json({ error: 'not found' }, 404);
      const finished = manager.finish(id);
      if (!finished) return c.json({ error: 'no open session' }, 409);
      return c.json({ finished: true });
    })

    // An in-place task's Commit to the base branch (spec 2026-10-20-trunk-based-projects).
    .post('/runs/:id/land', async (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
      const answer = await manager.land(id);
      return c.json({
        outcome: answer.outcome,
        message: answer.message,
        ...(answer.sha !== undefined ? { sha: answer.sha } : {}),
        ...(answer.pushed !== undefined ? { pushed: answer.pushed } : {}),
      });
    })

    // "Continue" (spec 003): reopen a finished run's session in-process.
    .post('/runs/:id/continue', jsonZodValidator(continueSchema, { absent: ({}) }), async (c) => {
      const { root: repoRoot, store, manager } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      // Bounded resume text (#429); an empty/absent body still just re-runs on the
      // run's current backend, and a runner/model override reopens on that engine (#401).
      const parsed = { data: c.req.valid('json') };
      // A re-posted Continue whose first attempt landed — possibly as a Continue queued behind the
      // run's teardown, which adds no step yet — answers as it did instead of continuing twice.
      const receipt = parsed.data.idempotencyKey ? await continueReceipts.claim(`${id}:${parsed.data.idempotencyKey}`) : undefined;
      if (receipt && 'prior' in receipt) return c.json(receipt.prior);
      let answered: ContinueResponse | undefined;
      try {
        if (agentModelsLocked(repoRoot) && parsed.data.model?.trim()) {
          return c.json({ error: AGENT_MODELS_LOCKED_ERROR }, 409);
        }
        const blocked = await providerActionError([providerForExistingRun(run, parsed.data.runner)], {
          repoRoot,
          // A runner switch drops the run's account (`continueRun`), so only the same runner inherits it.
          profileFor: (provider) => parsed.data.agentProfile
            ?? (provider === (run.runner ?? 'claude') ? recordedProfileFor(run, provider) : undefined),
        });
        if (blocked) return c.json({ error: blocked }, 409);
        // The follow-up pill names an account the user just picked, so an id that has been deleted
        // since the thread loaded is answered honestly — the same asymmetry `POST /runs` keeps: a
        // USER can act on "unknown account", and reopening the session on another login silently
        // would cross the very billing boundary accounts exist to draw.
        if (parsed.data.agentProfile !== undefined) {
          const provider = providerForExistingRun(run, parsed.data.runner);
          const account = await resolveWorkspaceProfile(provider, parsed.data.agentProfile);
          if ('error' in account) return c.json({ error: account.error }, 400);
        }
        const images = resolveAttachments(parsed.data.images);
        if (typeof images === 'string') return c.json({ error: images }, 400);
        const result = manager.continueRun(id, {
          text: parsed.data.text,
          images,
          runner: parsed.data.runner,
          model: parsed.data.model,
          agentProfile: parsed.data.agentProfile,
          ...(parsed.data.raiseLimits ? { raiseLimits: true } : {}),
          ...(parsed.data.replyTo !== undefined ? { replyTo: parsed.data.replyTo } : {}),
        });
        if (!result.ok) return c.json({ error: result.error }, 409);
        return c.json((answered = { continued: true as const }));
      } finally {
        if (receipt && 'settle' in receipt) receipt.settle(answered);
      }
    })

    // "Open in terminal" (spec 003): hand the session off to a real terminal —
    // in the task's worktree when it still exists (spec 006).
    .post('/runs/:id/open-in-cli', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      if (c.get('project').manager.lifecycle?.isBlocked(id)) return c.json({ error: 'Resolve the pending worktree lifecycle operation before opening its environment' }, 409);
      // Hosted mode: there is no "my machine" to open a terminal on. The UI
      // hides the button when localHandoff is false — this is defense in depth.
      if (!capabilities().localHandoff) {
        return c.json(
          {
            error:
              'local handoff is disabled — this cockpit runs in hosted mode (ONNI_REMOTE); resume the session from a machine that has the checkout',
          },
          409,
        );
      }
      const sessionStep = [...run.steps].reverse().find((s) => s.sessionId);
      const sessionId = sessionStep?.sessionId;
      if (!sessionId) return c.json({ error: 'no agent session to resume' }, 409);
      // Gate the account `handoffEnv` launches on below: the session's own, default when it recorded none.
      const blocked = await providerActionError([providerForExistingRun(run)], {
        repoRoot,
        profileFor: () => sessionStep?.profileId ?? DEFAULT_AGENT_ACCOUNT_ID,
      });
      if (blocked) return c.json({ error: blocked }, 409);
      const cwd = run.worktreePath && existsSync(run.worktreePath) ? run.worktreePath : repoRoot;
      const command = resumeCommand(run.runner, sessionId);
      // Fails closed on an id we do not recognise — see resumeCommand (#431).
      if (!command) return c.json({ error: 'the recorded session id has an unexpected shape' }, 409);
      // The account that OWNS this session, not the project's current one (spec 2026-07-29).
      const account = await handoffEnv(run.runner ?? 'claude', sessionStep?.profileId);
      if ('error' in account) return c.json({ error: account.error }, 409);
      const fallback = handoffFallbackCommand(cwd, command, account.env);
      // Fail closed for the same reason as the session id: a terminal opened without the
      // account's config dir resumes nothing and says nothing about why.
      if (fallback === null) {
        return c.json({ error: 'this account\'s folder cannot be used in a terminal command' }, 409);
      }
      const opened = await openTerminal(cwd, command, account.env);
      if (!opened) {
        return c.json({ error: 'no terminal emulator found', command: fallback }, 409);
      }
      return c.json({ opened: true, command });
    })

    // Open a run's worktree (or the repo root) in the chosen local app.
    .post('/runs/:id/open-in', jsonZodValidator(openInSchema), async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      if (c.get('project').manager.lifecycle?.isBlocked(id)) return c.json({ error: 'Resolve the pending worktree lifecycle operation before opening its environment' }, 409);
      if (!capabilities().localHandoff) {
        return c.json(
          {
            error: 'local handoff is disabled — this cockpit runs in hosted mode (ONNI_REMOTE)',
          },
          409,
        );
      }
      // Follows the safeParse convention (#429); the downstream allowlist match is the real
      // injection guard, this just validates the shape.
      const parsedBody = { data: c.req.valid('json') };
      const { target, path: relPath } = parsedBody.data;
      // Telemetry counts an `open_in` only once it opened: `target` is free client text until
      // `openApp`/`agentCliRunner` matched it, and labels must stay a closed set.
      const dir = run.worktreePath && existsSync(run.worktreePath) ? run.worktreePath : repoRoot;

      // Diff pane "open in OS default app" (#365): one worktree file, opened with the platform's
      // default handler for its type — not a directory in the file manager (that's `finder`
      // above) and not a session takeover (editors/CLIs above). `path` is re-validated against
      // the worktree here regardless of what the schema allowed, so a stale/forged path can never
      // escape it.
      if (target === 'default') {
        if (!run.worktreePath || !existsSync(run.worktreePath)) {
          return c.json({ error: NO_WORKTREE }, 409);
        }
        if (!relPath) return c.json({ error: 'path required for the default-app target' }, 400);
        const result = await readWorktreePath(run.worktreePath, relPath);
        if (result.kind !== 'file') {
          return c.json(
            {
              error: result.kind === 'dir' ? `not a file: ${relPath}` : result.error,
            },
            409,
          );
        }
        // This route's whole contract is "preview an image in its default app", and containment
        // alone does not enforce it. Without this gate any regular file in the worktree — a
        // `.command`/`.desktop` an agent just wrote, an `.exe` — would be handed to the OS
        // launcher, which EXECUTES it. Not remotely reachable (random run ids, same-origin, local
        // mode), so: defense in depth.
        //
        // Deliberately `isOsOpenableImage`, NOT the raw route's `imageMimeType`: that list allows
        // SVG on the strength of an `<img>` + no-script CSP the OS launcher never applies (the
        // default `.svg` handler is usually a browser, which would run the file's `<script>`).
        if (!isOsOpenableImage(result.path)) {
          // Say which rule refused, in the route's own words — "limited to images" would be a lie
          // to someone holding an SVG, which IS an image and DOES preview inline.
          return c.json(
            {
              error: imageMimeType(result.path)
                ? `SVG can carry scripts, so it previews inline but is never handed to the OS: ${result.path}`
                : `opening in the default app is limited to images: ${result.path}`,
            },
            409,
          );
        }
        const filePath = join(run.worktreePath, result.path);
        const opened = await openFile(filePath);
        if (!opened) return c.json({ error: `could not open ${result.path}`, path: filePath }, 409);
        return c.json({ opened: true, path: filePath });
      }

      // Coding-agent CLI handoff (#cli-handoff, #402): open a terminal in the worktree that resumes
      // THIS run's session when the chosen CLI is the run's own runner (and a session exists), or
      // starts a fresh CLI there otherwise. Same terminal launcher the Terminal button uses.
      // Records that predate the runner choice carry no `runner` at all — they default to Claude
      // everywhere else (resumeCommand, the client's resumeHint/cliTargetResumes), so the match
      // check defaults the same way here; without it, a legacy run's own Claude CLI would never
      // resume its own session, only ever launch fresh.
      // A run the engine still owns never resumes: `sessionId` is seeded when the agent step STARTS
      // (workflows/run.ts), so a running/queued/waiting run already carries one, and resuming it
      // would attach a SECOND CLI process to the transcript the engine is actively writing. Those
      // picks launch the CLI fresh in the worktree — the same degradation as a cross-runner pick,
      // and what the client's cliTargetResumes now labels. Resume-after-finish is untouched.
      const cliRunner = agentCliRunner(target);
      if (cliRunner) {
        const engineOwnsSession = run.status === 'running' || run.status === 'queued' || run.status === 'waiting';
        const sessionStep = engineOwnsSession ? undefined : [...run.steps].reverse().find((s) => s.sessionId);
        const sessionId = sessionStep?.sessionId;
        // An id resumeCommand refuses (#431) degrades to a fresh CLI in the worktree,
        // exactly like a run that never recorded a session.
        const resume = sessionId && cliRunner === (run.runner ?? 'claude') ? resumeCommand(cliRunner, sessionId) : null;
        // Gate the account the terminal opens on below: the session's for a resume, the project's otherwise.
        const blocked = await providerActionError([cliRunner], {
          repoRoot,
          profileFor: () => (resume ? sessionStep?.profileId ?? DEFAULT_AGENT_ACCOUNT_ID : undefined),
        });
        if (blocked) return c.json({ error: blocked }, 409);
        // The terminal this opens does not share our PATH (see `withResolvedClaudeBin`), so a
        // claude found off PATH by detection has to be named by absolute path here too —
        // otherwise the menu offers a handoff that opens on `command not found`.
        const command = withResolvedClaudeBin(resume ?? cliRunner, cliRunner);
        // BOTH branches carry the account (spec 2026-07-29-agent-profiles): a resume needs the
        // config dir that holds its session, and a FRESH CLI in this worktree should still open
        // on the account the project works under — otherwise "Open in → Claude CLI" quietly
        // hands the user a different subscription than every task in the same project uses.
        const account = resume
          ? await handoffEnv(cliRunner, sessionStep?.profileId)
          : { env: (await resolveProfileEnvForRoot(repoRoot, cliRunner)).env };
        if ('error' in account) return c.json({ error: account.error }, 409);
        const fallback = handoffFallbackCommand(dir, command, account.env);
        if (fallback === null) {
          return c.json({ error: 'this account\'s folder cannot be used in a terminal command' }, 409);
        }
        const opened = await openTerminal(dir, command, account.env);
        if (!opened) {
          return c.json({ error: 'no terminal emulator found', command: fallback }, 409);
        }
        return c.json({ opened: true, path: dir, command });
      }

      const opened = await openApp(target, dir);
      if (!opened) return c.json({ error: `could not open ${target}`, path: dir }, 409);
      return c.json({ opened: true, path: dir });
    })

    // Handoff journal (spec 007): the per-task handoff.md as markdown. 404 only
    // when the task is unknown; a task without a (yet) seeded file returns ''.
    .get('/runs/:id/handoff', (c) => {
      const { dataDir, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      return c.text(readHandoff(dataDir, run.id), 200, {
        'content-type': 'text/markdown; charset=utf-8',
      });
    })

    .get('/runs/:id/images/:file', (c) => {
      const { dataDir, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const file = basename(c.req.param('file'));
      const path = join(dataDir, 'runs', `${run.id}-images`, file);
      if (!existsSync(path)) return c.json({ error: 'not found' }, 404);
      const ext = file.split('.').pop() ?? '';
      const image = IMAGE_TYPES[ext];
      // An image answers exactly as it always has — the cockpit renders it in an `<img>`.
      // Everything else is a user-supplied file (#950) and leaves under the download headers.
      const type = image ?? FILE_TYPES[ext] ?? 'application/octet-stream';
      return new Response(readFileSync(path), {
        headers: {
          'content-type': type,
          'cache-control': 'private, max-age=31536000, immutable',
          ...(image
            ? {}
            : {
                'x-content-type-options': 'nosniff',
                // Engine-generated names are `pasted-3.pdf`-shaped, but a header value is not the
                // place to find out otherwise: anything exotic degrades to an underscore rather
                // than to a quote that could split the header.
                'content-disposition': `attachment; filename="${file.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
              }),
        },
      });
    })

    // Task diff (spec 006): what this run changed — its worktree vs its base.
    .get('/runs/:id/diff', async (c) => {
      const { store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      if (!run.worktreePath || !existsSync(run.worktreePath)) {
        return c.text('(no worktree — this task ran directly in the repo working tree)');
      }
      return c.text(await worktreeDiff(run.worktreePath, run.baseBranch ?? 'HEAD'));
    })

    .get('/runs/:id/changes', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const workingDirectory = workingDirectoryOf(run, repoRoot);
      if (!workingDirectory) return c.json({ error: NO_WORKTREE }, 409);
      const result = await collectChanges(workingDirectory, run.baseBranch ?? 'HEAD', {
        taskBranch: run.branch,
        // Anchors a repointed worktree at the branch as this run found it (#751).
        runStartedAt: run.startedAt,
        // A read-only GET against the user's real checkout must never modify its index.
        intentToAdd: run.worktreePath ? undefined : false,
        excludeOnniData: !run.worktreePath,
      });
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json(result.changes);
    })

    // The run's own commits (<base>..HEAD on the worktree branch) — the Commits tab.
    .get('/runs/:id/commits', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const workingDirectory = workingDirectoryOf(run, repoRoot);
      if (!workingDirectory) return c.json({ error: NO_WORKTREE }, 409);
      const result = await collectRunCommits(workingDirectory, run.baseBranch ?? 'HEAD');
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json({ commits: result.commits });
    })

    // One of the run's commits, structured like the Changes tab (reuses collectCommitChanges).
    .get('/runs/:id/commit/:sha', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const workingDirectory = workingDirectoryOf(run, repoRoot);
      if (!workingDirectory) return c.json({ error: NO_WORKTREE }, 409);
      const result = await collectCommitChanges(workingDirectory, c.req.param('sha'));
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json(result.commit);
    })

    // The run's whole path index — `/repo/tree` against the task's worktree. Backs the ⌘P
    // palette's `#` file search (spec 2026-10-17-task-palette); `/runs/:id/files` serves the file.
    .get('/runs/:id/tree', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const workingDirectory = workingDirectoryOf(run, repoRoot);
      if (!workingDirectory) return c.json({ error: NO_WORKTREE }, 409);
      const result = await listRepoPaths(workingDirectory);
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json({ paths: result.paths, truncated: result.truncated });
    })

    // Files tab: directory listing (path omitted or a dir) or file content
    // (size-capped, binary flagged). Traversal-safe — readWorktreePath rejects
    // anything escaping the worktree. `raw=1` (R5 Step 1.6) serves the BYTES of
    // image files only, for the preview's inline <img> — never HTML/JS/etc., so
    // no worktree file can become a same-origin document, and never past the
    // size cap. The no-script CSP neutralizes SVG opened as a top-level URL.
    //
    // An `Accept` that asks for images reaches the same raw branch without the flag — which is
    // what an `<img>` sends — while the flag still wins whenever it is present and `*<slash>*`
    // (every `fetch`) still gets the JSON listing. See `negotiate`.
    .get('/runs/:id/files', queryZodValidator(z.object({ path: queryValue, raw: queryValue, rev: queryValue.refine((v) => v === undefined || isCommitSha(v), 'rev must be a full commit sha') })), async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const query = c.req.valid('query');
      c.header('vary', 'Accept');
      const wantsRaw =
        query.raw !== undefined
          ? query.raw === '1'
          : negotiate(c.req.header('accept'), FILE_FORMATS) === 'image/*';
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const workingDirectory = workingDirectoryOf(run, repoRoot);
      if (!workingDirectory) return c.json({ error: NO_WORKTREE }, 409);
      // `rev` (a full sha, the changes payload's `baseSha`) serves an image's OLD side from git —
      // the before of a modified image, the only picture of a deleted one. Bytes only.
      if (query.rev !== undefined) {
        if (!wantsRaw) return c.json({ error: 'rev is only served as raw image bytes' }, 409);
        const old = await readImageAtRev(workingDirectory, query.rev, query.path ?? '');
        if (old.kind === 'refused') return c.json({ error: old.error }, 409);
        return c.body(new Uint8Array(old.bytes).buffer as ArrayBuffer, 200, {
          'content-type': old.mime,
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          // Addressed by content: the same sha and path are the same bytes forever.
          'cache-control': 'private, max-age=31536000, immutable',
        });
      }
      // A worktree-off run browses the REAL checkout: apply `/repo/files`' index guard so ignored
      // files (`.env`, `.ai/onni/` state and webhook keys) stay unreadable here too.
      let indexed: { files: Set<string>; dirs: Set<string> } | undefined;
      if (run.worktree === false) {
        const index = await listRepoPaths(workingDirectory, Number.MAX_SAFE_INTEGER);
        if (!index.ok) return c.json({ error: index.error }, 409);
        indexed = { files: new Set(index.paths), dirs: new Set(['']) };
        for (const path of index.paths) {
          for (let cut = path.indexOf('/'); cut !== -1; cut = path.indexOf('/', cut + 1)) indexed.dirs.add(path.slice(0, cut));
        }
        // Checked before touching the disk too, so a missing ignored path answers exactly like a present one.
        const requested = posix.normalize(query.path || '.').replace(/^\.\/?$/, '').replace(/\/+$/, '');
        if (!indexed.files.has(requested) && !indexed.dirs.has(requested)) {
          return c.json({ error: `path is not in the repository index: ${query.path}` }, 409);
        }
      }
      const result = await readWorktreePath(workingDirectory, query.path ?? '');
      if (result.kind === 'invalid' || result.kind === 'missing') {
        return c.json({ error: result.error }, 409);
      }
      // One message for ignored and absent alike, as in `/repo/files`: never disclose an ignored path.
      if (indexed && !(result.kind === 'dir' ? indexed.dirs : indexed.files).has(result.path)) {
        return c.json({ error: `path is not in the repository index: ${query.path}` }, 409);
      }
      if (result.kind === 'dir') {
        const visible = indexed;
        const prefix = result.path ? `${result.path}/` : '';
        const entries = visible
          ? result.entries.filter((entry) => (entry.type === 'file' ? visible.files : visible.dirs).has(prefix + entry.name))
          : result.entries;
        return c.json({
          // `as const` or the literal widens to `string` during Hono's route-type inference,
          // which erases the discriminant a consumer narrows on — `entry.type === 'dir'` then
          // leaves `never` and every field access on it fails. The wire was always 'dir'.
          type: 'dir' as const,
          path: result.path,
          entries,
        });
      }
      if (wantsRaw) {
        const mime = imageMimeType(result.path);
        if (mime === null || result.tooLarge) {
          // `?raw=1` ASKED for bytes, so it hears why it cannot have them — that 409 and its
          // wording are the protected surface (§2). An `Accept` is only a preference, so a
          // resource with no image representation falls THROUGH to the JSON answer below rather
          // than turning a browser's navigation to a text file into an error.
          if (query.raw !== undefined) {
            const error =
              mime === null
                ? `raw serving is limited to images: ${result.path}`
                : `file too large to serve raw (${result.size} bytes): ${result.path}`;
            return c.json({ error }, 409);
          }
        } else {
          const bytes = await readFile(join(workingDirectory, result.path));
          return c.body(new Uint8Array(bytes).buffer as ArrayBuffer, 200, {
            'content-type': mime,
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          });
        }
      }
      return c.json({
        type: 'file' as const,
        path: result.path,
        size: result.size,
        binary: result.binary,
        tooLarge: result.tooLarge,
        ...(result.content !== undefined ? { content: result.content } : {}),
      });
    })

    .post('/runs/:id/git/commit', jsonZodValidator(gitCommitSchema), async (c) => {
      const { store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const worktree = worktreeOf(run);
      if (!worktree) return c.json({ error: NO_WORKTREE }, 409);
      const parsed = { data: c.req.valid('json') };
      let result;
      try { result = await withWorktreeMutation(c.get('project'), run.id, () => commitAll(worktree, parsed.data.message)); }
      catch (error) { return lifecycleError(c, error); }
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json({ committed: true, sha: result.sha });
    })

    .post('/runs/:id/git/push', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const worktree = worktreeOf(run);
      if (!worktree) return c.json({ error: NO_WORKTREE }, 409);
      let result;
      try { result = await withWorktreeMutation(c.get('project'), run.id, () => pushCurrentBranch(worktree)); }
      catch (error) { return lifecycleError(c, error); }
      if (!result.ok) return c.json({ error: result.error }, 409);
      // A push is the event that changes what the chips say about this task's pull requests —
      // its checks start again, and its MERGEABILITY is recomputed from scratch. Both are cached
      // per number, so without this the cockpit would keep showing the pre-push answer (up to a
      // minute of "Ready to merge" for a branch that has just been rewritten) about a push the
      // user watched this server make.
      for (const number of runPrNumbers(run)) forgetRefStatus(repoRoot, number);
      return c.json({
        pushed: true,
        branch: result.branch,
        remote: result.remote,
        upstreamSet: result.upstreamSet,
      });
    })

    // What the worktree holds that has not left it, and what its base has that it lacks — drives
    // the header's one git button (Commit and push, Push, Update branch). Read-only.
    .get('/runs/:id/git/status', async (c) => {
      const { store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const worktree = worktreeOf(run);
      // An in-place write task answers for the checkout itself, against its upstream (spec
      // 2026-10-20-trunk-based-projects) — its git step is Commit to the base branch.
      const inPlace = !worktree && run.worktree === false && !run.readOnly;
      if (!worktree && !inPlace) return c.json({ error: NO_WORKTREE }, 409);
      const result = worktree
        ? await worktreeGitStatus(worktree, run.baseBranch)
        : await checkoutGitStatus(c.get('project').root);
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json({ uncommitted: result.uncommitted, unpushed: result.unpushed, behind: result.behind, ahead: result.ahead });
    })

    // Draft PR from the review gate (spec 009): final autosave → push →
    // `gh pr create --draft`; on success the run completes as done with the PR
    // badge. Failures come back as 409 with a `manual` merge command the GUI
    // shows next to the toast. ONNI_DRY_RUN=1 fakes the URL (no push, no gh).
    .post('/runs/:id/pr', jsonZodValidator(createPrSchema, { absent: ({}) }), async (c) => {
      const { root: repoRoot, dataDir, store, manager } = c.get('project');
      const draft = c.req.valid('json').draft ?? true;
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      if (manager.isActive(id)) return c.json({ error: 'run is still active — wait for the review gate' }, 409);
      // A pull-request head run's branch holds the whole foreign PR under this run's changes: a
      // draft PR from it into the default base would re-propose that PR (spec
      // 2026-10-06-agentic-e2e-checks Phase 3). Refused until publishing back is designed.
      if (run.prHead) {
        return c.json(
          { error: `this run verified pull request #${run.prHead.number}; publishing its changes is not supported yet` },
          409,
        );
      }
      if (!run.worktreePath || !existsSync(run.worktreePath) || !run.branch) {
        return c.json(
          {
            error: 'no worktree/branch to publish — this task ran in the repo working tree',
          },
          400,
        );
      }
      // One publish per run at a time: a cockpit re-asking after its response was lost (telemetry
      // 9119d21a) joins the publish still running instead of racing its autosave commit and push.
      const key = `${dataDir}\0${id}`;
      let publish = prPublishes.get(key);
      if (!publish) {
        const branch = run.branch;
        publish = (async () => {
          const outcome = await withWorktreeMutation(c.get('project'), id, () =>
            createDraftPr({ repoRoot, run, handoffText: readHandoff(dataDir, id), draft }),
          );
          if (!outcome.ok) return outcome;
          // A number the cockpit asked about BEFORE the pull request existed is cached as "this
          // repository has no such number" — which is exactly what a `ONNI:PR=901` marker declared
          // ahead of the push looks like. It exists now.
          const createdNumber = refNumberFromUrl(outcome.url);
          if (createdNumber !== null) forgetRefStatus(repoRoot, createdNumber);
          store.updateRun(id, {
            pullRequestUrl: outcome.url,
            status: 'done',
            completionReason: 'pr_opened',
            finishedAt: run.finishedAt ?? new Date().toISOString(),
          });
          store.appendEvent(id, {
            type: 'note',
            message: `${draft ? 'draft PR' : 'PR'} created: ${outcome.url}${outcome.dryRun ? ' (dry run — no real PR)' : ''}`,
          });
          return outcome;
        })()
          .then((outcome) => ({ outcome, branch }))
          .finally(() => prPublishes.delete(key));
        prPublishes.set(key, publish);
      }
      let published: Awaited<typeof publish>;
      try {
        published = await publish;
      } catch (error) { return lifecycleError(c, error); }
      const { outcome, branch } = published;
      if (!outcome.ok) {
        return c.json({ error: outcome.error, manual: `git merge ${branch}` }, 409);
      }
      return c.json({ url: outcome.url, dryRun: outcome.dryRun }, 201);
    })

    // Create PR by the task's agent: once its turn ends, the PR it opened is found by branch and
    // recorded, even if the agent never declared `ONNI:PR`. Best-effort; the status stays.
    .post('/runs/:id/pr/adopt', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      if (run.pullRequestUrl) return c.json({ found: true as const, url: run.pullRequestUrl });
      const worktree = worktreeOf(run);
      const target = worktree ? await resolvePrTarget(run) : null;
      const pr = worktree && target ? await findBranchPr(worktree, target) : null;
      if (!pr) return c.json({ found: false as const });
      forgetRefStatus(repoRoot, pr.number);
      // Unlike `POST /pr`, the status stays: the agent's session, not the cockpit, owns the run.
      store.updateRun(id, { pullRequestUrl: pr.url });
      store.appendEvent(id, { type: 'note', message: `PR opened by the agent: ${pr.url}` });
      return c.json({ found: true as const, url: pr.url });
    })

    // Archived tasks keep their worktree for inspection; this is the explicit
    // "🧹 Remove worktree" cleanup (spec 006).
    .post('/runs/:id/remove-worktree', async (c) => {
      const { root: repoRoot, store, manager } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      if (manager.isActive(id)) return c.json({ error: 'run is active — cancel it first' }, 409);
      if (protectedByLiveTree(run, store.listRuns())) return c.json({ error: 'this worker belongs to a task tree that is still running — its manager may still be integrating the branch; try again when the tree has finished' }, 409);
      try {
        return await legacyWorktreeMutation(c.get('project'), id, async () => {
          // A shell must not outlive the directory it is standing in (spec §6).
          stopTaskProcesses(id);
          if (run.worktreePath) await removeWorktree(repoRoot, run.worktreePath, run.branch);
          store.updateRun(id, { worktreePath: undefined, branch: undefined });
          if (run.prHead) await manager.sweepPrHeadRefs();
          return c.json({ removed: true });
        });
      } catch (error) { return lifecycleError(c, error); }
    })

    .delete('/runs/:id', async (c) => {
      const outcome = await deleteRunFully(c.get('project'), c.req.param('id'));
      if (outcome.ok) return c.json({ deleted: true as const });
      if (outcome.status === 'lifecycle') return lifecycleError(c, outcome.error);
      return c.json({ error: outcome.error }, outcome.status);
    })

    /** Clear one project's tasks and chats (see `clearProjectDataInputSchema`). */
    .post('/project-data/clear', jsonZodValidator(clearProjectDataInputSchema), async (c) => {
      const project = c.get('project');
      const confirm = c.req.valid('json').confirm;
      const names = new Set([project.id, basename(project.root)].map((name) => name.toLowerCase()));
      if (!names.has(confirm.toLowerCase())) {
        return c.json({ error: 'type the project name to confirm' }, 400);
      }
      // Children before parents: a worker is gone before its manager, so no tree is half-orphaned.
      const runs = [...project.store.listRuns()].sort((a, b) => Number(b.dispatch?.parentRunId !== undefined) - Number(a.dispatch?.parentRunId !== undefined));
      let deleted = 0;
      const skipped: ClearProjectDataResult['skipped'] = [];
      for (const run of runs) {
        if (!project.store.getRun(run.id)) continue;
        if (project.manager.isActive(run.id) || run.status === 'running' || run.status === 'queued' || run.status === 'waiting') {
          skipped.push({ id: run.id, title: run.title, reason: 'still running — stop it first' });
          continue;
        }
        const outcome = await deleteRunFully(project, run.id);
        if (outcome.ok) deleted += 1;
        else skipped.push({ id: run.id, title: run.title, reason: outcome.status === 'lifecycle' ? String(outcome.error instanceof Error ? outcome.error.message : outcome.error) : outcome.error });
      }
      return c.json({ deleted, skipped } satisfies ClearProjectDataResult);
    });
}
