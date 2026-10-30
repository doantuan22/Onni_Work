# `.ai/specs/` — inherited design record

This directory is the **upstream design record** carried over from cezar (the MIT
engine Onni Work is forked from). The specs are numbered and dated, and they are
kept close to verbatim on purpose: they explain *why* a mechanism exists, which
the code alone cannot.

## How to read them

- **They may use old names.** A spec can say `cez`, `cezar`, `CEZ_*`,
  `@open-mercato/cezar*`, `.ai/cezar/`, `~/.cezar/`, `packages/cezar`, the
  `cez/<id8>` branch prefix or "Cezar" (the desktop product). The rename mapping
  is in [`docs/adr/0003-rename-to-onni.md`](../../docs/adr/0003-rename-to-onni.md).
- **They can describe removed features.** Self-update/downgrade-able release
  channels, telemetry, npm publishing and the star-count chip no longer exist
  (see [`docs/adr/0002-remove-self-update-telemetry-publish.md`](../../docs/adr/0002-remove-self-update-telemetry-publish.md)).
  A spec that describes one is history, not a requirement.
- **Some links are dead.** A few specs point at directories that were never
  imported with the fork (`../runs/`, `../data-model/`, `../prototypes/`). They
  are left untouched rather than rewritten, because rewriting would turn the
  design record into a second, competing source of truth.

## What wins on conflict

1. **The code** (`packages/`, `.env.example`, `package.json` scripts).
2. **[`AGENTS.md`](../../AGENTS.md)** — the current working rules.
3. **[`docs/`](../../docs/)** — current reference and overview.
4. **These specs** — the historical reasoning.

When a spec and the code disagree, the code is right and the spec is the
background. Do not update a spec to match a new implementation; write the change
down where it belongs (AGENTS.md, docs, an ADR, or the commit message).

## Adding a spec

New design work belongs in a date-numbered spec (`YYYY-MM-DD-<slug>.md`) like the
existing ones. Fork-level decisions that change direction (rather than describe a
feature) belong in [`docs/adr/`](../../docs/adr/) instead.
