# Manager / Worker — thiết kế (Giai đoạn 1, chỉ đọc)

Nhánh `feat/manager-worker`, tạo từ `dev` (đã chứa `feat/unattended-safety`, commit 76a8933). Mọi dẫn chứng là `file:dòng` hoặc `file` + tên hàm trên code hiện tại; chưa sửa dòng code nào. Sơ đồ: [`docs/architecture/13-seq-manager-worker.puml`](../architecture/13-seq-manager-worker.puml).

> **PNG chưa được xuất.** Môi trường chặn việc chạy `plantuml.jar` tải về. Lệnh render (README của thư mục architecture):
> `java -Djava.awt.headless=true -jar .ai/tools/plantuml.jar -tpng -o docs/architecture docs/architecture/13-seq-manager-worker.puml`
> (jar đã nằm ở `.ai/tools/plantuml.jar`, không được commit).

## 1. Hiện trạng

**Backend/model của task con được chọn thế nào**

| Đường | Cách chọn | Dẫn chứng |
| --- | --- | --- |
| Agent gọi `onni task create` | `--runner` và `--model` (chưa có `--backend`) → `POST /runs/:id/dispatch` với `runner`, `model` | `dispatch/task-cli.ts:31,102-103,120-121`; `contract/dispatch.ts` (`dispatchInputSchema`: `runner`, `model`) |
| `dispatch()` | `childRunner = input.runner ?? intent?.runner ?? parent.runner`; model theo thứ tự `input.model` → `intent.model` (nếu cùng runner) → `parent.model` (nếu cùng runner) | `workflows/run.ts:2964-2970` |
| Composer toggle Dispatch | `DispatchIntent{runner, model, budgetUsd, maxSubtasks, inFlight}` lưu ở `dispatch.intent` của root, chỉ làm *mặc định* khi order không nêu | `contract/dispatch.ts` (`dispatchIntentSchema`); `web/src/components/dispatch-toggle.tsx`; `dispatch/prompts.ts` (`dispatchIntentPrompt`) |
| Node `dispatch` trong graph | `runner`, `model`, `budgetUsd` trên node | `workflows/graph.ts:94-102`; `run.ts:6360-6367` |
| Runner theo step | `step.runner` (workflow YAML), `taskBackend` | `workflows/types.ts:43`; `run.ts:5979` |

Kết luận: **chưa có cờ `--backend`** (tên hiện là `--runner`). **Không có allowlist nào**: bất kỳ `RUNNER_IDS` (`claude, codex, opencode, cursor, pi, junie, copilot`, `core/agent-runner.ts:30`) nào đều dispatch được; chỉ đường spawn mới báo lỗi nếu backend chưa đăng nhập. Không có `antigravity` trong `RUNNER_IDS`/`PROVIDER_IDS` (`core/provider-auth.ts:14`), nên "thêm sau" nghĩa là thêm một runner mới theo `AGENT_PROTOCOL.md`; thiết kế dưới đây dùng danh sách backend động nên không cần sửa lại.

**Task con rẽ nhánh từ đâu, báo về, tích hợp**

