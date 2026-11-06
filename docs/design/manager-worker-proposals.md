# Đề xuất hoàn thiện Manager–Worker

Trạng thái: **đề xuất, chưa triển khai** (2026-11-06). Người viết: agent đóng vai manager, theo yêu cầu
của chủ dự án (góp ý để tối ưu việc thực thi, hướng tới phát hành thương mại).

Phạm vi: chỉ phần Manager–Worker. Phần **ngữ cảnh dự án** (AGENTS.md, memory, handoff, tài liệu thiết kế)
được bàn riêng và không nằm trong tài liệu này.

Đọc kèm: [`manager-worker.md`](manager-worker.md), [`YEUCAU.md`](../../YEUCAU.md),
[`.ai/specs/2026-11-03-manager-worker-gaps-plan.v2.md`](../../.ai/specs/2026-11-03-manager-worker-gaps-plan.v2.md),
[`AGENTS.md`](../../AGENTS.md).

> **Độ tin cậy.** Các nhận định về hiện trạng lấy từ việc đọc code và tài liệu. Chưa có lần chạy thật nào
> của một cây worker trong phiên viết tài liệu này, nên mọi nhận định về hành vi khi chạy thật là suy luận.
> Chỗ nào chưa kiểm được thì ghi "chưa kiểm".

---

## 1. Hiện trạng (đã đối chiếu code)

Phần lớn 10 mục trong `YEUCAU.md` đã có trong code: `onni task peek`, `budget`, `ask` (không chặn lượt),
`memory`, `plan`, `--after`, dòng khả năng (capability) của từng worker trong brief, và `tier`/`kinds` trong
roster. Bộ lệnh `onni task` hiện có: `create`, `ask`, `report`, `merge`, `budget`, `peek`, `memory`, `plan`,
`list`, `tree` (`packages/work/src/dispatch/task-cli.ts`).

**Không có lệnh nào để điều khiển hoặc kiểm chứng worker.** Kế hoạch v2 (§14) cố ý hoãn ba mục
`#2` (message/cancel), `#4` (verify) và `#5` (trùng file) kèm điều kiện mở lại. Đây cũng là những chỗ thiếu
nhiều nhất khi nhìn từ vai manager.

Hạ tầng dùng chung đã sẵn sàng để làm tiếp: `requireRootManager`, `requireSameTree`
(`dispatch/access.ts`), git chỉ đọc `worktreeChangedFilesReadOnly` (`git-worktree.ts`), một bảng lệnh duy nhất
(`dispatch/commands.ts`), ngân sách prompt theo block (`dispatch/prompt-budget.ts`).

---

## 2. Các đề xuất, theo thứ tự ưu tiên

| # | Đề xuất | Vì sao | Công sức | Nguồn |
|---|---|---|---|---|
| A1 | `onni task verify` có baseline | Bỏ thói quen "merge rồi mới test" | Vừa | `#4` |
| B1 | `onni task cancel` / `message` / `redirect` | Thấy worker sai hướng mà không dừng được | Vừa | `#2` |
| A2 | Cảnh báo trùng file và dry-run merge giữa nhánh worker | `--scope` hiện chỉ là chữ trong prompt | Nhỏ đến vừa | `#5` |
| C1 | Bảng điểm worker từ lịch sử run | Chọn worker theo số liệu thật | Vừa | mới |
| C2 | Bộ đánh giá hành vi manager | Sửa prompt manager cần có phép đo | Vừa đến lớn | Đợt 0 của kế hoạch v2 |
| D1 | Tách `run.ts` và `server.ts` | Cho phép chạy worker song song thật sự | Lớn, rủi ro cao | mới |
| D2 | Cách ly thật cho worker (sandbox) | Ranh giới an toàn cho bản thương mại | Lớn | mới |

### A1. `onni task verify <id> [--baseline]`

**Vấn đề.** Báo cáo của worker là lời khai. Muốn chắc, manager phải merge nhánh vào nhánh mình rồi chạy test;
nếu sai thì phải gỡ ra, dễ để repo dở dang.

