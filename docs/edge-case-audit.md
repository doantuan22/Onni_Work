# Edge-case audit — ghi nhận lỗi

- **Nhánh:** `test/edge-case-audit`
- **Ngày bắt đầu:** 2026-11-04
- **Phương pháp:** không chạy lại test có sẵn. Đọc mã để hiểu luồng xử lý, suy ra trường biên, đặt giả thuyết, rồi viết probe chạy thật để xác nhận hoặc bác bỏ. Lỗi thật được sửa theo thứ tự: test hồi quy (xác nhận đỏ) → sửa → test xanh → commit riêng.
- **Môi trường:** Windows 11, Git Bash, Node 24, `ONNI_DRY_RUN=1` khi cần chạy app.

Tệp này là sổ cái: mỗi vòng đào thêm sẽ bổ sung mục mới ở cuối, không sửa lại các mục cũ.

## Tóm tắt

| # | Mức | Khu vực | Lỗi | Trạng thái | Commit |
|---|---|---|---|---|---|
| E1 | Trung bình | Lịch automations / giờ chờ usage-limit | Giờ hẹn rơi vào khoảng nhảy DST chạy sớm 1 giờ ở ~70 múi giờ; lịch `hours` trả instant trùng | Đã sửa | `20a6cd9` |
| E2 | Trung bình | Cấu hình | `config.json` lưu BOM / UTF-16 bị bỏ qua âm thầm | Đã sửa | `16ef0f7` |
| E3 | Thấp–Trung bình | Push guard | `GIT_CONFIG_COUNT` lớn làm treo server; chỉ số khuyết làm hỏng mọi lệnh git trong run | Đã sửa | `c9dcf0d` |
| E4 | Thấp | Workflow `if` node | `**/` trong glob khớp nhầm tên file có tiền tố | Đã sửa | `478781d` |
| E5 | **Cao** | Merge của manager | Worktree đã checkout nhánh khác / detached HEAD: `main` bị đẩy tới commit của nhánh kia, báo cáo vẫn ghi `onni/<task>` | Đã sửa | `5ee3cd9` |
| E6 | Trung bình | Landing in-place | Timeout 10 phút của check không bao giờ giải phóng landing khi check bị treo | Đã sửa | `6909d3d` |
| E7 | Trung bình | Dispatch / ngân sách | Sai số dấu phẩy động làm từ chối child xin đúng phần ngân sách còn lại ("requested $0.80 but only $0.80 left") | Đã sửa | `57b05bb` |
| E8 | Trung bình | Lưu trữ run | `readEventsTail` làm hỏng ký tự nhiều byte nằm ngang ranh giới chunk 64 KiB (đuôi transcript mà manager `peek`) | Đã sửa | `e5f0a9a` |
| E9 | Thấp–Trung bình | Đặt tên nhánh | `sanitizeBranchName` trả tên mà git từ chối (`yarn.lock-`, `.lock` sau khi cắt độ dài, `HEAD`); lỗi bị nuốt, quy ước đặt tên bị bỏ qua âm thầm | Đã sửa | `5af07d1` |
| E10 | Thấp | Output của check | Giải mã từng chunk làm hỏng ký tự nhiều byte bị cắt giữa hai chunk pipe (phòng ngừa, không tái hiện được trên máy này) | Đã sửa | `75a4294` |
| E11 | Trung bình | Runner (đọc NDJSON) | Một dòng rất dài đến thành nhiều chunk tốn thời gian bình phương, chặn event loop (32 MB ≈ 2 s, 64 MB ≈ 8 s) | Đã sửa | `34aa31b` |
| E12 | **Cao** | Runner claude / codex / junie | Dòng JSON hợp lệ nhưng không phải object (`null`, `42`, `true`) làm cả phiên thất bại với `TypeError` | Đã sửa | `1dbc74a` |
| E13 | Thấp | Nhập ẩn `secrets-cli` | Giải mã từng chunk và xoá lùi theo đơn vị UTF-16 làm hỏng ký tự nhiều byte / emoji (đỏ trước sửa) | Đã sửa | `e407039` |
| E14 | Thấp | stderr của cursor / antigravity | Giải mã từng chunk làm thông báo lỗi chứa `U+FFFD` (đỏ trước sửa, tiến trình thật) | Đã sửa | `6283590` |
| Q1 | **Cao** | Chi phí claude | `total_cost_usd` cộng dồn theo phiên nhưng bị cộng dồn thêm: step nhiều lượt / Continue tính dư (đỏ trước sửa, số liệu CLI thật; xem Vòng 2) | Đã sửa | `eb650d9` |
| E12b | — | Test runner | Test cho codex / junie / opencode qua hàm thuần (chỉ phòng ngừa, đỏ khi hoàn nguyên E12) | Đã thêm | `4f7f20a` |
| E7b | — | Test ngân sách | `toBeCloseTo` thay bằng `toBe` (chỉ phòng ngừa) | Đã sửa | `4393f70` |

## E1 — Giờ hẹn trong khoảng nhảy DST chạy sai bên

