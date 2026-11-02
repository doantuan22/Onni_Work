import { z } from 'zod';

/** Metadata only: no raw provider messages, credentials or prompts. Times are epoch ms. */
export const usageWindowSchema = z.object({
  id: z.string().min(1).max(256),
  kind: z.enum(['five-hour', 'weekly', 'primary', 'secondary', 'other']),
  limitId: z.string().max(128).optional(),
  applicability: z.enum(['all', 'models', 'unknown']),
  models: z.array(z.string().min(1).max(128)).max(32).default([]),
  resetsAt: z.number().int().positive().max(8_640_000_000_000_000).nullable(),
  durationMinutes: z.number().positive().finite().nullable(),
  usedPercent: z.number().nonnegative().finite().nullable(),
  status: z.enum(['allowed', 'blocked', 'unknown']),
  observedAt: z.number().int().nonnegative(),
});
export type UsageWindow = z.infer<typeof usageWindowSchema>;

export const usageWindowsObservationSchema = z.object({
  provider: z.enum(['claude', 'codex']),
  source: z.enum(['claude-stream', 'codex-notification', 'codex-read']),
  observedAt: z.number().int().nonnegative(),
  windows: z.array(usageWindowSchema).max(128),
});
export type UsageWindowsObservation = z.infer<typeof usageWindowsObservationSchema>;

export const usageAccountBindingSchema = z.object({
  provider: z.enum(['claude', 'codex']),
  accountId: z.string().min(1).max(256),
  profilePath: z.string().min(1).max(4096),
  /** SHA-256 of provider identity metadata, never an auth token. */
  identity: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export type UsageAccountBinding = z.infer<typeof usageAccountBindingSchema>;

export const usageWindowsSnapshotSchema = usageWindowsObservationSchema.extend({
  binding: usageAccountBindingSchema,
}).refine((s) => s.provider === s.binding.provider, 'Provider must match account binding');
export type UsageWindowsSnapshot = z.infer<typeof usageWindowsSnapshotSchema>;

/**
 * One agent's usage limits as the cockpit shows them (P8). `support` says HOW we know:
 *  - `live`        — asked of the provider's own CLI on demand (Codex app-server);
 *  - `observed`    — read from what a real run already printed (Claude's stream-json rate-limit event);
 *  - `unsupported` — the CLI exposes no limit data we may read; shown as such, never as a made-up number.
 * `state`: `ok` fresh data, `stale` older than the freshness window, `none` supported but nothing seen
 * yet, `unavailable` a live read failed (retry later).
 */
export const agentUsageEntrySchema = z.object({
  provider: z.string().min(1).max(64),
  support: z.enum(['live', 'observed', 'unsupported']),
  state: z.enum(['ok', 'stale', 'none', 'unavailable']),
  windows: z.array(usageWindowSchema),
  observedAt: z.number().int().nonnegative().nullable(),
  source: z.string().max(64).optional(),
  reason: z.string().max(400).optional(),
});
export type AgentUsageEntry = z.infer<typeof agentUsageEntrySchema>;

export const agentUsageResponseSchema = z.object({
  agents: z.array(agentUsageEntrySchema),
  checkedAt: z.number().int().nonnegative(),
});
export type AgentUsageResponse = z.infer<typeof agentUsageResponseSchema>;
