import { z } from 'zod';

/**
 * Run limits (spec docs/design/unattended-safety.md §2). Two modes, one feature: `none` applies no
 * cost / token / time / iteration ceiling at all; `capped` applies exactly the numbers given, and a
 * blank number is "no limit on that axis". The hang guards and dispatch's structural caps are NOT
 * part of this and stay on in both modes.
 */
export const LIMIT_KINDS = ['cost', 'tokens', 'time', 'iterations'] as const;
export const limitKindSchema = z.enum(LIMIT_KINDS);
export type LimitKind = z.infer<typeof limitKindSchema>;

const limitNumbers = {
  maxCostUsd: z.number().positive().max(100_000).optional(),
  maxTokens: z.number().int().positive().max(10_000_000_000).optional(),
  maxWallClockMinutes: z.number().int().positive().max(100_000).optional(),
  maxStepIterations: z.number().int().positive().max(100_000).optional(),
};

/** The mode and ceilings a run was started with — snapshotted on the record, never re-read. */
export const runLimitsSchema = z.strictObject({ mode: z.enum(['none', 'capped']), ...limitNumbers });
export type RunLimits = z.infer<typeof runLimitsSchema>;

/** What a client sends: `default` = whatever the workspace default says when the run starts. */
export const runLimitsRequestSchema = z.strictObject({ mode: z.enum(['default', 'none', 'capped']), ...limitNumbers });
export type RunLimitsRequest = z.infer<typeof runLimitsRequestSchema>;

/** A fresh install: capped, with these numbers (token count is the cost-weighted `tokensUsed`). */
export const DEFAULT_RUN_LIMITS: RunLimits = {
  mode: 'capped',
  maxCostUsd: 10,
  maxTokens: 10_000_000,
  maxWallClockMinutes: 240,
  maxStepIterations: 30,
};

/** Durable usage that is not derivable from the steps: active wall-clock, accumulated across restarts. */
export const limitUsageSchema = z.object({ wallMs: z.number().nonnegative() });
export type LimitUsage = z.infer<typeof limitUsageSchema>;

/** Which ceiling ended the run, and whether it was the run's own or the shared tree's. */
export const limitHitSchema = z.object({
  kind: limitKindSchema,
  limit: z.number(),
  used: z.number(),
  scope: z.enum(['run', 'tree']),
  at: z.string(),
});
export type LimitHit = z.infer<typeof limitHitSchema>;

/** Backends whose stream carries no USD figure: a cost ceiling cannot apply to them. */
export const RUNNERS_WITHOUT_COST: readonly string[] = ['antigravity', 'codex', 'copilot', 'cursor'];
/** Backends that report no token counts either (cursor): only time / iterations can bound them. */
export const RUNNERS_WITHOUT_TOKENS: readonly string[] = ['cursor'];

/** The `safety` block of the workspace config: hang guards and dispatch structure ("Advanced"). */
export const safetySettingsSchema = z.object({
  /** Minutes an unanswered `waiting` run may sit before it ends `failed` (continuable). */
  waitExpiryMinutes: z.number().int().min(1).max(1440),
  /** Deepest dispatch generation allowed: 1 = a worker may not dispatch further. */
  dispatchMaxDepth: z.number().int().min(1).max(3),
  /** Tree-wide subtask cap used when the root has no `intent.maxSubtasks`. */
  dispatchMaxSubtasks: z.number().int().min(1).max(50),
  /** Ceiling on how many times a failed order may be dispatched again (an order may only lower it). */
  dispatchRetryLimit: z.number().int().min(0).max(3),
});
export type SafetySettings = z.infer<typeof safetySettingsSchema>;
export const DEFAULT_SAFETY_SETTINGS: SafetySettings = {
  waitExpiryMinutes: 30,
  dispatchMaxDepth: 1,
  dispatchMaxSubtasks: 12,
  dispatchRetryLimit: 1,
};
