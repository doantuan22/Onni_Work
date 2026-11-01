# Báo cáo hiện trạng Onni Work — Giai đoạn 5

Cập nhật: 02/11/2026. Phạm vi: đưa quyền sở hữu cây tiến trình xuống **engine** (C-05/C-06), bỏ guard D,
phủ động các luồng chưa từng chạy, và bàn giao các bước chỉ kiểm được trên máy thật.

## Kết luận

**READY cho dùng cá nhân có giám sát.** C-05/C-06 đã đóng bằng một cơ chế chung ở engine, có test tự
động lẫn thực nghiệm trên engine thật; guard D đã bỏ đúng lý do và không mất test nào khác; bốn file
B-class từng 129 fail nay đạt **282 pass + 1 skip** trong một lượt chạy song song; các luồng động
(song song, manager–worker, limit theo run và theo cây, phục hồi sau khi engine chết) đều chạy đúng.

**NOT READY để tuyên bố "không giám sát"** cho tới khi checklist §7 chạy xong trên máy thật: toàn bộ
`npm test` trong PowerShell không có `sh`, tray Quit, và cài/gỡ NSIS. Đây là các bước kiểm chứng, không
phải lỗi đã biết. Các đánh đổi và ca chưa tái hiện nằm ở §6.

## 1. C-05/C-06 — Job Object ở engine

### 1.1 Cơ chế

Một tiến trình `powershell.exe` thường trú (keeper) giữ các Job Object Windows với
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Thành viên job được **kế thừa lúc tạo**, nên con cháu `detached`
cũng nằm trong job; job chết khi mọi handle đóng, kể cả handle mà OS đóng lúc pipe stdin của engine đứt
— đúng thứ xảy ra khi engine bị `taskkill /F`.

| Tệp | Vai trò |
| --- | --- |
| `packages/work/scripts/job-keeper.ps1` | Keeper thường trú: `CreateJobObjectW`, `KILL_ON_JOB_CLOSE` (`:25`, `:72`), `assign/terminate/exit` theo giao thức `<seq> …` trên stdin, `TerminateAll()` khi stdin EOF (`:110`, `:139`, `:160`, `:173`) |
| `packages/work/src/core/process-jobs.ts` | Client keeper: khởi động lazy, chờ `ready` trước spawn đầu tiên, `ready()`/`job(key)`, chết thì không khởi động lại (`:59-188`); `processJobs` dùng chung (`:209`); `jobKeyForEnv()` = `ONNI_TASK_ID ?? ONNI_RUN_ID` (`:212-215`) |
| `packages/work/src/core/task-process-spawn.ts` | Mọi spawn task được gán vào job của run sau khi tạo (`:20-29`), giữ nguyên wrapper treo-khi-spawn cũ |
| `packages/work/src/workflows/run.ts` | `await processJobs.ready()` trước lượt đầu (`:5535`) và trước continuation (`:4966`) |
| `packages/work/src/server/terminal/sessions.ts` | Mỗi phiên một job `term-<id>` (`:220`); chờ `ready()` trước khi spawn shell (`:205`); `kill()`/`closeAll()` chờ assignment rồi `terminate()`; assignment poll `pty.pid` vì ConPTY trả pid 0 trong ~110–120 ms đầu |
| `packages/work/src/core/process-jobs.test.ts` | 3 test C-05 (detached grandchild; engine bị kill cứng; host không có keeper) |
| `packages/work/src/server/terminal/sessions-tree.test.ts` | 3 test C-06 (creation gán job; `kill()`; `closeAll()`) |

Quyết định đã chốt: **job của một run sống tới khi engine thoát**, không terminate khi run xong. Cancel
một run vẫn đi đường kill riêng của runner. Hệ quả và đánh đổi ở §6.

Chi phí đo lại trong đợt này: keeper sẵn sàng sau **430 ms**, working set **71,2 MB** (private 58 MB),
và tự thoát khi stdin đóng. Không có PowerShell bị chặn/biến mất thì `supported=false`/`ready=false`,
mọi caller giữ đường cũ — spawn không bao giờ fail vì keeper.

### 1.2 Bằng chứng

**(a) Mô phỏng terminal thật** (`.tmp/phase4/sim-terminal-tree.mjs`, node-pty + cmd.exe). Trước sửa
(`.tmp/phase4/sim-terminal-tree.out.txt`):

