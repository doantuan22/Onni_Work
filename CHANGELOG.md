# Changelog — Onni Work

All notable changes to Onni Work are recorded here. This repository keeps the cezar engine's
provenance in `NOTICE`; cezar's own release notes are not copied into it.

## 2026-10-29 — Fork hardening (Phase 2)

Onni Work is now maintained as an independent project: every functional link to cezar's
upstream services is cut, while the internal identifiers (`cez`, `.ai/cezar`, `~/.cezar`,
`CEZ_*`, the `@open-mercato/*` package scope) stay unchanged.

- **Attribution.** `Copyright (c) 2026 DOANTUANIT` added below the original cezar copyright in
  `LICENSE` and `packages/cezar/LICENSE`; new `NOTICE` records the derivation. Root `README.md`
  rewritten for Onni Work; upstream `README.zh-CN.md` / `README.zh-TW.md` removed.
- **Manifests.** `repository` metadata points at this project, `packages/cezar` and
  `packages/api-client` are private, all `publishConfig` entries and the stale
  `api-client` repository path are gone, `packages/desktop` and the Rust crate declare their
  license, and the Arch `PKGBUILD` no longer points at the upstream repository.
- **Updater.** The Tauri updater ships no endpoints and no public key. Every desktop update path
  (shell update, npm install/update-on-restart, first-run install, menu and IPC command) is
  compiled off. The CLI's `install`/`update`/`versions`/`use` and the self-update service are
  gated by a new `CEZ_SELF_UPDATE` flag, off by default, and answer
  "không khả dụng trong Onni Work".
- **Telemetry.** Removed outright: the service module, `/api/v1/telemetry/*` routes and contract
  schema, the cockpit's consent bar and Settings → Privacy section, and the desktop shell's
  `telemetry.rs`, `send_error_report` command and failure-page report card are gone.
- **Star count.** Removed outright: `GET /api/v1/star-count`, its contract schema and reader, the
  sidebar ⭐ chip, the first-run toast and the dialog are gone; nothing asks github.com for a count.
- **Skills.** No default team skill repository is configured: `DEFAULT_SKILLS_REPOS` is empty, so
  `GET /api/v1/config` reports `teamSkills: false` out of the box and Settings says a `skillsRepos`
  entry is needed before team skills can load. Local, agent-mirror and built-in skills are
  unaffected, and the skills repos you name yourself still load. The terminal promo banner
  (`skills-banner.ts`) is gone for the same reason.
- **Docs.** The Next.js documentation site (`docs/site`, its `docs:*` scripts and the
  `cezar-docs` skill), `docs/upstream/`, the server-install guides, the brand assets, the ADR and
  the screenshots are removed. `docs/reference.md`, `docs/project-overview.md`,
  `docs/upstream-audit.md`, `docs/adding-issue-tracker.md`, `docs/issue-trackers.md`,
  `docs/e2e-verification.md` and `docs/superpowers/` stay.