- **Vị trí:** `packages/contract/src/zoned-time.ts` (`zonedWallTimeToUtc`), `packages/contract/src/automation-schedule.ts` (`occurrencesBetween`).
- **Nguyên nhân:** hàm lặp cố định 3 bước để tìm offset. Với giờ không tồn tại (spring-forward) vòng lặp dao động giữa hai instant và dừng ở bên nào tuỳ thuộc dấu của offset múi giờ; với giờ lặp lại (fall-back) nó chọn lần thứ hai.
- **Tái hiện:** `daily 02:30` ngày chuyển giờ: New York chạy 03:30 (đúng), Berlin chạy **01:30**, Sydney chạy 01:30, Cairo `00:30` chạy 23:30 hôm trước. Chạy thuộc tính trên 418 múi giờ IANA × 2 năm × 7 dạng lịch: 74 múi giờ chạy sớm, 258 trường hợp instant trùng ở lịch `hours`, 2 trường hợp sai thứ tự (Antarctica/Troll).
- **Tác động:** tác vụ theo lịch chạy sớm 1 giờ đúng đêm chuyển giờ; lịch/rail trong cockpit hiện mục trùng; log `catch-up` đếm sai số lần bỏ lỡ; giờ chờ usage-limit cũng dùng hàm này.
- **Vì sao test cũ không bắt được:** test hiện có chỉ khẳng định "gần khoảng nhảy" nên vẫn xanh khi lỗi tồn tại.
- **Cách sửa:** lấy offset trước và sau giờ hẹn 1 ngày làm hai ứng viên. Cả hai đọc ngược đúng giờ hẹn = giờ lặp lại, lấy lần đầu. Không có ứng viên nào = khoảng nhảy, dùng offset trước khoảng nhảy (RFC 5545), kết quả nằm sau khoảng nhảy. `occurrencesBetween` chỉ liệt kê instant tăng nghiêm ngặt.
- **Kiểm chứng sau sửa:** 0 trùng, 0 sai thứ tự, 0 sai số lượng trên toàn bộ lưới; 10 test hồi quy mới.
- **Hành vi cần biết:** giờ hẹn gần nửa đêm có thể chạy sang ngày kế (Greenland 23:30 → 00:30). Đó là quy ước chuẩn, không phải lỗi.

## E2 — File JSON viết tay lưu BOM / UTF-16 bị bỏ qua không cảnh báo

- **Vị trí:** `packages/work/src/config.ts` (3 chỗ), `packages/work/src/fs-rename.ts` (`readFileWithRetry`, dùng cho `~/.onni/config.json` và ui-state), `packages/work/src/planner.ts`.
- **Nguyên nhân:** Windows PowerShell 5.1 lưu `>` / `Out-File` là UTF-16LE và `Set-Content -Encoding UTF8` có BOM. `JSON.parse` từ chối cả hai; mọi nơi đọc đều nuốt lỗi và rơi về mặc định.
- **Tái hiện:** `.ai/onni/config.json` = `{"worktreeRetention":3}`: UTF-8 thường cho 3, UTF-8+BOM và UTF-16LE cho 10 (mặc định), không có cảnh báo nào.
- **Tác động:** cài đặt của người dùng biến mất âm thầm. Với `~/.onni/config.json` còn nguy hiểm hơn: file bị coi là hỏng, nếu không có `.bak` thì registry dự án có thể bị ghi đè ở lần ghi kế tiếp.
- **Cách sửa:** `packages/work/src/text-decode.ts` (`decodeText`, `readTextFile`) nhận UTF-8 BOM, UTF-16LE và UTF-16BE, không bao giờ ném lỗi. Chỉ áp dụng cho file người dùng tự sửa; file do onni ghi vẫn là UTF-8 thường.
- **Kiểm chứng:** 4 test hành vi (cấu hình thật qua `loadConfig`, `readFileWithRetry`) đỏ trước sửa, xanh sau sửa.

## E3 — `pushGuardEnv` và `GIT_CONFIG_COUNT`

- **Vị trí:** `packages/work/src/workflows/push-guard.ts`.
- **Nguyên nhân:** vòng lặp đồng bộ theo `GIT_CONFIG_COUNT` do môi trường cung cấp, parse bằng `parseInt` (chấp nhận `3abc`, `1e3` thành 1); các cặp kế thừa giữ nguyên chỉ số nên chỉ số khuyết để lại lỗ hổng, mà git từ chối một COUNT có `KEY_n` thiếu.
- **Tái hiện:** `GIT_CONFIG_COUNT=999999999` làm hàm chạy hơn 100 giây (chặn event loop của server). `COUNT=2` chỉ có `KEY_0` làm mọi lệnh git trong run lỗi `missing config key`.
- **Cách sửa:** chỉ chấp nhận số thập phân thuần, tối đa 1000 (lớn hơn coi như không hợp lệ); đánh số lại các cặp kế thừa liên tục.
- **Kiểm chứng:** test dùng git thật để đọc `core.hooksPath`; các test "hostile" treo khi chưa sửa, trả lời dưới 250ms sau khi sửa.
- **Giới hạn đã biết:** vẫn là một rào chắn, không phải sandbox (`--no-verify` đi qua được, đúng như mô tả trong AGENTS.md).

## E4 — `**/` trong glob của node `if`

- **Vị trí:** `packages/work/src/workflows/graph.ts` (`globMatch`).
- **Nguyên nhân:** `**/` được dịch thành `.*`, nuốt luôn dấu `/` nên ký tự literal kế tiếp có thể bắt đầu giữa tên file.
- **Tái hiện:** `**/package.json` khớp `my-package.json`; `src/**/x.ts` khớp `src/foox.ts`; `**/migrations/**` khớp `db/my-migrations/001.sql`.
- **Cách sửa:** `**/` dịch thành `(?:.*/)?` (không hoặc nhiều thư mục nguyên vẹn).
- **Kiểm chứng:** 12 trường hợp tham số hoá, 4 trường hợp đỏ trước sửa.

## Đã kiểm tra, không phải lỗi hoặc không sửa

