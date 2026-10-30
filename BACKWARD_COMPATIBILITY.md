# Backward compatibility — the internal contract

This repository publishes nothing and has no external consumers. "Backward compatible" here
means two narrower things:

1. **Between workspaces** — `packages/contract`, `packages/api-client`, `packages/work`,
   `packages/web` and `packages/desktop` compile and talk to each other.
2. **Between the user's own builds** — a run record, config file, skill, workflow or linked
   checkout written by an older build still works in a newer one.

It is **not** a semver promise to an outside audience. There is no published package, no public
API guarantee and no deprecation window. Section numbers below are cited from source comments;
keep them stable.

## Rules for any persisted or cross-package change

- **Add optional fields; never repurpose one.** A new key on a run record, config file or wire
  payload is optional, so an old file still parses. A missing optional field means "unknown" —
  never `false`, `0` or an empty list that changes behavior.
- **Readers tolerate unknown keys.** Persisted schemas that round-trip use `.passthrough()`, so a
  key a newer build added survives a save by an older one.
- **Adding to an exhaustively-consumed enum is a breaking read.** `runStatusSchema`,
  `runnerSchema` and friends must be handled everywhere the old set was, in the same commit.
- **No migration layer exists.** Old data is read, not migrated. Do not rename a persisted key or
  file without reading the old name — there is nothing later that can fix the user's machine.
- **Every new run-data file is listed in `DATA_GITIGNORE_ENTRIES`** (`data-gitignore.ts`) in the
  same commit. `data-gitignore.test.ts` cross-checks the list against every `join(dataDir, '…')`.

## 1. CLI commands, flags and exit codes

`packages/work/src/index.ts`, parsed with `node:util` `parseArgs` — no CLI framework.

| Command | What it does |
| --- | --- |
| *(none)* / `serve` | Start the cockpit for the current repo. `-p/--port` (default 4321), `--repo`, `--no-open`, `--bind-host`. |
| `run "<task>"` | Headless run in the terminal. `--workflow` (default `quick-task`), `--model`. |
| `init` | Scaffold `.ai/onni/`; never overwrites an existing file. |
| `projects [list|add|remove]` | Read or edit the workspace registry; no server needed. |
| `task <create|report|list>` | Dispatch from inside a running task (`ONNI_DISPATCH=0` disables). |
| `automation <add|create|check|run|list|…>` | Manage automations on a running cockpit. |
| `runs list` | Read a running cockpit's tasks. |
| `tracker-connections <list|remove>` , `secrets <list|set|unset>` | Local credentials; `set` reads the value from stdin. |
| `server-install` / `server-deploy` / `server-uninstall` | Host the cockpit on a VPS (`--platform`, `--domain`, `--external-proxy`, `--bind-host`, `--yes`). |
| `link [dir] [--use]` / `unlink <id|dir>` | Register a built checkout under `~/.onni/versions` for the desktop shell. |
| `--help` / `-h` | Usage. Unknown command: prints usage, exit 1. |

Exit contract:

- `onni run` exits **0** on `done` *and* `review` (a headless run must not hang on the GUI gate),
  **1** on `failed`/`cancelled`.
- `runs`, `task` and `automation` exit **2** for a usage error or a missing `ONNI_API_URL` — the
  address is never guessed, because a fallback could write to whatever cockpit owns the port.
- Everything else exits 0 on success and non-zero with a one-line message on failure.

## 2. HTTP API of the cockpit server

- Everything answers under **`/api/v1`**; the unversioned surface is gone and returns 404.
  `versioned-surface.test.ts` fails on any route outside it.
- Every request and response shape is a zod schema in `packages/contract`, its TypeScript type
  `z.infer`. The schema must describe exactly what the route sends — no wider, no narrower.
  `contract-parity*.test.ts` asserts both directions; a one-way check passes on real drift.
- Routes are registered by chaining into a family builder. A loose `app.get(...)` returns a value
  nobody keeps, disappears from `AppType`, and serves a route the typed client cannot see.
  `typed-bodies.test.ts` proves a route reached `AppType`.
- Project routes are mounted once and answer at `/api/v1/<path>` (boot project) and
  `/api/v1/p/:projectId/<path>`, with `default` as the reserved boot alias. `route-parity.test.ts`
  asserts the spellings answer byte-identically. Workspace-level routes (`/projects`,
  `/workspace/*`, `/fs/browse`) are single-mount and have no scoped twin.
