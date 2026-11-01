# Báo cáo hiện trạng Onni Work

Cập nhật: 01/11/2026

## Kết luận

**Chưa đủ cơ sở xác nhận sẵn sàng dùng cá nhân.** C-01–C-04 đã được sửa; build và cài/gỡ NSIS sạch đã kiểm tra. Toàn bộ Vitest vẫn còn lỗi, và thao tác tray Quit chưa kiểm tra được qua UI.

## Kiểm tra và phân loại

- Vitest cuối: **11.979 đạt, 582 lỗi, 48 pending / 12.609 test** (Git Bash, 4 workers; không lỗi thu thập suite). Lần chạy trước có 656 lỗi; lần 712 lỗi ban đầu không có artifact theo từng test để đối chiếu chính xác.
- Đã xác nhận một phần nguyên nhân: 169 lỗi kiểm tra process identity do WMI không khả dụng trong sandbox (kiểm tra riêng ngoài sandbox đạt); các lỗi khởi chạy Node/`tsx` có `uv_os_get_passwd: ENOMEM` trong sandbox; 136 lỗi `EPERM` thuộc nhiều nhóm và chưa thể quy toàn bộ cho môi trường. 13 test khóa đa tiến trình hết giờ đợi `A-ready`; test hồi quy `fs-rename` đạt. **Chưa phân loại hết 582 lỗi theo A–D.**
- C-04 trước sửa tái hiện được với tám `EPERM` giả lập liên tiếp; sau sửa regression pass. Retry tối đa 1,8 giây chỉ áp dụng cho publish ticket; các ghi atomic khác giữ mặc định 1 giây. Chưa chạy lại stress 30 lượt ngoài sandbox sau bản sửa.
- Regression C-01–C-03 và fixture trước đó: **135 test đạt**. Sau C-04: `fs-rename.test.ts` **12/12 đạt**; typecheck đạt.

## Sửa lỗi đã commit

- `92e15f4` C-01: từ chối secret file là reparse point trên Windows; tái sử dụng helper đọc handle.
- `ecb4dc2` C-02: ignore thư mục hook được tạo dưới `.ai/onni/`.
- `01eefe8` C-03: chuẩn hóa đường dẫn Git sang dấu `/` trên Windows.
- `1465071` C-04: tăng retry rename ticket Windows theo phạm vi hẹp.
- `ae8f50f` bổ sung LICENSE/NOTICE vào gói desktop; `cb10cdb`, `002d994` cập nhật test/fixture.

## Build desktop và smoke động

- NSIS build từ checkout sạch, không gắn nhãn `dirty`. Cài im lặng và gỡ đều exit 0; LICENSE/NOTICE khớp SHA-256 với source; sau gỡ không còn file trong thư mục cài.
- Artifact: `.tmp/phase3/clean-build/.tmp/desktop-artifacts/0.1.11-002d994271a2-2026-11-01T11-47-34-800Z/Onni Work_0.1.11_x64-setup.exe`.
- Smoke API/mock đạt: bảo vệ Host/Origin, SSE/WS, roster và worker, giới hạn cost/token/iteration/time, autonomous worktree, cancel và phục hồi sau restart, review/commit/finish, in-place landing. Không gọi GitHub thật; chạy với mock.
- Kiểm tra Job Object riêng xác nhận tiến trình con và cổng test đóng sau cancel. Đây chưa phải kiểm tra tray Quit hay sidecar qua UI.
- Công cụ điều khiển UI không kết nối được native pipe. Vì vậy chưa xác minh trực tiếp mở app, thao tác tray Quit, relaunch, hay gỡ khi app đang chạy.

## Còn lại trước khi kết luận

1. Chạy `npm test`, `npm run test:unit` và `npm run test:package` trên CI/WSL phù hợp; hiện suite lần lượt còn 582 lỗi, 7/7 file unit dừng do ENOMEM, và 2/2 test package dừng do ENOMEM. `npm run build` đạt với npm cache trong `.tmp`.
2. Trên Windows desktop, kiểm tra thủ công: tạo `mock:slow`, cancel; thoát bằng **Quit** từ tray; xác nhận tiến trình task/con cháu dừng; mở lại và kiểm tra trạng thái; gỡ app và kiểm tra dữ liệu người dùng được giữ đúng.

Tám ADR `docs/adr/0001–0008` vốn đã bị xóa vẫn không được chỉnh sửa hoặc đưa vào commit.
