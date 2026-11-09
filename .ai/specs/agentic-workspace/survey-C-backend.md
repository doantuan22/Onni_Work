# Backend survey for an agentic multi-pane workspace

## Scope and reading key

This is a read-only survey of the current contracts, run store, route families, event transports, and the existing task-thread client. **Verified** statements describe code or schemas at the cited paths. **Design inference** marks a proposal or a conclusion drawn from the current shape. Paths and line numbers refer to this checkout.

## Verified: one run is the current conversation record

A run has an ID, task text, workflow, status, runner/model, steps, and optional metadata. The initial prompt lives in RunRecord.task; initial attachments are taskImages. queuedMessages are stored separately but are folded into the prompt when the queued run starts, so they are not distinct user turns. Later user follow-ups are represented in the event stream. See packages/contract/src/runs.ts:163-184 and packages/contract/src/runs.ts:136-145.

The server store mirrors RunRecord and keeps runs in an atomic runs.json index plus one append-only NDJSON file per run. It stamps events with seq and ts, emits store notifications, and can emit ephemeral live events that are deliberately not written to disk. That means seq is an ordering/dedup cursor, not a promise of contiguous persisted numbers. See packages/work/src/runs/store.ts:151-183, packages/work/src/runs/store.ts:1165-1171, packages/work/src/runs/store.ts:1670-1708, and packages/work/src/runs/store.ts:1901-1913.

The persisted RunEvent envelope is open: seq, ts, optional stepId, and type are required/known while payload keys remain append-only and permissive for forward compatibility. The history page contract fixes 100 canonical items per page, uses opaque cursors up to 2048 characters, and returns liveCursor/asOfSeq/hasOlder metadata. See packages/contract/src/events.ts:14-28 and packages/contract/src/events.ts:30-85.
### Run state, dispatch, roster, and limits

Run status is queued/running/waiting/review/done/failed/cancelled; running may also carry monitoring activity. StepState records step kind/status, timestamps, sessionId, backend/profile affinity, model identity, usage, and cost. This is the durable state the list and continuation controls should use alongside transcript projection. See packages/contract/src/runs.ts:52-119.

A root or worker RunRecord may carry dispatch.rootRunId, parentRunId, kind, budget, report, pendingReports, pendingAsk, or softAsk. pendingAsk denotes a parked guard question; softAsk denotes a non-parking manager question that is only cleared by matching replyTo, expiry, or cancel. RunRecord also has awaitingAnswerSince, seenAt, and lastSeq. See packages/contract/src/runs.ts:278-306, packages/contract/src/runs.ts:381-407, and packages/contract/src/dispatch.ts:600-678.

A roster is snapshotted on the root run and restricts which listed workers dispatch() may choose; it is an orchestration fence, not a security boundary. The contract allows up to six worker entries and four concurrent tasks per entry. Worker kinds and tiers guide the manager but are explicitly not enforced. Manager-capable backends are checked server-side. See packages/contract/src/roster.ts:4-9, 14-58, 60-86.

Run limits are snapshotted at start: none or capped cost/tokens/time/iterations. The default is capped at $10, 10 million tokens, 240 minutes, and 30 step iterations. Hang expiry and dispatch depth/retry/subtask structure remain independent safety controls. See packages/contract/src/limits.ts:4-35 and packages/contract/src/limits.ts:56-72.

### Exact event model

AGENT_PROTOCOL.md defines the normalized v1 AgentEvent stream as text, tool-call, tool-result, image, token-usage, cost increment, session, turn-end, note, done, and error. It remains emitted and persisted for compatibility. See AGENT_PROTOCOL.md:144-162.

Protocol v2 adds session.started/ended/error; turn.started/completed; item.started/delta/updated/completed; plan.updated; permission.requested/resolved; ask.requested; usage.updated; and image. See AGENT_PROTOCOL.md:243-262 and packages/api-client/src/protocol/ui-events.ts:147-298. Payload fields are: session.started(sessionId, backend, model?, cwd?, tools?); session.ended(reason, message?); session.error(message, fatal); turn.started(turnId); turn.completed(turnId, stopReason, usage?, costUsd?); item.started/updated/completed(item); item.delta(itemId, field=text|reasoning|output, delta); plan.updated(entries as full replacement); ask.requested(requestId, questions, source?); usage.updated(usage, costUsd?); image(itemId?, mediaType, data). permission.requested carries requestId/itemId?/title/options and permission.resolved carries requestId/optionId, but both remain reserved. See packages/api-client/src/protocol/ui-events.ts:147-298.