- Errors are `{ error: string }` with 400/403/404/409/502 as documented per route. An
  unavailable integration degrades to a value (`{ available: false, reason }`), never a 500.
- `/api/v1/health` is the **one** CORS-open route and the one WebSocket topic flagged
  `loopbackReadable`. It must never carry `projects[].root` or a secret. Never widen CORS.
- Capabilities are the minimum-version signal: the cockpit hides what the server says it lacks,
  and the matching endpoints refuse as defense in depth. A new capability is an additive
  boolean, always sent by the current server.

Frozen shapes that source comments call out by this section: the compact session view, the
`{error}` rejection shape, the health payload, the GitHub/PR shapes and the bookmarklet deep-link
grammar. Do not reshape them in a PR that is "only a refactor".

## 3. `.ai/onni/` state files

Per-repo, plain files, no database. Missing or corrupt degrades to fresh; nothing here is
required to boot.

| Path | Format | Owner |
| --- | --- | --- |
| `runs.json` | JSON array of `runRecordSchema` | `runs/store.ts` |
| `runs.json.tmp`, `runs/.index-*.tmp` | atomic write scratch | `runs/store.ts` |
| `runs/<id>.ndjson` | append-only events, one JSON object per line, replayed then streamed | `runs/store.ts` |
| `runs/<id>.handoff.md`, `runs/<id>-images/` | handoff journal, attachments | `handoff.ts`, `runs/store.ts` |
| `worktrees/<runId>` | one git worktree per task | `git-worktree.ts` |
| `workflows/`, `skills/` | **committable** repo workflows and skills | `workflows/load.ts`, `skills.ts` |
| `config.json` | optional project config; every key defaulted, invalid → defaults | `config.ts` |
| `ui-state.json` | per-repo GUI preferences (open bag, `.passthrough()`) | `ui-state.ts` |
| `todos.json`, `attachments/`, `drafts/`, `layouts/`, `tmp/` | inbox, attachment library, unsent composer text, task layouts, per-run agent temp dirs | various |
| `tracker.json`, `automations.json`, `automation-state.json`, `automation-*.ndjson` | tracker + automation state | `server/tracker/`, `automations/` |
| `webhooks/`, `dispatch/`, `lifecycle/` | signing keys and delivery snapshots, dispatch channel, worktree lifecycle history | `webhooks/`, `dispatch/`, `worktree-lifecycle/` |
| `mcp.local.json`, `launch-key` | private per-project MCP servers, bookmarklet launch secret | `core/private-mcp.ts`, `server/launch-key.ts` |

`workflows/` and `skills/` are the only committable entries. The `.gitignore` list is a per-entry
allowlist, not a blanket `*`: a new state directory that is not named there is covered by
nothing.

## 4. Workflow YAML format

`workflows/types.ts` + `load.ts`. A step is agent (`prompt`/`skill`) XOR check (`command`); a file
has `steps` XOR the portable `skills` shorthand — both enforced by zod refinements.
`onFail.retry` may only reference an earlier step. `{{task}}` is the substitution token.
`version: 2` adds the node graph. `quick-task` is the built-in zero-config workflow, and built-ins
always come back after deletion. New optional keys only.

## 5. Skills Markdown format

`skills.ts`. A `.md` file with optional YAML frontmatter (`name`, `description`); the body becomes
the agent's extra system prompt. Discovery precedence is local-first: `.ai/onni/skills` →
`.ai/skills` → `.agents/skills` and agent mirrors → global → team repo. Only markdown under a
folder named `skills/` is picked up from a team repo; `…/skills/<name>/SKILL.md` is a directory
skill, any other `…/skills/**/*.md` a flat one. Discovery is additive: legacy layouts keep
loading.

## 6. Desktop shell ↔ engine layout

The shell runs the engine named by `ONNI_DESKTOP_ENTRY`, else whatever
`~/.onni/versions/current` resolves to:

```
~/.onni/versions/<id>/node_modules/@onni/work/dist/index.js   entry
~/.onni/versions/<id>/.onni-install.json                      manifest
~/.onni/versions/current -> <id>                              symlink (junction on Windows)
```

