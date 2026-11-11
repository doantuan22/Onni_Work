# Agentic Chat Workspace — design proposal

Status: **design only** (2026-11-10). No source, test or config was changed. Evidence base:
[survey A shell](survey-A-shell.md), [survey B run surfaces](survey-B-run-surfaces.md),
[survey C backend](survey-C-backend.md), [survey D references](survey-D-references.md).
Statements marked *(verified)* come from those surveys' cited code; everything else is a proposal.

## 1. Goal and non-goals

Goal: turn the cockpit from "route per page" into an **agentic chat workspace** — a persistent
project/session navigator, one or more conversation panes, and optional side panes (changes,
terminal, files, preview, task tree, inspector) that can be resized and arranged, in the spirit of
Codex / Claude Code desktop / opencode desktop.

Non-goals: no cloud/account, no new execution model, no auto-merge, no new env var, no new required
config (AGENTS.md: zero config, local-first, nothing merges itself). A pane is a *view*, never
another execution.

## 2. What exists (the starting point)

- *(verified)* Shell = resizable sidebar (264–420px, custom splitter) + one routed main region;
  mobile = top bar + Sheet drawer. No panel library; four hand-written splitters.
- *(verified)* A **task workspace** already exists: `TaskWorkspaceRoute` + `WorkspaceColumns`
  (1–3 columns, % widths, min 12%, keyboard/ARIA separators, drag/reorder, named saved layouts via
  `/runs/:id/layouts`, one column at a time below 1024px). `ViewId` = session, changes, commits,
  files, browser, graph, terminal.
- *(verified)* Transcript is `SessionTranscript` over normalized `UiEvent`s with `ToolCard`,
  `AskCard`, grouping; `TaskComposer` is shared by Session and Changes; rich `<Diff>` with line
  comments; terminal drawer/column; `AgentsDock` for runner subagents; `TaskQuickList`/`TaskPalette`
  for navigation; one root SSE + one WS bus.
- *(verified)* Gaps: panes are all views of **one** run; permission events are reserved and unused;
  no combined child tree; no transcript search; "unread" only for finished runs; runs-index is
  capped (200/project), non-paged.

Conclusion: ~70% of the pane content already exists. The new work is the **host** (multi-thread
pane model), **navigator**, **attention model**, and a few contract additions.

## 3. Target anatomy

> Superseded in part by the owner's reference screens: see **§12** (default Review layout, no
> always-visible thread tab strip, auto-collapsing icon rail, Workbench preset).

```
┌──────────────┬───────────────────────────────┬──────────────────────┐
│ NAVIGATOR    │ CONVERSATION PANE(S)          │ CONTEXT PANES        │
│ projects     │ ┌ tab: task A ● ┐ tab: B ✓   │ [Changes|Files|Term| │
│  ▸ proj 1    │ │ thread (transcript+tools)   │  Preview|Tree|Info]  │
│    ● A       │ │ AskCard / approvals inline  │                      │
│    ✓ B       │ │ ...                         │  diff w/ line        │
│    ⚠ C needs │ ├─────────────────────────────┤  comments → composer │
│  ▸ proj 2    │ │ COMPOSER (queue/steer/stop) │                      │
│ ─ filters ─  │ └─────────────────────────────┘                      │
│ search ⌘K    │ status bar: branch · worktree · tokens/cost · limits  │
└──────────────┴───────────────────────────────┴──────────────────────┘
```

Three zones, all resizable, all collapsible:

1. **Navigator (left)** — replaces today's sidebar content. Project groups (existing
   `ProjectGroups`) containing *sessions* (runs), grouped by attention: **Needs you** (ask/review/
   failed) → **Running** → **Recent** → **Archived**. Child (worker) runs nest under their manager
   (`buildTaskTree`). Row = title, backend chip, status dot, unread marker, branch. Collapse to an
   icon rail (new; today there is no desktop collapse). Footer keeps settings/theme.
2. **Conversation area (center)** — a **tab strip of open threads** plus optional split (2 side by
   side, like Cursor/OpenCode). Each pane = transcript + composer for one run. Tool calls inline,
   grouped and expandable (existing). Asks (and future approvals) render at the blocking point.
3. **Context area (right, per active thread)** — tabbed views of the *active conversation's* run:
   Changes (review + line comments back to the composer), Files, Terminal (also bottom drawer),
   Preview/Browser, Task tree (manager→workers + runner subagents, kept visibly distinct),
   Inspector (RunHeader fields: status, limits, runner/model, PR/issue refs, actions).