| Kịch bản | Trước | Sau (`.tmp/phase5/sim-terminal-tree.out.txt`) |
| --- | --- | --- |
| `kill-direct` | `stopped:true` | `stopped:true` |
| `kill-detached` | **`stopped:false`** | `stopped:true` |
| `kill-orphan-attached` | `stopped:true` | `stopped:true` |
| `closeAll-detached` | **`stopped:false`** | `stopped:true` |

**(b) Test tự động.** 3 test C-05 + 3 test C-06 ở các tệp trên; nhánh Windows chạy thật, nhánh POSIX
kiểm bằng năng lực, không thêm `.skip`/`.only` nào.

**(c) Engine thật bị kill cứng** (`.tmp/phase5/engine-hardkill-real.mjs` → `engine-hardkill-result.json`):
engine tsx thật, một run `quick-task` (mock agent) và một terminal đang chạy holder + grandchild đã
`detached`. Chỉ `taskkill /F /PID <engine>`, không `/T`:

| Đối tượng | Trước | Sau |
| --- | --- | --- |
| engine (39892) | sống | chết |
| agent CLI (10356) | sống | chết |
| terminal holder (31348) | sống | chết |
| grandchild đã re-parent (15816) | sống | chết |

`killedInMs: 251`, `verdict: "stopped"`.

**(d) Keeper chết theo engine.** Với một engine probe còn sót (port 4409, keeper 28472): `taskkill /F`
riêng engine → keeper chết sau **688 ms**, cổng 4409 đóng. Đúng chuỗi "engine chết → pipe đứt → keeper
thoát → job đóng → cả cây chết".

## 2. B-class — trước/sau

Chạy **một lượt song song** bốn file từng fail nặng nhất (không chạy riêng từng suite), trên Windows:

| File | Fail trước (bản PS) | Sau (một lượt) |
| --- | ---: | --- |
| `packages/work/src/workflows/run.test.ts` | 67 | — |
| `packages/work/src/worktree-lifecycle/coordinator.test.ts` | 25 | — |
| `packages/work/src/git-worktree.test.ts` | 25 | — |
| `packages/work/src/workflows/landing-lifecycle.test.ts` | 12 | — |
| **Tổng** | **129** | **4 file pass, 282 pass + 1 skip (283 test), 94,91 s** |

Test bị skip là guard nền tảng có từ trước (`it.skipIf(process.platform === 'win32')` cho kịch bản
process-group của POSIX, commit `deee309`), không phải skip mới. Nền tảng Phase 4 vẫn giữ: 59 suite từng
fail chạy riêng đạt 68 lượt; 6 suite từng phụ thuộc shell đạt 103/103 khi PATH không có `bash`.

## 3. D — bỏ guard `bc-route-inventory`

Đã xoá theo phương án (b), commit `fd17a09`. Lý do ghi trong commit: `route-parity`,
`versioned-surface`, `typed-bodies`, `contract-parity` đã bắt drift cơ học; guard cũ so danh sách
"Routes:" ở §2 `BACKWARD_COMPATIBILITY.md` mà danh sách ấy đã bị xoá khi viết lại tài liệu (`1cc14e0`).

Bằng chứng trước khi xoá: chạy riêng `Tests 2 failed | 9 passed`, `inventoriedApiRoutes = 3`; không
helper nào của file được import ở nơi khác; không script/CI nào nhắc tên. Không xoá test nào khác.

## 4. Phủ động các luồng chưa từng chạy

Tất cả chạy trên engine thật với `ONNI_DRY_RUN=1` (mock CLI), trừ khi ghi khác. Kịch bản:
`.tmp/phase5/dynamic-flows.mjs`, `tree-limits-recovery.mjs`, `diag-limits.mjs`; kết quả
`dynamic-flows-result.json`, `tree-limits-recovery-result.json`.

