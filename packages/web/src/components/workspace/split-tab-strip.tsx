import { useRef, type KeyboardEvent } from 'react'
import { ColumnsIcon, SquareIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { PaneRef, WorkspaceState } from '@/lib/workspace-state'

export function splitTabId(paneId: string): string {
  return `split-tab-${encodeURIComponent(paneId)}`
}

function paneTitle(pane: PaneRef, fallbackNewTask: string): string {
  if (pane.kind === 'draft') return pane.title ?? fallbackNewTask
  return pane.title ?? pane.runId
}

/** Tab strip shown exclusively while 2-up split is active. */
export function SplitTabStrip({
  state,
  onActivate,
  onClose,
  onUnsplit,
  onPickThread,
}: {
  state: WorkspaceState
  onActivate: (paneId: string) => void
  onClose: (paneId: string) => void
  onUnsplit: () => void
  onPickThread?: (runId: string) => void
}) {
  const { t } = useI18n()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const split = state.split
  if (split === 'none') return null

  const paneA = state.threads.find((thread) => thread.paneId === split.a)
  const paneB = state.threads.find((thread) => thread.paneId === split.b)
  if (!paneA || !paneB) return null

  const panes = [paneA, paneB]
  const otherThreads = state.threads.filter(
    (thread) => thread.kind === 'run' && thread.paneId !== paneA.paneId && thread.paneId !== paneB.paneId,
  )
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % panes.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + panes.length) % panes.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = panes.length - 1
    if (nextIndex === undefined) return
    event.preventDefault()
    const nextPane = panes[nextIndex]
    if (!nextPane) return
    onActivate(nextPane.paneId)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <div
      data-slot="split-tab-strip"
      className="flex h-[var(--header-h,48px)] min-w-0 items-center justify-between border-b border-border bg-muted/40 px-3 text-xs"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <div role="tablist" aria-label={t('Split conversation panes')} className="flex min-w-0 items-center gap-1.5">
          {panes.map((pane, index) => {
            const title = paneTitle(pane, t('New task'))
            const active = state.active === pane.paneId
            return (
              <button
                key={pane.paneId}
                ref={(element) => { tabRefs.current[index] = element }}
                type="button"
                role="tab"
                id={splitTabId(pane.paneId)}
                aria-controls={pane.paneId}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                data-active={active ? 'true' : undefined}
                data-pane-id={pane.paneId}
                className={cn(
                  'group flex h-8 items-center gap-2 rounded-md px-2.5 font-medium transition-colors cursor-pointer select-none',
                  active
                    ? 'bg-background text-foreground shadow-xs ring-1 ring-border'
                    : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
                )}
                onClick={() => onActivate(pane.paneId)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                <span className="max-w-[160px] truncate">{title}</span>
              </button>
            )
          })}
        </div>
        {panes.map((pane) => {
          const title = paneTitle(pane, t('New task'))
          return (
            <button
              key={pane.paneId}
              type="button"
              aria-label={t(`Close ${title}`)}
              className="rounded p-0.5 opacity-70 hover:opacity-100 hover:bg-muted focus-visible:outline-hidden"
              onClick={() => onClose(pane.paneId)}
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              aria-label={t('Pick another open thread')}
              data-slot="split-pick-thread"
            >
              <ColumnsIcon className="h-3.5 w-3.5" />
              <span>{t('Pick thread')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{t('Open threads')}</DropdownMenuLabel>
            {otherThreads.length === 0 ? (
              <DropdownMenuItem disabled>{t('No other open threads')}</DropdownMenuItem>
            ) : (
              otherThreads.map((thread) => (
                <DropdownMenuItem key={thread.paneId} onSelect={() => onPickThread?.(thread.runId)}>
                  <span className="truncate">{paneTitle(thread, t('New task'))}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={onUnsplit}
          aria-label={t('Unsplit')}
          data-slot="split-unsplit"
        >
          <SquareIcon className="h-3.5 w-3.5" />
          <span>{t('Unsplit')}</span>
        </Button>
      </div>
    </div>
  )
}
