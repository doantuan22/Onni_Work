# QA6 — Context panes

## Kết luận

Đợt audit chỉ-đọc QA6 xác nhận luồng đọc file từ Workbench được backend bảo vệ đúng trước traversal, đường dẫn tuyệt đối, `.git` và symlink; editor chỉ hiển thị, đồng thời trạng thái loading/lỗi/rỗng, file nhị phân và file quá lớn được phân biệt rõ. Review panel đã chuyển sang rich `Diff`, vẫn chuyển comment về đúng `run.id` và vẫn nêu rõ không có auto-merge. Tuy nhiên, Context Sheet trên màn hình hẹp không đưa hai pane mới của Workbench vào danh sách thao tác, và các control khai báo ngữ nghĩa ARIA `tab`/`tree` chưa thực hiện mô hình bàn phím tương ứng.

## Findings

| ID | Mức độ | Vị trí | Vấn đề, bằng chứng và cách tái hiện | Hướng sửa đề xuất |
| --- | --- | --- | --- | --- |
| A-01 | MEDIUM | `packages/web/src/components/workspace/context-sheet.tsx:15-22`, `packages/web/src/components/workspace/workspace-host.tsx:300-319,371-390` | Mobile Context Sheet luôn dùng `DEFAULT_CONTEXT_VIEWS`, chỉ có `changes`, `files`, `terminal`, `browser`, `commits`, `tree`; hai `ViewId` Workbench là `files-tree` và `editor` (được khai báo tại `layout-state.ts:35-36` và thực sự render tại `task-workspace.tsx:750-769`) không xuất hiện. Hai lần gọi `ContextSheet` không truyền prop `views`. Tái hiện: ở viewport hẹp, mở Context từ một task rồi xem thanh tab — không có Files tree hoặc Editor, vì vậy Workbench không thể mở hai pane này theo thiết kế §12.2 và quy tắc mobile của §4. | Truyền danh sách view khả dụng từ host, bao gồm `files-tree` và `editor` (và lọc Terminal theo capability), hoặc bổ sung chúng vào default có điều kiện. Thêm test mobile/host khẳng định cả hai tab hiện diện và chọn được. |
| A-02 | MEDIUM | `packages/web/src/components/workspace/context-sheet.tsx:80-114`; `packages/web/src/routes/task-git/task-editor.tsx:24-86` | Các phần tử được gán `role="tablist"`/`role="tab"` nhưng chỉ xử lý `onClick`; không có xử lý `ArrowLeft`/`ArrowRight`/`Home`/`End`, `aria-controls`, id cho tab, hoặc vùng nội dung `role="tabpanel"` liên kết. Tái hiện: mở Context Sheet hoặc Editor, focus một tab rồi nhấn ArrowRight — selection/focus không đổi, vì mã chỉ có `onClick`. Điều này không tuân theo keyboard interaction của ARIA Tabs và làm người dùng bàn phím/trình đọc màn hình khó chuyển pane. | Dùng primitive Tabs đã hỗ trợ roving focus, hoặc triển khai đầy đủ keyboard handler, `id`/`aria-controls` và một `tabpanel` được gắn nhãn. Viết test cho Arrow, Home/End và liên kết tab–panel. |
| A-03 | MEDIUM | `packages/web/src/routes/task-tree/task-tree-pane.tsx:283-308,388-406` | Row dispatched khai báo `role="tree"`/`role="treeitem"`, nhưng handler chỉ kích hoạt bằng Enter/Space; không có ArrowUp/ArrowDown/Home/End để di chuyển focus, cũng không có ArrowLeft/ArrowRight để điều hướng cấp cây. Tái hiện: focus một `task-tree-row` rồi nhấn ArrowDown — focus không chuyển sang row kế tiếp. Đây là sai mô hình bàn phím của ARIA Tree; các node lồng nhau đang hiển thị bằng `aria-level` nên lỗi tác động trực tiếp tới điều hướng task tree bằng bàn phím. | Hoặc đổi sang danh sách các `<button>` nếu không cần tương tác kiểu tree, hoặc bổ sung roving tabindex và toàn bộ keyboard contract Tree (kể cả focus/expand nếu có). Thêm test cho ArrowUp/Down, Home/End và cả cây lồng nhau. |

