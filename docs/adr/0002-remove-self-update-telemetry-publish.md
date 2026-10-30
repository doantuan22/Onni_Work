# ADR 0002 — Remove self-update, telemetry and publishing

- Status: accepted
- Date: 2026-10-30

## Context

Upstream cezar is distributed and operated through network surfaces: usage
telemetry, npm packages, a star-count lookup, and a desktop/CLI updater that
checks a release endpoint. Onni Work is a personal, local-first tool: the promise
is that nothing about usage, prompts, paths or project names leaves the machine,
and that the cockpit works from a plain checkout with no accounts.

Leaving a surface in place but "off by default" was rejected: an opt-in send
path is still a send path, and a button that asks github.com for a count is still
a network call.

## Decision

- **Telemetry is deleted, not disabled.** No consent bar, no Settings → Privacy,
  no `onni telemetry` command, no `/api/v1/telemetry/*` routes, no desktop error
  reports. There is no code path that sends usage data.
- **The star ask is deleted.** `GET /api/v1/star-count`, its contract schema and
  reader, the sidebar chip, the first-run toast and the dialog are gone.
- **Nothing is published.** The root and every workspace are `private`; there is
  no `publishConfig`, no release workflow, no dist-tags and no documented `npx`
  install. `npm run check:pack` exists only to keep the packable package honest.
- **No remote self-update.** The desktop ships no updater endpoints and no
  signing key, downloads nothing at boot, and requires Node 20+ to already be
  installed. Updating means rebuilding the checkout and relinking it.
- **The `self-update` module keeps only the local half.** It now manages
  `~/.onni/versions/<id>` plus the `current` symlink/junction: `onni link` and
  `onni unlink` register a local build, and the desktop's Versions menu switches
  between them. This is version *linking*, not version *fetching*.
- **The contract ships inside the service.** `packages/contract` is private, so
  `packages/work/scripts/inline-contract.mjs` folds it (bundle and declarations)
  into `dist/contract/` at postbuild. This is packaging, not publication.

## Consequences

- There is no automatic update channel. A user on an older build stays there
  until they rebuild.
- Crashes are reported by hand. No error report is generated or sent.
- Installing means cloning/building, not `npx`. The README documents the source
  path only.
- Any future network feature must be opt-in behind an `ONNI_*` flag and must not
  reintroduce a silent send path; adding one back is a decision for a new ADR.