- `baseBranch` của con = `parent.branch` (`run.ts:2994`), và `execute()` ưu tiên `baseBranch` đã ghi. Con fork từ nhánh *đã commit* của cha.
- **Lệch với R5:** `dispatch()` qua route/CLI **không** autosave WIP của cha trước khi fork. Chỉ node graph `dispatch` gọi `autosaveCommit(…, 'pre-dispatch')` (`run.ts:6206`). Autosave còn chạy ở cuối turn (`run.ts:5356`); phần sửa dở giữa turn không vào nhánh con. Prompt hiện chỉ nói "forked off YOUR branch as you last committed it" (`dispatch/prompts.ts:15`).
- Báo cáo: con ghi `onni task report` (`recordReport`, `run.ts`); khi con settle, `reportSettledChildToParent` ghi report bền rồi giao xuống cha theo bậc thang 4 bước (session mở → hàng đợi prompt → buffer khởi động → continuation mới) (`run.ts`, chú thích trước `reportSettledChildToParent`); buffer tối đa 20 report (`dispatch/engine.ts:30`).
- Tích hợp: **do prompt chỉ dẫn, không do engine**: "Merge an accepted child into your own branch with `git merge --no-ff <branch>`, one child at a time, re-running the repository's checks … Never merge into the base branch and never push" (`dispatch/prompts.ts:30`). Engine không merge hộ. Đúng yêu cầu R5; cần bổ sung bước cherry-pick/giải xung đột và autosave (§4).
- Giới hạn có sẵn (sau `feat/unattended-safety`): in-flight 4 mỗi cha, `maxSubtasks` (mặc định 12/cây), `dispatchMaxDepth` mặc định 1, `retry_limit` thực thi, ngân sách carve (`budgetUsd` + `limits` của cây). Xem ADR 0005.
- **Lệch với R4:** worker *vẫn nhận* `ONNI_API_URL`/`ONNI_PROJECT_ID`/`ONNI_BIN` và `DISPATCH_PROMPT` vì mọi run có bản ghi `dispatch` đều được cấp (`run.ts` `agentEnv`, `dispatchReachable`; `run.ts:2646` `composeDispatchPrompt(dispatch?.kind, …)`). Độ sâu 1 chỉ chặn ở `dispatch()` (từ chối sau khi agent đã thử). Cần cấp env/prompt theo độ sâu (§4).

**Khả dụng của backend / tài khoản**

- Trạng thái đăng nhập: `ProviderStatus.status ∈ connected | disconnected | not-installed …` (`core/provider-auth.ts:16-32`), qua `GET /providers/status` (`server/server.ts:2136`); bật/tắt `disabledProviders` (`core/provider-availability.ts:8`, `applyProviderEnablement`); chọn tài khoản `withSelectedAccounts` và thông báo `unavailableProviderMessage` (`server/provider-action-gate.ts:86,127`). Composer đã dùng chúng; `onni run` dùng ở `index.ts` (`providersRequiredByWorkflow`).
- Tài khoản: một backend + một `agentProfile` là một "tài khoản"; usage-limit đóng theo khoá `runAccountKey` (backend + profile) (`run.ts:~770`), nên limit của Claude không chặn Codex. Hai worker cùng backend chung một khoá và chung hold.

**Semaphore**

- `maxParallel` (mặc định 2) đếm mọi run `running` trong toàn workspace (`workspace/semaphore.ts`). Manager đỗ `monitoring` khi chờ con không chiếm slot nếu park do spawn (`enterMonitoring`, `run.ts:~1290`), còn mỗi worker chiếm một slot. Với `maxParallel = 2` chỉ 2 worker chạy cùng lúc dù roster cho 3. **Không có trần theo backend** — `maxConcurrent` của worker (R2) là một ràng buộc mới.

## 2. Phạm vi thay đổi đề xuất

| Lớp | Thay đổi |
| --- | --- |
| Contract (`packages/contract`) | `limits.ts`/`dispatch.ts`: `rosterSchema = { manager: {runner, model?}, workers: [{runner, model?, role: string(≤500), maxConcurrent: int 1–4}] (1–6 worker, runner duy nhất) }`; `runRecord.roster?`; `POST /runs` thêm `roster?` ; `dispatchInputSchema` thêm `backend` là alias của `runner` (giữ `runner`); preset: `workspace.managerPresets[]` + `defaultRoster?` trong `workspaceConfigResponse`/`setWorkspaceConfigInput`; route mới `GET /workspace/roster-backends` (backend khả dụng) — hoặc dùng lại `/providers/status` (ưu tiên, không route mới) |
| Config | Preset và roster mặc định trong `~/.onni/config.json` (workspace, như `agentDefaults`/`limits`); roster của một run **chụp** vào `RunRecord.roster` lúc start (như `limits`) |
| Engine | `workflows/manager-worker.ts` (thuần): `checkRoster`, `rosterPrompt`, `workerInFlight`; hook trong `dispatch()`; autosave async trước fork; env/prompt worker theo độ sâu; cờ `--backend` |
| API/CLI | `onni run --manager claude[:model] --workers codex[:model],opencode` ; `onni task create --backend X` (alias `--runner`); `POST /runs` nhận `roster` |
| UI | composer `/new`: khối "Manager / Workers" + preset; Settings → mục mới (hoặc trong Resources) cho preset/mặc định; badge backend trên cây task |

