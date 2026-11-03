# YÊU CẦU: Những gì Manager còn thiếu để làm việc tốt

Tài liệu này liệt kê những gì hệ thống Manager–Worker của OnniCode còn thiếu, nhìn từ góc của một agent đóng vai **manager**. Mỗi mục gồm: hiện trạng (dẫn tới code), hướng giải quyết, và cải tiến thêm.

> Ghi chú: đây là đánh giá dựa trên việc đọc và xây dựng code của luồng manager–worker, chưa phải từ trải nghiệm chạy thật vai manager với agent thật. Nên ưu tiên kiểm chứng bằng một lần chạy thật trước khi làm các mục lớn.

## Tóm tắt và thứ tự ưu tiên

| # | Vấn đề | Ảnh hưởng | Công sức | Ưu tiên |
|---|---|---|---|---|
| 3 | Manager không biết giới hạn quyền của từng worker | Cao: giao nhầm việc, worker thất bại | Nhỏ | **1** |
| 4 | Không kiểm chứng được nhánh worker độc lập | Cao: chất lượng đầu ra | Vừa | **2** |
| 2 | Không điều khiển được worker giữa chừng | Cao: lãng phí thời gian, chi phí | Vừa | **3** |
| 1 | Không nhìn được worker đang làm gì | Cao | Vừa | 4 |
| 7 | Báo cáo worker thiếu danh sách file và lệnh kiểm tra | Vừa | Nhỏ | 5 |
| 5 | Không ngăn hai worker sửa cùng file | Vừa | Vừa | 6 |
| 8 | Ngân sách chỉ biết lúc bắt đầu | Vừa | Nhỏ | 7 |
| 6 | Kế hoạch không có chỗ lưu | Vừa | Lớn | 8 |
| 10 | Hỏi người dùng phải dừng cả lượt | Thấp–Vừa | Vừa | 9 |
| 9 | Không có trí nhớ giữa các task | Thấp–Vừa | Vừa | 10 |

Ba mục nên làm trước là **#3, #4, #2**. #3 rẻ nhất và chặn đúng loại lỗi đã gặp trong log thật (worker Antigravity ở mức "Chỉ tệp" được giao việc cần chạy lệnh). #4 quyết định chất lượng sản phẩm cuối. #2 cắt phần lớn lãng phí khi một worker đi sai hướng.

---

## 1. Không nhìn được worker khi nó đang làm

**Hiện trạng**
- Manager chỉ nhận thông tin khi worker **xong việc**: báo cáo được gửi vào phiên của manager lúc worker kết thúc (`childSettleReport` trong `packages/work/src/dispatch/engine.ts`).
- Bảng "Workers now" (`workerStatusBoard`) chỉ cho biết đang làm, đang chờ, xong hay lỗi, không cho biết đang ở bước nào hay đã sửa gì.
- Muốn biết tiến độ, manager phải tự chạy `git diff` vào nhánh `onni/<id8>` của worker.

**Hướng giải quyết**
- Thêm lệnh `onni task peek <id>` (CLI trong `packages/work/src/dispatch/task-cli.ts`) gọi route mới `GET /runs/:id/peek`.
- Route trả về dạng có cấu trúc, ngắn gọn:
  - trạng thái và bước hiện tại;
  - thời gian chạy, chi phí và token đến lúc này;
  - danh sách file đã đổi so với nhánh base (dùng `worktreeChangedFiles` có sẵn trong `git-worktree.ts`);
  - 10–20 dòng cuối của phiên (lấy từ events đã lưu, đã che thông tin nhạy cảm qua `redactRunText`).
- Giới hạn kích thước đầu ra để không làm tràn ngữ cảnh của manager.

**Cải tiến thêm**
- Cho phép `onni task peek --all` để xem nhanh mọi worker trong cây bằng một lệnh.
- Đánh dấu worker "im lặng quá lâu" (không có sự kiện mới sau N phút) để manager biết nên kiểm tra.

---

