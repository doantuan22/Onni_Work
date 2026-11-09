# Kế hoạch tách `run.ts` theo từng bước

> **Trạng thái (2026-11-09): đã làm xong cả 17 phần.** `run.ts` còn 3.444 dòng (từ 11.721); code đã
> chuyển nằm trong `packages/work/src/workflows/run/` (`preparation`, `start`, `queue`, `lifecycle`,
> `manager-controls`, `verify`, `manager-state`, `dispatch`, `scheduling`, `messages`, `continuation`,
> `execute`, `graph`, `agent-step`, `settlement`, `monitoring`, `check-steps`, `internal-types`).
> Bản đồ dòng bên dưới là trạng thái TRƯỚC khi tách, giữ lại làm lịch sử.
>
> Ba bài học khi tách, cần giữ cho mọi thay đổi sau:
> - **Hàm bọc không được khai báo `async` nếu chỉ `return task(...)`.** Mỗi lớp `async` thêm lượt
>   chờ promise mà phương thức gốc không có, làm `cancelAndWait` chạy trước khi `execute` gỡ run
>   khỏi danh sách đang chạy (`worktree-lifecycle.test.ts`, sửa ở `64c044c` và `0ef9bed`).
> - **Context phải đọc giá trị sống của `RunManager`**, không chép hằng số mặc định: context của
>   agent step từng nhận `BRANCH_NAME_WAIT_MS` thay cho tùy chọn `branchNameWaitMs` (`3b2b732`).
>   Trường thay đổi được thì truyền qua getter/setter (xem `schedulingContext`).
> - **Lời gọi trước đây đi qua `this.<method>` phải đi qua callback của context**, vì test theo dõi
>   (spy) hàm bọc của `RunManager`.
>
> Test cấu trúc H7 trong `manager-prompt.test.ts` giờ đọc `run.ts`, `run/execute.ts` và
> `run/continuation.ts`.

Ngày đối chiếu: 2026-11-07. Kế hoạch này mô tả trạng thái hiện tại của
`packages/work/src/workflows/run.ts` (11.721 dòng) trên nhánh `onni/7e44ecf4`.
Đây là bản đồ để thực hiện D1 bằng các PR nhỏ, giữ nguyên hành vi. Số dòng dưới
đây là số dòng nguồn hiện tại, tính cả dòng trống và chú thích trong đoạn được
nêu; sau mỗi lần tách phải cập nhật lại bản đồ trước khi giao phần tiếp theo.

## 1. Cách kiểm chứng bản đồ

Các điểm bắt đầu được lấy bằng `rg`, không suy ra từ số dòng ước lượng:

```sh
rg -n '^(export )?(async )?(function|class|interface|type|const|let|enum)\b' packages/work/src/workflows/run.ts
rg -n '^  (?:(?:private|protected|public|async|static|readonly)\s+)*[A-Za-z_$][A-Za-z0-9_$]*\s*\(' packages/work/src/workflows/run.ts
```

Đối chiếu phần thân bằng dấu đóng của từng method và đọc các vùng quanh ranh
giới. Kết quả: tệp có 11.721 dòng, `RunManager` bắt đầu ở dòng 1343 và kết thúc
ở dòng 11531; bộ quét chữ ký tìm thấy 221 khai báo thành viên (gồm constructor).
Các khoảng bên dưới là ranh giới method/nhóm method thực tế, không phải kích
thước module dự kiến sau khi tách.

## 2. Khai báo cấp tệp

Mỗi tên dưới đây đều có dòng bắt đầu được grep xác nhận. Dòng `@n` là dòng khai
báo; cột khoảng cho biết đoạn chứa cả nhóm khai báo và số dòng của đoạn.

