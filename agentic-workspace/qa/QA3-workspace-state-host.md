# QA3 — workspace state, host, URL sync và pane mirror

## Kết luận

Kết quả audit cho thấy lớp lưu trạng thái cục bộ có xử lý tốt dữ liệu `localStorage` hỏng, cô lập theo project, và phần lớn reducer bảo toàn các bất biến cơ bản. Tuy nhiên, đường tích hợp route thật chưa nối `runId` của pane vào `TaskWorkspaceRoute`; vì vậy 2-up không thể hiển thị hai run độc lập và thao tác chọn pane bị effect URL đảo ngược. Ngoài ra còn có lỗi khi chọn draft từ picker, read-receipt không reset giữa các run, mirror vượt ngưỡng 50 tab và tab strip không dùng được bằng bàn phím. Đây là các lỗi chức năng/a11y thực tế, không phải chỉ thiếu test.

## Findings

### A-01 — HIGH — split đa-run luôn render run trên URL và không hội tụ URL ↔ active pane

- **Vị trí:** `packages/web/src/routes.tsx:245-249`, `packages/web/src/routes/task-workspace/task-workspace.tsx:98-112`, `packages/web/src/components/workspace/workspace-host.tsx:121-124, 217`.
- **Vấn đề:** `WorkspaceHost.renderRun` gọi callback với `(view, pane.runId, pane)`, nhưng route adapter chỉ nhận `activeView` rồi tạo `<TaskWorkspaceRoute view={activeView} />`. `TaskWorkspaceRoute` lại lấy duy nhất `id` bằng `useParams()`, không nhận `runId` của pane. Đồng thời `activate()` chỉ cập nhật state, không gọi navigation helper. Khi người dùng click pane B, effect tại `task-workspace.tsx:105-114` thấy URL vẫn là run A và gọi `openRun(...A)`, đưa active trở lại A.
- **Tái hiện/evidence:** Khởi tạo `threads=[A,B]`, `split={a:A,b:B}`, mở `/p/shop/tasks/A`, rồi click tab B/pointer-down pane B. Dữ liệu host chuyển active sang B, nhưng hai instance `TaskWorkspaceRoute` đều đọc `:id=A`; effect route sau đó focus lại A. Design §11.4 yêu cầu path là active run, đổi run phải **push**, và local action phải đi qua một navigation helper. Test `workspace-host.test.tsx` dùng `RunHost` mock có truyền `runId`, nên 13 test xanh nhưng không chạy adapter thật ở `routes.tsx`.
- **Đề xuất:** Đổi seam render để `TaskWorkspaceRoute` nhận `runId` tường minh (không bắt buộc lấy `useParams` cho pane), và đưa activate/select/close/pick vào helper duy nhất thực hiện `push` khi run active đổi. Thêm integration test qua `AppRoutes`/adapter thật: split A+B, click/pointer-down B, xác nhận URL, active state và hai query/stream đều tương ứng A/B; kiểm tra Back/Forward.

### A-02 — MEDIUM — picker có thể biến draft thành một run giả

- **Vị trí:** `packages/web/src/components/workspace/split-tab-strip.tsx:56-57, 132-137`; `packages/web/src/components/workspace/workspace-host.tsx:222`; `packages/web/src/lib/workspace-state.ts:144-179`.
- **Vấn đề:** `otherThreads` chứa cả `RunPaneRef` lẫn `DraftPaneRef`. Khi chọn draft, tab strip truyền `thread.paneId`; `openBeside()` tìm string này chỉ trong run panes. Không tìm thấy thì nó tạo `RunPaneRef` mới với `runId` bằng chính paneId của draft.
- **Tái hiện/evidence:** Với split run A/run B và một draft `paneId='draft:shop'`, chọn `New task` trong “Pick thread”. Callback truyền `'draft:shop'`; nhánh fallback của `openBeside` tạo `{ kind:'run', paneId:'run:shop:draft:shop', runId:'draft:shop' }`, thay vì đưa draft thật vào split. Đó là một run không tồn tại và vi phạm mô hình union trong design §11.3.
- **Đề xuất:** Cho picker truyền `PaneRef` hoặc `paneId` được resolver trên cả hai kind, và để `openBeside` nhận/giữ nguyên draft. Thêm test chọn draft khi split đang bật; assert không tạo run giả và split trỏ tới pane draft ban đầu.

### A-03 — MEDIUM — read receipt bị chặn sau khi đổi sang run có sequence nhỏ hơn

- **Vị trí:** `packages/web/src/components/workspace/use-mark-viewed.ts:102, 121-136`.
- **Vấn đề:** `lastMarkedSeqRef` sống qua mọi lần thay `runId`, nhưng sequence chỉ đơn điệu *trong một run*, không phải giữa các run. Guard `currentLastSeq <= lastMarkedSeqRef.current` vì thế có thể chặn run mới vĩnh viễn.
- **Tái hiện/evidence:** Pane A được mark ở `seq=100`, sau đó 1-up/mobile chuyển hook cùng vị trí sang pane B có `lastSeq=3`, `lastViewedSeq=0`. Ref vẫn là 100; điều kiện dòng 124 đúng (3 ≤ 100) nên không lập timer/mutation cho B cho đến khi B vượt 100 event. Test hiện có chỉ rerender `lastSeq` cùng `runId='run-1'` (`use-mark-viewed.test.ts`), không có case đổi run.
- **Đề xuất:** Reset ref khi `runId` (và hợp lý cả `projectId`) thay đổi, hoặc lưu watermark theo khóa `projectId/runId`. Thêm test rerender A seq cao → B seq thấp và xác nhận mutation B được gửi sau debounce.

