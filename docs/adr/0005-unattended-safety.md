# ADR 0005 — Unattended safety: run limits, expiring waits, fenced pushes

- Status: accepted
- Date: 2026-11-01
- Design: [`docs/design/unattended-safety.md`](../design/unattended-safety.md)

## Context

Onni Work is meant to run agents overnight. Before this change nothing bounded an ordinary run's
cost, a dispatch tree could fan out without a depth limit, a `waiting` run with the idle timeout set to
`0` waited forever, an autonomous in-place run could land (and push) to the base branch, and an agent
with `Bash` could `git push` to any ref.

## Decision

1. **Two limit modes, one feature.** Every run snapshots `limits` when it starts: `capped` applies
   exactly the numbers given (`maxCostUsd`, `maxTokens`, `maxWallClockMinutes`, `maxStepIterations`; a
   blank one is unlimited) and `none` applies nothing. A fresh install is capped (10 USD, 10 M tokens,
   240 min, 30 steps). Counters are durable (steps carry cost/tokens; active wall-clock accumulates on
   the record), so `recover()` cannot reset them. Children inherit the parent's mode, receive the
   parent's remaining share, and a tree is also checked against its root's ceilings. A hit ends the
   run (and tree) as `cancelled` with `limitHit`, keeping worktree and session; Continue requires
   `raiseLimits`, which adds one more allowance of the ceiling that was hit.
2. **Always on, in both modes:** the unanswered-wait expiry (default 30 min, 1–1440, no "off") for
   unattended runs, and dispatch's structure: depth (default 1), subtasks per tree (default 12 when the
   root set none) and `retry_limit` (enforced, not removed).
3. **Unattended = `autonomous` or a dispatched child.** Such runs never auto-land, whatever the config.
4. **A fence for pushes**: a `pre-push` hook injected through `GIT_CONFIG_*` env (not
   `extensions.worktreeConfig`), Claude `--disallowedTools`, and a guarded `git.push` node.
5. **Emergency stop** (`cancelAll`, `POST /workspace/stop-all`, `onni stop --all`), a morning digest
   on the Inbox, and system notifications through `tauri-plugin-notification`.

## Consequences

- Default-on limits change behaviour for existing users: a long run now stops at 10 USD / 240 min
  until it is raised or the default is set to Unlimited.
- `extensions.worktreeConfig` was rejected: it flips a repo-wide extension flag that older git and
  some tooling cannot read, and it leaves per-worktree config behind after a run.
- The fence is **not a sandbox**. `--no-verify`, a rewritten `core.hooksPath`, writes outside the
  worktree, `$HOME`, the network and every backend other than Claude (no deny seam) remain open.
- Cost enforcement is checked every 15 s and at each settle, so a single long turn can overshoot a
  cost ceiling by one turn's spend; backends without USD (codex, copilot, cursor) are bounded by
  tokens, time and steps only.
- The limit settings take no environment variable, so `.env.example` documents their absence.
