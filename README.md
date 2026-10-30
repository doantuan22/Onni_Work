# Onni Work

A local, desktop-first cockpit for running and tracking AI coding-agent tasks in a repository.
You describe a task, pick a backend (Claude Code, Codex, OpenCode, Cursor Agent, GitHub Copilot)
and a workflow; each task runs in its own git worktree, is streamed live (steps, tool calls,
tokens, diffs), ends at a review gate, and can be pushed as a draft PR through `gh`.

Everything is local: no accounts, no database, no cloud. State is plain JSON, NDJSON and
Markdown under `.ai/cezar/`.

## What this repository is

Onni Work is built on the **cezar** engine by Patryk Lewczuk and is maintained as its own
project with its own desktop-first surface. Upstream services are not used:

- self-update, CLI install/update and the desktop updater are removed (no updater
  endpoints or signing keys shipped); the desktop runs the engine you build locally;
- telemetry is removed, not disabled — no consent flow, no consent bar, no send path: nothing
  leaves the machine;
- the GitHub star-count chip, its one-time toast and `GET /api/v1/star-count` are removed; no
  request to github.com is made.

Internal identifiers (`cez`, `.ai/cezar`, `~/.cezar`, `CEZ_*`, the `@open-mercato/*` package
scope) are unchanged. See `NOTICE` for attribution and `CHANGELOG.md` for this fork's history.

## Layout

| Path | What it is |
| --- | --- |
| `packages/work` | Service and CLI: runs, workflows, agent runners, workspace state, HTTP API |
| `packages/contract` | HTTP contract: zod schemas with types inferred from them |
| `packages/api-client` | Typed client over the service's route types; Node-free |
| `packages/web` | Cockpit SPA (React 19, Vite, Tailwind v4, shadcn/ui) |
| `packages/desktop` | Tauri desktop shell (not an npm workspace) |

## Development

Requires Node 20+.

```bash
npm install
npm run dev          # service + cockpit, with the Vite dev proxy
npm test             # vitest: service + cockpit unit suites
npm run test:unit    # node:test: fast core-module coverage
npm run build        # tsc, vite build, pack gate
```

`CEZ_DRY_RUN=1 npm run dev` exercises the whole cockpit offline with mocked agent CLIs.

Configuration is discovered, not required: every `CEZ_*` variable is optional and documented in
`.env.example` and `docs/reference.md`.

## License

MIT. Original work Copyright (c) 2026 Patryk Lewczuk; modifications Copyright (c) 2026
DOANTUANIT. See `LICENSE` and `NOTICE`.