| Khoảng / số dòng | Khai báo (dòng bắt đầu) | Mục đích |
|---|---|---|
| 261–535 · 275 dòng | `RESUMABLE_BACKENDS @261`, `cardReply @267`, `childSucceeded @273`, `describeCondition @277`, `GraphParkOutcome @293`, `GRAPH_TAKEN_CAP @300`, `NODE_SUMMARY_CAP @303`, `CHECK_OUTPUT_CAP @306`, `configuredModelProvider @308`, `CANCEL_GRACE_MS @315`, `MONITORING_LIVENESS_MS @317`, `LEFTOVER_SETTLE_GRACE_MS @319`, `DEFERRED_MARKER_SUFFIX @321`, `BRANCH_NAME_WAIT_MS @326`, `DONE_MARKER_RE @334`, `MONITORING_MARKER_RE @345`, `VERIFICATION_ASK_RE @347`, `TRAILING_TASK_MARKER_LINES_RE @369`, `turnEndMarkerText @380`, `endsWithMonitoringMarker @390`, `endsWithDoneMarker @394`, `COMPACTION_CONTINUE_NUDGE @407`, `MAX_COMPACTION_CONTINUES @416`, `appendTurnText @423`, `stripDoneMarker @431`, `stripMonitoringMarker @436`, `DispatchTurnResult @444`, `emitAskRequested @456`, `askMarkerRejection @466`, `askMarkerRecovery @482`, `AskTurnOutcome @489`, `resolveAskTurn @501`, `markerlessTurn @524` | Hằng số và parser nhỏ cho marker của agent, ranh giới lượt, câu hỏi và kết quả dispatch. Một số marker này quyết định trạng thái cuối; giữ chung với kiểm thử turn-end. |
| 537–924 · 388 dòng | `AUTOSAVE_INTERVAL_MS @537`, `periodicAutosaveEnabled @543`, `repositoryRootLockDisabled @554`, `REPOSITORY_ROOT_LOCK_DISABLED_NOTE @558`, `CONTINUABLE_STATUSES @561`, `ContinueRunOptions @563`, `ActiveRun @578`, `MAX_AUTO_CONTINUES @727`, `MAX_LAND_ATTEMPTS @729`, `LandAnswer @732`, `landFailurePrompt @739`, `landAnswer @743`, `AUTONOMOUS_NUDGE @764`, `MONITORING_WAKE_NUDGE @766`, `REPO_ROOT_RESUMED_NOTE @776`, `AUTO_RESUME_GRACE_MS @786`, `MAX_AUTO_RESUMES @793`, `AUTO_RESUME_MISSED_WINDOW_MS @801`, `QUEUE_WATCHDOG_MS @810`, `LIMIT_SWEEP_MS @813`, `NO_HOLDS @815`, `accountHeldFor @829`, `runAccountKey @849`, `resumeInFlight @867`, `deferredBindingActive @876`, `AUTO_RESUME_PROMPT @899`, `AutoResumeReason @901`, `TRANSIENT_RETRY_PROMPT @902`, `autoResumeReasonFor @906`, `autoResumeCap @911`, `formatWakeInstant @921` | Các kiểu trạng thái chạy và chính sách dùng bởi queue, giới hạn, tiếp tục sau lỗi/khởi động lại và landing. `ActiveRun` là kiểu dùng chung nội bộ, không nên nhân bản giữa module. |
| 925–1017 · 93 dòng | `StartRunInput @925`, `RedirectDispatchOrigin @1002` | Hợp đồng nội bộ cho tạo run và chuyển hướng lệnh dispatch. `StartRunInput` được test nhập trực tiếp từ `run.ts`; giữ đường re-export ổn định. |
| 1018–1342 · 325 dòng | `resolveExtraSystemPrompt @1018`, `GLOBAL_INSTRUCTIONS_HEADING @1032`, `PROJECT_INSTRUCTIONS_HEADING @1034`, `composeSystemPrompt @1044`, `dispatchPromptPart @1061`, `agentDirectories @1083`, `mediaTypeFor @1107`, `highestImageSeq @1118`, `PersistedAttachment @1129`, `attachmentLibraryDir @1138`, `MAX_LIBRARY_COLLISION_ATTEMPTS @1143`, `copyToAttachmentLibrary @1164`, `FileBlock @1205`, `PastedContent @1218`, `imageLibraryNames @1222`, `toPastedContent @1226`, `contentBlocksOf @1246`, `ATTACHMENT_ONLY_TASK @1251`, `pastedAttachmentsText @1260`, `pastedAttachmentsNote @1287`, `VARIANT_LETTERS @1293`, `VARIANT_HINTS @1294`, `RESTART_CONTINUATION_PROMPT @1300`, `PendingContinuation @1303`, `PersistedAttachments @1315`, `PreparedUserMessage @1323` | Soạn prompt, chuẩn hóa nội dung đính kèm, hỗ trợ biến thể và kiểu payload nội bộ. Các hàm/kiểu export được import bởi test; khi chuyển phải re-export đúng tên từ `run.ts`. |
| 1343–11531 · 10.189 dòng | `RunManager @1343` | Lớp điều phối đang gom constructor, state, queue, dispatch, chạy workflow, trạng thái kết thúc và kiểm tra. Chi tiết thành viên ở §3. |
| 11533–11721 · 189 dòng | `CHECK_CONTEXT_VARS @11533`, `parseGithubItemUrl @11551`, `sharedCheckCacheDir @11567`, `fileSnapshot @11581`, `currentCheckExclusions @11589`, `captureCheckArtifacts @11598`, `applyTemplate @11602`, `makeRunTitle @11612`, `skillSystemPrompt @11650`, `TEAM_SKILLS_WAIT_MS @11671`, `leadingSlashSkillName @11674`, `expandRegistrySlashSkillText @11692`, `expandRegistrySlashSkill @11707` | Biến môi trường cho check, tiện ích check/autosave, tiêu đề, prompt skill và mở rộng slash-skill. Kiểm tra export được test dùng trực tiếp trước khi đổi vị trí. |

## 3. Bản đồ method của `RunManager`

Danh sách trong mỗi hàng bao phủ mọi method thuộc khoảng đó. Dòng và kích thước
lấy từ đầu chữ ký đến dấu `}` đóng method cuối trong nhóm; các khoảng rời nhau
được ghi tách riêng.

