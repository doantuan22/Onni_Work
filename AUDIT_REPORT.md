# Báo cáo hiện trạng Onni Work — Giai đoạn 4

Cập nhật: 02/11/2026. Phạm vi: phân loại toàn bộ test fail trên Windows, làm các suite lõi chạy thật, điều tra phụ thuộc shell và các lỗi sản phẩm nghi ngờ.

## Kết luận

**Đã phân loại 100% test fail của cả hai bản chụp; 59 suite lõi trước đây fail nay chạy riêng đều đạt, trừ một guard tài liệu (D).** Chưa kết luận READY vì còn hai việc chỉ làm được trên máy người dùng: chạy lại toàn bộ suite và kiểm tra tray Quit.

- Hai bản chụp: PowerShell **452 test fail / 90 file / 214 suite**; có `sh` trên PATH **419 / 87 / 209**. Cùng 12.609 test.
- Phân loại: PS **A 87, B 281, C 82, D 2**; SH **A 62, B 334, C 21, D 2** (100%, không còn "?").
- 59 suite từng fail: chạy riêng lần lượt **68 lượt đạt**, chỉ `bc-route-inventory` còn 2 test fail (D).
- Bỏ hẳn bash khỏi PATH, 6 suite từng thuộc nhóm C vẫn đạt **103/103 test** — sản phẩm không còn cần POSIX shell để chạy.
- Lỗi sản phẩm Windows đã sửa trong đợt này: C-07 (phân loại teardown), C-08 (marker lifecycle + barrier), C-09 (`waitForExit` chờ 27 giây sau khi kill). C-05 và C-06 đã có bằng chứng, chưa sửa vì cần quyết định thiết kế.

## 1. Phân loại 100% test fail

| Lớp | Nghĩa | PS | SH |
| --- | --- | ---: | ---: |
| A | Test giả định POSIX (spawn `mkdir/ln/sed/chmod`, đường dẫn `/`, PID âm) | 87 | 62 |
| B | Tài nguyên/thời gian/teardown: chạy riêng thì đạt | 281 | 334 |
| C | Lỗi sản phẩm trên Windows (đã sửa, trừ C-05/C-06) | 82 | 21 |
| D | Test lỗi thời so với tính năng/tài liệu đã đổi | 2 | 2 |
| | **Tổng** | **452** | **419** |

Cách lập, có thể kiểm lại từ `.tmp/phase4/final-classification.{tsv,json}`:

1. Chuẩn hóa đường dẫn và gom test fail từ hai JSON thành `corpus-powershell.json` (452 dòng) và `corpus-with-sh.json` (419 dòng).
2. Gán lớp theo dấu hiệu lỗi (`.tmp/phase4/classify-final.mjs`): A theo lệnh/đường dẫn POSIX; B theo `EPERM`/`EBUSY`/`STACK_TRACE`/hết giờ/`condition not met`; C theo "thân test fail ở PS nhưng bản SH cùng tên fail ở teardown" (chứng cứ sản phẩm spawn bash trơn thất bại khi PATH không có `sh`), cộng danh sách file đã sửa sản phẩm; D theo file guard tài liệu.
3. Kiểm chứng bằng chạy riêng: `.tmp/phase4/run-isolated.sh` (30 suite) và `run-isolated2.sh` (39 suite), mỗi suite một tiến trình vitest, timeout mặc định. Kết quả ở `isolated-verdicts.txt` / `isolated-verdicts2.txt`. Mọi suite từng bị xếp "chưa rõ" đều đạt khi chạy riêng nên được tính B.

Mười file fail nhiều nhất (PS):

| File | PS fail | Lớp chính | Sau khi sửa (chạy riêng) |
| --- | ---: | --- | --- |
| `workflows/run.test.ts` | 67 | B 65, C 1, A 1 | 176/176 đạt |
| `worktree-lifecycle/coordinator.test.ts` | 25 (PS) | A 3, B 16, C 6 | 33 đạt, 1 bỏ qua theo năng lực |
| `git-worktree.test.ts` | 25 | B 23, C 2 | đạt |
| `graph-system-nodes.test.ts` | 22 | C 16, B 6 | 22/22 đạt |
| `workflows/worktree-lifecycle.test.ts` | 19 | A 5, B 7, C 7 | 19/19 đạt |
| `landing-lifecycle.test.ts` | 12 | B 12 | đạt |
| `create-project.test.ts` | 12 | C 12 | 18/18 đạt |
| `fs-browse.test.ts` | 11 | A 11 | 15/15 đạt |
| `worktree-lifecycle/executor.test.ts` | 10 | A 10 | 11/11 đạt |
| `secrets.test.ts` | 8 | C 8 | đạt (kèm 63 test chạy không có bash) |

