# Manager–worker controls — wave B

Status: implementation plan, not implemented (2026-11-07). Wave B adds `onni task message`,
`cancel`, and `redirect` for a root manager's workers. It follows wave A's contract, access,
redaction, ledger, and sequential-change rules.

## 1. Anchors read and checked in this checkout

| Area | File:line |
| --- | --- |
| Repository rules | `AGENTS.md:16-44` zero-config; `:113-170` invariants including dispatch, roster, local-first, additive state, API contracts; `:171-248` changing-working-mechanism checklist; `:249-272` Windows caveats |
| Proposal | `docs/design/manager-worker-proposals.md:19-32,73-85,139-153` — B1 and shared rules |
| Previous plan | `.ai/specs/2026-11-03-manager-worker-gaps-plan.v2.md:38-64,173-190,820-826` — contract-first, caller is `:id`, access, redaction/ledger, H1, and §14 `#2` conditions |
| Format and patterns | `.ai/specs/2026-11-06-manager-worker-wave-a.md:63-118,149-164,368-422,535-541` — anchor table, cross-cutting rules, prompt budget, `verifyFor` route and test layout |
| Access | `packages/work/src/dispatch/access.ts:12-50` — `treeRootOf`, `requireRootManager`, `resolveRunRef`, `requireSameTree` |
| Contract | `packages/contract/src/dispatch.ts:402-429,431-484,555-590` — reports, dispatch record, `after`, and strict dispatch input |
| Peek surface | `packages/contract/src/dispatch.ts:123-150`; `packages/work/src/dispatch/peek.ts:98-124`; `packages/work/src/workflows/run.ts:3209-3248` — bounded worker entry and display |
| Dispatch lifecycle/report | `packages/work/src/dispatch/engine.ts:143-151,200-229,271-344,346-363` — cancellation maps to blocked, settle report includes branch/files/head, and pending report rendering |
| RunManager access examples | `packages/work/src/workflows/run.ts:2918-2952,2955-2986,3250-3304` — access, worker membership, redaction, caps, and result handling in `peekFor`, `conflictsFor`, `verifyFor` |
| RunManager dispatch, report, and note patterns | `packages/work/src/workflows/run.ts:4301-4334,4353-4387,4477-4521,4567-4638,4641-4654,4696-4814,3681-3702` — `--after`, blocked dependents, retry count, dispatch snapshot creation, settle report, and ledger/note pattern |
| Current cancellation and message seams | `packages/work/src/workflows/run.ts:5534-5643,5844-6130` — `cancel` (currently line 5542, not the older ~4827 anchor), queued/deferred messages, `sendMessage`, private `deliverMessage` |
| Autosave and salvage | `packages/work/src/workflows/run.ts:4080-4084,7039-7046,7418-7426,10470-10486`; `packages/work/src/runs/retention.ts:25-33` — merge-time autosave, turn-end checkpoint, periodic autosave, and protection of a worker worktree until its root settles |
| Runner contract and IDs | `packages/work/src/core/agent-runner.ts:32-42,256-288` — `RUNNER_IDS`, legacy `claude-cli`, and `AgentSession.sendMessage(): boolean` |
| Runner input behavior | `packages/work/src/core/claude-cli-runner.ts:170-190`; `codex-app-server-runner.ts:316-365`; `opencode-server-runner.ts:281-295`; `pi-runner.ts:101-130`; `junie-runner.ts:277-288`; `cline-acp-runner.ts:207-216`; `copilot-acp-runner.ts:224-234`; `cursor-agent-runner.ts:332-350`; `antigravity-runner.ts:472-485` |
| Runner behavior tests | `packages/work/src/core/claude-cli-runner.test.ts:319-326`; `codex-app-server-runner.test.ts:299-365`; `opencode-server-runner.test.ts:472-486,599-612`; `pi-runner.test.ts` (message/steer coverage to extend; exact test insertion line not selected); `junie-runner.test.ts` (queue coverage to extend; exact insertion line not selected); `cline-acp-runner.test.ts:246-270`; `copilot-acp-runner.test.ts:163-189`; `cursor-agent-runner.test.ts` (unsupported coverage); `antigravity-runner.test.ts:136-140` |
| Tree persistence | `packages/work/src/dispatch/tree-fs.ts:69,117-197` — order, notes, report, and append-only best-effort ledger |
| Route family and mounts | `packages/work/src/server/server.ts:4537-4663,7820-7821`; `packages/work/src/server/validators.ts:5-28,36-60` — dispatch gate, chained routes, both mounts, and middleware validation |
| CLI and prompt | `packages/work/src/dispatch/task-cli.ts:55-130,235-335`; `packages/work/src/dispatch/commands.ts:1-18,31-163`; `packages/work/src/dispatch/prompt-budget.ts:1-24` |
| Contract/parity/API tests | `packages/work/src/server/contract-parity.dispatch.test.ts:30-80,178-252`; `route-parity.test.ts:34-64,165-177,218-278`; `typed-bodies.test.ts:20-82,89-125`; `dispatch-api.test.ts:17-80,278-329` |
| Engine/CLI tests | `packages/work/src/workflows/dispatch-engine.test.ts:32-68,165-208,366-405,584-695,976-1069,1278-1310`; `packages/work/src/dispatch/task-cli.test.ts:224-322`; `packages/work/src/dispatch/commands.test.ts:12-45` |
| Peek tests | `packages/work/src/dispatch/peek.test.ts:85-119` — compact display and tail cap |

