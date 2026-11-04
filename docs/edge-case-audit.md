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
