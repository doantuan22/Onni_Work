# Manager–Worker wave A: `onni task verify` and `onni task conflicts` — implementation spec

Status: **spec, no code** (2026-11-06). Implements proposals A1 and A2 of
[`docs/design/manager-worker-proposals.md`](../../docs/design/manager-worker-proposals.md) and reopens the items
`#4` (verify) and `#5` (file overlap) that
[`2026-11-03-manager-worker-gaps-plan.v2.md`](2026-11-03-manager-worker-gaps-plan.v2.md) §14 deferred, on exactly
the conditions §14 lists. The code and [`AGENTS.md`](../../AGENTS.md) win over this file where they disagree.

Four parts, each its own PR through the full gate
(`npm run typecheck && npm test && npm run test:unit && npm run build && npm run test:package`; on native
Windows CI is the authority, v2 §1.10). **They run in series, never in parallel** (v2 §1.12): all of them touch
`run.ts`, `server.ts`, `task-cli.ts`, `commands.ts` and `manager-worker.ts`.

| Order | Part | One line |
| --- | --- | --- |
| 1 | **A — shared helpers** | Read-only git helpers, `discoverVerifyCommands` extraction, a ref resolver. No route, no CLI, no visible behavior. |
| 2 | **A1 — `verify`** | `POST /runs/:id/verify` + `onni task verify`. Runs repo checks in a settled worker's worktree. |
| 3 | **A2 — `conflicts`** | `GET /runs/:id/conflicts` + `onni task conflicts`. Advisory overlap / scope / trial-merge report. |
| 4 | **A1b — `verify --baseline`** | Same commands in a temporary worktree at the diff base; report only NEW failures (heuristic). |

A2 is independent of A1; the order above puts A1 first only because it is the larger safety win. A1b needs A1.

---

## 0. Corrections to the order's premises, found while reading the code

Read these first: each changes a design decision below.

1. **The manager command block is already at ~93 % of its budget.** The nine manager `brief` strings in
   `dispatch/commands.ts:31-106` sum to ≈ 1 397 characters (measured by evaluating the table) against
   `MANAGER_COMMANDS_MAX_CHARS = 1_500` (`dispatch/prompt-budget.ts`). Two more briefs overflow it, and
   `clampLines` (`commands.ts:129`) silently drops whole TAIL lines, so a naive add makes `tree` (and then others)
   vanish from the manager's brief. A1 and A2 each raise the cap in the same commit as the table entry (§3.4).
2. **`--scope` is not stored.** `dispatchInputSchema.scope` (`contract/dispatch.ts:405`) is only rendered into the
   child's task envelope (`childTaskEnvelope`, `dispatch/engine.ts:113`); `RunDispatch` has no `scope`. A2's
   "files outside a path-like scope" needs it persisted (§6.2, optional field, with an envelope-parse fallback).
3. **`git merge-tree --write-tree` exits 1 both for a conflict and for a bad ref.** Verified locally (git 2.56):
   a conflict prints `<tree-oid>\0<file>\0` on stdout and exits 1; `merge-tree: nope - not something we can merge`
   goes to stderr, stdout is empty, and the exit is also 1. Only "stdout starts with `<hex oid>\0`" tells them apart
   (§4.2).
4. **There is no reusable check runner.** `runShellCheck` (`workflows/landing.ts:60`) returns only `{ ok, output }`,
   defaults to `process.env`, has a 10-minute timeout and an 8 000-char tail. Verify needs per-command exit code,
   duration, timeout flag and a minimal env. It reuses the pieces: `resolveBash` / `withBashPath` /
   `BASH_MISSING_MESSAGE` (`core/bash-path.ts:85,127,123`), `killProcessTree` (`core/antigravity-runner.ts:173`),
   `utf8Collector` (`core/utf8-chunks.ts`).
5. **`pruneOrphans` deletes unknown directories under `.ai/onni/worktrees/`** (`git-worktree.ts:1013-1039`). The A1b
   baseline worktree must therefore live under `.ai/onni/tmp/` (already in `DATA_GITIGNORE_ENTRIES`, `tmp/`).
6. **A synchronous verify is bounded by its HTTP client.** Node's fetch (undici) is believed to cut a request that
   has not produced response headers within 300 s, and an agent's own shell tool has a command timeout of its own.
   Verify is therefore capped at 280 s in total (§5.5) and the async alternative is an explicit owner decision (§9).
7. **The project's required checks come from `loadConfig(repoRoot).requiredChecks`** (`config.ts:156`, the trunk-based
   "checks every auto-land must pass", ≤ 10 entries of ≤ 2 000 chars). `contract/workspace.ts:489` is only the
   Settings response shape (`:554` its input). Read the checkout's config — never a worker's worktree copy
   (a worker could edit a tracked `.ai/onni/config.json` there).
8. **Reports reach the manager before it can verify.** `reportSettledChildToParent` (`run.ts:~3965-4090`) renders
   `checks (worker-reported, not verified): …` at settle (`engine.ts:228-231`, tests `engine.test.ts:329,371`).
   "Verify replaces the label" therefore cannot be a rewrite of an already-delivered message; §5.8 defines what it
   does mean.
9. **`:id` in every manager route is the CALLER** (v2 §1.2; `peek`, `memory`, `plan`, `ask`, `merge`). The proposal's
   `POST /runs/:id/verify` follows that: the target worker travels in the body (`target`), exactly as `merge` carries
   `source` and `peek` carries `target`.

## 1. Anchors read

| Area | File:line |
| --- | --- |
| Design source | `docs/design/manager-worker-proposals.md:19-97,139-153`; `.ai/specs/2026-11-03-manager-worker-gaps-plan.v2.md` §1 (37-77), §3 (103-143), H3 (191-216), §7 peek (429-512), §12 (773-801), §14 (820-826) |
| Rules | `AGENTS.md` Invariants ("Unattended runs are fenced", "A roster is a fence", "Degradation is a value, not a throw"), Zero config, "Changing a mechanism that already works", Windows development machine |
| Access | `dispatch/access.ts:12` `treeRootOf`, `:20` `requireRootManager`, `:31` `requireSameTree` |
| Contract | `contract/src/dispatch.ts:56-82` caps, `:108-135` peek schemas, `:259-265` `dispatchCheckSchema`, `:268-284` `dispatchReportSchema`, `:326-392` `dispatchSchema`, `:399-422` `dispatchInputSchema` |
| Routes | `server/server.ts:4537` `requireDispatch`, `:4546-4555` dispatch family + gates, `:4626-4650` peek route, `:4651-4670` memory family (second chained family), `:7797` mount |
| RunManager | `workflows/run.ts:1429` constructor options, `:1510` `dispose`, `:2722-2733` `dispatchOf`/`updateDispatch`, `:2875` `peekFor`, `:2912` `peekEntry`, `:2967` `addManagerMemory` (ledger + note template), `:3342-3395` `mergeFromAgent`, `:~3875` the `dispatch:` object built in `dispatch()`, `:3931` `recordReport`, `:~3965-4090` `reportSettledChildToParent`, `:4827` `cancel`, `:4968` `isActive`, `:7635-7655` graph-wait `childSettleReport`, `:8892-8950` `landingPolicy`/`landNow` (the `{ ...process.env }` this spec must NOT copy) |
| Engine | `dispatch/engine.ts:34-43` `IN_FLIGHT_STATUSES`/`TERMINAL_STATUSES`/`isTerminalStatus`, `:113` scope line, `:228-231` `checksLine`, `:246-311` `childSettleReport`, `:322-336` `pendingReportsBlock` |
| Tree files | `dispatch/tree-fs.ts:42` `unitDir`, `:69` `taskPaths`, `:160` `writeReport`, `:169` `appendLedger` |
| Peek | `dispatch/peek.ts` `SETTLED`, `orderPeekCandidates`, `formatPeek`/`filesLine` |
| CLI | `dispatch/task-cli.ts:13` imports, `:58-77` `callRoute`, `:90` `checkArg`, `:241` `merge`, `:267` `peek`, `:412` `default` |
| Command table | `dispatch/commands.ts:21-106` table, `:129` `clampLines`, `:143` `managerCommandsBlock`; `commands.test.ts:12` `CLI_COMMANDS` |
| Prompt | `dispatch/prompt-budget.ts` (all), `workflows/manager-worker.ts:273` commands block, `:287-292` "Integrating", `:301` `WORKER_PROMPT`; `manager-prompt.test.ts:142,162,223,388` budget tests |
| Shell + processes | `workflows/landing.ts:60-100` `runShellCheck`, `core/bash-path.ts:85-135`, `core/antigravity-runner.ts:173` `killProcessTree`, `core/utf8-chunks.ts` |
| Verify discovery | `core/antigravity-permissions.ts:30-60` (`VERIFY_SCRIPTS`, `discoverVerifyCommands`), used at `core/antigravity-runner.ts:34,263`, tested `antigravity-permissions.test.ts:80-97` |
| Git | `git-worktree.ts:20` `WORKTREES_DIR`, `:38` private `git()`, `:294` `refuseBelowDiskFloor`, `:313` `createWorktree`, `:439` `removeWorktree`, `:~870-975` read-only section (`gitReadOnly`, `porcelainPaths`, `worktreeChangedFilesReadOnly`, `worktreeHeadShort`), `:975` `worktreeChangedFiles` (`git add -N`, forbidden here), `:1013` `pruneOrphans`; `git-diff-base.ts:56-70,215` `GitRunner`/`resolveTaskDiffBase`; `git-refs.ts` `isSafeGitRef` |
| Config | `config.ts:153-156` `landing`/`requiredChecks`, `contract/workspace.ts:489,554`, `data-gitignore.ts` (`tmp/`, `dispatch/`) |
| Tests | `server/contract-parity.dispatch.test.ts:34-78,150`, `server/dispatch-api.test.ts:21,141-165,267-275`, `workflows/dispatch-engine.test.ts:519-580`, `dispatch/task-cli.test.ts`, `dispatch/engine.test.ts:329,371`, `server/route-parity.test.ts` |

---

## 2. Cross-cutting rules (apply to every part)

