import {
  DEFAULT_RUN_LIMITS,
  type ManagerPreset,
  type Roster,
  type RunLimits,
  type RunLimitsRequest,
  type Runner,
} from '@onni/api-client'

import type { LimitsDraft } from './run-limits'

/**
 * The `/new` Task settings panel: presets, the read-only summary line, and the two rules that
 * cannot be left to the component — the safe run-mode default and the Autonomous ↔ worktree
 * constraint. Everything here is pure so the panel and its tests share ONE answer.
 *
 * The engine does NOT forbid an autonomous run in the repo working tree (it forbids auto-land and
 * fences unattended runs instead). This module is deliberately STRICTER: the panel never lets a
 * user assemble autonomous + direct checkout, because the run would write straight into a
 * checkout while the user is told nothing will pause for them. See docs/adr/0008-new-task-panel.md
 * for the recorded divergence; the engine is untouched.
 */

export type PanelSection = 'presets' | 'who' | 'where' | 'autonomy' | 'skill' | 'advanced'
export type VariantCount = 1 | 2 | 3

export interface TaskSettingsSnapshot {
  /** `null` = the project's configured default agent, not a hard-coded claude. */
  runner: Runner | null
  /** `null` = the configured/default model. */
  model: string | null
  variants: VariantCount
  worktree: boolean
  newBranch: boolean
  autonomous: boolean
  limits: RunLimitsRequest
  roster: Roster | null
}

export type TaskPresetOrigin = 'builtin' | 'user' | 'manager-worker'

export interface TaskPreset {
  id: string
  name: string
  settings: TaskSettingsSnapshot
  origin: TaskPresetOrigin
  /** Present on Manager–Worker's built-in preset when Settings has no roster to apply. */
  unavailableReason?: string
}

export const AUTONOMY_NEEDS_WORKTREE =
  'Autonomous runs must use an isolated worktree. Switch to “Isolated worktree”, or turn Autonomous off, before editing your checkout directly.'

export const PANEL_SECTIONS: readonly { id: PanelSection; label: string }[] = [
  { id: 'presets', label: 'Presets' },
  { id: 'who', label: 'Who works' },
  { id: 'where', label: 'Where it runs' },
  { id: 'autonomy', label: 'Autonomy & limits' },
  { id: 'skill', label: 'Skill' },
  { id: 'advanced', label: 'Advanced' },
]

export function clampVariants(value: number): VariantCount {
  return value >= 3 ? 3 : value === 2 ? 2 : 1
}

/** A preset's limits can never make Overnight unlimited: uncapped workspaces get the built-in cap. */
export function cappedLimitsFromWorkspace(workspace: RunLimits | undefined): RunLimitsRequest {
  if (workspace?.mode === 'capped') {
    return {
      mode: 'capped',
      ...(workspace.maxCostUsd !== undefined ? { maxCostUsd: workspace.maxCostUsd } : {}),
      ...(workspace.maxTokens !== undefined ? { maxTokens: workspace.maxTokens } : {}),
      ...(workspace.maxWallClockMinutes !== undefined ? { maxWallClockMinutes: workspace.maxWallClockMinutes } : {}),
      ...(workspace.maxStepIterations !== undefined ? { maxStepIterations: workspace.maxStepIterations } : {}),
    }
  }
  return {
    mode: 'capped',
    maxCostUsd: DEFAULT_RUN_LIMITS.maxCostUsd,
    maxTokens: DEFAULT_RUN_LIMITS.maxTokens,
    maxWallClockMinutes: DEFAULT_RUN_LIMITS.maxWallClockMinutes,
    maxStepIterations: DEFAULT_RUN_LIMITS.maxStepIterations,
  }
}

export function builtinTaskPresets(input: {
  workspaceLimits?: RunLimits
  managerRoster?: Roster | null
}): TaskPreset[] {
  const roster = input.managerRoster ?? null
  return [
    {
      id: 'builtin-quick',
      name: 'Quick',
      origin: 'builtin',
      settings: {
        runner: null,
        model: null,
        variants: 1,
        worktree: true,
        newBranch: false,
        autonomous: false,
        limits: { mode: 'default' },
        roster: null,
      },
    },
    {
      id: 'builtin-overnight',
      name: 'Overnight (safe)',
      origin: 'builtin',
      settings: {
        runner: null,
        model: null,
        variants: 1,
        worktree: true,
        newBranch: true,
        autonomous: true,
        limits: cappedLimitsFromWorkspace(input.workspaceLimits),
        roster: null,
      },
    },
    {
      id: 'builtin-manager-worker',
      name: 'Manager–Worker',
      origin: 'builtin',
      settings: {
        runner: null,
        model: null,
        variants: 1,
        worktree: true,
        newBranch: false,
        autonomous: false,
        limits: { mode: 'default' },
        roster,
      },
      ...(roster === null
        ? {
            unavailableReason:
              'Choose a default manager–worker preset in Settings → Manager–Worker first.',
          }
        : {}),
    },
  ]
}

