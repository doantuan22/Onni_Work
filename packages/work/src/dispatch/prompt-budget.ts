/**
 * The manager brief's character budget (plan v2 §3). Every block that will be added to the brief
 * gets a ceiling here, and the worst-case fixture in `manager-prompt.test.ts` grows with it. A
 * literal sum on one side and the per-block caps on the other is how a prompt silently outgrows the
 * window it was sized for, so the total is computed, never restated.
 */
import { MANAGER_MEMORY_MAX_BYTES } from '@onni/contract';

/** The fixed part of the existing brief (role, rules, integration procedure), measured in Đợt 0. */
export const MANAGER_PROMPT_BASE_MAX_CHARS = 4_000;
/** Roster: `ROSTER_MAX_WORKERS` capability lines. */
export const MANAGER_CAPABILITIES_MAX_CHARS = 1_200;
/** The command block generated from `dispatch/commands.ts`. */
export const MANAGER_COMMANDS_MAX_CHARS = 1_500;
/** Project memory: the file's own byte cap plus its two header/footer lines. */
export const MANAGER_MEMORY_PROMPT_MAX_CHARS = MANAGER_MEMORY_MAX_BYTES + 100;
/** The tree plan's block. */
export const MANAGER_PLAN_PROMPT_MAX_CHARS = 1_800;
/** Slack for the blocks that grow with live data (budget line, warnings). */
export const MANAGER_PROMPT_RESERVE_CHARS = 1_000;

export const PROMPT_MAX_CHARS =
  MANAGER_PROMPT_BASE_MAX_CHARS +
  MANAGER_CAPABILITIES_MAX_CHARS +
  MANAGER_COMMANDS_MAX_CHARS +
  MANAGER_MEMORY_PROMPT_MAX_CHARS +
  MANAGER_PLAN_PROMPT_MAX_CHARS +
  MANAGER_PROMPT_RESERVE_CHARS;
