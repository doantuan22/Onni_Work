# Unattended safety — thiết kế (Giai đoạn 1, chỉ đọc)

Nhánh `feat/unattended-safety`, tạo từ `dev`. Mọi dẫn chứng là `file:dòng` trên code hiện tại; chỗ nào
lệch `docs/FEATURES.md` thì code thắng và được ghi ở §7. Chưa sửa dòng code nào.

Mục tiêu: một run hoặc cây task chạy qua đêm không thể **đốt tiền**, **treo vô hạn**, hoặc **đụng
vào nhánh/dữ liệu ngoài worktree**.

## a) Quyền của agent trong run

| Backend | Cờ quyền thực tế | Dẫn chứng |
| --- | --- | --- |
| claude | `--permission-mode dontAsk` (hoặc `acceptEdits` nếu `ONNI_APPROVAL_GATE=1`) + `--allowedTools`. Mặc định `Read,Edit,Write,Grep,Glob,Bash`; `Bash` **không có allowlist** nên là shell tự do | `claude-cli-runner.ts:413-436`, `workflows/types.ts:239`, `agent-runner.ts:55-60` |
| codex | `approvalPolicy: never`, `sandbox: danger-full-access` (có mạng). Chỉ `ONNI_CODEX_NETWORK=0` mới hạ xuống `workspace-write` không mạng. `allowedTools` bị bỏ qua | `codex-app-server-runner.ts:64-68,430-432` |
| opencode | Mỗi permission prompt được runner tự trả lời; từ chối `external_directory` trừ file handoff của chính run. `allowedTools` bị bỏ qua | `opencode-server-runner.ts:92-94,743-757,895-912` |
| cursor | `-p --force --trust` (tự duyệt mọi thứ) | `cursor-agent-runner.ts:98` |
| pi | Dịch `allowedTools`/`bashAllowlist` sang danh sách tool riêng của pi | `pi-runner.ts:288-307` |
| junie | Chế độ `auto` = full shell, không phải sandbox; `allowedTools` bị bỏ qua | `junie-runner.ts:67-69` |
| copilot | `--allow-all-tools`; `request_permission` còn lại được tự duyệt; `allowedTools` **không** dịch | `copilot-acp-runner.ts:97-115,490-506` |

**Ghi ra ngoài worktree: CÓ THỂ.** Mọi runner chỉ đặt `cwd = worktree`; không backend nào bị giam bằng
OS (không container, không job object, không chroot). Với `Bash` mở, agent chạy được `cd ..`, ghi vào
repo gốc, `$HOME`, hay `git -C <repo gốc> checkout main`. Worktree còn **dùng chung `.git`** với repo
gốc nên `git push origin main` từ trong worktree chạy được. Lớp duy nhất đang có là môi trường tối
thiểu: không đưa secret của host vào child (`agent-env.ts:1-17`; nhưng `HOME` và `SSH_AUTH_SOCK` vẫn
được chuyển, `agent-env.ts:38,71`, nên git-over-ssh vẫn push được). Claude hạn chế `Edit/Write` theo
cwd + `--add-dir`, nhưng `Bash` thì không.

**Mạng: không chặn** (codex mặc định `danger-full-access`; claude/cursor/pi/junie/copilot không có cờ
chặn). Không có OS sandbox trong code, và một cái cho đủ 7 backend trên Windows là ngoài phạm vi.

Hệ quả cho thiết kế: "không đụng ngoài worktree" chỉ thực thi được **cho thao tác git do chính onni
làm** và **best-effort cho thao tác git của agent** (hook pre-push, §Thiết kế 4). Phần ghi file ngoài
worktree **không thể** đảm bảo bằng code onni; đây là rủi ro còn lại R1.

## b) Auto-land của run autonomous

- Chỉ chạy khi **toàn bộ** đúng: run `worktree === false` (in-place trong checkout), không `readOnly`,
  không `inPlaceBranch`, `config.landing === 'auto'`, và `.ai/onni/config.json` **không bị git theo dõi**
  (`run.ts:7766-7772`). Run thường (có worktree, nhánh `onni/<id8>`) **không bao giờ** đi qua đường này.
- `landNow` → `landInPlace` (`run.ts:7804-7828`, `landing.ts:99-165`): commit phần task để lại →
  `git fetch <remote> <branch>` → `git rebase --autostash <upstream>` (xung đột thì `rebase --abort` và
  fail) → chạy `requiredChecks` → `git push <remote> HEAD:<upstream.branch>` (`landing.ts:157`).
  Thử lại một lần nếu bị reject non-fast-forward.
