# QA toàn hệ thống — báo cáo kiểm thử vòng 2 (UI & luồng hoạt động)

Ngày: 2026-11-12 · Nhánh: `test/ui-flows-audit` (tách từ `dev` sau khi merge `fix/audit-findings` @ `42a1bbb`)
Máy: Windows 11 (10.0.26200), Git Bash, Node 24.22.1, Chrome hệ thống (playwright-core).
Phạm vi: kiểm tra tổng quát lần 2, tập trung sâu vào **giao diện và luồng hoạt động** sau khi đã sửa toàn bộ 10 lỗi vòng 1 (H1, M1–M3, L1–L6).

## 1. Môi trường kiểm thử

- Server chạy `packages/work/dist` với `ONNI_DRY_RUN=1` (mock agent CLI), cổng **4410**.
- Home riêng `.tmp/qa2/home` đăng ký 2 project: `demo` → `.tmp/qa2/demo-repo` (2 commit, có `src/add.js`, `src/sub.js`), `blog` → `.tmp/qa2/blog-repo` (1 commit, có `posts/first.md`).
- Trình duyệt thật: Chrome hệ thống, headless, viewport 1440×900 (mobile 390×844).
- Script: `.tmp/qa2/audit.mjs` (33 bước), `.tmp/qa2/verify-theme-i18n.mjs`, `.tmp/qa2/verify-changes.mjs`; ảnh chụp ở `.tmp/qa2/shots/`, báo cáo máy ở `.tmp/qa2/audit-report.json`.

## 2. Kết quả tổng hợp

| # | Hạng mục | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Chuyển hướng landing → project mở gần nhất | ✅ Pass | `/` → `/p/demo/` |
| 2 | Tạo task mới (demo) | ✅ Pass | run `f4ee5742…`, redirect `/p/demo/tasks/:id` |
| 3 | Vòng đời run: preparing → running → waiting ("needs you") | ✅ Pass | states thu được `["running","preparing","done","waiting"]`, diff `+1 −0`, có nhắc tới `multiply` |
| 4 | 8 tab run (chat/changes/commits/files/graph/notes/preview/terminal) | ✅ Pass | 0 crash, 0 lỗi trang |
| 5 | 11 surface project (git, git/branches, git/commits, git/files, github, github/prs, inbox, tracker, automations, workflows, skills) | ✅ Pass | 0 crash |
| 6 | Command palette (Ctrl+K) | ✅ Pass | dialog mở |
| 7 | Theme light/dark | ✅ Pass | `.light` được thêm/bỏ đúng trên `<html>` |
| 8 | Chuyển ngôn ngữ VI + lưu qua reload | ✅ Pass | settings + shell dịch; giữ sau reload |
| 9 | Nhãn "needs you" dịch VI (kiểm tra lại L3) | ✅ Pass | `needs you` → `cần bạn`, badge `CẦN BẠN` |
| 10 | Task palette (Meta+P) | ✅ Pass | mở đủ Actions/Git/Go to view kèm phím tắt |
| 11 | Tạo task ở project thứ 2 (blog) + cô lập scope | ✅ Pass | run `a4d7de96…`; task demo vẫn truy cập đúng `/p/demo/...` |
| 12 | Mobile 390×844 — tràn ngang | ✅ Pass | `horizontalOverflowPx = 0` |
| 13 | Cold deep link (context mới → `/p/demo/tasks/:id/chat`) | ✅ Pass | tải 2068 ms, FCP 248 ms, 0 crash |
| 14 | Hiệu năng landing | ✅ Pass | tải 871 ms, FCP 124 ms |

Tổng: **14/14 hạng mục pass. Không tìm thấy lỗi mới.** `pageErrors = 0`; không có phản hồi ≥500.

## 3. Kiểm chứng lại các fix vòng 1 trên UI thật

| Fix | Kiểm chứng | Kết quả |
| --- | --- | --- |
| **L2** — Changes pane 409 | Trong cửa sổ setup, tab Changes hiển thị "Preparing worktree" thay vì câu "no worktree — …" sai nghĩa; sau khi worktree sẵn sàng, lần poll tiếp theo (4s) hiển thị diff thật (`multiply.js`) | ✅ Hoạt động đúng |
| **L3** — nhãn attention không qua i18n | Chuyển VI, header run hiển thị `cần bạn` (không còn `needs you` tiếng Anh); badge dashboard `CẦN BẠN` | ✅ Hoạt động đúng |
| **L4** — cold deep link 404 | Mở run chat từ context mới trực tiếp: tải 2.0s, không 404 | ✅ Hoạt động đúng |
| **M3** — từ điển VI tải lazy | Bật VI tải và hiển thị đúng; reload giữ nguyên | ✅ Hoạt động đúng |

## 4. Ghi chú hiện tượng nhất thời (đã xác minh, không phải lỗi)

| Hiện tượng | Giải thích | Bằng chứng |
| --- | --- | --- |
| `409 GET /runs/:id/changes` xuất hiện 1 lần trong log | Cửa sổ đua khi worktree đang tạo: `/changes` trả 409 "no worktree" đúng lúc thư mục chưa tồn tại. Frontend coi đây là *setup race* (`task-changes.tsx:149`) và hiển thị "Preparing worktree", tiếp tục poll. Trình duyệt vẫn ghi 4xx vào console (không hiển thị cho user) | `.tmp/qa2/verify-changes.mjs`: sau settle 5s — `PREPARING? false`, `DIFF FILE? true`, `BAD: none` |
| Run kết thúc ở `waiting` ("needs you") | Hành vi mock đúng: prompt không có `mock:done` → agent mock kết thúc lượt không phát `ONNI:DONE` → run park chờ người dùng (nút Commit + diff `+1 −0`) | `scripts/mock-claude.mjs:145-168` |
| `GET …/git/status`, `/history` báo `ERR_ABORTED` (21 dòng) | Chuyển tab nhanh huỷ request đang bay — nhiễu từ script, không phải lỗi server | Không có response ≥500 |
| `/p/demo/tasks` (không có run id) trả 404 | Đúng thiết kế: danh sách task theo project ở `/p/demo/` (dashboard), danh sách toàn cục ở `/tasks`. `/p/demo/tasks/:id/*` mới là route hợp lệ | `routes.tsx:689` |

## 5. Kết luận

Vòng 2 trên UI thật xác nhận: 14/14 luồng giao diện và vận hành hoạt động đúng, các fix vòng 1 (đặc biệt L2, L3, L4, M3) vận hành đúng như thiết kế trên trình duyệt thật, không phát sinh lỗi hồi quy, không có lỗi runtime trên trang, không có phản hồi 5xx.

Không có thay đổi mã logic nào trong vòng này — chỉ thêm script kiểm thử (`.tmp/qa2/`, gitignored) và báo cáo này.

## Phụ lục A — tái hiện

```bash
ONNI_DRY_RUN=1 ONNI_HOME="$PWD/.tmp/qa2/home" node packages/work/dist/index.js serve --port 4410
node .tmp/qa2/audit.mjs                       # 33 bước, ghi .tmp/qa2/audit-report.json
node .tmp/qa2/verify-theme-i18n.mjs           # theme light/dark + VI + L3
node .tmp/qa2/verify-changes.mjs              # xác nhận diff hiển thị sau settle
```
