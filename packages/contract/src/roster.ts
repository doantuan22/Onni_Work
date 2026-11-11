import { z } from 'zod';
import { runnerSchema, type Runner } from './health.ts';

/**
 * Manager / Worker (docs/design/manager-worker.md): one agent manages a task tree and may hand
 * work ONLY to the workers listed here. The roster is chosen by the user (never "every agent on
 * the machine"), stored on the root run, and enforced by the server in `dispatch()`.
 * It is an orchestration fence, not a security boundary: an agent can still call a CLI or the HTTP
 * API directly.
 */

const model = z.string().trim().min(1).max(200);

/**
 * What each backend may be in a roster. `canManage` is true only where the manager's commands
 * (`onni task create/report`, git status/diff/add/commit/merge/log, the configured test/build)
 * are verified to run unattended. Antigravity's allow-rules are not verified for that yet, so it is
 * offered as a worker only (ADR 0007); the server refuses it as a manager, not just the UI.
 */
export const RUNNER_CAPABILITIES: Record<Runner, { canManage: boolean; manageReason?: string }> = {
  claude: { canManage: true },
  codex: { canManage: true },
  opencode: { canManage: true },
  cursor: { canManage: true },
  pi: { canManage: true },
  junie: { canManage: true },
  copilot: { canManage: true },
  cline: {
    canManage: false,
    manageReason: 'its ACP permission prompts and the manager commands (onni task create, git merge) were not verified to run unattended',
  },
  antigravity: {
    canManage: false,
    manageReason: 'its headless allow-rules are not yet verified for the manager commands (onni task create, git merge)',
  },
};

export function runnerCanManage(runner: Runner): boolean {
  return RUNNER_CAPABILITIES[runner].canManage;
}

export const rosterManagerSchema = z
  .strictObject({
    runner: runnerSchema,
    model: model.optional(),
  })
  .refine((manager) => runnerCanManage(manager.runner), {
    path: ['runner'],
    error: (issue) => {
      const runner = (issue.input as { runner?: Runner } | undefined)?.runner;
      const reason = runner ? RUNNER_CAPABILITIES[runner]?.manageReason : undefined;
      return `${runner ?? 'this backend'} cannot be a manager${reason ? `: ${reason}` : ''}; use it as a worker`;
    },
  });
export type RosterManager = z.infer<typeof rosterManagerSchema>;

export const ROSTER_MAX_WORKERS = 6;
export const ROSTER_MAX_CONCURRENT = 4;

/**
 * What a worker is good for, and how much it can carry. Both are information for the MANAGER, shown
 * in its brief so it hands each part to a fitting worker; neither limits what the worker may do and
 * the server does not enforce them (the roster stays a fence on WHICH workers, not on what for).
 */
export const WORKER_KINDS = ['implement', 'test', 'explore', 'review'] as const;
export type WorkerKind = (typeof WORKER_KINDS)[number];
/** `heavy`: hard, multi-file, reasoning-heavy parts · `standard`: ordinary parts · `light`: small mechanical parts. */
export const WORKER_TIERS = ['light', 'standard', 'heavy'] as const;
export type WorkerTier = (typeof WORKER_TIERS)[number];

export const rosterWorkerSchema = z.strictObject({
  runner: runnerSchema,
  model: model.optional(),
  /** Free-text strengths / role, shown to the manager verbatim. */
  role: z.string().trim().max(500).default(''),
  /** The kinds of part this worker suits; absent = no preference stated. */
  kinds: z
    .array(z.enum(WORKER_KINDS))
    .max(WORKER_KINDS.length)
    .refine((kinds) => new Set(kinds).size === kinds.length, { error: 'kinds must not repeat' })
    .optional(),
  /** How heavy a part this worker can carry; absent = not stated. */
  tier: z.enum(WORKER_TIERS).optional(),
  /** How many tasks of THIS entry run at once; extra ones wait in the queue. */
  maxConcurrent: z.number().int().min(1).max(ROSTER_MAX_CONCURRENT).default(1),
});
export type RosterWorker = z.infer<typeof rosterWorkerSchema>;

/** The identity of a worker entry: the same backend with another model is another entry. */
export function rosterWorkerKey(worker: { runner: string; model?: string | undefined }): string {
  return `${worker.runner}:${worker.model ?? ''}`;
}

export const rosterSchema = z
  .strictObject({
    manager: rosterManagerSchema,
    workers: z.array(rosterWorkerSchema).min(1).max(ROSTER_MAX_WORKERS),
  })
  .superRefine((roster, ctx) => {
    const seen = new Set<string>();
    roster.workers.forEach((worker, index) => {
      const key = rosterWorkerKey(worker);
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['workers', index], message: `duplicate worker ${worker.runner}${worker.model ? ` (${worker.model})` : ''}` });
      }
      seen.add(key);
      // The manager session is never its own worker; the same backend on another model may be.
      if (rosterWorkerKey(worker) === rosterWorkerKey(roster.manager)) {
        ctx.addIssue({ code: 'custom', path: ['workers', index], message: 'the manager cannot also be a worker (same backend and model)' });
      }
    });
  });
export type Roster = z.infer<typeof rosterSchema>;

/** Replace a live tree's full roster from the cockpit. The manager identity is immutable in the store. */
export const rosterUpdateInputSchema = z.strictObject({ roster: rosterSchema });
export type RosterUpdateInput = z.infer<typeof rosterUpdateInputSchema>;

/** Manager-authored changes are limited to the worker list. */
export const managerRosterUpdateInputSchema = z.strictObject({
  workers: z.array(rosterWorkerSchema).min(1).max(ROSTER_MAX_WORKERS),
});
export type ManagerRosterUpdateInput = z.infer<typeof managerRosterUpdateInputSchema>;

export const rosterUpdateResponseSchema = z.strictObject({ roster: rosterSchema });
export type RosterUpdateResponse = z.infer<typeof rosterUpdateResponseSchema>;

/** A saved roster, shared by every project of the workspace; a run can override it. */
export const managerPresetSchema = z.strictObject({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  roster: rosterSchema,
});
export type ManagerPreset = z.infer<typeof managerPresetSchema>;

export const MANAGER_PRESETS_MAX = 20;

/** The `managerWorker` block of the workspace config. */
export const managerWorkerSettingsSchema = z.object({
  presets: z.array(managerPresetSchema).max(MANAGER_PRESETS_MAX),
  /** Preset id the composer starts from; `null` = manager–worker off by default. */
  defaultPresetId: z.string().nullable(),
});
export type ManagerWorkerSettings = z.infer<typeof managerWorkerSettingsSchema>;
export const DEFAULT_MANAGER_WORKER_SETTINGS: ManagerWorkerSettings = { presets: [], defaultPresetId: null };
