import { MonitorIcon, MoonIcon, SunIcon, UploadIcon } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { ComponentType, KeyboardEvent, ReactNode, SVGProps } from 'react'

import { useProjects, useWorkspaceConfig, workspaceQueryKeys } from '@/api/queries'
import type { WorkspaceConfigResponse } from '@onni/api-client'
import { deleteWorkspaceBrandingLogo, putWorkspaceConfig, uploadWorkspaceBrandingLogo } from '@/api/client'
import type { SetWorkspaceConfigInput } from '@onni/api-client'
import { useAppearance } from '@/components/appearance-provider'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Density, Width } from '@/lib/appearance'
import type { Theme } from '@/lib/theme'
import { useI18n, type Language } from '@/lib/i18n'
import { useProjectOrder } from '@/lib/use-project-order'
import { toast } from '@/components/ui/toaster'

/**
 * Settings → Appearance (R6 Step 1.3, spec §"Settings").
 *
 * Each knob is honest about where it persists:
 *  - THEME rides the existing theme system (localStorage `onni-theme`, shared with the legacy
 *    cockpit and the pre-paint script) — per-browser by design, like every OS theme choice;
 *  - DENSITY + READING WIDTH persist in `ui-state.json` through the AppearanceProvider (additive
 *    `appearance` key), mirrored to localStorage for pre-paint;
 *  - PROJECT ORDER (#952) lives in the same workspace file under `sidebar.projectOrder`, so this
 *    section only offers the reset — the order itself is set by dragging the drawer.
 *
 * Every control is a real one: density shrinks the Tailwind spacing token (see index.css).
 */

const THEME_OPTIONS: Array<{ value: Theme; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> }> = [
  { value: 'system', label: 'System', icon: MonitorIcon },
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
]

const DENSITY_OPTIONS: Array<{ value: Density; label: string }> = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
  { value: 'ultra', label: 'Compact for real' },
]

const WIDTH_OPTIONS: Array<{ value: Width; label: string }> = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'wide', label: 'Full' },
]

/** Language names stay in their own language in both modes — "Tiếng Việt" is how a Vietnamese
 *  speaker looks for it, and "English" is how everyone else does. */
const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'vi', label: 'Tiếng Việt' },
]

