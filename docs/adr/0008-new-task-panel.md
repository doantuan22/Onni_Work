# ADR 0008 — The `/new` Task settings panel

- Status: accepted
- Date: 2026-11-01
- Supersedes: nothing. Extends [ADR 0005](0005-unattended-safety.md) and [ADR 0006](0006-manager-worker.md)

## Context

`/new` had grown to a single footer row holding every run setting: agent, model, variants,
worktree opt-out, new branch, base branch, Autonomous, limits, skill, Ask, follow-ups, prompt
templates, dispatch and the Manager–Worker roster. The prompt box — the one thing every user
comes there to use — shared its row with a dozen chips, three of them icon-only, and the
consequences of the dangerous ones (Autonomous, Unlimited, direct checkout) were visible only
inside the popover that set them. A saved Manager–Worker preset was a second, unrelated preset
system next to nothing.

The requirement was to split configuration out of the prompt area into a right-hand panel that is
open by default, with presets at the top, without changing what any of the controls do.

## Decision

1. **Two columns at `/new`.** Left: title, prompt, send, suggested chips, and a read-only
   **summary line**. Right: the **Task settings** panel. The panel is an inline `<aside>` at
   ≥1100px and a right drawer below it, opened from the summary's sliders control. Its open/collapsed
   state is per browser (`localStorage: onni-new-task-panel-open`), and it **defaults open** — the
   panel is where the safe default (isolated worktree) is visible, so folding it by default would
   hide that from the person about to start a run. The app's own left sidebar is untouched.
2. **Every setting moved, nothing removed.** The controls use their existing components and
   `data-slot` names, so behavior, drafts, URL params/autostart, attachments, dictation, the send
   menu, variant comparison and the GitHub hand-off are unchanged. Every panel control has a text
   label; no icon-only control remains in the panel.
3. **The summary line is read-only and always visible**, even with the panel folded:
   `claude · sonnet · worktree · limits: default · base dev`. Dangerous states are named in words
   and tinted — `autonomous` (danger), `limits: ∞` (danger), `direct checkout` (danger),
   `manager + N workers` (warning), `in place (no git)` (warning). Clicking a segment opens the
   panel (or the drawer) and focuses that section.
4. **Presets are the top section.** Built-ins are code and cannot be edited or deleted:
   - **Quick** — defaults, ×1 variant, isolated worktree, autonomous off, workspace-default limits.
   - **Overnight (safe)** — isolated worktree, new branch on, autonomous on, limits **capped** from
     the workspace, or from `DEFAULT_RUN_LIMITS` when the workspace is uncapped. Overnight can never
     be unlimited.
   - **Manager–Worker** — Settings' default roster, isolated worktree, default limits. Disabled with
     the reason when Settings has no default manager–worker preset.
   User presets are stored per workspace (`taskPresets` in `~/.onni/config.json`, added with the
   contract change in `packages/contract/src/task-presets.ts`). A selected preset shows
   `(modified)` when the live settings differ, with a **Restore** button; saving, renaming and
   deleting go through `PUT /api/v1/workspace/config`.
5. **One preset system, not two.** Legacy Manager–Worker presets are shown **read-only** as task
   presets beside the built-ins, never copied into `taskPresets`. A user task preset with the same
   name wins, so the two lists cannot fork into duplicates the first time someone saves one. A saved
   roster is a task preset whose `settings.roster` is set; Settings → Manager–Worker still owns the
   shared roster list.