| Luồng | Cách chạy | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| Song song 2 biến thể | `POST /runs` `variants:2` | 201; 2 run, 2 worktree khác nhau, 2 CLI; cancel cả hai → `cancelled`, CLI chết | `parallel` |
| Manager–worker qua API dispatch | root + `POST /runs/:id/dispatch` | 201; worker ở worktree riêng; worker dispatch tiếp → 409 "capped at 1"; off-roster `junie` → 409 nêu danh sách `claude — probe worker`; cancel root → cả cây `cancelled`, 0 CLI worker sống | `managerWorker` |
| Limit theo run | `maxTokens: 1` | `limitHit {tokens, limit 1, used 1455, scope run}`, lỗi "maxTokens reached — used 1455 of 1", settle `cancelled` sau 9,2 s, CLI chết | `diag-limits.mjs` |
| Limit theo cây (root + worker, `maxTokens: 2000`) | manager + dispatch | root và worker đều `cancelled`, đều `limitHit` (root 13.310, worker 11.855 token), cả hai CLI chết | `treeLimit` |
| Phục hồi sau khi engine chết giữa lượt | kill cứng engine → khởi động lại | CLI chết ngay; boot lại ghi event "onni restarted — resuming the interrupted task from its last session", run `queued`, 1 CLI mới; cancel → `cancelled` | `recovery` |
| Terminal + agent cùng lúc bị engine chết | engine hard-kill | cả hai cây chết trong 251 ms | §1.2(c) |

**Còn một luồng cần agent thật:** một manager agent tự gọi `onni task create` trong prompt. Route
dispatch đã được gọi trực tiếp (đúng như comment trong route nói: con người hay script gọi cũng cùng
một đường), nhưng hành vi "agent đọc prompt rồi tự dispatch" chưa chạy với CLI thật.

## 5. Phụ thuộc shell

- Sản phẩm tự dò Git for Windows bash (`core/bash-path.ts:85`, dùng ở runner/worktree/landing/index) —
  không cần POSIX shell trên PATH. Bằng chứng Phase 4: 6 suite từng thuộc nhóm C đạt **103/103** khi
  `bash` không tồn tại.
- Keeper dùng **Windows PowerShell**, không dùng `sh`; C-05/C-06 không thêm phụ thuộc shell mới.
- `.ai/scripts/test-env-up.sh` / `down.sh` là sh thuần: đã thêm một dòng vào `AGENTS.md` (commit
  `9c646db`) rằng phải chạy trong Git Bash. Không đổi code.

## 6. Rủi ro còn lại

1. **EPERM khi ghi đồng thời `agent-accounts.json` (đã chấp nhận).** 8 tiến trình × 100 vòng: rename
   trần 16,6% lỗi (133/800); đường sản phẩm (khoá trong tiến trình + rename retry 8 lần, ~1,01 s) còn
   **0,25% (2/800)**. Retry chỉ trả giá khi đụng độ thật; mất dòng khi nhiều **tiến trình** cùng ghi là
   hành vi đã ghi rõ ("last writer wins") trong `workspace/agent-accounts.ts`.
2. **Job của run sống tới khi engine thoát (đánh đổi đã chốt).** Một run xong không terminate job: con
   cháu `detached` do run đó cố ý bỏ lại (watcher, daemon) sống tới khi engine thoát. Engine sống lâu
   tích một job/run (handle + bộ nhớ nhỏ); đây là giá của việc "engine chết là sạch hết".
3. **Keeper là tiến trình thường trú.** ~71 MB working set, 430 ms lần đầu; nếu PowerShell bị chặn,
   C-05/C-06 quay lại hành vi cũ (rò rỉ khi cha chết) chứ không làm hỏng spawn.
4. **Một ca chưa tái hiện.** Lượt tree-cancel đầu tiên còn 1 CLI sống >30 s; ba lượt sau (gồm lượt đầy
   đủ) đều 0 CLI sống trong ~1 s. Ghi nhận là ca một lần, không phải lỗi đã xác nhận.
5. **Worktree `69853cdc` biến mất** trong các lần engine boot (retention/prune); branch `onni/69853cdc`
   còn. Hai branch cũ `onni/1333251c`, `onni/73af0205` không bị đụng. Các worktree/branch do probe tạo
   đã được dọn; `git worktree list` không còn mục `onni/`.
6. **State probe trong repo.** `.ai/onni/runs` có ~57 bản ghi run của probe (tất cả đã terminal); không
   xoá vì là state của repo — có thể archive trong UI nếu muốn gọn.
7. **Toàn suite chưa chạy trong sandbox** (theo quy tắc). Trên Windows native, phần lớn fail còn lại là
   môi trường (`EPERM`, `chmod`, `/bin/sh`, đường dẫn POSIX); CI là trọng tài.