The v1 AgentEvent payloads are likewise specific: text.text; tool-call.id/tool/input; tool-result.toolCallId/result/isError; image.mediaType/data; token-usage.tokensUsed; cost.usd (increment); session.sessionId; turn-end.reason?; note.message; done; error.message. See AGENT_PROTOCOL.md:150-162.

UiItem has three variants:

- message: role assistant/user, text, optional commentary/final phase, parentItemId.
- reasoning: thinking text and optional parentItemId.
- tool: name/title/kind/status plus optional input/output/error/diffs/locations/exitCode and parentItemId.

See packages/api-client/src/protocol/ui-events.ts:100-140. Tool statuses are pending, running, completed, failed, or declined; tool kinds are normalized for display at packages/api-client/src/protocol/ui-events.ts:18-45.

item.completed and item.updated are snapshots; item.delta appends text, reasoning, or tool output to a live item. Deltas are coalesced onto live SSE only, while completed snapshots are safe to persist. They can therefore be absent from history replay; clients must deduplicate by seq greater-than comparisons, not infer loss from gaps. See AGENT_PROTOCOL.md:306-308, packages/api-client/src/protocol/ui-events.ts:191-214, and packages/work/src/runs/store.ts:1901-1913.

v1 user-message is the user-turn event not present in the AgentEvent type list; lifecycle, check-output, notes, errors, ask requests, and image URLs also appear in persisted run history. The browser reducer intentionally prefers v2 item events and uses v1 text/tool-call/tool-result only as legacy fallback. A v1 tool call can be shown as running and a v1 tool result as completed, but v1 cannot express failed/declined. See packages/web/src/routes/task-thread/thread-state.ts:14-37 and packages/work/src/runs/event-history.ts:101-120.

### Deriving a conversation thread

The current client projection is a useful verified model for a workspace:

1. Treat one runId as one thread. Render RunRecord.task and taskImages as the opening user prompt; queuedMessages are prompt additions, not separate turns. Then fold the ordered NDJSON events. See packages/web/src/routes/task-thread/session-transcript.tsx:101-147 and packages/contract/src/runs.ts:163-178.
2. A persisted user-message starts a user turn. The following turn.started attaches its turnId to that same turn. turn.completed closes the matching turn and carries stop reason/cost. Agent-opened turns can start without a user message. See packages/web/src/routes/task-thread/thread-state.ts:100-119 and packages/web/src/routes/task-thread/thread-state.ts:460-512.
3. Upsert item lifecycle events by stepId plus item ID. Render assistant messages, reasoning items, and tool items in event order; append item.delta to the matching item while live. parentItemId gives the protocol-level nesting relation for tools/messages. Full plan.updated snapshots replace the current turn plan. See packages/web/src/routes/task-thread/thread-state.ts:514-549, packages/api-client/src/protocol/ui-events.ts:100-140, and packages/web/src/routes/task-thread/thread-state.ts:100-118.
4. Keep session lifecycle, usage, v1 notes/errors/check output, and image URLs as thread events/metadata. Ask cards are created from ask.requested; the current reducer resolves a pending card when the next user-message arrives. There is no ask.resolved event. See packages/web/src/routes/task-thread/thread-state.ts:603-743, AGENT_PROTOCOL.md:264-280, and packages/api-client/src/protocol/ui-events.ts:253-266.
5. Render dispatched workers as separate run threads connected by dispatch.rootRunId/parentRunId/kind/report metadata. A dispatch child gets its own worktree and run record; it is not a continuation transcript cloned into its parent. Provider-native nested subagents are different: SubagentSheet and AgentsDock expose runner subagents from the same run/thread state. See packages/contract/src/dispatch.ts:600-705, packages/work/src/workflows/run/dispatch.ts:153-161, and packages/web/src/routes/task-thread/subagent-sheet.tsx:11-33.