All line numbers above were checked against this checkout. The old `run.ts:~4827` cancellation
reference in the proposal is stale here: `RunManager.cancel` is at `run.ts:5542`. The two runner test
insertion locations marked “not selected” are deliberately unverified; implementation must locate
the current neighboring test before editing.

## 2. Contract and cross-cutting decisions

1. **The caller is the manager.** As with `verify`, `:id` is the caller from `ONNI_TASK_ID`; the
   selected worker is `target` in the JSON body. All three operations validate in
   `packages/contract/src/dispatch.ts`, then call a `RunManager.*For(callerId, input)` method.
2. **Authorization stays server-side.** Resolve `target` with `resolveRunRef`; call
   `requireRootManager(caller, action)` and `requireSameTree(caller, target)`. Require
   `target.id !== caller.id` and `target.dispatch?.rootRunId === caller.id`, following
   `verifyFor`. Unknown ids are 404, non-root callers 403, other-tree/self/non-worker/state
   refusals 409. Prompt text is not authorization.
3. **State and caps are checked by the manager method before mutation.** `message`, `cancel`, and
   `redirect` accept only `queued`, `running`, or `waiting` target records. `done`, `review`,
   `failed`, and `cancelled` are settled and refused. Existing `cancel()` may cancel a scheduled
   failed auto-resume, but this manager command intentionally does not widen the target set.
4. **Guard asks remain the user's decision.** `message` and `redirect` refuse a target parked at
   `waiting` with `dispatch.pendingAsk` or `askParked === true` (`409 guard-awaiting-user`); a
   manager instruction must not be routed as the human's answer. `cancel` is still allowed there:
   stopping the worker does not answer its question, and its settle report is `blocked`.
5. **Inputs and manager-facing text are capped and redacted.** Put shared bounds in the contract
   constants block near `dispatch.ts:431-454`: message text 2,000 chars, cancel reason 500 chars,
   redirect instruction 1,000 chars, at most 5 outstanding deliveries and 20 retained delivery
   records per worker. Trim and reject empty values. Use `store.redactRunText(target.id, text)`
   before sending, logging, persisting, or reporting text; validate both raw and redacted lengths
   without truncating an instruction. Never keep an unredacted duplicate in the new metadata.
   If redirecting the canonical objective plus the new instruction exceeds the existing
   `dispatchInputSchema.objective` 4,000-character bound, refuse before canceling.
6. **Writes have two records.** Append a `message`, `cancel`, or `redirect` event to the root's
   `dispatch/<rootRunId>/ledger.jsonl` using `appendLedger`, and append a concise `note` event to
   the manager's transcript. Add a target note for cancel/message as appropriate. Ledger writes
   are best-effort like `tree-fs.ts:189-197`; failure to write one must not strand a worker.
7. **New persisted fields are optional.** Extend `dispatchSchema` only with optional bounded
   fields so old `runs.json` records remain parseable. `dispatch.order` is the canonical normalized
   order snapshot needed by redirect; `dispatch.managerDeliveries` stores only bounded delivery
   metadata (id, state, timestamps, capability/reason code); `dispatch.managerCancellation`
   stores manager id, redacted reason, and time; `dispatch.redirectOperation` is bounded,
   redacted redirect provenance and its active transaction; `dispatch.redirectedFrom` / `redirectedTo` link a
   replacement to its source. Do not copy ordinary message bodies into delivery metadata; clear
   the redirect instruction from the operation record when it reaches a terminal state.
8. **No new setting or `ONNI_*` flag.** Keep all controls behind the existing dispatch gate.

## 3. Delivery ladder and backend capability

