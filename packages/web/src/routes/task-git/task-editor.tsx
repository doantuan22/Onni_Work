import { useId, useRef, type KeyboardEvent } from 'react'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import { FilePreview } from './file-preview'

/** Read-only worktree editor surface used by the Workbench layout. */
export function TaskEditor({
  runId,
  openPaths,
  activePath,
  onSelect,
  onClose,
}: {
  runId: string
  openPaths: string[]
  activePath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
}) {
  const id = useId()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const hasOpenFile = openPaths.length > 0 && activePath !== null && openPaths.includes(activePath)
  const segments = hasOpenFile ? activePath.split('/').filter(Boolean) : []

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % openPaths.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + openPaths.length) % openPaths.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = openPaths.length - 1
    if (nextIndex === undefined || openPaths.length === 0) return

    event.preventDefault()
    const nextPath = openPaths[nextIndex]
    if (nextPath === undefined) return
    onSelect(nextPath)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <section data-route="task-editor" className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <header className="flex h-header min-h-header min-w-0 items-center border-b border-border">
        {openPaths.length ? (
          <div
            role="tablist"
            aria-label="Open files"
            data-slot="editor-tabs"
            className="flex h-full min-w-0 flex-1 overflow-x-auto overscroll-x-contain"
          >
            {openPaths.map((path, index) => {
              const name = path.split('/').filter(Boolean).at(-1) ?? path
              const selected = path === activePath
              return (
                <div
                  key={path}
                  data-slot="editor-tab"
                  className={cn(
                    'flex h-full min-w-0 max-w-52 shrink-0 items-center border-r border-border',
                    selected ? 'bg-muted text-foreground' : 'text-soft-foreground',
                  )}
                >
                  <button
                    type="button"
                    role="tab"
                    id={`${id}-tab-${index}`}
                    aria-controls={`${id}-panel`}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    title={path}
                    ref={(element) => { tabRefs.current[index] = element }}
                    onClick={() => onSelect(path)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                    className={cn(
                      'min-w-0 flex-1 truncate px-3 text-left text-xs',
                      selected ? 'font-medium' : 'hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${name}`}
                    title={`Close ${path}`}
                    onClick={() => onClose(path)}
                    className="mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-soft-foreground hover:bg-background hover:text-foreground"
                  >
                    <XIcon aria-hidden="true" className="size-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <h2 className="px-4 text-xs font-medium text-foreground">Editor</h2>
        )}
      </header>

      {!hasOpenFile ? (
        <div
          data-slot="editor-empty"
          className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-soft-foreground"
        >
          Open a file from the tree
        </div>
      ) : (
        <>
          <nav
            aria-label="File path"
            data-slot="editor-breadcrumb"
            className="flex h-9 min-w-0 shrink-0 items-center gap-1 overflow-hidden border-b border-border px-3 text-xs text-soft-foreground"
          >
            {segments.map((segment, index) => (
              <span key={`${segment}-${index}`} className="flex min-w-0 items-center gap-1">
                {index > 0 ? <span aria-hidden="true" className="shrink-0 text-muted-foreground">/</span> : null}
                <span className={cn('truncate', index === segments.length - 1 && 'text-foreground')} title={segment}>
                  {segment}
                </span>
              </span>
            ))}
          </nav>
          <div
            data-slot="editor-content"
            id={`${id}-panel`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${openPaths.indexOf(activePath)}`}
            aria-label="File contents"
            tabIndex={0}
            className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain"
          >
            <FilePreview source={{ kind: 'run', runId }} path={activePath} className="min-w-0 rounded-none border-0 bg-transparent" />
          </div>
        </>
      )}
    </section>
  )
}