## Verified: routes for sending, stopping, resuming, queueing, and children

Routes below are project-scoped under /api/v1 unless marked workspace-wide.

| Need | Current route or behavior |
| --- | --- |
| List project runs | GET /runs returns project run records; GET /workspace/runs-index is the cross-project slim index. See packages/work/src/server/routes/runs.ts:321-384 and packages/work/src/server/routes/runs-index.ts:120-191. |
| Start a new task | POST /runs creates a run from task/steps/workflow and can select a new worktree branch. No thread-clone/fork-history input is defined in createRunInput. See packages/work/src/server/routes/runs.ts:400-498 and packages/contract/src/runs.ts:1203-1230. |
| Send follow-up to a live/queued run | POST /runs/:id/messages accepts text/images/idempotencyKey/replyTo. It tries live delivery, then stores a queued message if the run is still queued, then defers across startup/session gaps; closed sessions return 409. Response distinguishes delivered, queued, deferred. See packages/work/src/server/routes/runs.ts:596-652 and packages/contract/src/runs.ts:1283-1301, 738-761. |
| Edit/remove a queued prompt | PATCH and DELETE /runs/:id/queued-messages/:msgId mutate an item in queuedMessages. See packages/work/src/server/routes/runs.ts:656-738. |
| Continue a settled run | POST /runs/:id/continue reopens/continues the existing run and accepts optional text, images, runner/model/profile, raiseLimits, idempotencyKey, and replyTo. It does not clone the run into a new thread. See packages/work/src/server/routes/runs.ts:744-793 and packages/contract/src/runs.ts:1303-1323. See also packages/work/src/workflows/run/continuation.ts:152-178, 240-291, 342-359: it resumes the latest provider-owned session only when backend/account affinity matches, otherwise reconstructs portable context for a fresh session; each continuation appends a continue-N step to the same run and may be queued for capacity. |
| Stop | POST /runs/:id/cancel cancels one run; POST /workspace/stop-all cancels live runs across open projects. POST /runs/:id/finish gracefully closes a waiting session as done. See packages/work/src/server/routes/runs.ts:577-583, 718-726 and packages/work/src/server/routes/workspace-config.ts:183-189. |
| Advance queue | POST /runs/:id/start-now jumps a queued run past the maxParallel cap; it returns 409 if not queued or held. New runs can also be created queued through POST /runs. See packages/work/src/server/routes/runs.ts:400-498, 585-594. |
| Dispatch worker | POST /runs/:id/dispatch creates one child RunRecord/worktree and is fenced by requireDispatch; it returns 201 or 409. The child forks from the parent's branch. See packages/work/src/server/routes/dispatch.ts:28-53 and packages/work/src/workflows/run/dispatch.ts:153-161. |
| Message/cancel a child | POST /runs/:id/worker-message and POST /runs/:id/worker-cancel are manager-to-direct-worker controls with dispatch validation. These are not the user-to-thread follow-up route. See packages/work/src/server/routes/dispatch.ts:32-43, 55-66. |
| Ask user a manager question | POST /runs/:id/ask records a manager ask on a root run; response provides the request identity. The user answers through the normal message seam with replyTo. It does not park the manager turn. See packages/work/src/server/routes/dispatch.ts:100-107, packages/contract/src/dispatch.ts:333-355, and AGENT_PROTOCOL.md:264-280. |

**Approval distinction (verified):** permission.requested/resolved are reserved types only. In the inspected run/dispatch route families there is no general human-approval request/answer route; current structured agent questions use ask.requested and a follow-up message. See packages/api-client/src/protocol/ui-events.ts:222-236 and AGENT_PROTOCOL.md:257-280.

## Verified: attachments and work surfaces