**Đề xuất.** Route `POST /runs/:id/verify`, chỉ root manager của cùng cây được gọi, và chỉ khi worker đã
settle. Server chạy các lệnh kiểm tra của repo **trong worktree của worker**, không đụng nhánh manager:
- nguồn lệnh: "Kiểm tra bắt buộc" trong cài đặt dự án, nếu không có thì `discoverVerifyCommands`;
- môi trường tối thiểu (không truyền `process.env` trần), timeout thật bằng kill, trần kích thước đầu ra,
  trần số lần verify mỗi worker, đầu ra qua `redactRunText`;
- trên Windows cần bash; thiếu thì trả "unavailable" như một giá trị, không throw;
- kết quả có cấu trúc: từng lệnh `{command, exitCode, durationMs, timedOut, tail khi lỗi}`;
- ghi ledger và note như mọi hành động khác của manager.

**Baseline (điểm quan trọng nhất).** Theo `AGENTS.md`, trên Windows native khoảng 340 test fail vì môi trường.
Khi đó "test đỏ" không phải tín hiệu. `--baseline` chạy cùng lệnh trong một worktree tạm tại
`resolveTaskDiffBase` và chỉ báo các lỗi **mới**. So sánh dựa trên heuristic (mã thoát cộng tập dòng trông giống
test fail), phải ghi nhãn rõ là heuristic, và luôn dọn worktree tạm kể cả khi lỗi hoặc quá hạn.

**Điều kiện từ kế hoạch v2 §14.** Chỉ chạy khi worker đã settle; kết quả verify thay thế nhãn `worker-reported`
của `checks`.

**Mở rộng sau.** Tự chạy verify khi worker báo `done` và đính kèm vào báo cáo; nối với quyền merge để
`merge --to-base` yêu cầu lần verify gần nhất phải đạt.

### B1. `cancel` / `message` / `redirect`

**Vấn đề.** `peek` cho manager thấy worker đi sai nhưng không có cách dừng hoặc chỉnh. Phải chờ xong rồi giao
lại, tốn cả thời gian lẫn tiền. Thấy được mà không điều khiển được thì chưa đủ cho sản phẩm thương mại.

**Đề xuất.**
- `onni task message <id> "<nội dung>"`: gửi chỉ dẫn vào phiên đang mở, dùng lại `deliverMessage`.
- `onni task cancel <id> [--reason]`: dùng lại `RunManager.cancel`; lý do vào log và vào báo cáo `blocked`.
- `onni task redirect <id> "<chỉ dẫn>"`: huỷ rồi giao lại cùng phạm vi; lần thử này không tính vào `retry_limit`.
- Kiểm quyền ở server (root manager, cùng cây), ghi ledger.

**Điều kiện từ kế hoạch v2 §14.** Thang giao nhận 5 trạng thái; chặn worker đang `waiting` vì Guard;
`redirect` không đụng bộ đếm retry theo title (`run.ts`); cursor và antigravity không nhận message giữa lượt.

### A2. Cảnh báo trùng file và dry-run merge

**Vấn đề.** Xung đột chỉ lộ lúc merge, khi mọi worker đã làm xong và đã tốn tiền.

**Đề xuất.** Route `GET /runs/:id/conflicts` (root manager), dùng git chỉ đọc, **không** dùng
`worktreeChangedFiles` vì nó chạy `git add -N` và ghi index của worktree đang chạy. Báo:
- các cặp worker trùng file;
- file nằm ngoài `--scope` khi scope là đường dẫn (bỏ qua nếu scope là văn bản tự do);
- kết quả merge thử giữa các nhánh bằng `git merge-tree --write-tree` khi git hỗ trợ; nếu không thì "unavailable".

Chỉ mang tính tư vấn, không chặn. Đầu ra có trần (số file, số cặp, byte).

### C1. Bảng điểm worker

Tổng hợp từ lịch sử run: tỉ lệ thành công, thời gian và token trung bình, theo backend và loại việc
(`implement`/`test`/`explore`/`review`), rồi đưa một dòng gọn vào brief. Hiện manager chọn worker theo mô tả tĩnh.
Số liệu thật giúp định tuyến việc đúng và rẻ hơn, và là điểm khác biệt khi bán. Lưu ý nhiều backend không báo
chi phí USD (`RUNNERS_WITHOUT_COST`), nên bảng điểm phải dựa trên token và thời gian chứ không riêng USD.

