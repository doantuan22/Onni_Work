# QA8 — Audit transport, unread, shortcuts, palette và token

## Kết luận
Audit đọc mã và các đường gọi liên quan cho thấy ba lỗi mức MEDIUM: watermark đánh dấu đã xem không được đặt lại khi hook chuyển sang run khác; palette có thể hiển thị và cho chọn kết quả của truy vấn cũ trong khoảng debounce; kết nối SSE dùng lại cursor ban đầu dù lịch sử đã cập nhật cursor. Các bộ test tập trung đều xanh, nhưng chưa bao phủ ba chuyển trạng thái này. Tìm kiếm snippet được render an toàn qua React, phím tắt được chặn ở input/xterm/dialog và token violet đạt WCAG AA trên các bề mặt đã kiểm tra. Có thêm một điểm a11y mức LOW ở nhóm radio mới.

## Findings

| ID | Mức độ | Vị trí | Vấn đề và bằng chứng tái hiện | Gợi ý sửa |
|---|---|---|---|---|
| A-01 | MEDIUM | `packages/web/src/components/workspace/use-mark-viewed.ts:102,123-125` | `lastMarkedSeqRef` khởi tạo một lần cho vòng đời hook, nhưng không gắn với `projectId`/`runId`. Khi `WorkspaceHost` đổi run hiển thị mà vẫn giữ component, ví dụ run A đã đánh dấu đến seq 20 rồi chuyển sang run B có `lastSeq=10`, `lastViewedSeq=5`, điều kiện `currentLastSeq <= lastMarkedSeqRef.current` chặn mutation của run B; run B tiếp tục unread dù đang được xem. `useMarkViewed` gọi hook theo các run hiện đang hiện trên workspace tại `workspace-host.tsx:98`. | Đặt lại watermark khi định danh `(projectId, runId)` đổi, hoặc lưu watermark theo từng định danh; thêm test rerender với run mới có sequence thấp hơn. |
| A-02 | MEDIUM | `packages/web/src/components/command-palette.tsx:736-747,1010-1016` | `useDebouncedSearch` giữ `debouncedSearch` cũ 250 ms sau khi input đổi. Trong thời gian đó, `isSearchActive` và `transcriptSearch` vẫn dùng truy vấn cũ nên `transcriptItems` vẫn là kết quả cũ, trong khi hàng được tô sáng bằng `trimmedSearch` mới (`:1013`). Người dùng gõ thêm ký tự rồi chọn ngay có thể mở run/snippet không khớp nội dung đang tìm. | Chỉ hiển thị kết quả khi truy vấn đã debounce bằng truy vấn hiện tại, hoặc hiển thị query tương ứng với kết quả; thêm test đổi truy vấn khi request cũ đã có dữ liệu. |
| A-03 | MEDIUM | `packages/web/src/api/run-events.ts:247,274-280`; `packages/web/src/api/run-stream-share.ts:64-65,113-117,281-285`; `packages/web/src/api/run-history.ts:219-270,294-302` | Hook khởi tạo share với `newestPage.liveCursor`, nhưng effect chỉ gọi `updateWatermark(afterSeq)` và không truyền cursor mới. `run-stream-share` giữ cursor đã nhận ban đầu rồi dùng nó trong `openSource()` khi reconnect. Khi compaction thay `newestPage` bằng trang có `liveCursor` mới (`run-history.ts:268-270`), reconnect tiếp theo vẫn gửi cursor cũ; với run kéo dài, server có thể replay phần transcript lớn hơn cần thiết. So với baseline, hook cũ đọc `optionsRef.current.cursor` mỗi lần mở lại; share mới chụp cursor ở thời điểm subscribe. | Đồng bộ cursor mới vào shared stream khi page/cursor cập nhật; thêm kiểm thử compaction rồi reconnect để xác nhận URL dùng cursor mới. |
| A-04 | LOW | `packages/web/src/routes/settings/appearance.tsx:72-88` | `Segmented` gán `role="radiogroup"`/`role="radio"` lên các button, nhưng mỗi button vẫn nhận Tab riêng và không có điều hướng mũi tên trong nhóm. Người dùng bàn phím có thể Tab/Enter từng lựa chọn, nhưng nhóm radio không có thao tác bàn phím chuẩn như các radio group ARIA. | Dùng radio group có hỗ trợ bàn phím, hoặc triển khai roving `tabIndex` và phím mũi tên; kiểm thử thao tác bàn phím cho nhóm. |