## 3. Các lựa chọn thiết kế

**A. Nơi thi hành allowlist**
1. *Chỉ prompt* — bị loại: R2 đòi server thực thi.
2. **Trong `dispatch()` (đề xuất)** — một điểm duy nhất mà cả route lẫn graph node đi qua (`run.ts` đầu `dispatch()`); từ chối kèm danh sách cho phép (`409`), ghi note ở transcript cha như các từ chối hiện có. Kiểm tra cả khi `input.runner` *vắng* (khi đó runner được suy ra = `intent?.runner ?? parent.runner`, phải thuộc roster; nếu manager là claude và claude không phải worker → từ chối nêu rõ "nêu --backend").
3. Chặn ở lớp spawn — bị loại: quá muộn, tạo run rồi mới fail.

**B. Cấu trúc roster**
1. Mở rộng `DispatchIntent` — nhỏ nhưng intent hiện là *mặc định/giới hạn mềm*, trộn "được phép" với "mặc định" gây nhầm.
2. **`RunRecord.roster` riêng (đề xuất)** — bất biến, chụp lúc start, con *thừa kế qua gốc cây* (`dispatch.rootRunId` → roster của root), nên worker không thể tự sửa danh sách. Roster có hiệu lực ⇒ chỉ root có `roster`; con tra cứu qua root.

**C. Độ sâu và môi trường worker (R4)**
- **Đề xuất:** khi `dispatchDepth(child) >= dispatchMaxDepth` thì env của child **không** có `ONNI_API_URL`, `ONNI_PROJECT_ID`, `ONNI_BIN`, `ONNI_TREE_DIR` dispatch… (chỉ còn `ONNI_HANDOFF_FILE`, `ONNI_TASK_ID`, `ONNI_TODOS_FILE`; **`ONNI_TASK_ID` giữ lại** vì rào limit/`onni run` dựa vào nó) và `state.dispatchPrompt` của worker là phiên bản rút gọn chỉ dạy `onni task report`. Nhưng `onni task report` cần `ONNI_API_URL`; vì vậy worker giữ `ONNI_API_URL` + `ONNI_PROJECT_ID`, chỉ bỏ khả năng *tạo task* bằng phía server (đã chặn ở `dispatch()`) và bỏ phần "cách dispatch" khỏi prompt. → Quyết định cần bạn: xem Q2.

**D. Tích hợp (R5)**
1. Engine tự merge — bị loại (rủi ro bỏ qua review, khó giải xung đột).
2. **Manager tự merge theo prompt (đề xuất, đã là hiện trạng)** + bảo đảm hai điều engine thi hành được: (a) autosave WIP commit của manager *trước khi* fork con (làm trong route dispatch, async, giống `pre-dispatch` của node graph); (b) khi con settle, report kèm `branch` và danh sách file đổi để manager chọn cherry-pick/merge. Kết quả cuối ở nhánh của manager và đi qua review gate như thường (không đổi `settleSuccess`).

**E. Giới hạn đồng thời theo worker**
- **Đề xuất:** `maxConcurrent` thi hành trong `dispatch()` (đếm con đang in-flight có cùng `runner` dưới cùng root); vượt thì từ chối kèm "đợi báo cáo rồi giao lại". Không đụng semaphore (vẫn là trần tổng).

**Đề xuất tổng:** A2 + B2 + C(biến thể: bỏ phần dạy dispatch, giữ report) + D2 + E, tái dùng toàn bộ `limits`/`safety` của ADR 0005 (R6): roster chạy dưới `limits` của root, con nhận phần còn lại, `dispatchMaxSubtasks`/depth sẵn có.

## 4. Chi tiết engine đề xuất