Nhóm A không bị bỏ qua: các fixture POSIX được đổi sang hành vi tương đương trên Windows (thư mục đặt ở vị trí file, file đặt ở vị trí thư mục thay cho `chmod`, `posixPath()` cho kỳ vọng dấu `/`, tạo thư mục bằng `mkdirSync`). Chỗ thuần POSIX (tín hiệu nhóm tiến trình âm) được kiểm bằng nhánh Windows ngay trong test, không dùng `.skip/.only`.

## 2. Phụ thuộc shell

- Sản phẩm tự dò Git for Windows bash trong `packages/work/src/core/bash-path.ts:85` (`resolveBash`), dùng ở `workflows/run.ts:9047`, `worktree-lifecycle/executor.ts:144`, `workflows/landing.ts:59`, `index.ts:603` (commit `5ea93e4`).
- Bằng chứng động: chạy thẳng vitest với PATH không có `bash` (`node -e "execFileSync('bash')"` → ENOENT) cho 6 suite từng thuộc nhóm C:

```
graph-system-nodes, create-project, secrets, open-in-app, workspace-semaphore, graph-run
→ Test Files 6 passed, Tests 103 passed
```

- Trong lúc điều tra, `graph-run.test.ts:251` còn tự spawn `mkdir -p`; đã đổi sang `mkdirSync` (commit `d476803`) và suite đạt 7/7 khi không có bash.
- Còn phụ thuộc shell có chủ đích: hook `pre-push` dùng `#!/bin/sh` (git tự cấp sh), và các script phát triển `.ai/scripts/*.sh` (chạy dưới Git Bash — đã ghi trong AGENTS.md). Đây không phải đường chạy của sản phẩm.

## 3. Suite lõi: trước → sau

Trước là số test fail trong bản chụp (PS / có sh); sau là chạy từng suite một.

| Suite | Trước (PS/SH) | Sau |
| --- | ---: | --- |
| `workflows/run.test.ts` | 67 / 68 | 176 đạt |
| `workflows/graph-system-nodes.test.ts` | 22 / 22 | 22 đạt |
| `server/create-project.test.ts` | 12 / 12 | 18 đạt |
| `server/open-in-app.test.ts` | 5 / 5 | 31 đạt |
| `server/fs-browse.test.ts` | 11 / 11 | 15 đạt |
| `workflows/worktree-lifecycle.test.ts` | 19 / 12 | 19 đạt |
| `worktree-lifecycle/coordinator.test.ts` | 25 / 23 | 33 đạt (+1 bỏ qua theo năng lực) |
| `worktree-lifecycle/executor.test.ts` | 10 / 6 | 11 đạt |
| `server/terminal/sessions-tree.test.ts` | 5 / 5 | 7 đạt |
| `core/disclaim-spawn.test.ts` | 4 / 4 | 7 đạt (+1 bỏ qua) |
| `core/claude-cli-runner.test.ts` | 1 / 1 | 26 đạt |
| `workspace/agent-accounts.test.ts` | 1 / 1 | 25 đạt |
| `workspace/home-safety.test.ts` | 1 / 1 | 6 đạt |
| `server/bc-route-inventory.test.ts` | 2 / 2 | **2 fail (D)** |

Tổng 59 suite từng fail: trước **349 fail (PS) / 312 fail (có sh)**; sau chỉ còn 2 test của guard D.

## 4. Lỗi sản phẩm

### C-05 — Không có Job Object ngoài desktop: tiến trình con sống sót

Desktop gán sidecar vào Job Object `KILL_ON_JOB_CLOSE` (`packages/desktop/src-tauri/src/lib.rs:1058-1114`). Engine không có: nó dựa vào `taskkill /T` (`core/antigravity-runner.ts:173`), mà `/T` đi theo cây **parent PID**. Khi cha chết trước (shim thoát, worker test chết, app bị đóng mạnh), con mồ côi và không còn gì để kill.

