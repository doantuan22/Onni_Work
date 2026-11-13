# Performance survey A: server state, Git, and background work

Survey date: 2026-11-13 (Windows 11; static code tracing and read-only filesystem measurements). No tests or `git worktree add` benchmark was run: this is a read-only survey. Runtime latency figures below are marked estimates where not measured.

## Findings

### 1. Limit sweep repeatedly rescans run trees

- **Severity:** High
- **File:line:** `packages/work/src/workflows/run.ts:944,1367-1370`; `packages/work/src/workflows/run/scheduling.ts:495-510`; `packages/work/src/workflows/limits.ts:35-48,99-105`
- **What happens:** One timer checks limits every 15 seconds. Each tick lists all runs, updates every running run's wall-time usage, then calls `evaluateLimits` for each nonterminal run. Each evaluation computes subtree usage; `subtreeOf` repeatedly searches and loops over the complete run array for each tree node.
- **Why it costs:** CPU and event-loop time. Independent runs still produce a full run-array scan for each evaluated run; dispatched trees add repeated scans per descendant. **Estimate:** approximately O(R²) work for R unrelated nonterminal runs, and O(R²·D) with average descendant depth D; the exact coefficient depends on live/queued run mix and tree shape. The tick can also schedule at least one updated run snapshot per running run, though the index write is debounced.
- **Evidence:** `LIMIT_SWEEP_MS = 15_000`; `sweepLimits` calls `evaluateLimits(run, runs)` inside its run loop. `subtreeOf` calls `runs.find(...)` and loops over all `runs` for each queued tree node (`limits.ts:40-48`).
- **Fix proposal:** Build one `id → run` and `parentRunId → children` index per tick, then aggregate each subtree once or compute bottom-up totals; reuse totals when evaluating root and child ceilings. **Effort: M.**

### 2. Installed dependencies dominate measured worktree storage

- **Severity:** High
- **File:line:** `packages/work/src/git-worktree.ts:394-395,449-466`; `packages/work/src/runs/retention.ts:36-55,143-168`; `packages/work/src/index.ts:334-339`
- **What happens:** Every task materializes a Git worktree directory. The checkout itself shares Git objects, but installed `node_modules` files in a worktree are separate working files. Current retention is count-based, not byte-based.
- **Why it costs:** Disk capacity, file-count pressure, and install/cleanup I/O. **Measured now:** five directories under `.ai/onni/worktrees` total about **1,088.9 MiB across 72,888 files**. Two directories contain `node_modules`: about **469 MiB** and **456.7 MiB**; together they account for **792.9 MiB and 59,466 files**. The other three worktrees are about **54.4 MiB each** without `node_modules`. This is a point-in-time measurement, not a per-run universal size.
- **Evidence:** `git worktree list --porcelain` showed five task worktrees. A recursive PowerShell file-size scan measured the figures above. `createWorktreeWithOutcome` issues `git worktree add` for a new task (`git-worktree.ts:462`); retention keeps the newest configured count (`retention.ts:43-55`) and removes directories over that count.
- **Fix proposal:** Avoid repeated dependency installs when tasks share a compatible lockfile, using a safe shared package-manager store/link strategy; add an optional byte-aware reclaim target alongside count retention. Keep worktree boundaries and lifecycle guarantees intact. **Effort: L.**

### 3. A diff page can fan out into many sequential Git processes

