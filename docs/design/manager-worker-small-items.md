# Khảo sát các điểm nhỏ của manager–worker

Tài liệu này trả lời ba câu hỏi còn để mở ở §3 của [manager-worker-proposals.md](manager-worker-proposals.md#3-các-điểm-nhỏ-nên-làm). Đây là đề xuất triển khai; không thay đổi mã nguồn.

## 1. `--after` với hai phụ thuộc (hình thoi)

**Kết luận: hỗ trợ ở luồng hiện tại.** Có thể tạo `C` bằng hai lần `--after`, ví dụ `--after "A" --after "B"`. Hàng đợi chờ cả A và B kết thúc thành công trước khi chạy C. Tuy nhiên, C chỉ được fork từ nhánh của phụ thuộc đầu tiên; Onni không tự tạo nhánh hợp nhất từ A và B. Thứ tự các giá trị `--after` vì vậy quyết định fork point.

| Mã | Hành vi |
| --- | --- |
| `packages/work/src/dispatch/task-cli.ts:125-165` | `parseArgs` khai báo `after` là chuỗi lặp lại được (`multiple: true`) rồi gửi nguyên mảng vào request. |
| `packages/contract/src/dispatch.ts:399-423` | `dispatchInputSchema.after` nhận tối đa 8 tham chiếu, mỗi tham chiếu tối đa 120 ký tự. |
| `packages/work/src/workflows/run.ts:3787-3807` | Server tìm từng tham chiếu trong các order cùng manager, từ chối order không tồn tại hoặc đã thất bại/bị hủy, và loại trùng nhưng giữ thứ tự đầu vào. |
| `packages/work/src/workflows/run.ts:3587-3601` | `dependencyState` trả `waiting` nếu còn bất kỳ phụ thuộc nào chưa xong; chỉ trả `ready` khi tất cả ở trạng thái `done` hoặc `review`; thiếu/thất bại/bị hủy trả `blocked`. |
| `packages/work/src/workflows/run.ts:2073-2083` | `startable` giữ dependent trong hàng đợi mà không chiếm slot cho tới khi `dependencyState` là `ready`. |
| `packages/work/src/workflows/run.ts:3603-3619` | `blockOrphanedDependents` hủy dependent bị chặn và ghi lý do để manager nhận được thay vì chờ vô hạn. |
| `packages/work/src/workflows/run.ts:3853-3860` | Lệnh tạo order đưa toàn bộ tên, id ngắn và nhánh phụ thuộc vào nội dung task. |
| `packages/work/src/workflows/run.ts:3882-3889` | Chọn nhánh của `afterIds[0]` làm `baseBranch`; nếu không có nhánh đó thì dùng nhánh manager. Ghi chú tại đây nói rõ các phụ thuộc sau vẫn cần worker hợp nhất. |

Do đó, với hình thoi A→C←B, C sẽ được tạo trên A hoặc B tùy thứ tự `--after`; nhánh còn lại **không** tự xuất hiện trong worktree C. Worker phải hợp nhất nhánh còn lại theo chỉ thị trong order. Manager cũng cần tính đến việc nhánh C đã kế thừa phụ thuộc đầu tiên khi tích hợp kết quả.

Đã chạy `npm test -- packages/work/src/workflows/manager-worker.test.ts -t "after"`: **4 test đạt, 30 test bị lọc, mã thoát 0**. Các test hiện có ở `packages/work/src/workflows/manager-worker.test.ts:338-377` kiểm tra chờ, chạy tiếp, hủy và từ chối phụ thuộc đơn; không có test hình thoi. Kết luận hỗ trợ nhiều phụ thuộc dựa trên parser, contract và mã hàng đợi ở trên, chưa được khóa bằng một test hình thoi.

## 2. Shim `onni` trong PATH của worker

### Luồng hiện tại

- `packages/work/src/index.ts:374-378` đặt `ONNI_API_URL` và đường dẫn entrypoint đang chạy vào `ONNI_BIN` khi cockpit khởi động.
- `packages/work/src/workflows/run.ts:1614-1637` là nơi dựng env chung cho từng agent. Nó chỉ truyền `ONNI_API_URL`, `ONNI_PROJECT_ID` và `ONNI_BIN` khi dispatch có thể tới cockpit; `ONNI_TASK_ID` luôn gắn với run. Prompt hiện hướng dẫn `node "$ONNI_BIN"` tại `packages/work/src/dispatch/prompts.ts:15-20`, `packages/work/src/workflows/manager-worker.ts:271-275,303-305`.
- Các runner nhận env theo run; `packages/work/src/core/agent-env.ts:321-355` lọc env theo allowlist rồi áp `extraEnv` của Onni sau cùng. Vì vậy shim nên được nối vào env tại `agentEnv`, không sửa PATH toàn máy hay từng runner riêng lẻ.
- Dữ liệu dự án nằm dưới `.ai/onni` (`packages/work/src/index.ts:811`), và thư mục này được giữ ngoài lịch sử repo theo `packages/work/src/data-gitignore.ts:5-6,66-72`.

### Thiết kế đề xuất

1. Khi dispatch khả dụng và `ONNI_BIN` đã có, tạo thư mục shim riêng trong data dir dự án, chẳng hạn `.ai/onni/dispatch/bin/`. Tạo lười, không yêu cầu file cấu hình hay biến `ONNI_*` mới. Không tạo shim cho headless run không có cockpit.
2. Tạo entrypoint theo hệ điều hành: `onni` dạng shell script trên POSIX (`exec node "$ONNI_BIN" "$@"`); `onni.cmd` cho Windows cmd; cân nhắc thêm `onni.ps1` nếu shell PowerShell của runner cần entrypoint đó. Wrapper chuyển nguyên đối số, gọi đúng `ONNI_BIN` của cockpit đang chạy và trả nguyên exit code.
3. Trả `PATH` với thư mục shim đứng đầu, dùng delimiter của hệ điều hành và giữ nguyên PATH gốc. Đặt nó trong `agentEnv` theo cùng điều kiện với `ONNI_BIN`; `buildChildEnv` đã áp env này sau allowlist. Shim riêng trong `.ai/onni` tránh ghi vào worktree và shadow lệnh `onni` cũ chỉ trong tiến trình agent.
4. Thay chỉ dẫn shell thành `onni task …` trong prompt manager/worker và phần usage tương ứng. Giữ thông tin `ONNI_BIN` trong env riêng cho wrapper; worker không cần biết cú pháp gọi Node.

### Rủi ro và kiểm tra cần có

- Windows tìm lệnh theo `PATHEXT`; `.cmd` thường tránh được ràng buộc execution policy của `.ps1`, nhưng phải kiểm tra lệnh `onni` được tìm đúng trong PowerShell và shell backend thực tế. Không để hai wrapper tạo thứ tự phân giải bất ngờ.
- Đường dẫn có dấu cách và đối số có dấu nháy/ký tự đặc biệt cần được kiểm chứng trên cả shell POSIX lẫn Windows. Wrapper phải giữ nguyên `$LASTEXITCODE`/exit code.
- Antigravity trên Windows dùng PowerShell, còn `allow-rules` của nó khớp toàn bộ dòng lệnh và đang ở mức thử nghiệm (`AGENTS.md`, phần Antigravity). Đổi từ `node "$ONNI_BIN" …` sang `onni …` thay đổi dòng lệnh được cấp quyền; phải kiểm tra quyền hiện có và không nới allowlist để shim chạy.
- PATH đầu tiên cố ý ưu tiên shim hơn một bản `onni` toàn cục cũ. Chỉ áp dụng cho agent con có cockpit; không thay PATH của server, terminal người dùng hay tiến trình khác. Dọn file cùng vòng đời data dir hoặc chấp nhận chúng là state có thể tái tạo.

## 3. Trường báo cáo `assumptions` và `openQuestions`

### Contract và CLI

Thêm hai mảng tùy chọn có mặc định `[]` vào `dispatchReportSchema` tại `packages/contract/src/dispatch.ts:267-284`: `assumptions` và `openQuestions`. Giữ đúng tên camelCase đã chọn cho API. Đề xuất mỗi mảng tối đa **4 mục**, mỗi mục là chuỗi đã trim, không rỗng và tối đa **200 ký tự**. Contract là nguồn ràng buộc; không cắt thầm nội dung vượt giới hạn. Mặc định rỗng giữ báo cáo cũ tương thích khi đọc.

`onni task report` đang phân tích flags và tạo body tại `packages/work/src/dispatch/task-cli.ts:200-238`; thêm các flags lặp `--assumption` và `--open-question` rồi gửi chúng dưới dạng hai mảng tương ứng. Cập nhật cú pháp trong `packages/work/src/dispatch/commands.ts:50` và hướng dẫn worker trong `packages/work/src/dispatch/prompts.ts:32-36` cùng `packages/work/src/workflows/manager-worker.ts:303-305`. Trường mới là lời khai của worker, không tự tạo câu hỏi `ONNI:ASK`, không dừng task và không hàm ý manager đã chấp thuận giả định.

### Hiển thị cho manager và giới hạn prompt

- `childSettleReport` tạo cả report có cấu trúc lẫn văn bản gửi vào session tại `packages/work/src/dispatch/engine.ts:233-305`. Thêm hai mục có nhãn rõ ràng vào văn bản: **Giả định đã dùng** và **Câu hỏi còn mở**; bỏ mục rỗng.
- Nếu parent chưa có session, report được lưu vào `pendingReports` (`packages/work/src/workflows/run.ts:4011-4017`) rồi hiển thị trong `pendingReportsBlock` tại `packages/work/src/dispatch/engine.ts:314-330`. Cập nhật cả nhánh này để manager vẫn thấy hai trường sau restart. Report đầy đủ đồng thời được lưu vào `units/<id8>/report.md` bởi `packages/work/src/dispatch/tree-fs.ts:159-164`.
- Manager nhận report sống qua `packages/work/src/workflows/run.ts:4076-4083`; report tồn khi manager không có session được chèn vào prompt tiếp theo ở `packages/work/src/workflows/run.ts:6174-6181,7966-7973`. Đây là nội dung động của user prompt, khác với brief manager có trần tĩnh tại `packages/work/src/dispatch/prompt-budget.ts:9-31` và các test ở `packages/work/src/workflows/manager-prompt.test.ts:162-196`. Không nên giả định tăng giới hạn brief hiện tại sẽ tự chặn report chờ.
- Với giới hạn đề xuất, hai trường thêm tối đa 1.600 ký tự cho mỗi report (khoảng 400 token ở tỷ lệ thô 4 ký tự/token). `MAX_PENDING_REPORTS` hiện là 20 (`packages/work/src/dispatch/engine.ts:32`), nên riêng hai trường có thể thêm 32.000 ký tự (khoảng 8.000 token) vào một lần mở manager nếu 20 report đều đầy. Vì vậy cần trần tổng cho phần report động, ví dụ **8.000 ký tự**, có dòng báo số mục/report bị lược và đường dẫn `report.md` để xem đầy đủ. Kiểm tra trần này bằng fixture 20 report; đừng tăng `PROMPT_MAX_CHARS` tĩnh thay cho trần render.
- Áp dụng `redactRunText` cho các chuỗi mới trước khi đưa vào report manager, giống cách command trong check được xử lý ở `packages/work/src/workflows/run.ts:3999-4003`; không chỉ dựa vào lời nhắc worker.

Manager prompt nên yêu cầu manager đọc hai mục trước khi hợp nhất: xác nhận/chấp nhận giả định hoặc sửa lệnh; quyết định câu hỏi nào có thể tự giải quyết và câu hỏi nào cần hỏi người dùng hay giao lại. Có thể làm rõ quy trình review ở `packages/work/src/workflows/manager-worker.ts:287-292`; bản thân trường dữ liệu không thay đổi quyền quyết định của user.

## Phần triển khai đề xuất cho worker sau

| Phần | Phạm vi | Hoàn tất khi |
| --- | --- | --- |
| A — contract + CLI | `packages/contract/src/dispatch.ts`, `task-cli.ts`, `commands.ts`, kiểm tra parity và test CLI | Hai trường/flags có giới hạn, mặc định tương thích; CLI gửi đúng payload; test cận trên và vượt giới hạn. |
| B — report + manager | `dispatch/engine.ts`, `workflows/run.ts`, `dispatch/tree-fs.ts`, prompt manager/worker và test cạnh bên | Live và pending report hiển thị hai mục; redaction áp dụng; tổng phần pending bị chặn ở 8.000 ký tự và có chỉ dẫn tới report đầy đủ; test 20 report. |
| C — shim | helper shim trong `packages/work/src`, nối `PATH` tại `RunManager.agentEnv`, cập nhật prompt và test môi trường | POSIX/Windows gọi đúng entrypoint, giữ args/exit code, ưu tiên shim chỉ trong agent env và không nới quyền Antigravity. |
| D — diamond regression | `packages/work/src/workflows/manager-worker.test.ts` | Tạo A, B và C phụ thuộc cả hai; C không chạy tới khi A/B thành công; C fork từ dependency đầu tiên; dependency lỗi chặn C. |

Các thay đổi code nên cập nhật `docs/design/manager-worker.md` và các contract parity test theo nguyên tắc chung trong proposal §4.
