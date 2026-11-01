import { ManagerWorkerPill } from '@/components/manager-worker-pill'
import { requestFromDraft, type LimitsDraft } from '@/lib/run-limits'
import { previewSettingsKey, StartTimePicker, type StartChoice } from '@/components/start-time-picker'
import { ApiError, createDeferredStart, putWorkspaceConfig } from '@/api/client'
import {
  deferredCreateInputSchema,
  type ManagerPreset,
  type Roster,
  type TaskPreset as StoredTaskPreset,
} from '@onni/api-client'
import { markScheduledTasks } from '@/lib/scheduled-tasks-gate'
import { automationsQueryKey } from './automations/use-automations'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangleIcon,
  CheckIcon,
  Clock3Icon,
  FolderOpenIcon,
  InfoIcon,
  SparklesIcon,
  SquareIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link as GlobalLink, useParams, useSearchParams } from 'react-router'

import { Link, useNavigate } from '@/lib/project-router'

import { createRun, getLaunchKey, putConfig, putUiState } from '@/api/client'
import { useProjectScope } from '@/api/project-scope-context'
import { hasAccountChoice, useAgentAccounts, useSelectedAccountCheck } from '@/api/agent-accounts'
import {
  queryKeys,
  useConfig,
  useHealth,
  useProviderStatus,
  useProjects,
  useRepo,
  useRunnerModels,
  useSkills,
  useUiState,
  useWorkspaceConfig,
  useWorkflows,
  workspaceQueryKeys,
} from '@/api/queries'
import type {
  AttachmentEntry,
  DispatchIntent,
  DeferredCreateInput,
  ProjectListEntry,
  RepoResponse,
  Runner,
} from '@onni/api-client'
import { TwinkleBackdrop } from '@/components/centered-state'
import { Composer, type ComposerHandle } from '@/components/composer/composer'
import { DispatchToggle } from '@/components/dispatch-toggle'
import { GhostCodeBackdrop } from '@/components/ghost-code-backdrop'
import { LimitsPill } from '@/components/limits-pill'
import { PickerPill, RunnerPill, chevron, chipClass } from '@/components/picker-pill'
import { PromptTemplateMenu } from '@/components/prompt-template-menu'
import { SourcePill } from '@/components/source-pill'
import { TaskSettingsPanel, TaskSummary } from '@/components/task-settings-panel'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from '@/components/ui/toaster'
import {
  autoApplyText,
  availablePromptTemplates,
  normalizePromptTemplates,
  resolveAutoApply,
} from '@/lib/prompt-templates'
import {
  bumpSkillUsage,
  orderSkillsByUsage,
} from '@/lib/skills'
import { useI18n } from '@/lib/i18n'
import {
  AUTONOMY_NEEDS_WORKTREE,
  builtinTaskPresets,
  clampVariants,
  configuredWorktreeDefault,
  deleteTaskPreset,
  describeRunLimits,
  effectiveLimits,
  limitsDraftFromRequest,
  mergeManagerWorkerPresets,
  persistedLimits,
  renameTaskPreset,
  resolvePanelWorktree,
  saveTaskPreset,
  setAutonomous,
  setWorktreeMode,
  storedTaskPresets,
  taskSettingsEqual,
  taskSummarySegments,
  userTaskPresets,
  type PanelSection,
  type TaskPreset,
  type TaskSettingsSnapshot,
} from '@/lib/new-task-presets'
import { cn } from '@/lib/utils'
import { usableRunners } from '@/lib/provider-status'

import {
  bookmarkletRunBody,
  deepLinkToast,
  unknownSkillPrefillText,
  type DeepLinkNotice,
} from './new-task-autostart'
import {
  clearStartedDraft,
  autoLandsUnreviewed,
  composerRunModeNote,
  explicitWorktreeFor,
  handOffComposition,
  readAttachments,
  readDraft,
  resolveComposerRunMode,
  writeAttachments,
  writeDraft,
  type NewTaskDraft,
} from './new-task-draft'
import {
  buildCreateRunBody,
  modelsForRunner,
  modelCatalogStatus,
  pushRecentSource,
  resolveModel,
  resolveRunner,
  looksLikeQuestion,
  projectDefaultSource,
  resolveSource,
  startedRunPath,
  type TaskSource,
} from './new-task-form'
import { parseNewTaskParams } from './new-task-params'

// Keep recovery across route changes and reloads in this tab. Storage can be unavailable;
// the memory copy still protects navigation within the running cockpit.
const pendingSchedules = new Map<string, DeferredCreateInput>()
function scheduleRecoveryKey(projectId: string | null) {
  return `onni-pending-schedule:${projectId ?? 'default'}`
}
function readScheduleRecovery(key: string): DeferredCreateInput | null {
  const cached = pendingSchedules.get(key)
  if (cached) return cached
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    // Validate without replacing the wire body with schema defaults/transforms.
    if (deferredCreateInputSchema.safeParse(stored).success) return stored as DeferredCreateInput
  } catch { /* storage unavailable */ }
  return null
}
function saveScheduleRecovery(key: string, request: DeferredCreateInput | null) {
  if (request) pendingSchedules.set(key, request)
  else pendingSchedules.delete(key)
  try {
    if (request) sessionStorage.setItem(key, JSON.stringify(request))
    else sessionStorage.removeItem(key)
  } catch { /* memory still retains the frozen request */ }
}

/**
 * `/new` — the full-screen new-task hero (spec §"New task (full-screen, #386)"; visual
 * contract docs/mockups/new-task.html): centered composer card on the twinkle surface, the
 * picker pill row inside the card below the textarea, suggested-task ghost chips underneath.
 * This route also owns the saved-bookmarklet contract (spec 011, BACKWARD_COMPATIBILITY.md):
 * a full document load of `/new?skill=&ref=&auto=1&key=` auto-starts a run unattended when the
 * key matches `GET /api/launch-key`, and only prefills otherwise — `handleDeepLink()` in
 * web/app.js, verbatim (see new-task-autostart.ts for the verified semantics).
 */
