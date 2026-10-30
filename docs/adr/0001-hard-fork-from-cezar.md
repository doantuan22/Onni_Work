# ADR 0001 — Hard fork from cezar

- Status: accepted
- Date: 2026-10-30

## Context

Onni Work started as the MIT-licensed **cezar** engine by Patryk Lewczuk
(`github.com/open-mercato/cezar`). The fork needs changes that are not
upstream-shaped: a desktop-first shell, removal of the upstream network services
(telemetry, npm publishing, self-update — see ADR 0002), and a complete identity
rename (ADR 0003). These are not patches upstream would take, and maintaining a
long-lived patch queue against a moving upstream is more work than owning the
code.

## Decision

- **One hard fork.** The repository starts at a single imported snapshot (the
  initial commit); upstream git history is not carried over and no upstream
  remote is merged or rebased from.
- **Attribution is kept.** `LICENSE` keeps the original copyright, the fork's
  copyright is added below it, and `NOTICE` records the derivation. MIT requires
  the copyright and permission notice to travel with the code.
- **No compatibility layer with upstream.** No `cez*` aliases, no fallback
  readers for the old names, no dual-published packages.

## Consequences

- Upstream fixes must be ported by hand. The mass rename makes an upstream diff
  impractical to apply directly, so a fix is re-implemented against this tree
  and the upstream issue/commit is cited in the commit message.
- The repository carries no upstream release notes; `NOTICE` points at the
  upstream project instead.
- Version numbers continue from the fork point (`0.17.0`) as this project's own
  history.
- The fork's license obligations survive any future re-licensing decision: the
  original MIT notice cannot be removed from derived files.