`deliverMessage` currently returns one boolean, and that boolean is not a receipt: it can return
true while a repo-root lease resume is still pending, and it records a user-message event before
the runner can refuse the send. Give each manager message a generated `deliveryId`, store its latest state in the bounded optional
`dispatch.managerDeliveries`, and append every transition to the ledger. The five ladder states
are exactly:

| State | Meaning and transition |
| --- | --- |
| `queued` | Onni accepted the instruction into `enqueueMessage`, the in-memory `deferMessage` buffer, or a repo-root resume wait; the runner has not accepted it yet. Use the existing persisted `queuedMessages` when `enqueueMessage` applies. `deferMessage` is process-local today, so recovery must expire its delivery metadata rather than claim it was delivered. |
| `delivered` | An open session's `sendMessage` returned `true`. This means the adapter accepted the local send request; it does not prove that the model read or understood it. Codex may still reject asynchronously after this point. |
| `acknowledged` | The runner protocol gave a positive acknowledgement tied to this send. Do not infer it from `sendMessage() === true`, from a transcript row, or from unrelated assistant output. Runners without a correlatable protocol ack remain `delivered`. |
| `rejected` | An accepted delivery attempt could not reach the runner: unsupported backend, refusal by `sendMessage`, or correlated async adapter rejection. Store a stable `reasonCode`; target/state/cap/auth/Guard refusals are HTTP errors, while backend capability is returned as a value. |
| `expired` | Onni previously accepted a queued message, then the target settled/cancelled or the process restarted before any runner accepted it. Record the terminal transition; never silently drop it. |

Instrument an internal manager-delivery receipt at the runner boundary; do not map the outer
`RunManager.sendMessage()` / `deliverMessage()` boolean directly to `delivered`, because those
methods also report accepted graph answers and asynchronous repo-root deferral. Reuse the existing
user-message event for content visibility, but do not count that event as runner acceptance.

Transitions are monotonic: `queued → delivered → acknowledged`, `queued → rejected/expired`,
`delivered → acknowledged/rejected`. A provider that cannot distinguish acknowledgement from local
send acceptance does not fabricate the `acknowledged` state. Add a small internal callback/receipt
seam only where a backend has a real correlated acknowledgement; Codex's async `turn/start` /
`turn/steer` error path is evidence that post-return rejection must be observable. Do not change the
public `AgentSession.sendMessage` boolean into a false guarantee.

Capability returned in the response is a value: `steer`, `ordered-queue`, or `unsupported`.
Cursor and Antigravity return `state: 'rejected'`, `capability: 'unsupported'`, and
`reasonCode: 'backend-unsupported'` with HTTP 200; do not throw and do not disguise unsupported as
an accepted message. Current code-level capability map:

| Runner | Same-session message | Semantics to expose |
| --- | --- | --- |
| `claude` (including stored legacy `claude-cli`) | Yes | Writes a user message to the live CLI stdin; adapter acceptance is not a model receipt. |
| `codex` | Yes | `turn/steer` while live or `turn/start` after a turn; correlate the async RPC result/rejection when available. |
| `opencode` | Yes | Posts a prompt to the existing session; prompt errors after local acceptance must move to `rejected`. |
| `pi` | Yes | Uses the live prompt protocol with `streamingBehavior: 'steer'`. |
| `junie` | Yes | Queues ordered follow-up prompts in the existing session; report `ordered-queue`. |
| `cline`, `copilot` | Yes | ACP has no steering; it queues the prompt until the in-flight turn ends. Report capability `ordered-queue`, not `steer`. |
| `cursor`, `antigravity` | **No** | Their one-shot sessions return false from `sendMessage`; answer as the `unsupported` value above. |

This table is verified from the runner implementations and listed fixtures, not from a live
provider run. Keep each adapter's actual semantics in its existing runner test; do not claim a
queued follow-up interrupted current model work.

## 4. Contracts and routes

Add the following strict request schemas and inferred types beside the other manager inputs in
`packages/contract/src/dispatch.ts`:

