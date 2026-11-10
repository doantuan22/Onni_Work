# Verify 2: active pane, terminal, and splitter

Read-only survey of the design against the current `packages/web` implementation. No source,
test, or configuration files were changed, and no test/build/server command was run. “Verified”
below means directly visible in the cited code or test. “Inference” is labeled where it describes
a likely consequence rather than an observed runtime failure.

## Verdicts

| Claim | Verdict | Finding |
| --- | --- | --- |
| 1. Active pane and focus | **PARTLY** | The design’s active-pane model is new. Current code has narrow-layout tabs and global task shortcuts with useful input/dialog guards, but no wide-layout active pane, `ActivePaneContext`, or pane-scoped shortcut router. The proposed `Mod+1..9` also overlaps existing task-tab bindings and browser tab switching. |
| 5. Terminal placement and ownership | **PARTLY** | A run’s terminal can be presented as a column or drawer and the drawer is suppressed when the active layout has a terminal column. Sessions are keyed by run and session IDs. The multi-thread active-owner behavior is not implemented; the drawer label shows the worktree path but not a branch. The placement guard does not enforce one terminal column in layout state. |
| 6. Shared `Splitter` | **PARTLY** | All four handles use a focusable `role="separator"` and pointer capture, but units, bounds, keyboard maps, optional values, reset behavior, geometry, and test coverage differ. The proposed small prop set is not enough to preserve all contracts. |

## Claim 1 — active pane and focus

### Verified behavior

- The design itself identifies this as new host state: the current task workspace’s panes are views
  of one run, while the target adds a per-project ordered thread list and `active: paneId`
  (`agentic-workspace/design.md:31-36, 73-88`). Its stated context-follow-active-thread rule is
  therefore a proposal, not current `WorkspaceColumns` behavior.
- `WorkspaceColumns` has a local `narrowIndex` only for viewports below 1024px
  (`packages/web/src/routes/task-workspace/workspace-columns.tsx:76-93`). On that layout, a Radix
  `Tabs` value change selects the displayed column (`:158-195`; `packages/web/src/components/ui/tabs.tsx:59-75`).
  In the wide layout, each column is a width-styled wrapper with a header and scroller; the wrapper
  has no pane activation handler or active/selected attribute (`workspace-columns.tsx:230-278`).
  The component has no pane-root `pointerdown`, hover, or wheel activation handler. There is no
  workspace `ActivePaneContext` in these files.
- Current task-workspace bare keys are `1..9`, `[`, `]`, `f`, `\\`, `/`, and backtick. The keydown
  listener ignores modifier/repeat/default-prevented events, editable targets, and open dialogs,
  alertdialogs, menus, or listboxes (`packages/web/src/routes/task-workspace/task-workspace.tsx:436-499`).
  The digits switch existing task view tabs (`:451-460, 476-479`); bare `\\` splits the last window,
  `/` focuses the composer, and backtick toggles the drawer (`:483-495`).
- The task palette already ships `Mod+1..9` as `tab:1..9` and `Mod+/` for “Terminal in a column”
  (`packages/web/src/lib/keybindings.ts:154-158, 242-255`). Settings → Keyboard records overrides and
  lets one task-palette command take a chord from another (`routes/settings/keyboard-section.tsx:46-67,
  110-143`; `lib/keybindings.ts:200-214`). `Mod+1..9` are not just theoretical collisions: they
  already execute a task-tab command when the task palette’s global dispatcher sees one
  (`packages/web/src/components/task-palette/task-palette.tsx:293-325`).
- `Mod+N` is reserved by the keybinding recorder for Onni’s new-task action; the command palette
  registers it for the desktop shell and documents that browsers reserve it for a new window
  (`packages/web/src/lib/keybindings.ts:109-131`; `components/command-palette.tsx:541-550`).
  `Mod+\\`, `Mod+J`, and `Mod+B` are not in this app’s reserved set, so Settings can assign them to
  task-palette commands; `chordProblem` rejects only chords in the reserved set, and the assignment
  logic only de-duplicates commands in that registry (`keybindings.ts:110-132, 141-151, 200-214`).
  `Mod+\\` is distinct from the current bare `\\` split binding,
  but an added global action would need to share a collision registry with custom bindings.
