import { runLimitsRequestSchema, type RunLimitsRequest } from '@onni/contract';

const KEYS: Record<string, 'maxCostUsd' | 'maxTokens' | 'maxWallClockMinutes' | 'maxStepIterations'> = {
  cost: 'maxCostUsd',
  tokens: 'maxTokens',
  time: 'maxWallClockMinutes',
  iterations: 'maxStepIterations',
};

/** `cost=5,time=120,tokens=5000000,iterations=20` → a `capped` request. A key left out is unlimited. */
export function parseLimitSpec(spec: string): RunLimitsRequest {
  const numbers: Record<string, number> = {};
  for (const part of spec.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [name, raw, ...extra] = part.split('=');
    const key = name ? KEYS[name.trim()] : undefined;
    if (!key || raw === undefined || extra.length > 0) {
      throw new Error(`--limit wants cost=, time=, tokens=, iterations= pairs (e.g. cost=5,time=120), not "${part}"`);
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`--limit ${name} must be a number, not "${raw}"`);
    numbers[key] = value;
  }
  const parsed = runLimitsRequestSchema.safeParse({ mode: 'capped', ...numbers });
  if (!parsed.success) throw new Error(`--limit: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return parsed.data;
}

/**
 * The limits an `onni run` was asked for, or undefined for the workspace default. From inside an
 * agent task (`ONNI_TASK_ID`) both flags are refused: only a person at a shell may choose the
 * mode, and an agent may never set a looser ceiling than its own.
 */
export function limitsFromFlags(
  flags: { noLimit?: boolean; limit?: string },
  env: { ONNI_TASK_ID?: string } = process.env,
): RunLimitsRequest | undefined {
  if (!flags.noLimit && flags.limit === undefined) return undefined;
  if (env.ONNI_TASK_ID) throw new Error('--no-limit / --limit are not available inside an agent task — only the person who started it can change the limits');
  if (flags.noLimit && flags.limit !== undefined) throw new Error('--no-limit and --limit cannot be combined');
  return flags.noLimit ? { mode: 'none' } : parseLimitSpec(flags.limit!);
}