- **Push tới đâu:** nhánh upstream của checkout, tức thường là nhánh mặc định/base (`main`). Đây là
  chủ đích của "trunk-based projects" và là quyền owner cấp bằng cấu hình cục bộ. Nếu `config.baseBranch`
  đặt thì checkout phải đang ở nhánh đó (`landing.ts:105-111`). Không có upstream → chỉ commit local.
- **Force push: không** (không có `--force`/`--force-with-lease` ở đâu trong `landing.ts` hay
  `git-worktree.ts:813`). `pushBranch` (node `git.push`, `run.ts:6360-6373`) đẩy `run.branch` bằng
  `git push -u <remote> <branch>`; từ chối nhánh dạng option, nhưng **không kiểm tra** nhánh có phải
  `onni/*` hay nhánh mặc định không.
- Merge PR: không tự động; chỉ qua `POST /api/v1/github/prs/:number/merge` do người bấm.

**Kết luận cho hạng mục 4:** yêu cầu "autonomous không bao giờ push vào nhánh mặc định" **đang mâu thuẫn**
với auto-land trunk-based (một tính năng owner đã duyệt, mặc định TẮT, `AGENTS.md` Invariants). Cần
quyết định, xem Câu hỏi Q1.

## c) Chống treo

| Cơ chế | Giá trị | Dẫn chứng |
| --- | --- | --- |
| Inactivity mỗi turn (không có frame nào) | 30 phút → SIGTERM → SIGKILL sau 10 s | `claude-cli-runner.ts:40-42`, `inactivity-deadline.ts` |
| Trần cứng mỗi turn dù vẫn stream | 8 × 30 = **4 giờ** | `inactivity-deadline.ts:19` |
| Idle timer của session `waiting` | 15 phút, cấu hình 0–1440, `0`/`null` = tắt | `workspace/config.ts:85,94`, `run.ts:8426-8442` |
| Monitoring liveness | 4 × idle (60 phút) khi không có wake interval | `run.ts:246,8546-8573` |
| Nudge autonomous / wake-up monitoring | 40 mỗi vòng đời | `run.ts:645,8321,8467` |
| Auto-resume sau usage limit | 12 lần, cửa sổ missed 24 h | `run.ts:704-719` |
| Compaction continue | 3 | `run.ts:343` |
| Land | 3 lần agent sửa, push thử 2 lần, fetch/push 60 s, check 10 phút | `run.ts:647`, `landing.ts:35-36` |
| Loop node | `loop.max` mỗi node (`onFail.retry.max`), đếm trong `graphState.loops` | `run.ts:5693-5760` |

**Không có** trần wall-clock cho cả run, không có trần số vòng agent step, không có trần chi phí/token cho
run thường. Giới hạn lý thuyết hiện tại của một run chỉ là tích các bộ đếm ở trên (rất lớn).

**Run vào `waiting` (ask-user) mà không ai trả lời:** slot được nhả ngay (`run.ts:7098`, `8604`), nên
không giữ slot vô hạn. Idle timer 15 phút đóng session (`run.ts:8431-8439`); run ASK-park khi đó kết
thúc `failed` + nút Continue (comment `run.ts:8588-8590`). Nhưng nếu người dùng đặt idle `0`/`null` thì
**chờ vô hạn** (không timer nào khác cho `waiting` thường). Run thường lệ không gửi câu hỏi (autonomous)
bị nudge thay vì park (`run.ts:8321-8341`), tối đa 40 lần.
**Run ở `review`:** không có session, không slot, **không có hết hạn**: nằm đó mãi, và worktree + nhánh
của nó cũng nằm đó. Không tốn tiền nhưng "không ai trả lời" không bao giờ ra trạng thái cuối.

## d) Số liệu chi phí theo backend

| Backend | Token | Cost USD | Dẫn chứng |
| --- | --- | --- | --- |
| claude | có | **có** (`total_cost_usd`) | `claude-ui-mapper.ts:643-655` |
| opencode | có | **có** | `opencode-ui-mapper.ts:213-226,599-601` |
| pi | có | **có** | `pi-ui-mapper.ts:241-242` |
| junie | có | **có** (cumulative session) | `junie-ui-mapper.ts:99-100,160-164` |
| codex | có (cumulative) | không | `codex-ui-mapper.ts:841-855` |
| copilot | có | không | `copilot-ui-mapper.ts:110-113` |
| cursor | **không** (result frame không có usage) | **không** | `cursor-ui-mapper.ts:8-11` |

