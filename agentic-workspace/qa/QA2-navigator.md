# QA2 — Navigator, rail và shell

## Kết luận

Audit chỉ đọc mã và đối chiếu với baseline `c6db20f` cùng `agentic-workspace/design.md` §12. Có bốn lỗi hành vi và một rủi ro hiển thị: shell sản phẩm không cấp số vùng cho quy tắc rail D5; đóng thread hiện tại từ Navigator không cập nhật URL nên vùng workspace có thể trống; badge dự án không đếm các lỗi thất bại mới được chuyển vào “Needs you”; và worker bị tách khỏi manager khi chúng rơi vào các bucket khác nhau. Khi đổi dự án, lựa chọn rail cũ còn được render đến sau effect đầu tiên. Năm file test liên quan đều chạy thành công trên máy Windows này; các test hiện có không bắt được những lỗi tích hợp nêu trên.

## Phát hiện

| ID | Mức độ | Vị trí | Vấn đề và bằng chứng tái hiện | Hướng sửa |
|---|---|---|---|---|
| A-01 | MEDIUM | `packages/web/src/components/app-shell-container.tsx:170-185`; `packages/web/src/components/app-shell.tsx:105-106,184` | D5 yêu cầu rail tự thu gọn khi có ít nhất 4 vùng. `AppShell` có prop `contentZoneCount` và mặc định `1`, nhưng lời gọi duy nhất từ container không truyền prop này; tìm kiếm toàn `packages/web/src` chỉ thấy khai báo, giá trị mặc định và test truyền trực tiếp vào `AppShell`. Vì vậy trong app thật điều kiện 4 vùng không bao giờ hoạt động; test `app-shell.test.tsx` dòng 165 chỉ kiểm tra component cô lập với prop tự cấp. | Nối số vùng đang hiển thị của workspace vào `AppShell` (và kiểm thử qua container/layout thực tế), hoặc bỏ nhánh D5 nếu sản phẩm chưa có nguồn số vùng. |
| A-02 | MEDIUM | `packages/web/src/lib/use-open-threads.ts:14-23`; `packages/web/src/components/workspace/workspace-host.tsx:126-142,323-331` | Nút đóng của hàng gọi `closeRun`, chỉ xóa pane khỏi store. Trong khi đó handler đóng pane của host (`handleClosePane`) mới điều hướng URL sang pane kế tiếp. Khi đóng thread đang mở từ Navigator, route vẫn là `/tasks/:runId`, state không còn pane khớp route và host trả `null` (`if (!pane || !matchesTarget) return null`), khiến vùng hội thoại trống và URL cũ còn nguyên. Tái hiện: mở một task, bấm nút “Close …” ở hàng task đang mở. Test `task-quick-list.test.tsx:135-148` chỉ xác nhận callback được gọi, không kiểm tra điều hướng hay nội dung sau khi đóng. | Dùng chung handler đóng của host cho Navigator, hoặc để callback điều hướng khi đóng pane hiện tại và chọn pane kế tiếp theo cùng quy tắc của `closePane`. |
| A-03 | MEDIUM | `packages/web/src/components/project-groups.tsx:460-465`; `packages/web/src/lib/task-groups.ts:422-440`; `packages/web/src/lib/attention.ts:111-113` | Nhóm mới chuyển lỗi `failed` không có `autoResumeAt` vào “Needs you” (`isNavigatorNeedsYou`), nhưng badge dự án vẫn lấy `listCounts(...).waiting`; hàm này chỉ đếm `isNeedsYouStatus` (waiting/review/câu hỏi/cleanup), không đếm lỗi thất bại thông thường. Tái hiện bằng một run `status: 'failed'` không có `autoResumeAt`: hàng nằm trong bucket “Needs you” nhưng badge `project-attention` không tăng. Comment tại project-groups nói badge đếm mọi run cần chú ý nên không còn đúng sau thay đổi phân nhóm. | Dùng cùng predicate đếm với bucket Navigator cho badge dự án, đồng thời giữ quy tắc lọc archived và đếm theo toàn bộ runs như thiết kế hiện tại. |
| A-04 | MEDIUM | `packages/web/src/lib/navigator-groups.ts:25-33`; `packages/web/src/components/task-quick-list.tsx:284-292,337-343`; `packages/web/src/components/project-groups.tsx:463-465` | Một worker `failed` được chuyển từ `Recent` sang `Needs you`, còn manager `running` ở `Running`. `QuickListBuckets` gọi `nestRows` riêng cho từng bucket; `buildTaskTree` chỉ nhận các row của bucket đó. Do đó worker trở thành hàng gốc, không còn quan hệ hiển thị với manager. Tái hiện bằng manager đang chạy và child dispatch thất bại: hai hàng ở hai bucket khác nhau. Mã hiện có ghi rõ chủ ý chia cây theo bucket, nhưng §12.1 của thiết kế yêu cầu worker nằm dưới manager; hành vi mới làm mâu thuẫn này dễ gặp hơn. | Giữ liên kết/nhãn manager hiển thị trong bucket cần chú ý, hoặc biểu diễn cây dùng chung giữa bucket nhưng vẫn cho phép worker cần chú ý xuất hiện trong khu vực dễ thấy. |
| A-05 | LOW | `packages/web/src/lib/rail-state.ts:67-85` | `manualOverride` được khởi tạo một lần theo project ban đầu; khi `projectId` đổi, giá trị của project cũ được giữ trong render đầu rồi chỉ đọc project mới trong `useEffect`. Nếu hai project có override trái ngược, rail tạm thời hiển thị theo lựa chọn project cũ rồi đổi sau effect (nhấp nháy khi chuyển project). Có thể tái hiện với project A lưu `collapsed`, project B lưu `expanded` rồi chuyển A → B. | Gắn override trong state với `projectId`, hoặc đọc lựa chọn project hiện hành đồng bộ trước khi tính `collapsed`, để không render state của project trước. |