| Khu vực | Kết luận |
|---|---|
| Tên file đính kèm kiểu Windows (`con.backup.txt`, `COM¹`, `CONIN$`) | Bộ lọc chỉ so cả stem nên chưa nhất quán với ý định ghi trong mã, nhưng Windows/Node trên máy kiểm tra không biến chúng thành thiết bị. Chưa có tác hại tái hiện được. |
| `globMatch` với nhiều dấu `*` | Backtracking tăng nhanh (10 dấu × 30 ký tự ≈ 0.5s) nhưng chỉ khi tác giả workflow viết glob như vậy. Không sửa. |
| `parseRemote` | Đường dẫn ổ đĩa `C:/…` cho host `c`, `x:p@ss@host` cho host `ss@host`, IPv6 cho host `https`. Mọi nơi dùng đều chặn bằng `isGithubHost` và dựng lại URL từ `{host, owner, repo}`, nên fail-closed. |
| `limits.ts` | Schema chặn 0, NaN, âm; `carveChildLimits` được bảo vệ bởi tổng của cây ở root. |
| `pushBranch`, `isSafeGitRef` | Có chặn ký tự mở đầu `-` và `+`, refspec cùng tên hai phía. |
| `uploads.ts`, `readUpload` | Mở một descriptor cho cả kiểm tra TTL và đọc; ID kiểm bằng regex. Không thấy lỗi. |
| `windows-read-private-file.ps1` | Kiểm kích thước hai lần, từ chối reparse point ở thành phần cuối. Các thành phần giữa đường dẫn vẫn được đi theo (đúng như tài liệu hoá). |
| `shortAge`, `compactTokens` | Đúng ở mọi biên thử (âm, NaN, ranh giới đơn vị). |

## E5 — Merge của manager tác động lên nhánh sai

- **Vị trí:** `packages/work/src/workflows/manager-merge.ts` (`runManagerMerge`), gọi từ `RunManager.mergeFromAgent`.
- **Nguyên nhân:** cả hai chế độ (`into: task`, `into: base`) hành động trên HEAD của worktree nhưng không kiểm HEAD có đang ở `taskBranch` không. Chính `git-diff-base.ts` đã ghi rõ agent có thể checkout nhánh khác trong worktree (mọi run `review/pr-N` đều làm vậy).
- **Tái hiện (git thật):** worktree manager có commit trên `onni/mgr`, sau đó checkout `review/pr-9` (hoặc detached) và commit thêm. `into: base` trả `merged`, thông điệp "main fast-forwarded to onni/mgr", nhưng `main` thực tế bị đẩy tới commit của **nhánh khác**; commit của manager không hề được merge.
- **Tác động:** nhánh chính bị đổi sang commit ngoài ý muốn, kèm nhật ký (ledger) sai. Chỉ xảy ra khi bật "Full quyền manager" (mặc định tắt) và manager tự checkout nhánh khác, nhưng hậu quả là sai lệch âm thầm trên nhánh chính.
- **Cách sửa:** trước khi merge, đọc `symbolic-ref --short HEAD`; khác `taskBranch` (kể cả detached) thì `refused` với câu hướng dẫn `git checkout <taskBranch>`. Đặt sau các nhánh `--abort` và merge-đang-dở, nên các luồng cũ không đổi.
- **Kiểm chứng:** 4 test mới (hai chế độ × nhánh khác / detached), đỏ trước sửa; 9 test cũ giữ nguyên xanh.

## E6 — Timeout của check trong landing không giải phóng được

- **Vị trí:** `packages/work/src/workflows/landing.ts` (`runShellCheck`).
- **Nguyên nhân:** hết `CHECK_TIMEOUT_MS` (10 phút) chỉ `kill('SIGTERM')` tiến trình bash. Lệnh mà bash đã khởi chạy vẫn giữ pipe stdout nên `close` không phát, Promise không bao giờ settle trước khi lệnh kia tự kết thúc.
- **Tái hiện:** cùng mẫu spawn với timeout 1 giây: `kill` gọi lúc 1s nhưng Promise chỉ settle sau 8,3s (đúng vòng đời lệnh con), cho cả ba dạng lệnh thử (lệnh trực tiếp, qua subshell, grandchild chạy nền).
- **Tác động:** một check treo (test chờ nhập, dev server) giữ landing vô thời hạn, kể cả "ràng buộc 10 phút".
- **Cách sửa:** spawn bash thành nhóm riêng trên POSIX; khi hết giờ gọi `killProcessTree` (dùng lại helper có sẵn, `taskkill /T` trên Windows) và settle ngay với câu "timed out … killed". `timeoutMs` thành tham số để test được.
- **Đã loại trừ:** `RunManager.runCheckStep` dùng `spawnTaskProcess` (Job Object trên Windows). Probe cho thấy hủy ở 1 giây thì `close` phát sau 1,03s; đường đó an toàn.
- **Kiểm chứng:** test dùng bash thật, chứng minh tiến trình con thật sự chết (kiểm bằng `process.kill(pid, 0)`); đỏ trước sửa (quá 30s).

### Bổ sung vào danh sách đã kiểm tra

| Khu vực | Kết luận |
|---|---|
| `runManagerMerge`: CAS bằng `update-ref <ref> <new> <old>`, kiểm worktree khác đang giữ nhánh base, từ chối khi checkout chính bẩn | Đúng. Chỉ thiếu kiểm HEAD (E5). |
| `spawnTaskProcess` trên Windows | Job Object kill-on-close hoạt động như thiết kế: hủy trong ~1s. |

## E7 — Làm tròn ngân sách còn lại của dispatch