| Nhóm / dòng / kích thước | Method trong nhóm | Vai trò |
|---|---|---|
| 1343–1580 · 238 dòng | khai báo lớp, fields và `constructor` (bắt đầu @1493) | Sở hữu `RunStore`, repo root, state và options; đăng ký semaphore/listener/watchdog/lifecycle. Đây là façade và điểm khởi tạo; giữ nguyên chữ ký constructor. |
| 1592–1638 · 47 dòng | `dispose` | Gỡ listener và timer, giải phóng tài nguyên manager. |
| 1647–1858 · 212 dòng | `enforceMemoryLimit`, `agentEnv`, `agentPermissionSpec`, `recordNoteMeta`, `privateMcpForLaunch`, `agentEnvForStep` | Áp dụng giới hạn bộ nhớ và chuẩn bị môi trường/quyền/backend trước khi spawn. |
| 1860–2015 · 156 dòng | `startRun`, `startVariants` | Tạo một run hoặc nhóm biến thể; lưu input, attachment, nhánh và đưa việc vào queue. |
| 2026–2247 · 222 dòng | `busySlots`, `enterMonitoring`, `leaveMonitoring`, `oldestQueuedAt`, `releaseSlot`, `pump` | Chọn việc có thể chạy và cấp/thu hồi slot, gồm quy tắc monitoring và semaphore. |
| 2264–2509 · 246 dòng | `reviveQueuedRun`, `recover` | Khôi phục việc đã queue/đang chạy sau restart; có thể đặt lại trạng thái và lên lịch chạy. |
| 2517–2803 · 287 dòng | `refreshQueuedWorkflow`, `reviveWorkflow`, `abandonCancelledStart`, `failOwnedContinuation`, `dropActive`, `deferredStopReason`, `redeliverDeferred`, `setDeferred`, `noteDeferredLostInRestart`, `runSettled`, `reapLeftoverProcesses` | Phục hồi workflow, gỡ ActiveRun và xử lý tin nhắn/deferred/process còn sót. Có đường chuyển run sang trạng thái terminal. |
| 2808–2991 · 184 dòng | `dispatchEnabled`, `dispatchReachable`, `dispatchOf`, `updateDispatch`, `loadManagerSessionContext`, `prepareDispatchSession`, `remainingForManager`, `dispatchBudgetFor` | Chuẩn bị ngữ cảnh manager, cấu hình cây dispatch và tính ngân sách. |
| 3002–3907 · 906 dòng | `peekFor`, `conflictsFor`, `messageFor`, `cancelFor`, `redirectFor`, `redirectDispatchInput`, `cancelRedirectSource`, `redirectFailure`, `failRedirectOperation`, `finishRedirectOperation`, `repointQueuedDependents`, `recoverRedirectOperations`, `managerDeliveryFor`, `recordManagerDeliveryTransition`, `recordManagerUserMessage`, `markQueuedManagerDeliveriesDelivered`, `expireUnacceptedManagerDeliveries`, `expireLostManagerDeliveriesAfterRestart`, `peekEntry` | API điều khiển manager và ledger giao nhận; kiểm file xung đột, gửi message, cancel/redirect và khôi phục giao dịch redirect. |
| 3915–4324 · 410 dòng | `verifyFor`, `runVerify`, `runVerifyBaseline`, `retryBaselineCleanup`, `recordVerify` | Chạy verify có giới hạn/baseline và ghi kết quả. |
| 4327–4708 · 382 dòng | `readManagerMemory`, `writeManagerMemory`, `addManagerMemory`, `readTreePlan`, `writeTreePlan`, `patchTreePlanPart`, `treeMember`, `normalizePlanParts`, `assignPlanPart`, `askUser`, `softAskFor`, `clearSoftAsk`, `forgetSoftAsk`, `armSoftAskTimer`, `expireSoftAsk`, `recoverSoftAsks`, `prepareAutomationsSession`, `flushPendingReports`, `ackPendingReport`, `handleDispatchTurn` | Memory, plan, ask có hạn giờ, session automation và xử lý kết quả dispatch ở cuối lượt. |
| 4715–4936 · 222 dòng | `mergeFromAgent`, `checkManagerComplexity`, `deliverOwnInbox`, `flushInbox`, `notifyTreeInboxes`, `recordAsk`, `recordAttention`, `clearPendingAsk` | Merge cục bộ được phép, đánh giá manager và trao đổi inbox/attention trong cây. |
| 4943–5439 · 497 dòng | `enforceDispatchBudget`, `dependencyState`, `blockOrphanedDependents`, `refreshQueuedDependencyEnvelope`, `workerEntryFull`, `dispatchFromAgent`, `dispatch`, `recordReport`, `carveChildBudget`, `notifyQuestionRetired` | Nhận lệnh worker, cấp ngân sách/con, ràng buộc dependency và ghi report. |
| 5451–5602 · 152 dòng | `reportSettledChildToParent` | Báo kết quả worker đã dừng cho manager cha; có cập nhật trạng thái và chuyển tiếp report. |
| 5608–6112 · 505 dòng | `cancelDescendants`, `scheduleAutoResumeIfLimited`, `failedBackend`, `scheduleTransientRetry`, `armUsageLimitResume`, `armAutoResume`, `fireAutoResume`, `interruptedWorkflowStep`, `queuedUsageLimitResume`, `workflowInput`, `reconcileAutoResumes`, `requeueWhileHeld`, `rescueStalledQueue`, `refreshQueueReasons`, `applyQueueReasons`, `accountHolds`, `cancelAutoResume`, `clearAutoResume`, `enforceRetention` | Auto-resume/retry, phục hồi queue bị giữ, account hold và retention; timer có thể đưa run trở lại queue hoặc terminal. |
| 6150–6249 · 100 dòng | `parkRepoRoot`, `claimFreeRepoRoot`, `chainRepoRoot`, `resumeRepoRoot`, `acquireRepoRoot` | Khóa tuần tự repo root khi không dùng worktree cô lập. |
| 6257–6320 · 64 dòng | `startNow`, `sweepLimits`, `stopForLimit`, `raiseAfterLimit` | Bỏ qua cap theo yêu cầu start-now, đo/áp giới hạn run và ghi sự kiện khi vượt giới hạn. |
| 6330–6477 · 148 dòng | `cancel`, `cancelAll`, `cancelOne`, `hasScheduledAutoResume`, `cancelAndWait`, `waitInactive`, `parkLifecycle`, `isActive` | Hủy run, đợi nó inactive và nối với lifecycle worktree. |
| 6495–7006 · 512 dòng | `hydrateQueuedInput`, `hydrateQueuedContinuation`, `attachmentsDir`, `readPersistedAttachments`, `isQueued`, `toQueuedMessage`, `enqueueMessage`, `editQueuedMessage`, `removeQueuedMessage`, `dropOrphanImages`, `editTask`, `deferMessage`, `flushDeferred`, `sendMessage`, `deliverMessage`, `withAnswerLead` | Queue message/attachment, deferred delivery trong khe mở session và gửi message vào session. |
| 7013–7271 · 259 dòng | `finish`, `continueRun` | Kết thúc session hoặc tạo continuation; chuyển giữa session đang mở, queue và capacity. |
| 7273–7907 · 635 dòng | `runContinuation` | Mở lại session, dựng ActiveRun cho continuation, chạy backend và xử lý turn-end của continuation. |
| 7911–8335 · 425 dòng | `execute` | Khởi tạo ActiveRun cho run mới, mở worktree/session và chạy workflow; có nhánh phục hồi và lỗi terminal. |
| 8347–9474 · 1.128 dòng | `executeGraph`, `sessionCostUsd`, `resumeInterruptedAgent`, `runFork`, `runSystemNode`, `awaitChildren`, `findWorkflow`, `evaluateCondition`, `parkForUser`, `parkGraphNode`, `graphResumeSession`, `provisionTaskSkills` | Thực thi workflow graph, fork, system node, wait/park và phục hồi session graph. |
| 9477–10250 · 774 dòng | `runAgentStep`, `makeUiSink`, `handleRunnerUiEvent`, `beginUsageInvocation`, `recordUsageUiEvent`, `persistUsageCheckpoint`, `autoNameRun`, `awaitGeneratedBranch` | Chạy step agent, ánh xạ event/usage, ghi checkpoint và chờ tên nhánh. |
| 10252–10462 · 211 dòng | `recordTurnEnd`, `applyTurnMarkers`, `maybeRefreshTitle`, `recordUsagePeaks`, `settleUnansweredPark`, `settleSuccess` | Ghi dấu cuối lượt, thống kê, xử lý câu hỏi chưa trả lời và settle thành công. |
| 10469–10807 · 339 dòng | `landingPolicy`, `latestRequest`, `landingFence`, `landNow`, `landOnDone`, `parkForReview`, `landWithAgent`, `land`, `finishReview`, `landBeforeSettle`, `reviewGateApplies`, `idleClosedFails`, `inactivityFailureMessage` | Policy landing/PR, review gate, settle hoặc báo lỗi khi session idle đóng. |
| 10819–10985 · 167 dòng | `persistPastedAttachments`, `fileInAttachmentLibrary`, `grantableAttachmentLibrary`, `prepareAttachmentLibrary`, `attachmentLibraryHint`, `usableAttachmentLibrary`, `persistAttachment` | Ghi attachment vào thư mục run/thư viện và dựng đường dẫn đưa cho agent. |
| 11018–11356 · 339 dòng | `tryAutonomousNudge`, `tryCompactionContinue`, `armIdleTimer`, `clearIdleTimer`, `reconcileMonitoringWakeTimers`, `armMonitoringWakeTimer`, `clearMonitoringWakeTimer`, `monitoringWakeCapReached`, `armMonitoringLivenessTimer`, `clearMonitoringLivenessTimer`, `hasInFlightChildren`, `parkMonitorAsWaiting`, `armAutosave`, `clearAutosaveTimer` | Nudge autonomous, tiếp tục sau compaction, giới hạn idle/monitoring, autosave và chuyển monitoring sang waiting. |
| 11367–11525 · 159 dòng | `checkStepEnv`, `checkContextEnv`, `sweepPrHeadRefs`, `runCheckStep`, `finishStep` | Tạo env cho check, dọn ref PR, spawn shell check và kết thúc step. |

