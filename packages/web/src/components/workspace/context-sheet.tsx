import { useState, type ReactNode } from 'react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { viewLabel, type ViewId } from '@/routes/task-workspace/layout-state'
import { VIEW_ICONS } from '@/routes/task-workspace/view-picker'

export const DEFAULT_CONTEXT_VIEWS: readonly ViewId[] = [
  'changes',
  'files',
  'terminal',
  'browser',
  'commits',
  'tree',
]

export interface ContextSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  runId?: string
  title?: string
  views?: readonly ViewId[]
  activeView?: ViewId
  onViewChange?: (view: ViewId) => void
  renderContent?: (view: ViewId) => ReactNode
  children?: ReactNode
}

/**
 * Full-screen Context Sheet for mobile / narrow viewports (<1024px).
 * Displays context area views (Changes, Files, Terminal, Preview, etc.) in a Sheet
 * instead of a side column.
 */
export function ContextSheet({
  open,
  onOpenChange,
  title,
  views = DEFAULT_CONTEXT_VIEWS,
  activeView,
  onViewChange,
  renderContent,
  children,
}: ContextSheetProps) {
  const { t } = useI18n()
  const [internalView, setInternalView] = useState<ViewId>(activeView ?? views[0] ?? 'changes')
  const currentView = activeView ?? internalView

  const handleSelectView = (view: ViewId) => {
    setInternalView(view)
    onViewChange?.(view)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-slot="context-sheet"
        className="fixed inset-0 z-50 flex h-dvh w-full max-w-none flex-col gap-0 border-0 p-0 sm:max-w-none bg-background text-foreground"
      >
        <SheetHeader
          data-slot="context-sheet-header"
          className="flex h-[var(--header-h,48px)] shrink-0 flex-row items-center justify-between border-b border-border bg-muted/40 px-4 py-0 pr-16"
        >
          <SheetTitle data-slot="context-sheet-title" className="text-sm font-medium truncate">
            {title ? `${title} — ${t('Context')}` : t('Context area')}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t('Context area views for this task')}
          </SheetDescription>
        </SheetHeader>

        <div
          role="tablist"
          aria-label={t('Context views')}
          data-slot="context-sheet-tabs"
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-3 py-1.5 text-xs"
        >
          {views.map((view) => {
            const Icon = VIEW_ICONS[view]
            const isTabActive = currentView === view
            return (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={isTabActive}
                data-active={isTabActive ? 'true' : undefined}
                data-view={view}
                className={cn(
                  'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 font-medium transition-colors cursor-pointer select-none',
                  isTabActive
                    ? 'bg-background text-foreground shadow-xs ring-1 ring-border'
                    : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
                )}
                onClick={() => handleSelectView(view)}
              >
                {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
                <span>{t(viewLabel(view))}</span>
              </button>
            )
          })}
        </div>

        <div data-slot="context-sheet-body" className="flex min-h-0 flex-1 flex-col overflow-auto">
          {renderContent ? renderContent(currentView) : children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