1. **Contract-first, parity both ways** (v2 §1.1): every new schema lives in `packages/contract/src/dispatch.ts`,
   is exported through `contract/src/index.ts:21` (already `export *`), and is asserted `Exact` in
   `contract-parity.dispatch.test.ts`. Request halves use `z.input`. Optional response keys are spread
   conditionally (`key: maybeUndefined` is the recurring mismatch named in AGENTS.md); literals that Hono must keep
   narrow carry `as const`.
2. **Routes are chained into the existing dispatch family**, never loose `app.get`. Both new routes join
   `dispatchRoutes` (`server.ts:4546`) and get `.use('/runs/:id/verify', requireDispatch)` /
   `.use('/runs/:id/conflicts', requireDispatch)` beside the others (`:4547-4554`) — explicit paths, never
   `use('*')`. They are therefore automatically mounted under both `/api/v1` and `/api/v1/p/:projectId`
   (`route-parity.test.ts` iterates the manifest; no edit needed, but it must stay green).
3. **Auth on the server** (v2 §1.2/§1.3): `requireRootManager(caller, '<action>')` → 403/404, `requireSameTree` →
   409 for a target outside the caller's tree. Never in the prompt only.
4. **Everything shown to a model is capped and redacted**: `store.redactRunText(<run id>, text)` on every command
   string, tail line and file name that came from a worker. File names and commands are worker-influenced.
5. **Degradation is a value** (AGENTS.md): "cannot run" is `{ state: 'unavailable', reasonCode, reason }` with HTTP 200,
   never a throw and never a 5xx. Refusals about WHO may call or WHAT state the worker is in are 4xx.
6. **No new `ONNI_*` variable; `.env.example` unchanged.** No new config key either (zero-config): the command list is
   discovered (§5.3). The only "knobs" are constants in the contract.
7. **Windows**: verify needs bash (Git for Windows). Missing bash → `unavailable` / `no-bash` with
   `BASH_MISSING_MESSAGE`. PowerShell-only machines get that value, not a failure. `ONNI_DRY_RUN=1` →
   `unavailable` / `dry-run` (no command is executed, same stance as `worktree-lifecycle/executor.ts:71`).
8. **Ledger / note**: write actions (`verify`) write `appendLedger` + `note` events (v2 §1.6, template
   `addManagerMemory`, `run.ts:2970`). Read-only `conflicts` writes neither — same as `peek`. It does create
   unreferenced git objects via `merge-tree` (§4.2); it writes no ref, no index, no working file.
9. **State is optional**: new `RunDispatch` fields are optional; old `runs.json` records parse unchanged
   (`runs.json` is read all-or-nothing, see the `PENDING_ASK_MAX_QUESTIONS` comment at `contract/dispatch.ts:16-21`,
   so a new field must also be tiny and never raise an existing bound).
10. **Docs**: each part appends a "Phụ lục" to `docs/design/manager-worker.md` (routes, schemas, known limits),
    after the last existing appendix (H). Without it the part is not accepted (v2 §1.11).

---

## 3. Shared constants and the prompt-budget change

### 3.1 Constants (add to `contract/src/dispatch.ts` beside `REPORT_FILES_MAX`…`PLAN_PROMPT_MAX_PARTS`, lines 62-82)

Same rule as that block: one place, declared BEFORE the schemas that read them.

| Constant | Value | Used by |
| --- | --- | --- |
| `VERIFY_MAX_COMMANDS` | 10 | result array bound (= `requiredChecks` max, `config.ts:156`) |
| `VERIFY_MAX_RUNS_PER_WORKER` | 3 | per-worker cap (§5.6) |
| `VERIFY_COMMAND_TIMEOUT_MS` | 120_000 | per-command kill |
| `VERIFY_TOTAL_TIMEOUT_MS` | 280_000 | whole verify (§5.5); the CLI derives its fetch signal from it |
| `VERIFY_TAIL_MAX_LINES` | 40 | per failed command |
| `VERIFY_TAIL_MAX_CHARS_PER_LINE` | 200 | |
| `VERIFY_TAIL_TOTAL_MAX_CHARS` | 8_000 | all tails in one answer (same figure as `PEEK_ALL_MAX_CHARS_TOTAL`) |
| `VERIFY_WARNINGS_MAX` | 5 | |
| `CONFLICTS_MAX_PAIRS` | 20 | overlap pairs in one answer |
| `CONFLICTS_FILES_MAX` | `REPORT_FILES_MAX` (15) | file names per pair / per worker / per trial merge |
| `CONFLICTS_TRIAL_MAX` | 8 | trial merges per call |

Workers per conflicts answer reuse `PEEK_MAX_ENTRIES` (12). Timeouts that only the server needs
(`CONFLICTS_TRIAL_TIMEOUT_MS = 10_000`, `CONFLICTS_TOTAL_TIMEOUT_MS = 20_000`, `VERIFY_CAPTURE_BYTES = 262_144`)
stay private constants in `dispatch/verify.ts` / `dispatch/conflicts.ts`.

### 3.2 Why contract and not `limits.ts`
`limits.ts` holds run-limit modes (`RUNNERS_WITHOUT_COST` etc.); the manager-facing caps already sit in
`dispatch.ts:56-82`. Follow the neighbour.

### 3.3 Prompt budget — measured, then changed (`dispatch/prompt-budget.ts`)
Current: commands block ≈ 1 397 / 1 500; `PROMPT_MAX_CHARS` is a sum of the component caps (computed, never
restated; `docs/design/manager-worker.md` Phụ lục C measured BASE at 6 413 worst case against `MANAGER_PROMPT_BASE_MAX_CHARS = 6_500`).

- **A1**: `MANAGER_COMMANDS_MAX_CHARS` 1 500 → 1 800 (verify brief ≈ 250 chars).
- **A2**: 1 800 → 2 100 (conflicts brief ≈ 220 chars).
- **A1** edits the fixed "Integrating" text (§5.9), net ≈ +150 chars. If `manager-prompt.test.ts:142/162/223/388`
  go red, raise `MANAGER_PROMPT_BASE_MAX_CHARS` by exactly the measured delta and say why in the file's comment
  block; do **not** trim safety text (Guard, fence, "never push") to make room.
- `PROMPT_MAX_CHARS` rises automatically because it is the sum.

### 3.4 Table order
New entries go **after `peek`, before `memory`** in `TASK_COMMANDS` (`commands.ts:76-90`), so even a future
overflow clamps `memory`/`plan`/`tree` (least safety-relevant) before the verification pair. Update
`CLI_COMMANDS` in `commands.test.ts:12` in the same commit; the "holds every command the CLI answers" test pins the
order.

---

## 4. Part A — shared helpers (no route, no CLI)

Goal: land the read-only git primitives and the extraction once, with their tests, so A1/A2/A1b only compose them.
Zero behavior change: existing suites stay green untouched (the antigravity test moves, §4.1).

### 4.1 Extract `discoverVerifyCommands` → `core/verify-commands.ts` (new)
- Move `VERIFY_SCRIPTS` and `discoverVerifyCommands(cwd)` out of `core/antigravity-permissions.ts:30-60` into
  `packages/work/src/core/verify-commands.ts`; **the function body is unchanged** (npm `test|build|lint|typecheck|check`
  scripts, then `cargo check`/`cargo test` for a `Cargo.toml`). `antigravity-permissions.ts` re-exports it so
  `antigravity-runner.ts:34` and the existing import in `antigravity-permissions.test.ts:11` need no edit.
- Do **not** change the output list: the agy `allow-rules` grants are built from it (`antigravity-runner.ts:263`);
  AGENTS.md says the level is experimental and exact-line based, so a "better" list would silently change a permission.