## 4. Ứng viên module, state và liên kết

`RunManager` hiện có các state quan trọng sau: `lifecycle` @1344, `active` @1346,
`verifying` @1348, `baselineTrees` @1350, `queue` @1366, `starting` @1367,
`redirecting` @1369, `cancelledStarting` @1372, `waiting` @1378,
`monitoring` @1380, `unitParents` @1396, `pendingJobs` @1397,
`pendingBranchNames` @1400, `pendingContinuations` @1405, `queuedImageSeq` @1409,
`deferredMessages` @1412, `deferredManagerDeliveryIds` @1414,
`continuationManagerDeliveryIds` @1416, `autoResumeTimers` @1422,
`softAskTimers` @1427, `pumping` @1428, `pumpAgain` @1431,
`repoRootTail`/`repoRootBusy` @1438/1442, `dataDir` @1445,
`memoryPausing` @1449, `queueWatchdog` @1456,
`limitSweepTimer`/`lastLimitTick` @1459–1460, `forceNextPump` @1463,
`forceStarted` @1467, `startNowRequested` @1471, `semaphore` @1476,
`projectId` @1484, `secrets`/`managerEnv` @1487–1488 và `resolveTrackerEnv`
@1491. Các state hỗ trợ khác: `disposed` @1351, `verifyDeps` @1352,
`checkArtifactSnapshots` @1360, `autosaveCheckpointBlockedRuns` @1362,
`branchNameWaitMs` @1401, `offUsage` @1453, `offSemaphore` @1480. `store` và
`repoRoot` là parameter properties của constructor @1494.
Các context bên dưới nên ghi rõ
quyền đọc/ghi; không đưa toàn bộ `RunManager` vào context mặc định.

