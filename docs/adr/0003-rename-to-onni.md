# ADR 0003 — Rename to Onni Work

- Status: accepted
- Date: 2026-10-30

## Context

The fork keeps cezar's engine but is its own product: a desktop-first cockpit
called **Onni Work**. Leaving upstream names in paths, commands, environment
variables and state directories would keep two vocabularies alive — one in the
UI, one on disk — and would make every future change answer "which name?".

## Decision

Rename every internal identifier to `onni` in one series of commits, with no
compatibility aliases and no on-disk migration. The verified mapping:

| Upstream | Now |
| --- | --- |
| package `packages/cezar` | `packages/work` |
| packages `@open-mercato/cezar`, `@open-mercato/cezar-{web,contract,api-client}` | `@onni/work`, `@onni/{web,contract,api-client}` |
| CLI `cezar`, `cez`, `cezar-cli`, `cezar-run` | `onni`, `onni-cli`, `onni-run` |
| env vars `CEZ_*`, `CEZ_HOME` | `ONNI_*`, `ONNI_HOME` |
| per-user home `~/.cezar/` | `~/.onni/` |
| cache `~/.cache/cez/` | `~/.cache/onni/` |
| project state `.ai/cezar/` | `.ai/onni/` |
| task branch `cez/<id8>` | `onni/<id8>` |
| product / bundle id `Cezar` / `com.openmercato.cezar` | `Onni Work` / `com.onni.work` |

The desktop shell was renamed too (`packages/desktop`, `@onni/desktop`).

## Why no migration

There is no installed base to migrate: this is a personal-use fork. The old
spellings are not read at runtime, and adding a fallback reader would keep the
old name load-bearing in exactly the files the rename is meant to clean up. New
state directories are created on the next run; anything the user wants to keep
from `~/.cezar/` is moved by hand.

## Consequences

- Existing `.ai/cezar/` state, `~/.cezar/` config, `cez/…` branches and
  `CEZ_*` exports are not recognized. A user who cares copies or renames them.
- External scripts that invoked `cez`, `cezar-cli` or `CEZ_*` must change; this
  is accepted for a personal tool.
- `.ai/specs/` is the upstream design record and keeps its original wording; it
  is not rewritten by this rename (see `.ai/specs/README.md`). `AGENTS.md` and
  the code are authoritative where they disagree.
- A grep for `cez`/`cezar` in the tree must find only attribution (`NOTICE`,
  `LICENSE`, ADRs), the specs, and this mapping.
