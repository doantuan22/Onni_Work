# AGENTS.md — working in this repository

Onni Work is a local cockpit for running and tracking AI coding-agent tasks in one repository.
You type a task, pick a backend (`claude`, `codex`, `opencode`, `cursor`, `pi`, `junie`,
`copilot`, `antigravity`) and a workflow; each task runs in its own git worktree and streams steps, tool calls,
tokens and diffs live. A Tauri desktop shell wraps the same engine. Everything is local: no
account, no database, no cloud. State is plain JSON, NDJSON and Markdown under `.ai/onni/` and
`~/.onni/`. The server stack stays small: strict TypeScript (ESM, Node 20+), Hono + SSE + one
WebSocket bus, Zod at every boundary, YAML workflows. The cockpit is React 19 + Vite +
Tailwind v4 + shadcn/ui, built to static assets.

`.ai/specs/` is the upstream design record and still uses old names — see
[`.ai/specs/README.md`](.ai/specs/README.md). When a spec and this file disagree, this file and
the code win.

## Zero config

There is no file the user must create and no setting they must set. Every capability is
discovered from the repo, the environment, `gh` and running processes, or it degrades quietly to
a smaller Onni Work. `.ai/onni/config.json` is optional; every key has a working default. A repo
`.env` is never auto-loaded. Tracker credentials live in `onniHomeDir()/tracker-connections/`,
written by Settings, parsed only into the project connection object — never into `process.env`.

New state may be **written**, never **required**: `.ai/onni/`, `~/.cache/onni/`, `~/.onni/`.
Delete any of them and Onni Work rebuilds what it needs. The one exception: `~/.onni` also keeps
`config.json.bak`, so deleting `config.json` alone restores the project registry instead of
resetting it.

- If a feature seems to need configuration, the design is wrong. Discover it, or default it.
- Anything that widens exposure or cost (network, other processes) is opt-in behind a `ONNI_*`
  flag that is OFF by default — the safe default is also the zero-config default.
- Owner-approved default-on exceptions, each with an off switch and brakes in the engine:
  dispatch (`ONNI_DISPATCH=0`), automations (`ONNI_AUTOMATIONS=0`), the GitHub fork-parent lookup (`ONNI_DRY_RUN=1` skips it), and
  Design Mode (`ONNI_DESIGN_MODE=0`, always off on a hosted cockpit). Run limits are the reverse
  case: capped by default, and "Unlimited" is a Settings choice, never an env var.
- A missing dependency, an absent peer or a read-only home degrades to a smaller cockpit — never
  a failed boot.
- Never trade a working default for a knob. Adding, renaming or removing a `ONNI_*` variable —
  or changing what its default does — updates `.env.example` in the same commit. An
  undocumented env var is a bug.

## Repository layout

Four npm workspaces under a `private` root that publishes nothing:

| Path | Package | What it is |
| --- | --- | --- |
| `packages/work` | `@onni/work` | Service + CLI and everything behind them: runs, workflows, agent runners, git worktrees, workspace state. `bin` = `onni`, `onni-cli`, `onni-run`. Serves the built cockpit from `packages/work/web/dist` (gitignored, built by `packages/web`). |
| `packages/contract` | `@onni/contract` | The HTTP contract: every request/response as a zod schema with its type inferred. **Node-free** (`lib: ["ES2022"]`, `types: []`), so a `node:*` import is a compile error. `private`; `packages/work/scripts/inline-contract.mjs` folds it into `dist/contract/` at postbuild. |
| `packages/api-client` | `@onni/api-client` | Typed client over Hono's `AppType`, SSE/WS protocol types, `/p/:projectId` scope helpers. **Node-free** because it is bundled into the browser and imported by the Node service. The service may import it only in tests. |
| `packages/web` | `@onni/web` | The cockpit SPA. Private; `vite build` writes into `packages/work/web/dist`. |
| `packages/desktop` | `@onni/desktop` | Tauri 2 shell. **Deliberately not an npm workspace** — it pulls the Tauri CLI, which the other packages never need. It has its own `package-lock.json`; the root `npm install` does not install it. |

