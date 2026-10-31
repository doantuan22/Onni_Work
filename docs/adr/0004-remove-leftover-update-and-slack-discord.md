# ADR 0004 — Remove the leftover update machinery and the Slack/Discord webhook formats

- Status: accepted
- Date: 2026-10-31
- Follows: [ADR 0002](0002-remove-self-update-telemetry-publish.md)

## Context

ADR 0002 removed the registry self-update, but three kinds of update code stayed
behind, and the webhook family still carried two vendor chat formats:

- **Open Mercato skills auto-update**: `skills-update.ts`, a coordinator started
  from `startServer`, `npx --yes skills check|update`, three
  `/api/v1/workspace/skills-update*` routes, the `skillsAutoUpdate` config key,
  `ONNI_SKILLS_AUTO_UPDATE`, a Skills settings toggle, an update card and a nav
  marker. It ran a child process against the network by default.
- **Orphans of the update dialog**: `WorkspaceSemaphore.activeRuns()` and
  `idle()` (plus `RESTART_SENSITIVE`) existed only to warn "N tasks are running"
  before an update restart. Nothing but tests called them.
- **Slack and Discord**: `webhooks/slack.ts`, `discord.ts`, the `slack.v1` and
  `discord.v1` formats in the contract, transport special cases (Discord
  `wait=true`, provider diagnostics), and a destination picker with previews.

## Decision

Delete all of it, with its tests, contract schemas, UI, env variable and docs.
Nothing is renamed and no other behaviour changes.

- The generic outbound webhook is untouched: signed `onni.json.v1`, HMAC, outbox,
  retry/backoff, lifecycle events. `format` stays in the contract as a
  single-value enum so the wire and on-disk shape do not change.
- A stored `skillsAutoUpdate` in `~/.onni/config.json` is left as an unknown key
  (the schema is passthrough); nothing reads it.
- **Stored Slack/Discord receivers are dropped on read** (owner decision). The
  strict `endpoints.json` schema would otherwise fail the whole registry. Each
  dropped receiver leaves a `history` row (`id`, `name`, `deletedAt`). A queued
  delivery whose `format` is `slack.v1`/`discord.v1` reads as a plain delivery
  for a receiver that no longer exists, which the service already handles.
  Users re-create the destination as a custom endpoint (Make, n8n, a relay).

## Kept, on purpose

| What | Why it stays |
| --- | --- |
| `self-update/` (`layout.ts`, `checkouts.ts`, `cli.ts`, `semver.ts`) | The local version layout: `~/.onni/versions/current` and `onni link`/`unlink`. `semver.ts` only produces the `-dev` display version. Every file serves the layout; none touches a registry. `self-update.test.ts` covers the layout. |
| Desktop "Versions" menu (`lib.rs`) | Switches the `current` link; reads the same layout. |
| `POST /providers/:provider/update`, `AgentUpdateRequiredCard` | Opens a terminal for the agent CLI's own update (`opencode upgrade`). It updates a third-party CLI the user already runs, not Onni. |
| `--no-auto-update` for `copilot` | Keeps an agent CLI from swapping itself mid-task. |
| `web/src/lib/stale-build.ts` | Reloads a tab after a rebuild; no download involved. |
| `npx --yes e2e@latest init` in `e2e-setup.ts` | A prompt for the agent to scaffold e2e in the user's repo, not an Onni update path. |
| Remote team skills repo, trackers, `server-install`, automations, Design Mode | Out of scope (owner has not decided). |

## Open questions for the owner

- `server-install` still writes a systemd unit that runs
  `npx --yes onni-cli serve`, but nothing publishes `onni-cli` any more
  (ADR 0002). Decide whether it should run a checkout instead.
- The agent-CLI update route/card: keep (current) or drop with the rest.

## Consequences

- One fewer default-on network/child-process path; `ONNI_SKILLS_AUTO_UPDATE` is
  gone from `.env.example` and the reference.
- Public API shrinks: three routes, the `skillsAutoUpdate` and
  `effectiveSkillsAutoUpdate` fields of `GET/PUT /workspace/config`, and the
  `slack.v1`/`discord.v1` webhook formats.