- Inline attachments or staged-upload references travel on message/continue inputs. One message is limited to 20 attachments and 28,000,000 inline base64 characters; staged upload keeps bytes out of a later message request but does not lift the image payload limit. POST /workspace/uploads and DELETE /workspace/uploads/:uploadId stage/clean uploads. See packages/contract/src/runs.ts:1124-1181 and packages/work/src/server/routes/workspace-config.ts:358-369.
- Run attachment URLs are served by GET /runs/:id/images/:file. GET /runs/:id/diff gives raw diff text and GET /runs/:id/changes gives structured changes. GET /runs/:id/tree and GET /runs/:id/files serve tree and file content, with path/raw/rev query controls. See packages/work/src/server/routes/runs.ts:977-1033 and packages/work/src/server/routes/runs.ts:1060-1175.
- Run terminals use GET/POST /runs/:id/terminal to list/create, GET /runs/:id/terminal/:sessionId/output to read by cursor, POST input and resize, and DELETE to close. See packages/work/src/server/routes/terminal.ts:94-182 and packages/work/src/server/routes/terminal.ts:233-236.

The Node-free @onni/api-client barrel exports the typed /api/v1 client, contract schemas, and UI event vocabulary; the browser-specific EventSource and WS adapters live in packages/web. See packages/api-client/src/index.ts:1-30, packages/web/src/api/run-events.ts:146-159, and packages/web/src/api/ws.ts:55-100.

## Verified: transcript transports, replay, and backfill

**Per-run SSE is the transcript transport.** GET /runs/:id/events sends persisted v1 records as run-event and v2 records as ui-event, plus run summary frames. It subscribes before replay, buffers concurrent live events, deduplicates against the replay boundary, then keeps the stream alive with 15-second pings. With no cursor it replays the persisted run event file; with cursor it resumes from the live cursor. afterSeq and Last-Event-ID also set a sequence floor. See packages/work/src/server/routes/sse.ts:23-99 and packages/contract/src/events.ts:48-53.

GET /runs/:id/history reverse-pages canonicalized transcript items; GET /runs/:id/history-context returns a compact current-state context. History canonicalization collapses v2 item lifecycle by step/item identity and suppresses duplicate v1 twins where v2 exists. See packages/work/src/server/routes/runs.ts:507-535 and packages/work/src/runs/event-history.ts:101-233, 418-479, 784-816. A stale/out-of-range live cursor is rejected rather than silently treated as current; see packages/work/src/runs/event-history.ts:818-861.

The browser useRunHistory hook loads the newest page and compact context, then resumes SSE at liveCursor. Older pages use opaque cursors and useInfiniteQuery with maxPages = 5. On optimized-path failure the hook falls back to protected full replay. Current compaction thresholds are 200 live events and a 5,000-event live size trigger. See packages/web/src/api/run-history.ts:12-17 and packages/web/src/api/run-history.ts:137-164, 280-290. The page schema caps item count, not serialized bytes or individual payload strings; open catchall event payloads can still make a single page/item large. Initial task text is capped at 100,000 characters and queued-message folding has a combined prompt bound. See packages/contract/src/events.ts:62-78, packages/contract/src/runs.ts:1203-1210, and packages/work/src/server/routes/runs.ts:656-686. The fallback EventSource consumer batches live events and handles both run-event and ui-event. See packages/web/src/api/run-events.ts:6-35, 146-159, 328-363.

**Other streams carry state summaries, not transcript items.** Project GET /events sends run frames, deletes, todos, usage and pings; workspace GET /workspace/events carries cross-project run summaries and workspace/host signals. See packages/work/src/server/routes/sse.ts:102-151 and packages/work/src/server/routes/workspace-events.ts:24-136. The WebSocket hub is a topic subscription bus: subscribe/unsubscribe by topic, send a snapshot on join, start a publisher on 0-to-1 subscribers and stop it on 1-to-0. Current publishers include health, host, dynamic tracker:<id>, and dynamic terminal:<sessionId>; terminal WS payload contains only an output cursor, with bytes read over HTTP. No run transcript topic is registered. See packages/work/src/server/ws.ts:42-58, 144-165, packages/work/src/server/server.ts:1484-1518, packages/work/src/server/tracker/watch.ts:35-42, and packages/work/src/server/routes/terminal.ts:35-55. The web WS client lazily opens/reuses one socket and restores subscriptions on reconnect: packages/web/src/api/ws.ts:55-100, 141-205.

## Verified: current cockpit building blocks

