# Bộ đánh giá hành vi manager

`packages/work/scripts/manager-eval.mjs <treeDir>` đọc cây dispatch đã lưu trên đĩa và in một bảng điểm ổn định. Công cụ chỉ đọc các tệp trong cây: `ledger.jsonl`, `plan.json`, `brief.md`, `units/<id8>/order.md`, `units/<id8>/report.md` và hộp thư dưới `inbox/`. Công cụ không khởi động server, browser, worker hay kết nối mạng.

Chạy từ thư mục gốc của repo:

```sh
node --import tsx packages/work/scripts/manager-eval.mjs .ai/onni/dispatch/<rootRunId>
```

Exit code là `1` nếu có tiêu chí thất bại, `0` nếu không có thất bại (bao gồm cả trường hợp chưa đủ dữ liệu), và `2` nếu thiếu đối số.

## Tiêu chí

| Tiêu chí | Bằng chứng được dùng | Cách chấm |
| --- | --- | --- |
| Phạm vi của các order chạy đồng thời | Thời điểm `dispatch`/`settle` trong ledger và dòng `Scope` trong order | So sánh các khoảng thời gian giao nhau. Hai scope đường dẫn giao nhau là thất bại; scope đường dẫn rời nhau là đạt. Scope dạng văn bản tự do hoặc thiếu mốc thời gian được ghi là chưa đo được, trừ order đã bị hủy trước khi bắt đầu. |
| Worker hợp với roster | Worker được chọn, `Kind`, mức tier yêu cầu trong order và ảnh chụp roster | Kiểm tra worker có trong roster, có nhận loại việc đó không, và tier có đủ mức yêu cầu không. |
| Xử lý worker lỗi hoặc bị chặn | `settle`, `report.md`, `inbox/` và các lần `dispatch` tiếp theo | Đạt nếu có lần dispatch lại sau lỗi, báo cáo `failed`/`blocked` được lưu, hoặc inbox có nhắc tới run/order cùng dấu hiệu lỗi. |
| Thứ tự merge và kiểm tra | Sự kiện `verify`/`merge`, `after` trong plan hoặc order, file được báo cáo và `checks` trong báo cáo | Merge có danh sách file đầy đủ và tất cả là tài liệu được tính đạt kiểm tra với bằng chứng `docs-only, no checks needed`. Các merge khác cần một verify đạt hoặc báo cáo có các check đều mã 0. Nếu có phụ thuộc, worker phụ thuộc phải được merge sau worker tiền đề. |

Mỗi tiêu chí có thể là `PASS`, `FAIL`, `PARTIAL`, `UNSCORED` hoặc `N/A`. `N/A` nghĩa là cây không có trường hợp phù hợp để đánh giá (ví dụ không có worker lỗi). `UNSCORED` nghĩa là đã có trường hợp nhưng cây thiếu bằng chứng cần thiết. `PARTIAL` nghĩa là có cả bằng chứng chấm được và bằng chứng còn thiếu. Thiếu dữ liệu không được tính là đạt.

Với kiểm tra merge, scorer đọc danh sách `files` trong báo cáo có cấu trúc hoặc dòng `files:` trong văn bản báo cáo. Danh sách chỉ được coi là đầy đủ khi không báo số file bị lược bớt. Mọi đường dẫn phải kết thúc bằng `.md`, `.mdx` hoặc `.txt`, hoặc nằm dưới `docs/` hay `.ai/specs/`. Danh sách thiếu, rỗng, bị lược bớt hoặc có bất kỳ file ngoài nhóm này đều giữ nguyên yêu cầu verify/check. Phụ thuộc merge vẫn được chấm như bình thường.

Với phạm vi đồng thời, order có settle `cancelled` và không có sự kiện bắt đầu/`startedAt` trong ledger được xem là chưa bắt đầu và bị loại khỏi các cặp thời gian. Vì vậy, timestamp `dispatch`/`settle` thiếu hoặc không hợp lệ không tạo `UNSCORED` cho order đó. Nếu ledger có bằng chứng order đã bắt đầu, timestamp thiếu vẫn được chấm là `UNSCORED`.

## Metadata roster và tier

Cây hiện tại ghi lại loại việc, phạm vi, phụ thuộc, báo cáo và các sự kiện merge/verify; nó không luôn lưu ảnh chụp roster gốc hoặc worker được chọn. Vì vậy evaluator hỗ trợ thêm metadata tùy chọn ngay trong `brief.md`:

```markdown
<!-- manager-eval:begin -->
{
  "roster": [
    { "key": "codex:gpt-5", "tier": "heavy", "kinds": ["implement", "test"] },
    { "key": "claude:sonnet", "tier": "standard", "kinds": ["review"] }
  ]
}
<!-- manager-eval:end -->
```

Order tương ứng có thể ghi `- Worker: codex:gpt-5` và `- Required tier: heavy`. Nếu không có worker trong order, scorer thử `workerKey`/`worker` ở sự kiện dispatch, rồi tới trường `worker` trong phần plan gắn với run. Trường `Required tier` là nhãn đánh giá do người tạo kịch bản cung cấp; scorer không suy đoán độ khó từ prompt hay số dòng.

Metadata này chưa được runtime hiện tại tự ghi vào cây. Khi ảnh chụp roster hay tier yêu cầu vắng mặt, phần đó được báo `UNSCORED`; scorer không đọc dữ liệu run bên ngoài cây để bù vào.

## Giới hạn

- Đây là phép đo dấu vết được ghi lại, không phải đánh giá ngữ nghĩa của prompt hay chất lượng mã.
- Khoảng đồng thời được ước tính từ `dispatch` tới `settle`; với order có `after`, thời điểm bắt đầu được đẩy tới lúc các phụ thuộc settle. Ledger không ghi thời điểm worker thực sự bắt đầu sau khi chờ slot, nên các order chờ bởi giới hạn đồng thời vẫn có thể bị tính như đang chạy.
- Order `cancelled` không có dấu vết bắt đầu trong ledger được loại khỏi so sánh thời gian; một dấu vết bắt đầu giữ nguyên cách chấm thiếu dữ liệu.
- Scope tự do không được diễn giải như đường dẫn. Với glob mà quan hệ giao nhau không thể chứng minh từ hai mẫu, kết quả là chưa đo được thay vì phỏng đoán.
- Báo cáo check của worker là lời khai; công cụ chỉ biết chúng được lưu trong cây. Verify có trạng thái `passed` là bằng chứng engine ghi nhận.
- “Đã báo cáo” ở đây nghĩa là dấu vết lỗi của worker được lưu trong `report.md` hoặc được nhắc tới trong inbox. Cây không có bản báo cáo cuối cùng của root nên công cụ không chứng minh được root đã nói gì với người dùng hay có âm thầm tự làm lại phần việc đó hay không.
- Công cụ không xác minh file thật đã đổi, không chạy test, không đo token/chi phí, không đánh giá worker có sẵn hơn hoặc rẻ hơn, và không xác nhận code merge có đúng hay không.
- Chỉ các merge thành công của worker mà nguồn có thể ghép về một run mới được xét. Dữ liệu thiếu hoặc định dạng cũ được hiển thị như chẩn đoán/điểm chưa đo được.

Các cây fixture dưới `packages/work/src/manager-eval/fixtures/` là ví dụ tổng hợp, không phải kết quả từ một lần chạy model thật. Chúng kiểm tra đường đi đạt, retry sau worker thất bại, xung đột phạm vi, merge chỉ đổi tài liệu và order bị hủy trước khi bắt đầu.
