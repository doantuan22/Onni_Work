import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useIsDesktop } from '@/lib/use-desktop'
import { useI18n } from '@/lib/i18n'
import { NEW_TASK_PANEL_BREAKPOINT_PX } from '@/lib/new-task-panel-state'
import {
  presetDisplayName,
  type SummarySegment,
  type PanelSection,
  type TaskPreset,
} from '@/lib/new-task-presets'
import { cn } from '@/lib/utils'

/**
 * The `/new` Task settings panel (ADR 0008).
 *
 * Every run setting lives here — the composer keeps the prompt and the send button. The panel is
 * an inline right column at ≥1100px and a right drawer below it, opened from the summary line.
 * It is a shell with slots: `new-task.tsx` builds the controls from the same components the
 * footer used, so this file owns layout, presets and focus, never the run-mode rules.
 */

export interface TaskSettingsPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  presets: readonly TaskPreset[]
  selectedPresetId: string | null
  modified: boolean
  onApplyPreset: (preset: TaskPreset) => void
  onSavePreset: (name: string) => void
  onRenamePreset: (id: string, name: string) => void
  onDeletePreset: (id: string) => void
  presetsDisabled?: boolean
  /** A request to reveal one section — the summary was clicked. */
  focusSection: { section: PanelSection; nonce: number } | null
  who: ReactNode
  where: ReactNode
  autonomy: ReactNode
  skill: ReactNode
  advanced: ReactNode
  disabled?: boolean
}

export function TaskSettingsPanel(props: TaskSettingsPanelProps) {
  const { t } = useI18n()
  const desktop = useIsDesktop(NEW_TASK_PANEL_BREAKPOINT_PX)
  const { open, onOpenChange } = props

  if (!desktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          data-slot="task-settings-drawer"
          showCloseButton={false}
          className="w-[min(92vw,380px)] gap-0 p-0 sm:max-w-[380px]"
        >
          <SheetTitle className="sr-only">{t('Task settings')}</SheetTitle>
          <SheetDescription className="sr-only">
            {t('Presets, agent, where it runs, autonomy, limits and advanced options for this task.')}
          </SheetDescription>
          <PanelBody {...props} inDrawer />
        </SheetContent>
      </Sheet>
    )
  }

  if (!open) return null

  return (
    <aside
      data-slot="task-settings-panel"
      aria-label={t('Task settings')}
      className="sticky top-4 flex max-h-[calc(100dvh-2rem)] w-[360px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card/95 shadow-sm backdrop-blur-sm"
    >
      <PanelBody {...props} />
    </aside>
  )
}

