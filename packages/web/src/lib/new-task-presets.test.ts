import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RUN_LIMITS,
  type ManagerPreset,
  type Roster,
  type RunLimits,
} from '@onni/api-client'

import {
  AUTONOMY_NEEDS_WORKTREE,
  builtinTaskPresets,
  cappedLimitsFromWorkspace,
  clampVariants,
  configuredWorktreeDefault,
  deleteTaskPreset,
  effectiveLimits,
  limitsDraftFromRequest,
  mergeManagerWorkerPresets,
  nextTaskPresetId,
  presetDisplayName,
  renameTaskPreset,
  saveTaskPreset,
  setAutonomous,
  setWorktreeMode,
  taskSettingsEqual,
  taskSummarySegments,
  type TaskPreset,
  type TaskSettingsSnapshot,
} from './new-task-presets'

const roster: Roster = {
  manager: { runner: 'claude' },
  workers: [{ runner: 'codex', role: '', maxConcurrent: 1 }],
}

const snapshot: TaskSettingsSnapshot = {
  runner: 'claude',
  model: 'sonnet',
  variants: 1,
  worktree: true,
  newBranch: false,
  autonomous: false,
  limits: { mode: 'default' },
  roster: null,
}

const managerPreset = (id: string, name: string): ManagerPreset => ({ id, name, roster })

describe('built-in task presets', () => {
  it('offers Quick, Overnight (safe) and Manager–Worker in that order', () => {
    const presets = builtinTaskPresets({ managerRoster: roster })
    expect(presets.map((preset) => preset.name)).toEqual([
      'Quick',
      'Overnight (safe)',
      'Manager–Worker',
    ])
    expect(presets.every((preset) => preset.origin === 'builtin')).toBe(true)
  })

  it('starts Quick safe: worktree, attended, workspace limits', () => {
    const quick = builtinTaskPresets({})[0] as TaskPreset
    expect(quick.origin).toBe('builtin')
    expect(quick.settings).toMatchObject({
      worktree: true,
      newBranch: false,
      autonomous: false,
      limits: { mode: 'default' },
      roster: null,
    })
  })

  it('never lets Overnight be unlimited, even in an uncapped workspace', () => {
    const overnight = builtinTaskPresets({ workspaceLimits: { mode: 'none' } })[1] as TaskPreset
    expect(overnight.settings.autonomous).toBe(true)
    expect(overnight.settings.worktree).toBe(true)
    expect(overnight.settings.limits.mode).toBe('capped')
    expect(overnight.settings.limits.maxCostUsd).toBe(DEFAULT_RUN_LIMITS.maxCostUsd)
    expect(overnight.settings.limits.maxTokens).toBe(DEFAULT_RUN_LIMITS.maxTokens)
  })

  it('copies a capped workspace ceiling and leaves uncapped axes blank', () => {
    const ceilings: RunLimits = { mode: 'capped', maxCostUsd: 4, maxWallClockMinutes: 60 }
    expect(cappedLimitsFromWorkspace(ceilings)).toEqual({
      mode: 'capped',
      maxCostUsd: 4,
      maxWallClockMinutes: 60,
    })
  })

  it('marks Manager–Worker unavailable until Settings has a default roster', () => {
    const without = builtinTaskPresets({})[2] as TaskPreset
    expect(without.settings.roster).toBeNull()
    expect(without.unavailableReason).toContain('Settings')

    const withRoster = builtinTaskPresets({ managerRoster: roster })[2] as TaskPreset
    expect(withRoster.settings.roster).toEqual(roster)
    expect(withRoster.unavailableReason).toBeUndefined()
  })
})

describe('legacy manager–worker presets merge into the task-preset list', () => {
  it('shows them read-only, after the task presets', () => {
    const merged = mergeManagerWorkerPresets(
      [{ ...builtinTaskPresets({})[0]!, name: 'Mine' }],
      [managerPreset('p1', 'Review pair')],
    )
    expect(merged.map((preset) => preset.name)).toEqual(['Mine', 'Review pair'])
    expect(merged[1]).toMatchObject({
      id: 'manager-p1',
      origin: 'manager-worker',
      name: 'Review pair',
      settings: { roster },
    })
  })

  it('lets a task preset of the same name win, so the lists cannot fork', () => {
    const merged = mergeManagerWorkerPresets(
      [{ ...builtinTaskPresets({})[0]!, name: 'Review pair' }],
      [managerPreset('p1', 'Review pair')],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.origin).toBe('builtin')
  })
})

