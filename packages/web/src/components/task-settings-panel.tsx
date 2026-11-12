import {
  BookmarkIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  GaugeIcon,
  GitBranchIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
  WrenchIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogDim, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/lib/i18n'
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
 * one wide panel that opens under the composer, from the summary line's settings control.
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
  /** Overwrite a user preset with the settings as they are now. */
  onUpdatePreset?: (id: string) => void
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
  if (!props.open) return null

  // A large modal (it was an inline panel under the composer, too short to work in): the title and
  // the footer stay put, the body scrolls, and a left rail jumps between the groups.
  return (
    // Non-modal on purpose: Radix's modal mode hides the rest of the page from assistive tech, but
    // the prompt and Start stay live behind this surface. The dim layer is drawn here; Radix still
    // closes on Escape. A press outside is NOT left to Radix: popovers opened from inside the panel
    // render in portals, which Radix counts as "outside" and would close the panel under them.
    <Dialog open modal={false} onOpenChange={props.onOpenChange}>
      <DialogPortal>
        <DialogDim onClick={() => props.onOpenChange(false)} />
      </DialogPortal>
      <DialogContent
        data-slot="task-settings-panel"
        aria-label={t('Task settings')}
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        className="h-[min(86dvh,860px)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        <PanelBody {...props} />
      </DialogContent>
    </Dialog>
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

const SECTION_ICONS: Record<PanelSection, LucideIcon> = {
  presets: BookmarkIcon,
  who: BotIcon,
  where: GitBranchIcon,
  autonomy: GaugeIcon,
  skill: SparklesIcon,
  advanced: WrenchIcon,
}

function PanelBody({
  presets,
  selectedPresetId,
  modified,
  onApplyPreset,
  onSavePreset,
  onUpdatePreset,
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
}: TaskSettingsPanelProps) {
  const { t } = useI18n()
  // Everything is visible at once except Advanced, which is the long tail.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // A summary click both opens the panel (the route does that) and scrolls here.
  useEffect(() => {
    if (!focusSection) return
    if (focusSection.section === 'advanced') setAdvancedOpen(true)
    const id = window.setTimeout(() => {
      const target = bodyRef.current?.querySelector<HTMLElement>(
        `[data-section="${focusSection.section}"]`,
      )
      if (!target) return
      target.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
      // Presets is the plain "open the panel" target: moving focus there would pull it out of the
      // prompt (or the Start button) the user is on.
      if (focusSection.section !== 'presets') target.focus?.({ preventScroll: true })
    }, 0)
    return () => window.clearTimeout(id)
  }, [focusSection])

  const sections: readonly PanelSection[] = ['presets', 'who', 'where', 'autonomy', 'skill', 'advanced']
  // The rail marks the group at the top of the body, so it answers "where am I" while scrolling.
  // Where IntersectionObserver is missing (jsdom) it simply stays on the last jump.
  const [activeSection, setActiveSection] = useState<PanelSection>('presets')
  useEffect(() => {
    const body = bodyRef.current
    if (!body || typeof IntersectionObserver === 'undefined') return
    const visible = new Set<PanelSection>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.section as PanelSection
          if (entry.isIntersecting) visible.add(id)
          else visible.delete(id)
        }
        const first = sections.find((section) => visible.has(section))
        if (first) setActiveSection(first)
      },
      { root: body, rootMargin: '0px 0px -55% 0px' },
    )
    body.querySelectorAll<HTMLElement>('[data-section]').forEach((node) => observer.observe(node))
    return () => observer.disconnect()
    // `sections` is a constant list; the body's sections do not change identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advancedOpen])
  const jump = (section: PanelSection) => {
    if (section === 'advanced') setAdvancedOpen(true)
    setActiveSection(section)
    const target = bodyRef.current?.querySelector<HTMLElement>(`[data-section="${section}"]`)
    target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }

  return (
    <>
      <header
        data-slot="task-settings-header"
        className="flex shrink-0 items-center gap-2 border-b border-border px-6 py-3"
      >
        <SlidersHorizontalIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
        <DialogTitle className="min-w-0 flex-1 text-sm">{t('Task settings')}</DialogTitle>
        <DialogDescription className="sr-only">{t('Choose how this task runs.')}</DialogDescription>
        <button
          type="button"
          data-slot="task-settings-collapse"
          aria-label={t('Collapse task settings')}
          title={t('Collapse task settings')}
          onClick={() => onOpenChange(false)}
          className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon aria-hidden="true" className="size-4" />
        </button>
      </header>
      <div className="grid min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[11rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
        {/* A chip strip across the top on a phone, a rail down the side from `md`: the same
            jump list either way, so a 1800px-tall body on a phone is no longer one long scroll. */}
        <nav
          data-slot="task-settings-nav"
          aria-label={t('Task settings sections')}
          className="flex gap-1 overflow-x-auto border-b border-border p-2 md:flex-col md:gap-0.5 md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0 md:p-3"
        >
          {sections.map((section) => {
            const Icon = SECTION_ICONS[section]
            const current = section === activeSection
            return (
              <button
                key={section}
                type="button"
                data-slot={`task-settings-nav-${section}`}
                aria-label={t('Go to {section}', { section: t(sectionLabel(section)) })}
                aria-current={current ? 'true' : undefined}
                onClick={() => jump(section)}
                className={cn(
                  'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors md:whitespace-normal',
                  current
                    ? 'bg-primary/10 font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon aria-hidden="true" className={cn('size-4 shrink-0', current && 'text-primary')} />
                {t(sectionLabel(section))}
              </button>
            )
          })}
        </nav>
      {/* Layout system, one place: 4px grid, 24px between groups and around the body, 32px controls
          (the composer's 26px pills grow here only), 8px control radius, 12px card radius. The
          container query is the body's own width, so the same markup is one column on a phone. */}
      <div
        ref={bodyRef}
        data-slot="task-settings-body"
        className="@container flex min-h-0 flex-col gap-6 overflow-y-auto overscroll-contain p-6 [&_button.rounded-full:not([role=switch])]:h-8 [&_button.rounded-full:not([role=switch])]:rounded-lg"
      >
        <Section id="presets" title="Presets" description="Start from a saved way of working.">
          <PresetList
            presets={presets}
            selectedPresetId={selectedPresetId}
            modified={modified}
            disabled={presetsDisabled}
            onApply={onApplyPreset}
            onSave={onSavePreset}
            onUpdate={onUpdatePreset}
            onRename={onRenamePreset}
            onDelete={onDeletePreset}
          />
        </Section>
        <Section id="who" title="Who works" description="One agent, or a manager that hands parts to the workers you list.">
          {who}
        </Section>
        {/* One card for how the run is shaped; each group is a settings row inside it. */}
        <div
          data-slot="run-settings"
          className="divide-y divide-border rounded-xl border border-border bg-background/40 px-4"
        >
          <Section id="where" variant="row" title="Where it runs" description="An isolated worktree, or your checkout directly.">
            {where}
          </Section>
          <Section id="autonomy" variant="row" title="Autonomy & limits" description="Whether it pauses, and what it may spend.">
            {autonomy}
          </Section>
          <Section id="skill" variant="row" title="Skill" description="The skill or workflow this task runs.">
            {skill}
          </Section>
        </div>
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
      </div>
      <footer data-slot="task-settings-footer" className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-6 py-3">
        <p className="text-xs text-soft-foreground">{t('Changes apply to this task as you make them.')}</p>
        <Button type="button" size="sm" data-slot="task-settings-done" onClick={() => onOpenChange(false)}>
          {t('Close')}
        </Button>
      </footer>
    </>
  )
}

/**
 * One group of settings. `card` is a bordered block (one layer, never nested); `row` is a line
 * inside the run-settings card: title and note on the left, the controls on the right, stacked on
 * a narrow body. Only Advanced folds, and its whole header row is the fold control.
 */
function Section({
  id,
  title,
  description,
  children,
  open,
  onOpenChange,
  variant = 'card',
}: {
  id: PanelSection
  title: string
  description: string
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  variant?: 'card' | 'row'
}) {
  const { t } = useI18n()
  const Icon = SECTION_ICONS[id]
  const collapsible = open !== undefined
  const heading = (
    <>
      <Icon aria-hidden="true" className="size-4 shrink-0 text-soft-foreground" />
      <span id={`task-settings-${id}-title`} className="text-sm font-semibold text-foreground">
        {t(title)}
      </span>
    </>
  )
  const note = <p className="text-xs leading-snug text-soft-foreground">{t(description)}</p>

  if (variant === 'row') {
    return (
      <section
        id={`task-settings-${id}`}
        data-section={id}
        tabIndex={-1}
        aria-labelledby={`task-settings-${id}-title`}
        className="scroll-mt-2 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div className="grid gap-x-6 gap-y-3 @xl:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">{heading}</div>
            {note}
          </div>
          <div id={`task-settings-${id}-body`} className="flex min-w-0 flex-col gap-3">
            {children}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section
      id={`task-settings-${id}`}
      data-section={id}
      tabIndex={-1}
      aria-labelledby={`task-settings-${id}-title`}
      className="scroll-mt-2 rounded-xl border border-border bg-background/40 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`task-settings-${id}-body`}
          onClick={() => onOpenChange?.(!open)}
          className="-m-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-muted/50"
        >
          {heading}
          <ChevronDownIcon
            aria-hidden="true"
            className={cn('ml-auto size-4 shrink-0 text-soft-foreground transition-transform', !open && '-rotate-90')}
          />
        </button>
      ) : (
        <div className="flex items-center gap-2">{heading}</div>
      )}
      {collapsible && !open ? null : (
        <div id={`task-settings-${id}-body`} className="mt-3 flex flex-col gap-3">
          {note}
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
  onUpdate,
  onRename,
  onDelete,
}: {
  presets: readonly TaskPreset[]
  selectedPresetId: string | null
  modified: boolean
  disabled?: boolean
  onApply: (preset: TaskPreset) => void
  onSave: (name: string) => void
  onUpdate?: (id: string) => void
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

  const changed = modified ? presets.find((preset) => preset.id === selectedPresetId) : undefined

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 @xl:grid-cols-2">
      {changed ? (
        <div
          data-slot="preset-modified-bar"
          role="status"
          className="col-span-full flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2 text-xs"
        >
          <span className="min-w-0 flex-1 text-muted-foreground">
            {t('You changed “{name}”. Keep the changes in the preset, or save them as a new one.', { name: changed.name })}
          </span>
          {changed.origin === 'user' && onUpdate ? (
            <Button
              type="button"
              size="sm"
              data-slot="update-task-preset"
              disabled={disabled}
              onClick={() => onUpdate(changed.id)}
            >
              <SaveIcon aria-hidden="true" className="size-3.5" />
              {t('Update preset')}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-slot="save-as-new-task-preset"
            disabled={disabled}
            onClick={() => {
              setName(changed.origin === 'user' ? `${changed.name} (2)` : `${changed.name} (custom)`)
              setSaving(true)
            }}
          >
            {t('Save as new')}
          </Button>
        </div>
      ) : null}
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
              'flex flex-col justify-center rounded-lg border px-3 py-2 transition-colors',
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
                  className="shrink-0 rounded px-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
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
            {preset.unavailableReason !== undefined ? (
              <p data-slot="preset-unavailable" title={preset.unavailableReason} className="mt-1 truncate pl-[18px] text-xs text-soft-foreground">
                {preset.unavailableReason}
              </p>
            ) : null}
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
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
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
        <div className="flex items-center gap-2 col-span-full">
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
        // A dashed tile in the grid, same footprint as a preset: "add one more" reads as part of the
        // list instead of a stray button floating at the right edge.
        <button
          type="button"
          data-slot="new-task-preset"
          disabled={disabled}
          onClick={() => setSaving(true)}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/[0.04] hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <PlusIcon aria-hidden="true" className="size-3.5" />
          {t('Save current as preset')}
        </button>
      )}
    </div>
  )
}
