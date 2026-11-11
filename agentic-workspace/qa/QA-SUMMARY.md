# QA tổng hợp — kiểm thử Phase 0–5 (chỉ đọc, chưa sửa gì)

Ngày: 2026-11-11. Nhánh: `onni/dac1e69b`. Baseline: `c6db20f` (118 file, +15.040/−2.530).
9 báo cáo chi tiết nằm cạnh file này (`QA1`…`QA9`). Không worker nào sửa mã nguồn (`git diff` trên `packages/` của từng nhánh QA đều rỗng).

## Số lượng finding (gộp)
HIGH 2 · MEDIUM 22 · LOW 5 · INFO 1 (+ QA9: 1 HIGH môi trường, đã loại — xem dưới)

## HIGH — nên sửa trước
| ID | Khu vực | Vấn đề | Báo cáo |
| --- | --- | --- | --- |
| QA3-A01 | host/URL | Split nhiều run luôn render run trên URL, URL ↔ pane active không hội tụ | QA3 |
| QA7-A01 | server | Path traversal qua `RunRecord.id` trong `runs.json` của project "lạnh" (đọc/ghi ngoài thư mục run) | QA7 |

## MEDIUM
- QA3-A02 picker có thể biến draft thành run giả; A03 read receipt bị chặn sau khi đổi sang run có seq nhỏ hơn; A04 mirror server mất active/split khi >50 tab; A05 `SplitTabStrip` không là tab control dùng được bằng bàn phím.
- QA4-A01 schedule trong workspace điều hướng khỏi `/new` sau khi host đóng draft pane (test host mock surface nên không bắt được).
- QA5-A01 preset Workbench (4 cột) bị cắt còn 3 do giới hạn 3 cột → mất Terminal/Preview; A02 deep link `/terminal` có thể tạo terminal thứ hai.
- QA6-A01 Context Sheet mobile thiếu `files-tree`/`editor`; A02 tab của sheet/editor thiếu bàn phím + `aria-controls`/tabpanel; A03 `role="tree"` của task tree thiếu điều hướng mũi tên.
- QA7-A02 giới hạn 1 MiB không chặn một dòng NDJSON cực lớn; A03 `markViewed` mất tính đơn điệu giữa hai process; A04 cursor thread bỏ mục khi hai project có cùng run ID + timestamp.
- QA8-A01 `use-mark-viewed` giữ watermark giữa các run → run mới có seq thấp không bao giờ được đánh dấu đã xem; A02 palette hiển thị kết quả cũ trong cửa sổ debounce; A03 shared SSE reconnect dùng `liveCursor` cũ sau compaction.
- QA2-A01 quy tắc "≥4 vùng" của rail không bao giờ được cấp dữ liệu (`contentZoneCount` không được truyền); A02 đóng thread đang mở từ Navigator để URL cũ + vùng hội thoại trống; A03 badge dự án không đếm run `failed` dù đang ở nhóm Needs you; A04 worker lỗi tách khỏi manager vì gom theo bucket.
- QA1-A01 `useSplitter` không theo dõi `pointerId`/`lostpointercapture` (áp dụng cả 5 handle).
- QA9-A02 `settings.test.tsx` còn 5 test khẳng định lựa chọn accent (đã xác minh lại: 5 fail / 37 pass) — hệ quả của D1, test chưa được cập nhật.

## LOW / INFO
QA1-A02 nhãn separator VerticalSplit chung chung; QA1-A03 (INFO) test đặc trưng dùng callback không điều khiển state; QA2-A05 rail nhấp nháy khi đổi project; QA5-A03 contract lưu `stack` mà client cũ không hỗ trợ; QA7-A05 guard parity chưa bao phủ đủ route Phase 5; QA8-A04 `Segmented` radiogroup thiếu phím mũi tên.

## Kết quả QA9 sau khi tôi đối chiếu lại
- **QA9-A01 (HIGH) là artefact môi trường, không phải lỗi mã:** worktree của worker QA không có `node_modules` riêng nên `@onni/contract` trỏ về checkout cha. Trong worktree manager (đã `npm install`), `contract-workspace-threads.test.ts` 16/16 pass, `npm run typecheck` và `npm run build` exit 0.
- QA9-A03 `store-concurrency.test.ts`: chạy riêng 15/15 pass → lỗi do tải khi chạy cả nhóm, không tái hiện.
- Các lỗi Git/EPERM/`bash ENOENT`/POSIX còn lại là ENV-ONLY đã dự báo trong AGENTS.md. Mermaid (2 test) và 12 timeout workflow chưa được tách khỏi nhiễu môi trường.

## Việc cần làm tiếp (chưa thực hiện, đúng quy tắc QA)
Sửa theo thứ tự: QA7-A01 → QA3-A01 → QA5-A01/A02 → QA8-A01 → QA2-A02 → QA4-A01 → còn lại; cập nhật `settings.test.tsx`; bổ sung test tích hợp mà các báo cáo chỉ ra (host với `NewTaskSurface` thật, split/Back-Forward, controlled harness cho splitter).
