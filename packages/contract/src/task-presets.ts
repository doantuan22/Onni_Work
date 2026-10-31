import { z } from 'zod'
import { runnerSchema } from './health.ts'
import { runLimitsRequestSchema } from './limits.ts'
import { rosterSchema } from './roster.ts'

/**
 * User-saved task presets for the `/new` Task settings panel (ADR 0008).
 *
 * They live in `~/.onni/config.json` next to `managerWorker.presets`, which they absorb into one
 * list: a saved roster is a task preset whose only unusual field is `roster`. That keeps the two
 * preset systems from forking. Every field is explicit rather than optional, so applying a preset
 * always overwrites every setting it names and a later panel default can never leak through.
 */
export const taskPresetSettingsSchema = z.strictObject({
  /** `null` = the project's configured default agent, resolved when the preset is applied. */
  runner: runnerSchema.nullable(),
  /** `null` = the configured/default model. */
  model: z.string().trim().min(1).max(200).nullable(),
  variants: z.number().int().min(1).max(3),
  worktree: z.boolean(),
  newBranch: z.boolean(),
  autonomous: z.boolean(),
  /** `default` = the workspace ceilings at start; `none` only when the user saved it on purpose. */
  limits: runLimitsRequestSchema,
  /** `null` = Manager–Worker off. */
  roster: rosterSchema.nullable(),
})
export type TaskPresetSettings = z.infer<typeof taskPresetSettingsSchema>

export const taskPresetSchema = z.strictObject({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  settings: taskPresetSettingsSchema,
})
export type TaskPreset = z.infer<typeof taskPresetSchema>

export const TASK_PRESETS_MAX = 50
