# Changelog — Onni Work

All notable changes to Onni Work are recorded here. The cezar release notes this project was
forked from are kept unchanged in [`docs/upstream/CHANGELOG-cezar.md`](docs/upstream/CHANGELOG-cezar.md).

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
- **Star count.** `GET /api/v1/star-count` always answers `{ available: false }` and makes no
  network request; the response shape is unchanged.
- **Skills.** No default team skill repository is configured: `DEFAULT_SKILLS_REPOS` is empty, so
  `GET /api/v1/config` reports `teamSkills: false` out of the box and Settings says a `skillsRepos`
  entry is needed before team skills can load. Local, agent-mirror and built-in skills are
  unaffected, and the skills repos you name yourself still load. The terminal promo banner
  (`skills-banner.ts`) is gone for the same reason.
- **Docs.** `docs/site` keeps its upstream content and gains a README banner; no workflow
  deploys it.