export function NewTaskRoute() {
  const { t } = useI18n()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // The composer's project (multi-project spec, step 3.4). TWO ids, deliberately:
  //  - `urlProjectId` is what the URL names — always a real project, boot included. It is the
  //    pill's selected value and what a swap navigates away from.
  //  - `scope.projectId` is the API/cache scope, which is NULL for the boot project (the
  //    step-3.1 invariant). It keys the draft, so the boot project keeps the bare legacy
  //    storage key and a draft typed before this upgrade survives it.
  // Both are absent when this route renders outside a `/p/:projectId` prefix (a component
  // test), and everything below degrades to exactly the single-project behavior.
  const { projectId: urlProjectId } = useParams()
  const draftProjectId = useProjectScope().projectId
  const projects = useProjects()

  // The deep-link params, captured ONCE: the mount effect below strips them from the URL
  // (legacy's `history.replaceState` — the launch key must not survive in history or survive
  // a reload to re-trigger), so live search params would vanish under us.
  const [deepLink] = useState(() => parseNewTaskParams(search))

  const health = useHealth()
  const workflows = useWorkflows()
  const skills = useSkills()
  const repo = useRepo()
  const uiState = useUiState()
  // Settings → Agents runner/model policy for this project. `/api/health` is boot-bound and
  // cannot answer these per-project defaults when another project is active (#699).
  const config = useConfig()
  const workspaceConfig = useWorkspaceConfig()

  // The draft survives navigation (module store); explicit deep-link params beat it — a
  // pasted `/new?skill=&ref=` link states intent, a leftover draft only remembers it.
  const [draft, setDraft] = useState<NewTaskDraft>(() => {
    const stored = readDraft(draftProjectId)
    return {
      ...stored,
      ...(deepLink.ref !== '' ? { text: deepLink.ref } : {}),
      ...(deepLink.skill !== ''
        ? { source: { source: 'skill', ref: deepLink.skill } as TaskSource }
        : {}),
    }
  })
  useEffect(() => {
    writeDraft(draft, draftProjectId)
  }, [draft, draftProjectId])
  const update = (patch: Partial<NewTaskDraft>) =>
    setDraft((current) => ({ ...current, ...patch }))

  // The composer's attachments, controlled from here (#1018). `/new` used to leave them to the
  // composer's own uncontrolled state, which meant a pasted screenshot lived only as long as the
  // component — and swapping the project pill REMOUNTS this route (`NewTaskProjectRoute` keys on
  // the id), so the picture vanished with the prompt. The store behind this is in-memory and
  // per-project: multi-MB base64 still has no business in localStorage, but surviving a scope
  // swap costs nothing.
  const [images, setImages] = useState(() => readAttachments(draftProjectId))
  useEffect(() => {
    writeAttachments(images, draftProjectId)
  }, [images, draftProjectId])

  // ---- effective picker values (rules in new-task-form.ts, mirrored from legacy) -----------
  const recentSources = uiState.data?.recentSources
  // Memoized so the picker gets a STABLE array identity across renders that don't actually
  // change the catalog or the usage stats (#408 — a raw `orderSkillsByUsage(...)` call here
  // would create a new array on EVERY render, including ones unrelated to skills/usage).
  const skillsData = skills.data
  const skillUsage = uiState.data?.skillUsage
  const skillList = useMemo(
    () => orderSkillsByUsage(skillsData ?? [], skillUsage),
    [skillsData, skillUsage],
  )
  const workflowList = workflows.data?.workflows ?? []
  // The registry the project pill offers. Empty while it loads or when it errors — the pill
  // simply does not render, which is the honest state: there is no second project to offer.
  const projectList = projects.data?.projects ?? []
  /**
   * A URL project id → the id the draft and attachment stores are keyed by.
   *
   * The boot project mounts UNSCOPED (the step-3.1 invariant), so its key is `null` — the same
   * rule `ProjectScopeRoute` applies on the way in. Resolved from the same `bootProject` field
   * both sides read, so the hand-off below cannot write the departing composition under a key
   * the arriving mount will not look at.
   */
  const scopeKeyOf = (id: string): string | null =>
    projects.data?.bootProject === id ? null : id
  // A catalog fetch that FAILED is settled, not loading: waiting on `data` alone left a remote
  // cockpit whose /skills or /workflows request errored saying "Still loading" forever (31eda062).
  const catalogFailed =
    (skills.isError && skills.data === undefined) || (workflows.isError && workflows.data === undefined)
  const sourcesReady = !skills.isPending && !workflows.isPending && !uiState.isPending
  // The draft's pick alone — a fresh `/new` selects nothing (see `resolveSource` for what the
  // persisted `lastTask` preselection was load-bearing for, and why it is gone).
  // Trunk-based projects (spec 2026-10-20-trunk-based-projects): an in-place project offers
  // the Ask chip, a trunk-based project asks on its own when the message is a question, and nothing
  // picked falls back to the project's default (or Ask) skill.
  const inPlaceByDefault = config.data?.taskWorkspace === 'in-place'
  const askOffered = repo.data?.info != null && (inPlaceByDefault || config.data?.profile === 'trunk')
  const askWanted =
    askOffered &&
    draft.variants <= 1 &&
    draft.dispatch === null &&
    (draft.readOnly ?? (config.data?.profile === 'trunk' && looksLikeQuestion(draft.text)))
  // Without a catalog the draft's pick cannot be checked here — send it and let the server judge,
  // rather than silently swapping the user's skill for quick-task.
  const source =
    (catalogFailed ? draft.source : resolveSource(draft.source, skillList, workflowList)) ??
    projectDefaultSource(config.data, askWanted, catalogFailed ? null : skillList)
  const selectedSkill = source?.source === 'skill'
    ? skillList.find((skill) => skill.name === source.ref)
    : undefined

  // ---- prompt templates (#413 follow-up) ----------------------------------------------------
  // The same list the GitHub hand-over and Inbox composers read. Two ways in here: the footer's
  // icon trigger inserts one by hand at the caret, and a skill whose templates are assigned to it
  // applies them on selection — but only into a box the user has not typed in (`resolveAutoApply`).
  const composerRef = useRef<ComposerHandle>(null)
  const templates = useMemo(
    () =>
      availablePromptTemplates(
        normalizePromptTemplates(uiState.data?.promptTemplates),
        health.data?.capabilities,
      ),
    [uiState.data?.promptTemplates, health.data?.capabilities],
  )
  const autoText = autoApplyText(templates, source?.source === 'skill' ? [source.ref] : [])
  const draftTextRef = useRef(draft.text)
  draftTextRef.current = draft.text
  const autoAppliedRef = useRef('')
  useEffect(() => {
    // Wait for the pickers' data: before it lands `source` is still a provisional guess, and
    // auto-applying against it would flash text in for a skill the user may not end up on.
    if (!sourcesReady) return
    const resolved = resolveAutoApply(draftTextRef.current, autoAppliedRef.current, autoText)
    autoAppliedRef.current = resolved.applied
    if (resolved.text !== draftTextRef.current) update({ text: resolved.text })
    // `autoText` is a derived STRING — this fires when the assigned set changes, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoText, sourcesReady])

  const providers = useProviderStatus()
  const runners = usableRunners(providers.data)
  const defaultRunner = config.data?.defaultRunner
  const preferredRunner = defaultRunner ?? 'claude'
  const runner = runners.length > 0 ? resolveRunner(draft.runner, runners, preferredRunner) : null
  const displayRunner = runner ?? preferredRunner
  const providersReady = providers.isSuccess && runners.length > 0
  const catalog = useRunnerModels(displayRunner)
  const modelsLocked = config.data?.modelsLocked === true
  const models = runner === null
    ? []
    : modelsForRunner(runner, catalog.data, [draft.model, config.data?.defaultModels?.[runner]])
  const model = runner === null
    ? ''
    : resolveModel(modelsLocked ? null : draft.model, runner, config.data?.defaultModels, catalog.data)
  // Agent accounts (spec 2026-07-29-agent-profiles). These are rows of the RUNNER pill rather than
  // a pill of their own — `claude · Default` / `claude · Klaudiusz` / `codex` — so what will run is
  // readable at a glance instead of assembled from two controls. An agent with a single login stays
  // a single row, which is why a host with no extra accounts sees the list it always saw.
  const { accounts: accountChoices, repoAccount } = useAgentAccounts()
  // A draft account belonging to ANOTHER runner is ignored rather than sent: switching runner must
  // not silently carry a foreign account along.
  const agentProfile = accountChoices.some(
    (choice) => choice.provider === displayRunner && choice.id === draft.agentProfile,
  )
    ? draft.agentProfile
    : null
  // The account this task will actually run on — what the server's gate judges (ac53a6ef).
  const accountCheck = useSelectedAccountCheck(displayRunner, agentProfile ?? repoAccount?.[displayRunner])

  // A cold /new load mounts the textarea disabled while provider status is checked. Restore
  // the route's autofocus contract once that check enables the form, but never steal focus if
  // the user already moved elsewhere while it was pending.
  const providersWereReady = useRef(false)
  useEffect(() => {
    const becameReady = providersReady && !providersWereReady.current
    providersWereReady.current = providersReady
    if (becameReady && document.activeElement === document.body) {
      document
        .querySelector<HTMLTextAreaElement>(`textarea[aria-label="${t('Describe a task for the agent')}"]`)
        ?.focus()
    }
  }, [providersReady])

  // Parallel variants need a worktree per variant, hence git (the server 409s without it).
  // Read it from the PROJECT-scoped `/repo` above, never from `/api/health.repo`: health is bound
  // to the boot folder, so booting outside a git repo hid the worktree controls for every
  // registered project (#791) — the same per-project sweep as #700 (forge) and #699 (runner
  // defaults). Loading still assumes git so the controls do not flicker.
  const hasGit = repo.data === undefined || repo.data.info !== null
  // The manager–worker switch as the user sees it. A switched-on draft can be incomplete (no
  // roster yet), so this is not just `draft.roster !== null`. A roster tree is one run with
  // children: the server drops the roster for parallel variants and forces its worktree.
  const [rosterMode, setRosterMode] = useState(() => (draft.roster ?? null) !== null)
  const variants = hasGit && !rosterMode ? draft.variants : 1

  // Worktree opt-out (#worktree-toggle): any ordinary run in a git repo may use the current
  // checkout. Parallel variants are the one hard constraint because each competing run needs
  // its own tree; a non-git repo already runs in place.
  const worktreeToggleShown = hasGit

  // Dispatch (spec 2026-09-10-dispatch): this task may fan work out to subtasks. Offered only
  // while the server has it on (`ONNI_DISPATCH=0` hides it — the routes 409 then) and in a git
  // repo: a child forks off the parent's committed branch, so there is nothing to fork without
  // one. A draft toggled on under a server that has since turned it off sends nothing.
  const dispatchAvailable = health.data?.capabilities.dispatch === true && hasGit
  const dispatch: DispatchIntent | null = dispatchAvailable ? draft.dispatch : null
  const dispatchOn = dispatch !== null
  // The hint line under the composer: up for 6 s after every change of the toggle or its
  // settings, and the whole time the settings surface is open.
  const [dispatchHintFlash, setDispatchHintFlash] = useState(false)
  // Per-run ceilings (docs/design/unattended-safety.md §2): Default / Unlimited / Custom. Only a
  // custom cap is written to the draft (`persistedLimits`): "unlimited" must be chosen again for
  // every task, never inherited from a draft restored a week later.
  const [limitsDraft, setLimitsDraft] = useState<LimitsDraft>(() =>
    limitsDraftFromRequest(draft.limits ?? { mode: 'default' }),
  )
  const limitsRequest = requestFromDraft(limitsDraft)
  const changeLimits = (next: LimitsDraft) => {
    setLimitsDraft(next)
    const request = requestFromDraft(next)
    update({ limits: request.ok ? persistedLimits(request.request) : undefined })
  }
  // The Manager–Worker roster is a way of working, so it sticks with the draft (null = off).
  const roster = draft.roster ?? null
  const changeRoster = (next: Roster | null) => update({ roster: next ?? undefined })
  const [dispatchSettingsOpen, setDispatchSettingsOpen] = useState(false)
  const dispatchHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const changeDispatch = (next: DispatchIntent | null) => {
    update({ dispatch: next })
    if (dispatchHintTimer.current !== null) clearTimeout(dispatchHintTimer.current)
    dispatchHintTimer.current = null
    setDispatchHintFlash(next !== null)
    if (next !== null) {
      dispatchHintTimer.current = setTimeout(() => setDispatchHintFlash(false), 6_000)
    }
  }
  useEffect(
    () => () => {
      if (dispatchHintTimer.current !== null) clearTimeout(dispatchHintTimer.current)
    },
    [],
  )

  // Worktree is forced by parallel variants (one tree per competing run) and by dispatch (the
  // server forces it too: subtasks fork off this task's commits).
  const worktreeForced = variants > 1 || dispatchOn || rosterMode

  // ---- Task settings panel (ADR 0008) -------------------------------------------------------
  // One wide panel under the composer. It starts folded and is never remembered: the summary
  // line already states the run mode, and a panel that re-opened itself would push the prompt.
  const [panelOpen, setPanelOpen] = useState(false)
  const [focusSection, setFocusSection] = useState<{ section: PanelSection; nonce: number } | null>(null)
  const focusNonce = useRef(0)
  const openSection = (section: PanelSection) => {
    setPanelOpen(true)
    setFocusSection({ section, nonce: (focusNonce.current += 1) })
  }

  // Presets: the built-ins are code, the user's live in the workspace config (a PUT replaces the
  // list), and legacy manager–worker presets stay readable beside them (never copied).
  const [storedOverride, setStoredOverride] = useState<StoredTaskPreset[] | null>(null)
  const storedPresets = storedOverride ?? workspaceConfig.data?.taskPresets ?? []
  const managerPresets = workspaceConfig.data?.managerWorker.presets ?? []
  const managerDefaultRoster = useMemo(() => {
    const id = workspaceConfig.data?.managerWorker.defaultPresetId
    return managerPresets.find((preset: ManagerPreset) => preset.id === id)?.roster ?? null
  }, [managerPresets, workspaceConfig.data?.managerWorker.defaultPresetId])
  const userPresets = useMemo(() => userTaskPresets(storedPresets), [storedPresets])
  const presets = useMemo(
    () =>
      mergeManagerWorkerPresets(
        [
          ...builtinTaskPresets({
            workspaceLimits: workspaceConfig.data?.limits,
            managerRoster: managerDefaultRoster,
          }),
          ...userPresets,
        ],
        managerPresets,
      ),
    [managerDefaultRoster, managerPresets, userPresets, workspaceConfig.data?.limits],
  )
  const savePresets = useMutation({
    mutationFn: (next: readonly TaskPreset[]) =>
      putWorkspaceConfig({ taskPresets: storedTaskPresets(next) }),
    onSuccess: (next) => {
      setStoredOverride(next.taskPresets)
      queryClient.setQueryData(workspaceQueryKeys.config, next)
    },
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })
  const commitPresets = (next: readonly TaskPreset[]) => savePresets.mutate(next)

  // Autonomous (#autonomous): the run never pauses for the user. An explicit toggle this session
  // wins; then an interactive skill recommends handing the ball back; otherwise the configured
  // workspace default applies ('source-dependent' → skills default ON, everything else OFF).
  const runMode = resolveComposerRunMode({
    hasGit,
    variants,
    explicitAutonomous: draft.autonomous,
    explicitWorktree: explicitWorktreeFor(draft, config.data?.taskWorkspace),
    interactive: selectedSkill?.interactive,
    configuredAutonomous: autoLandsUnreviewed(
      workspaceConfig.data?.composerDefaults?.autonomous
      ?? workspaceConfig.data?.composerDefaults?.inheritedAutonomous
      ?? 'source-dependent',
      config.data?.landing === 'auto',
    ),
    // Settings → Resources ("Use a worktree by default", default ON) or the project's
    // taskWorkspace; the safe default wins when neither has an opinion.
    configuredWorktree: configuredWorktreeDefault({
      taskWorkspace: config.data?.taskWorkspace,
      composerDefaults: workspaceConfig.data?.composerDefaults,
    }),
    // Nothing picked runs the plain built-in workflow, and the 'source-dependent' autonomy
    // default keys off exactly that: skills default autonomous, everything else does not.
    source: source?.source ?? 'workflow',
    dispatch: dispatchOn,
  })
  const askOn = askWanted && !dispatchOn && !rosterMode && variants <= 1
  // Autonomous without git cannot get the isolated worktree the panel requires, so it is not
  // offered there either — the run would edit a checkout while promising no pauses (ADR 0008).
  const autonomousOn = runMode.autonomous && hasGit
  // The PANEL is stricter than the engine-facing resolver: Autonomous pins the isolated worktree,
  // and a read-only Ask never runs in either mode (ADR 0008).
  const worktreeOn = resolvePanelWorktree(runMode.worktree || rosterMode, autonomousOn, hasGit) && !askOn

  // ---- presets ↔ live settings --------------------------------------------------------------
  // One snapshot the presets compare against, assembled from what the run will actually send.
  const limitRequest = limitsRequest.ok ? limitsRequest.request : ({ mode: 'default' } as const)
  const currentSettings: TaskSettingsSnapshot = {
    runner: draft.runner,
    model: draft.model,
    variants: clampVariants(variants),
    worktree: worktreeOn,
    newBranch: draft.newBranch === true,
    autonomous: autonomousOn,
    limits: limitRequest,
    roster,
  }
  // The applied preset lives on the draft, so "(modified)" survives a reload (ADR 0008).
  const [appliedPresetId, setAppliedPresetId] = useState<string | null>(() => draft.presetId ?? null)
  const selectedPreset = presets.find((preset) => preset.id === appliedPresetId) ?? null
  const presetModified =
    selectedPreset !== null && !taskSettingsEqual(currentSettings, selectedPreset.settings)
  const [worktreeError, setWorktreeError] = useState<string>()
  const selectPreset = (id: string | null) => {
    setAppliedPresetId(id)
    update({ presetId: id ?? undefined })
  }

  const applySettings = (settings: TaskSettingsSnapshot) => {
    setLimitsDraft(limitsDraftFromRequest(settings.limits))
    update({
      runner: settings.runner,
      model: settings.model,
      variants: settings.variants,
      worktree: hasGit && settings.worktree,
      worktreeBasis: config.data?.taskWorkspace ?? 'default',
      newBranch: settings.newBranch,
      autonomous: settings.autonomous,
      limits: persistedLimits(settings.limits),
      roster: settings.roster ?? undefined,
    })
    setWorktreeError(undefined)
  }
  const applyPreset = (preset: TaskPreset) => {
    if (preset.unavailableReason !== undefined) return
    applySettings(preset.settings)
    selectPreset(preset.id)
  }
  const changeAutonomous = (on: boolean) => {
    // Turning Autonomous on forces the isolated worktree in the same action (ADR 0008).
    const next = setAutonomous(currentSettings, on)
    setLimitsDraft(limitsDraftFromRequest(next.limits))
    update({
      autonomous: on,
      worktree: next.worktree,
      worktreeBasis: config.data?.taskWorkspace ?? 'default',
    })
    setWorktreeError(undefined)
  }
  const changeWorktree = (next: boolean) => {
    const result = setWorktreeMode(currentSettings, next, hasGit)
    setWorktreeError(result.error)
    if (result.error) return
    update({ worktree: next, worktreeBasis: config.data?.taskWorkspace ?? 'default' })
  }
  const saveCurrentPreset = (name: string) => {
    const next = saveTaskPreset(presets, name, currentSettings)
    const created = next.find((preset) => !presets.some((existing) => existing.id === preset.id))
    commitPresets(next)
    if (created) selectPreset(created.id)
  }
  const renamePreset = (id: string, name: string) => commitPresets(renameTaskPreset(presets, id, name))
  const removePreset = (id: string) => {
    commitPresets(deleteTaskPreset(presets, id))
    if (appliedPresetId === id) selectPreset(null)
  }

  // Follow-up generation (#444) is offered only while the server has the global inbox on
  // (#471, `ONNI_FOLLOWUPS=1`) — there is no inbox for the follow-ups to land in otherwise, and
  // the server pins the flag to false regardless, so a toggle would be a lie. Hidden, the value
  // is false, matching what the server will do. Health unknown → assume offered, the `hasGit`
  // rule above: the composer must not flicker its controls while health is in flight.
  const followupsToggleShown = health.data === undefined || health.data.capabilities.followups
  // Within an enabled server it stays opt-out: a draft choice wins, then the remembered UI
  // preference; absent state from older installs keeps the historical enabled behavior.
  const generateFollowupsOn = followupsToggleShown
    ? (draft.generateFollowups ?? uiState.data?.lastGenerateFollowups ?? true)
    : false

  // ---- bookmarklet deep-link (spec 011 — legacy handleDeepLink, verbatim) -------------------
  // `auto=1` with a ref arms the unattended start; the composer stays hidden behind a
  // "Starting…" surface until the key check + POST settle (or fail into the prefill path).
  const [autoStarting, setAutoStarting] = useState(() => deepLink.auto && deepLink.ref !== '')
  const [notice, setNotice] = useState<DeepLinkNotice | null>(() =>
    !deepLink.auto && deepLink.ref !== '' ? { kind: 'prefill' } : null,
  )
  const deepLinkUrlCleaned = useRef(false)
  const deepLinkHandled = useRef(false)
  useEffect(() => {
    if (deepLinkUrlCleaned.current) return
    deepLinkUrlCleaned.current = true
    // Legacy cleans the URL FIRST (`history.replaceState({}, '', '/')` — before anything
    // async): the launch key never lingers in the address bar or history, and a reload can
    // never re-trigger the start. Same move here, staying on this route. (The router's own
    // search, not window.location — MemoryRouter under test never touches the window.)
    if (search.toString() !== '') void navigate('/new', { replace: true })
    // mount-only: search is intentionally the initial URL, captured before the replace
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (deepLinkHandled.current) return
    if (!deepLink.auto || deepLink.ref === '') return
    if (providers.isPending) return
    if (scheduleRequest.current) {
      deepLinkHandled.current = true
      setAutoStarting(false)
      setNotice({ kind: 'prefill' })
      return
    }
    if (!providersReady || runner === null) {
      deepLinkHandled.current = true
      // Authentication could not be established: keep the deep-link intent in the disabled
      // composer and let the provider gate explain whether this is an error or missing setup.
      setNotice({ kind: 'prefill' })
      setAutoStarting(false)
      return
    }
    // Provider status often resolves before project config on a cold load. The protected
    // bookmarklet body may omit runner only against that scoped authoritative default, never
    // our display fallback; a failed config read degrades to the prefilled composer.
    if (config.isPending) return
    deepLinkHandled.current = true
    if (defaultRunner === undefined) {
      setNotice({ kind: 'prefill' })
      setAutoStarting(false)
      return
    }
    // A saved bookmarklet has no runner choice of its own: it implicitly targets the
    // project's configured default. `resolveRunner` deliberately falls back to another
    // connected runner for the editable composer, but that fallback must not turn an
    // unattended launch into a task on a different subscription (or hide an unauthorized
    // default behind a successful-looking start). Leave the prompt in the composer so the
    // user can explicitly choose what should run.
    if (runner !== defaultRunner) {
      setNotice({ kind: 'prefill' })
      setAutoStarting(false)
      return
    }
    void (async () => {
      let launchKey = ''
      try {
        launchKey = (await getLaunchKey()).key
      } catch {
        // key endpoint unreachable → the blocked path, exactly like legacy
      }
      if (launchKey !== '' && deepLink.key === launchKey) {
        try {
          const created = await createRun(bookmarkletRunBody(deepLink, runner, defaultRunner))
          clearStartedDraft(draftProjectId)
          void queryClient.invalidateQueries({ queryKey: queryKeys.runs.all })
          void navigate(startedRunPath(created))
          return
        } catch (error) {
          setNotice({
            kind: 'failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      } else {
        // Wrong or missing key: a drive-by page guessing the URL gets a form, never a run.
        setNotice({ kind: 'blocked' })
      }
      setAutoStarting(false)
    })()
  }, [config.isPending, defaultRunner, providers.isPending, providersReady, runner]) // eslint-disable-line react-hooks/exhaustive-deps
  // The prefill toast waits for the pickers' data: whether the skill exists decides the
  // wording, and the unknown-skill case rewrites the draft the way legacy did (intent into
  // the text, quick-task as the source — its planner resolves skills from prose).
  useEffect(() => {
    if (notice === null || !sourcesReady) return
    setNotice(null)
    const unknownSkill =
      deepLink.skill !== '' && !catalogFailed && !skillList.some((s) => s.name === deepLink.skill)
        ? deepLink.skill
        : ''
    if (unknownSkill !== '') {
      // Legacy put the intent into the text and ran quick-task; `null` IS that run now, and
      // needs no catalog lookup to say so.
      update({ text: unknownSkillPrefillText(deepLink.skill, deepLink.ref), source: null })
    }
    const { message, tone } = deepLinkToast(notice, unknownSkill)
    toast(message, { tone })
    // Legacy focused the Run button so a bare Enter submits the reviewed form.
    document
      .querySelector<HTMLButtonElement>(
        `[data-slot="composer"] button[aria-label="${t('Start task')}"]`,
      )
      ?.focus()
  }, [notice, sourcesReady]) // eslint-disable-line react-hooks/exhaustive-deps

  const [startChoice, setStartChoice] = useState<StartChoice | null>(null)
  const [scheduleBlocked, setScheduleBlocked] = useState<string>()
  const [scheduleLabel, setScheduleLabel] = useState<{ text: string; title: string }>()
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const recoveryKey = scheduleRecoveryKey(draftProjectId)
  const [scheduleRecovery, setScheduleRecovery] = useState(() => readScheduleRecovery(recoveryKey))
  const scheduleRequest = useRef<DeferredCreateInput | null>(scheduleRecovery)
  const [recovering, setRecovering] = useState(false)
  const [recoveryError, setRecoveryError] = useState<string>()
  const finishSchedule = async (scheduled: Awaited<ReturnType<typeof createDeferredStart>>['scheduled'], preserveDraft: boolean) => {
    saveScheduleRecovery(recoveryKey, null)
    markScheduledTasks()
    if (!preserveDraft) clearStartedDraft(draftProjectId)
    scheduleRequest.current = null
    setScheduleRecovery(null)
    await queryClient.invalidateQueries({ queryKey: automationsQueryKey() })
    if (scheduled.outcome === 'cancelled') toast(t('The original schedule was already cancelled.'))
    navigate(scheduled.outcome === 'launched' && scheduled.runIds[0] ? `/tasks/${scheduled.runIds[0]}` : '/')
  }
  const sendSchedule = async (request: DeferredCreateInput, preserveDraft = false) => {
    const wasAmbiguous = scheduleRequest.current !== null
    scheduleRequest.current = request
    saveScheduleRecovery(recoveryKey, request)
    let result: Awaited<ReturnType<typeof createDeferredStart>>
    try {
      result = await createDeferredStart(request)
    } catch (error) {
      // Only a definite first-attempt rejection releases the frozen intent.
      // A rejected replay cannot rule out an earlier accepted write.
      const rejected = !wasAmbiguous && error instanceof ApiError && (error.status === 400 ||
        (error.status === 409 && (error.message === 'Settings or reset time changed. Check the preview again.' ||
          error.message === 'Automations are off — this cockpit was started with ONNI_AUTOMATIONS=0')))
      if (rejected) {
        saveScheduleRecovery(recoveryKey, null)
        scheduleRequest.current = null
        setScheduleRecovery(null)
        setStartChoice(choice => choice ? { start: choice.start, invalidated: error.message } : choice)
      } else {
        setScheduleRecovery(request)
      }
      throw error
    }
    await finishSchedule(result.scheduled, preserveDraft)
  }
  const recoverSchedule = async () => {
    if (!scheduleRequest.current || recovering) return
    setRecovering(true)
    setRecoveryError(undefined)
    try {
      await sendSchedule(scheduleRequest.current, true)
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : String(error))
    } finally {
      setRecovering(false)
    }
  }
  // Trimmed on both sides: the composer submits the trimmed body, so the preview must match it.
  const taskBody = (text: string, submitted: AttachmentEntry[]) => {
    return buildCreateRunBody({
        task: text.trim(),
        source,
        model,
        modelsLocked,
        runner: runner ?? defaultRunner ?? 'claude',
        runnerExplicit: draft.runner !== null,
        agentProfile,
        defaultRunner,
        variants,
        images: submitted,
        worktree: worktreeOn,
        newBranch: draft.newBranch,
        branch: draft.branchName,
        autonomous: autonomousOn,
        ...(limitsRequest.ok ? { limits: limitsRequest.request } : {}),
        roster,
        generateFollowups: generateFollowupsOn,
        // #374: when the Inbox's "Run" sent us here, hand the entry's id back so the server
        // records this run on it and it leaves the inbox — the audit trail the old
        // POST /api/todos/:id/start kept, minus the blind launch. Empty otherwise.
        // Deliberately not gated on generateFollowupsOn (#444): turning off follow-up
        // generation for THIS task must not stop the entry it came from being marked started.
        todoId: deepLink.todo,
        dispatch,
        readOnly: askOn,
        inPlaceByDefault,
      })
  }
  const schedulingDisabledReason = images.length ? t('Remove attachments to schedule this task.') : deepLink.todo ? t('Tasks linked to a todo can only start now.') : health.data?.capabilities?.automations !== true ? t('Scheduling is disabled on this server.') : undefined
  const previewTask = taskBody(draft.text, images)
  const scheduleReady = !schedulingDisabledReason && !!startChoice?.preview && Date.parse(startChoice.preview.notBefore) > Date.now() && startChoice.settingsKey === previewSettingsKey(previewTask)
  const submit = async (text: string, submitted: AttachmentEntry[]) => {
    if (scheduleRequest.current) throw new Error(t('Recover the original schedule before starting another task.'))
    if (!providersReady || runner === null) {
      throw new Error(
        providers.isPending
          ? t('Checking agent providers…')
          : providers.isError
            ? t('Provider authentication could not be verified.')
            : t('Connect an agent provider before starting a task.'),
      )
    }
    if (accountCheck.blocked !== null) {
      const blocked = await accountCheck.verify()
      if (blocked !== null) throw new Error(blocked)
    }
    if (!sourcesReady) {
      // Rejection restores the draft — nothing typed is lost to a race with the pickers.
      throw new Error(t('Still loading workflows and skills — try again in a second.'))
    }
    const body = taskBody(text, submitted)
    if (startChoice) {
      if (schedulingDisabledReason || !startChoice.preview || Date.parse(startChoice.preview.notBefore) <= Date.now() || startChoice.settingsKey !== previewSettingsKey(body)) throw new Error(t('Check the start time again after changing the task settings.'))
      await sendSchedule({ task: body, start: startChoice.start, previewRevision: startChoice.preview.previewRevision, idempotencyKey: crypto.randomUUID() })
      return
    }
    const created = await createRun(body)
    // Remember what was actually run so the next visit preselects it (legacy
    // `saveLastTaskSource`) and float it to the top of the picker next time
    // (recency sort) — fire-and-forget: a failed write only costs the convenience.
    void putUiState({
      // `null` when nothing was picked — an honest record of a plain run, and the value that
      // stops an older cockpit (which still preselects `lastTask`) restoring a stale skill.
      lastTask: source,
      // Recency is a list of PICKS: a task that chose nothing did not pick quick-task, and
      // filling the list with the default would push real choices out of it.
      ...(source ? { recentSources: pushRecentSource(recentSources, source) } : {}),
      ...(followupsToggleShown ? { lastGenerateFollowups: generateFollowupsOn } : {}),
      // Frequency sort (#408): only a SKILL pick counts — the map is keyed by skill name, and a
      // workflow choice here doesn't select one directly. Gated on the CURRENT map being known:
      // the PUT merge is shallow, so bumping off an errored ui-state query (`sourcesReady` only
      // rules out `isPending`, not a failed fetch) would send a one-entry map and wipe every
      // accumulated count.
      ...(source?.source === 'skill' && uiState.data !== undefined
        ? { skillUsage: bumpSkillUsage(uiState.data.skillUsage, source.ref) }
        : {}),
    })
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.uiState }))
      .catch(() => {})
    clearStartedDraft(draftProjectId)
    void queryClient.invalidateQueries({ queryKey: queryKeys.runs.all })
    navigate(startedRunPath(created))
  }

  // The unattended bookmarklet start in flight: no composer, no params echoed anywhere —
  // just an honest "working on it" until the POST answers (success navigates to the thread;
  // failure drops back to the prefilled composer with a toast).
  if (autoStarting) {
    return (
      <div
        data-route="new"
        className="relative isolate flex min-h-full flex-col items-center justify-center overflow-x-clip px-6"
      >
        <TwinkleBackdrop />
        <div data-slot="auto-starting" role="status" className="text-center">
          <h1 className="animate-pulse text-lg font-semibold tracking-tight">{t('Starting task…')}</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">
            {t('Launched from a bookmarklet — taking you to the run.')}
          </p>
        </div>
      </div>
    )
  }

  const agentChoice =
    runners.length > 1 || runners.some((id) => hasAccountChoice(accountChoices, id))
  const effective = effectiveLimits(workspaceConfig.data?.limits, limitRequest)
  const summary = taskSummarySegments({
    agent: displayRunner,
    model: models.find((entry) => entry.id === model)?.label ?? t('auto'),
    hasGit,
    worktree: worktreeOn,
    newBranch: draft.newBranch === true,
    autonomous: autonomousOn,
    limitsMode: limitRequest.mode,
    managerWorkers: roster ? roster.workers.length : null,
    manager: roster?.manager ?? null,
    baseBranch: repo.data?.baseBranch ?? null,
    readOnly: askOn,
    askAuto: draft.readOnly === undefined,
  })

  return (
    <div
      data-route="new"
      className="relative isolate flex min-h-full flex-col items-center overflow-x-clip px-6 pt-[clamp(32px,7vh,84px)] pb-16 max-md:px-3.5 max-md:pt-7"
    >
      <TwinkleBackdrop />
      <GhostCodeBackdrop />

      <div
        data-slot="new-task-layout"
        className="flex w-full max-w-[1040px] flex-col items-center gap-5"
      >
        <div data-slot="new-task-main" className="w-full min-w-0 max-w-[760px]">
          <header className="mb-6 text-center max-md:mb-4">
            <h1 className="text-lg font-semibold tracking-tight max-md:text-base">
              {t('What should the agent work on?')}
            </h1>
            {/* Follows the resolved run mode (#793). Printing the isolation promise
                unconditionally made this line false for every run the user opted out of — and
                for a non-git folder, where there is no worktree to opt into. */}
            <p data-slot="run-mode-note" className="mt-1.5 text-[13.5px] text-muted-foreground max-md:text-xs">
              {t(composerRunModeNote({
                worktree: worktreeOn,
                hasGit,
                dispatch: dispatchOn,
                autonomous: autonomousOn,
                newBranch: draft.newBranch,
                readOnly: askOn,
                autoLand: config.data?.landing === 'auto' && config.data.landingBlocked === null,
              }))}
            </p>
          </header>

          {scheduleRecovery && (
            <div role="alert" className="mb-4 rounded-lg border p-4 text-sm">
              <p>{t('The original task may already be scheduled. Recover it before starting another task.')}</p>
              <p className="mt-2 whitespace-pre-wrap">{scheduleRecovery.task.task}</p>
              <p className="mt-2">{t('Recovery uses the original prompt, settings and start time. Your current edits will not be submitted. If scheduling is disabled, restore it on the server and retry recovery; the original request is kept to prevent duplicates. Once recovered, you can manage the task in Scheduled.')}</p>
              <button type="button" className="mt-3 underline" disabled={recovering} onClick={() => void recoverSchedule()}>
                {recovering ? t('Recovering original schedule…') : t('Recover original schedule')}
              </button>
            </div>
          )}
          {recoveryError && <p role="alert" className="mb-3 text-sm">{recoveryError}</p>}
          <Composer
            ref={composerRef}
            onSubmit={submit}
            value={draft.text}
            onValueChange={(text) => update({ text })}
            images={images}
            onImagesChange={setImages}
            autoFocus
            placeholder={t('Describe a task for the agent — / for skills…')}
            ariaLabel={t('Describe a task for the agent')}
            sendAriaLabel={startChoice ? t('Schedule task') : t('Start task')}
            sendLabel={startChoice ? t('Schedule task') : undefined}
            submitDisabled={!!scheduleRecovery || recovering || !sourcesReady || (!!startChoice && !scheduleReady)}
            disabled={!providersReady}
            disabledReason={
              providers.isPending
                ? t('Checking agent providers…')
                : providers.isError
                  ? t('Provider authentication could not be verified.')
                  : t('Connect an agent provider before starting a task.')
            }
            autocompleteSkills
            sendShortcut="↵"
            sendMenu={
              <StartTimePicker task={previewTask} value={startChoice} onChange={setStartChoice}
                disabledReason={schedulingDisabledReason} onBlockedChange={setScheduleBlocked}
                onLabelChange={setScheduleLabel} open={scheduleOpen} onOpenChange={setScheduleOpen} />
            }
            footerStart={
              projectList.length > 1 && urlProjectId !== undefined ? (
                <ProjectPill
                  projects={projectList}
                  projectId={urlProjectId}
                  // An explicit `/p/<id>` target: the scoped navigate wrapper passes already
                  // scoped paths through untouched, so this is a genuine cross-project jump.
                  onPick={(next) => {
                    // What is in the box comes along (#1018). Before the navigate, because the
                    // route remounts on the way in and reads the arriving project's draft the
                    // moment it does. `handOffComposition` decides whether the move happens —
                    // it refuses to overwrite an unsent draft already waiting over there.
                    const result = handOffComposition(draftProjectId, scopeKeyOf(next))
                    if (!result.moved && result.reason === 'destination-busy') {
                      // `draftProjectId` is the API scope key, so null means the boot project.
                      // Resolve both ends through the registry: the user needs to know where
                      // their composition remains as well as which destination was occupied.
                      const departingName =
                        projectList.find(
                          (project) => project.id === (draftProjectId ?? projects.data?.bootProject),
                        )?.name ?? urlProjectId
                      const destinationName = projectList.find((project) => project.id === next)?.name ?? next
                      toast(
                        t('Kept your draft in {departing}; {destination} already has an unsent draft.', {
                          departing: departingName,
                          destination: destinationName,
                        }),
                        { tone: 'danger' },
                      )
                    }
                    navigate(`/p/${encodeURIComponent(next)}/new`, { replace: true })
                  }}
                />
              ) : null
            }
            footerEnd={
              <>
                {startChoice && scheduleLabel && !scheduleBlocked ? (
                  <button type="button" data-slot="schedule-summary" title={scheduleLabel.title}
                    onClick={() => setScheduleOpen(true)}
                    className="flex max-w-[16rem] items-center gap-1 truncate rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Clock3Icon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">{scheduleLabel.text}</span>
                  </button>
                ) : null}
                {startChoice && scheduleBlocked ? (
                  <span role="status" data-slot="schedule-blocked" title={scheduleBlocked}
                    className="max-w-[16rem] truncate text-xs text-muted-foreground">
                    {scheduleBlocked}
                  </span>
                ) : null}
                {!providersReady && !providers.isPending ? (
                  <Link
                    to="/settings/agents#providers"
                    className="text-xs font-medium text-foreground underline underline-offset-4"
                  >
                    {t('Configure providers')}
                  </Link>
                ) : null}
              </>
            }
          />

          <TaskSummary segments={summary} onOpen={openSection} />

          {accountCheck.blocked !== null ? (
            <p
              data-slot="account-signed-out"
              role="alert"
              className="mt-2 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3 py-1.5 text-xs text-muted-foreground"
            >
              {accountCheck.blocked}{' '}
              {/* Global settings sit outside every project scope — react-router's own Link. */}
              <GlobalLink
                to="/settings/global/accounts"
                className="font-medium text-foreground underline underline-offset-2"
              >
                {t('Agent accounts')}
              </GlobalLink>
            </p>
          ) : null}

          {dispatchOn && (dispatchSettingsOpen || dispatchHintFlash) ? (
            <p
              data-slot="dispatch-hint"
              className="mt-2 rounded-md border border-primary/25 bg-primary/[0.07] px-3 py-1.5 text-xs text-muted-foreground"
            >
              <strong className="font-semibold text-foreground">{t('Dispatch is on.')}</strong>{' '}
              {t('Splits this task into subtasks it runs as separate tasks. Worktree stays on. Its own limits are in Advanced.')}
            </p>
          ) : null}

          <SuggestedChips onPick={(text) => update({ text })} />
        </div>

        <TaskSettingsPanel
          open={panelOpen}
          onOpenChange={setPanelOpen}
          presets={presets}
          selectedPresetId={appliedPresetId}
          modified={presetModified}
          onApplyPreset={applyPreset}
          onSavePreset={saveCurrentPreset}
          onRenamePreset={renamePreset}
          onDeletePreset={removePreset}
          presetsDisabled={savePresets.isPending}
          focusSection={focusSection}
          disabled={!providersReady}
          who={
            // Two ways to staff a task, side by side: ONE agent that does the work, or a manager that
            // plans and hands parts to listed workers. The server runs the roster's manager in place
            // of the Agent/Model below, so with a roster on those fields are not shown at all.
            <div className="flex flex-col divide-y divide-border">
              <div
                data-slot="single-agent"
                data-active={!rosterMode ? 'true' : 'false'}
                className={cn(
                  'flex flex-col gap-3 border-l-2 py-4 pl-4 first:pt-0',
                  rosterMode ? 'border-transparent' : 'border-primary',
                )}
              >
                <div className="text-xs font-semibold text-foreground">
                  {t('Single agent')}
                </div>
                {rosterMode ? (
                  <p data-slot="single-agent-replaced" className="text-xs leading-snug text-soft-foreground">
                    {t('Replaced by the manager: it runs this task with the backend and model you pick on the right.')}
                  </p>
                ) : (
                  <div className="grid gap-3 @xl:grid-cols-3">
                    <Field label={t('Agent')}>
                      {agentChoice ? (
                        <RunnerPill
                          runners={runners}
                          value={displayRunner}
                          accounts={accountChoices}
                          account={agentProfile}
                          repoAccount={repoAccount}
                          // Changing the AGENT clears the model pin: presets are per-runner, so a kept
                          // model would be one the new runner does not have. Changing only the account
                          // keeps it — the model catalog is the same either way.
                          onPick={(next, picked) =>
                            update({
                              runner: next,
                              agentProfile: picked,
                              ...(next === displayRunner ? {} : { model: null }),
                            })
                          }
                          disabled={!providersReady}
                        />
                      ) : (
                        <span data-slot="agent-value" className={chipClass} title={t('The only connected agent on this host')}>
                          {displayRunner}
                        </span>
                      )}
                    </Field>
                    <Field label={t('Model')}>
                      <PickerPill
                        slot="model-pill"
                        ariaLabel={t('Model')}
                        label={models.find((m) => m.id === model)?.label ?? t('auto')}
                        value={model}
                        disabled={!providersReady}
                        readOnly={modelsLocked}
                        disabledHint={
                          modelsLocked
                            ? t('Model selection is locked to native coding-agent settings.')
                            : undefined
                        }
                        onPick={(next) => update({ model: next })}
                        options={models.map((m) => ({ value: m.id, label: m.label, desc: m.desc }))}
                        status={modelCatalogStatus(displayRunner, catalog.data, catalog.isError)}
                      />
                    </Field>
                    <Field label={t('Variants')} hint={t('How many times to run this task in parallel — each variant gets its own worktree, and you pick the diff you keep. ×1 runs it once.')}>
                      <PickerPill
                        slot="variants-pill"
                        ariaLabel={t('Parallel variants')}
                        label={variants > 1 ? t('×{count} variants', { count: variants }) : '×1'}
                        value={String(variants)}
                        onPick={(next) => update({ variants: Number(next) })}
                        disabled={!hasGit}
                        hint={t('How many times to run this task in parallel — each variant gets its own worktree, and you pick the diff you keep. ×1 runs it once.')}
                        disabledHint={t('Parallel variants need a git repository — each variant runs in its own worktree.')}
                        options={[
                          { value: '1', label: '×1', desc: t('One run') },
                          { value: '2', label: t('×2 variants'), desc: t('Two competing runs — pick the diff you keep') },
                          { value: '3', label: t('×3 variants'), desc: t('Three competing runs — pick the diff you keep') },
                        ]}
                      />
                    </Field>
                  </div>
                )}
              </div>
              <div
                data-slot="manager-worker"
                data-active={rosterMode ? 'true' : 'false'}
                className={cn(
                  'flex flex-col gap-3 border-l-2 py-4 pl-4 last:pb-0',
                  rosterMode ? 'border-primary' : 'border-transparent',
                )}
              >
                <div className="text-xs font-semibold text-foreground">
                  {t('Manager and workers')}
                </div>
                {dispatchAvailable ? (
                  <ManagerWorkerPill roster={roster} onRoster={changeRoster} inline onEnabledChange={setRosterMode} />
                ) : (
                  <p data-slot="manager-worker-unavailable" className="text-xs text-soft-foreground">
                    {t('Manager–Worker needs Dispatch, which is off on this server or in a folder without git.')}
                  </p>
                )}
              </div>
            </div>
          }
          where={
            <div className="flex flex-col gap-3">
              {!hasGit ? (
                <p data-slot="where-no-git" className="text-xs leading-snug text-soft-foreground">
                  {t('No git repository — the run stays in this folder. There is no worktree to isolate in, so it cannot run unattended.')}
                </p>
              ) : askOn ? (
                <p data-slot="where-readonly" className="text-xs leading-snug text-soft-foreground">
                  {t('A read-only question runs in your checkout and changes nothing — there is no worktree to choose.')}
                </p>
              ) : (
                <div role="radiogroup" aria-label={t('Where it runs')} className="grid gap-2 @xl:grid-cols-2">
                  <WhereOption
                    slot="worktree-toggle"
                    checked={worktreeOn}
                    title={t('Isolated worktree')}
                    description={t('A separate copy of the repo. Review the diff before anything lands.')}
                    onSelect={() => changeWorktree(true)}
                  />
                  <WhereOption
                    slot="direct-checkout"
                    checked={!worktreeOn}
                    disabled={worktreeForced || autonomousOn}
                    disabledReason={
                      worktreeForced
                        ? dispatchOn
                          ? t("Dispatch forks this task's commits — subtasks need a worktree")
                          : rosterMode
                            ? t("The manager's workers fork its commits — a manager–worker task needs a worktree")
                            : t('Parallel variants always use isolated worktrees')
                        : t(AUTONOMY_NEEDS_WORKTREE)
                    }
                    title={t('Edit my checkout directly')}
                    description={t('Runs in the repo working tree. Changes appear in your checkout immediately.')}
                    onSelect={() => changeWorktree(false)}
                  />
                </div>
              )}
              {worktreeError ? (
                <p role="alert" data-slot="worktree-error" className="text-xs text-danger">
                  {t(worktreeError)}
                </p>
              ) : null}
              {hasGit && !askOn && (!worktreeOn || draft.newBranch === true) ? (
                <div className="flex flex-col gap-1">
                  <Field label={t('New branch')}>
                    <NewBranchToggle
                      on={draft.newBranch === true}
                      name={draft.branchName ?? ''}
                      onChange={(on) => update({ newBranch: on })}
                      onNameChange={(branchName) => update({ branchName })}
                    />
                  </Field>
                  {worktreeOn ? (
                    <p data-slot="new-branch-note" className="text-xs leading-snug text-soft-foreground">
                      {t('A worktree already forks from the base; this applies when you edit your checkout directly.')}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {repo.data ? (
                <Field label={t('Base branch')}>
                  <BaseBranchPill repo={repo.data} />
                </Field>
              ) : null}
            </div>
          }
          autonomy={
            <div className="flex flex-col gap-2">
              <AutonomousToggle
                on={autonomousOn}
                disabled={!hasGit}
                disabledReason={t('Autonomous runs need an isolated worktree, and this folder is not a git repository.')}
                onChange={changeAutonomous}
              />
              <p
                data-slot="autonomous-consequence"
                className={cn(
                  'flex items-start gap-1.5 text-xs leading-snug',
                  autonomousOn ? 'text-warning' : 'text-soft-foreground',
                )}
              >
                {autonomousOn ? <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-3 shrink-0" /> : null}
                {!hasGit
                  ? t('Unavailable: there is no worktree to isolate, so the run must stay attended.')
                  : autonomousOn
                    ? t('The run will not pause for your approval. It stays fenced: no auto-land, and the limits below bound cost, time and steps.')
                    : t('The run pauses when the agent needs you. Turning Autonomous on forces an isolated worktree.')}
              </p>
              <Field label={t('Limits')}>
                <LimitsPill draft={limitsDraft} onChange={changeLimits} request={limitsRequest} />
              </Field>
              <p data-slot="limits-effective" className="text-xs text-soft-foreground">
                {t('This run: {limits}', { limits: describeRunLimits(effective) })}
              </p>
            </div>
          }
          skill={
            <div className="flex flex-col gap-2">
              <div data-slot="skill-field">
                <SourcePill
                  source={source}
                  ready={sourcesReady}
                  skills={skillList}
                  skillUsage={skillUsage}
                  workflows={workflowList}
                  onPick={(next) => update({ source: next })}
                />
              </div>
              {selectedSkill?.interactive && (draft.autonomous === null || draft.worktree === null) ? (
                <p className="text-xs leading-snug text-soft-foreground" data-slot="interactive-skill-hint">
                  {t('This skill recommends an interactive run in the current checkout. You can change either setting.')}
                </p>
              ) : null}
            </div>
          }
          advanced={
            <div className="grid gap-3 @xl:grid-cols-2">
              {askOffered ? (
                <Field label={t('Read-only question')}>
                  <AskToggle on={askOn} auto={draft.readOnly === undefined} onChange={(on) => update({ readOnly: on })} />
                </Field>
              ) : null}
              {followupsToggleShown ? (
                <Field label={t('Follow-up generation')}>
                  <GenerateFollowupsToggle
                    on={generateFollowupsOn}
                    onChange={(on) => update({ generateFollowups: on })}
                  />
                </Field>
              ) : null}
              {templates.length > 0 ? (
                <Field label={t('Prompt templates')}>
                  <PromptTemplateMenu
                    templates={templates}
                    onInsert={(text) => composerRef.current?.insertAtCaret(text)}
                  />
                </Field>
              ) : null}
              {dispatchAvailable ? (
                <div className="flex flex-col gap-1 @xl:col-span-2">
                  <Field label={t('Dispatch (subtasks)')}>
                    <DispatchToggle
                      available={dispatchAvailable}
                      value={dispatch}
                      onChange={changeDispatch}
                      onSettingsOpenChange={setDispatchSettingsOpen}
                      runners={runners}
                      parentRunner={displayRunner}
                      // The composer's own catalog, already fetched for the runner this task runs as —
                      // the list "same as parent" resolves to. A subtask runner the user changes to
                      // discovers its own inside the toggle, which is the only place that knows it.
                      parentModels={models}
                    />
                  </Field>
                  <p className="text-xs leading-snug text-soft-foreground">
                    {t('Tap to turn it on; its own limits open from the arrow beside it.')}
                  </p>
                </div>
              ) : null}
            </div>
          }
        />
      </div>
    </div>
  )
}

/** A labelled field in the panel: every control says what it sets, in words. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {hint ? (
          <IconTooltip label={hint}>
            <button type="button" aria-label={hint} className="inline-flex text-soft-foreground hover:text-foreground">
              <InfoIcon aria-hidden="true" className="size-3" />
            </button>
          </IconTooltip>
        ) : null}
      </span>
      {children}
    </div>
  )
}

/** One of the two where-it-runs states — a radio card, never a bare checkbox. */
function WhereOption({
  slot,
  checked,
  disabled,
  disabledReason,
  title,
  description,
  onSelect,
}: {
  slot: string
  checked: boolean
  disabled?: boolean
  disabledReason?: string
  title: string
  description: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      data-slot={slot}
      title={disabled ? disabledReason : description}
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
        checked ? 'border-primary/60 bg-primary/[0.06]' : 'border-border bg-background hover:bg-muted/50',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        {checked ? (
          <CheckIcon aria-hidden="true" className="size-3 shrink-0 text-primary" />
        ) : (
          <SquareIcon aria-hidden="true" className="size-3 shrink-0 text-soft-foreground" />
        )}
        {title}
      </span>
      <span className="pl-[22px] text-xs leading-snug text-soft-foreground">
        {disabled && disabledReason ? disabledReason : description}
      </span>
    </button>
  )
}

/** The Ask chip (spec 2026-10-20-trunk-based-projects): a read-only question about the
 *  checkout — no branch, no lease, nothing lands. */
function AskToggle({ on, auto, onChange }: { on: boolean; auto: boolean; onChange: (on: boolean) => void }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      data-slot="ask-toggle"
      onClick={() => onChange(!on)}
      title={
        on
          ? auto
            ? t('Read-only question — answers from the checkout, changes nothing (picked because the message is a question)')
            : t('Read-only question — answers from the checkout, changes nothing')
          : t('Check to ask a read-only question instead of filing a change')
      }
      className={cn(chipClass, on && 'border-primary/60 text-foreground')}
    >
      {on ? (
        <CheckIcon aria-hidden="true" className="size-3 shrink-0 text-primary" />
      ) : (
        <SquareIcon aria-hidden="true" className="size-3 shrink-0 text-soft-foreground" />
      )}
      {t('Ask')}
    </button>
  )
}

/** In-place on a new branch (spec 2026-10-19-repo-git-sync): shown only with the worktree off.
 *  Checked forks the checkout onto `name` (or a generated branch) from the base first. */
function NewBranchToggle({
  on,
  name,
  onChange,
  onNameChange,
}: {
  on: boolean
  name: string
  onChange: (on: boolean) => void
  onNameChange: (name: string) => void
}) {
  const { t } = useI18n()
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        data-slot="new-branch-toggle"
        onClick={() => onChange(!on)}
        title={
          on
            ? t('Switches the repo checkout to a new branch from the base before the agent starts')
            : t('Runs on whatever branch is checked out — check to start a new branch from the base')
        }
        className={cn(chipClass, on && 'border-primary/60 text-foreground')}
      >
        {on ? (
          <CheckIcon aria-hidden="true" className="size-3 shrink-0 text-primary" />
        ) : (
          <SquareIcon aria-hidden="true" className="size-3 shrink-0 text-soft-foreground" />
        )}
        {t('New branch')}
      </button>
      {on ? (
        <input
          aria-label={t('New branch name')}
          data-slot="new-branch-name"
          value={name}
          placeholder={t('feat/… (auto)')}
          onChange={(event) => onNameChange(event.target.value)}
          className="h-6 w-36 rounded-md border border-input bg-card px-2 font-mono text-[11px] outline-none focus-visible:border-ring"
        />
      ) : null}
    </span>
  )
}

/** Autonomous toggle (#autonomous): checked = the run never pauses for you, auto-continuing
 *  until the agent is done. No "needs you" is ever raised. */
function AutonomousToggle({
  on,
  disabled,
  disabledReason,
  onChange,
}: {
  on: boolean
  disabled?: boolean
  disabledReason?: string
  onChange: (on: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      data-slot="autonomous-toggle"
      onClick={() => onChange(!on)}
      title={
        disabled
          ? disabledReason ?? t('Plan-first runs are interactive — autonomous is unavailable')
          : on
            ? t('Autonomous — the agent runs to completion without pausing for you')
            : t('Runs interactively — check to let the agent finish without pausing for you')
      }
      className={cn(chipClass, on && !disabled && 'border-primary/60 text-foreground')}
    >
      {on ? (
        <CheckIcon aria-hidden="true" className="size-3 shrink-0 text-primary" />
      ) : (
        <SquareIcon aria-hidden="true" className="size-3 shrink-0 text-soft-foreground" />
      )}
      {t('Autonomous')}
    </button>
  )
}

/** Follow-up toggle: checked lets agents append newly discovered work to the task inbox.
 *  Handoff journaling remains active either way. */
function GenerateFollowupsToggle({
  on,
  onChange,
}: {
  on: boolean
  onChange: (on: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      data-slot="generate-followups-toggle"
      onClick={() => onChange(!on)}
      title={
        on
          ? t('Agents can add newly discovered follow-up work to the task inbox')
          : t('Follow-up generation is off; agents still maintain the handoff journal')
      }
      className={cn(chipClass, on && 'border-primary/60 text-foreground')}
    >
      {on ? (
        <CheckIcon aria-hidden="true" className="size-3 shrink-0 text-primary" />
      ) : (
        <SquareIcon aria-hidden="true" className="size-3 shrink-0 text-soft-foreground" />
      )}
      {t('Follow-ups')}
    </button>
  )
}

/**
 * Rank the registry against the pill's search box.
 *
 * Ranked in JS with cmdk's own filtering off (#484 — cmdk's score-sort does not re-order these
 * pickers reliably). Registry order is `lastOpenedAt`, so an empty search shows the same
 * recency the sidebar does; a typed query floats name/id PREFIX matches above mid-string ones,
 * each group still in recency order.
 */
function matchProjects(
  projects: readonly ProjectListEntry[],
  search: string,
): ProjectListEntry[] {
  const query = search.trim().toLowerCase()
  if (query === '') return [...projects]
  const rank = (project: ProjectListEntry): number => {
    const name = project.name.toLowerCase()
    const id = project.id.toLowerCase()
    if (name.startsWith(query) || id.startsWith(query)) return 0
    if (name.includes(query) || id.includes(query)) return 1
    return 2
  }
  return projects
    .map((project, index) => ({ project, rank: rank(project), index }))
    .filter((entry) => entry.rank < 2)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.project)
}

/**
 * The project pill (multi-project spec §"New task"; mockup new-task-project.html) — the
 * composer's scope selector, preselected from the URL.
 *
 * Picking a project NAVIGATES to that project's composer rather than swapping local state:
 * `/p/<id>/new` is the single place the scope is decided (the step-3.2 route gate), and every
 * part of this screen that must re-resolve already keys off it — the skill/workflow picker and
 * `/`-autocomplete (`/api/p/<id>/skills`), the runner and model probes, the base-branch pill,
 * the per-project draft, and the `POST /api/p/<id>/runs` submit target. Doing it any other way
 * would mean a second, parallel notion of "the active project" living in this component.
 *
 * `replace`: a scope swap corrects where you are, it is not a place to go Back to — Back stays
 * whatever brought you to the composer.
 */
function ProjectPill({
  projects,
  projectId,
  onPick,
}: {
  projects: readonly ProjectListEntry[]
  projectId: string
  onPick: (projectId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { t } = useI18n()
  const selected = projects.find((project) => project.id === projectId)
  const matched = matchProjects(projects, search)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="project-pill"
          aria-label={t('Project')}
          title={t('Which project this task runs in — its skills, workflows, settings and draft')}
          className={cn(chipClass, 'border-foreground/60 font-semibold text-foreground')}
        >
          <FolderOpenIcon aria-hidden="true" className="size-3 shrink-0 text-soft-foreground" />
          {/* The registry is authoritative for the display name; the raw id is the fallback
              while it is still loading, so the pill never renders an empty label. */}
          <span className="max-w-40 truncate">{selected?.name ?? projectId}</span>
          {chevron}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[300px] max-w-[calc(100vw-2rem)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder={t('search projects…')} value={search} onValueChange={setSearch} />
          {/* Same 3rem headroom rule as the source picker: the list must not eat the search box. */}
          <CommandList
            data-slot="project-menu"
            className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)-3rem))]"
          >
            {matched.length === 0 ? <CommandEmpty>{t('Nothing matches.')}</CommandEmpty> : null}
            {matched.map((project) => (
              <CommandItem
                key={project.id}
                value={project.id}
                keywords={[project.name]}
                data-slot="project-option"
                data-project-id={project.id}
                // A `missing` folder has nothing to run a task in. The entry stays listed (the
                // sidebar owns removing it) but cannot be picked — better than navigating into
                // a project whose every request 4xxs.
                disabled={project.status === 'missing'}
                onSelect={() => {
                  onPick(project.id)
                  setOpen(false)
                }}
              >
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{project.name}</span>
                {project.status === 'missing' ? (
                  <span className="shrink-0 text-[11px] text-soft-foreground">{t('folder not found')}</span>
                ) : project.branch !== undefined ? (
                  <span className="shrink-0 font-mono text-[11px] text-soft-foreground">
                    {project.branch}
                  </span>
                ) : null}
                {project.id === projectId ? (
                  <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
                ) : null}
              </CommandItem>
            ))}
          </CommandList>
          {/* The mockup's `dd-note`. Worth the two lines: picking here does far more than
              relabel a pill, and nothing else on screen says so. */}
          <p className="border-t border-border px-3 py-2 text-[11px] leading-snug text-soft-foreground">
            {t('Skills, workflows, settings and the draft re-resolve against the selected project.')}
          </p>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Base-branch picker: worktrees fork from it and PRs target it. It is repo-level CONFIG
 *  (`PUT /api/config`, exactly the legacy Repo tab's picker), not a per-run flag — so it
 *  mutates the server and refetches, rather than living in the draft. Hidden without git. */
function BaseBranchPill({ repo }: { repo: RepoResponse }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (baseBranch: string | null) => putConfig({ baseBranch }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repo })
      toast(
        result.baseBranch
          ? t('New tasks will branch off "{branch}" (PRs target it too).', { branch: result.baseBranch })
          : t('Base branch cleared — new tasks fork from the checked-out branch.'),
      )
    },
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })
  if (!repo.info) return null
  const current = repo.baseBranch ?? repo.info.branch
  return (
    <PickerPill
      slot="base-pill"
      ariaLabel={t('Base branch')}
      label={<span className="font-mono text-[11.5px]">{t('base: {branch}', { branch: current })}</span>}
      value={repo.baseBranch ?? ''}
      onPick={(value) => mutation.mutate(value === '' ? null : value)}
      searchPlaceholder={t('Search branches…')}
      emptyLabel={t('No branches found.')}
      options={[
        { value: '', label: t('follow checked-out branch ({branch})', { branch: repo.info.branch }), desc: t('New task worktrees fork from whatever branch is checked out') },
        ...repo.branches.map((branch) => ({ value: branch, label: branch })),
      ]}
    />
  )
}

/** Honest static starters (the mockup's ghost chips): they only fill the textarea — the user
 *  still aims and submits. */
const SUGGESTIONS = [
  'Fix a failing or flaky test',
  'Summarize recent commits on this branch',
  'Update the README for recent changes',
]

function SuggestedChips({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useI18n()
  return (
    <div className="mt-7 flex flex-wrap justify-center gap-2 max-md:justify-start">
      {SUGGESTIONS.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          data-slot="suggested-chip"
          onClick={() => onPick(suggestion)}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-border px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <SparklesIcon aria-hidden="true" className="size-3 shrink-0 text-soft-foreground" />
          {t(suggestion)}
        </button>
      ))}
    </div>
  )
}
