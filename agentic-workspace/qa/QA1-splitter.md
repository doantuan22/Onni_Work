# QA1 — splitter hook và các tay nắm

## Kết luận

Việc gom cơ chế kéo/phím vào `useSplitter` nhìn chung giữ đúng hành vi nền: sidebar, cây file và drawer vẫn dùng px; divider cột và vertical stack dùng phần trăm; giới hạn cặp cột, chiều kéo ngược của drawer, Home/End, reset kép chuột và `aria-valuenow` vắng mặt khi chiều rộng tree là `null` đều không bị đổi sai. Tuy nhiên primitive mới chưa đóng trạng thái kéo khi browser mất pointer capture (và không khóa `pointerId` đang kéo), nên một sự kiện từ pointer khác có thể tiếp tục/hoàn tất sai lần kéo. Vertical split được thêm mới cũng có tên truy cập quá chung chung tại nơi tích hợp thực tế. Bộ test hẹp chạy xanh, nhưng có vài characterization test không dựng state có kiểm soát nên chưa chứng minh trải nghiệm người dùng sau nhiều thao tác.

## Findings

| ID | Mức độ | Vị trí | Vấn đề | Bằng chứng / tái hiện | Đề xuất |
| --- | --- | --- | --- | --- | --- |
| A-01 | MEDIUM | `packages/web/src/components/splitter/use-splitter.ts:26,44-60,85-88` | Hook không lưu `pointerId` đã bắt, không trả về `onLostPointerCapture`, và mọi `pointermove`/`pointerup` đều thao tác trên một `drag.current`. Nếu capture mất do DOM/browser/OS hủy, trạng thái kéo vẫn còn; pointer khác có thể đổi giá trị hoặc kết thúc/commit nhầm lần kéo. Lỗi áp dụng cho sidebar, divider cột, drawer, tree và VerticalSplit vì tất cả chỉ gắn `pointerdown/move/up/cancel`. | Đọc đường đi đầy đủ: `onPointerDown` chỉ lưu `{ coordinate, value, latestValue }` ở dòng 38; `onPointerMove` không so `event.pointerId` (44-53); `onPointerEnd` cũng không so id (55-61); object trả về không có handler `lostpointercapture` (85-88). Tái hiện: bắt pointer 1, browser phát `lostpointercapture`, sau đó phát `pointermove` hoặc `pointerup` từ pointer 2 trên handle — callback vẫn dùng drag của pointer 1. Không test nào tìm thấy bằng `rg "lostpointercapture|onLostPointerCapture" packages/web/src`; 29 test splitter hẹp vẫn xanh. | Lưu `pointerId` cùng origin; bỏ qua event không cùng id. Trả về handler `onLostPointerCapture` để dọn `drag.current` (và quyết định rõ cancel không commit), sau đó gắn nó vào cả năm wrapper. Bổ sung test cho mất capture, cancel và pointer id khác. |
| A-02 | LOW | `packages/web/src/routes/task-workspace/workspace-columns.tsx:227-253,310-336`; `packages/web/src/components/vertical-split.tsx:52` | Tích hợp VerticalSplit chỉ truyền nhãn top/bottom, không truyền `labels.separator`; do đó separator thực tế luôn có tên mặc định chung chung `Resize panels`. Khi có nhiều cột stack, người dùng trình đọc màn hình không biết separator nào đổi Terminal/Preview nào. | Hai lời gọi `VerticalSplit` chỉ tạo `{ top, bottom }` (237-239 và 318-320); component rơi vào `labels?.separator ?? 'Resize panels'` tại dòng 52. Test primitive truyền riêng `separator: 'Resize terminal'`, vì vậy không xác nhận tên ở nơi dùng thật; test workspace chỉ kiểm orientation/giá trị ARIA. | Tạo nhãn separator có ngữ cảnh ở `WorkspaceColumns`, ví dụ “Resize Terminal and Preview panels”, dựa trên `viewLabel(column.view)` và `viewLabel(column.stack)`, rồi test tên role tại nơi tích hợp. |
| A-03 | INFO | `packages/web/src/routes/task-workspace/column-divider.characterization.test.tsx:10-24`; `packages/web/src/routes/task-workspace/drawer-resize-handle.characterization.test.tsx:22-37` | Hai characterization test dùng callback `vi.fn()` không cập nhật prop/state. Chúng chỉ chứng minh danh sách đối số callback từ giá trị render đầu tiên, không chứng minh ARIA và giá trị kế tiếp sau chuỗi thao tác nhanh như người dùng thực. Vì vậy không bắt được regression liên quan state cập nhật, rapid key repeat hoặc stale closure. | Column test giữ `width=33` suốt hai key events và chỉ kiểm `resizeColumns(…, 2)` rồi `(…, -10)`. Drawer test cũng giữ `height=320` và kiểm `[336,256,640,120]`; không có controlled harness hay assertion `aria-valuenow` sau mỗi event. Lệnh test hẹp chạy 29/29 pass nhưng không bao phủ trường hợp này. | Đổi các test này sang harness controlled (áp callback vào state), gửi nhiều key events/pointer moves liên tiếp và kiểm cả giá trị hiển thị lẫn callback. Thêm case clamp ở hai đầu, pointer cancel/lost capture và container có kích thước 0. |