- `checkRoster(roster, rootRunners, input, parentRunner)` → `{ok}` | `{refused: "<backend> is not an allowed worker for this task; allowed: codex (backend tests), opencode (docs)"}`; model được kiểm tra nhẹ: nếu worker có `model` cố định thì order không được đặt model khác backend đó (order có thể đổi model *trong* backend nếu roster để trống model).
- `rosterPrompt(roster, remaining)` gồm: danh sách worker + vai trò + model + `maxConcurrent`; cú pháp `onni task create "<objective>" --backend X --model Y --scope … --budget …`; cách nhận báo cáo (report được giao vào session; đọc diff trước khi tin); giới hạn còn lại tính từ `limits`/`safety` (USD còn lại, số subtask còn lại, độ sâu 1); quy trình tích hợp (merge `--no-ff` từng nhánh `onni/<id8>` trong worktree của chính manager, giải xung đột, chạy lại check, không merge vào base, không push). Ghép vào `state.dispatchPrompt` của root thay cho/bên cạnh `dispatchIntentPrompt`.
- Manager không có trong `workers` ⇒ chỉ dispatch tới worker; manager tự làm việc nếu không cần giao.
- Backend khả dụng: `GET /providers/status` + `disabledProviders`; roster chứa backend `disconnected`/`not-installed` ⇒ `startRun` trả 409 kèm `unavailableProviderMessage`. Lúc dispatch, backend rớt đăng nhập giữa chừng ⇒ từ chối bằng cùng thông báo.

## 5. Rủi ro

1. **Manager bỏ qua prompt** (tự làm thay vì giao, giao sai nơi): allowlist chặn *sai nơi* bằng server nhưng không ép *phải giao*. Giảm thiểu: trần ngân sách/turn của `limits`; không ép ở engine.
2. **Xung đột merge** giữa nhiều worker: worker fork cùng HEAD, sửa cùng file ⇒ conflict khi tích hợp. Giảm thiểu: `--scope` bắt buộc trong prompt, tích hợp từng nhánh, check sau mỗi lần; manager chịu trách nhiệm giải quyết — đã có chỗ cho review task (`--kind review`).
3. **WIP mất:** nếu autosave thất bại (repo bẩn/lock) con fork từ commit cũ. Phải dừng dispatch với lỗi rõ thay vì fork âm thầm.
4. **Roster bất biến nhưng provider đổi:** worker bị đăng xuất giữa chừng ⇒ task con fail (retry_limit giới hạn).
5. **Hold theo tài khoản:** hai worker cùng backend chia một usage-limit; một hold dừng cả hai (đúng thực tế nhưng UI cần nói).
6. **`maxParallel` thấp** (mặc định 2) làm `maxConcurrent` vô nghĩa; UI nên cảnh báo khi tổng `maxConcurrent` > `maxParallel`.
7. **Chi phí đa backend:** codex/copilot không báo USD (ADR 0005) — trần USD của cây không đếm phần đó; chỉ có token/thời gian.
8. **Agent chủ động gọi HTTP thô** để dispatch ra ngoài roster: server vẫn chặn vì `dispatch()` là nơi duy nhất; nhưng `POST /runs` (run mới, không phải con) không bị roster ràng buộc — một agent có thể tạo run top-level bằng backend bất kỳ. Rủi ro hiện hữu (không xác thực), nêu để biết.
9. **Antigravity:** chưa là runner; thêm sau không đổi thiết kế (roster tham chiếu id runner động), nhưng schema `runnerSchema` là enum cố định ⇒ thêm runner mới phải cập nhật enum.

## 6. Câu hỏi cần bạn trả lời trước khi "duyệt"

- **Q1.** Cho phép roster dùng cả 7 backend hiện có (mọi backend đang `connected`) hay giới hạn ở `claude, codex, opencode` như R1? (Đề xuất: mọi backend `connected`; UI chỉ liệt kê cái khả dụng.)
- **Q2.** Môi trường worker: bỏ hẳn `ONNI_API_URL` (worker không báo cáo được bằng CLI → engine tự ghi report từ kết thúc run) hay giữ để `onni task report` hoạt động và chỉ bỏ phần dạy dispatch (đề xuất)?
- **Q3.** Manager có được tự đứng trong danh sách worker không (ví dụ Claude vừa quản lý vừa làm)? (Đề xuất: không; manager chỉ giao, tự làm khi không giao.)
- **Q4.** Preset lưu ở workspace (dùng mọi project; đề xuất) hay theo project?
- **Q5.** Vị trí Settings: thêm vào Settings → Resources như phần Limits (đề xuất, không đổi registry/test) hay một mục riêng?

