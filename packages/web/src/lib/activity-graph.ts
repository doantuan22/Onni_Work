import type { ApiRun } from '@onni/api-client'

/**
 * The model behind the task view "Activity" graph (P9): who works on what, right now. One source —
 * the run records the sidebar already reads (patched live by SSE) — folded into nodes and edges.
 * Pure on purpose: the component only draws what this returns, and the mapping is table-tested.
 */
export type ActivityState = 'queued' | 'running' | 'monitoring' | 'asking' | 'done' | 'failed' | 'blocked' | 'cancelled'

export type ActivityRole = 'manager' | 'worker' | 'solo'

export interface ActivityNodeSpec {
  id: string
  kind: 'agent' | 'group'
  role: ActivityRole
  title: string
  runner: string
  model?: string
  state: ActivityState
  /** One line of what it is doing / how it ended. */
  line: string
  startedAt?: string
  finishedAt?: string
  costUsd?: number
  tokens?: number
  /** For a collapsed group: how many finished workers it stands for. */
  count?: number
  position: { x: number; y: number }
}

export interface ActivityEdgeSpec {
  id: string
  source: string
  target: string
  /** assign: manager gives a part; report: the worker's result flows back; after: ordering between siblings. */
  kind: 'assign' | 'report' | 'after'
  /** Something is flowing along it right now (drives the moving highlight). */
  active: boolean
}

export interface ActivityGraph {
  nodes: ActivityNodeSpec[]
  edges: ActivityEdgeSpec[]
  /** How many finished workers the group node hides (0 = nothing collapsed). */
  hiddenDone: number
}

export const NODE_WIDTH = 252
export const NODE_HEIGHT = 124
const GAP_X = 44
const GAP_Y = 64
const MAX_COLUMNS = 4
/** Above this many workers, finished ones fold into one group node (until the user expands). */
export const COLLAPSE_ABOVE = 12
/** A report that landed this recently still "flows". */
const FLOW_WINDOW_MS = 12_000

const PERMISSION = /permission level|auto-denied|blocked by onni|headless mode cannot prompt/i

export function runActivityState(run: Pick<ApiRun, 'status' | 'activity' | 'error' | 'deniedActions'>): ActivityState {
  if (run.status === 'cancelled') return 'cancelled'
  if (run.status === 'failed') {
    return (run.deniedActions?.length ?? 0) > 0 || PERMISSION.test(run.error ?? '') ? 'blocked' : 'failed'
  }
  if (run.status === 'queued') return 'queued'
  if (run.status === 'waiting') return 'asking'
  if (run.status === 'done' || run.status === 'review') return 'done'
  return run.activity === 'monitoring' ? 'monitoring' : 'running'
}

function lineOf(run: ApiRun, state: ActivityState): string {
  const step = run.steps.find((s) => s.status === 'running')
  switch (state) {
    case 'queued':
      return 'Waiting for a free slot'
    case 'monitoring':
      return 'Waiting for its workers'
    case 'asking':
      return 'Waiting for an answer'
    case 'running':
      // A dispatched worker's only step is named after its order, so repeating it says nothing.
      return step?.name && step.name !== run.title ? step.name : 'Working on the task'
    case 'blocked':
      return (run.error ?? 'Blocked by a permission').slice(0, 110)
    case 'failed':
      return (run.error ?? 'Failed').slice(0, 110)
    case 'cancelled':
      return 'Cancelled'
    default:
      return run.dispatch?.report?.result?.slice(0, 110) ?? run.titleSummary ?? run.title
  }
}

const isTerminal = (state: ActivityState) => state === 'done' || state === 'failed' || state === 'blocked' || state === 'cancelled'