Default (zero-config, new user): navigator + one conversation, context area closed. Opening
Changes/Terminal etc. is one click or shortcut; the arrangement is remembered. This is the
"one obvious default" the reference survey recommends.

### Pane model (the key new abstraction)

```
WorkspaceState (per project, restored on load)
  navigator: { collapsed, width }
  threads:   ordered PaneRef[]        // open conversation tabs
  PaneRef:   RunPaneRef{paneId,projectId,runId} | DraftPaneRef{paneId,projectId,draftId}  // see 11.3
  active:    paneId
  split:     none | 2-up (paneId pair)
  context:   { open, width, view }     // applies to the active thread, view ∈ existing ViewId
  perRunLayouts: existing /runs/:id/layouts  // unchanged, used for context-area layout
```

Rules: a pane owns its own draft, scroll anchor and selection; hidden panes unmount their
queries/sockets (existing kept-layout policy); the context area always follows the **active**
thread. Max 2 visible conversations (3 columns total already tested; more is IDE-chrome creep).
Mobile (<1024px): navigator becomes drawer, one pane at a time, context views as full-screen
sheets — decided separately from desktop, as survey A warns.

## 4. Key behaviors

- **Attention**: one root-level signal (existing SSE/WS) drives navigator badges, tab dots and
  existing run notifications; no per-pane polling. Waiting-on-ask and failure get a distinct
  marker; unread extends beyond finished runs (needs contract addition, §7).
- **Composer**: reuse `TaskComposer`; visible delivery state (running → queued / steer / stop),
  drafts per run preserved when switching tabs; `@` files, `/` skills, attachments, model/agent
  pickers unchanged. Diff line comments attach to the composer of the owning thread.
- **Review**: Changes pane uses the rich `<Diff>`; unify the review gate onto it (today the gate
  uses the simpler `RunDiff`). Merge/PR/finish remain explicit user buttons; never imply auto-merge;
  branch/worktree always visible in the status bar and inspector.
- **Manager → worker**: tree pane shows persistent child runs (branch, backend, status, report,
  changed files) with click-to-open as a tab or split; runner subagents stay a separate list.
  Manager threads show worker progress summaries inline with a link, not worker transcripts.
- **Approvals**: ship `ask.requested` cards inline now (works). Interactive permission approvals
  are **gated on a product decision** (§8): `permission.*` events are reserved and not honored
  across all runners; do not draw an "always allow" control until they are.
- **Keyboard**: keep the Task Palette and shell Mod-shortcuts; add pane-scoped pane switch / toggle context / terminal / navigator (chords chosen centrally; Mod+1..9 collides, see 11.1). Shortcuts yield to text
  inputs, terminal and dialogs (existing guards). Active pane must be visually and ARIA-clear.
- **Empty/loading/error**: failed load ≠ "no changes"; empty navigator offers New Task / Add
  Project; skeletons per pane.

## 5. Reuse vs new

| Area | Reuse as-is | Change / new |
| --- | --- | --- |
| Transcript, ToolCard, AskCard, grouping | yes | optional tool-timeline filter view |
| Composer, drafts, references, palette | yes | active-pane focus routing |
| Diff, ChangesView, line comments, FilesView, terminal, browser | yes | move review gate to `<Diff>` |
| `WorkspaceColumns`/`ColumnDivider`, layout-state, saved layouts | yes for context area | add workspace-level (multi-run) state above it |
| Sidebar frame, ProjectGroups, TaskQuickList, `buildTaskTree` | partially | become Navigator: attention grouping, icon-rail collapse |
| Routes (`/p/:id/tasks/:id/*`) | keep all URLs | URL = deep link to *active* pane + view; extra panes live in workspace state |
| Splitters (4 custom) | keep | extract one shared `Splitter` primitive (a11y separator) rather than add a library |

## 6. Routing and state

- Keep every existing route working; they open/focus the matching thread tab (bookmarks, PR links,
  notifications keep functioning). `AppShellMain` keeps a single route scroller; the workspace is
  a layout *inside* it for task routes, so Settings/other routes stay chromeless/unchanged.
- Workspace state persists locally (localStorage first, mirrors the current sidebar-width pattern,
  and optionally a server-side workspace file like layouts); deleting it rebuilds a default —
  satisfies "written, never required".
- Data lifetimes: queries keyed by project/run; subscribe on mount, unsubscribe on hide; no
  `new WebSocket` per pane (AGENTS.md).

## 7. Backend/contract needs (all optional-field, additive)