Rules that follow:

- The CLI is not a separate package. `packages/work/src/index.ts` boots the server *and* owns
  `RunManager`, the registry and the worktree machinery; `onni run` executes a workflow with no
  server at all.
- A dependency belongs to the workspace that imports it. A build script counts: `esbuild` is a
  devDependency of `packages/work` because `inline-contract.mjs` imports it.
- Cross-package imports go through the package name, never a relative path. The exceptions are
  test-only reaches for golden fixtures.
- The repo root keeps only what spans workspaces: `scripts/dev.mjs` (boots both halves).

## Commands

```bash
npm install                # the four workspaces (not packages/desktop)
npm run dev                # API :4321 + Vite dev server, opens the cockpit
npm run dev:server         # API only (tsx packages/work/src/index.ts)
npm run dev:web            # Vite only (proxies /api)
npm run typecheck          # contract + api-client + server + web (builds the server first)
npm test                   # vitest: server + cockpit unit suites
npm run test:unit          # node:test: fast core-module coverage
npm run build              # tsc -> packages/work/dist, vite -> packages/work/web/dist, pack gate
npm run test:package       # pack/install the release tarball and exercise the built CLI
npm run test:e2e           # real-browser cockpit suite (.ai/scripts/e2e.sh, agent-browser)
```

Narrow a vitest run by passing its own arguments after `--`:

```bash
npm test -- packages/web/src/routes/settings
npm test -- -t "the name of one test"
```

Run vitest through `npm`, never `npx vitest` — `npx` can fetch a different version than the
pinned devDependency.

Desktop (its own install, its own lockfile):

```bash
cd packages/desktop
npm install
npm run dev                # tauri dev
npm run build              # tauri build (bundles the .app/.msi)
```

`ONNI_DRY_RUN=1 npm run dev` exercises the whole cockpit with mocked agent CLIs — no login, no
network.

The UI smoke suite is separate: it boots the app on a free port with `ONNI_DRY_RUN=1`, reuses a
healthy instance, and writes `.ai/qa/test-env.json`. Exit 0 with `TEST_E2E_STATUS=skipped` means
the browser provider could not be provisioned — that is **not** a pass. Stop it with
`.ai/scripts/test-env-down.sh`.

Before any commit or PR, in order: `npm run typecheck`, `npm test`, `npm run test:unit`,
`npm run build`, `npm run test:package`. CI (`.github/workflows/ci.yml`) shards vitest 3 ways and
runs typecheck, unit, build and package; `desktop-check.yml` runs `cargo check` and `cargo test`
on Linux and Windows. `npm test` and `npm run test:unit` must stay server-free and browser-free.

## Invariants

- **Nothing merges itself.** There is no auto-merge anywhere. Landing is opt-in: the diff-first
  review gate parks a successful run with a worktree diff at `review`, but it is **OFF by
  default** (`config.reviewGate`, else `ONNI_REVIEW_GATE=1`, and autonomous runs always skip
  it). With the gate off, a successful run settles `done` and its diff simply stays in the
  worktree. Opening a draft PR goes through `gh`; merging a PR is an explicit click
  (`POST /api/v1/github/prs/:number/merge`).
- **Unattended runs are fenced.** An unattended run is `autonomous` or a dispatched child
  (`workflows/unattended.ts`). It never auto-lands (`landingPolicy`), never inherits `landing:'auto'`,
  and gets the pre-push fence (`workflows/push-guard.ts`) plus Claude's deny rules. Every run snapshots
  its `limits` at start; children inherit the parent's mode and may never be looser; the sweep
  (`RunManager.sweepLimits`) and the wait expiry bound cost, time and hangs in both limits modes.
  The fence is a barrier, not a sandbox — do not describe it as one. Dispatch depth, subtasks per
  tree and `retry_limit` stay on in "Unlimited". See `docs/adr/0005-unattended-safety.md`.
