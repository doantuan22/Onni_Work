import { KeyboardIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import {
  altGrProblem,
  BINDABLE_COMMANDS,
  chordFromEvent,
  chordProblem,
  DEFAULT_KEYBINDINGS,
  formatChord,
  isApplePlatform,
} from '@/lib/keybindings'
import { useKeybindings } from '@/lib/use-keybindings'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Settings → Keyboard (spec 2026-10-17-task-palette): every task-palette command a shortcut can
 * run, its chord, and Record / Remove / Reset. The same overrides ⇧↵ in ⌘P writes. GLOBAL, like
 * Appearance — `~/.onni/ui-state.json`.
 */
export function KeyboardSection() {
  const { t } = useI18n()
  const keybindings = useKeybindings()
  const [recording, setRecording] = React.useState<string | null>(null)
  const [problem, setProblem] = React.useState<string | null>(null)
  const customized = Object.keys(keybindings.overrides).length > 0

  const groups = React.useMemo(() => {
    const byGroup = new Map<string, typeof BINDABLE_COMMANDS[number][]>()
    for (const entry of BINDABLE_COMMANDS) byGroup.set(entry.group, [...(byGroup.get(entry.group) ?? []), entry])
    // Bound from ⌘P to an id the catalog does not list (an Open in… target, a layout).
    const extra = Object.keys(keybindings.overrides)
      .filter((id) => !BINDABLE_COMMANDS.some((entry) => entry.id === id) && keybindings.overrides[id])
      .map((id) => ({ id, label: id.replace(/^[a-z-]+:/, ''), group: 'Other' }))
    if (extra.length > 0) byGroup.set('Other', extra)
    return [...byGroup]
  }, [keybindings.overrides])

  // While recording, the next chord anywhere on the page is the answer — captured before every
  // other shortcut listener so ⌘K or a bound chord cannot fire instead.
  React.useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent) => {
      // A bare Tab is leaving, not answering: focus moves on and recording ends.
      if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) return setRecording(null)
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'Escape') return setRecording(null)
      const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
      if (bare && (event.key === 'Backspace' || event.key === 'Delete')) {
        keybindings.assign(recording, null)
        return setRecording(null)
      }
      const chord = chordFromEvent(event)
      if (!chord) {
        const altGr = altGrProblem(event)
        if (altGr) setProblem(altGr)
        return
      }
      const refused = chordProblem(chord)
      if (refused) return setProblem(`${formatChord(chord)} — ${refused}`)
      const previous = [...keybindings.bindings].find(([id, held]) => held === chord && id !== recording)?.[0]
      keybindings.assign(recording, chord)
      if (previous) toast(t('{chord} moved from {previous} to {current}', { chord: formatChord(chord), previous: labelOf(previous), current: labelOf(recording) }))
      setRecording(null)
    }
    // A press anywhere but this row's chord button (whose click toggles) gives the keyboard back.
    const onPointerDown = (event: PointerEvent) => {
      const chordButton = event.target instanceof Element ? event.target.closest('[data-slot="shortcut-chord"]') : null
      if (chordButton?.closest<HTMLElement>('[data-command-id]')?.dataset.commandId === recording) return
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true })
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
    }
  }, [recording, keybindings])
  const apple = isApplePlatform()

  return (
    <div
      data-slot="keyboard-section"
      className="mx-auto flex w-full max-w-2xl flex-col gap-7 p-4 pb-[calc(90px+env(safe-area-inset-bottom))] md:p-6 md:pb-6"
    >
      <section className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t('Task shortcuts')}</h2>
            <p className="text-[13px] text-muted-foreground">
              {t('Run a task’s commands from the keyboard while the task is open. {palette} lists them all; press {setShortcut} on a row there to set its shortcut. {modifier} chords also work while you type.', { palette: formatChord('Mod+P'), setShortcut: apple ? '⇧↵' : 'Shift+Enter', modifier: apple ? '⌘' : 'Ctrl' })}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            data-action="reset-all-shortcuts"
            disabled={!customized || !keybindings.ready}
            onClick={keybindings.resetAll}
          >
            <RotateCcwIcon aria-hidden="true" /> {t('Reset all')}
          </Button>
        </div>
      </section>

      {groups.map(([group, entries]) => (
        <section key={group} className="flex flex-col gap-1">
          <h3 className="text-xs font-medium tracking-wide text-soft-foreground uppercase">{group}</h3>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {entries.map((entry) => {
              const chord = keybindings.bindings.get(entry.id)
              const isRecording = recording === entry.id
              const changed = entry.id in keybindings.overrides
              return (
                <li key={entry.id} data-slot="shortcut-row" data-command-id={entry.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm">{entry.label}</span>
                  {isRecording ? (
                    <span data-slot="shortcut-recording" className="text-xs text-primary">
                      {problem ?? t('Press keys… (esc cancels, ⌫ removes)')}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    data-slot="shortcut-chord"
                    aria-label={chord ? t('Change the shortcut for {command} ({chord})', { command: entry.label, chord: formatChord(chord) }) : t('Set a shortcut for {command}', { command: entry.label })}
                    disabled={!keybindings.ready}
                    onClick={() => {
                      setProblem(null)
                      setRecording(isRecording ? null : entry.id)
                    }}
                    onBlur={() => {
                      if (isRecording) setRecording(null)
                    }}
                    className={cn(
                      'min-w-16 rounded-[5px] border border-b-2 px-1.5 py-0.5 font-mono text-xs',
                      isRecording ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {chord ? formatChord(chord) : <KeyboardIcon aria-hidden="true" className="mx-auto size-3.5" />}
                  </button>
                  {changed ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('Reset {command} to {shortcut}', { command: entry.label, shortcut: DEFAULT_KEYBINDINGS[entry.id] ? formatChord(DEFAULT_KEYBINDINGS[entry.id]!) : t('no shortcut') })}
                      title={t('Reset to default')}
                      onClick={() => keybindings.reset(entry.id)}
                    >
                      <RotateCcwIcon aria-hidden="true" />
                    </Button>
                  ) : chord ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('Remove the shortcut for {command}', { command: entry.label })}
                      title={t('Remove')}
                      onClick={() => keybindings.assign(entry.id, null)}
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  ) : (
                    <span className="size-7 shrink-0" />
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function labelOf(id: string): string {
  return BINDABLE_COMMANDS.find((entry) => entry.id === id)?.label ?? id
}
