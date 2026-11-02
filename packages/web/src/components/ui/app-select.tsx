import * as React from 'react'

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

export interface AppSelectProps
  extends Omit<React.ComponentProps<'button'>, 'value' | 'defaultValue' | 'onChange' | 'children' | 'type'> {
  value?: string | number
  defaultValue?: string | number
  onChange?: (event: AppSelectChangeEvent) => void
  name?: string
  children?: React.ReactNode
}

function AppSelect({ value, defaultValue, onChange, name, disabled, className, children, ...rest }: AppSelectProps) {
  const [inner, setInner] = React.useState(defaultValue === undefined ? '' : String(defaultValue))
  const current = value === undefined ? inner : String(value)
  const entries = parse(children)

  const renderOption = (option: ParsedOption) => (
    <SelectItem key={option.value} value={toRadix(option.value)} disabled={option.disabled} data-value={option.value}>
      {option.label}
    </SelectItem>
  )

  return (
    <Select
      value={toRadix(current)}
      disabled={disabled}
      {...(name ? { name } : {})}
      onValueChange={(next) => {
        const mapped = fromRadix(next)
        if (value === undefined) setInner(mapped)
        const target = { value: mapped, ...(name ? { name } : {}) }
        onChange?.({ target, currentTarget: target })
      }}
    >
      <SelectTrigger
        size="sm"
        data-slot="app-select"
        data-value={current}
        className={cn('max-w-full min-w-0', className)}
        {...rest}
      >
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

export { AppSelect }