| Schema/type | Request shape | Bounds |
| --- | --- | --- |
| `dispatchManagerMessageInputSchema` / `DispatchManagerMessageInput` | `{ target, text }` | `target`: trimmed non-empty ≤ 200; `text`: trimmed non-empty ≤ `MANAGER_MESSAGE_MAX_CHARS` |
| `dispatchManagerCancelInputSchema` / `DispatchManagerCancelInput` | `{ target, reason? }` | optional trimmed reason ≤ `MANAGER_CANCEL_REASON_MAX_CHARS` |
| `dispatchManagerRedirectInputSchema` / `DispatchManagerRedirectInput` | `{ target, instruction }` | trimmed non-empty instruction ≤ `MANAGER_REDIRECT_INSTRUCTION_MAX_CHARS` |
| `dispatchManagerDeliveryStateSchema` / `DispatchManagerDeliveryState` | five states in §3 | exactly `queued`, `delivered`, `acknowledged`, `rejected`, `expired` |
| `dispatchManagerMessageResultSchema` / `DispatchManagerMessageResult` | `{ deliveryId, targetId, state, capability, reasonCode? }` | capability `steer \| ordered-queue \| unsupported`; reason code enum below; omit optional keys conditionally on the wire |
| `dispatchManagerCancelResultSchema` / `DispatchManagerCancelResult` | `{ targetId, status: 'cancelled', reportStatus: 'blocked', reason? }` | include a bounded redacted reason only when supplied |
| `dispatchManagerRedirectResultSchema` / `DispatchManagerRedirectResult` | `{ cancelledRunId, replacement: { id, branch? }, repointedDependents, retryAccounting: 'excluded' }` | `repointedDependents` is a non-negative integer |
| `dispatchManagerRedirectFailureSchema` / `DispatchManagerRedirectFailure` | `{ error, cancelledRunId, retryAccounting: 'excluded' }` | returned only when cancellation succeeded but replacement admission failed |

Also add these strict bounded contracts beside the request/response schemas:

| Schema / persisted field | Exact shape and bounds |
| --- | --- |
| `dispatchManagerCapabilitySchema` | enum `steer`, `ordered-queue`, `unsupported` |
| `dispatchManagerDeliveryReasonCodeSchema` | enum `backend-unsupported`, `runner-rejected`, `async-rejected`, `target-settled`, `process-restarted`; `delivery-cap`, state, authorization, and Guard refusals stay HTTP errors, not delivery records |
| `dispatchManagerDeliveryRecordSchema` / optional `RunDispatch.managerDeliveries` | `{ deliveryId: string, state, createdAt: ISO string, updatedAt: ISO string, capability, reasonCode? }`; retain latest 20, each string bounded to 120 chars |
| `dispatchManagerCancellationSchema` / optional `RunDispatch.managerCancellation` | `{ byRunId: string, requestedAt: ISO string, reason?: string ≤ 500 }`; redact reason before persistence |
| `dispatchOrderSnapshotSchema` / optional `RunDispatch.order` | normalized `{ objective ≤ 4000, redirectInstruction? ≤ 1000, title ≤ 120, kind, scope?, allowedTools? ≤ 16, maxCost?, successCriteria?, requiredEvidence?, retryLimit, backend, model?, workerKey?, after: string[] ≤ 8, reviewOf? ≤ 8, partId? }`; `objective` stays canonical; store only the latest separate redirect instruction |
| `dispatchRedirectOperationSchema` / optional `RunDispatch.redirectOperation` | `{ operationId, managerRunId, state: 'cancelling' \| 'dispatching' \| 'repointing' \| 'complete' \| 'failed', instruction? ≤ 1000, requestedAt, replacementRunId?, refusal? ≤ 500 }`; require instruction in active states, clear it at terminal state, and redact instruction/refusal |
| Optional `RunDispatch.redirectedFrom` / `redirectedTo` | replacement/source run ids, each bounded to 120 chars |

At dispatch, snapshot every `DispatchInput` field plus the resolved title, actual backend/model,
worker key, effective retry limit, and resolved `after` ids; do not reread project defaults when
redirecting. Old records without this snapshot remain valid but `redirect` refuses
`409 order-unavailable` rather than trying to reverse-engineer an envelope from `run.task` or
`order.md`.

Use three POST routes in the already chained `dispatchRoutes` family, each behind an explicit
`.use(path, requireDispatch)` and `jsonZodValidator` middleware:

| Route | Body schema | RunManager method | Success / failure |
| --- | --- | --- | --- |
| `POST /api/v1/runs/:id/message` | `dispatchManagerMessageInputSchema` | `messageFor(callerId, input)` | 200 `DispatchManagerMessageResult`; unsupported is a 200 value |
| `POST /api/v1/runs/:id/cancel` | `dispatchManagerCancelInputSchema` | `cancelFor(callerId, input)` | 200 `DispatchManagerCancelResult` |
| `POST /api/v1/runs/:id/redirect` | `dispatchManagerRedirectInputSchema` | `redirectFor(callerId, input)` | 200 `DispatchManagerRedirectResult`; post-cancel admission failure is 409 `DispatchManagerRedirectFailure` |

