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
  PaneRef:   { paneId, projectId, runId }
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
- **Keyboard**: keep the Task Palette and shell Mod-shortcuts; add pane-scoped Mod+1..9 (switch
  tab), Mod+\ (toggle context), Mod+J (terminal), Mod+B (navigator). Shortcuts yield to text
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

## 8. Decisions needed from the owner

1. Scope of "workspace": per project (recommended) vs global across projects.
2. Max simultaneous conversation panes: 2 (recommended) vs N.
3. Interactive permission approvals in scope? (large cross-runner work; defer recommended)
4. Replace the sidebar outright (recommended: Navigator with icon-rail) vs keep it plus a tab bar.
5. Persist workspace state server-side or localStorage only for v1 (localStorage recommended).

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
