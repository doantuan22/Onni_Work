import { Loader2Icon, PlusIcon, SquareTerminalIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  createProjectTerminal,
  getProjectTerminal,
  readProjectTerminal,
  resizeProjectTerminal,
  stopProjectTerminal,
  writeProjectTerminal,
} from '@/api/client'
import { useHealth } from '@/api/queries'
import type { Runner, TerminalSession } from '@onni/api-client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { TerminalPane, type TerminalIo } from '../task-workspace/terminal-pane'

/**
 * The project terminal: tabs that each hold a shell in the project root, with a shortcut to start
 * an agent CLI in one. It is a terminal, not a task — nothing here is tracked, limited or fenced
 * the way a run is (spec `.ai/specs/2026-11-02-agent-terminal-tabs.md`).
 */

/** Same cadence as the task drawer: how quickly a busy flag or a tab name catches up. */
const STATE_REFRESH_MS = 2_000

const AGENTS: readonly { id: Runner; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'pi', label: 'pi' },
  { id: 'junie', label: 'Junie' },
  { id: 'copilot', label: 'GitHub Copilot CLI' },
  { id: 'cline', label: 'Cline CLI' },
  { id: 'antigravity', label: 'Antigravity CLI' },
]

/** The pane's transport. Built once per session id: `TerminalPane` requires a stable `io`. */
function projectIo(sessionId: string): TerminalIo {
  return {
    read: (cursor) => readProjectTerminal(sessionId, cursor),
    write: (data) => writeProjectTerminal(sessionId, data),
    resize: (cols, rows) => resizeProjectTerminal(sessionId, cols, rows),
  }
}

export function ProjectTerminalRoute() {
  const { t } = useI18n()
  const health = useHealth()
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The tab a close is waiting on, because something may be running in it. */
  const sessionsRef = useRef<TerminalSession[]>([])
  sessionsRef.current = sessions
  const [confirming, setConfirming] = useState<TerminalSession | null>(null)

  const installed = useMemo(() => {
    const checks = health.data?.checks ?? []
    return new Set(checks.filter((check) => check.available).map((check) => check.name))
  }, [health.data?.checks])

  /** Bumped by every open and close. A poll answer older than the newest bump is stale: applying it
   *  would drop a tab that was just opened or bring back one that was just closed. */
  const mutations = useRef(0)

  const ios = useMemo(() => new Map<string, TerminalIo>(), [])
  const ioFor = useCallback(
    (id: string) => {
      let io = ios.get(id)
      if (!io) ios.set(id, (io = projectIo(id)))
      return io
    },
    [ios],
  )

  // Reattach to whatever the project already has. A shell is never created on arrival: this page
  // opens empty and the user decides what to start.
  useEffect(() => {
    let cancelled = false
    const refresh = async (first: boolean) => {
      const stamp = mutations.current
      try {
        const state = await getProjectTerminal()
        if (cancelled || stamp !== mutations.current) return
        if (!state.available) {
          setUnavailable(state.reason ?? t('The terminal is not available in this cockpit.'))
          return
        }
        setUnavailable(null)
        const live = state.sessions.filter((session) => session.exitCode === null)
        setSessions((prev) => {
          // Keep an exited tab the user is still reading; drop it once it is gone server-side.
          const known = new Map(state.sessions.map((session) => [session.id, session]))
          const kept = prev.filter((session) => known.has(session.id)).map((session) => known.get(session.id)!)
          const added = live.filter((session) => !prev.some((p) => p.id === session.id))
          return [...kept, ...added]
        })
        if (first) setActiveId((current) => current ?? live[0]?.id ?? null)
      } catch (cause) {
        if (!cancelled && first) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled && first) setLoading(false)
      }
    }
    void refresh(true)
    const timer = setInterval(() => void refresh(false), STATE_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [t])

  const open = useCallback(
    async (agent?: Runner) => {
      setOpening(true)
      setError(null)
      mutations.current += 1
      try {
        const session = await createProjectTerminal(agent ? { agent } : {})
        mutations.current += 1
        setSessions((prev) => [...prev, session])
        setActiveId(session.id)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setOpening(false)
      }
    },
    [],
  )

  const close = useCallback(
    async (session: TerminalSession) => {
      setConfirming(null)
      mutations.current += 1
      try {
        await stopProjectTerminal(session.id)
      } catch {
        // Already gone server-side: the tab goes either way.
      }
      ios.delete(session.id)
      mutations.current += 1
      const next = sessionsRef.current.filter((item) => item.id !== session.id)
      setSessions(next)
      setActiveId((current) => (current === session.id ? (next[next.length - 1]?.id ?? null) : current))
    },
    [ios],
  )

  const requestClose = (session: TerminalSession) => {
    // `null` = this host cannot say what is running, so ask rather than assume idle.
    if (session.exitCode === null && session.busy !== false) setConfirming(session)
    else void close(session)
  }

  return (
    <div data-slot="project-terminal" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div
          data-slot="project-terminal-tabs"
          role="tablist"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                'group flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-transparent pl-2.5 pr-1 text-[12.5px]',
                session.id === activeId
                  ? 'border-border bg-card font-semibold text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={session.id === activeId}
                data-session={session.id}
                onClick={() => setActiveId(session.id)}
                className="flex max-w-48 items-center gap-1.5 truncate font-mono"
              >
                <SquareTerminalIcon className="size-3.5 shrink-0" />
                <span className="truncate">{session.label}</span>
                {session.exitCode !== null ? (
                  <span className="text-[10px] text-muted-foreground">({session.exitCode})</span>
                ) : null}
              </button>
              <button
                type="button"
                aria-label={t('Close terminal')}
                onClick={() => requestClose(session)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={opening || unavailable !== null}
              aria-label={t('New terminal')}
              data-slot="project-terminal-new"
            >
              {opening ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
              {t('New terminal')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void open()}>{t('Shell')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('Agent CLI')}</DropdownMenuLabel>
            {AGENTS.map((agent) => (
              <DropdownMenuItem
                key={agent.id}
                data-agent={agent.id}
                disabled={!installed.has(agent.id)}
                onSelect={() => void open(agent.id)}
              >
                {agent.label}
                {installed.has(agent.id) ? null : (
                  <span className="ml-auto pl-3 text-xs text-muted-foreground">{t('not installed')}</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="shrink-0 border-b border-border/60 px-3 py-1.5 text-[11.5px] text-muted-foreground">
        {t('A plain terminal in the project root. Agents started here are not tracked or limited like tasks.')}
      </p>

      {error ? (
        <p role="alert" className="shrink-0 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2Icon className="size-5 animate-spin" />
          </div>
        ) : unavailable ? (
          <p className="p-6 text-sm text-muted-foreground">{unavailable}</p>
        ) : sessions.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {t('No terminals yet. Use “New terminal” to open a shell or start an agent.')}
          </p>
        ) : (
          sessions.map((session) => (
            <div key={session.id} className={cn('absolute inset-0', session.id !== activeId && 'hidden')}>
              <TerminalPane runId="project" session={session} active={session.id === activeId} io={ioFor(session.id)} />
            </div>
          ))
        )}
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={(next) => !next && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Close this terminal?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('Something may still be running in it. Closing stops that process.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirming && void close(confirming)}>{t('Close')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
