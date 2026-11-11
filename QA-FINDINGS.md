# QA-FINDINGS — lỗi phát hiện khi kiểm thử Agentic Chat Workspace (Phase 0–5)

Ngày: 2026-11-11 · Nhánh kiểm thử: `onni/dac1e69b` · Baseline: `c6db20f` (118 file, +15.040/−2.530).
Nguồn: 9 báo cáo audit chỉ-đọc trong `agentic-workspace/qa/` (QA1…QA9, kèm `QA-SUMMARY.md`). Đây là danh sách lỗi
**chưa được sửa** (giai đoạn QA không được phép sửa mã). Mỗi mục ghi: ID báo cáo, mức độ, vị trí, vấn đề, cách sửa gợi ý.

Tổng: **HIGH 2 · MEDIUM 22 · LOW 5 · INFO 1**.

## 1. HIGH — sửa trước

| ID | Vị trí | Vấn đề | Gợi ý sửa |
| --- | --- | --- | --- |
| QA7-A01 | `packages/work/src/server/routes/workspace-threads.ts`, `workspace-search.ts`, `runs/transcript-search.ts`, `runs/store.ts` | Path traversal: `RunRecord.id` lấy từ `runs.json` của project "lạnh" (chưa mở) được dùng dựng đường dẫn tới file sự kiện của run, nên một `runs.json` độc hại/hỏng có thể đọc (và với `markViewed` ghi) ngoài thư mục run. | Validate id (chỉ ký tự an toàn) và kiểm tra đường dẫn sau khi resolve vẫn nằm trong thư mục run của project, ở mọi nơi route mới đọc file. |
| QA3-A01 | `components/workspace/workspace-host.tsx`, `routes/task-workspace/url-sync.ts` | Split nhiều run: pane luôn render run trên URL, nên URL ↔ pane active không hội tụ (đổi pane active không đổi nội dung đúng run; Back/Forward lệch). | Truyền `runId` của từng pane vào route thật, điều hướng run active qua một helper duy nhất; thêm test tích hợp split + Back/Forward. |

## 2. MEDIUM

### Host / state / URL (QA3, QA4)
- **QA3-A02** — Picker của `SplitTabStrip` có thể biến draft pane thành "run giả" (chọn draft như thể là run). Chặn draft khỏi picker run hoặc xử lý riêng.
- **QA3-A03** — Read receipt bị chặn sau khi đổi sang run có `lastSeq` nhỏ hơn (watermark dùng chung giữa các run). Gắn watermark theo `(projectId, runId)`.
- **QA3-A04** — Mirror pane lên server mất `active`/`split` khi mở quá 50 tab (cắt thread nhưng giữ tham chiếu cũ). Chuẩn hoá trước khi PUT / giữ pane active trong 50 đầu.
- **QA3-A05** — `SplitTabStrip` không là tab control dùng được bằng bàn phím, ARIA liên kết sai (thiếu mũi tên/Home/End, `aria-controls`, tabpanel).
- **QA4-A01** — `new-task-surface.tsx:727-736`: khi schedule từ workspace, `onScheduled()` đóng draft pane rồi surface vẫn `navigate('/')` (→ `/p/<id>`), rời `/new`. Test host mock toàn bộ surface nên không bắt được. Để host sở hữu điều hướng; thêm test tích hợp với surface thật.

### Layout model (QA5)
- **QA5-A01** — Preset Workbench (4 vùng) bị cắt còn 3 cột do giới hạn 3 cột → mất Terminal/Preview. Cần nâng giới hạn (contract + layout-state, additive) hoặc đổi thiết kế preset.
- **QA5-A02** — Deep link `/terminal` có thể tạo terminal thứ hai trong cùng layout (vượt luật "1 terminal mỗi run").
- (LOW) **QA5-A03** — Contract nhận và lưu `stack`/`stackRatio` mà client cũ không hỗ trợ.

### Context panes (QA6)
- **QA6-A01** — `context-sheet.tsx`: Context Sheet mobile luôn dùng `DEFAULT_CONTEXT_VIEWS`, thiếu `files-tree` và `editor` → Workbench không mở được hai pane này trên mobile. Host cần truyền danh sách view khả dụng.
- **QA6-A02** — `context-sheet.tsx`, `task-editor.tsx`: `role="tablist"/"tab"` nhưng chỉ có `onClick` (không mũi tên/Home/End, `aria-controls`, tabpanel).
- **QA6-A03** — `task-tree-pane.tsx`: `role="tree"/"treeitem"` chỉ hỗ trợ Enter/Space, thiếu điều hướng mũi tên và cấp cây.