## 2. Không điều khiển được worker giữa chừng

**Hiện trạng**
- CLI `onni task` hiện chỉ có: `create`, `report`, `list`, `tree`, `merge`.
- Có hộp thư của cây (tree inbox), nhưng worker chỉ đọc nó ở cuối mỗi lượt, không phải kênh điều khiển tức thời.
- Thấy worker đi sai hướng, manager chỉ có thể chờ nó xong rồi giao lại, tốn cả thời gian lẫn chi phí.

**Hướng giải quyết**
- `onni task message <id> "<nội dung>"`: gửi chỉ dẫn vào phiên đang mở của worker. Dùng lại `deliverMessage` có sẵn trong `RunManager`, giống cách người dùng nhắn tiếp cho task đang chạy.
- `onni task cancel <id> [--reason "..."]`: huỷ worker. Dùng lại `RunManager.cancel`; lý do được ghi vào log và vào báo cáo `blocked` gửi về manager.
- Kiểm tra phía server: chỉ manager (run gốc có roster) mới được nhắn hoặc huỷ worker **trong cây của chính nó**. Cùng kiểu kiểm tra với `mergeFromAgent`.

**Cải tiến thêm**
- `onni task redirect <id> "<chỉ dẫn mới>"`: huỷ rồi giao lại cùng phạm vi với chỉ dẫn mới. Lần thử này không tính vào `retry_limit`.
- Ghi mọi lệnh điều khiển vào nhật ký cây (`appendLedger`) để người dùng xem lại được.

---

## 3. Manager không biết giới hạn quyền của từng worker

**Hiện trạng**
- Brief của manager (`managerPrompt` trong `packages/work/src/workflows/manager-worker.ts`) chỉ liệt kê mỗi worker bằng tên backend, model, vai trò và số chạy song song.
- Manager không biết:
  - Antigravity đang ở mức "Chỉ tệp" (không chạy được lệnh shell, kể cả test) hay "Allow-rules";
  - backend nào không báo chi phí bằng USD (`RUNNERS_WITHOUT_COST`);
  - backend nào không báo token (`RUNNERS_WITHOUT_TOKENS`).
- Hệ quả đã thấy trong log thật: worker Antigravity được giao việc cần chạy lệnh và thất bại.

**Hướng giải quyết**
- Khi dựng brief, thêm dòng "khả năng" cho từng worker, tính từ cấu hình thật lúc chạy:
  - chạy lệnh: không / chỉ các lệnh kiểm tra của repo / tự do;
  - báo chi phí: có / chỉ token / không.
  - Nguồn dữ liệu: `effectiveAntigravityLevel` và `discoverVerifyCommands` (Antigravity), `RUNNER_CAPABILITIES`, `RUNNERS_WITHOUT_COST`, `RUNNERS_WITHOUT_TOKENS`.
- Thêm một dòng hướng dẫn: "Đừng giao việc cần chạy lệnh cho worker không chạy được lệnh."

**Cải tiến thêm**
- Kiểm tra mềm lúc giao việc: order có `--evidence` hoặc `--success` nhắc tới test/build mà worker không chạy được lệnh thì trả cảnh báo (không chặn), gợi ý worker khác.
- Hiển thị cùng thông tin này trong giao diện chọn worker ở Cài đặt nhiệm vụ.

---

## 4. Không kiểm chứng được nhánh worker một cách độc lập

**Hiện trạng**
- Báo cáo của worker chỉ là lời khai (status, result, evidence).
- Muốn chắc nó đúng, manager phải merge nhánh worker vào nhánh mình rồi chạy test. Sai thì phải gỡ ra, dễ để repo ở trạng thái dở dang.

**Hướng giải quyết**
- Thêm lệnh `onni task verify <id>` gọi route `POST /runs/:id/verify`.
- Server chạy các lệnh kiểm tra của repo **ngay trong worktree của worker**, không đụng nhánh manager:
  - nguồn lệnh: "Kiểm tra bắt buộc" trong cài đặt dự án, hoặc lệnh tự phát hiện (`discoverVerifyCommands`: `npm test`, `npm run build/lint/typecheck`, `cargo check/test`);
  - có giới hạn thời gian và giới hạn kích thước đầu ra.