These must remain chained into `dispatchRoutes`, never loose `app.post`, so `AppType` sees the
validated inputs and both `/api/v1` and `/api/v1/p/:projectId` mounts carry the same endpoints.
Return `{ error }` with the denial's 400/403/404/409 status; if cancellation succeeded but
replacement admission fails, return 409 `{ error, cancelledRunId, retryAccounting: 'excluded' }`
so the CLI can distinguish the irreversible first half. Put validation in middleware, not
`safeParse` inside handlers. Add every new success response to the direct zod↔`AppType` parity
assertions; keep `as const` on literal response discriminants and spread optional keys conditionally.

## 5. `message` and `cancel` behavior

### `onni task message <id> "<text>"`

- Resolve an exact id or unambiguous prefix using `resolveRunRef`; require a same-tree dispatched
  worker, a non-settled status, no Guard/ask park, and a supported backend.
- Run `redactRunText(target.id, text)` and enforce the input/output caps. Use the manager-specific
  wrapper around `sendMessage`/`deliverMessage`, preserving existing `enqueueMessage` and
  `deferMessage` behavior for the queued and session-gap windows. A false send is `rejected` unless
  Onni has actually accepted it into a queue; never call it `queued` merely because no session was
  found.
- A parked Guard/ask refusal leaves its question open and writes no user-authored answer event.
  Ordinary worker-monitoring waits can accept a live session message if the session is open.
- Record the initial state and each later state transition against `deliveryId`; enforce the
  outstanding cap before acceptance. Record one ledger event and one manager note with target,
  state, capability and redacted text (or a capped summary). Avoid dumping the full transcript.
- CLI exits 0 for `queued`, `delivered`, or `acknowledged`; `rejected`/`expired` print the reason
  and exit non-zero. The output must say that adapter acceptance is not proof the worker read it.
- Expose only the latest delivery summary on the worker's existing `peek` entry as an optional
  `lastManagerDelivery: { deliveryId, state, capability, reasonCode? }`; never include message
  text. `formatPeek` prints one capped line for it. This makes later asynchronous acknowledgement,
  rejection, or expiry visible without adding a polling route.

### `onni task cancel <id> [--reason "…"]`

- Resolve and authorize the same way. After validation, save a redacted `managerCancellation`
  marker and a target lifecycle/note entry containing the reason, then reuse `RunManager.cancel`
  (current implementation `run.ts:5542`). Preserve its children-first subtree cancellation,
  lifecycle gate, and bounded teardown. A `false` result is a 409, not a successful cancel.
- Cancellation reason is part of the target log and the manager-facing settle report. If omitted,
  report `blocked` with the clear default “cancelled by manager”; do not invent a worker-authored
  explanation. Manager cancellation takes precedence over any earlier worker report's status, but
  retains its evidence/checks and appends the manager reason.
- `childSettleReport` already maps run status `cancelled` to report status `blocked`; preserve that
  mapping. `reportSettledChildToParent` currently returns before delivering a cancelled child's
  report (`run.ts:4791-4793`). Change only the manager-cancel case: persist the report first, then
  deliver it to the root manager's open session or leave it in `pendingReports` for the next
  session. Ordinary parent/subtree cancellation still must not wake a cancelled parent.
- On settle, include the cancelled worker's id, branch, base branch, captured HEAD, changed-file
  list and diff summary in the blocked report. Explicitly label it partial/unverified and note that
  uncommitted edits may remain. Cancellation does not promise a final autosave commit: turn-end
  autosave is after a normal turn, while periodic autosave is opt-in. Never delete the branch or
  worktree here. `protectedByLiveTree` keeps a worker worktree until the tree root settles, and
  `mergeFromAgent` already attempts a safe `wip before merge` autosave before a manager merges
  (`run.ts:4080-4084`); this gives the manager a salvage path when the root has `managerFullAccess`
  enabled, without an implicit push or merge.
- Do not claim a manager report was delivered until `deliverMessage`/queue accepts it; persist it
  as pending first so a restart cannot lose the blocked outcome.

## 6. `redirect` transaction, dependencies and retry accounting

`onni task redirect <id> "<instruction>"` is one manager operation: cancel the live worker, then
re-dispatch the same canonical order with the new direction. It is not Continue and does not reuse
the old session or branch.