Run cộng dồn từ các step: `tokensUsed` luôn là số (`store.ts:1489`), `costUsd` là `undefined` nếu không
step nào báo (`store.ts:1512-1514`), "unreported ≠ free". Brake duy nhất hiện có là
`enforceDispatchBudget`, chỉ cho run có `dispatch.budgetUsd`, và nó **đậu run `waiting`** chứ không giết
(`run.ts:2823-2838`).

**Trần dùng được:** claude/opencode/pi/junie → `maxCostUsd` + `maxTokens`; codex/copilot → `maxTokens`
(+ thời gian); cursor → chỉ `maxWallClockMinutes` + `maxStepIterations`. Khi một trần không đo được cho
backend, UI hiển thị "không đo được" thay vì 0, và run vẫn bị chặn bởi các trần còn lại.
Kiểm tra trần ở turn-end (nơi `updateStep` cộng usage, `run.ts:4824-4828,6931-6935`) nên có độ trễ tối
đa một turn; đây là giới hạn cố hữu vì cost chỉ có ở cuối turn của claude. Khi vượt, run **không** chỉ
đậu `waiting` như brake dispatch mà kết thúc terminal.

## e) Khôi phục khi crash/restart

`recover()` (`run.ts:2130-2291`): quét `queued|waiting|running`; xóa tmp dir mồ côi
(`sweepAgentTmpDirs`) và **giết process mồ côi** của run đã settle (`reapLeftoverProcesses`,
`run.ts:2144-2148`, #1411).
- `queued` → xếp hàng lại. `running` chưa có session → xếp hàng lại.
- `running` có session → đánh `failed (interrupted)` rồi **tự `continueRun` với prompt restart**
  (`run.ts:2257-2283`). **Đây là điểm cần chú ý cho trần:** bộ đếm trần phải bền (ghi trên RunRecord),
  nếu không mỗi lần restart sẽ reset ngân sách. Token/cost thì đã bền (cộng từ step); wall-clock phải
  tính từ `startedAt` bền chứ không từ timer trong bộ nhớ.
- `waiting` có `askParked`/`attentionRequest` → `failed` + `awaitingAnswerSince`, không tự tiếp tục
  (`run.ts:2200-2223`). `waiting` thường (tail tương tác) → settle thành công. Node không phải agent
  → resume tại node.
- Worktree mồ côi: `lifecycle.reconcile()` và dọn worktree khi mở project
  (`project-context.ts:24,248-278`). Worktree của run `review`/`failed` được **giữ** (là việc của người).

## f) Dispatch

Code hiện có nhiều hơn FEATURES.md nói:
- **`maxSubtasks` ĐƯỢC thực thi**: `dispatch()` đếm mọi run có cùng `rootRunId` trừ root và từ chối khi
  vượt (`run.ts:2877-2885`). FEATURES.md §5 dòng 143 và §16 dòng 347 **sai**. Cần test khóa vì chưa chắc
  có (sẽ kiểm ở Giai đoạn 2). Lưu ý nó chỉ áp dụng khi root được tạo kèm `intent` từ composer/automation;
  một run tự dispatch mà không có `intent` thì **không có trần tổng cây**.
- In-flight: `min(4, intent.inFlight)` mỗi **parent** (`run.ts:2870-2876`) — không phải mỗi cây.
- **Độ sâu: không có.** `dispatch()` không đọc độ sâu; con có `parentRunId` nên tính được độ sâu bằng cách
  đi ngược `parentRunId` đến `rootRunId`. Con luôn `autonomous: true` và cũng tự gọi được `dispatch`
  (`run.ts:2929`), nên cây tối đa là 4^n.
- **`retry_limit`**: có trong schema (`contract/dispatch.ts:151`), chỉ được in thành dòng "Retry limit: N"
  trong envelope (`dispatch/engine.ts:114`) và `task-cli.ts:122` nhận cờ `--retry-limit`. Không có chỗ nào
  đếm hay chặn. Nó là lời dặn cho agent, không phải ràng buộc.
- Ngân sách: `carveChildBudget` chia từ phần còn lại của parent, chỉ khi parent có trần
  (`run.ts:3000-3016`); parent không trần thì con không trần.

## Thiết kế đề xuất cho Giai đoạn 2

### 1. Trần mọi run
- Schema thêm (tất cả optional, `RunRecord` cũ vẫn parse): `config.limits = { maxCostUsd, maxTokens,
  maxWallClockMinutes, maxStepIterations }` trong `.ai/onni/config.json`, và `limits` tùy chọn khi tạo run
  (ghi đè theo run, chỉ được **siết** hoặc nới trong mức tối đa của config? xem Q2). Kết quả hợp nhất
  được **chụp lên `RunRecord.limits`** lúc tạo, nên sửa config không đổi run đang chạy.
- Mặc định đề xuất (áp dụng cho run `autonomous` và run của cây dispatch; run tương tác chỉ có
  wall-clock/vòng, vì người đang nhìn): `maxCostUsd 20`, `maxTokens 20M`, `maxWallClockMinutes 480`,
  `maxStepIterations 30`. Số này là phỏng đoán; cần bạn chốt (Q2).
- Thực thi: một hàm `checkRunLimits(runId)` gọi ở turn-end (cạnh `enforceDispatchBudget`, `run.ts:4824,6931`)
  và một timer wall-clock arm lại từ `startedAt` trong `recover()`. Chạm trần → ghi
  `RunRecord.limitHit = { kind, limit, used }`, `cancel` có cascade cây, trạng thái `failed` với
  `error` rõ ràng ("hit maxCostUsd 20.00 (used 21.37)") để không bị đọc là thành công, và slot được
  nhả qua đường `dropActive` sẵn có. Không dùng `done`.
- Trần thời gian dùng thời gian **đã chạy** của run (trừ lúc park `waiting`/`review`?) — đề xuất tính
  thời gian đồng hồ từ `startedAt` bất kể park, vì mục tiêu là "không treo"; park đã có hạn riêng (mục 3).
- UI: hiển thị trần và mức dùng trong header run (`used / limit`, "không đo được" cho backend không báo).
- Env: `ONNI_LIMITS=0` tắt; mặc định BẬT cho run autonomous theo "default-on exception" (cần chấp thuận, Q2).

### 2. Dispatch
- Thêm `DISPATCH_MAX_DEPTH = 1` trong `contract/dispatch.ts` (worker không dispatch tiếp). `dispatch()` tính
  độ sâu của parent (đếm bước lên `parentRunId`) và từ chối khi `depth >= max`, kèm note giống các từ chối
  khác. Tùy chọn `intent.maxDepth` chỉ được **hạ** (như `inFlight`), tối đa 3.
- `maxSubtasks`: giữ bộ đếm hiện có; thêm **trần tổng cây mặc định** khi không có `intent` (đề xuất 12,
  `DISPATCH_DEFAULT_MAX_SUBTASKS`), và test khóa.
- `retry_limit`: đề xuất **thực thi** thay vì gỡ: đếm lần con thất bại của cùng `title`/order trong cây
  và từ chối dispatch lại khi vượt. Gỡ khỏi schema sẽ phá `BACKWARD_COMPATIBILITY.md`. Xem Q3.

### 3. Chế độ không giám sát
- `config.unattended.waitExpiryMinutes` (mặc định 30 khi run `autonomous`, tắt cho run tương tác). Khi run
  vào `waiting` (ask/attention) hoặc `review` quá N phút: kết thúc `failed` với `completionReason:
  'wait-expired'`, nhả worktree theo đường hiện có, **giữ worktree + nhánh** (không xóa công việc), và phát
  webhook `task.failed` kèm lý do. Đây là hạn bên cạnh idle timer 15 phút; idle `0`/`null` không còn tạo
  chờ vô hạn cho run autonomous.
- Hạn `review` cần một timer mới có kiểm tra khi `recover()` (run `review` không có `active` state), do
  đó phải tính từ mốc bền `finishedAt`/`awaitingAnswerSince`.

### 4. Landing an toàn
- Auto-land hiện **không** đúng yêu cầu (b). Đề xuất: tách thành hai lớp, không đụng cấu hình trunk-based
  mà owner đã bật cho run tương tác:
  1. Run `autonomous` + `landing:'auto'`: **mặc định chuyển sang đẩy nhánh `onni/<id8>`** và không đẩy lên
     nhánh mặc định; đẩy lên base chỉ khi đặt thêm `landing.autonomousToBase: true` (opt-in rõ ràng, hoặc
     `ONNI_AUTONOMOUS_LAND_TO_BASE=1`). Hành vi hiện tại cho run tương tác không đổi.
  2. `pushBranch` thêm guard: từ chối nếu nhánh là nhánh mặc định/base hoặc không khớp tiền tố `onni/`/nhánh
     namer của run; không bao giờ truyền `--force*`. Test chặn.
- Thực thi cho cả lệnh git do **agent** tự chạy: onni đặt `GIT_CONFIG_COUNT/KEY/VALUE` trỏ
  `core.hooksPath` tới thư mục hook do onni sinh, có `pre-push` từ chối ref ≠ nhánh của run. Đây là
  best-effort (agent có thể gỡ biến môi trường, `--no-verify`), không phải biên bảo mật (R1).
- Không merge PR: đã đúng (chỉ route do người bấm); thêm test khóa rằng không có đường tự merge.

### 5. Dừng khẩn cấp
`cancel()` đã cascade cây (`run.ts:3793`). Thêm `RunManager.cancelAll()` (qua mọi run `queued|running|waiting`
và hủy auto-resume đã hẹn), `POST /api/v1/runs/cancel-all` (contract + `route-parity` + `contract-parity`),
nút trên UI (xác nhận 1 bước), CLI `onni stop --all` (gọi API khi server chạy; không server thì thôi).
Trả `{ cancelled: n }`.

### 6. Thông báo
Đã có sẵn: webhook ký `onni.json.v1` với `task.attention_required|review_ready|finished|failed|cancelled`
(`contract/webhooks.ts:41-52`) — nối lại, chỉ cần thêm `completionReason`/`limitHit` vào payload. Đã có:
Notification của trình duyệt khi tab ẩn, mặc định tắt (`web/src/lib/notifications.ts`), **chỉ khi cockpit
đang mở**. **Chưa có** thông báo hệ thống của shell desktop (`packages/desktop` chỉ có
`Cargo.lock` nhắc đến, không có plugin notification trong `src-tauri`). Thêm cần plugin Tauri
`notification`: đây là phụ thuộc mới + capability; theo `AGENTS.md` phải quyết (Q4). Run chạy đêm khi
cockpit đóng chỉ có webhook, nên webhook là kênh chính.

## Rủi ro còn lại

- **R1.** Không có OS sandbox: agent có `Bash` ghi được ngoài worktree, dùng mạng, push bằng credential
  của người dùng. Hook pre-push và env tối thiểu chỉ giảm rủi ro. Giam thật cần container/VM, ngoài phạm vi.
- **R2.** Trần chi phí chỉ kiểm ở cuối turn; một turn dài tới 4 h có thể vượt trần trước khi bị cắt.
  Cursor không đo được token/cost nên chỉ có thời gian/vòng.
- **R3.** Cost USD là con số backend tự báo; có thể thiếu hoặc sai.
- **R4.** Giết run đang giữa chừng có thể để lại worktree sửa dở (được giữ có chủ đích) và tiến trình
  con mồ côi chỉ được dọn ở lần `recover()`/settle tiếp theo.
- **R5.** Máy ngủ/đồng hồ nhảy làm wall-clock sai; dùng thời gian tuyệt đối từ `startedAt`.

## Câu hỏi cần bạn trả lời trước khi "duyệt"

- **Q1 (hạng mục 4).** Auto-land trunk-based đẩy lên nhánh base theo thiết kế của owner. Bạn muốn: (A) run
  autonomous mặc định đẩy `onni/<id8>`, base chỉ khi opt-in rõ ràng (đề xuất); hay (B) cấm hẳn push base cho
  autonomous, bỏ luôn cấu hình đó?
- **Q2 (hạng mục 1).** Chấp thuận trần mặc định BẬT cho run autonomous và các số đề xuất? Override theo run
  được phép nới quá config hay chỉ được siết?
- **Q3 (hạng mục 2).** `retry_limit`: thực thi (đề xuất) hay gỡ?
- **Q4 (hạng mục 6).** Có chấp nhận thêm plugin Tauri `notification` (phụ thuộc mới) hay chỉ dùng webhook +
  Notification trình duyệt?