| Ứng viên | State đọc/ghi | Gọi/được gọi bởi | Test phủ chính |
|---|---|---|---|
| Input/prompt/attachment helper (`run/preparation.ts`; §6 phần 1; 1018–1342) | Helper không cần `RunManager`; hàm ghi thư viện cần `dataDir`. Method persist attachment tại 10819–10985 được tách cùng settlement ở phần 15. | `startRun`, `sendMessage`, `continueRun`, `runContinuation`; được dùng bởi agent prompt và message delivery | `system-prompt.test.ts`, `skill-system-prompt.test.ts`, `pasted-attachments.test.ts`, `agent-tmpdir.test.ts`, `session-gap-message.test.ts` |
| Tạo run/agent env (`run/start.ts`; 1647–2015) | `store`, `repoRoot`, `dataDir`, `active`, `starting`, `queue`, `pendingJobs`, `pendingBranchNames`, `queuedImageSeq`, `memoryPausing`, `managerEnv`, `secrets`, `projectId`, `resolveTrackerEnv`, `semaphore` | Gọi `pump`, `execute`, tiện ích attachment/prompt; constructor đăng ký `busySlots`, `pump`, `accountHolds` với semaphore | `run.test.ts`, `start-run.test.ts`, `agent-profile-wiring.test.ts`, `private-mcp-launch.test.ts`, `secrets.test.ts`, `branch-naming.test.ts` |
| Queue và scheduling (`run/queue.ts`; 2026–2325) | Đọc/ghi `queue`, `starting`, `pendingJobs`, `pendingContinuations`, `pendingBranchNames`, `active`, `monitoring`, `unitParents`, `pumping`, `pumpAgain`, `startNowRequested`, `forceStarted`, `semaphore` | `startRun`/`recover` gọi `pump`; `pump` gọi `reviveQueuedRun` hoặc `execute`, tính `busySlots` và `accountHolds`; lifecycle giải phóng slot rồi gọi pump | `run.test.ts`, `start-now.test.ts`, `workspace-semaphore.test.ts`, `queued-workflow-refresh.test.ts`, `deferred-queue.test.ts`, `run-lease.test.ts` |
| Lifecycle/recovery (`run/lifecycle.ts`; 2341–2803, 6330–6477) | `active`, `queue`, `starting`, `cancelledStarting`, `waiting`, `monitoring`, `unitParents`, deferred maps, pending continuation, auto-resume/ask timers, `store`, `lifecycle` | Gọi `dropActive`, `pump`, `cancelAndWait`, `recoverRedirectOperations`, `recoverSoftAsks`, `reconcileAutoResumes`, `reportSettledChildToParent`; dispose gọi cleanup | `lifecycle-settlement.test.ts`, `recover-autonomous.test.ts`, `recover-dispatch.test.ts`, `recover-followups.test.ts`, `recover-no-session.test.ts`, `recover-session-failure.test.ts`, `leftover-processes.test.ts`, `worktree-lifecycle.test.ts` |
| Ngữ cảnh manager/điều khiển (`run/manager-controls.ts`; 2808–3907) | `store`, `repoRoot`, `active`, `managerEnv`, dispatch record, `redirecting`, `queue`, manager delivery ledger, deferred messages, `projectId`, `lifecycle` | Dùng `dispatch`, `cancel`, `sendMessage`/`deliverMessage`, `updateDispatch`, dependency repoint; `recover` gọi phần redirect recovery | `manager-controls.test.ts`, `manager-worker.test.ts`, `dispatch-structure.test.ts`, `dispatch-api.test.ts`, `manager-worker-api.test.ts`, `queued-messages.test.ts` |
| Verify (`run/verify.ts`; 3915–4324) | `verifying`, `baselineTrees`, `verifyDeps`, `disposed`, `store`, `repoRoot`, `lifecycle` và cancellation signal | `verifyFor` → `runVerify` → `runVerifyBaseline`; record ledger bằng `recordVerify`; cancel/dispose abort controller và dọn baseline | `manager-controls.test.ts`, `verify-exec.test.ts`, `dispatch-api.test.ts`, `worktree-lifecycle.test.ts` |
| Memory/plan/ask và manager inbox (`run/manager-state.ts`; 4327–4936) | `store`, `active`, dispatch, `softAskTimers`, pending ask/report, tree membership | Dùng `dispatchBudgetFor`, `handleDispatchTurn`, attention và automations session; được gọi từ turn handler/dispatch | `tree-plan.test.ts`, `soft-ask.test.ts`, `manager-worker.test.ts`, `manager-prompt.test.ts`, `manager-controls.test.ts` |
| Dispatch/order/report (`run/dispatch.ts`; 4943–5602) | `store`, `active`, `queue`, `starting`, `redirecting`, dispatch/budget, manager inbox/report, dependency envelope | `dispatchFromAgent` → `dispatch`; `startRun`, `recordReport`, `reportSettledChildToParent`, `cancelDescendants`; gọi group manager context | `dispatch-engine.test.ts`, `dispatch-structure.test.ts`, `manager-worker.test.ts`, `recover-dispatch.test.ts`, `deferred-child-binding.test.ts` |
| Holds, resume, limits và repo lease (`run/scheduling.ts`; 5608–6112, 6150–6320) | `autoResumeTimers`, `queue`, `pendingContinuations`, `forceNextPump`, `forceStarted`, `startNowRequested`, `semaphore`, `repoRootTail`, `repoRootBusy`, `active`, `store` | Timer gọi `fireAutoResume`; watchdog gọi `rescueStalledQueue`; hold/resume gọi `pump`, start-now, repo lease và stop-for-limit | `limits-run.test.ts`, `auto-resume.test.ts`, `transient-retry.test.ts`, `wait-expiry.test.ts`, `start-now.test.ts`, `repo-lease-park.test.ts`, `workspace-semaphore.test.ts`, `retention-wiring.test.ts` |
| Tin nhắn và queued input (`run/messages.ts`; 6495–7006) | `queue`, `active`, deferred message/delivery maps, continuation delivery IDs, image sequence, `store`, `dataDir`, session/repo lease | `sendMessage` → `deliverMessage`; tiếp tục qua `continueRun`; xóa/sửa queue cập nhật persisted attachments | `session-gap-message.test.ts`, `deferred-queue.test.ts`, `deferred-redeliver.test.ts`, `pasted-attachments.test.ts`, `queued-messages.test.ts`, `continue-run.test.ts` |
| Continuation và turn settlement (`run/continuation.ts`; 7013–7907, 10252–10462) | `active`, `starting`, `queue`, `pendingContinuations`, continuation delivery IDs, `checkArtifactSnapshots`, `autosaveCheckpointBlockedRuns`, session/turn flags, timers, `repoRootTail`, `store` | `continueRun` → `runContinuation`; hai đường runner gọi `recordTurnEnd`; settlement gọi landing và lifecycle | `continuation-tools.test.ts`, `continuation-unwinding.test.ts`, `continuation-missing-session.test.ts`, `continuation-context.test.ts`, `lifecycle-settlement.test.ts`, `non-final-monitoring.test.ts` |
| Tạo run và workflow graph (`run/execute.ts`, `run/graph.ts`; 7911–9474) | `active`, `starting`, `store`, `pendingBranchNames`, `pendingJobs`, `checkArtifactSnapshots`, `autosaveCheckpointBlockedRuns`, repo lease, `semaphore`, graph wait callbacks | `execute` tạo ActiveRun rồi gọi `executeGraph`; graph gọi `runFork`, `runSystemNode`, `runAgentStep`, `awaitChildren`, `dispatch` và park/resume | `run.test.ts`, `run-isolation.test.ts`, `graph-run.test.ts`, `graph-system-nodes.test.ts`, `deferred-child-binding.test.ts`, `manager-worker.test.ts` |
| Agent step và event (`run/agent-step.ts`; 9477–10250) | `active`, `store`, sink, session, usage checkpoint, `branchNameWaitMs`, `checkInProgress`, `autosaveCheckpointBlocked` | Gọi runner, `handleRunnerUiEvent`, check step, `handleDispatchTurn`, `recordTurnEnd`; `executeGraph`/`runContinuation` gọi vào | `run.test.ts`, `check-retry-on.test.ts`, `usage-identity.test.ts`, `autosave-gate.test.ts`, `agent-profile-wiring.test.ts`, `system-prompt.test.ts` |
| Landing/PR/settlement (`run/settlement.ts`; 10252–10985) | `active`, `store`, `lifecycle`, `autoLand`, review-gate, attachment maps/paths và session state | `recordTurnEnd` → `settleSuccess` → `landBeforeSettle`/review; `landOnDone` nhận callback close; attachment helpers được messages/start dùng | `landing-lifecycle.test.ts`, `unattended-landing.test.ts`, `trunk-based.test.ts`, `lifecycle-settlement.test.ts`, `pasted-attachments.test.ts`, `push-guard.test.ts` |
| Monitoring, idle, autosave (`run/monitoring.ts`; 11018–11356) | `active`, `monitoring`, `unitParents`, idle/wake/liveness/autosave timer trong `ActiveRun`, `store`, `dataDir` | Gọi `leaveMonitoring`, `releaseSlot`, `parkMonitorAsWaiting`, `armIdleTimer`, `dropActive` và settle; callbacks giữ state identity | `autonomous-nudge.test.ts`, `monitoring-exit.test.ts`, `non-final-monitoring.test.ts`, `wait-expiry.test.ts`, `autosave-gate.test.ts`, `lifecycle-settlement.test.ts` |
| Check step và agent support (`run/check-steps.ts`; 11367–11721) | `active`, `store`, `secrets`, `projectId`, `repoRoot`, `dataDir`, child process interrupt | `runCheckStep` → `checkStepEnv` → `checkContextEnv`; `finishStep` ghi event; `sweepPrHeadRefs` được lifecycle gọi sau dọn worktree; tiện ích cuối tệp phục vụ tiêu đề/skill/check | `check-retry-on.test.ts`, `worktree-lifecycle.test.ts`, `pr-head.test.ts`, `run.test.ts`, `secrets.test.ts`, `skill-system-prompt.test.ts` |