- Trả về kết quả có cấu trúc: từng lệnh, mã thoát, thời gian, vài dòng cuối của đầu ra khi lỗi.
- Chỉ manager của cây mới được gọi; mỗi lần chạy được ghi vào log.

**Cải tiến thêm**
- Tuỳ chọn tự động chạy verify khi worker báo `done`, đính kèm kết quả vào báo cáo gửi manager.
- Nối với quyền merge: khi bật "Full quyền manager", `onni task merge --to-base` có thể yêu cầu lần verify gần nhất phải đạt.

---

## 5. Không có gì ngăn hai worker sửa cùng một file

**Hiện trạng**
- Việc chia phạm vi riêng cho từng worker chỉ là lời dặn trong prompt và tham số `--scope` dạng chữ.
- Xung đột chỉ lộ ra lúc merge, khi cả hai worker đã làm xong.

**Hướng giải quyết**
- Khi một worker có thay đổi (đọc ở cuối mỗi lượt, cùng chỗ cập nhật `diffStat` trong `recordTurnEnd`), so danh sách file đã đổi với các worker khác đang chạy trong cùng cây.
- Nếu trùng file:
  - ghi cảnh báo vào log của manager, nêu tên hai worker và các file trùng;
  - gửi nhắc vào phiên của manager.
- Nếu `--scope` là đường dẫn (thư mục hoặc mẫu glob), cảnh báo khi worker sửa file nằm ngoài phạm vi.

**Cải tiến thêm**
- Thử merge khô (`git merge-tree`) giữa nhánh các worker để phát hiện xung đột thật trước khi manager merge.
- Hiển thị cảnh báo trùng file trên đồ thị Hoạt động (cạnh nối hai worker, màu cảnh báo).

---

## 6. Kế hoạch không có chỗ để nằm

**Hiện trạng**
- Manager lập kế hoạch trong đầu rồi gửi từng lệnh `create`. `--after` giúp xếp thứ tự, nhưng chỉ khai báo theo từng việc.
- Không có một bảng kế hoạch chung để manager cập nhật và người dùng theo dõi. Phiên bị ngắt thì kế hoạch mất theo.

**Hướng giải quyết**
- Lưu kế hoạch thành tệp có cấu trúc trong thư mục cây (cạnh `brief.md`): `plan.json` gồm các phần việc, phụ thuộc, worker dự kiến, trạng thái.
- Thêm lệnh `onni task plan set|show|update`. Mỗi phần việc khi được giao sẽ gắn với run id của worker.
- Khi phiên manager mở lại, nạp kế hoạch vào brief để manager tiếp tục đúng chỗ.

**Cải tiến thêm**
- Hiển thị kế hoạch trên đồ thị Hoạt động: phần việc chưa giao là node mờ, đã giao nối với worker tương ứng.
- Cho người dùng sửa kế hoạch (bỏ hoặc thêm phần việc) từ giao diện trước khi manager giao tiếp.

---

## 7. Báo cáo của worker vẫn thiếu thông tin quan trọng nhất

**Hiện trạng**
- Báo cáo có: trạng thái, kết quả, bằng chứng (chữ tự do), lỗi, gợi ý, chi phí, số file và số dòng thay đổi.
- Thiếu danh sách file cụ thể và các lệnh kiểm tra đã thật sự chạy cùng kết quả. Manager phải tự đọc diff, tốn ngữ cảnh.

**Hướng giải quyết**
- Server tự đính kèm vào báo cáo lúc worker kết thúc (trong `childSettleReport`):
  - danh sách file đã đổi (tối đa N file, phần còn lại ghi "+K file khác");
  - nhánh và commit cuối.