---

## Phụ lục — quyết định đã duyệt và chỗ lệch (2026-11-01)

Theo tin nhắn duyệt, **tin nhắn thắng**. Chỗ lệch / làm khác so với bản đề xuất ở trên:

| Mục thiết kế | Thực tế | Lý do |
| --- | --- | --- |
| Q1 giới hạn backend | Không hardcode: danh sách = backend `connected` + enabled từ provider status; `POST /runs` từ chối roster chứa backend chưa kết nối (409) | Quyết định 1. Enum `runnerSchema`/`RUNNER_IDS` vẫn là danh sách mã hoá; thêm runner (Antigravity) = thêm vào hai nơi đó, UI tự hiện khi runner kết nối |
| Q2 worker env | Worker giữ `ONNI_API_URL`; `systemPrompt` của record worker là `undefined` và phiên chạy nhận `WORKER_PROMPT` (chỉ `onni task report`); chặn độ sâu vẫn ở `dispatch()` | Quyết định 2 |
| Q3 | Manager không phải worker (cùng backend + cùng model bị schema từ chối); cùng backend khác model được | Quyết định 3 |
| Q4/Q5 | Preset theo workspace (`managerWorker`), Settings có mục riêng "Manager–Worker" liên kết sang Resources (Limits, maxParallel) | Quyết định 4, 5 |
| `maxConcurrent` = từ chối | Thực thi trong `pump()` (`startable`): con vượt trần mục **giữ chỗ trong hàng đợi** thay vì bị từ chối | Quyết định 9; không đụng semaphore |
| Autosave trong `dispatch()` | `dispatch()` đồng bộ nên giữ nguyên; autosave nằm ở `dispatchFromAgent()` (route). Node graph vẫn dùng `pre-dispatch` cũ. Một dispatch bị từ chối sau khi WIP đã commit vẫn để lại commit WIP | Không đổi chữ ký `dispatch()` đang được gọi đồng bộ ở nhiều nơi |
| `onni run --manager` | Cần cockpit đang chạy (gọi `POST /runs`): một `onni run` headless không có API cho manager dispatch | `dispatchReachable` cần `ONNI_API_URL`; role và `maxConcurrent` chỉ đặt được ở composer/preset |
| Route `GET roster-backends` | Không thêm; dùng `GET /providers/status` có sẵn | Ít route hơn |
| Retention (10) | Thu hồi chỉ xoá **thư mục** (nhánh luôn được giữ — `retention.ts`); thêm `protectedByLiveTree`: không thu hồi, không `remove-worktree`/`DELETE` thủ công worker khi root chưa ở trạng thái cuối | Xác nhận cơ chế hiện tại và sửa chỗ thiếu |
| Deadlock (9) | Kiểm chứng: manager đỗ `monitoring` vì chính dispatch của nó (`unitParents`) **không tính** vào `maxParallel` (`busySlots`), nên không cần sửa. Còn lại: trong lúc turn của manager còn chạy nó giữ 1 slot, worker xếp hàng tới khi turn kết thúc — bounded bởi inactivity/ceiling | Test với `maxParallel` 1 và 2 |