/** One segmented radio group — the shared chassis of all three controls. */
function Segmented<V extends string>({
  slot,
  label,
  value,
  options,
  onChange,
}: {
  slot: string
  label: string
  value: V
  options: Array<{ value: V; label: string; icon?: ComponentType<SVGProps<SVGSVGElement>>; swatch?: string }>
  onChange: (value: V) => void
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const offset = event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : 0
    if (offset === 0) return
    event.preventDefault()
    const nextIndex = (index + offset + options.length) % options.length
    const nextOption = options[nextIndex]
    if (!nextOption) return
    onChange(nextOption.value)
    document.querySelector<HTMLButtonElement>(`[data-slot="${slot}"] [data-value="${nextOption.value}"]`)?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-slot={slot}
      className="inline-flex w-fit gap-0.5 rounded-md border border-border bg-card p-0.5"
    >
      {options.map((option) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-value={option.value}
            onKeyDown={(event) => handleKeyDown(event, options.indexOf(option))}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center gap-2 rounded-sm px-3 py-1.5 text-[13px] font-medium transition-colors',
              checked
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.icon ? <option.icon aria-hidden="true" className="size-3.5" /> : null}
            {option.swatch ? (
              <span
                aria-hidden="true"
                className="size-3 rounded-full border border-border"
                style={{ background: option.swatch }}
              />
            ) : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function Field({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-[13px] text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  )
}

/** English or Vietnamese for this browser. Text produced by the server, a run or an agent keeps
 *  its original wording — this is a UI layer, not a translating proxy. */
function LanguageField() {
  const { language, setLanguage, t } = useI18n()
  return (
    <Field
      title={t('Language')}
      hint={t('Applies to this browser only. Server messages, run output and agent replies stay in English.')}
    >
      <Segmented
        slot="appearance-language"
        label={t('Language')}
        value={language}
        options={LANGUAGE_OPTIONS}
        onChange={setLanguage}
      />
    </Field>
  )
}

/**
 * The undo for a drawer reordered by hand (#952) — the drag itself lives in the sidebar, where
 * it belongs, but "put it back" needs a home that is not a gesture.
 *
 * Absent entirely until there is both more than one project and an order to forget: a reset
 * button for state the user has never created is a control that can only do nothing.
 */
function ProjectOrderField() {
  const { t } = useI18n()
  const projects = useProjects()
  const { order, canReorder, reset } = useProjectOrder()
  const multiProject = (projects.data?.projects.length ?? 0) > 1
  if (!multiProject || order.length === 0) return null

  return (
    <Field
      title={t('Project order')}
      hint={t('The sidebar is in the order you dragged it into. Reset puts it back to most-recently-opened first. Shared with every browser signed in to this onni.')}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-slot="appearance-project-order-reset"
        disabled={!canReorder}
        onClick={reset}
        className="w-fit"
      >
        {t('Reset order')}
      </Button>
    </Field>
  )
}

function BrandingFields() {
  const { t } = useI18n()
  const config = useWorkspaceConfig()
  const queryClient = useQueryClient()
  const logoInput = useRef<HTMLInputElement>(null)
  const [logoDraft, setLogoDraft] = useState<{ file: File; url: string } | null>(null)
  useEffect(() => () => { if (logoDraft) URL.revokeObjectURL(logoDraft.url) }, [logoDraft])
  const save = useMutation({
    mutationFn: (patch: SetWorkspaceConfigInput) => putWorkspaceConfig(patch),
    onSuccess: (result) => queryClient.setQueryData(workspaceQueryKeys.config, result),
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })
  const upload = useMutation({
    mutationFn: async (file: File | null) => {
      return file ? uploadWorkspaceBrandingLogo(file) : deleteWorkspaceBrandingLogo()
    },
    onSuccess: (logoUrl) => {
      const current = queryClient.getQueryData<WorkspaceConfigResponse>(workspaceQueryKeys.config)
      if (current) queryClient.setQueryData(workspaceQueryKeys.config, { ...current, branding: { ...current.branding, logoUrl } })
      setLogoDraft(null)
    },
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })
  const branding = config.data?.branding
  const [name, setName] = useState(branding?.name ?? 'onni')
  const [lastName, setLastName] = useState(branding?.name ?? 'onni')
  useEffect(() => {
    if (branding && name === lastName) {
      setName(branding.name)
      setLastName(branding.name)
    }
  }, [branding?.name])
  return <>
    <Field title={t('Instance name')} hint={t('Shown in the sidebar and browser tab across this workspace.')}>
      <div className="flex flex-wrap items-center gap-2">
        <input data-slot="branding-name" aria-label={t('Instance name')} maxLength={80} value={name} onChange={(event) => setName(event.currentTarget.value)}
          onBlur={() => {
            const value = name.trim()
            if (!value) { setName(branding?.name ?? 'onni'); return }
            if (value !== branding?.name) save.mutate({ branding: { name: value } })
            setLastName(value)
          }}
          className="h-9 w-64 rounded-md border border-border bg-background px-3 text-sm" />
        <Button type="button" variant="outline" size="sm" disabled={!branding || branding.name === 'onni' || save.isPending}
          onClick={() => save.mutate({ branding: { name: null } })}>{t('Reset name')}</Button>
      </div>
    </Field>
    <Field title={t('Logo')} hint={t('PNG, JPEG, WebP, GIF, AVIF, or safe SVG up to 2 MB. Stored on this machine and shared by its browsers.')}>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
        {logoDraft ? <img src={logoDraft.url} alt={t('Logo preview')} className="size-10 rounded-md border border-border bg-background object-contain p-1" /> : branding?.logoUrl ? <img src={branding.logoUrl} alt={t('Current instance logo')} className="size-10 rounded-md border border-border bg-background object-contain p-1" /> : <span aria-hidden="true" className="size-10 rounded-md border border-dashed border-border bg-background" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{logoDraft?.file.name ?? (branding?.logoUrl ? t('Current logo') : t('No logo selected'))}</p>
          <p className="text-xs text-muted-foreground">{t('Choose an image to preview it before saving.')}</p>
        </div>
        <input ref={logoInput} data-slot="branding-logo" aria-label={t('Upload logo')} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml" disabled={upload.isPending} hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) setLogoDraft({ file, url: URL.createObjectURL(file) })
            event.currentTarget.value = ''
          }} />
        <Button type="button" variant="outline" size="sm" disabled={!branding || upload.isPending} onClick={() => logoInput.current?.click()}>
          <UploadIcon aria-hidden="true" className="size-3.5" />
          {t('Choose logo')}
        </Button>
        {logoDraft ? <>
          <Button type="button" size="sm" disabled={upload.isPending} onClick={() => upload.mutate(logoDraft.file)}>{t('Save logo')}</Button>
          <Button type="button" variant="outline" size="sm" disabled={upload.isPending} onClick={() => setLogoDraft(null)}>{t('Cancel')}</Button>
        </> : branding?.logoUrl ? <Button type="button" variant="outline" size="sm" disabled={upload.isPending} onClick={() => upload.mutate(null)}>{t('Remove logo')}</Button> : null}
      </div>
    </Field>
  </>
}

export function AppearanceSection() {
  const { t } = useI18n()
  const { theme, setTheme } = useTheme()
  const { density, width, setDensity, setWidth } = useAppearance()
  const translateOptions = <O extends { label: string }>(options: O[]): O[] =>
    options.map((option) => ({ ...option, label: t(option.label) }))

  return (
    <div
      data-slot="appearance-section"
      className="mx-auto flex w-full max-w-2xl flex-col gap-7 p-4 pb-[calc(90px+env(safe-area-inset-bottom))] md:p-6 md:pb-6"
    >
      <BrandingFields />
      <LanguageField />
      <Field title={t('Theme')} hint={t('System follows your OS preference. Applies to this browser.')}>
        <Segmented slot="appearance-theme" label={t('Theme')} value={theme} options={translateOptions(THEME_OPTIONS)} onChange={setTheme} />
      </Field>

      <Field
        title={t('Density')}
        hint={t('Compact tightens spacing across the cockpit — text stays the same size.')}
      >
        <Segmented slot="appearance-density" label={t('Density')} value={density} options={translateOptions(DENSITY_OPTIONS)} onChange={setDensity} />
      </Field>

      <Field
        title={t('Reading width')}
        hint={t('Full gives task sessions, commits, and skill content the whole available area. Narrow keeps a comfortable reading column. The Changes tab is always full-width.')}
      >
        <Segmented slot="appearance-width" label={t('Reading width')} value={width} options={translateOptions(WIDTH_OPTIONS)} onChange={setWidth} />
      </Field>

      <ProjectOrderField />
    </div>
  )
}