Manifest: `{ version, source: 'registry' | 'local' | 'link', installedAt, checkout?, branch? }`.
`<id>` is a version string plus `+<branch>` for a linked checkout; the directory name is frozen
because the manifest and `current` must agree. Today only `onni link` writes here — there is no
registry, npm or download path. Deleting the directory is always safe: it is state, not
configuration.

The **npm package surface** section that used to live here is gone: nothing is published, so no
`bin`, `files` or `exports` field is a contract to an outside installer.

## 7. Agent event protocol

`AGENT_PROTOCOL.md` is the authority; this is the compatibility rule.

- Every backend implements `AgentRunner` / `AgentSession` and emits **both** the v1 `AgentEvent`
  stream (`core/agent-runner.ts`) and the normalized v2 `UiEvent` protocol
  (`packages/api-client/src/protocol/ui-events.ts`).
- `RUNNER_IDS` in `core/agent-runner.ts` is the single source of truth for the runner set;
  `runnerSchema` in the contract must stay in sync. `claude-cli` is a legacy id kept so old run
  records parse.
- The NDJSON event vocabulary is an **append-only on-disk format**: a new event type is additive,
  an existing one is never reshaped. Golden fixtures pin each backend's mapping — a change that
  alters a fixture is a protocol change, not a test update.
- A new backend ships with fixtures and passes backend-parity; `ONNI_DRY_RUN=1` must keep working.

## 8. In-band agent marker vocabulary

Parsed from assembled turn text; marker lines are stripped from displayed output.

| Marker | Meaning |
| --- | --- |
| `ONNI:DONE` | Turn finished; the run may settle. |
| `ONNI:MONITORING` | Still working downstream — `running` + `activity: 'monitoring'`, with a wake timer. |
| `ONNI:ASK <compact-json>` | Asks the user a structured question — parks the run at `waiting`. |
| `ONNI:PR=<n>` | Declares the PR this task opened. |
| `ONNI:ISSUE=<n>` | Declares the issue reference. |
| `ONNI:TITLE=<text>` | Declares the task title. |

An explicit `ONNI:*` declaration outranks a report-tier line. Adding a marker means teaching every
backend's prompt and the parser in the same commit.

## 9. `~/.onni/` per-user workspace files

Every path resolves through `onniHomeDir()` (`paths.ts`), so `ONNI_HOME` keeps tests and
containers off a real home. Literal `~/.onni` on every platform.

| Path | Format | Notes |
| --- | --- | --- |
| `config.json` | workspace config **and** project registry | Schema-versioned; every field optional with `.catch`, `.passthrough()` at every level, per-entry salvage for `projects` (one bad row never evicts the registry). |
| `config.json.bak` | last snapshot that had projects | Restored when `config.json` is missing, empty or corrupt. A config that parses and is empty is the user's own state and is never overridden. |
| `agent-accounts.json` | agent account folders + per-project selection | Its own file on purpose: a build that never heard of accounts cannot drop them. |
| `ui-state.json` | cross-project GUI preferences | |
| `secrets/` | secrets store | `0700` dir, `0600` files, no symlinks. |
| `tracker-connections/` | per-project tracker credentials | Parsed into the connection object only — never into `process.env`. |
| `versions/` | managed engine layout (§6) | |
| `server.json`, `server-instances/<slug>.json` | `server-install` host records | A named instance per domain never clobbers the default one. |

Writes go through `mergeWriteWorkspaceConfig` (read-modify-write, atomic tmp+rename, `0600`) or
that file's equivalent. A merge-write resolves its path once and uses it for both halves — the
registry was wiped once by resolving it twice. `assertOnniHomeWriteIsSandboxed` refuses a write
into the real home from a vitest process.

## 10. Caches and explicitly out of scope

`~/.cache/onni/` (team-skill clones, update metadata) is disposable. Nothing there is a contract.

Not a contract at all:

- **npm packaging and external semver.** No workspace is published, no dist-tag, no `npx` install
  path, no release line, no public deprecation policy. `check:pack` guards the tarball's
  *contents* only.
- **Upstream (`cezar`) compatibility.** History was not merged; see
  `docs/adr/0001-hard-fork-from-cezar.md`.
- **The specs.** `.ai/specs/` is the upstream design record and may describe behavior or names
  that no longer apply. Code and `AGENTS.md` win; see `.ai/specs/README.md`.