### C2. Bộ đánh giá hành vi manager

Kịch bản dựng sẵn dùng worker giả (đã có các `scripts/mock-*.mjs`) để kiểm tra manager: chia việc có rời phạm vi
không, chọn worker đúng khả năng không, xử lý worker lỗi thế nào, merge đúng thứ tự không. Đợt 0 của kế hoạch v2
("chạy thật một cây và đo baseline") chưa thấy kết quả ghi lại. Không có phép đo thì mọi chỉnh sửa prompt manager
là đoán mò.

### D1. Tách `run.ts` (10.144 dòng) và `server.ts` (8.422 dòng)

Kế hoạch v2 buộc các đợt làm tuần tự vì cùng chạm bốn file nóng (`run.ts`, `server.ts`, `task-cli.ts`,
`manager-worker.ts`). Chia việc song song cần phạm vi file rời nhau; hai file khổng lồ này là nút cổ chai thật.
Nên tách dần theo module, mỗi lần một PR nhỏ, có test hồi quy; không làm một lần.

### D2. Cách ly thật cho worker

`AGENTS.md` ghi rõ roster và push-guard là rào chắn, không phải sandbox, và raw `git merge` trong worktree của
manager không bị chặn. Phát hành thương mại, nhất là với repo của khách hàng, cần ranh giới thật (container hoặc
sandbox hệ điều hành, giới hạn mạng và hệ thống tệp). Đây là lộ trình dài, nên khởi động thiết kế sớm.

---

## 3. Các điểm nhỏ nên làm

- **Báo cáo worker có cấu trúc hơn.** Thêm "giả định đã dùng" và "câu hỏi còn mở" để manager không phải đọc diff
  mới biết worker tự quyết điều gì.
- **Lệnh `onni` trên PATH của worker.** Hiện phải gõ `node "$ONNI_BIN"`; Antigravity trên Windows lại dùng
  `$env:ONNI_BIN`. Một shim thống nhất giảm lỗi và tiết kiệm prompt.
- **Làm rõ `--after`.** Việc phụ thuộc hai việc trước (phụ thuộc kiểu hình thoi) có được hỗ trợ không? **Chưa kiểm.**
- **Hàng đợi tích hợp.** Tự động merge rồi verify theo thứ tự cho từng nhánh đã duyệt, để manager chỉ quyết định,
  không làm tay từng bước.

---

## 4. Thứ tự triển khai đề xuất

1. **Đợt A (an toàn và chất lượng):** A1 và A2. Dùng chung helper git chỉ đọc nên làm cùng nhau.
2. **Đợt B (điều khiển):** B1, theo đúng điều kiện ở kế hoạch v2 §14.
3. **Đợt C (đo lường):** C2 trước, rồi C1. Làm trước khi chỉnh thêm prompt manager.
4. **Song song, dài hạn:** D1 và D2.

Ràng buộc chung (theo kế hoạch v2 §1 và `AGENTS.md`):
- đợt A và B chạm chung các file nóng nên chạy **tuần tự**, không song song;
- mọi lệnh mới có schema trong `packages/contract`, được kiểm cả hai chiều trong `contract-parity.dispatch.test.ts`;
- quyền kiểm ở server (root manager, cùng cây), không chỉ trong prompt;
- đầu ra có trần và đi qua `redactRunText`; mọi hành động ghi đều vào ledger;
- không thêm biến `ONNI_*` mới (nếu có thì cập nhật `.env.example` cùng commit);
- mỗi đợt cập nhật `manager-worker.md` và qua đủ cổng:
  `typecheck`, `test`, `test:unit`, `build`, `test:package`. Trên Windows native, CI là chuẩn.

## 5. Chưa làm / chưa kiểm

- Chưa có đề xuất nào trong tài liệu này được triển khai. Một worker thử cho đợt A đã bị huỷ trước khi báo cáo,
  không để lại thay đổi nào.
- Chưa chạy một cây manager–worker thật để kiểm chứng các nhận định về hành vi.
- Chưa kiểm `--after` với nhiều phụ thuộc (mục 3).
- Phần ngữ cảnh dự án: bàn riêng.