## Đã xác minh OK

- Chia sẻ EventSource theo `(project, run)` dùng ref-count; hủy đăng ký lặp không đóng stream của subscriber còn lại; subscriber cuối cùng hủy thì stream, timer liveness/reopen và listener trang được dọn. Test `run-stream-share` (10) và `run-events` (30) đều qua.
- Replay/dedupe vẫn lọc theo sequence ở từng consumer; khi `enabled=false`, history query và SSE bị tắt, và trạng thái pending không báo đang tải. Test `run-history` (21) qua.
- Read state: `lastViewedSeq === lastSeq` là đã đọc; thiếu receipt dùng fallback `seenAt` cho run kết thúc; cancelled, archived, scheduled resume và unanswered ask không bị gắn unread; pane đang nhìn không unread. Test `read-state` (30) qua.
- Debounce mark-viewed hủy timer khi unmount/ẩn document và chạy lại khi document hiện lại. Test `use-mark-viewed` (15) qua, ngoại trừ chuyển identity chưa được kiểm tra như A-01.
- Chord `Mod+1..9` không bị dùng cho workspace switch; `Alt+1..9` và các chord workspace được reserve để Settings → Keyboard không thể chiếm. Guard nhường cho input, xterm, dialog/menu/listbox. Test shortcut (16) và keybindings (16) qua.
- Snippet được highlight bằng React node (`<mark>{part}</mark>`), không dùng `dangerouslySetInnerHTML`; token tìm kiếm được escape trước khi tạo regex. Không thấy đường XSS ở component này.
- Các truy vấn transcript tách cache theo query key, nhưng lớp debounce giao diện vẫn có cửa sổ stale nêu tại A-02. Timer debounce được clear khi value đổi/unmount.
- Tự tính tương phản theo công thức WCAG: dark violet `#8f86e8` trên `#0d0d0d/#171717/#1c1c1c` lần lượt **6.24/5.76/5.47:1**; light violet `#6d5fd6` trên `#ffffff/#fafafa/#f7f7f7` là **4.93/4.72/4.60:1**. Chữ trên violet fill tương ứng **6.24:1** dark và **4.93:1** light. Test `theme-contrast` (6) qua.
- Accent cũ như `lime` được chuẩn hóa thành violet; không thấy accent lime hoạt động còn sót ngoài brand gradient vốn được quyết định giữ nguyên tại `agentic-workspace/design.md` §12.7 D1. Test appearance (6) và Settings appearance (5) qua.
- Các test tập trung khác đều qua: `workspace-threads` (18), `command-palette` (81), `use-workspace-shortcuts` (16).

## Chưa kiểm tra

- Không chạy bộ test đầy đủ, typecheck, browser/e2e hoặc kiểm thử tương tác thực tế trên Chrome/Firefox/macOS. Các kết luận về va chạm browser ngoài ma trận phím đã được mã hóa chỉ dựa trên source/test, không chạy trên từng browser.
- Không kiểm tra các hook SSE ngoài danh sách QA8 hoặc hành vi tải transcript với server thật.

## Tóm tắt

- **CRITICAL: 0 · HIGH: 0 · MEDIUM: 3 · LOW: 1 · INFO: 0**
- Ba điểm cần ưu tiên: **A-01** receipt bị chặn khi đổi run; **A-02** palette trả kết quả cũ trong cửa sổ debounce; **A-03** reconnect giữ cursor lịch sử cũ.