- **A roster is a fence, not a sandbox.** A tree started with a `roster` may dispatch only to the
  listed workers (`dispatch()` is the single check, 409 with the allowed list); workers stay at depth 1,
  keep `ONNI_API_URL` for `onni task report` and get the report-only prompt. Do not describe the roster as
  a security boundary: raw HTTP can still create a top-level run on any backend. The route path commits
  the manager's WIP before a fork and refuses (409) when it cannot; a worker's worktree is not reclaimed
  while its tree's root is live (`protectedByLiveTree`). See `docs/adr/0006-manager-worker.md`.
- **Local-first.** No account, no database, no cloud, no upload. `gh` and the agent CLIs run as
  the user.
- **The API is `/api/v1` only, described by zod.** Every request and response shape is a schema
  in `packages/contract` with `z.infer`. Register routes by chaining them into a family builder
  — a loose `app.get(...)` returns a value nobody keeps, vanishes from `AppType`, and serves a
  route the typed client cannot see. Validate bodies, params and query as route middleware
  (`packages/work/src/server/validators.ts`), never with `safeParse` inside the handler. The
  contract must describe exactly what the route sends: `contract-parity*.test.ts` checks both
  directions, `route-parity.test.ts` checks the two mount points.
- **Writes are atomic.** JSON state goes through a tmp file + rename with mode `0600`; the
  workspace config only through `mergeWriteWorkspaceConfig` (read-modify-write under a lock).
- **One worktree per task**, at `.ai/onni/worktrees/<runId>` on branch `onni/<id8>` (or a
  namer-generated branch). The branch name is stored on the run record, never recomputed.
  "Which ref anchors this task's diff" lives only in `resolveTaskDiffBase`
  (`git-diff-base.ts`).
- **State is written, never required**, and a corrupt file degrades to fresh instead of
  crashing. New `RunRecord` fields must be optional so old files still parse.
- **Degradation is a value, not a throw.** Git helpers, GitHub integration and `gh` failures
  return `{ available: false, reason }` or a one-line error.

- **Antigravity fails closed.** `agy` cannot ask for approval headless, so a run starts on `files-only`
  (no commands); `allow-rules` and `bypass` are Settings → Agent permissions choices, `bypass` needs
  `confirmBypass: true` and is **never** applied to an unattended run (`effectiveAntigravityLevel`). A turn
  that was blocked and answered nothing **fails** — `agy` itself reports it as success (ADR 0007). It is a
  worker only (`RUNNER_CAPABILITIES.canManage`, enforced by `rosterSchema`); turning that on takes the four
  things listed in ADR 0007 ("To enable `canManage`"), not a flag flip. It reports tokens, never USD. Do not
  add `--add-dir` or `agy-acp-bridge`.
  An agy `command(<line>)` grant matches the **whole command line** (measured, 10 real prompts): it is never a
  prefix and never a pattern, so a step's `bashAllowlist` entry becomes one exact line for this backend, and the
  `allow-rules` level is **experimental**. Those rules gate shell commands only — agy's own file and web tools
  are not limited by them. stdin is closed at spawn so a login is never waited for; a "not signed in" turn is
  an `auth` failure (`RunRecord.failureClass`). Windows runs agy's commands in PowerShell: `$env:ONNI_BIN`,
  not `$ONNI_BIN`.

## Changing a mechanism that already works

Replacing working behavior is the highest-risk change here. It fails in a characteristic way:
the new mechanism is correct, tests are green — and the DEFAULT path lost a guarantee nobody
wrote down.

- Name what the old mechanism was load-bearing FOR. `IDLE_TIMEOUT_MS` read as hygiene; it was
  also the only liveness bound on a monitored run. Before deleting a timer, lock, cap or
  timeout, grep for everything that reaches a terminal state *because* of it.
- A replacement that ships OFF is not a replacement. Diff the default path: with every new knob
  at its shipped default, what does the old scenario do now?
- Enumerate the transitions out of every state you add. "Who fires this?" finds the bug in one
  step — there is no process-exit callback, CI webhook or sub-agent-completion event.
- Grep the TYPE, not the field, for every construction site of a shared in-memory object.
  `ActiveRun` is built in `execute` and `runContinuation`; the streaming and non-streaming
  turn-end handlers in `workflows/run.ts` are near twins.
