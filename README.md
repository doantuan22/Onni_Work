# Onni Work

A local, desktop-first cockpit for running and tracking AI coding-agent tasks in a repository.
You describe a task, pick a backend (Claude Code, Codex, OpenCode, Cursor Agent, pi, Junie or
GitHub Copilot) and a workflow; each task runs in its own git worktree, is streamed live (steps,
tool calls, tokens, diffs), and settles with its diff left for you to review — optionally at a
diff-first review gate — or pushed as a draft PR through `gh`. Nothing merges itself.

Everything is local: no accounts, no database, no cloud. State is plain JSON, NDJSON and
Markdown under `.ai/onni/` (per project) and `~/.onni/` (per user).

## What this repository is

Onni Work is a hard fork of the MIT-licensed **cezar** engine by Patryk Lewczuk, maintained as
its own project with its own desktop-first surface. Upstream services are not used:

- self-update, CLI install/update and the desktop updater are removed (no updater endpoints or
  signing keys shipped); the desktop runs the engine you build locally;
- telemetry is removed, not disabled — no consent flow, no send path: nothing leaves the machine;
- the GitHub star-count chip, its one-time toast and `GET /api/v1/star-count` are removed; no
  request to github.com is made.

Internal identifiers use `onni`: the `onni` command, `.ai/onni/`, `~/.onni/`, `~/.cache/onni/`,
the `ONNI_*` environment variables and the `@onni/*` package scope. See `NOTICE` for attribution
and `CHANGELOG.md` for this fork's history.

## Requirements

- **Node 20+** (`engines` in `package.json`) and **git**.
- **At least one agent CLI** installed and logged in — `claude`, `codex`, `opencode`,
  `cursor-agent`, `pi`, `junie` or `copilot`. Missing backends simply are not offered.
- `gh` is optional; GitHub views and draft PRs degrade gracefully without it.
- `ONNI_DRY_RUN=1` replaces the real CLIs with bundled mocks, so no login is needed for a demo.

Windows notes for the desktop app: **Smart App Control must be off** (otherwise `cargo` fails with
error 4551) and **Developer Mode must be on** (symlink creation otherwise fails with `EPERM`).

## Run it

```bash
npm install
npm run dev          # service (:4321) + Vite dev server, opens the cockpit
npm run dev:server   # API server alone
npm run dev:web      # Vite dev server alone (proxies /api to :4321)
npm run build        # tsc → packages/work/dist/, vite build → packages/work/web/dist/, pack gate
node packages/work/dist/index.js   # run the built service, same binary as `onni`
```

`ONNI_DRY_RUN=1 npm run dev` exercises the whole cockpit offline with mocked agent CLIs.
Configuration is discovered, not required: every `ONNI_*` variable is optional and documented in
`.env.example` and `docs/reference.md`.

## Test

```bash
npm run typecheck    # contract + api-client + server + web (tsc --noEmit)
npm test             # vitest: service + cockpit unit suites
npm run test:unit    # node:test: fast core-module coverage
npm run build && npm run test:package   # pack/install the built CLI and exercise it
npm run test:e2e     # real-browser cockpit suite (boots the app with ONNI_DRY_RUN=1)
```

`npm test` and `npm run test:unit` need no server and no browser. Some suites are POSIX-shaped
(`/bin/sh`, `chmod` modes, process-group signals); on native Windows they fail or skip — run them
under WSL or let CI cover them.

## Desktop app

`packages/desktop` is a Tauri 2 shell around the locally built engine. It is deliberately **not**
an npm workspace, so it has its own lockfile:

```bash
cd packages/desktop
npm install
npm run dev      # Tauri dev window against the local engine
npm run build    # packaged desktop app
```

It needs the Tauri prerequisites: Rust stable (the MSVC toolchain on Windows), WebView2 on
Windows, Xcode Command Line Tools on macOS, WebKitGTK on Linux. The app runs whatever
`~/.onni/versions/current` points at; `onni link --use` makes a built checkout the current engine.

## Layout

| Path | What it is |
| --- | --- |
| `packages/work` | Service and CLI: runs, workflows, agent runners, workspace state, HTTP API |
| `packages/contract` | HTTP contract: zod schemas with types inferred from them |
| `packages/api-client` | Typed client over the service's route types; Node-free |
| `packages/web` | Cockpit SPA (React 19, Vite, Tailwind v4, shadcn/ui) |
| `packages/desktop` | Tauri desktop shell (not an npm workspace) |

## Credits

Onni Work is built on **cezar** by Patryk Lewczuk. The upstream source, its documentation and its
git history were not carried over; the original MIT license and attribution are preserved in
[`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Design history for the fork lives in `.ai/specs/`.

## License

MIT. Original work Copyright (c) 2026 Patryk Lewczuk; modifications Copyright (c) 2026
DOANTUANIT. See `LICENSE` and `NOTICE`.