- **Severity:** Medium
- **File:line:** `packages/work/src/git-worktree.ts:788-800,812-821,975-1004`; `packages/work/src/git-diff-base.ts:117-145,215-249`; `packages/work/src/server/routes/groups.ts:36-52`; `packages/work/src/server/routes/runs.ts:1037-1046`
- **What happens:** A standard diff request runs `git add -N`, `git merge-base`, then `git diff` (three Git subprocesses). A changed-files request first resolves a fresh diff base, then runs diff and status; base resolution can additionally run remote-config, ref-existence, and merge-base commands. A group details request invokes `worktreeDiffStat` once for each extant variant, concurrently.
- **Why it costs:** Process startup and Git repository scans; Windows subprocess startup is a material fixed cost. **Estimate:** a group page with V variants pays at least 3·V Git processes for diff stats, plus separate process startup overhead (30–100 ms each is the task-order estimate, not a local measurement). Changed-files requests vary by base/ref branch and can be substantially higher than three.
- **Evidence:** One `execFile('git', ...)` call in the `git` helper is used for each Git command (`git-worktree.ts:39-51`); `worktreeDiffStat` has three awaited commands (`812-821`); the group route maps every variant through it (`groups.ts:36-52`).
- **Fix proposal:** Cache resolved diff anchors and immutable committed diff stats by run HEAD/base identity; avoid repeated `git add -N` index mutations for read views and batch compatible status/diff queries where Git supports it. **Effort: M.**

### 4. `runs.json` writes synchronously rewrite and rename the full index

- **Severity:** Medium
- **File:line:** `packages/work/src/runs/store.ts:553-561,2277-2302,2325-2335`
- **What happens:** A one-second debounce coalesces bursts, but each flush synchronously locks the index, reads/parses the existing full JSON array, merges records, serializes the full array, writes a temp file, and renames it over `runs.json`. Run touches during the 15-second limit sweep can keep this path active for long-running tasks. The normal index is capped to 300 nonarchived plus 500 archived settled runs by default; live runs and protected trees are retained, so total size can exceed that bound.
- **Why it costs:** Synchronous disk I/O and JSON CPU block the Node event loop; work and bytes scale with all retained runs per flush. The file rename provides atomicity, but does not make the preceding whole-file work asynchronous.
- **Evidence:** `SAVE_DEBOUNCE_MS = 1_000`; `saveNow` invokes `lockRunIndex`, `mergeWithIndexOnDisk`, `writeFileSync(JSON.stringify(merged))`, and `renameSyncWithRetry`. `mergeWithIndexOnDisk` synchronously reads the full index (`2325-2335`). Defaults are 300 and 500 (`553-554`).
- **Fix proposal:** Preserve atomic replace and cross-process merge semantics while moving the read/serialize/write path to async filesystem APIs and a serialized per-index queue; consider compact record snapshots only after compatibility review. **Effort: M/L.**

### 5. Every run event is synchronously appended to NDJSON

- **Severity:** Medium
- **File:line:** `packages/work/src/runs/store.ts:1747-1785`
- **What happens:** `appendEvent` redacts and serializes each event, then calls `appendFileSync` before emitting the live event. This avoids a write queue and preserves order, but makes persistence part of the agent-output/UI event path. Event files are append-only; unlike the run index, they are not rewritten per event.
- **Why it costs:** Synchronous disk I/O and serialization block the single event loop in proportion to event rate and payload length. High-frequency output/tool-result events can cause a pause per append; Windows storage or antivirus scanning may make individual writes slower. **Estimate:** no local state history existed in this worktree to time individual appends.
- **Evidence:** `persistEvent` calls `appendFileSync(path, line, 'utf8')` (`1751`); `appendEvent` calls it inline before `emit('event', ...)` (`1781-1785`).
- **Fix proposal:** Use a per-run ordered async append queue or writer stream with backpressure and explicit flush points for terminal transitions/shutdown; preserve redaction-before-durability and event ordering. **Effort: M.**

### 6. Some workspace reads synchronously parse the full run index per project/request

- **Severity:** Low
- **File:line:** `packages/work/src/runs/run-index.ts:24-35`; `packages/work/src/server/routes/runs-index.ts:165`; `packages/work/src/server/routes/workspace-search.ts:77`; `packages/work/src/server/routes/workspace-threads.ts:174`; `packages/work/src/runs/store.ts:1351-1356`
- **What happens:** Workspace-level index/search/thread routes use `readRunIndexFromDisk` for projects without an owned in-memory store; it synchronously reads and parses that project's entire `runs.json`. `listPersistedRuns` similarly reads the full JSON file for delivery reconciliation.
- **Why it costs:** Event-loop blocking disk I/O and parse allocations; scales with projects scanned times each project's retained index size. The open project's `listRuns()` path is in-memory and avoids this read.
- **Evidence:** `readRunIndexFromDisk` uses `readFileSync` and `JSON.parse`; the cited routes call it in their project aggregation paths. `listPersistedRuns` is another full-file synchronous parse.
- **Fix proposal:** Cache snapshots by file metadata/version for unopened projects, invalidate on index changes, or use an async scan path with bounded concurrency. **Effort: S/M.**