/**
 * Legacy manager–worker presets stay usable: they are shown as read-only task presets, never
 * copied into the task-preset store. A user task preset with the same name wins, so the two
 * lists cannot silently fork into duplicates the first time someone saves one.
 */
export function mergeManagerWorkerPresets(
  taskPresets: readonly TaskPreset[],
  managerPresets: readonly ManagerPreset[],
): TaskPreset[] {
  const names = new Set(taskPresets.map((preset) => preset.name))
  const legacy = managerPresets
    .filter((preset) => !names.has(preset.name))
    .map<TaskPreset>((preset) => ({
      id: `manager-${preset.id}`,
      name: preset.name,
      origin: 'manager-worker',
      settings: {
        runner: null,
        model: null,
        variants: 1,
        worktree: true,
        newBranch: false,
        autonomous: false,
        limits: { mode: 'default' },
        roster: preset.roster,
      },
    }))
  return [...taskPresets, ...legacy]
}

/** Structural equality for the "modified" flag. Keys are sorted so object order never matters. */
export function taskSettingsEqual(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function presetDisplayName(preset: Pick<TaskPreset, 'name'>, modified: boolean): string {
  return modified ? `${preset.name} (modified)` : preset.name
}

/**
 * Turn Autonomous on and the run is FORCED into an isolated worktree in the same action. Turning
 * it off leaves the worktree where it was — the user can opt into a direct checkout afterwards.
 */
export function setAutonomous(
  settings: TaskSettingsSnapshot,
  autonomous: boolean,
): TaskSettingsSnapshot {
  return autonomous
    ? { ...settings, autonomous: true, worktree: true }
    : { ...settings, autonomous }
}

/**
 * Direct checkout is refused while Autonomous is on, with the reason, rather than silently
 * turning Autonomous off: the user must decide which of the two they meant.
 */
export function setWorktreeMode(
  settings: TaskSettingsSnapshot,
  worktree: boolean,
  hasGit = true,
): { settings: TaskSettingsSnapshot; error?: string } {
  if (!hasGit && worktree) {
    return { settings, error: 'This folder is not a git repository, so there is no worktree to isolate.' }
  }
  if (!worktree && settings.autonomous) {
    return { settings, error: AUTONOMY_NEEDS_WORKTREE }
  }
  return { settings: { ...settings, worktree } }
}

/** The workspace/project default for "where it runs" — isolated worktree unless configured off. */
export function configuredWorktreeDefault(input: {
  taskWorkspace?: 'worktree' | 'in-place' | null
  composerDefaults?: { worktree?: boolean | null; inheritedWorktree?: boolean } | null
}): boolean {
  if (input.taskWorkspace) return input.taskWorkspace === 'worktree'
  return input.composerDefaults?.worktree ?? input.composerDefaults?.inheritedWorktree ?? true
}

export function limitsDraftFromRequest(request: RunLimitsRequest): LimitsDraft {
  return {
    mode: request.mode,
    cost: request.maxCostUsd !== undefined ? String(request.maxCostUsd) : '',
    tokens: request.maxTokens !== undefined ? String(request.maxTokens) : '',
    time: request.maxWallClockMinutes !== undefined ? String(request.maxWallClockMinutes) : '',
    iterations: request.maxStepIterations !== undefined ? String(request.maxStepIterations) : '',
  }
}

/** The ceilings the run will actually use — what the panel shows beside the mode. */
export function effectiveLimits(workspace: RunLimits | undefined, request: RunLimitsRequest): RunLimits {
  if (request.mode === 'default') return workspace ?? DEFAULT_RUN_LIMITS
  if (request.mode === 'none') return { mode: 'none' }
  return {
    mode: 'capped',
    ...(request.maxCostUsd !== undefined ? { maxCostUsd: request.maxCostUsd } : {}),
    ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
    ...(request.maxWallClockMinutes !== undefined ? { maxWallClockMinutes: request.maxWallClockMinutes } : {}),
    ...(request.maxStepIterations !== undefined ? { maxStepIterations: request.maxStepIterations } : {}),
  }
}

export type SummaryTone = 'normal' | 'warning' | 'danger'

export interface SummarySegment {
  key: 'agent' | 'model' | 'worktree' | 'branch' | 'autonomous' | 'limits' | 'manager' | 'base' | 'ask'
  label: string
  tone: SummaryTone
  section: PanelSection
}

/**
 * The line under the prompt: always readable, never an input. Dangerous states are named in
 * words here (autonomous, unlimited, direct checkout, manager–worker) because the panel may be
 * folded and the user still has to see what they are about to start.
 */
export function taskSummarySegments(input: {
  agent: string
  model: string
  hasGit: boolean
  worktree: boolean
  newBranch: boolean
  autonomous: boolean
  limitsMode: 'default' | 'none' | 'capped'
  managerWorkers: number | null
  baseBranch?: string | null
  readOnly?: boolean
  askAuto?: boolean
}): SummarySegment[] {
  if (input.readOnly) {
    return [
      { key: 'agent', label: input.agent, tone: 'normal', section: 'who' },
      { key: 'ask', label: 'ask (read-only)', tone: 'warning', section: 'advanced' },
      ...(input.baseBranch ? [{ key: 'base' as const, label: `base ${input.baseBranch}`, tone: 'normal' as const, section: 'where' as const }] : []),
    ]
  }
  const segments: SummarySegment[] = [
    { key: 'agent', label: input.agent, tone: 'normal', section: 'who' },
    { key: 'model', label: input.model || 'auto', tone: 'normal', section: 'who' },
  ]
  if (!input.hasGit) {
    segments.push({ key: 'worktree', label: 'in place (no git)', tone: 'warning', section: 'where' })
  } else if (input.worktree) {
    segments.push({ key: 'worktree', label: 'worktree', tone: 'normal', section: 'where' })
  } else {
    segments.push({ key: 'worktree', label: 'direct checkout', tone: 'danger', section: 'where' })
  }
  if (!input.worktree && input.newBranch) {
    segments.push({ key: 'branch', label: 'new branch', tone: 'warning', section: 'where' })
  }
  if (input.autonomous) {
    segments.push({ key: 'autonomous', label: 'autonomous', tone: 'danger', section: 'autonomy' })
  }
  segments.push({
    key: 'limits',
    label:
      input.limitsMode === 'none'
        ? 'limits: ∞'
        : input.limitsMode === 'capped'
          ? 'limits: custom'
          : 'limits: default',
    tone: input.limitsMode === 'none' ? 'danger' : 'normal',
    section: 'autonomy',
  })
  if (input.managerWorkers !== null) {
    segments.push({
      key: 'manager',
      label: `manager + ${input.managerWorkers} ${input.managerWorkers === 1 ? 'worker' : 'workers'}`,
      tone: 'warning',
      section: 'who',
    })
  }
  if (input.baseBranch) {
    segments.push({ key: 'base', label: `base ${input.baseBranch}`, tone: 'normal', section: 'where' })
  }
  return segments
}

/** Preset-store arithmetic — one place for ids, names and the built-in read-only rule. */
export function nextTaskPresetId(presets: readonly TaskPreset[]): string {
  let n = presets.length + 1
  while (presets.some((preset) => preset.id === `task-preset-${n}`)) n += 1
  return `task-preset-${n}`
}

export function saveTaskPreset(
  presets: readonly TaskPreset[],
  name: string,
  settings: TaskSettingsSnapshot,
): TaskPreset[] {
  const trimmed = name.trim().slice(0, 80)
  if (trimmed === '') return [...presets]
  let unique = trimmed
  let suffix = 2
  while (presets.some((preset) => preset.name === unique)) {
    unique = `${trimmed} (${suffix})`
    suffix += 1
  }
  return [...presets, { id: nextTaskPresetId(presets), name: unique, origin: 'user', settings }]
}

export function renameTaskPreset(
  presets: readonly TaskPreset[],
  id: string,
  name: string,
): TaskPreset[] {
  const trimmed = name.trim().slice(0, 80)
  if (trimmed === '') return [...presets]
  return presets.map((preset) =>
    preset.id === id && preset.origin === 'user' ? { ...preset, name: trimmed } : preset,
  )
}

export function deleteTaskPreset(presets: readonly TaskPreset[], id: string): TaskPreset[] {
  return presets.filter((preset) => !(preset.id === id && preset.origin === 'user'))
}