1. Authenticate and validate before changing anything. Require an unsettled same-tree worker, a
   persisted `dispatch.order`, and no Guard/ask park. Check combined objective length, backend
   availability and all ordinary depth, in-flight, worker, total-subtask and budget caps. Preserve
   the source's canonical title, scope, actual backend/worker key, model, kind, review refs, allowed
   tools, max cost, success/evidence, retry limit, part id, and original `after` ids. Compose the new
   prompt as the canonical objective plus one labeled `Manager redirect instruction`; the latest
   redirect replaces an earlier redirect instruction instead of accumulating stale directions.
2. Before calling `cancel`, persist `dispatch.redirectOperation` in `cancelling` state and register
   the source in a manager-local `redirecting` set. While this transaction is active, `pump()` must not let
   `blockOrphanedDependents()` cancel a queued dependent whose `after` contains this source; those
   dependents remain queued and non-startable.
3. Cancel the source through the shared cancel path. Await only the existing bounded
   cancellation/settle window, then persist state `dispatching` and call the normal dispatch path with an internal
   redirect origin (never an agent-supplied field), reusing ordinary admission and budget carving.
   Pass the composed objective to the normal dispatch path while persisting the unchanged canonical
   objective plus this latest `redirectInstruction` in the replacement's order snapshot. The
   replacement consumes the normal total-subtask and remaining-budget caps; redirect only changes
   retry accounting.
4. On replacement success, persist its id and state `repointing`, set source `redirectedTo` and
   replacement `redirectedFrom`, replace the old run id with the replacement id
   in every queued sibling's `dispatch.after`, and refresh its queued task envelope / `order.md`
   “Starts after” line to the replacement's branch. Update its in-memory pending job before clearing
   the redirect-in-progress marker, then pump. Dependents now wait for the replacement and start
   from its branch; they do not run early, get duplicated, or remain attached to the cancelled id.
   Preserve all other `after` edges in order. Set the operation to `complete` and clear its
   instruction after this graph update.
5. On dispatch failure after cancellation, set the operation to `failed`, clear its instruction,
   log and report the failure,
   and run the normal `blockOrphanedDependents()` path. The caller receives an explicit
   “cancelled, replacement refused” result with the refusal; never report redirect success.
6. On restart, recover each nonterminal `redirectOperation` idempotently: a cancelled source with
   no replacement resumes dispatch from its snapshot and persisted instruction; if a replacement
   already exists, find it by `redirectedFrom` and finish re-pointing; if admission had failed,
   mark the operation failed and release dependents to today's blocked path. Clear the in-memory
   guard only after this repair. `dependencyState` currently treats a missing/failed/cancelled
   predecessor as `blocked`, and `blockOrphanedDependents` cancels dependents in
   `run.ts:4305-4334`; suppress that transition only while redirect is active, re-point before pump
   on success, and return to today's blocked behavior on failure.
7. The retry counter at `run.ts:4477-4485` counts same-title failed/cancelled siblings. Exclude a
   source with a persisted `dispatch.redirectOperation` from `failedTries` (including when
   replacement admission later fails), and exclude that source from this operation's retry-limit
   admission. Do not bypass historical non-redirect failures or other
   dispatch caps. A replacement is an ordinary child: if it later fails/cancels, that later outcome
   counts toward a subsequent retry. Record both source and replacement ids in the root ledger.

This has a restart boundary and a scheduler race, so it is a separate final engine part after
message/cancel. The source marker is optional and recoverable; never rely only on a process-exit
callback to repair it.

## 7. CLI and manager brief

Wire the commands in `packages/work/src/dispatch/task-cli.ts` through the existing `callRoute`
wrapper and `ONNI_TASK_ID` caller. Each command takes exactly one target id; `message` and
`redirect` take one positional text argument; `cancel` accepts only optional `--reason`. Reject
missing/extra positionals and unknown flags locally without HTTP. Use project-aware `api.scope`,
URL-encode caller and target as appropriate, post the matching body, print the typed result, and
keep the existing 404 CLI/server-version explanation. `redirect` output includes the replacement
id/branch and number of dependents re-pointed.

Add all three to `TASK_COMMANDS` and `CLI_COMMANDS` in the same order, after `peek` and before
`verify`, so dispatch controls appear before verification and lower-priority memory/plan/tree
lines. Measured by evaluating the current `briefCommands('manager')` lines in `commands.ts`:

- Current manager block: **1,711 / 2,100** chars (`MANAGER_COMMANDS_MAX_CHARS`, `prompt-budget.ts:17`).
- Proposed brief lines (each including the two-space indent):
  - `onni task message <worker> "<text>"   send a direction to a live worker; this does not answer its Guard/ask`
  - `onni task cancel <worker> [--reason "…"]   stop a live worker and give the manager a blocked report`
  - `onni task redirect <worker> "<instruction>"   stop and re-dispatch the same order with this direction`
