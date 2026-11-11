# QA5 — Kiểm toán mô hình layout, contract và cột workspace

## Kết luận

Audit tĩnh theo baseline `c6db20f` trên branch Phase 5 cho thấy route và Zod server đã nhận các ViewId mới cùng `stack`/`stackRatio`, reviver sửa widths sau khi loại cột không dùng được, và các test tập trung đều xanh. Có ba vấn đề cần xử lý: preset Workbench bị cắt mất Terminal/Preview vì có bốn cột nhưng giới hạn là ba; mở deep link `/terminal` từ một layout nhiều cột đã chứa Terminal tạo thêm card Terminal; và contract server lưu các tổ hợp stack mà client chủ động loại bỏ khi đọc lại. Không có thay đổi source.

## Findings

### A-01 — MEDIUM — Workbench mất Terminal/Preview do preset 4 cột bị cắt còn 3

**Vị trí:** `packages/web/src/routes/task-workspace/layout-state.ts:254-261, 969-980`

`WORKBENCH_LAYOUT_PRESET` khai báo bốn cột: `session`, `files-tree`, `editor`, rồi `terminal` với `stack: 'browser'`. Nhưng `applySavedLayout` chỉ lặp qua `saved.columns.slice(0, MAX_COLUMNS)`; `MAX_COLUMNS` bằng 3. Vì vậy chọn Workbench hiện áp dụng ba cột đầu và bỏ toàn bộ vùng Terminal/Preview, trái với design §12.5 #4 và §12.2.

**Bằng chứng / tái hiện:** chọn `Workbench` trong menu Layout. Mã preset có Terminal/Preview ở cột thứ tư; đường áp dụng cắt danh sách ở ba cột trước khi tạo layout. `workbench-wiring.test.tsx:197-204` chỉ khẳng định `session`, `files-tree`, `editor` có mặt, không khẳng định Terminal hay Preview, nên test vẫn xanh dù vùng thứ tư mất. `npm test -- packages/web/src/routes/task-workspace/workbench-wiring.test.tsx` — 5 tests passed.