6. **Where it runs is a two-state radio, not a checkbox** — “Isolated worktree” or “Edit my checkout
   directly” — with New branch and Base branch beneath it. The header note follows the resolved
   mode, as it did before (#793). The safe default comes from the existing setting:
   Settings → Resources → **New task defaults → Use a worktree by default**
   (`composerDefaults.worktree` / `inheritedWorktree`, shipped on) and the project's
   `taskWorkspace`. **No new setting or contract field was needed for this**; the panel only reads
   what Settings already decided.
7. **Autonomous and the worktree are coupled in the panel.** Turning Autonomous on switches to the
   isolated worktree in the same action; “Edit my checkout directly” is disabled while Autonomous is
   on, with the reason on the control. Turning Autonomous off hands the choice back. See the
   divergence below.
8. **Limits keep ADR 0005's rules.** Only a `capped` ceiling is written to the draft; `default` is
   the absence of a choice and `none` (unlimited) must be chosen again for every task — a draft
   restored a week later must never silently lift every brake. Choosing Unlimited asks once.
9. **Advanced is collapsed by default** and holds the rarely-used controls — read-only Ask,
   follow-up generation, prompt templates, dispatch (and its own nested limits). The two unlabeled
   icon buttons that used to sit beside Limits are now labelled fields: the prompt-template menu
   became **Prompt templates** and the follow-up toggle became **Follow-up generation**.

### Old control → new position

| Old composer footer | New position |
| --- | --- |
| Agent pill | Who works → Agent |
| Model pill | Who works → Model |
| Variants pill | Who works → Variants (labelled; explanation in a tooltip) |
| Manager / Workers pill (with its own preset saving) | Who works → Manager–Worker; saving moved to task presets |
| Worktree checkbox | Where it runs → Isolated worktree / Edit my checkout directly (radio) |
| New branch checkbox + name | Where it runs → New branch |
| Base branch pill | Where it runs → Base branch |
| Autonomous chip | Autonomy & limits → Autonomous (with the consequence spelled out) |
| Limits pill | Autonomy & limits → Limits (+ “This run: …” effective line) |
| Skill/workflow pill | Skill → Skill or workflow |
| Ask chip | Advanced → Read-only question |
| Follow-up icon toggle | Advanced → Follow-up generation |
| Prompt-template icon button | Advanced → Prompt templates |
| Dispatch icon + settings chevron | Advanced → Dispatch (subtasks), its settings chevron unchanged inside the control |

The panel sections do not share the old row's `data-slot`s where the UI shape changed (the worktree
checkbox is now `worktree-toggle` + `direct-checkout` radios); everything else kept its slot.

## Divergence from the engine (deliberate)

- **Autonomous + direct checkout.** The engine does **not** forbid an autonomous run in the repo
  working tree: it forbids auto-land and fences unattended runs (ADR 0005). The panel is stricter
  and never lets the user assemble that pair, because the run would write straight into a checkout
  while the user is told it will not pause for them. Engine behavior is untouched; this is UI-only.
- **Autonomous without git.** With no repository there is no worktree to pin, so the panel disables
  the Autonomous control with the reason and resolves `autonomousOn` to false. The engine would
  accept an autonomous in-place run; the panel refuses to offer one. This is recorded here as a
  panel-only rule.

## Safer-option decisions taken where the requirement left a choice

- **Overnight never inherits `none`**: a `mode: "none"` workspace produces the built-in caps instead.
- **Unlimited is never restored from a draft**, and applying a preset never restores one (presets
  store only capped limits).
- **A blocked choice is disabled, not silently flipped.** While Autonomous is on, direct checkout is
  disabled with its reason rather than turning Autonomous off behind the user's back.
- **Same-name merge** means a user preset shadows a legacy manager preset instead of creating a
  second entry with the same name.
- **The panel opens by default** so the isolated-worktree default is visible on `/new`.
- **The drawer has no remembered state** — it is transient and always opens from the summary; only
  the desktop collapse is remembered, per browser.

## Consequences

- `packages/web/src/lib/new-task-presets.ts` owns the pure rules (built-ins, merge, snapshot
  equality, the Autonomous↔worktree constraint, the panel worktree resolver, limits persistence,
  summary segments, preset CRUD). `packages/web/src/components/task-settings-panel.tsx` owns the
  shell (inline/drawer, sections, presets, focus). `routes/new-task.tsx` owns the live draft.
- The route is stricter than `resolveComposerRunMode` in exactly two places (`resolvePanelWorktree`,
  and gating `autonomousOn` on `hasGit`); the engine-facing resolver is unchanged.
- Future panels should follow the same split: derive a snapshot from what the run will actually
  send, compare presets against it, and never persist a choice the user must consciously re-make.