From survey C: (1) cursor-paged, project-grouped session index with preview + awaiting-ask/worker
counts (runs-index is capped and non-paged); (2) transcript search endpoint; (3) read receipt by
`lastViewedSeq` so waiting/active threads can be unread; (4) workspace multi-thread pane state
(`paneId`, ordered refs, selected pane); (5) optional child-tree snapshot; (6) *only if approved*
activate `permission.requested/resolved` with a typed answer route. Phase 1 can ship with none of
these by using the existing index + client-side state.

## 8. Owner decisions (answered 2026-11-10)

1. **Workspace scope: per project.** Routing, query keys, `@`/`/` suggestions and Git/worktree state
   are all project-scoped; mixing projects in one workspace would swap the Context area's repo
   under the user. The Navigator still lists all projects; switching restores that project's
   `WorkspaceState`.
2. **Visible conversation panes: max 2** (unlimited open tabs). Four vertical columns is the width
   limit for tool cards/diffs, and it caps run streams (§11.2).
3. **Interactive permission approvals: deferred.** `permission.*` is reserved and unhandled; ship
   `ask.requested` / `DeniedActionsHint` only. Optional Phase 6.
4. **Replace the sidebar with the Navigator** (icon-rail collapse). Project-level tool pages
   (Git, GitHub, Tracker, Automations, Skills, Settings) become icon buttons that stay reachable
   when collapsed. Avoids double navigation.
5. **State: localStorage per `projectId` for v1**, plus the existing `/runs/:id/layouts` for the
   Context area. Deleting it yields the default layout (zero-config).

## 9. Phasing (each phase ships independently, default path unchanged until the last)