**Đề xuất:** biểu diễn bốn content zones bằng tối đa ba cột, với Terminal/Preview là stack trong cùng một cột (như design §12.5 #4); thêm assertion cho cả hai view và tổng số cột không quá ba.

### A-02 — MEDIUM — Deep link `/terminal` có thể tạo terminal thứ hai trong cùng layout

**Vị trí:** `packages/web/src/routes/task-workspace/layout-state.ts:832-853`; `packages/web/src/routes/task-workspace/task-workspace.tsx:224-235`

`openDeepLink` tìm card một cột có tên/view Terminal, hoặc chỉ kiểm tra layout hiện hành nếu nó có đúng một cột. Nó không kiểm tra layout nhiều cột đang hoạt động đã chứa `view: 'terminal'`. Khi điều hướng đến `/tasks/:id/terminal` từ layout nhiều cột có Terminal, nhánh cuối gọi `addLayout` và tạo card Terminal độc lập, giữ nguyên layout cũ có Terminal. Đây là lỗ dedupe với deep link; quy tắc “một terminal surface mỗi run” hiện được bảo đảm ở các thao tác thêm/đổi cột nhưng không ở transition này.

**Bằng chứng / tái hiện:** có state với layout `Custom` gồm `session`, `terminal` (có thể stack `browser`) và `changes`, nhưng chưa có card đơn `Terminal`; mở `/tasks/:id/terminal`. Effect gọi `openDeepLink`, điều kiện `born` không khớp card đơn và điều kiện `current.columns.length === 1` sai, sau đó tạo card terminal khác. Schema hiện cho phép lưu layout nhiều cột này. Đây là truy vết tĩnh trọn đường route → transition; chưa chạy browser E2E riêng cho tình huống này.

**Đề xuất:** trước khi tạo card mới, tìm Terminal trong layout đang hoạt động và chọn/focus đúng card hoặc cột hiện có; thêm test cho deep link từ layout nhiều cột có Terminal và không có card Terminal riêng.

### A-03 — LOW — Contract nhận và lưu stack không được client hỗ trợ

**Vị trí:** `packages/contract/src/workspace-layouts.ts:49-52, 94-102`; `packages/web/src/routes/task-workspace/layout-state.ts:449-455`; `packages/work/src/runs/layouts.ts:76-83`

Zod cho phép `stack` là bất kỳ `workspaceViewSchema` nào và cho phép `stackRatio` ngay cả khi không có `stack`. Route/store xác thực bằng schema này rồi ghi nguyên dữ liệu. Ngược lại, `reviveStack` chỉ giữ cặp `view: 'terminal'` + `stack: 'browser'`, đúng giới hạn D6; tổ hợp khác bị bỏ im lặng khi cockpit đọc. Vì thế payload hợp lệ theo contract có thể được server xác nhận và lưu nhưng không được UI khôi phục như đã gửi.

**Bằng chứng / tái hiện:** PUT một layout có cột `{ view: 'files', width: 100, stack: 'commits', stackRatio: 50 }` qua `/runs/:id/layouts`. Schema chấp nhận hai trường enum/số độc lập; `writeRunLayouts` ghi `result.data`; khi `reviveState` xử lý, `reviveStack('files', 'commits', 50)` trả `undefined`, nên `stack`/`stackRatio` không xuất hiện trong state UI. Tương tự, `stackRatio` đơn lẻ được schema chấp nhận nhưng không có thành phần render.

**Đề xuất:** thêm xác thực quan hệ tại Zod cho đúng cặp Terminal→Preview và chỉ cho phép `stackRatio` khi có stack; giữ các trường mới optional để layout cũ tiếp tục parse.

## Verified OK

- `packages/contract/src/workspace-layouts.ts` enum gồm `files-tree`, `editor`, `tree`; `stack` và `stackRatio` là optional. `packages/work/src/server/routes/layouts.ts` dùng schema chung ở middleware PUT, đọc/ghi qua storage chung; không có route loose mới trong phạm vi.
- Layout cũ chỉ có `view`/`width` vẫn được reviver xử lý. Cột có view lạ bị bỏ, giới hạn ba cột áp dụng lên cột còn hợp lệ, và `normalizeWidths` chạy sau dedupe để tổng vẫn bằng 100.
- Các thao tác `addColumn`, `setColumnView`, `dropView` và `applySavedLayout` kiểm soát trần ba cột; thao tác liên quan Terminal kiểm tra cả `column.view` lẫn `column.stack`. `setStackRatio` làm tròn hai chữ số và clamp 15–85; `VerticalSplit` cũng clamp giá trị render. Test layout-state có assertion clamp/round và test stack có assertion vùng tách.
- Review seed tạo Chat 55% + Changes 45%. Các deep link cũ có trong `DeepLinkViewId`/`VIEW_PATHS`; tab cố định và số phím lấy cùng thứ tự strip, tránh ánh xạ riêng lệch nhau. View mới chưa có route deep-link được giữ trong workspace; fallback slug tại Task Palette/Notes không được dùng bởi danh sách fixed hiện tại.
- `WorkspaceColumns` chuyển sang một cột đang chọn dưới 1024px, và stack vẫn dùng cùng `VerticalSplit`. Header cột dùng `h-header`; token mới còn được dùng có chủ đích ở header Task Tree/Editor. Branch chip terminal được giới hạn trong vùng tiêu đề để không đẩy tab khỏi hàng.
- Lệnh test chạy riêng từng file, đều thành công:
  - `npm test -- packages/web/src/routes/task-workspace/layout-state.test.ts` — 99 passed.
  - `npm test -- packages/web/src/routes/task-workspace/workbench-wiring.test.tsx` — 5 passed.
  - `npm test -- packages/work/src/server/contract-parity.workspace.test.ts` — 2 passed.
  - `npm test -- packages/web/src/routes/task-workspace/workspace-columns-stack.test.tsx` — 8 passed.

## Not covered

- `agentic-workspace/qa/QA RULES.md` được order tham chiếu nhưng không tồn tại trong checkout hoặc tracked history; do đó audit áp dụng trực tiếp hard rules trong order và repo `AGENTS.md`.
- Không chạy full test suite hoặc browser E2E. Tình huống deep-link Terminal và payload stack sai tổ hợp được xác minh bằng lần theo mã nguồn, chưa chạy bằng browser/API tích hợp.
- Không đánh giá các khu vực agentic-workspace ngoài AREA QA5.

## Tóm tắt

**Số lượng:** CRITICAL 0 · HIGH 0 · MEDIUM 2 · LOW 1 · INFO 0.

**Ba điểm quan trọng nhất:** (1) Workbench mất Terminal/Preview vì preset bốn cột bị cắt còn ba; (2) `/terminal` có thể tạo thêm card khi layout hiện hành đã có Terminal; (3) contract server chấp nhận và lưu stack không tương thích với reviver/client.
