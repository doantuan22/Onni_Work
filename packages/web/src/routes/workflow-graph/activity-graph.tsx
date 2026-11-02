import '@xyflow/react/dist/style.css'
import './activity-graph.css'

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {
  BanIcon,
  BotIcon,
  CheckCircle2Icon,
  ClockIcon,
  CrownIcon,
  ExternalLinkIcon,
  Loader2Icon,
  MaximizeIcon,
  MessageCircleQuestionIcon,
  RadioIcon,
  ShieldAlertIcon,
  UsersIcon,
  XCircleIcon,
  type LucideIcon,
} from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'

import { useRuns } from '@/api/queries'
import type { ApiRun } from '@onni/api-client'
import { CenteredState } from '@/components/centered-state'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/theme-provider'
import {
  buildActivityGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
  rootOf,
  type ActivityEdgeSpec,
  type ActivityNodeSpec,
  type ActivityState,
} from '@/lib/activity-graph'
import { useI18n } from '@/lib/i18n'
import { Link } from '@/lib/project-router'
import { formatCost } from '@/lib/tasks-table'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

import { FloatingPanel } from './workflow-graph'

/**
 * The Activity view of the task Graph tab (P9): who works on what, right now.
 *
 * One source of truth — the run records the sidebar reads, patched live by SSE — folded by
 * `lib/activity-graph.ts`. This file only draws: a card per agent (icon, model, state with an
 * icon so colour is never the only signal, current line, elapsed, cost), assign edges
 * (manager → worker) and report edges (worker → manager) that move while something flows, a
 * deterministic grid layout, fit-to-view that stops once the user pans, and a details panel.
 */

const STATE_META: Record<ActivityState, { icon: LucideIcon; label: string; tone: string; spin?: boolean }> = {
  queued: { icon: ClockIcon, label: 'Queued', tone: 'text-muted-foreground border-border' },
  running: { icon: Loader2Icon, label: 'Working', tone: 'text-primary border-primary/60', spin: true },
  monitoring: { icon: RadioIcon, label: 'Waiting for workers', tone: 'text-primary border-primary/50' },
  asking: { icon: MessageCircleQuestionIcon, label: 'Needs you', tone: 'text-warning border-warning/60' },
  done: { icon: CheckCircle2Icon, label: 'Done', tone: 'text-success border-success/50' },
  failed: { icon: XCircleIcon, label: 'Failed', tone: 'text-danger border-danger/60' },
  blocked: { icon: ShieldAlertIcon, label: 'Blocked by permission', tone: 'text-danger border-danger/60' },
  cancelled: { icon: BanIcon, label: 'Cancelled', tone: 'text-muted-foreground border-border' },
}

type CardData = { spec: ActivityNodeSpec; fresh: boolean; onExpand?: () => void }

