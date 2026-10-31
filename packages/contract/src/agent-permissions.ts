import { z } from 'zod';

/**
 * How much a headless backend may do without asking (ADR 0007). Only backends that cannot answer
 * an approval request mid-run have a setting; today that is `antigravity`.
 *
 *  - `files-only`  — the default: file edits inside the worktree, no shell commands. A command
 *    the agent tries is denied, and the run says so (it never reads as a silent success).
 *  - `allow-rules` — a narrow `command(<prefix>)` allowlist: read/commit git, `onni task report`
 *    and the step's test/build commands. Everything else (push, network, bulk delete) stays denied.
 *  - `bypass`      — `--dangerously-skip-permissions`: every tool is auto-approved. Explicit
 *    opt-in with a confirmation, never a default, and never applied to an unattended run.
 */
export const agentPermissionLevelSchema = z.enum(['files-only', 'allow-rules', 'bypass']);
export type AgentPermissionLevel = z.infer<typeof agentPermissionLevelSchema>;

export const DEFAULT_AGENT_PERMISSION_LEVEL: AgentPermissionLevel = 'files-only';

/** Backends with a permission-level setting. */
export const PERMISSION_LEVEL_RUNNERS = ['antigravity'] as const;
export type PermissionLevelRunner = (typeof PERMISSION_LEVEL_RUNNERS)[number];

/** The `agentPermissions` block of the workspace config; every key has a safe default. */
export const agentPermissionsSchema = z.object({
  antigravity: agentPermissionLevelSchema,
});
export type AgentPermissions = z.infer<typeof agentPermissionsSchema>;
export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = { antigravity: DEFAULT_AGENT_PERMISSION_LEVEL };

/**
 * `PUT /workspace/config` patch. Choosing `bypass` must carry `confirmBypass: true` — the server
 * enforces the confirmation the cockpit dialog shows, so a client cannot flip it silently.
 */
export const agentPermissionsPatchSchema = z
  .object({
    antigravity: agentPermissionLevelSchema.optional(),
    confirmBypass: z.literal(true).optional(),
  })
  .refine((patch) => patch.antigravity !== 'bypass' || patch.confirmBypass === true, {
    message: 'bypass needs an explicit confirmation (confirmBypass: true)',
    path: ['confirmBypass'],
  });
export type AgentPermissionsPatch = z.infer<typeof agentPermissionsPatchSchema>;
