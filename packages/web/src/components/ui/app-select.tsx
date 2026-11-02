import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import * as React from 'react'

import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/lib/i18n'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/**
 * The app's one dropdown: a Radix Select drawn by the app (trigger, arrow, hover/focus, list), not
 * the operating system's. It keeps the `<select>` calling convention — `<option>` / `<optgroup>`
 * children, `value`, `onChange(event.target.value)`, `disabled` — so call sites read as before,
 * while keyboard (arrows, Enter, Esc, type-ahead) comes from Radix.
 *
 * Radix forbids an empty-string item value, which a "no choice" option legitimately is; it travels
 * as a sentinel and is mapped back in both directions.
 */
const EMPTY = '__app-select-empty__'
const toRadix = (value: string) => (value === '' ? EMPTY : value)
const fromRadix = (value: string) => (value === EMPTY ? '' : value)

export interface AppSelectChangeEvent {
  target: { value: string; name?: string }
  currentTarget: { value: string; name?: string }
}

interface ParsedOption {
  value: string
  label: React.ReactNode
  disabled: boolean
}
type ParsedEntry = { kind: 'option'; option: ParsedOption } | { kind: 'group'; label: string; options: ParsedOption[] }

function parse(children: React.ReactNode): ParsedEntry[] {
  const entries: ParsedEntry[] = []
  const visit = (nodes: React.ReactNode) => {
    React.Children.forEach(nodes, (node) => {
      if (!React.isValidElement(node)) return
      const props = node.props as { value?: unknown; children?: React.ReactNode; disabled?: boolean; label?: string }
      if (node.type === React.Fragment) visit(props.children)
      else if (node.type === 'option') {
        const label = props.children
        entries.push({
          kind: 'option',
          option: { value: props.value === undefined ? textOf(label) : String(props.value), label, disabled: Boolean(props.disabled) },
        })
      } else if (node.type === 'optgroup') {
        const inner = parse(props.children)
        entries.push({
          kind: 'group',
          label: props.label ?? '',
          options: inner.flatMap((entry) => (entry.kind === 'option' ? [entry.option] : [])),
        })
      }
    })
  }
  visit(children)
  return entries
}

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children)
  return ''
}

/** From this many options a list gets a search box (override with `searchable`). */
export const APP_SELECT_SEARCH_THRESHOLD = 8

/** Case- and accent-insensitive: "claude" finds "Claude", "dinh" finds "đình". */
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase()
const matches = (value: string, search: string, keywords?: string[]) =>
  fold(`${value} ${(keywords ?? []).join(' ')}`).includes(fold(search.trim())) ? 1 : 0

export interface AppSelectProps
  extends Omit<React.ComponentProps<'button'>, 'value' | 'defaultValue' | 'onChange' | 'children' | 'type'> {
  value?: string | number
  defaultValue?: string | number
  onChange?: (event: AppSelectChangeEvent) => void
  name?: string
  /** Force the search box on or off; by default it appears for long lists (models). */
  searchable?: boolean
  children?: React.ReactNode
}

// The trigger is a flex row on purpose and `flex!` wins over a caller's `block`: with `block` the
// arrow icon dropped under the text (the bug this fixes at the source, for every call site).
const TRIGGER_LAYOUT = 'flex! items-center justify-between gap-2 max-w-full min-w-0'

function AppSelect({ value, defaultValue, onChange, name, searchable, disabled, className, children, ...rest }: AppSelectProps) {
  const [inner, setInner] = React.useState(defaultValue === undefined ? '' : String(defaultValue))
  const current = value === undefined ? inner : String(value)
  const entries = parse(children)
  const all = entries.flatMap((entry) => (entry.kind === 'option' ? [entry.option] : entry.options))
  const choose = (next: string) => {
    if (value === undefined) setInner(next)
    const target = { value: next, ...(name ? { name } : {}) }
    onChange?.({ target, currentTarget: target })
  }
  if (searchable ?? all.length >= APP_SELECT_SEARCH_THRESHOLD) {
    return <SearchableSelect all={all} entries={entries} current={current} choose={choose} disabled={disabled} className={className} rest={rest} />
  }

  const renderOption = (option: ParsedOption) => (
    <SelectItem key={option.value} value={toRadix(option.value)} disabled={option.disabled} data-value={option.value}>
      {option.label}
    </SelectItem>
  )

  return (
    <Select value={toRadix(current)} disabled={disabled} {...(name ? { name } : {})} onValueChange={(next) => choose(fromRadix(next))}>
      <SelectTrigger size="sm" data-slot="app-select" data-value={current} className={cn(TRIGGER_LAYOUT, className)} {...rest}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {entries.map((entry, index) =>
          entry.kind === 'option' ? (
            renderOption(entry.option)
          ) : (
            <SelectGroup key={`group-${index}`}>
              <SelectLabel>{entry.label}</SelectLabel>
              {entry.options.map(renderOption)}
            </SelectGroup>
          ),
        )}
      </SelectContent>
    </Select>
  )
}

/** The long-list form: same trigger, a Popover holding a search box over the options (cmdk). */
function SearchableSelect({
  all,
  entries,
  current,
  choose,
  disabled,
  className,
  rest,
}: {
  all: ParsedOption[]
  entries: ParsedEntry[]
  current: string
  choose: (value: string) => void
  disabled: boolean | undefined
  className: string | undefined
  rest: Omit<AppSelectProps, 'value' | 'defaultValue' | 'onChange' | 'name' | 'searchable' | 'disabled' | 'className' | 'children'>
}) {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const selected = all.find((option) => option.value === current)
  const item = (option: ParsedOption) => (
    <CommandItem
      key={option.value}
      value={toRadix(option.value)}
      keywords={[textOf(option.label)]}
      disabled={option.disabled}
      data-value={option.value}
      onSelect={() => {
        choose(option.value)
        setOpen(false)
      }}
      className="flex items-center justify-between gap-2"
    >
      <span className="min-w-0 truncate">{option.label}</span>
      {option.value === current ? <CheckIcon className="size-4 shrink-0" /> : null}
    </CommandItem>
  )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          data-slot="app-select"
          data-searchable="true"
          data-value={current}
          disabled={disabled}
          className={cn(
            'rounded-md border border-input bg-card px-3 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 h-8 [&_svg]:pointer-events-none [&_svg]:shrink-0',
            TRIGGER_LAYOUT,
            className,
          )}
          {...rest}
        >
          <span className="min-w-0 flex-1 truncate text-left">{selected ? selected.label : null}</span>
          <ChevronDownIcon className="size-4 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-[14rem] p-0">
        <Command filter={matches}>
          <CommandInput placeholder={t('Search…')} />
          <CommandList>
            <CommandEmpty>{t('Nothing found')}</CommandEmpty>
            {entries.map((entry, index) =>
              entry.kind === 'option' ? (
                item(entry.option)
              ) : (
                <div key={`group-${index}`} role="group" aria-label={entry.label}>
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">{entry.label}</div>
                  {entry.options.map(item)}
                </div>
              ),
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { AppSelect }