- Projected block with these inserted after `peek`: **2,027 / 2,100** chars; no prompt-budget
  increase is needed. Keep the whole lines before the low-priority tail, and pin the new lines plus
  the `peek`, `verify`, and `tree` canaries in `commands.test.ts` so a future clamp cannot hide a
  manager control silently.

Update `docs/design/manager-worker.md` with a new appendix describing command syntax, the five
delivery states, Guard behavior, backend capability, cancellation salvage limits, and redirect's
dependency/retry rules. No `.env.example` change is required.

## 8. Sequential implementation parts

Do not parallelize these parts: `run.ts`, `server.ts`, `dispatch.ts`, CLI, and manager prompt are
shared hot files, and redirect depends on the earlier delivery/cancellation semantics.

### Part B1 — contracts and durable metadata

Files: `packages/contract/src/dispatch.ts:402-484,555-590`; `packages/work/src/runs/store.ts:149-218,272-307`;
`packages/work/src/server/contract-parity.dispatch.test.ts:30-80,218-252`.

Add the bounded request/result/state/order/cancellation/redirect-operation schemas from §4. Add
optional `order`, `managerDeliveries`, `managerCancellation`, `redirectOperation`, `redirectedFrom`,
and `redirectedTo` to `dispatchSchema`.
Keep all newly persisted nested state optional and bounded. Extend contract parity for z.input and
z.infer and assert old minimal dispatch records still parse.

### Part B2 — message and manager cancellation engine

Files: `packages/work/src/workflows/run.ts:2918-2986,3209-3248,3256-3304,3681-3702,4696-4814,5534-5643,5844-6130`;
`packages/work/src/dispatch/engine.ts:143-151,271-344,346-363`;
`packages/contract/src/dispatch.ts:123-150`;
`packages/work/src/dispatch/peek.ts:98-124`;
`packages/work/src/dispatch/tree-fs.ts:117-197`;
`packages/work/src/workflows/dispatch-engine.test.ts:366-405,1141-1252,1278-1310`.

Implement `messageFor`, `cancelFor`, the delivery state recorder/limits, Guard refusal, redaction,
same-tree root access, ledger/note writes, manager-cancel report override, and parent delivery of
only manager-initiated blocked reports. Keep a cancelled worker's partial branch/worktree available
and clearly report committed versus possibly uncommitted work.

### Part B3 — typed HTTP surface

Files: `packages/work/src/server/server.ts:4537-4663,7820-7821`;
`packages/work/src/server/validators.ts:5-60`;
`packages/work/src/server/contract-parity.dispatch.test.ts:30-80`;
`packages/work/src/server/typed-bodies.test.ts:20-82`;
`packages/work/src/server/route-parity.test.ts:34-64,165-177,218-278`;
`packages/work/src/server/dispatch-api.test.ts:17-80,278-329`.

Chain the three POST endpoints into `dispatchRoutes`, attach explicit gate and JSON validator
middleware, and keep each handler thin over its manager method. Extend direct contract parity,
typed-body assertions, route alias coverage, API stubs, body-validation refusals, status mapping,
and the dispatch-off gate list.

### Part B4 — redirect and dependency transaction

Files: `packages/work/src/workflows/run.ts:4301-4334,4353-4387,4477-4521,4567-4638,5534-5643`;
`packages/contract/src/dispatch.ts:461-484,555-590`;
`packages/work/src/dispatch/engine.ts:271-344`;
`packages/work/src/workflows/dispatch-engine.test.ts:165-208,366-405,1278-1310`.

Implement canonical order snapshots at dispatch time, preflight/retry-neutral redirect admission,
redirect-in-progress pump guard and recovery, cancel-then-dispatch, `after` dependent re-pointing,
and explicit failure handling. Do not edit the normal failure retry policy except to exclude a
redirected source from the per-title count.

### Part B5 — CLI, prompt, docs and regression coverage

Files: `packages/work/src/dispatch/task-cli.ts:55-130,235-335`;
`packages/work/src/dispatch/commands.ts:1-18,31-163`;
`packages/work/src/dispatch/prompt-budget.ts:17-24`;
`packages/work/src/dispatch/task-cli.test.ts:224-322`;
`packages/work/src/dispatch/commands.test.ts:12-45`;
`docs/design/manager-worker.md` (append after current appendix; exact next heading **unverified**).