- **Vị trí:** `packages/work/src/dispatch/engine.ts` (`remainingBudgetUsd`), so sánh ở `RunManager.carveChildBudget` (`maxCost > remaining`).
- **Nguyên nhân:** cộng/trừ số thực nhị phân để lại sai số: `3 − 1.1 − 1.1 = 0.7999999999999998`.
- **Tái hiện:** ngân sách 3, hai child 1.1, child thứ ba xin đúng 0.8 thì bị từ chối với thông báo "requested $0.80 but only $0.80 of the budget is left". Tương tự `0.3 − 0.1 − 0.1`, `10 − 3×3.33`.
- **Vì sao test cũ không bắt được:** các test của hàm dùng `toBeCloseTo`, che đúng loại sai số này.
- **Cách sửa:** làm tròn kết quả tới 1e-6 USD; chi phí thật dưới một cent (`0.0314`) vẫn giữ nguyên. Phần dư âm cực nhỏ thành `-0`, vẫn bị coi là hết ngân sách.
- **Kiểm chứng:** 5 test dùng `toBe` chính xác, đỏ trước sửa.

## E8 — Đuôi transcript bị hỏng ký tự nhiều byte

- **Vị trí:** `packages/work/src/runs/store.ts` (`readEventsTail`), dùng bởi `peek` của dispatch.
- **Nguyên nhân:** đọc ngược từng chunk 64 KiB và giải mã từng chunk riêng; một ký tự UTF-8 nằm ngang ranh giới thành hai `U+FFFD`.
- **Tái hiện:** 6 event, mỗi event hàng chục KB chữ `ệ`: mọi số lượng `count` thử (1–4) đều trả ít nhất một event bị hỏng so với `readEvents`.
- **Vì sao test cũ không bắt được:** phần đệm trong test cũ chỉ là ASCII.
- **Cách sửa:** ghép Buffer rồi giải mã một lần; đếm xuống dòng trên byte (không còn regex trên chuỗi tích luỹ, cũng bớt chi phí bình phương).
- **Kiểm chứng:** test tham số hoá cho ký tự 2, 3 và 4 byte; hai ca 3 và 4 byte đỏ trước sửa (ca 2 byte vô tình khớp căn lề).

## E9 — Tên nhánh do namer sinh ra bị git từ chối

- **Vị trí:** `packages/work/src/runs/auto-name.ts` (`sanitizeBranchName`).
- **Nguyên nhân:** `.lock` bị loại trước khi cắt dấu chấm/gạch ở cuối thành phần, và cắt độ dài diễn ra sau cùng, nên `yarn.lock-` → `yarn.lock` (git từ chối). `HEAD` cũng bị từ chối.
- **Tái hiện:** fuzz 1277 chuỗi với `git check-ref-format --branch` làm trọng tài: 52 tên bị từ chối. Ví dụ thực tế: `chore/update yarn.lock-`, `fix yarn.lock.`.
- **Tác động:** `git worktree add -b` thất bại, tác vụ rơi về `onni/<id8>` mà người dùng không được báo.
- **Cách sửa:** dọn từng thành phần lặp cho đến khi ổn định (loại dấu chấm/gạch đầu cuối, đuôi `.lock`), dọn lại sau khi cắt độ dài, loại `HEAD` và `@`.
- **Kiểm chứng:** 12 ca đối chiếu với git thật; 7 ca đỏ trước sửa. Chạy lại fuzz: 0/951 tên bị từ chối.

## E10 — Output của check giải mã từng chunk (phòng ngừa)

- **Vị trí:** `RunManager.runCheckStep` (`workflows/run.ts`), `runShellCheck` (`workflows/landing.ts`).
- **Nguyên nhân:** `chunk.toString('utf8')` cho từng chunk của pipe: ký tự bị cắt giữa hai chunk thành `U+FFFD`. Output này hiện cho người dùng và được gửi ngược cho agent.
- **Trạng thái tái hiện:** **không tái hiện được trên pipe Windows của máy này** (chunk không cắt ngang ký tự), nên không có test đỏ qua tiến trình thật. Đây là mẫu lỗi đã biết của Node nên vẫn sửa.
- **Cách sửa:** `core/utf8-chunks.ts` (`utf8Collector`, một `StringDecoder` cho mỗi luồng). Test tất định cắt Buffer ở mọi vị trí byte và chứng minh `toString` từng chunk tạo `U+FFFD` còn collector thì không.

### Bổ sung vào danh sách đã kiểm tra

| Khu vực | Kết luận |
|---|---|
| `dispatch/tree-fs.ts` (hộp thư, kế hoạch, brief) | `recipient` và `from` chỉ đến từ mã nội bộ nên không có đường đi xuyên thư mục. Hai thông điệp cùng người gửi, cùng chủ đề, cùng mili giây sẽ trùng tên file (khả năng cực thấp). |
| `listInbox` | So `mtime > seenAt` bằng `>`: một thông điệp đến đúng mili giây với `inboxSeenAt` có thể bị coi là đã thấy. Cửa sổ 1 ms, không sửa. |
| `secrets-cli` nhập ẩn | Giải mã từng chunk và `value.slice(0, -1)` khi xoá lùi cắt đôi cặp thay thế (emoji). Chỉ khi dán giá trị có emoji; không sửa. |
| `readEvents` đầy đủ | Đọc cả file một lần nên không bị E8. |

## E11 — Đọc một dòng NDJSON rất dài tốn thời gian bình phương

