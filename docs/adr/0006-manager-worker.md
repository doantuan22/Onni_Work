# ADR 0006 — Manager / Worker: a user-chosen roster, enforced by the server

- Status: accepted
- Date: 2026-11-01
- Design: [`docs/design/manager-worker.md`](../design/manager-worker.md) (and its appendix of deviations)
- Builds on: [ADR 0005](0005-unattended-safety.md)

## Context

Dispatch let any running task start other tasks on any backend. Users wanted one agent to *manage* a
tree and a *chosen* set of agents to work, with no other agent ever used, and the manager told how to
hand over work, collect reports and integrate them.

## Decision

1. **A roster** (`manager` + 1–6 `workers`, each `backend`, optional `model`, free-text `role`,
   `maxConcurrent`) is chosen by the user and snapshotted on the root run (`RunRecord.roster`). Several
   entries may share a backend with different models; the manager is never its own worker (same backend
   on another model is fine). Presets are stored per workspace (`managerWorker` in `~/.onni/config.json`)
   and can be overridden per task.
2. **Backends are discovered, not listed**: the composer, Settings and `POST /runs` use the provider
   status (connected and enabled). A roster naming a backend that is not connected is refused with 409.
3. **The allowlist lives in `dispatch()`** (the one place the route and the graph node share): a dispatch
   outside the roster is a 409 listing the allowed workers. It is an orchestration fence, **not a security
   boundary** — an agent can still run a CLI directly or call the HTTP API, and a top-level run created
   over raw HTTP is not bound to any roster. Accepted and documented.
4. **Depth and teaching**: workers stay at depth 1 (server-side, unchanged). A worker keeps
   `ONNI_API_URL` so `onni task report` works, but its prompt is report-only and its record carries no
   dispatch-teaching prompt. The manager's prompt carries the roster, the `--backend`/`--model` syntax,
   how reports arrive, the integration procedure (disjoint scopes, merge `onni/<id8>` branches one at a
   time, resolve conflicts, check after each merge, never merge failed/blocked work, report) and what is
   left of the tree's ceilings.
5. **Fork point**: the route path (`dispatchFromAgent`) commits the manager's uncommitted work first as
   `onni: wip before dispatch`, independent of `ONNI_AUTOSAVE`; if that commit fails the dispatch is a 409
   and no child is created.
6. **Capacity**: a manager parked on its own dispatch is already exempt from `maxParallel`
   (`busySlots`, `unitParents`), so `maxParallel` 1 or 2 cannot starve or deadlock its workers (tested).
   `maxConcurrent` per entry is enforced in the queue pump: a worker over its entry's cap keeps its place
   while others start.
7. **Retention**: a worker's worktree is never reclaimed, and its run cannot be deleted by hand, while the
   tree's root is not in a final state. Retention only ever removed the directory (the branch is kept).
8. **Everything bounded by ADR 0005**: ceilings, subtask cap, depth, retry limit and wait expiry apply
   unchanged; the roster adds no second budget.
9. A manager that finishes without having dispatched anything gets a transcript note, a
   `managerDidNotDelegate` flag, and a line in the morning digest.

## Consequences

- `onni run --manager <backend[:model]> --workers <a,b:model,…>` needs a running cockpit (a headless run
  cannot dispatch); roles and per-entry concurrency are set in the composer or a preset.
- Adding a runner (for example Antigravity) means adding it to the runner list and the contract enum; the
  roster UI then offers it as soon as it is connected, with no UI change.
- The manager can ignore its prompt and do the work itself or integrate badly; the engine fences *where*
  work may go, not *whether* it is delegated or merged well.
- Two workers touching the same files still conflict; the prompt asks for disjoint scopes and the manager
  resolves conflicts in its own worktree.
