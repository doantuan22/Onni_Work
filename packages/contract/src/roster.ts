import { z } from 'zod';
import { runnerSchema } from './health.ts';

/**
 * Manager / Worker (docs/design/manager-worker.md): one agent manages a task tree and may hand
 * work ONLY to the workers listed here. The roster is chosen by the user (never "every agent on
 * the machine"), snapshotted on the root run at start, and enforced by the server in `dispatch()`.
 * It is an orchestration fence, not a security boundary: an agent can still call a CLI or the HTTP
 * API directly.
 */

const model = z.string().trim().min(1).max(200);

export const rosterManagerSchema = z.strictObject({
  runner: runnerSchema,
  model: model.optional(),
});
export type RosterManager = z.infer<typeof rosterManagerSchema>;

export const ROSTER_MAX_WORKERS = 6;
export const ROSTER_MAX_CONCURRENT = 4;

export const rosterWorkerSchema = z.strictObject({
  runner: runnerSchema,
  model: model.optional(),
  /** Free-text strengths / role, shown to the manager verbatim. */
  role: z.string().trim().max(500).default(''),
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