## 5. Mẫu tách đề xuất

Dùng **hàm tự do theo module với context nội bộ có kiểu hẹp**, còn `RunManager`
giữ làm façade. Mỗi method công khai hiện tại vẫn ở `RunManager` dưới dạng
wrapper; wrapper tạo/truyền context rồi gọi hàm mới. Context chỉ mang state mà
nhóm đó thực sự cần (ví dụ `QueueContext` có queue/starting/semaphore và callback
`execute`, không có secrets hay verify controller). Với lời gọi sang nhóm khác,
truyền callback có kiểu cụ thể thay vì đưa nguyên `RunManager` vào context.

Giữ nguyên constructor và options, phương thức public, kiểu API đang được test
import, thứ tự event, cách cập nhật `RunStore`, timeout, retry, và kết quả lỗi.
Không đổi hành vi khi tách. Kiểu dùng chung như `ActiveRun`/`PendingContinuation`
nên có một định nghĩa nội bộ duy nhất; nếu cần chuyển kiểu, đặt trong
`workflows/run/internal-types.ts`, không xuất từ barrel package. Tên export hiện
được test import từ `run.ts` phải được re-export ở façade để test/caller không
đổi import. Không để module mới import runtime từ façade `run.ts` ngược lại;
tránh chu trình bằng type-only import và callbacks.

Đây là lựa chọn phù hợp vì state vẫn thuộc manager, nhưng mỗi phần có seam để
đọc/ghi rõ ràng. Không chuyển toàn bộ private state sang một object chung ngay
lần đầu; làm vậy sẽ biến bước tách module thành thay đổi vòng đời state lớn.

## 6. Thứ tự tách đề xuất

Mỗi phần khoảng 300–1.200 dòng chuyển đi. “Context” là giao diện tối thiểu cần
định nghĩa khi làm phần đó; nó không phải danh sách đầy đủ mọi import.
Các kiểm thử dưới đây là lệnh cần chạy trong PR thực hiện phần tương ứng; trong
nhiệm vụ lập kế hoạch này chưa chạy test.