- A fail-open helper needs a populated-input guarantee, or it lies. `expandRegistrySlashSkill`
  returning its input on no-match is right for a backend's own slash commands — against an
  empty registry it turns "never loaded" into "Unknown skill". Pin the empty-input case.
- Prove the regression test fails without the fix: `git stash push -- <source>`, run it, confirm
  red, `git stash pop`. Tests written after the diagnosis pass against the bug more often than
  expected.
- Read the run-history evidence first: `.ai/specs/` for design, `git log -S` and
  `git merge-base --is-ancestor <commit> <tag>` for "was this in the release the user is on".

Two mismatches recur enough to name: `key: maybeUndefined` types a key as always-present that
`JSON.stringify` drops from the wire (spread it conditionally), and an object-literal
`type: 'x'` widens to `string` under Hono's inference, erasing a discriminant consumers narrow
on (`as const`). `versioned-surface.test.ts`, `route-parity.test.ts` and
`typed-bodies.test.ts` catch the rest.

Live signals use the WebSocket bus (`/api/v1/ws`), not `refetchInterval`. Subscription is
demand-driven: a server publisher starts on `0→1` subscribers and stops on `1→0`. Subscribe at
the scope matching the data's lifetime, always return the unsubscribe from `useEffect`, and
publish only on change. Session-global signals subscribe once at the root (health is the worked
example). One socket per local cockpit — never `new WebSocket` for a feature; add a topic.

## Conventions

- **Tests sit beside the code** (`foo.ts` + `foo.test.ts`), except package-level e2e
  (`packages/work/test/e2e`) and the slow core unit suite (`packages/work/test/unit`, node:test).
- **Do not skip or disable tests.** There is no `.skip`, `.todo` or `.only` in the tree; a test
  that cannot run on a platform is guarded by a capability check inside the test, not skipped at
  the call site. `npm test` and `npm run test:unit` must stay server-free and browser-free.
- **Commit messages** are Conventional Commits with a scope, lowercase subject, no trailing
  period: `refactor(rename): move runtime state and branch prefix to onni`,
  `docs(reference): drop the publish section`.
- **Comments** are one or two lines on WHY, citing the spec or issue (`spec 006`, `#348`)
  instead of restating the code. A paragraph-long explanation belongs in the spec or commit.
- **Versions are not bumped by hand** and there is no release workflow.
- `docs/reference.md` is the full user-facing reference; `docs/project-overview.md` is the
  architecture tour; `AGENT_PROTOCOL.md` is the runner contract. A new runner must satisfy
  `AGENT_PROTOCOL.md`, not just `AgentRunner`.

## Deliberately removed — do not reintroduce

These were deleted on purpose (see `docs/adr/0002-remove-self-update-telemetry-publish.md` and
`docs/adr/0004-remove-leftover-update-and-slack-discord.md`).
Adding one back needs an owner decision, not a PR.

- **Self-update / npm updates.** Nothing checks a registry, downloads a release or signs an
  updater. `packages/work/src/self-update/` survives under that name only because it now owns
  the **local version layout**: `onni link` / `onni unlink` register a built checkout under
  `~/.onni/versions/` for the desktop shell. No registry, no npm, no server.
- **Telemetry.** The send path is deleted, not disabled: no consent bar, no Settings → Privacy,
  no `/api/v1/telemetry/*`, no desktop error reports. Nothing about usage, errors, prompts,
  paths or project names leaves the machine. (The word "telemetry" in source comments means a
  local token/cost counter — not a send path.)
- **Star count.** `GET /api/v1/star-count`, its contract, the sidebar chip, the first-run toast
  and the promo banner are gone. Nothing asks github.com for a count.
- **npm publishing.** The root and every workspace are `private`. `check:pack` exists only to
  keep the packable package honest. No publish workflow, no dist-tags, no `npx` install path.
- **Skills auto-update.** No `npx skills` check/apply, no coordinator, no `/workspace/skills-update*`
  routes, no `ONNI_SKILLS_AUTO_UPDATE` (ADR 0004). Skills install and update by hand.