TaskThreadRoute is /tasks/:id and uses useRun, useRunHistory (with useRunEvents fallback), and ThreadView. The workspace task index is exposed through useRunsIndex for cross-project search/list surfaces. See packages/web/src/api/queries.ts:1029-1058. ThreadView receives run, thread, currentThread, history, onMarkedUnread, and embedded. SessionTranscript renders initial task/queued text and derived turns; its props expose sections, mode, renderAsk, messageActions, scrollControls, renderMode, and rowModels. See packages/web/src/routes/task-thread/task-thread.tsx:39-82, 183-203 and packages/web/src/routes/task-thread/session-transcript.tsx:85-147.

AskCard handles structured questions; TaskComposer handles reply input; AgentsDock and SubagentSheet expose worker/subagent surfaces. These are specific task-thread components, not a workspace-level list of independent conversations. See packages/web/src/routes/task-thread/ask-card.tsx:45-59, packages/web/src/routes/task-thread/agents-dock.tsx:34-43, and packages/web/src/routes/task-thread/subagent-sheet.tsx:11-33.

## Verified current support and gaps

- **Session list grouped by project:** GET /workspace/runs-index already gives cross-project rows and is designed for the task palette. It sorts by activity, includes archived runs, caps at 200 rows per project, and reports truncated project IDs. Rows are intentionally slim and do not contain transcript, steps, or a page cursor. See packages/work/src/server/routes/runs-index.ts:120-191 and packages/contract/src/runs.ts:467-516, 621-633. Gap: the index is recent-task metadata, not a project-grouped, filterable transcript-aware session browser; its rows have no page cursor.
- **Unread:** POST /runs/:id/read and POST /runs/:id/unread exist; RunIndexEntry carries seenAt. The current cockpit isUnread rule only counts eligible finished runs, using status/finishedAt/archive/seenAt. See packages/work/src/server/routes/runs.ts:385-397, packages/contract/src/runs.ts:467-487, and packages/web/src/lib/read-state.ts:58-109. Gap: a newly active/waiting thread cannot be marked unread by the current finished-task rule.
- **Search:** workspace runs-index supports finding task metadata, not searching transcript content. No transcript full-text search route was found in the inspected route families. Gap: no project/run-scoped transcript search endpoint or result pagination was found.
- **Per-thread pane state:** GET/PUT /runs/:id/layouts persists up to 50 layouts, each with at most three columns whose views are session/changes/commits/files/browser/graph/terminal. This is a workspace layout inside one task, not an ordered collection of different run/thread panes. Run composer drafts are also persisted per run/surface. See packages/work/src/server/routes/layouts.ts:9-35, packages/contract/src/workspace-layouts.ts:14-60, and packages/work/src/server/routes/drafts.ts:25-59. Gap: layouts organize columns within one task and do not persist an ordered set of different run/thread panes.

## Proposed contract additions (design proposals only; no code)

- Cursor-paged workspace thread/session index with project grouping, status/assignee-like filters if applicable, activity ordering, preview text, awaiting-ask/worker counts, per-project truncation metadata, and stable page cursors.
- Paginated transcript search across selected projects/runs, returning runId/projectId, snippet, event sequence, turnId when derivable, and result cursor.
- Read receipt based on lastViewedSeq (or equivalent) and unreadThroughSeq so active/waiting conversations can be unread without changing finished-run semantics.
- Workspace multi-thread pane state with stable pane IDs, ordered projectId/runId references, selected pane, active subview, and optional transcript scroll anchors. Keep the existing per-run columns/layout contract for surfaces within an individual thread.
- Optional child-thread tree snapshot/read endpoint returning direct child summaries and dispatch reports/asks in one response, if workspace navigation needs a consistent worker tree without composing all project run lists.
- Only if product requirements include interactive human approvals: activate permission.requested/resolved as persisted lifecycle events and add a typed approval answer route/body/outcome. Current permission events are explicitly reserved.

## Short report

Verified the current data model is one run per thread, with turns/items derived from append-only run events. Per-run SSE provides replay/backfill; WS topics carry live summaries or cursors. Existing cross-project run index, finished-task unread, and per-run layouts help, while transcript search and pane state across distinct runs are absent. Deliverable: .ai/specs/agentic-workspace/survey-C-backend.md.





