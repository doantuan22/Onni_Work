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

export interface SplitTabStripProps {
  state: WorkspaceState
  onActivate: (paneId: string) => void
  onClose: (paneId: string) => void
  onUnsplit: () => void
  onPickThread?: (runId: string) => void
}

function paneTitle(pane: PaneRef, fallbackNewTask: string): string {
  if (pane.kind === 'draft') return pane.title ?? fallbackNewTask
  return pane.title ?? pane.runId
}

/**
 * Tab strip shown exclusively while 2-up split is active.
 * Labels the two visible conversation panes, provides pane activation,
 * close tab, unsplit, and a thread picker to switch panes.
 */
export function SplitTabStrip({
  state,
  onActivate,
  onClose,
  onUnsplit,
  onPickThread,
}: SplitTabStripProps) {
  const { t } = useI18n()

  const split = state.split
  if (split === 'none') return null

  const paneA = state.threads.find((thread) => thread.paneId === split.a)
  const paneB = state.threads.find((thread) => thread.paneId === split.b)

  if (!paneA || !paneB) return null

  const titleA = paneTitle(paneA, t('New task'))
  const titleB = paneTitle(paneB, t('New task'))

  const otherThreads = state.threads.filter(
    (thread) => thread.paneId !== paneA.paneId && thread.paneId !== paneB.paneId,
  )

  return (
    <div
      role="tablist"
      aria-label={t('Split conversation panes')}
      data-slot="split-tab-strip"
      className="flex h-[var(--header-h,48px)] min-w-0 items-center justify-between border-b border-border bg-muted/40 px-3 text-xs"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {/* Pane A tab */}
        <div
          role="tab"
          aria-selected={state.active === paneA.paneId}
          aria-controls={paneA.paneId}
          data-active={state.active === paneA.paneId ? 'true' : undefined}
          data-pane-id={paneA.paneId}
          className={cn(
            'group flex h-8 items-center gap-2 rounded-md px-2.5 font-medium transition-colors cursor-pointer select-none',
            state.active === paneA.paneId
              ? 'bg-background text-foreground shadow-xs ring-1 ring-border'
              : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
          )}
          onClick={() => onActivate(paneA.paneId)}
          onPointerDown={() => onActivate(paneA.paneId)}
        >
          <span className="max-w-[160px] truncate">{titleA}</span>
          <button
            type="button"
            aria-label={t(`Close ${titleA}`)}
            className="rounded p-0.5 opacity-70 hover:opacity-100 hover:bg-muted focus-visible:outline-hidden"
            onClick={(e) => {
              e.stopPropagation()
              onClose(paneA.paneId)
            }}
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Pane B tab */}
        <div
          role="tab"
          aria-selected={state.active === paneB.paneId}
          aria-controls={paneB.paneId}
          data-active={state.active === paneB.paneId ? 'true' : undefined}
          data-pane-id={paneB.paneId}
          className={cn(
            'group flex h-8 items-center gap-2 rounded-md px-2.5 font-medium transition-colors cursor-pointer select-none',
            state.active === paneB.paneId
              ? 'bg-background text-foreground shadow-xs ring-1 ring-border'
              : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
          )}
          onClick={() => onActivate(paneB.paneId)}
          onPointerDown={() => onActivate(paneB.paneId)}
        >
          <span className="max-w-[160px] truncate">{titleB}</span>
          <button
            type="button"
            aria-label={t(`Close ${titleB}`)}
            className="rounded p-0.5 opacity-70 hover:opacity-100 hover:bg-muted focus-visible:outline-hidden"
            onClick={(e) => {
              e.stopPropagation()
              onClose(paneB.paneId)
            }}
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Button in header to pick another open thread */}
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
                <DropdownMenuItem
                  key={thread.paneId}
                  onSelect={() => onPickThread?.(thread.kind === 'run' ? thread.runId : thread.paneId)}
                >
                  <span className="truncate">{paneTitle(thread, t('New task'))}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Unsplit button */}
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