- **Slack and Discord webhook formats.** Only the signed `onni.json.v1` receiver exists; chat
  destinations go through your own endpoint (ADR 0004).
- **Docs site and release workflow.** No docs site build; `docs/` is read in the repo. No tag
  push and no release workflow — `v*` tags are never created.

## Windows development machine

The supported dev machine here is Windows 11 with Git Bash.

- **Smart App Control must be OFF** and **Developer Mode must be ON**. With Smart App Control
  on, `cargo build` / `cargo test` / `cargo check` fail with os error 4551; without Developer
  Mode, tests that create symlinks fail with `EPERM` (the desktop and the version layout use
  junctions instead, but test fixtures still symlink).
- `npm run test:unit` runs the `node:test` suite under `/bin/sh`. Native Windows Node cannot
  execute that path, so `test-env-launcher.test.ts` fails with `spawnSync /bin/sh ENOENT`. Run
  it under WSL or let CI cover it; do not "fix" it by skipping.
- `npm test` on native Windows fails ~340 tests, nearly all environment-shaped: `EPERM` while
  cleaning temp/worktree dirs, `chmod` modes (`0600` vs `0666`), `/bin/sh`, POSIX paths. Treat CI
  as the authority; do not chase these locally.
- `npm run test:e2e` shells out to `.ai/scripts/e2e.sh`; it needs `sh` on PATH and a provisioned
  browser provider.

## Where to look first

| Task | Read first |
| --- | --- |
| CLI, `serve`/`run`/`init` | `packages/work/src/index.ts`, then `data-gitignore.ts` (new state file must be listed there) |
| A new agent backend | `AGENT_PROTOCOL.md`, then `packages/work/src/core/runner-factory.ts` and one existing runner |
| Routes or payloads | `packages/contract/src/*.ts`, then `packages/work/src/server/validators.ts` |
| Runs, queue, review gate | `packages/contract/src/runs.ts`, `packages/work/src/runs/store.ts`, `packages/work/src/workflows/run.ts` |
| Git, worktrees, diff base | `packages/work/src/git-worktree.ts`, `git-diff-base.ts`, `git-remotes.ts` |
| Workspace registry, `~/.onni` | `packages/work/src/paths.ts`, `workspace/config.ts`, `workspace/projects.ts` |
| Manager / worker roster | `packages/contract/src/roster.ts`, `packages/work/src/workflows/manager-worker.ts`, `run.ts` (`dispatch`, `dispatchFromAgent`) |
| Antigravity (`agy`), its permission levels | `docs/adr/0007-antigravity-backend.md`, `packages/work/src/core/antigravity-runner.ts`, `antigravity-permissions.ts`, `antigravity-ui-mapper.ts`, `__fixtures__/antigravity/` |
| Run limits, unattended safety | `packages/contract/src/limits.ts`, `packages/work/src/workflows/limits.ts`, `push-guard.ts`, `unattended.ts` |
| Live signals | `.ai/specs/2026-07-23-websocket-subscriptions.md`, `server/ws.ts`, `web/src/api/ws.ts` |
| Cockpit UI | `packages/web/src/app.tsx`, `routes.tsx`, `api/` |
| Agent config files | `packages/work/src/agent-config/` (`catalog.ts` owns vendor knowledge) |

## Related documents

- [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md) — the runner seam, v1 `AgentEvent` + v2 `UiEvent`,
  per-backend mapping, golden fixtures, new-runner checklist.
- [`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md) — internal contract between packages
  and on-disk formats.
- [`SDLC.md`](SDLC.md) — ticket flow, labels, QA gate, claim protocol;
  [`CODE_REVIEW.md`](CODE_REVIEW.md) — what reviewers check and severity rules.
- [`docs/project-overview.md`](docs/project-overview.md) — architecture tour.
- [`docs/reference.md`](docs/reference.md) — full user reference: CLI, env vars, config.
- [`.ai/specs/README.md`](.ai/specs/README.md) — how to read the design record.
