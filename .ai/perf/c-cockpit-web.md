# Performance survey C — cockpit web SPA

Survey date: 2026-11-13. Scope is read-only: `packages/web` and its emitted production bundle.

## Measurement snapshot

`npm run build -w @onni/web` passed in 1.21 s after a clean `npm install` (this worktree initially had no `node_modules`). Vite transformed 3,161 modules. The output has 164 JavaScript files, 5.63 MB raw JS, 4 CSS files / 172 KB raw CSS, and 6.03 MB of assets total. These are artifact totals, not first-load transfer totals: routes and many dependencies are split.

Largest emitted artifacts (Vite's raw / gzip figures):

| Artifact | Raw | gzip | Interpretation |
| --- | ---: | ---: | --- |
| `index-BuvZMnPy.js` | 636.29 KB | 176.80 KB | entry/shared chunk; exceeds Vite's 500 KB warning limit |
| `chunk-BO2N2NFS-Bde6epwZ.js` | 429.89 KB | 130.18 KB | shared chunk |
| `xterm-U4TA8lIC.js` | 338.63 KB | 85.75 KB | deferred terminal dependency |
| `workflow-graph-B5r9lFLC.js` | 293.21 KB | 93.79 KB | deferred React Flow / graph surface |
| `vi-messages-ClKVbFPw.js` | 283.27 KB | 86.40 KB | deferred Vietnamese locale data |
| `task-workspace-DYy9lZ-5.js` | 225.51 KB | 68.12 KB | task-route chunk |
| `i18n-BCMeXy8B.js` | 215.78 KB | 62.93 KB | locale/i18n chunk |
| `react-runtime-CCIEwYL0.js` | 189.64 KB | 59.65 KB | deliberately stable React runtime group |
| `typescript-bsJCZSQ-.js` | 181.07 KB | 16.23 KB | lazy Shiki grammar |
| `index-XKDD2wVE.css` | 151.03 KB | 24.97 KB | global CSS |

Route splitting is present: `routes.tsx:42-100` uses `lazyRoute`/`lazy` for dashboard, compare, task workspace, repository Git, GitHub, tracker, graph, skills, and automations. Heavy dependencies are largely deferred: Shiki core/engine/grammars use dynamic imports (`lib/highlighter.ts:167-202`, grammar chunks include TypeScript 181.07 KB raw); xterm is dynamically imported (`routes/task-workspace/terminal-pane.tsx:129-130`); and graph UI is lazy (`routes/task-workspace/task-workspace.tsx:81-89`). `streamdown` is contained in the lazy task/GitHub paths. Thus the high-risk bundle costs below are the residual entry and task-workspace boundaries, not eagerly loaded syntax highlighting, terminal, or graph libraries.

## Findings

### 1. Entry/shared JavaScript remains above the build warning threshold

- Severity: Medium
- Location: `packages/web/vite.config.ts:44-56`, artifact `packages/work/web/dist/assets/index-BuvZMnPy.js`
- What happens: the production entry/shared chunk is 636.29 KB raw / 176.80 KB gzip; Vite emitted its `>500 KB` warning. The configuration only groups React runtime, so it does not establish budgets or isolate other common dependencies.
- Why it costs: network transfer, JS parse/compile, and startup memory/CPU before the first interactive route. The raw size also raises cache-eviction pressure.
- Scaling: once per cold cache / new build hash, per browser tab. It is independent of runs but affects every cockpit user.
- Evidence: measured build output above; `reactRuntimeChunk` is the sole configured group at `vite.config.ts:20-23,51-55`. The build prints: `Some chunks are larger than 500 kB after minification.`
- Fix proposal (M): add a bundle-analysis CI/report step (source maps or a visualizer) to attribute the 636 KB entry, then move only demonstrably route- or interaction-specific shell features behind dynamic boundaries. Set a compressed initial-JS budget so growth fails visibly. Do not split the React group blindly: the existing stable cache group is intentional.

### 2. Opening any task pays for several workspace panels even when their views are not selected

- Severity: Medium
- Location: `packages/web/src/routes/task-workspace/task-workspace.tsx:40-57,81-89`
- What happens: `TaskWorkspaceRoute` is route-lazy, but its module statically imports `ChangesView`, `CommitsView`, `FilesView`, `ThreadView`, browser/design views, editors, and tree UI. Only terminal and graph columns use `lazy()`. This aligns with the 225.51 KB raw / 68.12 KB gzip `task-workspace` chunk loaded for any `/tasks/:id` route.
- Why it costs: network, parse/compile and heap allocation are paid before rendering a selected chat-only or files-only task view.
- Scaling: every cold navigation to a task route; larger workspace panels make this boundary grow for all task routes.
- Evidence: static imports are at lines 40-57, versus explicit lazy boundaries only at lines 81-89; the measured artifact is `task-workspace-DYy9lZ-5.js` (225.51 KB / 68.12 KB gzip).
- Fix proposal (M): make each optional column panel a `React.lazy` boundary selected by view type, with local `Suspense` fallbacks. Preserve the existing multi-column behavior by allowing concurrently visible panels to load concurrently; do not defer the default Session view if it materially hurts the normal task path.

### 3. Active task Git views poll subprocess-backed endpoints at 4 s, 5 s and 10 s

- Severity: Medium
- Location: `packages/web/src/api/queries.ts:1167-1198,1238-1247`; consumers `routes/task-git/task-changes.tsx:77-83` and `task-commits.tsx:49-54`
- What happens: an active Changes view calls `/changes` every 4 seconds, Commits every 5 seconds, and Git Status every 10 seconds. The query layer admits this is polling while an agent writes. `/changes` returns structured patches, not merely a cheap activity marker.
- Why it costs: repeated local HTTP plus server-side git/worktree inspection (subprocess, disk I/O, CPU), response allocation/transfer, diff parsing/render work, and React Query notifications. This conflicts with the repository’s live-signal rule favoring the WebSocket bus over `refetchInterval` for data owned by Onni.
- Scaling: per mounted active run/view. A multi-column task with Changes, Commits and status consumers can maintain several timers; cost rises with changed-file/patch size and concurrent cockpit tabs.
- Evidence: `useRunChanges` sets `refetchInterval: live ? 4000 : false` at line 1175; `useRunCommits` sets 5,000 ms at line 1246; `useRunGitStatus` sets 10,000 ms at line 1195. Changes enables the first whenever the run is active or worktree preparation is active (lines 77-82).
- Fix proposal (L/M): publish a run-scoped `git changed`/revision marker on the existing WS bus whenever worktree content changes, invalidate/refetch the relevant cached query once per marker (coalesced), and retain a bounded reconnect reconciliation rather than continuous polling. If immediate filesystem detection is unavailable, increase the backstop interval and poll only while the visible Git pane is mounted.

### 4. The app holds a root SSE stream alongside the WebSocket subscription bus

- Severity: Medium
- Location: `packages/web/src/app.tsx:26-28,41`; `packages/web/src/api/global-events.tsx:38-64,742-806`; `packages/web/src/api/ws.ts:6-15,142-206`
- What happens: `GlobalEventsProvider` mounts for the full app lifetime and opens `EventSource('/api/v1/workspace/events')`. Separately, `subscribeTopic` maintains a WebSocket for topic subscriptions (for example health). The global stream parses every run/usage/todo frame and patches/invalidate caches synchronously.
- Why it costs: two long-lived connections per cockpit, duplicate liveness/reconnect machinery, separate JSON/event dispatch paths, and root-level background work even on routes that need no live run data. It also diverges from the AGENTS.md direction: live signals use the WebSocket bus and one socket per local cockpit.
- Scaling: per open tab, then per workspace event. The EventSource is workspace-wide, so activity in other projects is still parsed and filtered in each tab.
- Evidence: `app.tsx:41` always mounts the provider; global-events creates `new Source(url, { withCredentials: true })` at lines 742-751 and registers all event listeners at 767-806. `ws.ts:7-15` explicitly implements one shared socket and topic reference counts.
- Fix proposal (L): add a demand-driven workspace topic to `/api/v1/ws`, move the global-event payload schema and reconnection/reconciliation semantics onto it, then remove the root EventSource. Retain the current batching/inactive-project filtering during migration. Validate remote-auth constraints before removal because the SSE code intentionally uses `withCredentials`.

### 5. The diff fallback can create an unbounded DOM and reparses every patch on a failed lazy-load path

- Severity: Low
- Location: `packages/web/src/components/diff/diff.tsx:87-129,168-188`
- What happens: if the lazy diff renderer cannot load, `DiffFallback` renders every file and executes `file.patch.split('\\n').map(...)` on each render. It deliberately does not virtualize.
- Why it costs: CPU for split/map and React reconciliation; large patches create one DOM node per line, increasing memory, layout and paint cost. It is an availability fallback, so normal successful renderer loads do not take this branch.
- Scaling: per failed diff-engine load, proportional to total changed lines/files and any parent re-render while the fallback remains mounted.
- Evidence: code comment at lines 93-98 says “The fallback never virtualizes”; files map at 119-128 and patch-line mapping at 174-187.
- Fix proposal (S): cap fallback output by file/line count and show a download/open-raw action beyond the cap, or reuse the existing virtualized row shell without importing Shiki/parser code. Keep the current no-blank degradation guarantee.

## Rendering, lifecycle, and data-fetching checks that were healthy

- Long transcript, diff, tasks, picker and commit lists are virtualized where needed: thread switches past roughly 300 rows (`routes/task-thread/thread-scroll.ts:7-14,111-114`); diff uses `virtua` (`components/diff/diff-view.tsx:347-353`); task cards/commits/pickers also use `Virtualizer`. This substantially bounds DOM growth in normal long views.
- Live transcript work is throttled twice: run frames batch at 50 ms (`api/run-events.ts:14-19,201-220`) and history presents live frames at 120 ms with five retained pages (`api/run-history.ts:12-15,304-305`). `TaskThreadRoute` memoizes its two `reduceThread` calls (`task-thread.tsx:89-96`). This avoids the suspected per-token full-tree storm; the residual reducer work is bounded by the visible history window rather than the complete run.
- The WS client has appropriate lifecycle accounting: one lazily opened shared socket, one subscription frame per topic, copy-before-iterate listener dispatch, idempotent cleanup, unsubscribe-on-last-listener, idle close, reconnect, and a heartbeat watchdog (`api/ws.ts:55-206`). No subscription leak was found in this review.
- React Query defaults are sensible for most owned data: five-minute stale time, 30-minute GC, and polling/focus/reconnect refetch disabled (`api/query-client.ts:27-60`). `useRunsIndex` intentionally returns a slim cross-project index rather than full records (`api/queries.ts:1017-1058`). The GitHub reference-status interval is a justified external-service exception controlled by server-supplied `recheckAfterMs` (`api/queries.ts:2249-2262`).

## Ranked top 5

1. **Medium — active Git polling**: replace 4/5/10-second worktree polling with WS invalidation markers; this is the clearest repeatable CPU/disk/subprocess cost.
2. **Medium — permanent SSE plus WS**: converge workspace live events onto the existing demand-driven WS bus to remove one connection and duplicate machinery per tab.
3. **Medium — 636 KB initial/shared chunk**: attribute it with a bundle analyzer and budget compressed initial JS before it grows further.
4. **Medium — 225 KB task-workspace aggregate**: lazily load optional task panels rather than importing all columns at the task boundary.
5. **Low — diff failure fallback**: cap or virtualize fallback rows so a failed chunk cannot turn a large patch into an unbounded DOM.