### Server Phase 5 (QA7)
- **QA7-A02** — Giới hạn 1 MiB mỗi run không chặn được một dòng NDJSON cực lớn (đọc cả dòng vào bộ nhớ). Cần giới hạn theo dòng.
- **QA7-A03** — `markViewed` mất tính đơn điệu giữa hai process (read-modify-write không khoá liên-process).
- **QA7-A04** — Cursor `workspace/threads` bỏ mục khi hai project có cùng `runId` và timestamp (tie-break thiếu `projectId`).
- (LOW) **QA7-A05** — Các guard contract/route-parity chung chưa bao phủ đủ route Phase 5.

### Transport / UX (QA8)
- **QA8-A01** — `use-mark-viewed.ts:102,123-125`: `lastMarkedSeqRef` không gắn với run; đổi sang run có seq thấp hơn thì không bao giờ được đánh dấu đã xem.
- **QA8-A02** — `command-palette.tsx:736-747,1010-1016`: trong 250 ms debounce vẫn hiển thị kết quả transcript của truy vấn cũ trong khi tô sáng theo truy vấn mới → có thể mở nhầm run.
- **QA8-A03** — `run-stream-share.ts` giữ `liveCursor` lúc subscribe; sau compaction, reconnect vẫn dùng cursor cũ (replay thừa). Baseline đọc cursor mới mỗi lần mở lại.
- (LOW) **QA8-A04** — `settings/appearance.tsx`: `Segmented` có `role="radiogroup"` nhưng thiếu phím mũi tên/roving tabindex.

### Navigator (QA2)
- **QA2-A01** — Quy tắc rail "≥4 vùng" (D5) không bao giờ hoạt động: `AppShellContainer` không truyền `contentZoneCount`.
- **QA2-A02** — Nút đóng thread ở Navigator chỉ xoá pane khỏi store, không điều hướng như `handleClosePane` của host → URL cũ còn, vùng hội thoại trống.
- **QA2-A03** — Badge dự án đếm bằng `listCounts().waiting`, không đếm run `failed` (không `autoResumeAt`) dù hàng nằm ở nhóm "Needs you".
- **QA2-A04** — Worker lỗi chuyển sang "Needs you" bị tách khỏi manager đang "Running" vì cây được dựng riêng theo bucket (trái §12.1).
- (LOW) **QA2-A05** — `rail-state.ts:67-85`: `manualOverride` giữ giá trị project cũ một render khi đổi project → rail nhấp nháy.

### Splitter (QA1)
- **QA1-A01** — `use-splitter.ts`: không lưu `pointerId`, không có `onLostPointerCapture`; mất capture để lại drag "sống", pointer khác có thể đổi/commit nhầm. Ảnh hưởng cả 5 handle (sidebar, cột, drawer, cây Git, VerticalSplit).
- (LOW) **QA1-A02** — `VerticalSplit` tích hợp không truyền `labels.separator` → tên chung "Resize panels".
- (INFO) **QA1-A03** — Test đặc trưng dùng callback `vi.fn()` không điều khiển state nên không bắt được lỗi stale/rapid-key.

### Hồi quy (QA9)
- **QA9-A02** — `routes/settings/settings.test.tsx` còn 5 test khẳng định lựa chọn accent / `data-accent="violet"` (đã xác minh: 5 fail / 37 pass). Hệ quả của quyết định D1 (accent violet cố định); cần cập nhật test.

## 3. Đã đối chiếu — KHÔNG phải lỗi mã
- **QA9-A01 (báo HIGH)**: worktree của worker QA không có `node_modules` riêng nên `@onni/contract` bị lấy từ checkout cha (artefact môi trường). Trong worktree có `npm install`: `contract-workspace-threads.test.ts` 16/16 pass, `npm run typecheck` và `npm run build` exit 0.
- **QA9-A03 (`runs/store-concurrency.test.ts`)**: chạy riêng 15/15 pass → lỗi do tải khi chạy cả nhóm.
- Lỗi ENV-ONLY dự báo trong AGENTS.md (EPERM, chmod 0600 vs 0666, `bash ENOENT`, POSIX path, push fence) — không xử lý.
- Chưa phân loại: 2 test Mermaid (theme SVG, source copy) và 12 timeout workflow/lifecycle.

## 4. Thứ tự sửa đề xuất
QA7-A01 → QA3-A01 → QA5-A01/A02 → QA8-A01 → QA2-A02 → QA4-A01 → QA6-A01 → QA7-A02/A03/A04 → QA3-A02..A05 → còn lại; cập nhật `settings.test.tsx`; thêm test tích hợp mà các báo cáo chỉ ra (host với `NewTaskSurface` thật, split + Back/Forward, controlled harness cho splitter).

## 5. Chưa bao phủ bởi QA
Không có kiểm thử trên trình duyệt/desktop thật và đối chiếu thị giác với 3 ảnh reference; không chạy `npm run test:e2e`, `test:unit`, `test:package`.
