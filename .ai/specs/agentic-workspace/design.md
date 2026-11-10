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
2. **Host**: workspace state + thread tabs (single visible pane), active-pane routing, URL sync.
3. **Context area**: wrap existing `WorkspaceColumns` views as the right-hand tabbed area; unify
   review onto `<Diff>`; unified task-tree pane.
4. **Split conversations** (2-up), per-pane drafts/scroll, shortcut set, mobile model.
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