## Đã xác minh OK

- Quy tắc thu gọn thuần khớp D5 ở `<1360px` và `>=4` vùng; manual override thắng cả hai điều kiện. `rail-state.test.ts`: 6/6 đạt.
- Khóa rail `onni-sidebar-rail:<projectId>` độc lập `onni-sidebar-width`; đọc/ghi bắt lỗi localStorage và giá trị lỗi định dạng bị bỏ qua.
- Đổi kích thước dùng `matchMedia` + `useSyncExternalStore`; ngưỡng 1359/1360 rõ ràng, không dùng listener resize thủ công. Không thấy đường gây nhấp nháy khi chỉ resize.
- Rail dùng link có `aria-label`, tooltip và trạng thái `aria-current`; các mục do `visibleNavItems` cung cấp (Git, GitHub, Tracker, Automations, Skills, Settings, v.v.) được lọc theo capability như sidebar thường. Dashboard, Tasks và nút mở rộng cũng có nhãn.
- Drawer mobile vẫn dùng `SidebarContent` thường, không dùng rail. Sidebar mở rộng giữ width hook cũ; splitter chỉ bị bỏ khi rail bật. `sidebar-frame.test.tsx`: 6/6 đạt.
- `groupNavigatorRows` giữ bucket Pinned/Archived, chuyển các task cần hành động lên trước Running/Recent; lỗi có `autoResumeAt` không bị chuyển nhầm sang “Needs you”. Nhóm biến thể được xét như một hàng.
- `RECENT_LIMIT` vẫn giới hạn tổng hàng thường trước khi regroup; Pinned được miễn cap theo `capBuckets`. `project-groups.test.tsx`: 29/29 đạt.
- `Open` marker lấy từ danh sách thread của workspace; nút đóng là sibling của Link nên không nằm bên trong anchor. Archived view vẫn gom vào Archived. `task-quick-list.test.tsx`: 75/75 đạt.

## Chưa bao phủ

- Chưa chạy kiểm thử trình duyệt/đo UI thực tế khi đổi dự án hoặc đóng thread đang active.
- Không mô phỏng localStorage ném exception trong test; xác nhận xử lý lỗi dựa trên `try/catch` trong mã.
- Không chạy full suite, typecheck hoặc e2e theo quy tắc QA chỉ chạy test hiện có liên quan từng file.
- Kiểm thử đã chạy: `npm test -- packages/web/src/lib/rail-state.test.ts` (6/6), `npm test -- packages/web/src/lib/navigator-groups.test.ts` (2/2), `npm test -- packages/web/src/components/task-quick-list.test.tsx` (75/75), `npm test -- packages/web/src/components/app-shell.test.tsx` (95/95), `npm test -- packages/web/src/components/project-groups.test.tsx` (29/29), `npm test -- packages/web/src/components/sidebar-frame.test.tsx` (6/6); tất cả exit 0.

## Tóm tắt

Số phát hiện: CRITICAL 0 · HIGH 0 · MEDIUM 4 · LOW 1 · INFO 0.
Ba vấn đề cần ưu tiên: (1) số vùng D5 không bao giờ được cấp từ shell thật; (2) đóng thread hiện tại để lại route không có pane và workspace trống; (3) badge dự án không phản ánh các lỗi hiện xuất hiện trong “Needs you”.