Bằng chứng sống: một `node.exe` chạy `mock-claude.mjs` (PID 27568) còn sống với **cha 29088 đã chết**, cwd trong `%TEMP%\onni-start-now-Qcvwl3` — rò rỉ từ chính suite start-now. Đã dọn thủ công. Đây là lỗi sản phẩm (C), không phải lỗi test.

### C-06 — Terminal: con cháu `detached` sống sót sau Stop/closeAll

Chạy `TerminalSessions` thật với node-pty + cmd.exe (`.tmp/phase4/sim-terminal-tree.mjs`, kết quả `.tmp/phase4/sim-terminal-tree.out.txt`):

```
kill-direct          before [22204]          after []            stopped
kill-detached        before [24888]          after [24888]       KHÔNG dừng
kill-orphan-attached before [31944, 36480]   after []            stopped
closeAll-detached    before [15280]          after [15280]       KHÔNG dừng
```

Chú thích ở `server/terminal/sessions.ts:25-26` nói `kill()` "terminates the job object node-pty created"; thực tế chỉ đúng với con cháu chưa tách. Một lệnh trong terminal spawn tiến trình `detached` (watcher, daemon) sẽ sống tiếp sau khi dừng terminal hoặc lưu trữ task. Muốn sửa cần Job Object cho terminal hoặc quét cây theo WMI — là thay đổi thiết kế, cần quyết định.

### C-07 — Exit do tín hiệu bị coi là lỗi agent

`isSignalTerminationExit`/`terminationLabel` trong `core/agent-runner.ts:104-134` nay nhận dạng đúng `exitCode` null + `signalCode` (Windows `kill()` = TerminateProcess, handler không chạy). Commit `b9c397b`. Kèm theo: lượt claude bị đóng UI không có frame `result` được đóng đúng cách.

### C-08 — Marker lifecycle và barrier

`8c12ca7` giữ dòng trống phân cách marker trên stderr khỏi khung output; `cd264b3` chịu được thư mục đã biến mất trong barrier ghi bền.

### C-09 — `waitForExit` chờ hết cửa sổ an toàn sau khi process đã chết

Tám bản `waitForExit` đều mở bằng `if (child.exitCode != null)`. Trên Windows, tiến trình bị kill có `exitCode` null và chỉ có `signalCode`, nên guard trượt và promise chờ một sự kiện `close` đã bắn rồi — với claude là **27 giây** (`8s + 4s + 10s + 5s`, `claude-cli-runner.ts:44-48,651`). Người dùng thấy lượt "Stop" treo lâu.

Đã sửa: thêm `hasTerminated()` dùng chung (`core/agent-runner.ts:152`) cho cả 8 bản. Test hồi quy trong `claude-cli-runner.test.ts` đỏ trước khi sửa (`"timeout"` thay vì `null`) và xanh sau. Commit `ca8532b`. 9 suite runner liên quan: **137/137 đạt**.

### 4.1 Stress ghi đồng thời `agent-accounts.json`

8 tiến trình × 100 vòng trên cùng `ONNI_HOME`, cùng máy (`stress-agent-accounts.mjs`):

| Nhánh | Ghi thành công | EPERM | Tỉ lệ lỗi |
| --- | ---: | ---: | ---: |
| rename trần (naive) | 667 | 133 | **16,6%** |
| đường sản phẩm (khoá trong tiến trình + rename có retry) | 798 | 2 | **0,25%** |

Đã rà toàn bộ writer: 10 file dùng `atomicWriteJsonSync`/`renameSyncWithRetry` (`fs-rename.ts:41`, retry 8 lần, tổng ~1,01 giây, chỉ trên win32, chỉ cho `EPERM/EACCES/EBUSY`). Giữ retry thay vì serialize toàn cục: retry chỉ trả giá khi đụng độ thật, còn khoá liên tiến trình sẽ biến mọi lần đọc thành chờ. 2 EPERM còn lại nằm ngoài ngân sách retry dưới 8 writer; mất dòng khi nhiều **tiến trình** cùng ghi là hành vi đã ghi rõ trong `workspace/agent-accounts.ts` ("across processes … last writer wins"), không phải lỗi mới. Trong một tiến trình (Settings + bắt đầu run) thì khoá tuần tự bảo đảm không mất.