1. **Primitives**: shared `Splitter`, Navigator attention grouping/collapse rail, status bar.
   **✅ DONE 2026-11-11** (status bar dropped per §12.5 #8). Delivered: violet token swap + `--header-h` 48px (D1/D7);
   `useSplitter` hook adopted by sidebar, column, drawer and tree handles + characterization tests;
   `VerticalSplit` primitive; reserved workspace chords + `ActivePaneContext` (`components/workspace/`);
   Navigator "Needs you/Running/Recent" grouping (`lib/navigator-groups.ts`); icon rail (`lib/rail-state.ts`).
2. **Host**: workspace state + thread tabs (single visible pane), active-pane routing, URL sync.
   **✅ DONE 2026-11-11.** Delivered: `lib/workspace-state.ts` (PaneRef union, per-project localStorage);
   `components/workspace/workspace-host.tsx` (ActivePane wiring, `/new` as draft pane, promote-on-start);
   `NewTaskSurface` + draftId-keyed drafts; URL sync (`task-workspace/url-sync.ts`); Review layout seed +
   Layout-menu preset; Navigator Open list with close. Web `tsc` is clean.
3. **Context area**: wrap existing `WorkspaceColumns` views as the right-hand tabbed area; unify
   review onto `<Diff>`; unified task-tree pane.
   **✅ DONE 2026-11-11.** Delivered: review gate on rich `<Diff>`; new ViewIds `files-tree`/`editor`/`tree` + optional
   column `stack`/`stackRatio` (layout-state + contract, additive); read-only `TaskEditor`; `TaskFilesTree` +
   `lib/task-open-files.ts`; `TaskTreePane` (dispatched runs and runner subagents kept separate); vertical-stack
   rendering via `VerticalSplit` + `setStackRatio`; all wired in `task-workspace.tsx`; Layout-menu presets Review +
   Workbench; 48px header token on column headers; one terminal per run + branch chip in terminal header.
   Known env artifact: 2 web tsc errors in `use-workspace-layouts.ts` come from `@onni/contract` resolving to the parent checkout.
4. **Split conversations** (2-up), per-pane drafts/scroll, shortcut set, mobile model.
   **✅ DONE 2026-11-11.** Delivered: ref-counted per-run SSE share (`api/run-stream-share.ts`, hidden panes release streams);
   2-up split in `workspace-host.tsx` with labelled `SplitTabStrip` only while split, per-pane scroll anchors, `openBeside`;
   workspace chords bound (`use-workspace-shortcuts.ts`: Alt+1..9, Mod+Alt+Left/Right/Down, yielding to inputs/xterm/dialogs);
   mobile (<1024px) single pane + full-screen `ContextSheet`.
5. **Contract additions** (§7 items 1–4) and unread-for-active-threads; transcript search.
6. Optional: approvals lifecycle (pending decision 3).

## 10. Risks and tests to watch

- Focus/shortcut collisions across panes, palette, terminal (survey A) — define active-pane
  contract first; extend `use-command-shortcut` tests.
- Per-run vs workspace layout persistence migration; keep `/runs/:id/layouts` untouched.
- Hidden panes leaking SSE/queries → perf; keep unmount policy, add a test.
- Sensitive existing tests: `layout-state.test`, `workspace-columns`, `app-shell*.test`,
  `sidebar-frame.test`, `routes.test`, `design-guardian.test`, task-palette, thread/composer tests
  (survey A §tests). `design-guardian` token rules constrain styling.
- Don't conflate runner subagents with dispatched child runs in counts or navigation.
- Windows dev box: `npm test` is noisy locally; CI is the authority (AGENTS.md).

## 11. Technical issues verified against code (2026-11-10)

Evidence: [verify-1](verify-1-network-newtask-url.md), [verify-2](verify-2-focus-terminal-splitter.md).
All six proposed treatments came back **PARTLY** confirmed: the direction is right, the details
below are corrected.

### 11.1 Active pane and focus — a new host mechanism
- Activate only on pane `pointerdown`, tab-header click, or an explicit pane shortcut; never on
  hover or wheel. Add `ActivePaneContext` above `WorkspaceColumns` (none exists; wide columns have
  no active or `aria-*` state today). Expose real tab/tabpanel semantics with `aria-selected` plus
  a visible token-based active treatment (not `aria-current` on unmarked wrappers).
- The Context area and status bar follow the active pane. Line comments bind to the **owning
  thread id**, not "whatever is active", so a late click cannot misroute them.
- **Shortcut collisions (verified):** `Mod+1..9` is already task-palette `tab:1..9` and browser
  tab switching; bare `1..9`, backslash, `/` and backtick are task-workspace keys; `Mod+J`
  (Downloads), `Mod+B` (Firefox Bookmarks) and `Mod+N` (new window / Onni new task) are contested;
  Settings → Keyboard lets users rebind into the same space. Therefore: reserve every new chord
  centrally in `lib/keybindings.ts` (registry + `chordProblem`); pick pane-switch chords that avoid
  `Mod+1..9` (e.g. `Alt+1..9` or `Mod+Alt+Arrow`, final choice at implementation after checking
  browser and desktop shell); migrate or scope the existing `tab:N` commands.
- Yield rules reuse `isEditableTarget` + the xterm guard + `shortcutsBlocked()`
  (dialog / menu / listbox).

### 11.2 Connection budget — corrected numbers
- Today: 1 root workspace SSE + 1 optional project-webhook SSE + **1 EventSource per mounted Chat
  column** (no dedup). One shared local WebSocket (health / host / tracker / terminal topics);
  **no run topic exists**, so the WS bus cannot carry transcripts until a publisher and trust
  policy are built. The existing "2-up" layouts are two views of ONE run, not two runs.
- Target of 2 runs ⇒ 3 SSE (4 with webhooks). Rules: only visible panes open run SSE; hidden tabs
  close it and rely on the root SSE for status dots and unread; hard cap of 2 visible
  conversations; two columns of the same run share one stream.
- HTTP/1.1 starvation applies to the local direct server (Hono `serve`, ~6 per origin); a proxy
  with HTTP/2 (VPS install) is exempt, so scope the claim. Long term: run topics on the WS bus
  (ref-counted) or a multiplexed run-event transport (contract §7).

### 11.3 New Task as a draft pane — feasible, needs extraction
- Use a union, not a nullable `runId`: `DraftPaneRef {paneId, projectId, draftId}` beside
  `RunPaneRef`. Do not make saved `WorkspaceLayout` columns nullable.
- Blockers: `NewTaskRoute` is route-bound (params, search params, bookmarklet capture, launch-key
  auto-start); draft state is **one per project** (localStorage key + module cache + in-memory
  attachment map); `ManagerWorkerPill` and panel state are component-local. Extract a pane-owned
  composer surface taking `draftId`, `onStarted`, `onScheduled`; v1 allows **one draft pane per
  project**. Attachments are intentionally not persisted, so say so in the UI.
- Promotion: on `POST /runs` success set the same pane to `RunPaneRef{runId}` (variants → first
  run, as today), then push the run URL. **Scheduled** tasks create no run: close the draft and
  show a toast / navigator entry instead of promoting.
- The Context area is closed while a draft pane is active.

### 11.4 URL ↔ workspace state — new behavior, not current
- Verified: today the path identifies the run; the view suffix only seeds a deep-link layout on
  load; later view and layout changes are state-only (URL unchanged); `POP` restores the prior
  layout.
- Target: path = active run + context view. Switching run = **push**; switching context subview =
  **replace**. Extra tabs and the split live in workspace state (a URL cannot hold them).
- Loop prevention: the route-derived (runId, view) is the single input; compare it to the
  effective selection before applying; local actions go through one navigation helper; keep the
  existing effect that deliberately omits `layouts.state.active`. An unknown runId in the URL
  appends a tab and activates it. Test Back/Forward, deep link, async layout load and run switch
  for convergence.

### 11.5 Terminal placement — per-run ownership
- Sessions are keyed by `runId` + `sessionId` (several sessions per run = drawer tabs); open state
  and height persist per run (`onni-task-terminal:<runId>`). The current "exclusive" guard only
  hides the drawer when a terminal column exists; layout state does not forbid duplicate terminal
  columns, and two mounted views of one session fight over PTY size.
- Design: exactly one terminal surface **per run** (enforce in layout-state, including duplicate
  columns); one drawer anchored under Conversation+Context and bound to the **active** run;
  different runs keep independent sessions. The header shows host, project, **branch** and
  worktree path. Branch is not available today and must come from run/worktree data, not be
  parsed from `cwd`.

### 11.6 Shared Splitter — interaction only, with a wider adapter than proposed
- Verified: the four handles share `role="separator"`, focusability and pointer capture, but differ
  in units (px ×3, % ×1 with pair-relative bounds), keys (Shift steps, Home/End direction), reset,
  optional `aria-valuenow` (tree width `null`), focus-on-down and commit timing. Only the sidebar
  and tree handles have ARIA tests; column and drawer handles have none.
- Design: a headless interaction hook with an adapter for unit, pointer→value mapping, dynamic
  bounds, key map + large step, optional ARIA value, reset and change/commit timing. Each region
  keeps its wrapper DOM, labels, `data-slot`, classes and persistence. Existing tests stay green
  only if wrapper DOM and behavior are unchanged; add ARIA/keyboard tests for the column and
  drawer handles first. `design-guardian` only bans raw colors and `dark:`; it has no geometry
  rules.

### 11.7 Phase impact
Phase 1 adds the central chord registry, the `ActivePaneContext` contract and the Splitter hook
(characterization tests before refactor). Phase 2 includes the URL sync policy and the draft pane.
Phase 3 enforces one terminal per run. Phase 4 adds SSE dedupe and visible-only streams. Phase 5
may add run topics on the WS bus.

## 12. Owner reference layouts (2026-11-10) — analysis and design impact

The owner supplied three target screens, all captured at 2880×1800 (16:10, 2× DPR ⇒ **1440×900 CSS
px**). Measurements below are converted to CSS px from those images (displayed width 2000 → ×0.72).
Files: [ref-1 review](reference/ref-1-review-layout.png), [ref-2 workbench](reference/ref-2-workbench-layout.png),
[ref-3 settings](reference/ref-3-settings-layout.png). Where this section and §3–§6 disagree,
**§12 wins** (it is the owner's target); the conflicts are listed in 12.5 and the confirmed decisions in 12.7.

### 12.1 Screen 1 — "Review layout" (Navigator + Chat + Context/Changes)

Three vertical zones, hairline (1px) dividers, no outer card chrome:

| Zone | Width (CSS px / %) | Contents |
| --- | --- | --- |
| Navigator | ~263 px (18%) — equals today's 264px default | Brand tile "O" + wordmark; **project switcher card** (folder icon, name, branch badge `dev`, chevron); full-width **New task** button with `C` key hint; nav list (Dashboard, Tasks + count badge, Git, Automations, Terminal, Skill, Workflow, Settings); segmented **Open 16 / Archived**; groups **IN PROGRESS** and **RECENT** (status dot + title + age); footer: CPU/RAM meter, `Ctrl+K` search |
| Conversation | ~656 px (45%) | Task header → run summary → progress → transcript → composer |
| Context | ~521 px (36%) | Tab bar → action bar → file list → diff |

**Conversation header (2 rows + progress).** Row 1: title, status pill (amber dot + "Running"),
cost, **Create PR** button (branch icon). Row 2: workflow chip, branch chip, `+978 −0`, subtask
summary ("15 subtasks · 2 failed · 11 done · 2 cancelled"). Row 3: step progress ("Continue ·
step 7 of 7" + amber bar). All three already exist in `RunHeader` / step progress *(verified in
the live app)*; the change is placement and density, not content.

**Transcript.** Centered column; user message = right-aligned rounded bubble with time; assistant
prose; tool calls = **single-line bordered rows** (icon, bold verb `Ran/Write/Read`, mono target,
right-aligned ✓ or spinner); attachments = card with thumbnail, filename, `W × H`; live status
line ("Processing… 51s · last activity 10:04"). Matches `UiToolItem`/`ToolCard` collapsed state.

**Composer.** One rounded card pinned to the bottom of the Conversation zone: textarea, attach
icon, dictation, **backend chip** (`claude`), **model chip** (`Sonnet 5.5`), round **Stop** button
(white square) while running. No separate status bar anywhere.

**Context zone.** Tab bar = **the existing `ViewId`s** — Changes (with count badge, active =
accent underline), Commit, Files, Terminal, Preview, Notes — plus a **Layout** menu button at the
right end (today's saved-layouts menu). Action bar: "6 new files +978 −0" with **Revert** and
**Commit** (accent-filled). File list: icon, bold name, muted directory path, right-aligned `+N`,
selected row highlighted. Below it a diff header (`path · new file`) and a line-numbered diff with
green added-line background.

**Key structural change vs today:** today `Chat`, `Changes`, `Files`… are *sibling tabs of one
column* in `TaskWorkspaceRoute`; here **Chat is permanent on the left and every other view lives as
a tab in the right Context column**. Both stay one `WorkspaceLayout` (≤3 columns) — this is a
default arrangement of the existing layout model, not a new one (see 12.5 #1).

### 12.2 Screen 2 — "Workbench layout" (rail + Chat + Files + Editor + Terminal/Preview)

Five zones, all separated by 1px lines, **every column has the same ~48 px header strip** so the
baselines align across the whole window:

| Zone | Width (CSS px) | Contents |
| --- | --- | --- |
| **Icon rail** | ~55 px | Brand tile; icon-only nav (Dashboard, Tasks **active = filled rounded square**, Git, Automations, Terminal, Skill, Workflow); bottom: CPU % and a "sliders" (settings) icon |
| Chat | ~379 px | Header: status dot + title + cost. **Transcript is bottom-anchored** (empty space above short threads, content hugs the composer). Compact tool rows; composer with backend/model chips and Stop |
| Files | ~176 px | Header "Files"; collapsible tree (`packages › desktop › src › workspace`), selected file highlighted |
| Editor | ~388 px | **File tabs with ×** (`Workspace.tsx`, `PaneGrid.tsx`, `design.md`), breadcrumb path, syntax-highlighted code with line numbers (read/edit) |
| Right stack | ~441 px, **split vertically** (~58% / 42%) | **Terminal** (header "Terminal · worktree · branch chip", `+ New`) over **Preview** (header "Preview", `localhost:5173` chip, page thumbnail) |

What this tells us:
1. **The Navigator collapses to a 55 px icon rail automatically when the window is dense** (here
   ≥4 content zones). Task switching then happens via Cmd/Ctrl+K and the Tasks icon, not a list.
2. **Panes are heterogeneous and typed**: Chat, Files tree, Editor, Terminal, Preview. The Files tree
   and Editor are *separate* panes (tree ≠ editor), unlike today's single Files view.
3. **A column can be split vertically** (Terminal over Preview). Today `WorkspaceColumns` is
   horizontal-only.
4. Terminal header carries the **worktree label and branch** — satisfies the §11.5 requirement.
5. At 1440 px the Chat pane is *narrow by design* (379 px); tool rows must stay single-line and
   truncate with ellipsis (no wrapping of mono targets).

### 12.3 Screen 3 — Settings

| Zone | Size | Contents |
| --- | --- | --- |
| Settings sidebar | ~263 px | Brand + **← Back**; section **GENERAL SETTINGS** (Appearance, Notifications, Keyboard, Resources, Manager–Worker, Agent permissions, Skill, Guides, Secrets, Agent accounts, Projects) then section **THIS PROJECT · <name>** (General active, Issue tracker, Secrets, Webhooks, Integrations, Agent, Manager memory, Worktree); footer "Stored in ~/.onni" |
| Top bar | 55 px high, full width of content | `Project name` (bold) + "Project settings" (muted) |
| Content | **one centered column ≈ 680 px**, ~48 px top padding | Stacked sections: bold title → muted one-line description → bordered card (key/value rows, select, link) |
| Danger zone | last section | Red-tinted card, red heading, outlined red button (`Delete all tasks…`) |

Notable: settings replaces the Navigator in place (same 263 px slot, same brand header) and uses
the **same header-strip height** as the workspace; no right-hand panes. Accent (violet) is used
for links; destructive actions are isolated in a tinted card at the bottom. The currently shipped
settings page has the same grouping *(verified in the live desktop app)* — this is a re-skin
(flat cards, tighter copy, danger zone as one card, "Stored in ~/.onni" footer), not new IA.

### 12.4 Visual language read from the screens

- Near-black canvas, 1px low-contrast dividers, **flat surfaces** (cards = 1px border + slightly
  lifted fill; no shadows).
- **Accent = violet** (logo tile, active tab underline, Commit button, links, count badges);
  status colors: amber = running, green = done/added, red = failed/deleted/danger, white = primary
  neutral button (New task, Stop). *Today's cockpit accent is lime* — see decision D1 (confirmed: violet).
- Radii ≈ 10–12 px on cards/inputs, full-round on pills/badges; ~48 px header strips; 12–13 px mono
  for code, ~14 px UI text; generous vertical rhythm (rows ≈ 28–32 px).
- Icons: thin outline set, consistent 18–20 px; hover/selected = filled rounded rectangle.

### 12.5 What changes in the design (deltas vs §3–§11)

1. **Default arrangement = Review layout.** Seed the per-task layout as [Chat | Changes] (Context
   zone = the first non-Chat view), not "one full-width view per tab". Same `WorkspaceLayout`
   model (≤3 columns, saved layouts, `/runs/:id/layouts`); new default + a **Layout** menu entry
   for "Review" and "Workbench" presets. **Open question for the implementer:** keep the existing
   horizontal tab-switching for narrow windows (<1024 px) — unchanged.
2. **Drop the separate thread tab strip.** The reference shows no tab row above the Conversation;
   the sidebar's **Open / Archived** list *is* the open-thread set. Revised model: `threads[]` stays
   in `WorkspaceState`, but its UI is the Navigator's "Open" list (and Mod+K); a tab strip appears
   **only when 2-up split is on** (to label the two panes). This supersedes the always-visible tab
   strip in §3.
3. **Auto-collapse the Navigator to the 55 px rail** when the layout has ≥4 content zones or the
   window is narrower than a threshold (suggest <1360 px with Workbench); manual toggle always
   wins and is remembered. Replaces "collapse is optional only".
4. **New pane kinds** for the Workbench preset: `files-tree` and `editor` (split from today's
   Files view) and a **vertical split container** (Terminal over Preview). These are *layout-model*
   additions: `ViewId` gains `editor` (and `files` becomes tree-only when an editor pane exists);
   column entries may hold a vertical stack of two views with its own height ratio. Persisted as
   optional fields so old layouts still parse (AGENTS.md: new fields optional).
5. **Editor is a real gap, not reuse**: survey B verified Files is a read-only browser and
   `CodeEditor` is a generic textarea overlay with no worktree save lifecycle. v1 of the Editor pane
   = **read-only viewer with tabs + syntax highlight** (reuse `FilePreview`); editing/saving is a
   separate, later decision (D3).
6. **Uniform 48 px header strip** in every pane/zone (Navigator brand row, Chat header, Context tab
   bar, Terminal/Preview headers, Settings top bar) — a layout token, not per-component padding.
7. **Bottom-anchored transcript** for short threads; keep scroll-to-latest behaviour.
8. **Composer is the single input surface** per Conversation zone, with backend + model chips and a
   Stop button; no extra status bar (cost/limits stay in the header row, tokens in the composer
   footer per the v2 design). Commit/Revert live in the Changes action bar; **Create PR** stays an
   explicit header button; nothing merges automatically.
9. **Settings keeps the shell but swaps the Navigator** for the settings sidebar (263 px), 55 px top
   bar, centered 680 px content column, danger zone last. Reuse the existing settings routes and
   `chromeless` rule; only layout tokens change.

### 12.6 Mapping to existing components (reuse)

| Reference element | Existing seam *(from surveys A–C)* | Work needed |
| --- | --- | --- |
| Navigator list, groups, Open/Archived, project switcher | `AppShellContainer`, `ProjectGroups`, `TaskQuickList`, sidebar-frame | Restyle; attention grouping; add rail mode |
| Header rows 1–3 | `RunHeader`, step progress, subtask summary | Re-flow; move Create PR into row 1 |
| Tool rows, bubbles, attachment card, status line | `SessionTranscript`, `ToolCard`, `UiToolItem` | Single-line collapsed style |
| Composer + chips + Stop | `TaskComposer`, pickers | Restyle |
| Context tab bar + Layout menu | `WorkspaceColumns` header + saved-layouts menu | Default seed; presets |
| Changes list + diff + Revert/Commit | `ChangesView`, `<Diff>`, task-git actions | Re-skin; unify review gate (§5) |
| Files tree / Editor | `FilesView`, `FilePreview`, `CodeEditor` | **Split pane kinds; tabs** (12.5 #4–5) |
| Terminal over Preview | `TerminalDrawer` (`fill`), browser view | **Vertical stack container** |
| Settings | existing settings routes | Re-skin + layout tokens |

### 12.7 Decisions (confirmed 2026-11-10 — owner delegated "choose the optimal option")

| # | Decision | Why this is the optimal option |
| --- | --- | --- |
| D1 | **Accent = violet, as the single accent, set only through the token layer** (`--primary`, `--ring`, active-tab/underline and link tokens) in both themes. No setting, no env var, no lime/violet switch. The brand gradient and status colours (amber/green/red) are untouched. | The owner's target screens are violet. A switch would add a knob for a taste question (AGENTS.md: never trade a working default for a knob) and double the visual-test matrix. Going through tokens keeps `design-guardian` green (it only bans raw colours / `dark:`) and makes the change one reviewable diff. Audit every place that hard-wires lime (brand, focus rings, charts) and check contrast ≥ 4.5:1 for text-on-violet and violet-on-near-black in light and dark. |
| D2 | **No thread tab strip in 1-up.** The Navigator "Open / Archived" list is the open-thread set; a labelled tab strip appears only while 2-up split is on. | Matches the reference screens, removes a second navigation layer ("double navigation", §8 #4), and costs no state change: `threads[]` stays in `WorkspaceState`. |
| D3 | **Editor pane is read-only in v1** (tabs, breadcrumb, line numbers, syntax highlight; reuse `FilePreview`). Editing/saving is out of scope until a separate spec defines save errors and conflicts with the agent writing to the same worktree. | Files is read-only today and `CodeEditor` has no worktree save lifecycle (survey B). A human edit racing a running agent is a data-loss risk; "nothing merges itself" extends to "nothing silently overwrites". Read-only already delivers the Workbench look. |
| D4 | **Default = Review layout; Workbench = a named preset** in the existing Layout menu (user-saved layouts keep working). | Review fits 1440 px and narrow windows; Workbench needs ≥4 zones and a 379 px Chat that stresses tool rows. Presets reuse the saved-layouts model, so no new persistence. |
| D5 | **Rail = automatic + sticky manual override.** Auto-collapse the Navigator to the 55 px rail when the active layout has ≥4 content zones or the window is < 1360 px; a manual toggle always wins and is remembered per project in localStorage, stored separately from `onni-sidebar-width`. Expanding on hover is **not** used. | Gives the Workbench room without surprising users who chose a width; separate storage avoids fighting the existing width preference; no hover-expand avoids layout thrash and focus bugs (cf. §11.1). |
| D6 | **Vertical stack = max 2 views per column, Terminal-over-Preview only in v1**, default ratio 58/42, `role="separator"` horizontal with Up/Down/Home/End (§11.6). | Keeps the layout model additive (optional field, old layouts still parse) and delivers the reference without a general tiling engine. |
| D7 | **Header strip = one layout token (48 px)** used by every zone; Settings top bar 55 px stays equal to the rail width. | Removes per-component padding drift; trivial to enforce in review. |

Consequence for §8: decisions 1–5 stand; D2 refines #4 (Navigator replaces the sidebar, tabs only
for split).

### 12.8 Phase impact

Phase 1 (primitives) adds the 48 px header token, rail mode and the vertical split primitive.
Phase 2 (host) seeds the Review layout and adds Layout-menu presets. Phase 3 (Context) adds
`files-tree` / read-only `editor` pane kinds (D3) and the Terminal-over-Preview stack (D6). The violet token swap (D1) ships first, alone, with a contrast audit. Settings re-skin is
independent and can ship at any phase (pure presentation). Contract additions (§7) are unaffected.

### 12.9 Test and risk notes

- `layout-state.test.ts`, `workspace-columns` tests, saved-layout round-trips and `/runs/:id/layouts`
  schema (≤3 columns, `ViewId` vocabulary) are the main constraints for 12.5 #4: extend, never
  rename; old layouts must still parse.
- Auto-collapse must not fight the manual sidebar width preference (`onni-sidebar-width`); store
  rail state separately.
- Narrow Chat (379 px) stresses tool rows, composer chips and diff comments: add wrapping/overflow
  tests before shipping the Workbench preset.
- Vertical split needs the same `role="separator"` + keyboard contract as §11.6 (orientation
  horizontal, Up/Down, Home/End).