## Verified OK

- Đường dẫn từ cây file đi qua `getRunFile`; server gọi `readWorktreePath` (`packages/work/src/server/git-changes.ts:690-759`), dùng `resolve` + kiểm tra containment, chặn NUL, `.git`, symlink cuối và symlink trung gian. Vì vậy `../`, absolute/Windows escape và symlink escape không được phục vụ.
- `TaskEditor` chỉ dùng `FilePreview`; không có `textarea`, `input` hay `contenteditable` để sửa nội dung. Test `task-editor.test.tsx` cũng khẳng định điều này.
- Open-file store được key theo `runId` cả ở Map lẫn `sessionStorage` (`task-open-files.ts:11-14,97-119`), nên hai run không chia sẻ tab đã mở; dữ liệu storage lỗi bị fail-safe về trạng thái rỗng.
- `FilePreview` phân biệt rỗng/loading/lỗi/dir, và hiển thị riêng image, too-large, binary, text (`file-preview.tsx:60-103,169-204`); backend không gửi content cho binary hoặc quá cap.
- Task tree giữ dispatched run và runner subagent ở hai section/count khác nhau. `buildTaskTree` có brake cho self/cycle (`task-tree.ts:70-108`), và test cycle xanh.
- Click task tree gọi `onOpenRun`, còn wiring dùng `useNavigate` scope-aware tới `/tasks/${targetRunId}` (`task-workspace.tsx:770-777`, `project-router.tsx:119-126`), nên giữ đúng project hiện hành.
- Review panel dùng `Diff`, comment store theo `run.id`, Send back/Draft PR/Accept vẫn đi qua các action cũ; banner vẫn ghi “Nothing merges on its own.” So sánh với `c6db20f` cho thấy đây là thay thế `RunDiff`, không phải thay đổi flow merge.
- `Sheet` được dùng làm dialog chuẩn nên focus trap và Escape được primitive đảm trách; không thấy tự tạo dialog/focus listener rò rỉ trong QA6.
- `npm test -- packages/web/src/design-guardian.test.ts` xanh (10 tests), không phát hiện vi phạm token design guardian trong bề mặt audit.

## Kiểm thử đã chạy

- `npm test -- packages/web/src/lib/task-open-files.test.ts` — 3 passed.
- `npm test -- packages/web/src/routes/task-git/task-editor.test.tsx` — 4 passed.
- `npm test -- packages/web/src/routes/task-git/task-files-tree.test.tsx` — 1 passed.
- `npm test -- packages/web/src/lib/task-tree.test.ts` — 26 passed.
- `npm test -- packages/web/src/routes/task-tree/task-tree-pane.test.tsx` — 6 passed.
- `npm test -- packages/web/src/components/workspace/context-sheet.test.tsx` — 5 passed.
- `npm test -- packages/web/src/routes/task-thread/review-panel.test.tsx` — 24 passed.
- `npm test -- packages/web/src/routes/task-workspace/workbench-wiring.test.tsx` — 5 passed.
- `npm test -- packages/web/src/design-guardian.test.ts` — 10 passed.

## Not covered

- Không chạy e2e browser thực với screen reader hoặc thiết bị di động vật lý; các finding keyboard dựa trên handler và DOM hiện có.
- Không khởi động server/worktree thật để thực hiện request file end-to-end; đánh giá path security dựa trên đọc toàn bộ client → route → `readWorktreePath` và test server hiện hữu.
- Không kiểm thử tải rất lớn/độ dài phiên thực tế của `sessionStorage`; store được xác minh key theo run, không thấy cross-run leak.

## Tóm tắt

- CRITICAL: 0; HIGH: 0; MEDIUM: 3; LOW: 0; INFO: 0.
- Ba finding quan trọng nhất: A-01 (mobile không truy cập được Files tree/Editor), A-02 (tab keyboard semantics thiếu), A-03 (task tree keyboard semantics thiếu).