| # | Dòng chuyển khỏi `run.ts` → tệp mới | Context nội bộ cần có | Kiểm thử cần chạy |
|---|---|---|---|
| 1 · rủi ro thấp | `1018–1342` (325 dòng) → `packages/work/src/workflows/run/preparation.ts`; prompt, attachment helper/types và input preparation | Hàm nhận dependency qua tham số rõ ràng; `copyToAttachmentLibrary` chỉ cần `dataDir`. Không cần truyền `RunManager`; giữ WeakMap metadata trong cùng module với block tạo ra nó. | `npm test -- packages/work/src/workflows/system-prompt.test.ts packages/work/src/workflows/pasted-attachments.test.ts packages/work/src/workflows/agent-tmpdir.test.ts` |
| 2 | `1647–2015` (369 dòng) → `packages/work/src/workflows/run/start.ts`; memory guard, env/permission, note/MCP prep, `startRun`, `startVariants` | `StartContext`: `store`, `repoRoot`, `dataDir`, `active`, `starting`, `queue`, `pendingJobs`, `pendingBranchNames`, `queuedImageSeq`, `memoryPausing`, `semaphore`, `managerEnv`, `secrets`, `projectId`, `resolveTrackerEnv`; callback `pump`, `execute`, `busySlots`. | `run.test.ts`, `start-run.test.ts`, `agent-profile-wiring.test.ts`, `private-mcp-launch.test.ts`, `secrets.test.ts`, `branch-naming.test.ts` |
| 3 | `2026–2325` (300 dòng) → `packages/work/src/workflows/run/queue.ts`; slot counting, monitoring admission, pump, revive queued run | `QueueContext`: `queue`, `starting`, `active`, `pendingJobs`, `pendingContinuations`, `pendingBranchNames`, `monitoring`, `unitParents`, `pumping`, `pumpAgain`, `semaphore`, `accountHolds`, callbacks `execute`/`reviveQueuedRun`. | `run.test.ts`, `start-now.test.ts`, `workspace-semaphore.test.ts`, `queued-workflow-refresh.test.ts`, `deferred-queue.test.ts`, `run-lease.test.ts` |
| 4 | `2341–2803` + `6330–6477` (611 dòng) → `packages/work/src/workflows/run/lifecycle.ts`; recover, active/deferred cleanup, cancel/wait, activity query | `LifecycleContext`: `store`, `active`, `queue`, `starting`, `cancelledStarting`, `waiting`, `monitoring`, `unitParents`, deferred maps, timers, `lifecycle`; callbacks `pump`, `dropActive`, `reportSettledChildToParent`, `recoverRedirectOperations`, `recoverSoftAsks`, `reconcileAutoResumes`. | `lifecycle-settlement.test.ts`, toàn bộ `recover-*.test.ts` trong workflows, `leftover-processes.test.ts`, `worktree-lifecycle.test.ts`, `manager-worker.test.ts` |
| 5 | `2808–3907` (1.100 dòng) → `packages/work/src/workflows/run/manager-controls.ts`; dispatch context/budget, peek, conflicts, message/cancel/redirect, delivery | `ManagerControlContext`: `store`, `active`, `redirecting`, queue/dependency access, dispatch ledger, `projectId`, `lifecycle`; callbacks `dispatch`, `cancel`, `sendMessage`, `deliverMessage`, `updateDispatch`. | `manager-controls.test.ts`, `manager-worker.test.ts`, `dispatch-structure.test.ts`, `dispatch-api.test.ts`, `manager-worker-api.test.ts`, `queued-messages.test.ts` |
| 6 | `3915–4324` (410 dòng) → `packages/work/src/workflows/run/verify.ts`; verify/baseline/cleanup/ledger | `VerifyContext`: `store`, `repoRoot`, `verifying`, `baselineTrees`, `verifyDeps`, callback cập nhật ledger và lifecycle cleanup. | `manager-controls.test.ts`, `verify-exec.test.ts`, `dispatch-api.test.ts`, `worktree-lifecycle.test.ts` |
| 7 | `4327–4936` (610 dòng) → `packages/work/src/workflows/run/manager-state.ts`; memory/plan/ask/soft-ask/merge/inbox | `ManagerStateContext`: `store`, dispatch, `active`, `softAskTimers`, pending asks/reports, callbacks cho attention, tree membership và manager delivery. | `tree-plan.test.ts`, `soft-ask.test.ts`, `manager-worker.test.ts`, `manager-prompt.test.ts`, `manager-controls.test.ts` |
| 8 | `4943–5602` (660 dòng) → `packages/work/src/workflows/run/dispatch.ts`; budget, dependencies, worker dispatch, reports | `DispatchContext`: `store`, `active`, `queue`, `pendingJobs`, `starting`, budget/dependency access, callbacks `startRun`, `recordReport`, `reportSettledChildToParent`, `cancelDescendants`. | `dispatch-engine.test.ts`, `dispatch-structure.test.ts`, `manager-worker.test.ts`, `recover-dispatch.test.ts`, `deferred-child-binding.test.ts` |
| 9 | `5608–6112` + `6150–6320` (676 dòng) → `packages/work/src/workflows/run/scheduling.ts`; retry/resume/holds/retention, repo lease, start-now/limits | `SchedulingContext`: `store`, `queue`, `active`, `pendingContinuations`, auto-resume timers, `forceNextPump`, `forceStarted`, `startNowRequested`, `semaphore`, `repoRootTail`/`repoRootBusy`; callbacks `pump`, `execute`, `continueRun`, cancellation. | `limits-run.test.ts`, `auto-resume.test.ts`, `transient-retry.test.ts`, `wait-expiry.test.ts`, `start-now.test.ts`, `repo-lease-park.test.ts`, `workspace-semaphore.test.ts`, `retention-wiring.test.ts` |
| 10 | `6495–7006` (512 dòng) → `packages/work/src/workflows/run/messages.ts`; hydrate/queue/edit/defer/deliver message và attachment | `MessageContext`: `store`, `active`, queue, deferred maps, image sequence, `dataDir`, repo lease access; callbacks `continueRun`, `deliverMessage`, manager delivery transition. | `session-gap-message.test.ts`, `deferred-queue.test.ts`, `deferred-redeliver.test.ts`, `pasted-attachments.test.ts`, `queued-messages.test.ts`, `continue-run.test.ts` |
| 11 | `7013–7907` (895 dòng) → `packages/work/src/workflows/run/continuation.ts`; finish/continue/runContinuation | `ContinuationContext`: `store`, `active`, `starting`, `queue`, pending continuation/delivery IDs, `checkArtifactSnapshots`, `autosaveCheckpointBlockedRuns`, session state, repo lease, callbacks agent env, runner step, `recordTurnEnd`, `pump`. | `continuation-tools.test.ts`, `continuation-unwinding.test.ts`, `continuation-missing-session.test.ts`, `continuation-context.test.ts`, `lifecycle-settlement.test.ts`, `non-final-monitoring.test.ts` |
| 12 | `7911–8335` (425 dòng) → `packages/work/src/workflows/run/execute.ts`; tạo ActiveRun và bắt đầu workflow | `ExecuteContext`: `store`, `active`, `starting`, pending branch/jobs, `checkArtifactSnapshots`, `autosaveCheckpointBlockedRuns`, `repoRoot`, `dataDir`, semaphore/repo lease, callbacks preparation, `executeGraph`, terminal cleanup. | `run.test.ts`, `run-isolation.test.ts`, `start-run.test.ts`, `branch-naming.test.ts`, `run-lease.test.ts` |
| 13 | `8347–9474` (1.128 dòng) → `packages/work/src/workflows/run/graph.ts`; engine graph, node/fork/child wait/park | `GraphContext`: `store`, workflow/catalog lookup, graph wait callbacks, active/session, `checkArtifactSnapshots`, `autosaveCheckpointBlockedRuns`, callbacks `runAgentStep`, `runFork`, `runSystemNode`, `dispatch`, park/resume. | `graph-run.test.ts`, `graph-system-nodes.test.ts`, `deferred-child-binding.test.ts`, `manager-worker.test.ts`, `run.test.ts` |
| 14 | `9477–10250` (774 dòng) → `packages/work/src/workflows/run/agent-step.ts`; runner step, UI/usage event, title/branch | `AgentStepContext`: `store`, active session, sink, usage/checkpoint state, `branchNameWaitMs`, secrets/runner access, callbacks turn-end/dispatch/check. | `run.test.ts`, `check-retry-on.test.ts`, `usage-identity.test.ts`, `autosave-gate.test.ts`, `agent-profile-wiring.test.ts`, `system-prompt.test.ts` |
| 15 | `10252–10985` (734 dòng) → `packages/work/src/workflows/run/settlement.ts`; turn-end, settle/landing/review, attachment persistence | `SettlementContext`: `store`, `active`, lifecycle, `dataDir`, auto-land/review policy, attachment state, callbacks `landBeforeSettle`, `landOnDone`, timer cleanup, `dropActive`. | `lifecycle-settlement.test.ts`, `landing-lifecycle.test.ts`, `unattended-landing.test.ts`, `trunk-based.test.ts`, `pasted-attachments.test.ts`, `monitoring-exit.test.ts` |
| 16 | `11018–11356` (339 dòng) → `packages/work/src/workflows/run/monitoring.ts`; nudges, idle/wake/liveness/autosave timers | `MonitoringContext`: `active`, `monitoring`, `unitParents`, `store`, `dataDir`, timer fields on ActiveRun, callbacks `releaseSlot`, `leaveMonitoring`, `parkMonitorAsWaiting`, `armIdleTimer`. | `autonomous-nudge.test.ts`, `monitoring-exit.test.ts`, `non-final-monitoring.test.ts`, `wait-expiry.test.ts`, `autosave-gate.test.ts`, `lifecycle-settlement.test.ts` |
| 17 | `11367–11525` + `11533–11721` (348 dòng) → `packages/work/src/workflows/run/check-steps.ts`; check env, PR ref sweep, shell check, template/title/skill helpers | `CheckContext`: `store`, `active`, `secrets`, `projectId`, `repoRoot`, child interrupt, callback lifecycle cleanup; helper hàm thuần không cần context. | `check-retry-on.test.ts`, `worktree-lifecycle.test.ts`, `pr-head.test.ts`, `run.test.ts`, `secrets.test.ts`, `skill-system-prompt.test.ts`, `github-item-url.test.ts` |

