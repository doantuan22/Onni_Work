import { FilesTree } from './files-tree'

/** The Workbench's narrow file navigator; file content belongs to the separate editor pane. */
export function TaskFilesTree({
  runId,
  selectedPath,
  onOpenFile,
}: {
  runId: string
  selectedPath: string | null
  onOpenFile: (path: string) => void
}) {
  return (
    <section data-slot="task-files-tree" className="flex min-h-0 flex-1 flex-col border-r border-border">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-3">
        <h2 className="text-sm font-medium text-foreground">Files</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        <FilesTree runId={runId} selected={selectedPath} onSelect={onOpenFile} />
      </div>
    </section>
  )
}