/** The line under the prompt. Read-only, and every segment opens the section it describes. */
export function TaskSummary({
  segments,
  onOpen,
  disabled,
}: {
  segments: readonly SummarySegment[]
  onOpen: (section: PanelSection) => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  if (segments.length === 0) return null
  return (
    <div
      data-slot="task-summary"
      className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground"
    >
      {segments.map((segment) => (
        <button
          key={segment.key}
          type="button"
          data-slot={`summary-${segment.key}`}
          data-tone={segment.tone}
          disabled={disabled}
          title={t('Open {section} settings', { section: t(sectionLabel(segment.section)) })}
          onClick={() => onOpen(segment.section)}
          className={cn(
            'rounded px-0.5 underline-offset-4 transition-colors hover:underline disabled:pointer-events-none',
            segment.tone === 'danger' && 'font-medium text-danger',
            segment.tone === 'warning' && 'font-medium text-warning',
          )}
        >
          {segment.label}
        </button>
      ))}
      <button
        type="button"
        data-slot="task-settings-open"
        aria-label={t('Task settings')}
        title={t('Task settings')}
        disabled={disabled}
        onClick={() => onOpen('presets')}
        className="ml-0.5 inline-flex size-6 items-center justify-center rounded-md text-soft-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none"
      >
        <SlidersHorizontalIcon aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  )
}

function sectionLabel(section: PanelSection): string {
  switch (section) {
    case 'presets':
      return 'Presets'
    case 'who':
      return 'Who works'
    case 'where':
      return 'Where it runs'
    case 'autonomy':
      return 'Autonomy & limits'
    case 'skill':
      return 'Skill'
    case 'advanced':
      return 'Advanced'
  }
}

function PanelBody({
  presets,
  selectedPresetId,
  modified,
  onApplyPreset,
  onSavePreset,
  onRenamePreset,
  onDeletePreset,
  presetsDisabled,
  focusSection,
  who,
  where,
  autonomy,
  skill,
  advanced,
  onOpenChange,
  inDrawer,
}: TaskSettingsPanelProps & { inDrawer?: boolean }) {
  const { t } = useI18n()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // A summary click both opens the panel (the route does that) and scrolls here. Radix mounts
  // the drawer in a portal, so the query runs from the panel's own root, not the document.
  useEffect(() => {
    if (!focusSection) return
    if (focusSection.section === 'advanced') setAdvancedOpen(true)
    const id = window.setTimeout(() => {
      const target = bodyRef.current?.querySelector<HTMLElement>(
        `[data-section="${focusSection.section}"]`,
      )
      if (!target) return
      target.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
      target.focus?.({ preventScroll: true })
    }, 0)
    return () => window.clearTimeout(id)
  }, [focusSection])

  return (
    <>
      <header
        data-slot="task-settings-header"
        className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3"
      >
        <SlidersHorizontalIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-foreground">{t('Task settings')}</h2>
        <button
          type="button"
          data-slot="task-settings-collapse"
          aria-label={t('Collapse task settings')}
          title={t('Collapse task settings')}
          onClick={() => onOpenChange(false)}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {inDrawer ? (
            <XIcon aria-hidden="true" className="size-4" />
          ) : (
            <ChevronRightIcon aria-hidden="true" className="size-4" />
          )}
        </button>
      </header>
      <div
        ref={bodyRef}
        data-slot="task-settings-body"
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 py-4"
      >
        <Section id="presets" title="Presets" description="Start from a saved way of working.">
          <PresetList
            presets={presets}
            selectedPresetId={selectedPresetId}
            modified={modified}
            disabled={presetsDisabled}
            onApply={onApplyPreset}
            onSave={onSavePreset}
            onRename={onRenamePreset}
            onDelete={onDeletePreset}
          />
        </Section>
        <Section id="who" title="Who works" description="The agent, its model, and any workers it may hand parts to.">
          {who}
        </Section>
        <Section id="where" title="Where it runs" description="An isolated worktree, or your checkout directly.">
          {where}
        </Section>
        <Section id="autonomy" title="Autonomy & limits" description="Whether it pauses, and what it may spend.">
          {autonomy}
        </Section>
        <Section id="skill" title="Skill" description="The skill or workflow this task runs.">
          {skill}
        </Section>
        <Section
          id="advanced"
          title="Advanced"
          description="Read-only questions, follow-ups, templates and dispatch."
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
        >
          {advanced}
        </Section>
      </div>
    </>
  )
}

function Section({
  id,
  title,
  description,
  children,
  open,
  onOpenChange,
}: {
  id: PanelSection
  title: string
  description: string
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { t } = useI18n()
  const collapsible = open !== undefined
  return (
    <section
      id={`task-settings-${id}`}
      data-section={id}
      tabIndex={-1}
      aria-labelledby={`task-settings-${id}-title`}
      className="scroll-mt-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="mb-2 flex items-start gap-2">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`task-settings-${id}-body`}
            onClick={() => onOpenChange?.(!open)}
            className="flex min-w-0 flex-1 items-center gap-1 text-left"
          >
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                'size-3.5 shrink-0 text-soft-foreground transition-transform',
                !open && '-rotate-90',
              )}
            />
            <span id={`task-settings-${id}-title`} className="text-xs font-semibold text-foreground">
              {t(title)}
            </span>
          </button>
        ) : (
          <span id={`task-settings-${id}-title`} className="text-xs font-semibold text-foreground">
            {t(title)}
          </span>
        )}
      </div>
      {collapsible && !open ? null : (
        <div id={`task-settings-${id}-body`} className="flex flex-col gap-3">
          <p className="text-[11px] leading-snug text-soft-foreground">{t(description)}</p>
          {children}
        </div>
      )}
    </section>
  )
}