### A-04 — MEDIUM — server mirror mất active/split khi vượt 50 tab mở

- **Vị trí:** `packages/web/src/lib/workspace-panes-sync.ts:27-56`.
- **Vấn đề:** Payload cắt `threads` còn 50 nhưng chép nguyên `active` và `split`. Nếu active hoặc một nửa split ở tab thứ 51+, các ID đó không nằm trong payload. Server bình thường hóa chúng thành `undefined`/`'none'` (`packages/work/src/server/routes/workspace-panes.ts:37-68`), nên trạng thái mirror khác local và khôi phục ở máy/tab khác mất selection/split.
- **Tái hiện/evidence:** Mở 51 run (design §8 nói open tabs không giới hạn), active tab 51, rồi `toWorkspacePanesPayload(state)`. `threads` chỉ chứa 1..50 nhưng `active` là pane 51. Contract chỉ giới hạn mảng ở 50, không tự liên kết active/split với mảng (`packages/contract/src/workspace-threads.ts:167-171`); server nhận HTTP 200 nhưng bỏ active. `workspace-panes-sync.test.ts` chỉ kiểm tra payload nhỏ.
- **Đề xuất:** Chọn chính sách retention xác định gồm active và hai split panes (loại các tab cũ hơn nếu cần), rồi chỉ gửi active/split khi cả ID còn retained. Thêm test 51+ tabs cho active ngoài cutoff và split có pane ngoài cutoff, đồng thời assert payload/round-trip server hợp lệ.

### A-05 — MEDIUM — SplitTabStrip không phải tab control có thể dùng bằng bàn phím và ARIA liên kết sai

- **Vị trí:** `packages/web/src/components/workspace/split-tab-strip.tsx:64-119`; `packages/web/src/components/workspace/workspace-host.tsx:142-159`.
- **Vấn đề:** Mỗi “tab” là `<div role="tab">` không có `tabIndex`, không có xử lý Arrow/Home/End, và chứa nested `<button>` Close. Vì vậy tab không focus/activate bằng keyboard, trong khi button close lại là focusable bên trong một widget tab. `aria-controls={paneId}` cũng trỏ tới ID không tồn tại: section panel chỉ có `data-pane-id`, không có `id={paneId}`. Đây không thỏa quan hệ tab/tablist/tabpanel và làm ActivePane không ARIA-clear theo yêu cầu design §4.
- **Tái hiện/evidence:** Dùng Tab trên desktop split: focus bỏ qua các `div[role=tab]` và chỉ tới Close/Pick/Unsplit; ArrowLeft/ArrowRight không đổi pane. Kiểm tra DOM cho thấy không có phần tử `id` khớp `aria-controls` ở dòng 69/99.
- **Đề xuất:** Dùng một `<button role="tab">` focusable cho activation, đặt Close là action lân cận (không lồng trong tab), gán ID ổn định cho tab và `role="tabpanel"`/`aria-labelledby` cho pane; bổ sung navigation bàn phím theo WAI-ARIA tabs hoặc dùng UI khác không tự nhận role tab.

## Verified OK

- `normalizeWorkspaceState()` loại JSON không phải object, pane cross-project, paneId trùng, draft trùng, active/split dangling; `readWorkspaceState()` và `writeWorkspaceState()` bắt lỗi parse/quota/private-mode để rơi về default an toàn (`workspace-state.ts:240-347`).
- Key `onni-workspace:<projectId>` và `Map` store tách project; test xác nhận project khác không đọc state của nhau (`workspace-state.test.ts`).
- `openDraft()` duy trì tối đa một draft/project và đóng context; `promoteDraft()` giữ nguyên paneId; `closePane()` xóa split tham chiếu pane đã đóng; `enableSplit()` từ chối ID lạ/trùng và giới hạn đúng hai pane visible.
- Hydrate chỉ dùng server khi local ban đầu trống, bảo toàn navigator/context local, không PUT default rỗng khi GET chưa xong; timer debounce có cleanup (`workspace-panes-sync.ts:99-173`).
- `getVisibleRunIds()` chỉ đánh dấu tối đa hai run ở desktop split và chỉ active run ở mobile; listener `visibilitychange` và debounce timer của read receipt đều cleanup đúng (`use-mark-viewed.ts`).
- Host chỉ mount một pane ở mobile, hai pane ở desktop split; tabs bị ẩn ngoài split không được render. Các test đơn lẻ chạy xanh: `workspace-state` 12/12, `workspace-host` 13/13, `workspace-panes-sync` 10/10, `use-mark-viewed` 15/15.

## Not covered

- Không chạy full suite/e2e theo lệnh audit. Không tạo scratch test hay sửa source/test.
- `npx tsc --noEmit -p packages/web` hiện fail tại `routes/task-workspace/use-workspace-layouts.ts:225` vì type `ViewId` chứa `editor` còn một consumer chưa cập nhật; đó nằm ngoài file/đường QA3 nên không ghi như finding QA3.
- Chưa kiểm thử trực tiếp trên browser thật với Back/Forward, EventSource và quota thật; finding A-01/A-02/A-03/A-04 được trace end-to-end qua code và test seam hiện hữu.

## Tóm tắt

**CRITICAL 0 · HIGH 1 · MEDIUM 4 · LOW 0 · INFO 0.** Ba finding quan trọng nhất: (1) A-01 làm split multi-run/URL sync không hoạt động trong route thật; (2) A-02 tạo run giả khi picker chọn draft; (3) A-03 khiến unread/read receipt sai sau khi đổi run có sequence nhỏ hơn.