- Add `resolveVerifyCommands` in A1, not here (it needs config and the caller's worktree).
- Tests: `core/verify-commands.test.ts` — the three cases of `antigravity-permissions.test.ts:80-97` copied verbatim
  (list order `['npm test','npm run build','npm run lint','cargo check','cargo test']`; undefined cwd → `[]`; missing
  dir → `[]`), plus "an unreadable `package.json` yields no npm lines but still the cargo lines". The old test file
  keeps its `discoverVerifyCommands` describe (it proves the re-export) and shrinks to the `antigravitySettings`
  assertions.

### 4.2 `trialMergeTree` in `git-worktree.ts` (beside the read-only section, after `worktreeHeadShort`)
```ts
export type TrialMergeState = 'clean' | 'conflict' | 'unavailable' | 'timeout';
export interface TrialMergeResult { state: TrialMergeState; files: string[]; omitted: number; reason?: string }
export function classifyMergeTree(run: { exitCode: number | null; stdout: string; stderr: string }, max: number): TrialMergeResult   // pure
export function parseGitVersion(stdout: string): [number, number, number] | null                                                    // pure
export async function trialMergeTree(repoRoot: string, leftBranch: string, rightBranch: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number; max?: number }): Promise<TrialMergeResult>
```
- Command: `git --no-optional-locks merge-tree --write-tree --name-only --no-messages -z refs/heads/<left> refs/heads/<right>`
  with `cwd = repoRoot` (merge-tree needs the object database, not a working tree; worktrees share it). Refs are
  passed fully qualified (`refs/heads/…`) so they can never read as options; both branch names additionally pass
  `isSafeGitRef` (`git-refs.ts`) and are refused as `unavailable` otherwise.
- Output (verified, git 2.56): exit 0 → `<oid>\0` → `clean`. Exit 1 with stdout matching `/^[0-9a-f]{40,64}\0/` →
  `conflict`; the conflicted paths are the NUL-separated records after the first (stop at the first empty record;
  `-z`/`--name-only` avoid quoting; `--no-messages` drops the informational section). Exit 1 without that prefix
  (bad ref, e.g. `merge-tree: nope - not something we can merge`) or any other exit → `unavailable` with the first
  stderr line as `reason`. Exit 129 / usage text / "unknown option" (git < 2.38, which lacks `--write-tree`) →
  `unavailable`, reason `needs git 2.38 or newer`. `parseGitVersion` backs an optional up-front probe so the reason
  can name the installed version; a failed probe is not an error (the exit classification is the authority).
- Timeout is real: it reuses the file's `gitReadOnly(cwd, args, signal)` shape (`execFile({ signal })`, `:879`) with
  an `AbortController` per call + forwarded outer signal; abort → `timeout` and the child is killed. Default 10 s.
- **Writes**: `merge-tree --write-tree` writes tree/blob objects into `.git/objects` (unreferenced, collected by
  `git gc`). It writes no ref, no index, no worktree file. State this in the helper's doc comment.
- `files` sorted, de-duplicated, `max`-cut with `omitted`; paths pass through unchanged (redaction is the caller's job).

### 4.3 `resolveReadOnlyDiffBase` (needed by A1b; add here to keep git code in one PR)
```ts
export async function resolveReadOnlyDiffBase(worktreePath: string, baseRef: string,
  opts?: { taskBranch?: string; runStartedAt?: string; signal?: AbortSignal; timeoutMs?: number }): Promise<string | undefined>
```
Calls `resolveTaskDiffBase` (`git-diff-base.ts:215`) with a runner built on `gitReadOnly` (no `git add`, no fetch —
`freshestBaseRef` only reads local refs, `git-diff-base.ts:118-135`), then resolves the answer to a full commit sha
with `rev-parse --verify --quiet <ref>^{commit}`. Missing worktree / unsafe ref / timeout → `undefined`.
`resolveTaskDiffBase`'s result is the merge-base (a sha) unless HEAD left the task branch (then `'HEAD'` or a baseline
sha); for the baseline use only a sha result, otherwise `undefined` → baseline `unavailable` (A1b).

### 4.4 Changed-file helpers
- Export `dropOnniDataPaths(paths: string[]): string[]` (pure, in `git-worktree.ts` or a tiny `dispatch/paths.ts`):
  removes `.ai/onni/` entries so engine files in a worker worktree do not appear as overlap. (`worktreeChangedFilesReadOnly`
  itself stays byte-for-byte as is — peek and settle depend on it.)
- Do **not** use `worktreeChangedFiles` (`:975`, runs `git add -N .`) anywhere in wave A.

### 4.5 `resolveRunRef` in `dispatch/access.ts`
```ts
export function resolveRunRef(runs: readonly RunRecord[], ref: string): RunRecord | 'none' | 'ambiguous'
```
Exact id, else prefix of ≥ 6 chars; **two prefix matches → `'ambiguous'`** (→ 409 "ambiguous id, give more
characters"). `peekFor` (`run.ts:2886`) and `mergeFromAgent` (`run.ts:3374`) each have an inline copy that takes the
first match; **leave them alone in this wave** (AGENTS.md "changing a mechanism that already works") and note the
follow-up in the doc appendix.

### 4.6 `appendReportSection` in `dispatch/tree-fs.ts`
`appendReportSection(dataDir, rootRunId, runId, heading, body): boolean` — appends `\n## <heading>\n\n<body>\n` to
`units/<id8>/report.md` (`taskPaths(...).report`) if the file exists; returns false (silently) otherwise. Best-effort,
same contract as `appendLedger` (`:169`): a missing file is a tree with no history, not an error. Never rewrites
`writeReport`'s "Settled:" line.

### 4.7 Part A test list (exact)
- `core/verify-commands.test.ts` (new): the four cases in §4.1.
- `core/antigravity-permissions.test.ts`: unchanged `discoverVerifyCommands` describe still green (re-export proof).
- `git-worktree.test.ts` — new `describe('trialMergeTree')`:
  - `classifyMergeTree`: `{0,'<oid>\0'}` → clean; `{1,'<oid>\0f.txt\0'}` → conflict with `['f.txt']`; `{1,'',stderr:'merge-tree: nope - not something we can merge'}` → unavailable with that reason (**the exit-1 ambiguity test**); `{129,'',usage}` → unavailable `needs git 2.38 or newer`; more than `max` files → `omitted`.
  - `parseGitVersion('git version 2.56.0.windows.2')` → `[2,56,0]`; garbage → null.
  - Real git (capability check **inside** the test: probe `git merge-tree --write-tree` on a scratch repo and return early if it is unavailable — no `.skip`): clean pair; conflicting pair lists the file; unknown ref → unavailable; option-like branch name refused. **Read-only assertion:** `git for-each-ref`, `git ls-files --stage` and `git status --porcelain` identical before/after in a repo with a dirty worktree.
  - Real timeout: an already-aborted signal returns `timeout` without spawning.
- `git-worktree.test.ts` — `resolveReadOnlyDiffBase`: returns the fork-point sha for a task branch; `undefined` for a missing directory, an unsafe ref and an aborted signal; index unchanged (stage listing compared).
- `git-worktree.test.ts` — `dropOnniDataPaths`: removes `.ai/onni/…`, keeps `src/.ai/onni-like.ts`.
- `dispatch/access.test.ts` — `resolveRunRef`: exact id; unique ≥ 6-char prefix; < 6 chars never prefix-matches; two prefix matches → `'ambiguous'`; none → `'none'`.
- `dispatch/tree-fs.test.ts` — `appendReportSection`: appends under a heading and keeps the `Settled:` line; missing file → false and nothing created.

---

## 5. Part A1 — `onni task verify <id>`

### 5.1 Contract (`contract/src/dispatch.ts`, after the peek schemas, line ~135)

```ts
export const VERIFY_STATES = ['passed', 'failed', 'unavailable'] as const;
export const VERIFY_SOURCES = ['required-checks', 'discovered', 'none'] as const;
export const VERIFY_UNAVAILABLE_CODES =
  ['no-bash', 'no-commands', 'no-worktree', 'dry-run', 'git-unreadable'] as const;
export const VERIFY_OUTCOMES = ['passed', 'failed', 'timed-out', 'skipped'] as const;

/** `POST /runs/:id/verify` — `:id` is the calling manager (the caller convention), `target` the settled worker. */
export const dispatchVerifyInputSchema = z.object({
  target: z.string().trim().min(1).max(200),
  /** Run only these of the discovered/required commands (exact, trimmed match). Never a free-form command. */
  only: z.array(z.string().trim().min(1).max(2_000)).max(VERIFY_MAX_COMMANDS).optional(),
}).strict();

export const dispatchVerifyCommandResultSchema = z.object({
  command: z.string().max(300),               // display copy: redacted, cut at 300 (the full line is what ran)
  outcome: z.enum(VERIFY_OUTCOMES),
  exitCode: z.number().int().nullable(),      // null: killed (timeout), skipped, or ended by a signal
  durationMs: z.number().int().nonnegative(),
  timedOut: z.boolean(),
  tail: z.array(z.string().max(VERIFY_TAIL_MAX_CHARS_PER_LINE)).max(VERIFY_TAIL_MAX_LINES),  // [] unless failed/timed-out
  tailTruncated: z.boolean(),
});

export const dispatchVerifyResultSchema = z.object({
  state: z.enum(VERIFY_STATES),
  reasonCode: z.enum(VERIFY_UNAVAILABLE_CODES).optional(),   // iff state === 'unavailable'
  reason: z.string().max(400).optional(),
  source: z.enum(VERIFY_SOURCES),
  headCommit: z.string().max(40).optional(),                 // short sha the checks ran against
  startedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  results: z.array(dispatchVerifyCommandResultSchema).max(VERIFY_MAX_COMMANDS),
  runsUsed: z.number().int().nonnegative(),                  // after this call
  runsMax: z.number().int().positive(),                      // = VERIFY_MAX_RUNS_PER_WORKER, travels with the answer
  warnings: z.array(z.string().max(300)).max(VERIFY_WARNINGS_MAX),
});
```
- Type exports `DispatchVerifyInput`, `DispatchVerifyResult`, `DispatchVerifyCommandResult`.
- `runsMax` travels in the body for the reason `managerMemoryReadSchema.maxBytes` does (`:143-148`): the CLI never
  invents its own ceiling.
- **No `command` field in the input.** The request cannot name an arbitrary command; `only` can merely select among
  the server-resolved list. This is what keeps the route from being a remote-exec endpoint for a manager agent.

**Record fields** (same file, inside `dispatchSchema`, after `softAsk`, line ~390), both optional:
```ts
verify: z.object({
  runs: z.number().int().nonnegative(),
  last: z.object({
    at: z.string(),
    headCommit: z.string().max(40).optional(),
    state: z.enum(['passed', 'failed']),                   // an 'unavailable' run is never stored
    source: z.enum(['required-checks', 'discovered']),
    results: z.array(z.object({
      command: z.string().max(300),
      outcome: z.enum(VERIFY_OUTCOMES),
      exitCode: z.number().int().nullable(),
    })).max(VERIFY_MAX_COMMANDS),
  }).optional(),
}).optional(),
scope: z.string().max(1_000).optional(),                    // A2 (§6.2) — added by A2's commit, listed here for one view
```
No tails on the record (keeps `runs.json` small). Non-strict `z.object`, so an older onni strips the unknown keys.

### 5.2 Route (`server/server.ts`, dispatch family)
```ts
.use('/runs/:id/verify', requireDispatch)          // next to :4547-4554
...
/** `onni task verify` (wave A): the root manager runs the repo's checks inside a SETTLED worker's worktree.
 *  4xx: 403 non-root, 404 unknown, 409 other tree / not settled / cap / busy, 400 unknown `only` entry.
 *  A check that cannot run is a 200 with state 'unavailable'. */
.post('/runs/:id/verify', jsonZodValidator(dispatchVerifyInputSchema), async (c) => {
  const { manager } = c.get('project');
  const outcome = await manager.verifyFor(c.req.param('id'), c.req.valid('json'));
  if ('denied' in outcome) return c.json({ error: outcome.denied }, outcome.status);
  return c.json(outcome);                          // DispatchVerifyResult, status 200
})
```
`outcome` type: `DispatchVerifyResult | { denied: string; status: 400 | 403 | 404 | 409 }` (same shape as
`addManagerMemory`, `run.ts:2967`). Placement: in the existing `dispatchRoutes` chain — the only family that already
owns `/runs/:id/<manager tool>` gates.

### 5.3 Command source (`dispatch/verify.ts`, new, pure + async resolve)
```ts
export interface ResolvedChecks { source: 'required-checks' | 'discovered' | 'none'; commands: string[] }
export async function resolveVerifyCommands(input: {
  repoRoot: string; managerWorktree?: string; only?: readonly string[];
}): Promise<ResolvedChecks | { error: string }>
```
1. `loadConfig(repoRoot)` (`config.ts`) → `requiredChecks` non-empty → source `required-checks` (this is the project
   setting the proposal names). Read from the **checkout's** config, never from the worker's worktree.
2. Else `discoverVerifyCommands(<manager worktree, falling back to repoRoot>)` (§4.1). The manager's tree is the fork
   point the worker built on and is not controlled by the worker; discovery on the worker's tree would let a worker
   rename its own scripts into existence. Empty → source `none`.
3. `only`: each entry must equal (trimmed) one resolved command, else `{ error: 'unknown check "x"; available: a, b' }`
   → 400. Duplicates removed, order of the resolved list preserved.
4. The list is capped at `VERIFY_MAX_COMMANDS`.

**Trust note (written into the doc appendix and surfaced as a warning):** verify executes repo-defined scripts inside a
tree the worker wrote. A worker that edits `scripts.test` in its own `package.json` can make `npm test` pass.
Mitigation: when the worker's changed files (read-only, `worktreeChangedFilesReadOnly`) include `package.json` or
`Cargo.toml`, add the warning `this worker changed package.json — verify runs its scripts, so a green result is only
as honest as that change` to `warnings`. This is a barrier, not a sandbox (AGENTS.md wording).

### 5.4 Server-side checks, in order (`RunManager.verifyFor(callerId, input)`, new, next to `peekFor`, `run.ts:~2867`)
1. `caller = store.getRun(callerId)`; `requireRootManager(caller, 'verify a worker')` → 403 / 404.
2. `target = resolveRunRef(store.listRuns(), input.target)` (§4.5): `none` → 404 `no such run: …`; `ambiguous` → 409.
3. `requireSameTree(caller, target)` → 409 other tree. `target.id === caller.id` or
   `target.dispatch?.rootRunId !== caller.id` → 409 `verify checks a worker of this task, not the manager itself`.
4. **Settled**: `isTerminalStatus(target.status)` (`engine.ts:41`) else 409
   `worker <id8> is still <status> — verify runs only on a settled worker`; and `!this.isActive(target.id)`
   (`run.ts:4968`) else 409 (a terminal record may be mid-continue; never run a check in a tree an agent is
   writing). The v2 §14 condition "only when the worker has settled" is enforced here, on the server.
5. **Cap**: `(target.dispatch?.verify?.runs ?? 0) >= VERIFY_MAX_RUNS_PER_WORKER` → 409 naming the cap and the last
   result (`3 of 3 verify runs used for <id8>; last: failed`). Only runs that actually started count (§5.6).
6. **Busy**: `this.verifying` (`Map<rootRunId, AbortController>`) already holds the caller's tree → 409
   `another verify is running for this task tree`. One verify per tree: checks share ports, caches and CPU, and two at
   once would also make the 280 s budget meaningless.
7. `resolveVerifyCommands` (§5.3); `{ error }` → 400.
8. Unavailable values (HTTP 200, **not counted**, nothing spawned, no ledger beyond one `verify` line with
   `state:'unavailable'`):
   - `ONNI_DRY_RUN === '1'` → `dry-run`;
   - `!target.worktreePath || !existsSync(target.worktreePath)` → `no-worktree` ("the worker's worktree is gone — it was
     reclaimed; nothing to run in");
   - `commands.length === 0` → `no-commands` ("no required checks are configured and none could be discovered: expected
     package.json scripts test/build/lint/typecheck/check or a Cargo.toml");
   - `resolveBash()` is `null` → `no-bash` with `BASH_MISSING_MESSAGE` (`bash-path.ts:123`).
   On POSIX `resolveBash()` is never null; a missing `bash` surfaces as a spawn error (`ENOENT`) from the first command,
   which maps to `no-bash` too (the run is not counted).
9. Count the run (`updateDispatch(target.id, d => ({ ...d, verify: { runs: runs + 1, last: d.verify?.last } }))`,
   `run.ts:2728`) **before** spawning, so a crashed or aborted verify cannot be repeated for free.
10. Run (§5.5), build the result, persist `last`, ledger + notes, report-file section, return. A `finally` always
    deletes the `verifying` entry and clears the timers.

### 5.5 Execution (`dispatch/verify-exec.ts`, new; the only impure file)
```ts
export interface VerifyExecDeps { resolveBash: typeof resolveBash; spawn: typeof spawn; now: () => number; env: NodeJS.ProcessEnv }
export async function runVerifyCommand(opts: {
  bashPath: string; pathDirs: string[]; command: string; cwd: string; env: NodeJS.ProcessEnv;
  timeoutMs: number; signal?: AbortSignal; captureBytes?: number;
}, deps?: Partial<VerifyExecDeps>): Promise<{ exitCode: number | null; timedOut: boolean; aborted: boolean; output: string; durationMs: number; spawnError?: string }>
```
- **Shell**: `spawn(bash.path, ['-lc', command], { cwd, env: withBashPath(env, bash), detached: process.platform !== 'win32', stdio: ['ignore','pipe','pipe'], windowsHide: true })` — the `landing.ts:70` form with stdin closed (a check must never wait on input) and no console window.
- **Kill that actually kills**: a per-command timer calls `killProcessTree(child, true)` (`antigravity-runner.ts:173`:
  `taskkill /T /F` on Windows, `process.kill(-pid, 'SIGKILL')` on POSIX — hence `detached`), then **settles the
  promise immediately** and destroys `child.stdout`/`child.stderr`, so a grandchild holding the pipe cannot stretch
  the "bound" (the exact bug `landing.ts:85-87` documents). The outer `AbortSignal` (cancel / dispose / total deadline)
  runs the same path with `aborted: true`.
- **Time budget**: `perCommand = min(VERIFY_COMMAND_TIMEOUT_MS, remainingTotal)`; one total timer at
  `VERIFY_TOTAL_TIMEOUT_MS`. Commands run **sequentially**; once the total is spent the rest are `skipped`
  (`exitCode: null`, `durationMs: 0`). Sequential on purpose: shared ports, lockfiles and caches.
- **Output caps**: the child's output is decoded with `utf8Collector` (never split a multibyte character) into a rolling
  buffer of the last `VERIFY_CAPTURE_BYTES` (256 KiB) — memory is bounded however chatty the command is. ANSI escapes
  are stripped. Only the **tail** survives into the answer: for each `failed`/`timed-out` command the last
  `VERIFY_TAIL_MAX_LINES` lines, each cut to `VERIFY_TAIL_MAX_CHARS_PER_LINE`, each line through
  `store.redactRunText(target.id, line)`, and the whole answer's tails share `VERIFY_TAIL_TOTAL_MAX_CHARS` evenly
  (floor 400 chars per failing command). A passing command carries `tail: []`.
- **Minimal env** (`buildVerifyEnv(base, platform)`, pure, in `dispatch/verify.ts`): an **allowlist**, never
  `{ ...process.env }` (the form `landNow` uses at `run.ts:8947`, which is exactly what this spec forbids).
  - Kept (case-insensitively on win32): `PATH`/`Path`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_*`, `TERM`,
    `TMPDIR`, `TEMP`, `TMP`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`, `SystemRoot`, `windir`,
    `COMSPEC`, `PATHEXT`, `ProgramFiles`, `ProgramFiles(x86)`, `ProgramW6432`, `ProgramData`, `NUMBER_OF_PROCESSORS`,
    `PROCESSOR_ARCHITECTURE`, `OS`.
  - Added: `CI=1` (turns watch-mode runners such as vitest/jest into a single run), `NO_COLOR=1`,
    `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`.
  - Removed even if they match the allowlist: any name matching `/(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|AUTH)/i`
    and any `ONNI_*`. Everything else (`ANTHROPIC_*`, `OPENAI_*`, `GH_*`, `GITHUB_*`, `AWS_*`, tracker credentials,
    the project secret vault) is dropped by not being on the list.
  - **Consequence, documented**: a check that needs a secret fails honestly. Passing vault secrets (audience `checks`,
    `RunManager` constructor option `secrets`, `run.ts:~1436`) is a possible opt-in later; it is out of v1.
- The `ONNI_*` variables are deliberately absent, so a verified script cannot call back into `onni task …` as the
  manager (`ONNI_TASK_ID`/`ONNI_API_URL` unset).

### 5.6 Per-worker cap and counters
`VERIFY_MAX_RUNS_PER_WORKER = 3` counted on `target.dispatch.verify.runs` (persisted, survives restart). Unavailable
results and 4xx refusals are free. A baseline verify (A1b) counts as ONE run. Resetting the counter is not offered:
a manager that needs a fourth run asks the user (the Guard) — the cap exists to stop a check loop burning CPU.

### 5.7 Result, ledger, notes
After the run, in this order:
1. `updateDispatch(target.id, …verify: { runs, last })` (skip `last` for `unavailable`).
2. `appendLedger(this.dataDir, rootRunId, { type: 'verify', runId: callerId, targetRunId, state, source, commands, failed, headCommit, durationMs, runsUsed })` — all values numeric/short, **no command text, no output** (ledger lines are read by tooling; the
   tail already lives in the answer).
3. Note on the **manager**: `verify <id8> "<title>": failed — npm run build exit 1, npm test timed out (2 of 3 runs used)`
   (`this.store.appendEvent(callerId, { type:'note', stepId: this.active.get(callerId)?.currentStepId, message, tone: failed ? 'danger' : undefined })`, redacted).
   Note on the **worker's** transcript: `verified by its manager: passed @ <sha>` (one short line, so the worker's
   own thread shows the claim was tested).
4. `appendReportSection(dataDir, rootRunId, target.id, 'Verification', <the same one-liner list + head sha + time>)`
   (§4.6) — the on-disk report the manager may re-read now ends with onni's own result.
Unavailable results write only the ledger line and the manager note (`verify … unavailable: <reason>`).

### 5.8 How verify replaces the `worker-reported` label
The delivered settle message cannot be edited, so "replace" means these three concrete things:
1. **`checksLine` gains a verification input** (`dispatch/engine.ts:228`): a pure `reconcileChecks(claims,
   verification, currentHead)` returns the line:
   - no `dispatch.verify.last` → the **existing string, byte for byte** (`checks (worker-reported, not verified): …`;
     `engine.test.ts:329,371` stay green untouched);
   - `last` present and `last.headCommit` equals the report's `headCommit` (compared as ≥ 7-char sha prefixes) →
     `checks (verified by onni at <sha>, <time>): npm test → 0; npm run build → 1`, followed by
     `; MISMATCH with the worker's claim: "npm test" claimed 0, onni got 1` for every claimed command onni also ran with
     a different exit-zero/non-zero verdict, and `; also claimed, not verified: <cmd> → <n>` for claims onni did not run;
   - `last` present but the head differs or is unknown → the worker-reported label plus
     `[an earlier onni verify at <sha> is stale: the branch has moved]`. A worker that was continued and re-settled can
     never inherit a green it did not earn.
2. **`childSettleReport`** reads `child.dispatch?.verify?.last` itself (it already receives the `RunRecord`), and both its
   call sites (`run.ts:~4011,~4045`) plus the graph-wait site (`:7652`, no head → "stale/unconfirmed" form) get the new
   behavior with no signature change. `pendingReportsBlock` (`:322`) renders stored reports and is **not** changed: a
   pending report predates any verify.
3. **The verify answer itself, the manager note and `report.md`** (§5.7) carry the verified line, so the next thing the
   manager reads about that worker is onni's result, not the claim.

### 5.9 Manager brief (`workflows/manager-worker.ts`)
- Command table entry (`dispatch/commands.ts`, after `peek`):
  - `usage`: `onni task verify <worker id> [--only "<command>"]…   run the repository's checks in a SETTLED worker's worktree and get onni's own pass/fail`
  - `brief` (≤ 250 chars): `onni task verify <worker id> [--only "<command>" …]   onni runs the repo's checks inside a settled worker's worktree (not yours): its result replaces the worker's claimed checks. 3 runs per worker; may take up to ~5 min`
  - `oneLine`: `have onni run the repository's checks in a settled worker's worktree`
- Prompt text, `manager-worker.ts:287-290` ("Integrating"):
  - sentence "Its \"checks\" line is the worker's own word — not verified by onni: rerun the checks yourself before merging."
    → "Its \"checks\" line is the worker's own word until `onni task verify <id>` replaces it with onni's result — a MISMATCH line is a red flag. Verify BEFORE you merge."
  - step 1 "…and run the tests it names." → "…and run `onni task verify <worker id>` (give your shell tool a timeout of at least 6 minutes)."
  - step 4 (checks after each merge, in your own worktree) is unchanged: verify checks the worker's tree, not the merged result.
- `WORKER_PROMPT` and the worker `report` brief are **not** changed in this wave (one worker-visible sentence "your claimed checks may be re-run" is a possible follow-up; it would also spend worker command-block budget).

### 5.10 CLI (`dispatch/task-cli.ts`)
New `case 'verify'` after `peek` (`:267`):
```
onni task verify <worker id> [--only "<command>"]…
```
- `parseArgs` options: `only: { type: 'string', multiple: true }`; exactly one positional (the target) else
  `a worker id is required: onni task verify <worker id>`; `ONNI_TASK_ID` required like the neighbours.
- `callRoute(api, io, '/runs/<ONNI_TASK_ID>/verify', { method: 'POST', headers, body: JSON.stringify({ target, ...(only) }), signal: AbortSignal.timeout(VERIFY_TOTAL_TIMEOUT_MS + 30_000) }, 'verify refused —')`.
  `callRoute` already maps 404 to the version-mismatch sentence (`:72`) and prefixes 4xx reasons.
  **Do not add a fetch `headersTimeout` workaround**; the 280 s total (§0.6) is the design.
- Output: `formatVerify(result)` in `dispatch/verify.ts` (pure): header line
  `verify <id8>: PASSED|FAILED|UNAVAILABLE — <source>, <n> command(s), <sec>s @ <sha>  (run 2 of 3)`; one line per command
  `  ✓|✗|⏱|– <command>  exit <n>  <ms>`; failing commands followed by `| <tail line>` rows (`peek`'s `recent:` format,
  `peek.ts` `formatEntry`) and `| … truncated`; warnings as `! <text>`; for unavailable the reason (plus, for `no-bash`,
  the install hint from `BASH_MISSING_MESSAGE`).
- Exit code: `0` passed, `3` failed (as `merge` uses `3` for a conflict, `:257`), `4` unavailable. Errors stay `1`.
- `taskUsage()` (and so the `USAGE` constant at `:32`) updates itself from the table.

### 5.11 Part A1 test list (exact)
**`dispatch/verify.test.ts` (new, pure):**
- `resolveVerifyCommands`: required checks win over discovery; empty required → discovery from the manager worktree; neither → `source:'none'`; `only` exact match selects and keeps resolved order; unknown `only` → error naming the available list; list capped at 10; reads the repo config, never the worker tree (a tracked-config fixture in the worker dir is ignored).
- `buildVerifyEnv`: allowlist only; `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `ONNI_TASK_ID`, `ONNI_API_URL`, `MY_SERVICE_PASSWORD` absent; `PATH`/`Path` kept; Windows case-insensitivity (`systemroot`); `CI=1`, `NO_COLOR=1`, `GIT_TERMINAL_PROMPT=0` present; **does not mutate its input and is not `process.env`**.
- `assembleVerifyResult`: pass/fail/timeout/skipped mapping; `state` is `failed` iff any command failed or timed out; tail only on failures; per-line and per-command caps; total tail budget divided across failing commands; ANSI stripped; command display cut at 300; redaction callback applied to command and every tail line (fake secret never appears); warnings capped at 5.
- `reconcileChecks` (engine): no verification → exact legacy string; verified-and-same-head → verified label; mismatch line; claimed-not-run line; different/unknown head → stale label; the exact-prefix head comparison.
- `formatVerify`: PASSED/FAILED/UNAVAILABLE headers, the `no-bash` text, tails, "run 2 of 3".

**`dispatch/verify-exec.test.ts` (new; spawns real `bash`, capability-guarded inside each test via `resolveBash()`):**
- exit 0 → `{exitCode:0}`; exit 7 → `{exitCode:7}`; output decoded across multibyte chunk boundaries.
- **Real kill timeout**: `sleep 30` with `timeoutMs: 300` resolves in well under 5 s with `timedOut:true`, and on POSIX the process group is gone (`process.kill(-pid, 0)` throws ESRCH); a command that backgrounds a grandchild holding stdout (`(sleep 30 &) ; sleep 30`) still returns at the deadline (pipe destroyed).
- Output flood (`yes | head -c 5000000`) keeps memory bounded: returned `output` ≤ `captureBytes`.
- Abort signal: aborting mid-run returns `aborted:true` promptly and kills the tree.
- stdin is closed: `read x` (would block) ends immediately rather than hanging.
- Env: the child sees `CI=1` and does **not** see a sentinel `ONNI_VERIFY_TEST_SECRET` set in the test's `process.env`.
- Windows branch (injected `resolveBash` → `null`): `verifyFor` path returns `no-bash` (tested in the manager suite below; here `runVerifyCommand` is never called).

**`workflows/dispatch-engine.test.ts` — new `describe('verify')` (real `RunManager` + `RunStore`, the `peek` describe at `:519` is the template; the check runner is injected through a `verifyDeps` seam passed in the constructor options object at `run.ts:1429`, default = the real exec):**
- root manager verifies its settled `done` worker → results, `runsUsed:1`, `dispatch.verify.last` stored, ledger line `type:'verify'` present, manager note + worker note + `report.md` "Verification" section written.
- **Auth**: a worker calling `verifyFor` → 403; unknown caller → 404; a target of another tree → 409; the manager as its own target → 409; ambiguous id prefix → 409; `only` with an unknown command → 400.
- **Settled only**: target `running` / `queued` / `waiting` → 409 with the status in the text; a terminal record that `isActive` → 409; `failed` and `cancelled` workers are allowed.
- **Cap**: 3 runs succeed, the 4th is 409 naming the cap; `unavailable` runs and 4xx do not consume the cap; the counter survives a fresh `RunStore.open` (restart).
- **Busy**: a second verify in the same tree while the first is pending → 409; the entry is released after success, after a throwing runner and after abort.
- **Unavailable as a value** (all HTTP-200 results, nothing spawned, counter unchanged): `ONNI_DRY_RUN=1` → `dry-run`; worktree removed → `no-worktree`; no required checks and no discoverable scripts → `no-commands`; injected `resolveBash → null` → `no-bash` with `BASH_MISSING_MESSAGE`.
- **Command source**: `requiredChecks` in the repo config win; absent → discovered from the manager's worktree, not the worker's; a worker `package.json` edit adds the warning.
- **Total deadline**: injected clock/runner proves commands after 280 s are `skipped` and the call returns.
- **Cancel / dispose**: `cancel(<caller>)` and `dispose()` abort an in-flight verify (the injected runner sees `signal.aborted`) and release the busy entry.
- **Label replacement**: after a verify, `childSettleReport` for the same head renders the verified label; after the worker is continued and settles at a new head it renders the worker-reported label with the stale suffix.
- **No writes to the worker's index**: the worker worktree's `git ls-files --stage` is unchanged by the verify path itself (the injected runner does not touch it; asserts we never call `worktreeChangedFiles`).

**`server/dispatch-api.test.ts`:** add `'verify'` to the `calls.kind` union (`:21`) and a stub `verifyFor`; passes the validated body through; maps `{denied,status}` unchanged (403/404/409/400); 400 on a body without `target`, with an unknown key (`.strict()`), with `only` > 10; `ONNI_DISPATCH=0` → 409 before touching the manager — add `/api/v1/runs/p/verify` to the gate list at `:270`.

**`server/contract-parity.dispatch.test.ts`:** add `type Verify200 = InferResponseType<Run['verify']['$post'], 200>` and `type VerifyBody = InferRequestType<Run['verify']['$post']>['json']`; `Assert<Exact<z.infer<typeof dispatchVerifyResultSchema>, Verify200>>`, `Assert<Exact<z.input<typeof dispatchVerifyInputSchema>, VerifyBody>>`. Runtime block `describe('a verify answer is bounded at both levels')` next to the peek one (`:150`): 11 results rejected; 41 tail lines rejected; a 201-char tail line rejected; unknown `state` / `reasonCode` / `outcome` rejected (an unknown state would hide "could not run" behind "passed"); `runsMax` required. `dispatchSchema` round-trip: a record **without** `verify` parses; a record with `verify.runs` and `last` parses; `last.state` of `'unavailable'` is rejected.

**`dispatch/task-cli.test.ts`:** `verify` posts `{ target }` to `/runs/<id>/verify` with the project scope; `--only` repeated → `only: [...]`; no positional → error exit 1; exit codes 0 / 3 / 4 for passed / failed / unavailable; 409 reason is printed with the `verify refused —` prefix; 404 prints the version-mismatch sentence; unreachable cockpit prints the network error; output contains the verdict word, each command line and a failing tail.

**`dispatch/commands.test.ts`:** `CLI_COMMANDS` gains `'verify'` in table position; manager block contains `onni task verify`; block ≤ `MANAGER_COMMANDS_MAX_CHARS` **and still contains `onni task tree`** (the clamp canary at `:42`).

**`workflows/manager-prompt.test.ts`:** the four worst-case tests (`:142,:223,:388` and the memory/plan one `:189`) stay ≤ `PROMPT_MAX_CHARS`; new test "the Integrating block tells the manager to verify and no longer says to rerun the checks yourself"; new test "the fixed text still contains the Guard line and 'never push'" (guards §3.3's no-trim rule).

**`engine.test.ts`:** the two legacy assertions (`:329`, `:371`) unchanged and green.

### 5.12 Part A1 acceptance
`onni task verify <worker>` on a settled worker runs the checks in the worker's worktree and prints onni's own
result; a worker, another tree, an unsettled worker and a 4th run are refused on the server; a machine without bash gets
a value, not a failure; a hung check dies at its deadline with no stray process; no `ONNI_*`/secret reaches the child;
the manager's next report/note/`report.md` carries the verified line; `.env.example` unchanged; docs appendix added.

---

## 6. Part A2 — `onni task conflicts`

### 6.1 Contract (`contract/src/dispatch.ts`, after the verify schemas)
```ts
export const CONFLICT_FILES_STATES = ['ok', 'timeout', 'unavailable'] as const;
export const CONFLICT_SCOPE_STATES = ['none', 'free-text', 'checked'] as const;
export const CONFLICT_TRIAL_STATES = ['clean', 'conflict', 'unavailable', 'timeout'] as const;

export const dispatchConflictWorkerSchema = z.object({
  id: z.string(), title: z.string(), status: z.string(),
  branch: z.string().optional(),
  headCommit: z.string().max(40).optional(),
  filesCount: z.number().int().nonnegative(),
  filesTruncated: z.boolean(),                       // the scan itself hit its internal cap: overlaps may be incomplete
  filesState: z.enum(CONFLICT_FILES_STATES),         // NOT "nothing changed" when not 'ok' (same rule as peek)
  scopeState: z.enum(CONFLICT_SCOPE_STATES),
  outsideScope: z.array(z.string().max(300)).max(CONFLICTS_FILES_MAX),
  outsideScopeOmitted: z.number().int().nonnegative(),
});
export const dispatchConflictOverlapSchema = z.object({
  a: z.string(), b: z.string(),                      // run ids
  files: z.array(z.string().max(300)).max(CONFLICTS_FILES_MAX),
  filesOmitted: z.number().int().nonnegative(),
});
export const dispatchTrialMergeSchema = z.object({
  kind: z.enum(['worker-worker', 'into-manager']),
  left: z.string(), right: z.string(),               // run ids (for 'into-manager', left is the manager)
  leftHead: z.string().max(40).optional(), rightHead: z.string().max(40).optional(),  // committed tips that were merged
  state: z.enum(CONFLICT_TRIAL_STATES),
  files: z.array(z.string().max(300)).max(CONFLICTS_FILES_MAX),
  filesOmitted: z.number().int().nonnegative(),
  reason: z.string().max(300).optional(),
});
export const dispatchConflictsSchema = z.object({
  workers: z.array(dispatchConflictWorkerSchema).max(PEEK_MAX_ENTRIES),
  workersOmitted: z.number().int().nonnegative(),
  overlaps: z.array(dispatchConflictOverlapSchema).max(CONFLICTS_MAX_PAIRS),
  overlapsOmitted: z.number().int().nonnegative(),
  trialMerges: z.array(dispatchTrialMergeSchema).max(CONFLICTS_TRIAL_MAX),
  trialMergesSkipped: z.number().int().nonnegative(),
  trialState: z.enum(['ran', 'unavailable']),        // 'unavailable': git < 2.38 or probe failed
  trialReason: z.string().max(300).optional(),
  checkedAt: z.string(),
});
```
Query (not a contract body): `?target=<worker id>` optional, validated in the route with `queryZodValidator` like peek
(`server.ts:4626`): `z.object({ target: z.string().trim().min(1).max(200).optional() })`.

### 6.2 Persisting `scope` (A2 commit)
- Add `scope: z.string().max(1_000).optional()` to `dispatchSchema` (§5.1 listing).
- In `dispatch()` where the child `dispatch:` object is built (`run.ts:~3876-3883`) add
  `...(input.scope ? { scope: input.scope } : {})`.
- **Old records** (dispatched before the change) have no field: `scopeOf(run)` falls back to the LAST line matching
  `/^- Scope: (.+)$/m` in `run.task` (the envelope line `engine.ts:113`; last, not first, so an objective that happens
  to contain `- Scope:` cannot spoof it). Both paths return `undefined` for no scope → `scopeState: 'none'`.

### 6.3 Route (`server.ts` dispatch family)
```ts
.use('/runs/:id/conflicts', requireDispatch)
/** `onni task conflicts` (wave A): ADVISORY overlap report for the root manager. Read-only; never blocks a merge. */
.get('/runs/:id/conflicts', queryZodValidator(z.object({ target: z.string().trim().min(1).max(200).optional() })), async (c) => {
  const { manager } = c.get('project');
  const { target } = c.req.valid('query');
  const outcome = await manager.conflictsFor(c.req.param('id'), target !== undefined ? { target } : {});
  if ('denied' in outcome) return c.json({ error: outcome.denied }, outcome.status);
  return c.json(outcome);
})
```
`outcome`: `DispatchConflicts | { denied: string; status: 403 | 404 | 409 }`.

### 6.4 Algorithm (`RunManager.conflictsFor`, next to `peekFor`; pure parts in `dispatch/conflicts.ts`, new)
1. `requireRootManager(caller, 'check this task tree for conflicts')`; optional `target` → `resolveRunRef` + `requireSameTree` + must be a member, else 404/409. **Any status**: unlike verify, a running worker is the point (catch it early). No settled requirement.
2. Members = `runs.filter(r => r.dispatch?.rootRunId === caller.id && r.id !== caller.id)`, ordered with `orderPeekCandidates` (`peek.ts`, live first) and cut to `PEEK_MAX_ENTRIES` (rest → `workersOmitted`).
3. Per worker, **read-only and in parallel, under one outer `AbortController` of 20 s**:
   `worktreeChangedFilesReadOnly(worktreePath, baseBranch ?? 'HEAD', { max: 2000 })` (committed + uncommitted + untracked,
   no index write, `peekEntry` does the same, `run.ts:~2927`) → `dropOnniDataPaths` (§4.4); `worktreeHeadShort`.
   `filesState` `timeout`/`unavailable` is reported, never turned into an empty list; `state:'ok'` with `omitted > 0` sets
   `filesTruncated`. Missing worktree (reclaimed, or a queued worker that has none) → `unavailable`.
4. **Overlaps**: for every unordered pair of workers whose `filesState==='ok'`, the intersection of their file sets
   (paths normalised: `\`→`/`, no leading `./`, case-sensitive on POSIX and case-insensitive on win32). Sort pairs by
   overlap size desc, then id; cut to `CONFLICTS_MAX_PAIRS` (`overlapsOmitted`); files per pair cut to
   `CONFLICTS_FILES_MAX` (`filesOmitted`). With `target`, only pairs containing it.
5. **Scope**: `scopeOf(run)` → `parseScope(scope)` (pure):
   - split on newlines, `,` and `;`; trim; strip backticks/quotes and a trailing `(…)` comment; drop empties;
   - a token is **path-like** iff it has no spaces and matches `/^[\w@.\-\/\\*]+$/` and (contains `/` or `\` or `*` or a
     `.ext`, or ends with `/`); tokens with `..` segments or braces are not path-like;
   - the scope is **checked** only if there is ≥ 1 token and **every** token is path-like (a sentence such as
     "the auth module and its tests" has non-path tokens → `free-text`, skipped, `scopeState:'free-text'`);
   - a token with `*`/`**`/`?` becomes a regex (own ~15-line `globToRegExp`; `**` crosses `/`, `*` does not; no new
     dependency); a token ending in `/` or with no extension and no glob is a directory prefix; a plain file is an exact match.
   - `outsideScope` = the worker's files (after `dropOnniDataPaths`) matching no token, cut to `CONFLICTS_FILES_MAX`.
   Always advisory: the worker's own order already carried the scope; this only says whether it held.
6. **Trial merges** (`trialMergeTree`, §4.2) in `this.repoRoot`, strictly sequential under the shared 20 s budget, at most
   `CONFLICTS_TRIAL_MAX` per call, chosen in this order: (a) every overlapping pair (largest overlap first) as
   `worker-worker`; (b) for each settled worker that has a branch ahead of the manager's tip, `into-manager`
   (`left` = the manager's branch tip, `right` = the worker's) — "would `onni task merge <id>` conflict right now". Pairs
   that do not overlap in files are not trialled for (git conflicts require a shared path). Beyond the cap →
   `trialMergesSkipped`. Every entry records the short tips (`leftHead`, `rightHead`) because the trial sees **committed
   state only**: a running worker's uncommitted work is in step 3's overlaps but not in the trial — the CLI says so.
   Branches must exist (`localBranchExists`, `git-worktree.ts:224`); otherwise that entry is `unavailable`.
   If the very first trial returns `unavailable` for the version reason, stop and set `trialState:'unavailable'` +
   `trialReason` (do not burn the budget on seven more identical failures).
7. Redaction: every file name passes `store.redactRunText(worker.id, name)`.
8. No ledger, no note (read-only, like `peek`).

### 6.5 Brief and CLI
- Table entry (after `verify`): `usage`: `onni task conflicts [<worker id>]   ADVISORY: files two workers both changed, files outside a path-like --scope, and whether a trial merge would conflict`; `brief` (≤ 220 chars): `onni task conflicts [<worker id>]   advisory, never blocks: files workers share, files outside a path-like --scope, trial-merge result. Run it before merging and when workers run side by side`; `oneLine`: `see which files workers share and whether a merge would conflict`. Cap raise per §3.3.
- Manager prompt: in the "Giving work" disjoint-scopes bullet (`manager-worker.ts:~277`) append one clause: "`onni task conflicts` shows whether they actually stayed apart." No other prompt change.
- CLI `case 'conflicts'` after `verify`: `onni task conflicts [<worker id>]`; one optional positional →
  `?target=`; `GET`; prints `formatConflicts(result)` (pure, `dispatch/conflicts.ts`):
  - first line `advisory only — nothing here blocks a merge`;
  - `overlap (2 files): <a8> and <b8> both changed src/x.ts, src/y.ts (+3 more)` per pair, or `no shared files between workers`;
  - per worker with `scopeState==='checked'` and `outsideScope`: `outside scope: <id8> changed lib/z.ts (+1 more)`;
    `scope: free text — not checked` for `free-text` workers (one aggregated line, not per worker);
  - `trial merge <left8> + <right8> (committed state @ <sha>/<sha>): CLEAN | CONFLICT in a.ts, b.ts | unavailable (<reason>) | timed out`;
    one footer line `trial merges see committed work only; uncommitted changes are in the overlap list but not in the trial`;
  - a worker with `filesState !== 'ok'` prints `files unknown for <id8> (<state>) — this is NOT "no overlap"`.
  Exit code is always `0` for a successful call (advisory); `1` for a refusal, as the other commands.

### 6.6 Part A2 test list (exact)
**`dispatch/conflicts.test.ts` (new, pure):**
- `parseScope`: `"src/auth/, tests/auth.test.ts"` → checked, two tokens; `"the auth module"` → free-text; `"src/**/*.ts"` → glob; mixed path + prose → free-text; `"../etc"` and `"{a,b}/x"` → not path-like; `"lib\\x.ts"` normalised; empty → none.
- `globToRegExp`: `*` stays inside a segment, `**` crosses, `?`, regex metacharacters escaped, anchored.
- `outsideScope`: directory prefix vs file vs glob; `.ai/onni/…` ignored; cap 15 + `omitted`.
- `overlaps`: pair intersection, order by size then id, cap 20 + `overlapsOmitted`, case rules per platform, a worker with `filesState!=='ok'` contributes no pair (and is reported).
- `scopeOf`: record field wins; old record falls back to the LAST envelope `- Scope:` line; an objective containing `- Scope:` earlier does not spoof it; none → undefined.
- `formatConflicts`: advisory header, truncation markers, the "NOT no overlap" line, free-text aggregation, committed-only footer.

**`workflows/dispatch-engine.test.ts` — new `describe('conflicts')` (real git repo, capability-guarded inside the test):**
- two workers editing the same file → one overlap pair; disjoint → none; a trial merge reports `conflict` with the file for the overlapping pair and `clean` for a pair that overlaps on different hunks.
- **Auth**: worker caller → 403; unknown caller → 404; target of another tree → 409; unknown/ambiguous target → 404/409; a **running** worker is accepted (no settled requirement).
- Outside-scope: a worker ordered `--scope "src/a/"` that touched `src/b/x.ts` appears in `outsideScope`; a prose scope reports `free-text` and no files; no scope → `none`.
- **Read-only proof**: before/after comparison of every member worktree's `git ls-files --stage` and `git status --porcelain`, and of `git for-each-ref`, is identical; the code path never calls `worktreeChangedFiles` (spy / import assertion).
- Degradation as values: a reclaimed worker worktree → `filesState:'unavailable'` (not an empty list); `trialMergeTree` forced `unavailable` (git too old) → `trialState:'unavailable'` with the reason and the other sections still present; one trial timing out marks only that entry `timeout`.
- Caps: 13 workers → `workersOmitted:1`; 25 overlapping pairs → `overlapsOmitted:5`; 9 trial candidates → `trialMergesSkipped:1`; long file lists → `filesOmitted`.
- Scope persisted: a dispatch with `scope` stores `dispatch.scope`; an old record without it still resolves via the envelope.

**`server/dispatch-api.test.ts`:** `'conflicts'` added to the stubbed kinds; `?target=` passed through; denial statuses mapped; 400 on an over-long `target`; added to the `ONNI_DISPATCH=0` 409 list (`:270`).

**`server/contract-parity.dispatch.test.ts`:** `type Conflicts200 = InferResponseType<Run['conflicts']['$get'], 200>`; `Assert<Exact<z.infer<typeof dispatchConflictsSchema>, Conflicts200>>`; bounded-at-both-levels block: 13 workers, 21 overlaps, 9 trial merges, 16 files each rejected; unknown `filesState` / `scopeState` / trial `state` rejected; `dispatchSchema` still parses a record without `scope`.

**`dispatch/task-cli.test.ts`:** `conflicts` with no id → `GET …/conflicts` with no query; with id → `?target=<id>`; refusal exits 1 with the reason; 404 → version sentence; successful advisory output exits `0` even when conflicts are reported.

**`dispatch/commands.test.ts`:** `CLI_COMMANDS` gains `'conflicts'`; manager block contains it, ≤ cap, still contains `tree`. **`manager-prompt.test.ts`:** worst-case tests still ≤ `PROMPT_MAX_CHARS`; the disjoint-scopes bullet mentions `onni task conflicts`.

### 6.7 Part A2 acceptance
Overlap between workers, out-of-scope files for path-like scopes and trial-merge results appear in one call, any time
after dispatch; the route never writes an index, ref or working file; git without `merge-tree --write-tree` or a
reclaimed worktree yields explicit "unavailable / unknown" values that cannot be read as "no conflict"; output is
capped by construction; non-root callers are refused on the server.

---

## 7. Part A1b — `verify --baseline` (separate, later)

Depends on A1 and A-git §4.3. Ships as its own PR; A1 must be accepted and used first (v2 §2 habit: expensive part last).

### 7.1 Contract change (additive)
- `dispatchVerifyInputSchema` gains `baseline: z.boolean().optional()` (still `.strict()`).
- `dispatchVerifyResultSchema` gains optional `baseline`:
```ts
export const VERIFY_BASELINE_VERDICTS = ['no-new-failures', 'new-failures', 'inconclusive'] as const;
export const dispatchVerifyBaselineSchema = z.object({
  method: z.literal('heuristic'),                    // part of the type so no client can drop the label
  state: z.enum(['compared', 'unavailable']),
  reason: z.string().max(300).optional(),
  baseRef: z.string().max(40).optional(),            // short sha of the diff base the commands re-ran at
  verdict: z.enum(VERIFY_BASELINE_VERDICTS).optional(),   // present iff state === 'compared'
  results: z.array(z.object({
    command: z.string().max(300),
    classification: z.enum(['new-failure', 'new-signatures', 'pre-existing', 'inconclusive']),
    workerExitCode: z.number().int().nullable(),
    baselineExitCode: z.number().int().nullable(),
    newSignatures: z.array(z.string().max(200)).max(10),
    newSignaturesOmitted: z.number().int().nonnegative(),
  })).max(VERIFY_MAX_COMMANDS),
  newCount: z.number().int().nonnegative(),
  preExistingCount: z.number().int().nonnegative(),
  inconclusiveCount: z.number().int().nonnegative(),
  cleanup: z.enum(['removed', 'left-behind']),
}).optional()
```
(the `.optional()` goes on the field inside `dispatchVerifyResultSchema`). `parity`: the `Exact` assertions and the
bounded-at-both-levels block are extended in the same commit; a pre-A1b result (no `baseline`) must still parse.
- Record: `dispatch.verify.last` is unchanged (baseline is advice about one call, not a stored fact).

### 7.2 Flow (inside `verifyFor`, after the worker run)
1. Only if `input.baseline` and the worker run had ≥ 1 `failed`/`timed-out` command; otherwise
   `baseline: { method:'heuristic', state:'compared', verdict:'no-new-failures', results:[], …, cleanup:'removed' }`
   with no worktree created (nothing failed → nothing to compare).
2. Time split: with baseline on, each phase gets `VERIFY_TOTAL_TIMEOUT_MS / 2` (the 280 s ceiling of §0.6 still holds).
3. `baseSha = resolveReadOnlyDiffBase(target.worktreePath, target.baseBranch ?? 'HEAD', { taskBranch: target.branch, runStartedAt: target.startedAt })`
   (§4.3). `undefined`, or a non-sha answer (HEAD left the task branch) → `baseline.state:'unavailable'`,
   reason "no reliable diff base for this worker" — the worker result is still returned.
4. `refuseBelowDiskFloor`-style check (`git-worktree.ts:294`) → unavailable `low disk`.
5. **Temp worktree**: `git worktree add --detach <path> <baseSha>` via a new `addDetachedWorktree(repoRoot, path, sha)`
   in `git-worktree.ts` (uses the file's `git()` helper, `:38`). Path: `<repoRoot>/.ai/onni/tmp/verify-baseline/<id8>-<base36 ms>`
   — **under `tmp/`, never under `worktrees/`** (§0.5). Detached: no branch to leak or collide.
6. **Dependencies**: the baseline tree has no `node_modules`. If the worker worktree has a top-level `node_modules`, create a
   directory link `<baseline>/node_modules → <worker>/node_modules` (`fs.symlink(..., 'junction')` on Windows, `'dir'` on POSIX).
   This shares the worker's installed dependencies (labelled in the output: `baseline shares the worker's node_modules`).
   Absent → run without; a command that then fails for missing modules is classified `inconclusive`, not blamed on the worker.
   (Open decision D2, §9.)
7. Run **only the commands that failed in the worker run**, same env, same runner (§5.5), cwd = the temp worktree.
8. **Cleanup — always, in `finally`**, also on throw, timeout, abort, `cancel(caller)` and `dispose()`:
   `removeDetachedWorktree(repoRoot, path)`: (1) remove the `node_modules` link FIRST with `unlink`/`rmdir` (never
   recursive), `lstat` it to prove it is gone; (2) only then `git worktree remove --force` + `rm -rf` + `git worktree prune`.
   **If the link could not be removed, do not recurse into the directory** — a recursive delete through a link would
   destroy the worker's real `node_modules`; set `cleanup:'left-behind'` and add a warning with the path. `RunManager`
   keeps `this.baselineTrees: Set<string>`; `dispose()` removes the survivors best-effort.
   A startup sweep `sweepVerifyBaselines(repoRoot)` (new, `git-worktree.ts`) removes `tmp/verify-baseline/*` directories
   older than 1 h from a crashed process, link-first as above; it runs where `pruneOrphans` is called at manager start.
9. Count: the whole call is ONE run of the §5.6 cap.

### 7.3 The heuristic (`dispatch/baseline.ts`, new, pure) — labelled as such everywhere
For each command that failed in the worker run, with the captured output of both runs (the 256 KiB tails of §5.5, not the redacted answer tails):
- `failureSignatures(output): string[]` — lines matching a failure pattern set (`FAIL`, `FAILED`, `✗ ✖ ×`, `not ok`, `--- FAIL:`, `... FAILED`,
  `thread '…' panicked`, pytest `FAILED path::name`, `error TS\d+:`, `error[E\d+]`), normalised: collapse whitespace; strip
  `:\d+(:\d+)?`, durations (`\(\d+(\.\d+)?\s*m?s\)`), ISO timestamps, 8+ hex runs; replace the worker and baseline worktree
  paths with `<wt>`; de-duplicate; sort; cap 200.
- Classification: worker failed & baseline passed → `new-failure`; both failed → `new-signatures` if the worker set has entries
  the baseline set lacks (those entries, ≤ 10, are `newSignatures`); `pre-existing` if every worker signature is in the
  baseline set; `inconclusive` if both failed and **neither** side produced a signature (a bare non-zero exit), or the
  baseline hit its timeout, or it failed with missing-module text and no link was possible.
- Verdict: `new-failures` if any `new-failure`/`new-signatures`; else `inconclusive` if any `inconclusive`; else `no-new-failures`.
- **Honesty rules**: `method:'heuristic'` is in the schema; the CLI header says `HEURISTIC` and prints the sentence
  "failures are compared by exit code and failing-line text; a flaky or renamed test can be misclassified"; `inconclusive`
  is never promoted to `no-new-failures`.
- This matters on native Windows where `AGENTS.md` records ~340 environment-shaped failures in `npm test`: those are
  `pre-existing` and no longer drown the worker's own regressions.

### 7.4 CLI / brief
- `verify` gains `--baseline` (boolean). Exit code follows the verdict when present: `no-new-failures` → `0`, `new-failures` → `3`,
  `inconclusive` → `4`; otherwise the A1 rule. `formatVerify` adds a `baseline (HEURISTIC, at <sha>):` block: `NEW <command>: <signature>…`
  lines only for new/inconclusive, one summary line for the pre-existing count, and the cleanup state.
- Table `usage`/`brief` get `[--baseline]` and the clause "reports only failures that are NEW compared with the base (heuristic)". Cap raise per §3.3 if the
  measured block needs it (one more ~60 chars; fits the A2 cap, assert in the test).
- Prompt: Integrating step 1 gains "use `--baseline` when the repository's checks already fail on the base branch."

### 7.5 Part A1b test list (exact)
**`dispatch/baseline.test.ts` (new, pure):** `failureSignatures` on fixtures for vitest, node:test (`not ok`), cargo, pytest, go, tsc; normalisation (line numbers, durations, timestamps, worktree paths) makes the same failure from two trees equal; cap 200; classification table (passed→failed = `new-failure`; same set = `pre-existing`; superset = `new-signatures` with the extra lines; bare exit codes = `inconclusive`; baseline timeout = `inconclusive`); verdict precedence; label constants (`method:'heuristic'`).
**`git-worktree.test.ts`:** `addDetachedWorktree` creates a detached worktree at the sha under a `tmp/` path and registers it; `removeDetachedWorktree` removes dir + registration; **link-first**: a worker `node_modules` fixture with a file survives removal of a baseline that links to it; a link that cannot be removed leaves the directory and returns `left-behind` without recursing; `sweepVerifyBaselines` removes only entries older than 1 h under `tmp/verify-baseline/` and never anything under `worktrees/`; `pruneOrphans` does not touch `tmp/verify-baseline/`.
**`workflows/dispatch-engine.test.ts` — `describe('verify --baseline')`:** a fixture where `npm test`-like command fails identically on base and worker → verdict `no-new-failures`, `preExistingCount:1`; fails only on the worker → `new-failures`; no worker failure → no worktree created (assert directory never appears) and `no-new-failures`; `resolveReadOnlyDiffBase` → `undefined` → `baseline.state:'unavailable'` with the worker result intact; **the temp worktree is gone and unregistered after**: success, a throwing runner, a timeout, an abort via `cancel(caller)` and `dispose()`; counts as one run of the cap; baseline commands equal the failed subset; `tmp/verify-baseline` never under `worktrees/`.
**`server/contract-parity.dispatch.test.ts`:** `VerifyBody`/`Verify200` asserts now include `baseline`; a pre-A1b result without `baseline` parses; `method` other than `'heuristic'` rejected; `verdict` required when `state==='compared'` is enforced by the server test (schema keeps it optional — assert the route never emits `compared` without it).
**`dispatch/task-cli.test.ts`:** `--baseline` sends `baseline:true`; exit codes by verdict; the output contains `HEURISTIC` and the disclaimer sentence; `inconclusive` prints exit 4. **`dispatch/commands.test.ts` / `manager-prompt.test.ts`:** block still ≤ cap and contains `tree`; worst-case ≤ `PROMPT_MAX_CHARS`.

### 7.6 Part A1b acceptance
`onni task verify <worker> --baseline` prints, besides onni's own result, only the failures that are new against the worker's
fork point, always labelled heuristic; the temp worktree and its dependency link are gone after every outcome (success, error,
timeout, cancel, shutdown, crash-then-restart); the worker's `node_modules` is never deleted; `inconclusive` is never shown as green.

---

## 8. Sequencing, commits and gates

| PR | Conventional commit scope (examples) | Depends on |
| --- | --- | --- |
| A | `feat(git): read-only trial merge and diff-base helpers`; `refactor(core): move discoverVerifyCommands to verify-commands`; `feat(dispatch): resolveRunRef and appendReportSection` | — |
| A1 | `feat(contract): verify schemas and dispatch.verify record field`; `feat(dispatch): onni task verify route, runner and cli`; `docs(manager-worker): wave-A verify appendix` | A |
| A2 | `feat(contract): conflicts schemas and dispatch.scope`; `feat(dispatch): onni task conflicts route and cli`; `docs(manager-worker): wave-A conflicts appendix` | A (A1 not required) |
| A1b | `feat(dispatch): verify --baseline with a temporary worktree` | A1, A |

Each PR: lowercase subject, no trailing period, Conventional Commits with scope (AGENTS.md). No version bump by hand.
Each PR runs the five-step gate; `test:unit` and `test:package` stay server- and browser-free (the new tests spawn
`bash`/`git` only inside capability-guarded tests, none start the cockpit). Native Windows is expected to be noisy
(AGENTS.md "Windows development machine"): the new tests that need `bash`/`git merge-tree` check the capability inside
the test and return early; CI is the authority. **Prove the regression tests red before green** for the label-stale
rule, the exit-1 classification and the cleanup-on-throw (`git stash push -- <source>` pattern from AGENTS.md).

Files each PR touches (so the series order is auditable): `contract/src/dispatch.ts`; `server/server.ts`;
`workflows/run.ts`; `dispatch/{engine,commands,task-cli,prompt-budget,tree-fs,access}.ts`; new
`dispatch/{verify,verify-exec,conflicts,baseline}.ts`, `core/verify-commands.ts`; `git-worktree.ts`;
`workflows/manager-worker.ts`; `docs/design/manager-worker.md`; the matching `*.test.ts` named above.
`data-gitignore.ts`, `.env.example`, `docs/reference.md`: **no change** (no new state file outside `tmp/`/`dispatch/`, no env var;
`docs/reference.md` is checked for an `onni task` command list at implementation time — a `grep` of `docs/` found none).

## 9. Open decisions and risks

| # | Question | Recommendation |
| --- | --- | --- |
| D1 | **Synchronous vs async verify.** A sync call must finish inside the HTTP client's patience (≈ 300 s) and the agent's shell timeout; a repo whose suite takes 10 min reports `timed-out`. An async job (`POST` → `202 {verifyId}`, `GET …/verify/:vid`, result also delivered like a report) fits long suites but is a second protocol with its own states. | Ship sync with the 280 s ceiling (v1). Revisit async only if real trees hit `timed-out` on honest suites. Owner decision before A1 is dispatched. |
| D2 | **Baseline dependencies** (§7.2.6): linking the worker's `node_modules` makes the baseline run use the worker's dependency set (a changed lockfile skews it) and risks a destructive cleanup if mishandled; not linking makes most JS baselines `inconclusive`. | Link, label it, remove link-first, never recurse past an undeletable link. Alternative: skip JS baselines unless the user opts in. Owner decision before A1b. |
| D3 | `only` in the verify input widens the surface by a selector (never a command). | Keep: it lets a manager re-run just the failing script within the 3-run cap. Drop if the owner wants zero selection. |
| D4 | Verify reads commands from the manager's worktree, falling back to the checkout (§5.3). If the manager changed `package.json` scripts itself, verify uses the manager's version. | Accept; the warning in §5.3 covers the worker side. |
| D5 | Project secrets are not passed to verified commands. | Accept for v1; a check needing a secret fails visibly. |
| R1 | `resolveRunRef` (§4.5) is stricter than the inline copies in `peekFor`/`mergeFromAgent`. | Leave the old ones; open a follow-up. |
| R2 | `git merge-tree` writes loose objects each call. | Bounded by `CONFLICTS_TRIAL_MAX`; collected by `git gc`; documented in the helper. |
| R3 | The manager-brief edits (§5.9, §6.5, §7.4) change prompt text. Plan v2's Đợt 0 behavior baseline was never recorded, so there is no measure of whether managers use the commands. | Add the appendix note "unmeasured"; include `verify`/`conflicts` use in the C2 evaluation harness when it exists. |

Not in this wave: B1 (`cancel`/`message`/`redirect`), auto-verify on settle, `merge --to-base` requiring a green verify,
peek showing the verified state (all listed in the proposals doc as later extensions).