function PresetList({
  presets,
  selectedPresetId,
  modified,
  disabled,
  onApply,
  onSave,
  onRename,
  onDelete,
}: {
  presets: readonly TaskPreset[]
  selectedPresetId: string | null
  modified: boolean
  disabled?: boolean
  onApply: (preset: TaskPreset) => void
  onSave: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}) {
  const { t } = useI18n()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const inputId = useId()

  const save = () => {
    if (name.trim() === '') return
    onSave(name.trim())
    setName('')
    setSaving(false)
  }

  return (
    <div className="flex flex-col gap-2">
      {presets.map((preset) => {
        const selected = preset.id === selectedPresetId
        const readOnly = preset.origin !== 'user'
        return (
          <div
            key={preset.id}
            data-slot="task-preset"
            data-preset-id={preset.id}
            data-selected={selected ? 'true' : 'false'}
            className={cn(
              'rounded-lg border px-2.5 py-2 transition-colors',
              selected ? 'border-primary/60 bg-primary/[0.06]' : 'border-border bg-background',
            )}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={disabled || preset.unavailableReason !== undefined}
                title={preset.unavailableReason}
                aria-pressed={selected}
                onClick={() => onApply(preset)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {selected ? (
                  <CheckIcon aria-hidden="true" className="size-3 shrink-0 text-primary" />
                ) : (
                  <span aria-hidden="true" className="size-3 shrink-0" />
                )}
                <span className="truncate">
                  {selected ? presetDisplayName(preset, modified) : preset.name}
                </span>
                {readOnly ? (
                  <span className="shrink-0 rounded border border-border px-1 text-[10px] font-normal text-soft-foreground">
                    {preset.origin === 'builtin' ? t('Built-in') : t('Manager–Worker preset')}
                  </span>
                ) : null}
              </button>
              {selected && modified ? (
                <button
                  type="button"
                  data-slot="restore-task-preset"
                  title={t('Discard these changes and use the preset again')}
                  onClick={() => onApply(preset)}
                  className="shrink-0 rounded px-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t('Restore')}
                </button>
              ) : null}
              {preset.origin === 'user' ? (
                <span className="flex shrink-0 items-center">
                  <button
                    type="button"
                    aria-label={t('Rename {name}', { name: preset.name })}
                    title={t('Rename preset')}
                    onClick={() => {
                      setEditingId(preset.id)
                      setEditName(preset.name)
                      setDeletingId(null)
                    }}
                    className="inline-flex size-7 items-center justify-center rounded-md text-soft-foreground hover:bg-muted hover:text-foreground"
                  >
                    <PencilIcon aria-hidden="true" className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('Delete {name}', { name: preset.name })}
                    title={t('Delete preset')}
                    onClick={() => setDeletingId(preset.id)}
                    className="inline-flex size-7 items-center justify-center rounded-md text-soft-foreground hover:bg-muted hover:text-danger"
                  >
                    <Trash2Icon aria-hidden="true" className="size-3.5" />
                  </button>
                </span>
              ) : null}
            </div>
            {editingId === preset.id ? (
              <div className="mt-2 flex items-center gap-1.5">
                <Input
                  aria-label={t('Preset name')}
                  value={editName}
                  maxLength={80}
                  onChange={(event) => setEditName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      onRename(preset.id, editName)
                      setEditingId(null)
                    }
                    if (event.key === 'Escape') setEditingId(null)
                  }}
                  className="h-7 text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={editName.trim() === ''}
                  onClick={() => {
                    onRename(preset.id, editName)
                    setEditingId(null)
                  }}
                >
                  {t('Save')}
                </Button>
              </div>
            ) : null}
            {deletingId === preset.id ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>{t('Delete “{name}”?', { name: preset.name })}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-slot="confirm-delete-preset"
                  onClick={() => {
                    onDelete(preset.id)
                    setDeletingId(null)
                  }}
                >
                  {t('Delete')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setDeletingId(null)}>
                  {t('Cancel')}
                </Button>
              </div>
            ) : null}
          </div>
        )
      })}

      {saving ? (
        <div className="flex items-center gap-1.5">
          <label htmlFor={inputId} className="sr-only">
            {t('Preset name')}
          </label>
          <Input
            id={inputId}
            aria-label={t('Preset name')}
            placeholder={t('Name this preset…')}
            value={name}
            maxLength={80}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save()
              if (event.key === 'Escape') setSaving(false)
            }}
            className="h-7 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-slot="save-task-preset"
            disabled={disabled || name.trim() === ''}
            onClick={save}
          >
            <SaveIcon aria-hidden="true" className="size-3.5" />
            {t('Save')}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-slot="new-task-preset"
          disabled={disabled}
          onClick={() => setSaving(true)}
          className="self-start"
        >
          <PlusIcon aria-hidden="true" className="size-3.5" />
          {t('Save current as preset')}
        </Button>
      )}
    </div>
  )
}