Add strict parsing, requests, result text and exit codes for all three commands; register manager
usage and brief lines; retain the measured ≤2,100-character block. Document user-facing semantics.
If prompt tests show the calculation differs, measure the generated block again and adjust only
the command text or the exact measured budget delta.

## 9. Exact regression test list

These are required implementation tests, not run for this spec-only task:

1. `packages/work/src/server/contract-parity.dispatch.test.ts:30-80` — exact request and response
   parity for message/cancel/redirect, including redirect's post-cancel 409 shape; both the five-state enum and capability value; input caps;
   optional keys on the wire; old `dispatchSchema` records without new fields still parse.
2. `packages/work/src/server/route-parity.test.ts:34-64,165-177,218-278` — each new POST exists
   identically under unscoped, boot-project and default-project aliases, including malformed body
   rejection.
3. `packages/work/src/server/typed-bodies.test.ts:20-82,89-125` — `HasTypedBody` for all three
   routes; request types match the contract schema input.
4. `packages/work/src/server/dispatch-api.test.ts:17-80,278-329` — each handler passes the
   validated body and caller id to the matching manager method; 400 on missing/unknown/over-cap
   fields; 403/404/409 denial status preserved; `ONNI_DISPATCH=0` refuses each route before the
   manager is touched; backend `unsupported` remains a 200 value; post-cancel redirect failure is a
   typed 409 `DispatchManagerRedirectFailure`.
5. `packages/work/src/workflows/dispatch-engine.test.ts:366-405,584-695,976-1069,1141-1252,1278-1310`
   — message queue/delivery/ack/reject/expire transitions; runner unsupported value; every backend
   capability mapping; Guard wait cannot be answered by message/redirect; cancel remains allowed;
   root-manager/same-tree/self/unknown/ambiguous and settled-target refusals; text and queue caps;
   redaction in events/ledger/report; cancel reason in target log and a delivered `blocked` report;
   cancelled branch/base/head/files plus dirty-state warning remain salvageable; redirect preserves
   all snapshotted order fields and adds the new instruction; source cancel is retry-neutral while
   later replacement failure counts; all current caps remain active; dependent edges/prompt/order
   files re-point before pump; refusal falls back to today's blocked-dependent path; redirect
   recovery cannot strand a queue.
6. `packages/work/src/dispatch/task-cli.test.ts:224-322` — command positional/flag validation,
   `ONNI_TASK_ID`, project scope, exact route/body, typed result formatting, non-zero exits for
   rejected/expired and refusal/version mismatch.
7. `packages/work/src/dispatch/commands.test.ts:12-45` — manager command table and CLI command
   inventory agree; new command lines fit; preserve `peek`, `verify`, and `tree` canaries.
8. `packages/work/src/dispatch/peek.test.ts:85-119` — latest delivery summary prints without
   message text and preserves compact output/tail limits.
9. Backend tests: `claude-cli-runner.test.ts:319-326`, `codex-app-server-runner.test.ts:299-365`,
   `opencode-server-runner.test.ts:472-486,599-612`, `pi-runner.test.ts` (**insertion line
   unverified**), `junie-runner.test.ts` (**insertion line unverified**),
   `cline-acp-runner.test.ts:246-270`, `copilot-acp-runner.test.ts:163-189`,
   `cursor-agent-runner.test.ts` (**insertion line unverified**), and
   `antigravity-runner.test.ts:136-140` — lock in adapter acceptance/steering/queue/unsupported
   semantics and prove async rejection is not left looking delivered forever.

## 10. Risks and unverified behavior

- No live provider session was run while writing this spec. The backend table follows current
  adapter code and mock tests; verify acknowledgements against each protocol in its existing test
  before claiming any runner reaches `acknowledged`.
- `dispatch.order` is a new source of truth for future redirects. Keep it normalized from the
  already validated `DispatchInput`; do not parse generated prose to reconstruct scope or backend.
- Redirect mutates both cancellation and graph dependencies. The `redirecting` gate, durable
  marker, scheduler pump, restart recovery and “dispatch refused after cancel” path need explicit
  tests before implementation is considered complete.
- Multi-predecessor `--after` is accepted up to the contract bound, but the current proposal says
  multi-dependency behavior was not live-verified (`manager-worker-proposals.md:133,155-160`). The
  redirect tests must cover two preserved predecessors and multiple dependents.
- A forced cancellation may interrupt before the ordinary turn-end autosave. Report only the
  actual branch/HEAD/files observed; say when dirty work may remain. Never promise a final commit,
  merge, or push.
