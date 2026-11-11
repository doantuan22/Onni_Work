# QA9 — chạy hồi quy và phân loại

## Kết luận

Đợt hồi quy chưa đạt: `npm run typecheck` bị chặn và các kiểm thử Phase 5 phía server cùng thất bại do worktree đang nạp `@onni/contract` từ junction của checkout cha, không phải contract đã sửa trong worktree này. Có thêm một bộ kiểm thử Settings còn khẳng định accent là một lựa chọn, trái với quyết định D1 của thiết kế (violet cố định). Phần lớn lỗi Git/worktree còn lại là artefact môi trường Windows/worker fence, không phải hồi quy nguồn. Không có file nguồn, test hay cấu hình nào bị sửa trong audit này.

## Kết quả chạy tuần tự

| Nhóm | Kết quả | Phân loại lỗi |
| --- | --- | --- |
| `npm run typecheck` | fail; server build báo 18 lỗi thiếu export Phase 5 và 1 lỗi `maxRedirections` | REGRESSION-SUSPECT: export đang tồn tại trong worktree nhưng resolver dùng checkout cha |
| `npm test -- packages/web` | 6.128 pass, 7 fail (370 files) | 5 Settings = REGRESSION-SUSPECT (test cũ); 2 Mermaid = REGRESSION-SUSPECT, cần chủ sở hữu Mermaid triage |
| `packages/work/src/server` | 2.427 pass, 56 fail, 4 skip (170 files) | 39 lỗi Phase 5 = REGRESSION-SUSPECT cùng nguyên nhân contract; 17 lỗi Git/EPERM/kích thước POSIX = ENV-ONLY |
| `packages/work/src/runs` | 460 pass, 1 fail, 3 skip | REGRESSION-SUSPECT: `store-concurrency` |
| `packages/work/src/workflows` | 932 pass, 47 fail, 2 skip (70 files) | 35 lỗi push fence/EPERM = ENV-ONLY; 12 timeout/lifecycle = REGRESSION-SUSPECT, nhưng chịu ảnh hưởng worker fence |
| Các thư mục `work` còn lại | 3.127 pass, 39 skip; 1 fail | `worktree-lifecycle/templates.test.ts`: ENV-ONLY (`spawnSync bash ENOENT`) |
| `npm test -- packages/contract` | pass, không có test file | không áp dụng |

Các nhóm `work` pass hoàn toàn: agent-config 54, automations 343, core 1.511 (32 skip), dispatch 206, manager-eval 19, self-update 15, server-install 167 (1 skip), test-fixtures 3, webhooks 487 (1 skip), workspace 322 (5 skip). Các lệnh đã chạy từng nhóm, không chạy song song.

## Findings

### A-01 — HIGH — `packages/contract/src/index.ts:43`

**Sai ở đâu:** contract Phase 5 được export trong worktree (`export * from './workspace-threads.ts'`), nhưng dependency resolution thực tế lấy `D:\Multi Agent\node_modules\@onni\contract`, một junction tới `D:\Multi Agent\packages\contract` của checkout cha. Checkout đó không có export mới. Vì vậy build server không thể biên dịch `transcript-search.ts`, `workspace-threads.ts`, `workspace-panes.ts`, `workspace-search.ts` và `runs.ts`; runtime test nhận schema là `undefined` rồi trả HTTP 500.

**Bằng chứng / tái hiện:** `npm run typecheck` fail với dòng đầu tiên `TS2305: Module '"@onni/contract"' has no exported member 'MAX_THREAD_CURSOR_LENGTH'`. Chạy lại riêng `npm test -- packages/work/src/server/contract-workspace-threads.test.ts` cho 16/16 fail, dòng lỗi đầu tiên `Cannot read properties of undefined (reading 'parse')`. `Get-Item D:\Multi Agent\node_modules\@onni\contract` xác nhận junction trỏ tới checkout cha; `git diff c6db20f --stat -- packages/contract/src/index.ts packages/contract/src/workspace-threads.ts ...` xác nhận toàn bộ surface này là thay đổi của effort.

**Đề xuất:** bootstrap dependencies theo từng worktree (hoặc resolver/tsconfig rõ ràng trỏ contract sibling của worktree) trước khi test/build; kiểm thử workspace nên chứng minh package import đang tới source của checkout hiện tại. Không sửa trong audit.

### A-02 — MEDIUM — `packages/web/src/routes/settings/settings.test.tsx:740`

