import * as React from 'react'
import { MessageSquareTextIcon } from 'lucide-react'
import type { TranscriptSearchItem } from '@/api/workspace-threads'
import { CommandItem } from '@/components/ui/command'

export interface TranscriptMatchItemProps {
  item: TranscriptSearchItem
  query: string
  runTitle: string
  projectName?: string | null
  onSelect: (item: TranscriptSearchItem) => void
  slot?: string
}

/**
 * Highlights occurrences of query words in a snippet using semantic design tokens.
 * Complies with design-guardian rules: no raw colors, no amber text, no dark: variants.
 */
export function highlightMatch(text: string, query: string): React.ReactNode {
  const trimmed = query.trim()
  if (!trimmed || !text) return text

  const tokens = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  if (tokens.length === 0) return text

  const regex = new RegExp(`(${tokens.join('|')})`, 'gi')
  const parts = text.split(regex)

  return parts.map((part, index) => {
    const isMatch = tokens.some((t) => part.toLowerCase() === t.toLowerCase())
    if (isMatch) {
      return (
        <mark
          key={index}
          data-slot="transcript-highlight"
          className="bg-primary/20 text-primary font-medium rounded-xs px-0.5"
        >
          {part}
        </mark>
      )
    }
    return part
  })
}

/**
 * A single transcript search match row in the command palette.
 * Displays the run title, optional project badge in multi-project workspaces,
 * and a one-line snippet with the matching query highlighted.
 */
export const TranscriptMatchItem = React.memo(function TranscriptMatchItem({
  item,
  query,
  runTitle,
  projectName,
  onSelect,
  slot = 'palette-transcript-match',
}: TranscriptMatchItemProps) {
  const cleanSnippet = React.useMemo(
    () => item.snippet.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim(),
    [item.snippet],
  )

  const value = `transcript ${runTitle} ${cleanSnippet} ${item.runId} ${item.seq}`

  return (
    <CommandItem
      value={value}
      keywords={[query]}
      data-slot={slot}
      data-run-id={item.runId}
      data-project-id={item.projectId}
      data-seq={item.seq}
      onSelect={() => onSelect(item)}
      className="flex items-center gap-2 py-2"
    >
      <MessageSquareTextIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span
        data-slot="palette-transcript-title"
        className="shrink-0 max-w-[200px] truncate font-medium text-foreground"
        title={runTitle}
      >
        {runTitle}
      </span>
      {projectName ? (
        <span
          data-slot="palette-transcript-project"
          className="shrink-0 truncate text-xs text-soft-foreground"
        >
          {projectName}
        </span>
      ) : null}
      <span
        data-slot="palette-transcript-snippet"
        className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
        title={cleanSnippet}
      >
        {highlightMatch(cleanSnippet, query)}
      </span>
    </CommandItem>
  )
})