- **Vị trí:** `packages/work/src/core/ndjson.ts` (`readNdjson`, dùng bởi claude, codex, junie, cursor, pi, ACP) và `bufferedLines` trong `antigravity-runner.ts`.
- **Nguyên nhân:** nối chunk vào một chuỗi rồi `indexOf('
')`. `buffer += chunk` tạo chuỗi dạng rope và mỗi lần `indexOf` buộc V8 làm phẳng (sao chép) toàn bộ buffer, nên n chunk tốn O(n²). Bản sửa đầu tiên chỉ quét phần mới (`indexOf(…, scanned)`) **vẫn chậm** vì không tránh được việc làm phẳng; phải tránh nối chuỗi.
- **Tái hiện:** một dòng 8 MB / 32 MB / 64 MB (chunk 64 KB): 130 ms / 2059 ms / 7614 ms. Toàn bộ thời gian đó chặn event loop (SSE, WebSocket của server).
- **Tác động:** tool result lớn trong một dòng (đọc file lớn, ảnh base64) làm cockpit đứng hình. Dòng ngắn không bị ảnh hưởng.
- **Cách sửa:** tìm xuống dòng chỉ trong chunk mới; phần đầu của dòng chưa kết thúc giữ thành mảnh và chỉ `join` khi dòng kết thúc.
- **Kết quả:** 64 MB còn 57 ms (32 MB: 32 ms). Test mới gồm tính đúng khi cắt chunk ở mọi vị trí byte và test thời gian tuyến tính (đỏ trước sửa: 1930 ms > 750 ms).

## E12 — Một dòng JSON không phải object làm sập cả phiên

- **Vị trí:** vòng đọc dòng của `claude-cli-runner.ts`, `codex-app-server-runner.ts`, `junie-runner.ts` (và dữ liệu SSE của `opencode-server-runner.ts`).
- **Nguyên nhân:** `JSON.parse('null')`, `'42'`, `'true'` thành công nên vượt qua lớp chặn "dòng không parse được"; câu lệnh kế tiếp đọc `.type` / `.method` / `.id` ném `TypeError` bên ngoài try/catch hẹp, lỗi đi lên và kết thúc phiên. `pi-runner` và `acp-client` đã có `isRecord` nên không bị.
- **Tái hiện:** stub `claude` in `null`, `42`, `true`, `"…"`, `[]`, `0` rồi một frame hợp lệ: run thất bại với `TypeError: Cannot read properties of null (reading 'type')`.
- **Tác động:** một dòng lạc từ wrapper script, shell profile hay hook (`ONNI_CLAUDE_BIN` trỏ vào wrapper) là đủ giết một run đang chạy.
- **Cách sửa:** `isJsonObject` dùng chung trong `ndjson.ts`; dòng không phải object bị bỏ qua như dòng không parse được (claude còn ghi một `note`).
- **Kiểm chứng:** test dùng stub `claude` thật (đỏ trước sửa). Claude có test chạy qua tiến trình; codex và junie được sửa theo cùng cơ chế nhưng chưa có stub riêng (giao thức handshake phức tạp).
- **Đã loại trừ:** tất cả 9 bộ ánh xạ UI (`map*Message`, `map*Frame`…) chạy qua 28 giá trị lạ (null, mảng, trường sai kiểu, `__proto__`…) mà không ném lỗi: 0/252 tổ hợp.

### Bổ sung vào danh sách đã kiểm tra

| Khu vực | Kết luận |
|---|---|
| `shell-env.ts` (trích dẫn POSIX và `cmd.exe`) | Giới hạn đã được ghi rõ trong mã (`"`, `%`, `!`, `&` không có escape trên `cmd.exe`) và có cổng `isShellEmbeddable` fail-closed. Không sửa. |
| Prompt truyền qua argv của cursor | Antigravity chặn độ dài ở 24.000 ký tự; cursor thì không, nên prompt quá dài (Windows ~32 K, Linux 128 KB một đối số) chỉ cho thông báo `spawn ENAMETOOLONG`/`E2BIG`, không treo hay mất dữ liệu. Prompt bắt đầu bằng `-` có thể bị CLI hiểu là cờ nhưng **không kiểm chứng được nếu không có binary thật**, và `--` có thể không được hỗ trợ; để nguyên theo nguyên tắc không đổi cơ chế đang chạy khi chưa có bằng chứng. |
| `armInactivityDeadline` | Ngưỡng cứng là 8× cửa sổ im lặng, mặc định 30 phút nên không tới giới hạn 2³¹ ms của `setTimeout`; chờ của node bị chặn ở 1 tuần (≈604,8 triệu ms). |
| `stderr` của cursor / antigravity | Giải mã từng chunk, chỉ ảnh hưởng nội dung thông báo lỗi. Không sửa. |

## Câu hỏi mở (chưa kết luận, cần kiểm chứng với CLI thật)

### Q1 — `total_cost_usd` của Claude là cộng dồn theo phiên hay theo lượt?

- **Mâu thuẫn trong mã:** `claude-cli-runner.ts` phát `{ type: 'cost', usd: total_cost_usd }` ở mỗi frame `result`, và `RunManager` cộng `stepCost += event.usd` (v1). Trong khi `AGENT_PROTOCOL.md` ghi `costUsd` của `usage.updated` (v2) là "cumulative-for-session", và `claude-ui-mapper.ts` phát cùng giá trị làm `costUsd` v2.
- **Nếu `total_cost_usd` là cộng dồn trong một phiên nhiều lượt:** lượt 1 tốn $1 (tổng 1), lượt 2 tốn thêm $1 (tổng 2) thì chi phí step là 1 + 2 = $3 thay vì $2, làm hạn mức `maxCostUsd` và ngân sách dispatch bị tính dư.
- **Vì sao chưa kết luận:** toàn bộ fixture (`__fixtures__/claude/*.ndjson`) chỉ có phiên một lượt (một frame `result`), nên không có dữ liệu về lượt thứ hai. Phụ thuộc vào hành vi thật của CLI.
- **Cách kiểm chứng:** chạy `claude -p --input-format stream-json --output-format stream-json --verbose`, gửi hai tin nhắn người dùng liên tiếp trong một tiến trình và so `total_cost_usd` của hai frame `result`. Việc này gọi API thật (tốn token) nên chưa làm.

