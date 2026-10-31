import { rosterSchema, ROSTER_MAX_CONCURRENT, runnerCanManage, type ManagerPreset, type ProviderStatusResponse, type Roster, type Runner } from '@onni/api-client'

/**
 * Manager–worker roster helpers (docs/design/manager-worker.md). The backends offered are the ones
 * the provider status calls connected and enabled — never a hard-coded list — so a runner added to
 * the engine shows up here by itself once it is logged in.
 */

export interface WorkerDraft {
  runner: Runner | ''
  model: string
  role: string
  maxConcurrent: number
}

export interface RosterDraft {
  managerRunner: Runner | ''
  managerModel: string
  workers: WorkerDraft[]
}

/** Backends that can run a task right now, in the catalog's order. */
export function connectedBackends(status: ProviderStatusResponse | undefined): Runner[] {
  return (status?.providers ?? [])
    .filter((row) => row.status === 'connected' && row.enabled !== false)
    // A provider row may carry several accounts; one entry per backend is enough here.
    .map((row) => row.provider as Runner)
    .filter((runner, index, all) => all.indexOf(runner) === index)
}

export function emptyWorker(runner: Runner | '' = ''): WorkerDraft {
  return { runner, model: '', role: '', maxConcurrent: 1 }
}

/** Connected backends that may hold the manager role (`canManage`, ADR 0007). */
export function managerCapable(connected: readonly Runner[]): Runner[] {
  return connected.filter(runnerCanManage)
}

/** A starting point: the first connected backend that can manage manages, the next one (if any) works. */
export function starterDraft(connected: readonly Runner[]): RosterDraft {
  const manager = managerCapable(connected)[0]
  const worker = connected.find((runner) => runner !== manager) ?? manager
  return {
    managerRunner: manager ?? '',
    managerModel: '',
    workers: [emptyWorker(worker ?? '')],
  }
}

export function draftFromRoster(roster: Roster): RosterDraft {
  return {
    managerRunner: roster.manager.runner,
    managerModel: roster.manager.model ?? '',
    workers: roster.workers.map((w) => ({ runner: w.runner, model: w.model ?? '', role: w.role, maxConcurrent: w.maxConcurrent })),
  }
}

export function rosterFromDraft(draft: RosterDraft): { ok: true; roster: Roster } | { ok: false; error: string } {
  const parsed = rosterSchema.safeParse({
    manager: { runner: draft.managerRunner || undefined, ...(draft.managerModel.trim() ? { model: draft.managerModel.trim() } : {}) },
    workers: draft.workers.map((w) => ({
      runner: w.runner || undefined,
      ...(w.model.trim() ? { model: w.model.trim() } : {}),
      role: w.role,
      maxConcurrent: Math.min(Math.max(1, Math.round(w.maxConcurrent)), ROSTER_MAX_CONCURRENT),
    })),
  })
  if (parsed.success) return { ok: true, roster: parsed.data }
  const issue = parsed.error.issues[0]
  const where = issue?.path[0] === 'workers' ? `worker ${Number(issue.path[1] ?? 0) + 1}` : issue?.path[0] === 'manager' ? 'manager' : 'roster'
  return { ok: false, error: `${where}: ${issue?.message ?? 'invalid'}` }
}

/** The roster's backends that are no longer connected — the start would be refused. */
export function disconnectedBackends(roster: Roster, connected: readonly Runner[]): Runner[] {
  const wanted = [roster.manager.runner, ...roster.workers.map((w) => w.runner)]
  return wanted.filter((runner, index) => wanted.indexOf(runner) === index && !connected.includes(runner))
}

/** One line for a preset list: "claude (opus) → codex (gpt-5), opencode". */
export function describeRoster(roster: Roster): string {
  const name = (e: { runner: string; model?: string | undefined }) => (e.model ? `${e.runner} (${e.model})` : e.runner)
  return `${name(roster.manager)} → ${roster.workers.map(name).join(', ')}`
}

export function totalConcurrency(roster: Roster): number {
  return roster.workers.reduce((sum, w) => sum + w.maxConcurrent, 0)
}

export function newPresetId(existing: readonly ManagerPreset[]): string {
  let n = existing.length + 1
  while (existing.some((p) => p.id === `preset-${n}`)) n += 1
  return `preset-${n}`
}