function Elapsed({ startedAt, finishedAt }: { startedAt?: string; finishedAt?: string }) {
  const live = startedAt !== undefined && finishedAt === undefined
  // One timer per RUNNING card only: finished cards never tick.
  const now = useNow(1000, live)
  if (!startedAt) return null
  const end = finishedAt ? Date.parse(finishedAt) : now
  const seconds = Math.max(0, Math.round((end - Date.parse(startedAt)) / 1000))
  const text = seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m` : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
  return <span className="tabular-nums">{text}</span>
}

const ActivityCard = memo(function ActivityCard({ data }: NodeProps<Node<CardData>>) {
  const { t } = useI18n()
  const { spec, fresh, onExpand } = data
  const handles = (
    <>
      <Handle type="target" position={Position.Top} className="!size-1 !border-0 !bg-transparent" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className="!size-1 !border-0 !bg-transparent" isConnectable={false} />
    </>
  )
  if (spec.kind === 'group') {
    return (
      <div
        data-slot="activity-node"
        data-state="done"
        style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
        className="activity-node flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-success/50 bg-card/70 px-4 text-center"
      >
        {handles}
        <UsersIcon className="size-5 text-success" aria-hidden="true" />
        <span className="text-[13px] font-medium text-foreground">{t('{count} finished workers', { count: spec.count ?? 0 })}</span>
        <Button type="button" size="sm" variant="outline" className="nodrag nopan h-7" onClick={onExpand}>
          {t('Show all')}
        </Button>
      </div>
    )
  }
  const meta = STATE_META[spec.state]
  const Icon = meta.icon
  const manager = spec.role === 'manager'
  return (
    <div
      data-slot="activity-node"
      data-state={spec.state}
      data-fresh={fresh ? 'true' : undefined}
      data-role={spec.role}
      title={`${spec.title} · ${t(meta.label)}`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={cn(
        'activity-node flex flex-col gap-1.5 rounded-xl border bg-card px-3.5 py-3 text-left shadow-sm',
        meta.tone,
        manager && 'ring-2 ring-primary/35',
      )}
    >
      {handles}
      <div className="flex items-center gap-2">
        {manager ? <CrownIcon className="size-4 shrink-0 text-primary" aria-label={t('manager')} /> : <BotIcon className="size-4 shrink-0 text-soft-foreground" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold text-foreground">
          {spec.runner}
          {spec.model ? <span className="font-normal text-muted-foreground"> · {spec.model}</span> : null}
        </span>
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10.5px] font-medium', meta.tone)}>
          <Icon className={cn('size-3', meta.spin && 'motion-safe:animate-spin')} aria-hidden="true" />
          {t(meta.label)}
        </span>
      </div>
      <p className="truncate text-[13px] font-medium text-foreground">{spec.title}</p>
      <p className="line-clamp-2 min-h-[2.2em] text-[11.5px] leading-snug text-muted-foreground">{t(spec.line)}</p>
      <div className="mt-auto flex items-center gap-3 text-[11px] text-soft-foreground">
        <Elapsed startedAt={spec.startedAt} finishedAt={spec.finishedAt} />
        {spec.costUsd !== undefined && spec.costUsd > 0 ? <span className="tabular-nums">{formatCost(spec.costUsd)}</span> : null}
        {spec.tokens ? <span className="tabular-nums">{Intl.NumberFormat('en', { notation: 'compact' }).format(spec.tokens)} tok</span> : null}
      </div>
    </div>
  )
})

const nodeTypes = { activity: ActivityCard }

function edgeFor(spec: ActivityEdgeSpec): Edge {
  const color = spec.kind === 'assign' ? 'var(--primary)' : spec.kind === 'report' ? 'var(--success)' : 'var(--muted-foreground)'
  return {
    id: spec.id,
    source: spec.source,
    target: spec.target,
    type: 'smoothstep',
    className: spec.active ? 'activity-edge-flow' : undefined,
    style: {
      stroke: color,
      strokeWidth: spec.active ? 2.25 : 1.5,
      opacity: spec.active ? 1 : spec.kind === 'after' ? 0.7 : 0.45,
      strokeDasharray: spec.kind === 'after' ? '2 5' : spec.kind === 'report' && !spec.active ? '5 4' : undefined,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
  }
}

/** Keep each node data object identical between renders unless something about it changed. */
function useStableNodes(specs: ActivityNodeSpec[], onExpand: () => void): Node<CardData>[] {
  const previous = useRef(new Map<string, { key: string; node: Node<CardData> }>())
  const seen = useRef(new Set<string>())
  return useMemo(() => {
    const next = new Map<string, { key: string; node: Node<CardData> }>()
    const nodes = specs.map((spec) => {
      const key = JSON.stringify(spec)
      const old = previous.current.get(spec.id)
      if (old && old.key === key) {
        next.set(spec.id, old)
        return old.node
      }
      const fresh = seen.current.has(spec.id) // changed after first paint → play the state effect
      seen.current.add(spec.id)
      const node: Node<CardData> = {
        id: spec.id,
        type: 'activity',
        position: spec.position,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        draggable: false,
        connectable: false,
        data: { spec, fresh, ...(spec.kind === 'group' ? { onExpand } : {}) },
      }
      next.set(spec.id, { key, node })
      return node
    })
    previous.current = next
    return nodes
  }, [specs, onExpand])
}

/** The Activity graph with its own xyflow context (the task Graph tab may embed it anywhere). */
export function ActivityGraph({ run }: { run: ApiRun }) {
  return (
    <ReactFlowProvider>
      <ActivityGraphView run={run} />
    </ReactFlowProvider>
  )
}

function ActivityGraphView({ run }: { run: ApiRun }) {
  const { t } = useI18n()
  const { resolvedTheme } = useTheme()
  const runs = useRuns()
  const rf = useReactFlow()
  const rootId = rootOf(run)
  const [collapse, setCollapse] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const userMoved = useRef(false)

  const now = useNow(5000)
  const graph = useMemo(
    () => buildActivityGraph(runs.data ?? [run], rootId, { collapseDone: collapse, now }),
    [runs.data, run, rootId, collapse, now],
  )
  const expand = useMemo(() => () => setCollapse(false), [])
  const nodes = useStableNodes(graph.nodes, expand)
  const edges = useMemo(() => graph.edges.map(edgeFor), [graph.edges])
  const selected = graph.nodes.find((n) => n.id === selectedId && n.kind === 'agent')
  const selectedRun = (runs.data ?? []).find((r) => r.id === selectedId)

  // Fit when the set of nodes changes, until the user takes the camera.
  const signature = nodes.map((n) => n.id).join('|')
  useEffect(() => {
    if (userMoved.current || nodes.length === 0) return
    const frame = requestAnimationFrame(() => void rf.fitView({ padding: 0.2, maxZoom: 1.1, duration: 280 }))
    return () => cancelAnimationFrame(frame)
  }, [signature, rf]) // eslint-disable-line react-hooks/exhaustive-deps

  if (runs.isPending) return <CenteredState icon={<Loader2Icon className="animate-spin" />} tone="neutral" title={t('Loading the activity map…')} subtitle="" heading="h2" />
  if (runs.isError) return <CenteredState icon={<XCircleIcon />} tone="danger" title={t('The activity map did not load')} subtitle={runs.error.message} heading="h2" />
  if (nodes.length === 0) return <CenteredState icon={<UsersIcon />} tone="neutral" title={t('Nothing to draw yet')} subtitle={t('This task has not started.')} heading="h2" />

  return (
    <div data-slot="activity-graph" data-node-count={nodes.length} className="relative min-h-[420px] flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, n) => setSelectedId(n.id)}
        onPaneClick={() => setSelectedId(null)}
        // A user pan/zoom carries a DOM event; our own fitView does not.
        onMoveStart={(event) => {
          if (event) userMoved.current = true
        }}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        minZoom={0.15}
        maxZoom={1.6}
        colorMode={resolvedTheme === 'light' ? 'light' : 'dark'}
        proOptions={{ hideAttribution: true }}
        onlyRenderVisibleElements={nodes.length > 40}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} />
        {nodes.length > 8 ? <MiniMap pannable zoomable nodeColor="var(--primary)" maskColor="transparent" /> : null}
        <Panel position="top-right" className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 bg-card"
            onClick={() => {
              userMoved.current = false
              void rf.fitView({ padding: 0.2, maxZoom: 1.1, duration: 280 })
            }}
          >
            <MaximizeIcon className="size-3.5" aria-hidden="true" />
            {t('Fit')}
          </Button>
          {graph.hiddenDone > 0 || !collapse ? (
            <Button type="button" size="sm" variant="outline" className="h-7 bg-card" onClick={() => setCollapse((v) => !v)}>
              {collapse ? t('Show all workers') : t('Group finished')}
            </Button>
          ) : null}
        </Panel>
      </ReactFlow>
      {selected ? (
        <FloatingPanel side="right" label="Agent details" title={selected.title} onClose={() => setSelectedId(null)}>
          <div className="flex flex-col gap-3 p-3 text-[13px]">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted-foreground">{t('Agent')}</dt>
              <dd className="font-mono text-[12px]">{selected.runner}{selected.model ? ` · ${selected.model}` : ''}</dd>
              <dt className="text-muted-foreground">{t('State')}</dt>
              <dd>{t(STATE_META[selected.state].label)}</dd>
              {selected.costUsd !== undefined ? (<><dt className="text-muted-foreground">{t('Cost')}</dt><dd className="tabular-nums">{formatCost(selected.costUsd)}</dd></>) : null}
            </dl>
            <p className="whitespace-pre-wrap text-muted-foreground">{selectedRun?.dispatch?.report?.result ?? t(selected.line)}</p>
            {selectedRun?.dispatch?.report?.evidence?.length ? (
              <ul className="list-disc pl-4 text-[12px] text-muted-foreground">
                {selectedRun.dispatch.report.evidence.slice(0, 5).map((e) => <li key={e}>{e}</li>)}
              </ul>
            ) : null}
            <Button asChild size="sm" variant="outline" className="w-fit gap-1.5">
              <Link to={`/tasks/${selected.id}`}>
                <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                {t('Open task')}
              </Link>
            </Button>
          </div>
        </FloatingPanel>
      ) : null}
    </div>
  )
}