## 7. Ranh giới chạy song song

Các cặp trong cùng một hàng có thể do worker khác nhau thực hiện đồng thời sau
khi thống nhất trước tên/context callback dùng chung. Mỗi cặp di chuyển các vùng
khác nhau của `run.ts`; họ có thể thêm **mỗi người một dòng import riêng** ở đầu
tệp. Không chỉnh cùng một vùng method. Nếu cần sửa chung chữ ký `RunManager`,
đưa thay đổi đó vào một bước tích hợp riêng sau khi các phần hoàn tất.

| Có thể song song | Vì sao ranh giới an toàn trong `run.ts` |
|---|---|
| 1 ↔ 2, 1 ↔ 3 | Phần 1 chỉ lấy 1018–1342; phần 2 lấy 1647–2015; phần 3 lấy 2026–2325. Không chồng dòng. |
| 2 ↔ 3 | 1647–2015 và 2026–2325 là các vùng kề nhau nhưng rời; chỉ thêm import riêng. Chốt callback `pump`/`execute` trước để không cùng sửa wrapper. |
| 4 ↔ 5 ↔ 6 ↔ 7 | Các vùng lần lượt là 2341–2803/6330–6477, 2808–3907, 3915–4324, 4327–4936; không chồng nhau. Context phải thống nhất callback qua dispatch/cancel/ledger. |
| 8 ↔ 9 ↔ 10 | 4943–5602; 5608–6112 và 6150–6320; 6495–7006. Disjoint; không sửa các khoảng trống giữa nhóm để tránh conflict không cần thiết. |
| 11 ↔ 12 ↔ 13 | 7013–7907, 7911–8335, 8347–9474. Disjoint; chốt callbacks giữa `runContinuation`, `execute`, graph và `runAgentStep`. |
| 14 ↔ 15 ↔ 16 ↔ 17 | 9477–10250; 10252–10985; 11018–11356; 11367–11525/11533–11721. Disjoint; cập nhật import độc lập. |

Phần 4 và phần 8–10 cũng disjoint về vùng nguồn; chúng có thể chạy đồng thời
nếu các callback lifecycle/report được định nghĩa trước. Song song ở đây nghĩa
là hai worker không cùng sửa vùng `run.ts`; hai nhánh vẫn cần lần tích hợp tuần
tự và chạy toàn bộ cổng kiểm thử trước khi merge.

## 8. Rủi ro và cổng hồi quy

1. **Hai handler cuối lượt gần giống nhau.** `runContinuation` gọi
   `recordTurnEnd` khoảng dòng 7506 và `runAgentStep` gọi khoảng dòng 9636.
   Cả hai flush sink, thu thập turn text, gọi `handleDispatchTurn` và phân giải
   ASK/DONE/MONITORING, nhưng điều kiện DONE và park khác nhau theo session,
   `interactive`, step cuối và workflow. Không hợp nhất hai thân hàm khi chỉ
   chuyển module. So sánh diff trước/sau và chạy cả continuation lẫn graph/run
   tests.
2. **Tạo `ActiveRun`.** `runContinuation` tạo `preparing: ActiveRun` @7303 và
   `state: ActiveRun` @7352; `execute` tạo `state: ActiveRun` @7916. Đây là hai
   method construction sites mà AGENTS.md yêu cầu grep theo type. Nếu thêm/bớt
   field hoặc đổi mặc định, cập nhật cả ba chỗ cùng lúc; không để state mới chỉ
   được khởi tạo trên một đường.
3. **Timer/closure giữ `this`.** Constructor tạo queue watchdog và limit sweep
   @1576–1579; các method tạo timer gồm auto-resume, soft-ask, idle, monitoring,
   liveness, autosave và cancellation. Callback dùng `this.active`, `this.store`,
   `this.pump`, giữ identity của `ActiveRun`, và nhiều timer gọi terminal path.
   Giữ `unref`, clear ở `dispose`/`dropActive`/cancel, chống callback stale và
   thứ tự release slot. Không chuyển closure sang hàm tự do nếu chưa đưa rõ các
   callback/state nó bắt giữ vào context.
4. **Nhóm được chuyển có thể kết thúc run.** Đường cần rà soát gồm
   `recordTurnEnd`/`settleSuccess` (10252–10462), `finish` (7013–7085),
   `stopForLimit`/`raiseAfterLimit` (6278–6320), `cancelOne` (6356–6434),
   `failOwnedContinuation` (2557–2566), `runCheckStep`/`finishStep`
   (11457–11525), `fireAutoResume` (5717–5775) và recovery (2341–2509).
   Trước khi bỏ timer/guard/callback, tìm mọi nơi nó làm run rời trạng thái
   `running`, `waiting`, `monitoring`, `queued`, `failed`, `cancelled`, `done` hay
   `review`. Giữ nguyên thứ tự ghi record/event, đóng session, ghi handoff,
   giải phóng semaphore và thông báo parent.
5. **Mở rộng scope qua import.** Một số test import export helper trực tiếp từ
   `run.ts` (ví dụ `agentDirectories`, `periodicAutosaveEnabled`, marker helpers,
   attachment/prompt helpers, `parseGithubItemUrl`). Trước từng PR chạy grep
   import, giữ re-export ở façade và không đổi đường dẫn test/caller.
6. **Lịch sử regression.** Đây là thay đổi cấu trúc có rủi ro cao. Với từng
   bước, viết/điều chỉnh test hồi quy trước khi chuyển, xác nhận test sẽ đỏ nếu
   bỏ behavior cũ, rồi chạy tối thiểu các file ở bảng §6. Trước merge theo
   AGENTS.md: `npm run typecheck`, `npm test`, `npm run test:unit`,
   `npm run build`, `npm run test:package`; trên Windows native dùng CI làm chuẩn
   cho các suite phụ thuộc POSIX.

## 9. Ghi chú phạm vi

Tài liệu này là kế hoạch D1, không thay đổi source. D1 nên bắt đầu bằng phần có
ít state nhất, giữ façade/API/options, rồi tách dần theo ranh giới §6. Những
phần cùng gọi một state transition có thể làm song song ở vùng source disjoint,
nhưng chỉ sau khi chốt kiểu context/callback; nếu không, ưu tiên tuần tự hóa
phần tích hợp thay vì để nhiều nhánh cùng sửa façade.