8. **Chưa kiểm bằng agent thật**: luồng manager tự dispatch (§4) và chất lượng output của CLI thật.

## 7. Checklist trên máy thật

Chạy tại `D:\Multi Agent`, PowerShell cho §7.1–7.2.

### 7.1 Toàn suite, không có `sh` trên PATH

Bỏ `C:\Program Files\Git\usr\bin` (và mọi thư mục có `sh.exe`) khỏi PATH của phiên PowerShell, xác nhận:

```powershell
where.exe sh   # phải báo không tìm thấy
npm test -- --reporter=json --outputFile=.tmp/phase5/vitest-powershell.after.json
```

Kỳ vọng: chỉ còn test bị ảnh hưởng môi trường và guard năng lực; không còn nhóm C/D. Gửi lại file JSON
để đối chiếu với bảng phân loại Phase 4 (452 fail).

### 7.2 Bốn file B-class trong một lượt

```powershell
npm test -- packages/work/src/workflows/run.test.ts packages/work/src/worktree-lifecycle/coordinator.test.ts packages/work/src/git-worktree.test.ts packages/work/src/workflows/landing-lifecycle.test.ts
```

Kỳ vọng: `4 passed`, khoảng 283 test (282 pass + 1 skip nền tảng), ~95 s.

### 7.3 Các cổng còn lại

```powershell
npm run typecheck
npm run test:unit      # cần WSL hoặc để CI chạy: /bin/sh không có trên Windows native
npm run test:package
npm run build
```

### 7.4 Tái hiện 1d (engine chết cứng)

```powershell
node .tmp/phase5/engine-hardkill-real.mjs
```

Kỳ vọng: JSON kết thúc bằng `"verdict": "stopped"`, `killedInMs` khoảng 250–700; script tự dọn
worktree + branch của probe.

### 7.5 Tray Quit

1. Mở Onni Work, tạo task `mock:slow`, bấm Cancel (để lại tiến trình con).
2. Mở một terminal trong task, chạy `ping -t 127.0.0.1`.
3. Tray → Quit.
4. Chạy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".tmp\phase5\post-quit-check.ps1"
```

Kỳ vọng: `KET QUA: PASS` — cả năm mục rỗng, gồm mục 4 (không còn `job-keeper.ps1`). Mục 3 liệt kê mọi
cổng node đang LISTEN, kể cả app node khác; chỉ coi là rò rỉ nếu PID thuộc Onni.

### 7.6 NSIS — build từ checkout sạch, cài và gỡ

Build từ commit đã review, không dính thay đổi đang dở:

```powershell
git worktree add ..\onni-release-clean HEAD
cd ..\onni-release-clean
npm install
npm run build
cd packages\desktop
npm install
npm run build:windows
```

Lấy installer trong `.tmp\desktop-artifacts\` của worktree đó, sau đó:
cài → mở app → tạo task dry-run → Quit → kiểm Programs list và `%LOCALAPPDATA%` → gỡ → xác nhận
`~/.onni` (config, registry) được giữ.

## 8. Lệnh đã chạy trong sandbox (để đối chiếu)

```text
node --import tsx .tmp/phase4/sim-terminal-tree.mjs                  # 4/4 stopped
node --import tsx .tmp/phase5/engine-hardkill-real.mjs               # stopped, 251 ms
node .tmp/phase5/dynamic-flows.mjs                                   # parallel + manager/worker
node .tmp/phase5/tree-limits-recovery.mjs                            # tree limit + recovery
node .tmp/phase5/diag-limits.mjs                                     # limit theo run
npm test -- <4 file B-class>                                         # 282 pass + 1 skip, 94,91 s
powershell -File .tmp/phase5/post-quit-check.ps1                     # PASS sau khi dọn
```

## Phụ lục — commit trong đợt

- `506ac24` — `feat(process): own engine children in a windows job keeper` (C-05 + C-06, 14 tệp).
- `fd17a09` — `test(server): retire the §2 route-inventory drift guard` (D, phương án b).
- `9c646db` — `docs(qa): note the test-env scripts need git bash on windows`.

Tám ADR đã xoá từ trước (`docs/adr/0001`–`0008`) vẫn để nguyên, không đụng.