**Rủi ro còn lại (thêm):** (a) run top-level tạo qua HTTP thô không bị ràng roster (chấp nhận, đã ghi vào docs/UI);
(b) manager bỏ qua prompt hoặc merge kém — engine chỉ rào *nơi giao*, không ép *phải giao* (có ghi chú "manager không
giao việc"); (c) hai worker cùng sửa một file vẫn xung đột; (d) `maxConcurrent` cao hơn `maxParallel` vô nghĩa (UI cảnh báo);
(e) PNG của sơ đồ chưa được render (môi trường chặn chạy `plantuml.jar`) — render bằng lệnh trong `docs/architecture/README.md`.

## Phụ lục B — prompt của manager, nguyên văn (roster mẫu: manager claude/opus; worker codex/gpt-5 "backend tests and migrations" ×2, opencode "documentation and changelogs" ×1; còn lại $7.50, 4 200 000 token, 180 phút, 25 bước, 9 subtask, độ sâu 1)

Sinh bằng `managerPrompt()` (`packages/work/src/workflows/manager-worker.ts`). Kiểm: dặn giao hết các phần độc lập rồi kết thúc turn bằng `ONNI:MONITORING` để chờ báo cáo (không `ONNI:DONE` khi worker chưa báo cáo); dặn phạm vi file không giao nhau; quy trình merge từng nhánh + check sau mỗi lần; giới hạn còn lại.

````text
Manager mode. The user chose you (claude (opus)) to MANAGE this task: you plan, hand independent parts to workers, review what they return and integrate it. You are not one of the workers.

Your workers. You may give tasks ONLY to these — the server refuses any other backend or model with a 409 that lists the allowed ones (a fence for orchestration, not a security boundary; do not try to get around it):
- codex (gpt-5) — backend tests and migrations. Up to 2 at once.
- opencode — documentation and changelogs. Up to 1 at once.

Giving work. From your shell, always through the cockpit's own binary, node "$ONNI_BIN" (every "onni task …" below means node "$ONNI_BIN" task …):

  onni task create "<objective>" --backend <worker backend> [--model <model>] --scope "<files or dirs it may touch>" --success "<how it knows it is done>" [--title "…"] [--budget <usd>] [--evidence "<what it must show>"] [--kind implement|review] [--review-of <branch or run id>]

- Name --backend for every task. Where the same backend appears twice in your roster, name --model too; an entry that fixes a model keeps it.
- The objective is the WHOLE assignment: the worker sees its order and the tree directory, nothing else you know. Give the goal, the context it needs and what finished means.
- Match the part to the worker's role above. Give workers that run at the same time DISJOINT file scopes — two workers editing one file is the failure this design cannot recover from, so split by directory or by module, never by line.
- Omit --budget unless the user asked for a cost limit; a worker's share is carved from the remainder below.
- onni commits your uncommitted work (labelled "onni: wip before dispatch") on your branch before it forks a worker, but commit your own clean state first. A worker forks the tip of YOUR branch.
- If you can finish a part faster than describing it, do it yourself; dispatch only independent work.

Waiting. Dispatch EVERY independent part first — workers run in parallel, and each one you hold back is time lost — then end your turn with a line containing exactly ONNI:MONITORING. onni parks you, frees your slot for the workers, and delivers each worker's report into this session when it settles. Do not poll or sleep, and do not end the turn with ONNI:DONE while any worker you dispatched has not reported and been integrated (or consciously left out).

Integrating. A report is a CLAIM: status (done, partial, failed, blocked), result, evidence, the worker's branch (onni/<id8>) and its cost. For each report, in the order they arrive:
1. Read the branch's diff (git diff <your branch>...<worker branch>) and run the tests it names.
2. Do NOT merge a worker whose status is failed or blocked, or whose evidence does not hold. Re-dispatch it with a sharper order, do the part yourself, or leave it out and say so.
3. Merge accepted branches into YOUR OWN branch, in your worktree, one at a time: git merge --no-ff <worker branch>. Resolve any conflict yourself, keeping both sides' intent.
4. Run the repository's checks after EACH merge; fix or revert before the next one.
5. When every part is in (or consciously left out), run the full checks once more and report the final result: what each worker delivered, what you changed, what is not done.
Never merge into the repository's base branch and never push; your branch goes through the usual review.

- Remaining at the start of this session: $7.50 of budget, 4,200,000 tokens, 180 minutes of running time, 25 agent steps — shared by you and every worker; the whole tree stops when a ceiling is reached.
- Subtasks left in this tree: 9. Workers run at depth 1: a worker cannot dispatch further tasks.
- At most 4 workers in flight at once; a worker over its entry's concurrency waits in the queue.

Remember the Guard: before anything irreversible or outside your scope, end the turn with ONNI:ASK and stop.
````