- Thêm trường tuỳ chọn `checks` vào `dispatchReportSchema`: danh sách `{ command, exitCode }` mà worker khai báo qua `onni task report --check "npm test=0"`.

**Cải tiến thêm**
- Nếu đã có mục #4, dùng kết quả verify thật thay cho lời khai của worker.
- Tóm tắt diff bằng một dòng cho mỗi file (thêm hàm, sửa test…) khi diff nhỏ.

---

## 8. Ngân sách chỉ biết một lần lúc bắt đầu

**Hiện trạng**
- Chi phí, token, thời gian và lượt gọi worker còn lại chỉ được báo trong brief khi phiên manager mở (`remainingForManager`). Giữa chừng manager không hỏi lại được.

**Hướng giải quyết**
- Thêm lệnh `onni task budget` gọi route `GET /runs/:id/budget`, trả về các con số còn lại của cả cây (dùng lại `remainingForManager` và `subtreeUsage`).
- Kèm một dòng ngân sách vào mỗi lô báo cáo gửi manager, cạnh bảng "Workers now".

**Cải tiến thêm**
- Ước lượng chi phí trung bình mỗi worker đã xong, giúp manager quyết định còn đủ cho bao nhiêu việc nữa.

---

## 9. Không có trí nhớ giữa các task

**Hiện trạng**
- Mỗi task bắt đầu từ con số không. Ghi chú (`notes.md`, handoff) chỉ sống trong một task.
- Những bài học kiểu "worker Codex hay quên commit" hay "repo này phải build trước khi test" không được giữ lại.

**Hướng giải quyết**
- Thêm tệp trí nhớ cấp dự án `.ai/onni/manager-memory.md`. Đây là trạng thái được ghi, không bắt buộc, đúng nguyên tắc zero-config của AGENTS.md.
- Lệnh `onni memory add "<bài học>"` để manager ghi lại; nội dung tệp (giới hạn kích thước) được đưa vào brief của manager ở task sau.
- Người dùng xem, sửa, xoá được trong Cài đặt dự án.

**Cải tiến thêm**
- Gắn mỗi bài học với nguồn (task id, ngày) và tự loại bỏ bài học quá cũ hoặc bị người dùng đánh dấu sai.

---

## 10. Không hỏi được người dùng mà vẫn để worker chạy tiếp

**Hiện trạng**
- Khi cần người dùng quyết định, manager dùng câu hỏi chặn (`ONNI:ASK`), làm dừng cả lượt của manager.
- Trong lúc đó manager không xử lý được báo cáo của các worker khác.

**Hướng giải quyết**
- Thêm `onni task ask "<câu hỏi>" --option "A" --option "B"`: tạo thẻ hỏi trên giao diện (dùng lại cơ chế thẻ hỏi sẵn có), không dừng phiên.
- Khi người dùng trả lời, câu trả lời được gửi vào phiên của manager như một báo cáo.
- Đặt thời hạn trả lời; hết hạn thì manager nhận thông báo để tự chọn phương án an toàn.

**Cải tiến thêm**
- Gom các câu hỏi đang chờ của cả cây vào một chỗ trên giao diện (mục "Cần bạn").

---

## Nguyên tắc chung khi triển khai

- **Kiểm tra ở server, không chỉ trong prompt:** mọi lệnh mới của manager phải được server kiểm tra quyền (chỉ manager của chính cây đó), như `mergeFromAgent` đang làm.
- **Không mở rộng quyền mặc định:** các lệnh điều khiển (huỷ, nhắn) chỉ tác động trong cây của manager; không thêm quyền chạy lệnh mới cho worker.
- **Đầu ra gọn:** mọi lệnh trả dữ liệu cho manager phải có giới hạn kích thước để không làm tràn ngữ cảnh.
- **Có test:** mỗi lệnh mới cần test phía server (quyền, giới hạn, trường hợp lỗi) và thêm vào `contract-parity.dispatch.test.ts`.
- **Ghi nhật ký:** mọi hành động của manager lên worker được ghi vào ledger của cây để người dùng xem lại.