describe('the modified flag', () => {
  it('compares settings structurally, ignoring key order', () => {
    expect(taskSettingsEqual(snapshot, { ...snapshot })).toBe(true)
    expect(taskSettingsEqual(snapshot, { ...snapshot, model: 'opus' })).toBe(false)
    expect(taskSettingsEqual({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true)
    expect(presetDisplayName({ name: 'Quick' }, true)).toBe('Quick (modified)')
    expect(presetDisplayName({ name: 'Quick' }, false)).toBe('Quick')
  })
})

describe('Autonomous and the worktree', () => {
  it('forces a worktree when Autonomous is turned on', () => {
    const direct = { ...snapshot, worktree: false }
    expect(setAutonomous(direct, true)).toMatchObject({ autonomous: true, worktree: true })
  })

  it('leaves the worktree alone when Autonomous is turned off', () => {
    expect(setAutonomous({ ...snapshot, autonomous: true }, false))
      .toMatchObject({ autonomous: false, worktree: true })
  })

  it('refuses direct checkout while Autonomous is on, with the reason', () => {
    const result = setWorktreeMode({ ...snapshot, autonomous: true }, false)
    expect(result.error).toBe(AUTONOMY_NEEDS_WORKTREE)
    // Refused, not silently flipped: the user decides which of the two they meant.
    expect(result.settings).toMatchObject({ autonomous: true, worktree: true })
  })

  it('allows direct checkout once Autonomous is off', () => {
    expect(setWorktreeMode({ ...snapshot, autonomous: false }, false))
      .toEqual({ settings: { ...snapshot, worktree: false } })
  })

  it('refuses a worktree where git does not exist', () => {
    const result = setWorktreeMode({ ...snapshot, worktree: false }, true, false)
    expect(result.error).toContain('not a git repository')
    expect(result.settings.worktree).toBe(false)
  })
})

describe('the default run mode', () => {
  it('is an isolated worktree unless the workspace or project says otherwise', () => {
    expect(configuredWorktreeDefault({})).toBe(true)
    expect(configuredWorktreeDefault({ composerDefaults: { worktree: null, inheritedWorktree: true } })).toBe(true)
    expect(configuredWorktreeDefault({ composerDefaults: { worktree: false, inheritedWorktree: true } })).toBe(false)
  })

  it('lets the project taskWorkspace win over the older composer default', () => {
    expect(configuredWorktreeDefault({
      taskWorkspace: 'in-place',
      composerDefaults: { worktree: true, inheritedWorktree: true },
    })).toBe(false)
    expect(configuredWorktreeDefault({
      taskWorkspace: 'worktree',
      composerDefaults: { worktree: false, inheritedWorktree: false },
    })).toBe(true)
  })
})

describe('limits in the panel', () => {
  it('shows the ceilings the run will actually use', () => {
    const workspace: RunLimits = { mode: 'capped', maxCostUsd: 3 }
    expect(effectiveLimits(workspace, { mode: 'default' })).toEqual(workspace)
    expect(effectiveLimits(undefined, { mode: 'default' })).toEqual(DEFAULT_RUN_LIMITS)
    expect(effectiveLimits(workspace, { mode: 'none' })).toEqual({ mode: 'none' })
    expect(effectiveLimits(workspace, { mode: 'capped', maxTokens: 500 }))
      .toEqual({ mode: 'capped', maxTokens: 500 })
  })

  it('round-trips through the form draft used by RunLimitsFields', () => {
    expect(limitsDraftFromRequest({ mode: 'capped', maxCostUsd: 2.5, maxStepIterations: 7 }))
      .toEqual({ mode: 'capped', cost: '2.5', tokens: '', time: '', iterations: '7' })
    expect(limitsDraftFromRequest({ mode: 'default' }))
      .toEqual({ mode: 'default', cost: '', tokens: '', time: '', iterations: '' })
  })
})

describe('the summary line', () => {
  const base = {
    agent: 'claude',
    model: 'sonnet',
    hasGit: true,
    worktree: true,
    newBranch: false,
    autonomous: false,
    limitsMode: 'default' as const,
    managerWorkers: null,
    baseBranch: 'dev',
  }

  it('names the ordinary state without a warning tone', () => {
    const segments = taskSummarySegments(base)
    expect(segments.map((segment) => segment.label)).toEqual([
      'claude', 'sonnet', 'worktree', 'limits: default', 'base dev',
    ])
    expect(segments.every((segment) => segment.tone === 'normal')).toBe(true)
    expect(segments.find((segment) => segment.key === 'worktree')?.section).toBe('where')
  })

  it('calls out every dangerous state in words', () => {
    const segments = taskSummarySegments({
      ...base,
      worktree: false,
      autonomous: true,
      limitsMode: 'none',
      managerWorkers: 2,
    })
    expect(segments.find((segment) => segment.key === 'worktree'))
      .toMatchObject({ label: 'direct checkout', tone: 'danger' })
    expect(segments.find((segment) => segment.key === 'autonomous'))
      .toMatchObject({ label: 'autonomous', tone: 'danger', section: 'autonomy' })
    expect(segments.find((segment) => segment.key === 'limits'))
      .toMatchObject({ label: 'limits: ∞', tone: 'danger' })
    expect(segments.find((segment) => segment.key === 'manager'))
      .toMatchObject({ label: 'manager + 2 workers', tone: 'warning', section: 'who' })
  })

  it('flags no-git and read-only states instead of claiming isolation', () => {
    const noGit = taskSummarySegments({ ...base, hasGit: false, worktree: false })
    expect(noGit.find((segment) => segment.key === 'worktree'))
      .toMatchObject({ label: 'in place (no git)', tone: 'warning' })

    const readOnly = taskSummarySegments({ ...base, readOnly: true })
    expect(readOnly.map((segment) => segment.label)).toEqual([
      'claude', 'ask (read-only)', 'base dev',
    ])
  })

  it('counts one worker as a worker', () => {
    const one = taskSummarySegments({ ...base, managerWorkers: 1 })
    expect(one.find((segment) => segment.key === 'manager')?.label).toBe('manager + 1 worker')
  })
})

describe('task-preset CRUD', () => {
  const userPreset = (id: string, name: string): TaskPreset => ({
    id,
    name,
    origin: 'user',
    settings: snapshot,
  })

  it('mints ids that do not collide', () => {
    expect(nextTaskPresetId([])).toBe('task-preset-1')
    expect(nextTaskPresetId([userPreset('task-preset-1', 'a'), userPreset('task-preset-3', 'c')]))
      .toBe('task-preset-4')
  })

  it('saves a trimmed name, uniquifying rather than overwriting', () => {
    const once = saveTaskPreset([], '  Review  ', snapshot)
    expect(once.map((preset) => preset.name)).toEqual(['Review'])
    const twice = saveTaskPreset(once, 'Review', { ...snapshot, model: 'opus' })
    expect(twice.map((preset) => preset.name)).toEqual(['Review', 'Review (2)'])
    expect(saveTaskPreset(twice, '   ', snapshot)).toHaveLength(2)
  })

  it('renames and deletes only user presets', () => {
    const presets = [builtinTaskPresets({})[0]!, userPreset('task-preset-2', 'Mine')]
    expect(renameTaskPreset(presets, 'task-preset-2', 'Yours').map((preset) => preset.name))
      .toEqual(['Quick', 'Yours'])
    // Built-ins are immutable.
    expect(renameTaskPreset(presets, 'builtin-quick', 'Nope')[0]?.name).toBe('Quick')
    expect(deleteTaskPreset(presets, 'builtin-quick')).toHaveLength(2)
    expect(deleteTaskPreset(presets, 'task-preset-2').map((preset) => preset.name)).toEqual(['Quick'])
  })
})

describe('clampVariants', () => {
  it('keeps the variant count in the supported range', () => {
    expect([-1, 1, 2, 3, 9].map(clampVariants)).toEqual([1, 1, 2, 3, 3])
  })
})