export function buildActivityGraph(
  runs: readonly ApiRun[],
  rootId: string,
  opts: { collapseDone?: boolean; now?: number } = {},
): ActivityGraph {
  const now = opts.now ?? Date.now()
  const root = runs.find((r) => r.id === rootId)
  if (!root) return { nodes: [], edges: [], hiddenDone: 0 }
  const members = runs
    .filter((r) => r.id !== rootId && r.dispatch?.rootRunId === rootId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const isTree = members.length > 0 || root.roster !== undefined

  const stateOf = new Map<string, ActivityState>([[root.id, runActivityState(root)], ...members.map((m) => [m.id, runActivityState(m)] as const)])
  const collapse = (opts.collapseDone ?? true) && members.length > COLLAPSE_ABOVE
  const folded = collapse ? members.filter((m) => stateOf.get(m.id) === 'done') : []
  const foldedIds = new Set(folded.map((m) => m.id))
  const shown = members.filter((m) => !foldedIds.has(m.id))

  const depthOf = (run: ApiRun): number => {
    let depth = 0
    let current: ApiRun | undefined = run
    const seen = new Set<string>()
    while (current && current.dispatch?.parentRunId && !seen.has(current.id)) {
      seen.add(current.id)
      depth += 1
      current = runs.find((r) => r.id === current!.dispatch?.parentRunId)
    }
    return depth
  }

  const make = (run: ApiRun, role: ActivityRole): Omit<ActivityNodeSpec, 'position'> => {
    const state = stateOf.get(run.id) ?? runActivityState(run)
    return {
      id: run.id,
      kind: 'agent',
      role,
      title: run.title,
      runner: run.runner ?? 'claude',
      ...(run.model ? { model: run.model } : {}),
      state,
      line: lineOf(run, state),
      ...(run.startedAt ? { startedAt: run.startedAt } : {}),
      ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
      ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
      ...(run.tokensUsed !== undefined ? { tokens: run.tokensUsed } : {}),
    }
  }

  // ---- layout: the manager on top, each generation of workers in rows of up to MAX_COLUMNS ----
  const levels = new Map<number, Array<Omit<ActivityNodeSpec, 'position'>>>()
  for (const member of shown) {
    const depth = Math.max(1, depthOf(member))
    const list = levels.get(depth) ?? []
    list.push(make(member, 'worker'))
    levels.set(depth, list)
  }
  if (folded.length > 0) {
    const list = levels.get(1) ?? []
    list.push({
      id: 'group:done',
      kind: 'group',
      role: 'worker',
      title: `${folded.length}`,
      runner: '',
      state: 'done',
      line: 'Finished workers',
      count: folded.length,
    })
    levels.set(1, list)
  }

  const nodes: ActivityNodeSpec[] = []
  const widest = Math.max(1, ...[...levels.values()].map((l) => Math.min(l.length, MAX_COLUMNS)))
  const totalWidth = widest * NODE_WIDTH + (widest - 1) * GAP_X
  nodes.push({ ...make(root, isTree ? 'manager' : 'solo'), position: { x: (totalWidth - NODE_WIDTH) / 2, y: 0 } })
  let y = NODE_HEIGHT + GAP_Y
  for (const depth of [...levels.keys()].sort((a, b) => a - b)) {
    const list = levels.get(depth)!
    for (let start = 0; start < list.length; start += MAX_COLUMNS) {
      const row = list.slice(start, start + MAX_COLUMNS)
      const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * GAP_X
      row.forEach((node, i) => {
        nodes.push({ ...node, position: { x: (totalWidth - rowWidth) / 2 + i * (NODE_WIDTH + GAP_X), y } })
      })
      y += NODE_HEIGHT + GAP_Y
    }
  }

  // ---- edges ----
  const edges: ActivityEdgeSpec[] = []
  const visible = new Set(nodes.map((n) => n.id))
  for (const member of shown) {
    const parent = member.dispatch?.parentRunId ?? rootId
    const state = stateOf.get(member.id)!
    if (visible.has(parent)) {
      edges.push({ id: `assign:${member.id}`, source: parent, target: member.id, kind: 'assign', active: state === 'queued' || state === 'running' || state === 'monitoring' })
      if (isTerminal(state)) {
        const finished = member.finishedAt ? Date.parse(member.finishedAt) : 0
        edges.push({ id: `report:${member.id}`, source: member.id, target: parent, kind: 'report', active: now - finished < FLOW_WINDOW_MS })
      }
    }
    for (const dep of member.dispatch?.after ?? []) {
      if (visible.has(dep)) edges.push({ id: `after:${dep}:${member.id}`, source: dep, target: member.id, kind: 'after', active: false })
    }
  }
  if (folded.length > 0) {
    edges.push({ id: 'assign:group:done', source: rootId, target: 'group:done', kind: 'assign', active: false })
  }
  return { nodes, edges, hiddenDone: folded.length }
}

/** The tree a run belongs to: the root of its dispatch tree, or itself. */
export function rootOf(run: Pick<ApiRun, 'id' | 'dispatch'>): string {
  return run.dispatch?.rootRunId ?? run.id
}