**Sai ở đâu:** năm assertion Settings vẫn yêu cầu `data-accent="violet"` và radio `Violet`, nhưng implementation cố ý bỏ accent selector và `applyAppearance` luôn xóa attribute tại `packages/web/src/lib/appearance.ts:98`. Điều này phù hợp decision D1 trong `design.md` (violet là accent cố định), nên test đang mô tả surface đã bị loại bỏ.

**Bằng chứng / tái hiện:** chạy lại riêng `npm test -- packages/web/src/routes/settings/settings.test.tsx`: 37 pass, 5 fail; lỗi đầu tiên là `expected undefined to be 'violet'`. `git diff c6db20f -- packages/web/src/routes/settings/appearance.tsx ...` cho thấy selector/radio bị xóa có chủ ý và `DEFAULT_ACCENT` đổi thành `violet`.

**Đề xuất:** cập nhật test để assert accent cố định qua token/CSS và không render control accent; giữ assertion persistence cho density/width.

### A-03 — MEDIUM — `packages/work/src/runs/store-concurrency.test.ts:157`

**Sai ở đâu:** concurrent ticket-selection test fail: một writer trả `Could not persist automation run provenance; the launch was not confirmed.` Đây không khớp các mẫu ENV-ONLY được chỉ định.

**Bằng chứng / tái hiện:** `npm test -- packages/work/src/runs` cho 460 pass, 1 fail; dòng lỗi đầu tiên `expected 'Could not persist automation run prov…' to be undefined`. File/các dependency liên quan cần được rerun độc lập trong một môi trường không bị worker fence trước khi kết luận nguyên nhân.

**Đề xuất:** điều tra lock/atomic rename và đường ghi provenance dưới tải đa tiến trình; thêm assertion log lỗi/khả năng retry có giới hạn sau khi xác định nguyên nhân.

## Verified OK

- Đã chạy theo đúng thứ tự yêu cầu: typecheck, web, server/runs/workflows/các thư mục work còn lại, rồi contract.
- 10 nhóm `packages/work/src` không có hồi quy quan sát được (danh sách và số đếm ở trên).
- Contract source của Phase 5 thực sự có schema mới và export ở worktree; vấn đề là đường resolve dependency, không phải thiếu file source.
- `git diff c6db20f --stat` tổng cộng **118 files, 15.040 insertions, 2.530 deletions**.
- File mới không có test đứng cạnh: `packages/contract/src/workspace-threads.ts`, `packages/web/src/api/run-stream-share.ts`, `packages/web/src/api/workspace-threads.ts`, `packages/web/src/components/workspace/{active-pane-context,context-sheet,split-tab-strip,use-mark-viewed,use-workspace-shortcuts,workspace-host}.tsx`, `packages/web/src/lib/{navigator-groups,rail-state,task-open-files,use-open-threads,workspace-panes-sync,workspace-state}.ts`, `packages/web/src/routes/{new-task-surface.tsx,task-git/task-editor.tsx,task-git/task-files-tree.tsx,task-tree/task-tree-pane.tsx,task-workspace/url-sync.ts}`, `packages/work/src/runs/transcript-search.ts`, và ba route Phase 5. (Một số có test tên khác, nhưng không có file test đồng danh.)
- Không phát hiện test nào của thay đổi này pass một cách vacuous trong phạm vi run; các test Phase 5 bị chặn trước khi exercise do resolver sai, được ghi A-01.

## Không bao phủ

- Không thể xác nhận suite đầy đủ trên Windows là xanh vì các test POSIX/Git bị `EPERM`, `bash ENOENT`, POSIX `du`/path, và worker pre-push fence; AGENTS.md đã dự báo các artefact này.
- Mermaid fail (2 test: theme SVG và source copy) không được tái chạy riêng do thời gian audit; không đủ bằng chứng để gán lỗi nguồn.
- Các timeout workflow/lifecycle được đánh dấu REGRESSION-SUSPECT trong bảng nhưng không tách được hoàn toàn khỏi worker fence của session hiện tại.

## Tóm tắt

Số finding: **HIGH 1, MEDIUM 2, LOW 0, INFO 0**. Ba điểm quan trọng nhất: (1) dependency junction sai làm build và toàn bộ Phase 5 server surface không chạy; (2) test Settings lạc hậu so với D1 accent violet cố định; (3) lỗi multi-process provenance của run store cần triage độc lập.