### 4.2 Nguồn EPERM/EBUSY khi teardown

Thủ phạm cụ thể không phải "Windows chậm" mà là **tiến trình còn sống giữ thư mục fixture làm cwd** khi test xoá nó — thường là run dry-run/agent chưa dừng hết. Cách sửa đã áp: helper dùng chung `test-fixtures/remove-temp-dir.testkit.ts` (chờ, thử lại, bỏ qua đúng mã) và từng suite dừng run trước khi xoá (`3a61ee3`, `4da62b9`, `41c1b05`, `569905f`, `9813c36`, …). Không phát hiện tiến trình nào sống sót sau `dispose()` trong sản phẩm; cái sống sót là khi **cha chết** — đúng C-05.

### 4.3 Terminal thật

Đã chạy mô phỏng ở C-06. Phần tray Quit vẫn cần người dùng bấm tay; script kiểm tra đã chuẩn bị: `.tmp/phase4/tray-quit-check.ps1` (liệt kê Onni Work/sidecar, agent còn sống, cổng node đang LISTEN, và `index.lock` còn trong worktree). Cách dùng ghi ở đầu file.

## 5. Còn lại và quyết định cần người dùng

1. **D — `bc-route-inventory` (2 test).** Guard đối chiếu route thật với danh sách "Routes:" ở §2 của `BACKWARD_COMPATIBILITY.md`. Danh sách đó đã bị xoá khi viết lại tài liệu (commit `1cc14e0`); §2 giờ chỉ còn nguyên tắc, nên guard không còn gì để so. Ngoài ra guard đọc tiêu đề §2 bằng chuỗi cứng `'## 2. HTTP API'` trong khi tiêu đề đã thành "… of the cockpit server", khiến nó cắt sai đoạn văn. Hai lựa chọn:
   - (a) Khôi phục danh sách route trong §2 (khoảng 180 dòng, sinh từ `app.routes`) và sửa guard neo theo số mục — giữ được cam kết "bề mặt được bảo vệ".
   - (b) Bỏ guard này, dựa vào `route-parity`, `versioned-surface`, `typed-bodies`, `contract-parity` — các test này đã bắt drift cơ học.
   Bản vá neo đã lưu ở `.tmp/phase4/bc-anchor.patch` để dùng cho (a).
2. **C-05/C-06 — Job Object.** Có cần đưa Job Object xuống engine (terminal + agent runner) thay vì chỉ desktop không? Đây là thay đổi thiết kế; báo cáo dừng ở đây để chờ quyết định.
3. **test-env launcher.** `.ai/scripts/test-env-up.sh`/`down.sh` là sh thuần; trên Windows phải chạy trong Git Bash. Cần một dòng trong tài liệu QA (không cần đổi code). Chưa thêm vì đụng tài liệu dùng chung.

## 6. Lệnh cần chạy trên máy thật (không chạy trong sandbox)

```bash
npm run typecheck
npm test
npm run test:unit
npm run build
npm run test:package
```

Chạy thêm một lần không có `sh` trên PATH để xác nhận kết quả sau sửa (PowerShell, đã bỏ `C:\Program Files\Git\usr\bin`):

```powershell
npm test -- --reporter=json --outputFile=.tmp/vitest-powershell.after.json
```

Kỳ vọng: chỉ còn 2 test của `bc-route-inventory` (D) và các test được bảo vệ bằng kiểm tra năng lực. Sau khi chạy, gửi lại file JSON để đối chiếu với bảng phân loại.

## Phụ lục — commit trong đợt

- Sản phẩm: `5ea93e4` dò Git Bash; `b9c397b` phân loại teardown; `8c12ca7` marker lifecycle; `cd264b3` barrier ghi bền; `ca8532b` `waitForExit` nhận exit do tín hiệu; `2cab54b` đường dẫn worktree ổn định.
- Test/fixture: `1e82b4c`, `cd2d3f6`, `34e702d`, `3bffad3`, `4170e14`, `3a61ee3`, `bc72957`, `b48b7c6`, `61ad009`, `f166302`, `fdabfbf`, `ba2af50`, `96bde86`, `ae3ac96`, `41c1b05`, `569905f`, `4da62b9`, `2d5d1f1`, `76eaee6`, `b737e01`, `58bfce2`, `e3477dd`, `d476803`.