### Q2 — Hạn mức token/chi phí chỉ được cập nhật ở cuối mỗi lượt

- **Quan sát:** `handleClaudeMessage` cố ý trả 0 cho frame `assistant` (tránh cộng dư, #716); token và chi phí chỉ vào ở frame `result`. Một lượt tự chủ dài (trần cứng 4 giờ) không thể bị `maxTokens` / `maxCostUsd` chặn giữa chừng; chỉ thời gian và số vòng lặp có tác dụng.
- **Đánh giá:** đây là đánh đổi thiết kế đã được ghi chú trong mã, không phải lỗi. Nêu ra để người dùng biết hạn mức chi phí chỉ kiểm tra ở ranh giới lượt.

---

# Vòng 2 — xử lý các hạng mục còn mở

Mục dưới đây được thêm sau khi vòng 1 đóng (E1–E12). Nhánh làm việc thực tế là `dev` (nhánh `test/edge-case-audit` không tồn tại cục bộ; các commit E1–E12 nằm trên `dev`).

## Q1 — kết luận: `total_cost_usd` của Claude cộng dồn theo PHIÊN (đã sửa)

- **Vị trí:** `packages/work/src/core/claude-cli-runner.ts` (frame `result`), `agent-runner.ts` (`AgentRunSpec.costBaselineUsd`), `workflows/run.ts` (hai chỗ `launch`, `sessionCostUsd`), `AGENT_PROTOCOL.md`.
- **Nguyên nhân:** runner phát `{type:'cost', usd: total_cost_usd}` ở mỗi frame `result`, còn `RunManager` cộng `stepCost += event.usd`. `total_cost_usd` là số cộng dồn của cả phiên, nên mỗi lượt sau tính lại toàn bộ các lượt trước.
- **Tái hiện (CLI thật, claude 2.1.316, model haiku, `claude -p --input-format stream-json --output-format stream-json --verbose`, hai tin nhắn trong CÙNG một tiến trình):** `total_cost_usd` = 0,0077524 rồi 0,01018322. Chính CLI báo chi phí riêng lượt 2 (`model_usage_since_last_result`) là 0,00243082 = 0,01018322 − 0,0077524. Mã cũ tính step = 0,0077524 + 0,01018322 = 0,01793562 (dư 76%).
- **Phát hiện thêm (chạy `--resume` ở tiến trình mới):** tổng của tiến trình mới VẪN gồm cả phiên cũ (token trong `modelUsage` = A + B; 0,00295214 → 0,00533082), tức "theo phiên", không phải "theo tiến trình". Vì vậy một tiến trình resume phải trừ đi chi phí phiên đã có, nếu không bước Continue (một step mới) tính trùng chi phí của step trước và `run.costUsd = Σ steps` dư.
- **Tác động:** `maxCostUsd`, ngân sách dispatch (`remainingBudgetUsd` / `carveChildBudget`) và số tiền hiển thị bị tính dư với mọi phiên nhiều lượt hoặc có Continue; child bị từ chối oan ("còn $0.002" trong khi còn $0.0098).
- **Cách sửa:** runner giữ `lastTotalCostUsd` và phát hiệu `total − lastTotal` (không dùng heuristic "mới ≥ cũ"; số tổng không bao giờ làm giảm mốc). Phiên mới bắt đầu từ 0; `--resume` bắt đầu từ `spec.costBaselineUsd` = Σ `costUsd` của các step có cùng `sessionId` (`RunManager.sessionCostUsd`). Báo cáo đầu tiên luôn được phát kể cả 0 đô (giữ nguyên "zero là một báo cáo", `runner-reported-cost.test.ts`). v2 `costUsd` giữ nguyên (cộng dồn theo phiên, đúng như `AGENT_PROTOCOL.md` đã ghi); thêm chú thích rằng v1 `cost` là số gia của cùng chuỗi đó.
- **Kiểm chứng:** fixture thật đã làm sạch `__fixtures__/claude/two-turn-cost.ndjson` + hai stub; 5 test mới trong `claude-cli-runner.test.ts` (hai lượt thật, ba lượt, resume có baseline, phiên mới bỏ qua baseline, ngân sách dispatch còn lại), tất cả dùng `toBe`. Đỏ trước sửa: 4/5 (ví dụ nhận 0,01793562 thay vì 0,01018322; ngân sách còn 0,002064 thay vì 0,009817). Ca "phiên mới bỏ qua baseline" xanh sẵn, chỉ là rào chắn cho việc dùng baseline sai. Fixture một lượt hiện có vẫn xanh.
- **Chưa phủ bằng test:** việc `RunManager` truyền `costBaselineUsd` (đã typecheck, chưa có test tích hợp vì cần CLI claude thật hoặc stub đầy đủ trong RunManager).
- **Rà soát các chỗ tiêu thụ khác:** opencode đã tự lấy hiệu (`cost - lastCost`); `limits.ts`, `carveChildBudget`, `remainingBudgetUsd` chỉ đọc `run.costUsd` = Σ chi phí step nên không cộng thêm. `pi-runner` phát chi phí theo từng message (chưa kiểm chứng là số gia hay số tích luỹ, không có binary `pi`).

## E12b — test cho codex, junie và opencode (đã thêm)

- **Vị trí:** `parseCodexLine` (`codex-app-server-runner.ts`), `parseJunieLine` (`junie-runner.ts`), `parseOpencodeSseFrame` (`opencode-server-runner.ts`); test `runner-non-object-lines.test.ts`.
- **Thay đổi:** tách bước xử lý một dòng thành hàm thuần (hành vi giữ nguyên), test tham số hoá với `null`, `42`, `true`, `false`, `"text"`, `[]`, `[1,2]`, `0`, dòng không parse được, chuỗi rỗng, `{}` và một object hợp lệ.
- **Kiểm chứng:** hoàn nguyên bản sửa E12 trong cả ba hàm → 21/44 test đỏ (7 mỗi runner), khôi phục → xanh. Lưu ý: ở dạng hàm thuần, đỏ là `AssertionError: expected 42 to be null`, không phải `TypeError` (`TypeError` chỉ xuất hiện khi vòng đọc đọc `.method` từ giá trị trả về; riêng dòng `null` thì hàm hoàn nguyên vẫn trả `null` nên ca đó không đỏ ở tầng này). Các test hiện có của ba runner vẫn xanh (115 test).
- **Vẫn chưa có:** test chạy qua tiến trình thật cho codex và junie (giao thức handshake).

## E13 — Nhập ẩn của `secrets-cli` làm hỏng ký tự nhiều byte

- **Vị trí:** `packages/work/src/workspace/secrets-cli.ts` (`readValueFromStdin`, nay dùng `createHiddenInput`).
- **Nguyên nhân:** mỗi chunk stdin được `toString('utf8')` riêng; xoá lùi dùng `value.slice(0, -1)` (một đơn vị UTF-16).
- **Tái hiện:** test tất định cắt Buffer `key-é€🙂-ñ-𝒳` ở mọi vị trí byte và đưa từng byte một: giá trị ra sai; `ab🙂<DEL>` để lại nửa cặp thay thế.
- **Tác động:** giá trị bí mật dán vào có ký tự ngoài ASCII có thể bị lưu sai mà không báo; thấp (chỉ khi gõ/dán trực tiếp ở prompt ẩn, không ảnh hưởng đường pipe).
- **Cách sửa:** hàm thuần `createHiddenInput` với một `StringDecoder` cho cả luồng, xoá lùi theo code point.
- **Kiểm chứng:** `secrets-cli-input.test.ts`, 3/5 test đỏ trước sửa, xanh sau; `secrets-cli.test.ts` cũ xanh.

## E14 — stderr của cursor và antigravity giải mã từng chunk

- **Vị trí:** `cursor-agent-runner.ts`, `antigravity-runner.ts`.
- **Nguyên nhân:** `buf.toString('utf8')` cho từng chunk stderr, rồi ghép vào thông báo lỗi.
- **Tái hiện (tiến trình thật):** stub ghi emoji 4 byte thành hai lần ghi cách nhau 150 ms: thông báo lỗi ra `... — boom ���`. Khác E10, cách tái hiện này tất định trên Windows vì hai lần ghi tách rời tạo hai sự kiện `data`.
- **Tác động:** chỉ nội dung thông báo lỗi hiển thị cho người dùng; thấp. Vòng 1 ghi "không sửa", vòng 2 đã sửa theo yêu cầu.
- **Cách sửa:** `utf8Collector` cho mỗi luồng stderr, `end()` ở sự kiện `end`.
- **Kiểm chứng:** hai test mới chạy tiến trình thật, đỏ trước sửa, xanh sau; 30 test của hai runner xanh.

## E7b — `toBeCloseTo` trong test tiền (phòng ngừa)

- **Vị trí:** `dispatch/engine.test.ts`, `workflows/limits-run.test.ts`.
- **Thay đổi:** mọi `toBeCloseTo` trên số tiền thay bằng `toBe`. Tất cả vẫn xanh, nên không có lỗi làm tròn ẩn khác. Các `toBeCloseTo` còn lại nằm trong `cgroup-probe.test.ts` (hạn mức CPU, không phải tiền), để nguyên.
- **Kiểm chứng:** chỉ phòng ngừa (không có test đỏ).

## Q2 — kết luận: không thực hiện, chỉ ghi tài liệu

- **Lý do:** (1) frame `assistant` không có chi phí nên `maxCostUsd` không thể ước lượng giữa lượt; (2) `usage.output_tokens` ở frame `assistant` không đáng tin: trong dữ liệu thật lượt 2 báo 8 token đầu ra, `result` báo 51 (có 47 token thinking); (3) frame `assistant` lặp lại cùng `message.id` cho từng content block nên phải khử trùng, đúng loại lỗi cộng dư #716. Quy định của vòng 2: ước lượng không đáng tin thì bỏ hạng mục.
- **Thay đổi:** `docs/reference.md` (mục Limits) nêu rõ ceiling token/chi phí chỉ kiểm tra ở ranh giới lượt.
- **Trạng thái:** đã kết luận; không thay mã. Ngoài ra, theo quy định, Q2 chỉ làm khi Q1 đã merge được; Q1 mới nằm trên nhánh `dev`.

## Hạng mục 4 — prompt bắt đầu bằng `-` ở runner cursor: chưa kiểm chứng

Không có binary `cursor` / `cursor-agent` / `agent` trên máy (`which` rỗng), nên không chạy `--help`, không probe và không sửa. Trạng thái: **chưa kiểm chứng, cần binary**. Mô tả ở mục "Prompt truyền qua argv của cursor" (vòng 1) vẫn đúng.

## Quét theo họ lỗi

| Họ | Vị trí | Phân loại | Ghi chú |
|---|---|---|---|
| 1 chunk/mã hoá | `secrets-cli` | **Lỗi thật** | E13 |
| 1 | stderr cursor, antigravity | **Lỗi thật** | E14 |
| 1 | stderr của claude/codex/junie/pi/opencode/cline/copilot, `codex-usage-probe`, `opencode-http`, `*-model-catalog`, `process-jobs`, `checkout.ts`, `create-project.ts` | An toàn | luồng đã `setEncoding('utf8')` nên Node ghép ký tự qua chunk |
| 1 | `runs/event-history.ts` (`createReadStream` với `encoding:'utf8'`) | An toàn | |
| 1 | `provider-auth.ts` (`String(chunk)` để so khớp dấu hiệu giao thức), `server-install/steps.ts` (`String(d)` cho output bước cài) | Chưa kiểm chứng | không `setEncoding`; chỉ ảnh hưởng nội dung hiển thị / so khớp ASCII, chưa có probe |
| 1 | `private-file-read.ts`, `terminal/sessions.ts` | An toàn | `setEncoding` / chuỗi từ pty |
| 2 dữ liệu ngoài | `parseInt`/`Number` trên env: `index.ts` (`ONNI_SUPERVISOR_PID`), `runs/store.ts` (`keepLimit`), `provider-auth.ts` | An toàn | đều kiểm `isInteger`/`isFinite`/`isSafeInteger` và có mặc định; `keepLimit` chấp nhận tiền tố số của `3abc` (vô hại) |
| 2 | `JSON.parse` rồi truy cập thuộc tính | An toàn (mẫu) | các chỗ khớp mẫu đi qua zod hoặc `unknown`; không rà từng dòng, không có tái hiện |
| 3 số học | `stepCost +=` | **Lỗi thật** | Q1 |
| 3 | `toBeCloseTo` ở test tiền | Phòng ngừa | E7b |
| 3 | `run.costUsd = Σ steps` (`runs/store.ts`) | An toàn | tổng dấu phẩy động có thể lệch ~1e-17, chỉ hiển thị |
| 4 vòng đời tiến trình | `checkout.ts`, `create-project.ts` (gh/git, `finish()` ngay khi abort), `worktree-lifecycle/executor.ts` (nhóm tiến trình + `taskkill`), `landing.ts` (E6), `runCheckStep` (Job Object, E6) | An toàn | |
| 4 | `spawnTaskProcess` trên POSIX là `spawn` thường (không nhóm), kèm `child.kill('SIGTERM')` ở `runCheckStep` / các runner agent | **Chưa kiểm chứng** | cùng hình dạng với E6 nhưng máy này không có POSIX/WSL để probe; trên Windows đường Job Object đã được probe ở E6 |
| 5 giả định git | `landing.ts`, `repo-sync.ts`, `git-changes.ts` | An toàn | đều đọc HEAD / upstream trước khi thao tác (rà đọc mã, không probe) |
| 5 | `manager-merge.ts` | **Lỗi thật** | E5 (vòng 1) |

## Bảng tóm tắt vòng 2 (kèm cột "Bằng chứng")

| # | Khu vực | Kết luận | Bằng chứng | Commit |
|---|---|---|---|---|
| Q1 | Chi phí claude nhiều lượt / resume | Cộng dồn theo phiên; đã sửa | Đỏ trước sửa (4/5 test) + số liệu CLI thật | `eb650d9` |
| E12b | Test codex / junie / opencode | Đã thêm | Đỏ khi hoàn nguyên E12 (21/44) | `4f7f20a` |
| E13 | Nhập ẩn `secrets-cli` | Đã sửa | Đỏ trước sửa (3/5 test) | `e407039` |
| E14 | stderr cursor / antigravity | Đã sửa | Đỏ trước sửa (tiến trình thật) | `6283590` |
| E7b | `toBeCloseTo` trong test tiền | Đã thay bằng `toBe` | Chỉ phòng ngừa (xanh sẵn) | `4393f70` |
| Q2 | Hạn mức giữa lượt | Không thực hiện; chỉ tài liệu | Dữ liệu thật cho thấy ước lượng không đáng tin | commit sổ |
| H4 | Prompt `-` ở cursor | Chưa kiểm chứng, cần binary | Chưa kiểm chứng | — |
| F4 | `kill` + chờ `close` trên POSIX | Chưa kiểm chứng, cần máy POSIX | Chưa kiểm chứng | — |

## Chi phí gọi API thật (vòng 2)

3 lần gọi, model `haiku` (claude-haiku-5-5), prompt `reply ok`:

| Lần | Mục đích | Chi phí (USD) |
|---|---|---|
| 1 | một tiến trình, hai lượt (fixture hai lượt) | 0,01018322 (lượt 1: 0,0077524; lượt 2: 0,00243082) |
| 2 | tiến trình A, một lượt (có lưu phiên) | 0,00295214 |
| 3 | tiến trình B, `--resume` phiên A, một lượt | 0,00237868 chi mới (CLI báo tổng cộng dồn 0,00533082, đã gồm A) |

**Tổng đã tiêu: 0,01551404 USD** (= 0,01018322 + 0,00533082).