### 7. Automation polling is bounded but performs real per-source/per-candidate subprocess and network work

- **Severity:** Low
- **File:line:** `packages/work/src/automations/scheduler.ts:301-304,345-410`; `packages/work/src/automations/types.ts:112,167-180`; `packages/work/src/automations/github-poller.ts:187-220,347-379`
- **What happens:** One workspace timer scans enabled definitions across projects, sorts due work, and fires one due item before rescheduling. GitHub poll intervals have a 60-second minimum. A poll uses one `gh api` subprocess per search source/page; review-trigger polls can add timeline page requests per candidate PR, up to the configured timeline page bound.
- **Why it costs:** Scheduler CPU scales with enabled project/automation count on each reschedule; subprocess/network work scales with enabled polls, number of source families, result candidates, and review timeline pages. The global timer and one-at-a-time fire avoid one timer per definition and unbounded tight retry loops.
- **Evidence:** `schedule()` loops over enabled project IDs and definitions then sorts due items (`scheduler.ts:351-410`); interval schema is 60–86,400 seconds (`types.ts:112`); `GithubPoller.poll` loops over sources and spawns `gh` for each search (`github-poller.ts:187-220`); timeline paging adds requests for full pages (`347-379`).
- **Fix proposal:** Keep the single timer; cache/reuse poller handles and instrument subprocess/request counts per poll before optimizing. If definition counts grow, maintain a due-time heap rather than sorting every enabled definition after every poll. **Effort: S/M.**

## Other background-loop observations

- The limit sweep is the recurring run-count-sensitive timer (15 s); the queue watchdog is every 60 s and is documented as a few in-memory checks (`run.ts:935-944`).
- Process usage has one shared `ps` snapshot every 2 s only while at least one process is registered; it stops when the registry empties (`core/process-usage.ts:2-14,113-151`). The worktree-size cache uses a 10-minute TTL and refreshes in the background; on Windows its `du` helper returns unavailable, so it does not recursively size trees (`disk-space.ts:102-125`; `git-worktree.ts:469-475`).
- Host-usage sampling is one shared 2-second timer while subscribed; health refresh is demand-driven by the `health` WebSocket topic and runs every 5 seconds while subscribed (`core/host-usage.ts:394-423`; `server/server.ts:1468-1499`).
- Wait expiry uses a per-wait timeout rather than periodic scanning (`workflows/run/monitoring.ts:214-235`). Disk-floor checks use one synchronous `statfsSync` probe on the spawn/error path (`disk-space.ts:46-61`), not a periodic disk walk.
- `mergeWriteWorkspaceConfig` serializes per path and performs async read + atomic async writes for both the main config and backup (`workspace/config.ts:509-529,567-583`); it is not a hot per-event run-state path.

## Ranked top 5

1. **Limit sweep:** repeated subtree scans can grow quadratically with run count every 15 seconds; pre-index and aggregate once per tick.
2. **Worktree disk:** measured footprint is ~1.06 GiB across five task worktrees, with ~793 MiB in duplicated installed dependency files; reduce/reuse per-worktree installs and consider byte-aware reclaim.
3. **Diff subprocesses:** three Git processes per diff/stat and repeated resolution per variant; cache by HEAD/base and avoid intent-to-add on reads.
4. **Run-index persistence:** full JSON read/merge/serialize/temp-write/rename synchronously on debounce; make the path async while preserving atomic merge semantics.
5. **Event persistence:** synchronous append per event blocks the event loop; introduce ordered async append with bounded buffering and terminal flush.