## Verified OK

- Đối chiếu `git diff c6db20f` cho từng handle: đơn vị px/% và chiều tăng/giảm được giữ. Drawer vẫn tính kéo lên là cao hơn (`start - delta`) và map `ArrowUp/Home` đến cao hơn, `ArrowDown/End` đến thấp hơn.
- `ColumnDivider` vẫn dùng ràng buộc theo tổng cặp kề nhau: `dividerFloor(pair)` đến `pair - dividerFloor(pair)`; state transition `resizeColumns` cũng kẹp cả hai pane.
- Pointer down vẫn chỉ nhận nút chính, gọi `setPointerCapture`, `preventDefault` và focus. Up/cancel gọi release khi handle còn sở hữu capture; các hành vi này khớp baseline.
- Keyboard: Shift dùng `largeStep` khi adapter khai báo (cột 10%, drawer 64px, vertical 10%); sidebar/tree không khai báo large step nên giữ step cũ. Home/End đúng hướng của drawer; tree vẫn reset bằng double-click và bỏ hẳn `aria-valuenow` khi width chưa được lưu.
- `useSplitter` lưu `latestValue` khi move; nếu adapter có `onCommit`, pointer up sẽ nhận chính giá trị move đã tính thay vì đọc range cũ. Hiện không có adoption nào truyền `onCommit`.
- VerticalSplit: ratio mặc định do layout truyền là 58/42, minimum mặc định là 15, separator có `role=separator`, orientation horizontal, range 15–85, ArrowUp/Down, Shift, Home/End và double-click về 58. Grid kẹp ratio đầu vào vào range trước khi render.
- Với divider cột có container rộng 0, `pointerToValue` trả `null` nên không cập nhật; tree clamp theo kích thước parent và vertical split không chia cho 0. Không có hỗ trợ RTL riêng trong codebase, và quy tắc vật lý theo trục X giữ nguyên baseline.
- Adapter object tạo lại mỗi render khiến callback hook tạo lại; đây không tạo listener/effect hay stale closure, và các callback chỉ được gắn vào DOM handle, nên không xác nhận được lỗi chức năng từ điểm này.
- `npm test -- packages/web/src/components/splitter/use-splitter.test.tsx packages/web/src/components/vertical-split.test.tsx packages/web/src/components/sidebar-frame.test.tsx packages/web/src/routes/task-git/tree-pane-resize.test.tsx packages/web/src/routes/task-workspace/column-divider.characterization.test.tsx packages/web/src/routes/task-workspace/workspace-columns-stack.test.tsx packages/web/src/routes/task-workspace/drawer-resize-handle.characterization.test.tsx` — 7 files, 29 tests pass.
- `git diff --check c6db20f -- <6 file nguồn trong phạm vi>` không báo whitespace error; `git diff --name-only -- packages/` rỗng trước khi viết báo cáo.

## Not covered

- Không chạy full test suite theo QA-RULES. `npm run typecheck -w @onni/web` thất bại do lỗi ngoài phạm vi tại `src/routes/task-workspace/use-workspace-layouts.ts:225`: `ViewId` đã có `editor` nhưng type suy diễn của `applySavedLayout` chưa gồm `editor`; đây không phải thay đổi từ report QA1.
- Không thể kiểm thử browser thật/thiết bị touch hay RTL trong audit này; các kết luận pointer dựa trên đường đi event và test jsdom hiện hữu.
- Không sửa mã nguồn hoặc test; chỉ tạo report này.

## Tóm tắt

- CRITICAL: 0; HIGH: 0; MEDIUM: 1; LOW: 1; INFO: 1.
- Ba điểm quan trọng nhất: mất/nhầm pointer capture để lại drag sống (A-01); separator VerticalSplit thiếu ngữ cảnh khi screen reader dùng layout stack (A-02); characterization tests chưa chứng minh state thực sau chuỗi input (A-03).