- Browser collisions depend on browser and platform. Google Chrome documents Ctrl/Cmd+1..8 and
  Ctrl/Cmd+9 for browser tabs, Ctrl+J for Downloads on Windows/Linux, and Cmd+N for a new window;
  on Mac Chrome uses Cmd+Shift+J for Downloads, not Cmd+J. Firefox documents Ctrl+J and Cmd+J for
  Downloads, Ctrl+B and Cmd+B for Bookmarks, and Ctrl+1..9 for tabs. See [Chrome’s shortcut
  reference](https://support.google.com/chrome/answer/157179) and [Firefox’s shortcut
  reference](https://support.mozilla.org/bm/kb/keyboard-shortcuts-perform-firefox-tasks-quickly).
  The sampled Chrome/Firefox references do not list `Mod+\\`; that is not a guarantee across all
  browsers, desktop shells, or keyboard layouts.
- `isEditableTarget` recognizes inputs, textareas, selects, and contenteditable elements
  (`packages/web/src/lib/use-command-shortcut.ts:15-23`). `useCommandShortcut` suppresses those by
  default and has an explicit xterm rule when a caller opts into shortcuts while editing
  (`:38-65, 74-100`). Task-palette command chords separately yield to the xterm on non-Apple
  platforms, and only allow Mod chords on Apple (`packages/web/src/components/task-palette/task-palette.tsx:665-671`).
  The bare workspace handler gets the xterm textarea through `isEditableTarget` (`task-workspace.tsx:463-467`;
  the terminal renders xterm in `packages/web/src/routes/task-workspace/terminal-pane.tsx:9, 174-193`).
- The command palette uses `Mod+K`, the task palette uses `Mod+P`, and both render through
  `CommandDialog` (`packages/web/src/components/command-palette.tsx:48-53, 541, 571-598`;
  `components/task-palette/task-palette.tsx:156-166, 405-514`). Task-palette command dispatch also
  checks `shortcutsBlocked()` before running; that helper detects dialog, alertdialog, and menu
  roles (`packages/web/src/lib/keybindings.ts:94-100`; `task-palette.tsx:303-325`). The bare task
  workspace handler additionally checks listboxes (`task-workspace.tsx:463-468`). The shared
  `useCommandShortcut` helper itself does not check a pane context or open-dialog selector.
- The terminal explicitly owns terminal copy/paste chords: xterm handles selected-text copy and
  paste on its own textarea, while plain Ctrl-C remains a PTY interrupt
  (`packages/web/src/routes/task-workspace/terminal-pane.tsx:164-193`). That is a concrete reason
  for the new pane shortcut layer to yield while xterm owns focus.
- ARIA/current-pane treatment is limited today. The narrow switcher uses `TabsTrigger` and gets
  tab semantics/active styling from the shared Radix wrapper (`workspace-columns.tsx:172-195`;
  `components/ui/tabs.tsx:59-75`). The wide column wrappers have neither `aria-current` nor
  `aria-selected` nor a `data-active` state (`workspace-columns.tsx:230-278`). Thus the current
  wide layout does not expose the active pane state proposed in the design.

### Recommended design correction

State clearly that `ActivePaneContext` is a new workspace-host mechanism above the existing
per-run `WorkspaceColumns`. Define activation as explicit pane pointer-down, tab selection, and
pane-number shortcut; do not infer it from hover or wheel. Route only workspace-local actions
through the context. Use the shared editable-target predicate plus explicit xterm and modal/palette
guards, and reserve the chosen chords centrally so Settings cannot bind a task action to them.
Reconsider `Mod+1..9` because it already means task-tab navigation and is also browser tab
navigation; if retained, specify how the browser chord is claimed and how existing task-tab
bindings are migrated or scoped. For accessible state, expose a real tab/tabpanel relationship
with `aria-selected` for the pane selector and a visible active treatment; do not rely on the
unmarked wide column wrappers.

## Claim 5 — terminal placement, identity, and active thread

### Verified behavior

- `TerminalDrawer` supports both placement forms: `fill` makes it fill a workspace column and omits
  the height handle; without `fill`, it is a height-sized bottom drawer. It is passed a `runId`
  and supports moving between drawer and column (`packages/web/src/routes/task-workspace/terminal-drawer.tsx:40-77,
  242-253, 357-370`). The task workspace renders the terminal as a column with `fill` and also
  conditionally renders the bottom drawer (`packages/web/src/routes/task-workspace/task-workspace.tsx:665-669,
  823-837`).
- Terminal session identity is **per run plus per session**, not per visual tab or pane. The
  session record has `id` and owner `runId` (`packages/work/src/server/terminal/sessions.ts:57-75`);
  the run terminal API lists sessions by `run.id` and creates them with that ID as owner
  (`packages/work/src/server/routes/terminal.ts:94-110, 113-135`). Multiple sessions for one run
  are the drawer’s terminal tabs (`terminal-drawer.tsx:78-80, 98-124, 257-270`).
- Drawer open/height state is stored under `onni-task-terminal:<taskId>`; height is 120–640 CSS px.
  `task-workspace.tsx` passes the current `run.id` as that task ID (`packages/web/src/routes/task-workspace/drawer-state.ts:9-27,
  72-105`; `task-workspace.tsx:313-329`). This is per run in the current `/tasks/:id` route model.
- The UI’s placement guard is `terminalColumnShown = columns.some(view === 'terminal')` and
  `drawerShown = terminalAllowed && drawer.open && !terminalColumnShown`
  (`packages/web/src/routes/task-workspace/task-workspace.tsx:331-336`). The comment says this
  avoids two views fighting over the same PTY size (`:331-333`). This enforces drawer-vs-column
  exclusivity for the current task layout, not exclusivity of terminal sessions: the server allows
  multiple sessions and the drawer deliberately exposes multiple terminal tabs. Also, the layout
  reducer’s `addColumn` appends the requested view without a duplicate-view check
  (`packages/web/src/routes/task-workspace/layout-state.ts:502-518`); the `.some()` guard does not
  enforce exactly one terminal column.
- The drawer is mounted after the task-workspace stage and receives `run.id`, the route’s run, not
  an active thread ID (`packages/web/src/routes/task-workspace/task-workspace.tsx:823-837`). Current
  code has one run per workspace; the design’s active-thread context is a new multi-run host
  (`agentic-workspace/design.md:31-36, 64-88`). Therefore the two-up active-thread drawer
  placement is not an existing behavior.
- The terminal header displays host, project directory name, and `active.cwd` (the worktree path)
  (`packages/web/src/routes/task-workspace/terminal-drawer.tsx:86-94, 320-338`). It does not display
  a Git branch. A branch label would be a new field/data lookup, not a property of current terminal
  session identity.
- Each `TerminalDrawer` instance renders its own mounted `TerminalPane` for each session and chooses
  a local `activeId` (`terminal-drawer.tsx:78-80, 240-240, 399-410`). **Inference:** if two visual
  columns mount the same run’s session IDs, they would have independent selected tabs/xterm clients
  writing to the same session; each client can also resize the same PTY. `TerminalPane` fits and
  reports its rendered dimensions to that run/session (`packages/web/src/routes/task-workspace/terminal-pane.tsx:198-205`;
  `packages/web/src/api/client.ts:2838-2845`). This risks competing terminal sizes and mismatched
  screen wrapping. Two different runs, by contrast, have distinct `runId` ownership and can each
  have sessions without sharing the PTY.

### Recommended design correction

Specify that placement is exclusive **per run** while terminal tabs/sessions remain multiple
`sessionId`s owned by that `runId`. Make the workspace host pass the active thread’s `runId` into a
single drawer anchored to the context region for that thread; persist placement/height by run ID.
Show host, project, branch, and worktree path together, with branch sourced from run/worktree data
rather than guessed from `cwd`. Enforce at most one mounted terminal surface per run (including
duplicate columns), or deliberately coordinate a shared xterm/resize owner if duplicate views are
required. Keep different runs’ terminal sessions independently keyed.

## Claim 6 — shared `Splitter` primitive

### Verified contracts

| Handle | Value and bounds | Keyboard behavior | ARIA and pointer behavior |
| --- | --- | --- | --- |
| `SidebarResizeHandle` in `packages/web/src/components/sidebar-frame.tsx` | Width in CSS px, 264–420; reset to 264; 16 px arrow step (`packages/web/src/lib/sidebar-width.ts:14-28`). | Left/right ±16; Home/End to bounds; double-click resets (`packages/web/src/components/sidebar-frame.tsx:198-212, 230`). | Vertical separator, named “Resize the sidebar”, `aria-valuenow/min/max`, focusable. Captures pointer, focuses after down, releases on up/cancel (`packages/web/src/components/sidebar-frame.tsx:171-229`). `packages/web/src/components/app-shell.test.tsx:603-612` asserts role, orientation, name, focusability, and range. |
| `ColumnDivider` in `packages/web/src/routes/task-workspace/workspace-columns.tsx` | Left column width in percent; dynamic min/max from the adjacent pair, with a 12% floor (`packages/web/src/routes/task-workspace/layout-state.ts:181-200`; `workspace-columns.tsx:528-534, 585-590`). Pointer delta is normalized by row width (`workspace-columns.tsx:550-558`). | Left/right ±2%; Shift+Arrow ±10%; no Home/End or double-click reset (`packages/web/src/routes/task-workspace/workspace-columns.tsx:568-576`). | Vertical separator, indexed label, rounded `aria-valuenow/min/max`; pointer capture and release on up/cancel (`packages/web/src/routes/task-workspace/workspace-columns.tsx:539-597`). I found no component test asserting this handle’s ARIA contract. |
| `DrawerResizeHandle` in `packages/web/src/routes/task-workspace/terminal-drawer.tsx` | Height in CSS px, 120–640 (`packages/web/src/routes/task-workspace/drawer-state.ts:14-23`). | Up/down ±16 px or ±64 with Shift; Home=max, End=min (`packages/web/src/routes/task-workspace/terminal-drawer.tsx:535-550`). | Horizontal separator, named “Resize terminal”, valued range, focusable; pointer capture/release (`packages/web/src/routes/task-workspace/terminal-drawer.tsx:510-567`). The drawer tests cover session lifecycle, not this handle’s ARIA contract (`packages/web/src/routes/task-workspace/terminal-drawer.test.tsx:96-132, 180-251`). |
| `TreePaneResizeHandle` in `packages/web/src/routes/task-git/tree-pane-resize.tsx` | Width in CSS px, 160–720, additionally capped to 60% of available width; untouched is `null` and leaves responsive CSS sizing (`packages/web/src/lib/tree-pane-width.ts:10-26`; `tree-pane-resize.tsx:54-59, 85-88`). | Left/right ±16 px; Home/End to bounds; double-click clears the stored override (`packages/web/src/routes/task-git/tree-pane-resize.tsx:112-145`). | Vertical separator with label and min/max; `aria-valuenow` omitted while width is `null`; pointer capture/release (`packages/web/src/routes/task-git/tree-pane-resize.tsx:90-147`). Tests assert role, missing/default `aria-valuenow`, value updates, and keyboard/reset behavior, but not orientation/min/max (`packages/web/src/routes/task-git/tree-pane-resize.test.tsx:31-39, 63-84`). |

Persistence stays region-specific today: `useSidebarWidth` writes the shared `onni-sidebar-width`
local preference on each change (`packages/web/src/components/sidebar-frame.tsx:58-70, 97-106`;
`packages/web/src/lib/sidebar-width.ts:11-28`);
`ColumnDivider` dispatches pair-width changes into task layouts saved by `useWorkspaceLayouts` to
the owning host, with a 400ms coalesced PUT during a drag (`packages/web/src/routes/task-workspace/use-workspace-layouts.ts:3, 32-49, 99, 191-215, 268-283`);
the drawer uses `onni-task-terminal:<runId>` (`routes/task-workspace/drawer-state.ts:9-11, 98-105`);
and tree width uses the cross-view `onni-tree-pane-width` local preference, where `null` removes
the override (`packages/web/src/routes/task-git/tree-pane-resize.tsx:16-20, 40-51`; `lib/tree-pane-width.ts:8, 38-46`).

The sidebar test also checks persisted/dragged values (`packages/web/src/components/app-shell.test.tsx:615-620`),
while the focused `sidebar-frame` tests cover shared width, keyboard steps, and reset
(`components/sidebar-frame.test.tsx:41-53, 85-91`). I found no test assertion for the drawer
splitter’s ARIA values or the column divider’s ARIA values; their current code does provide those
attributes, as cited above.

All four implementations use `setPointerCapture` and release when a drag ends. The common `role="separator"`,
focusability, pointer capture, and arrow-key interaction support a shared headless interaction
primitive. They do not share one scale or full key contract: three report px and one reports percent;
the column’s pointer conversion and bounds are pair-relative; tree-pane `aria-valuenow` is optional;
and Home/End, Shift steps, reset, focus transfer, and callback timing vary.

The proposed `value/min/max/step/orientation + onChange/onCommit` surface is therefore too small to
preserve the behavior as-is. Existing callbacks apply changes during every key press and pointer
move; there is no common commit callback today. A shared primitive would also need configurable
pointer-to-value mapping (including row-relative percent), key map and large-step rules, Home/End
direction, optional `aria-valuenow`, focus-on-pointer behavior, reset action, and per-instance
`data-slot`/label. A render/adapter layer can keep each region’s persistence and markup contracts,
but tests that query existing selectors and aria values require those contracts to remain intact.

`design-guardian.test.ts` applies token/color checks to shipped UI and stylesheet sources: no raw
hex, amber text, raw black/white utilities, or `dark:` variants (`packages/web/src/design-guardian.test.ts:44-96`).
It does not prescribe splitter dimensions or ban arbitrary pixel geometry. Keep the primitive
headless and let each region retain its own hit area, spacing, color-token classes, and persistence
adapter.

### Recommended design correction

Extract only the shared interaction mechanics, with a typed adapter contract for units, pointer
mapping, dynamic bounds, axis/key mapping, optional ARIA value, reset, and change/commit timing.
Keep the four wrappers responsible for storage/API persistence, labels, `data-slot` selectors,
classes, and their existing `role="separator"` attributes. Preserve current defaults (px versus
percent, pair-relative bounds, Shift steps, Home/End direction, null tree width, and reset actions).
Treat “all existing tests unchanged” as feasible only if the wrapper DOM and current behavior stay
identical; the simple proposed prop list alone cannot guarantee it. Add focused column-divider and
drawer-handle ARIA/keyboard tests when implementation work begins.
