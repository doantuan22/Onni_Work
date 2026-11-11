# QA4 — NewTaskSurface: tách composer và draft ID

## Kết luận
Việc tách `NewTaskSurface` nhìn chung giữ được hành vi của composer: khóa draft `default` vẫn đọc dữ liệu legacy, các draft ID khác và attachment của chúng được cô lập, còn luồng tạo task, bookmarklet, đổi project và variants có kiểm thử tương ứng. Tuy nhiên, khi schedule được tạo từ draft pane trong WorkspaceHost, surface gọi callback để đóng pane rồi tự điều hướng khỏi `/new`; route host không còn quyền quyết định hoàn toàn kết quả schedule như hợp đồng tách component hàm ý. Test host hiện không bắt được lỗi này vì mock thay thế toàn bộ surface.

## Findings

### A-01 — MEDIUM — Schedule trong workspace điều hướng khỏi route host

**Vị trí:** `packages/web/src/routes/new-task-surface.tsx:727-736`; `packages/web/src/components/workspace/workspace-host.tsx:185-187`; test `packages/web/src/components/workspace/workspace-host.test.tsx:20-36,110-119`.

**Vấn đề:** `finishSchedule` gọi `onScheduled()` để host đóng draft pane, sau đó surface luôn gọi `navigate(...)` theo kết quả schedule. Với kết quả thường gặp `outcome: 'pending'`, nó điều hướng tới `/`; `useNavigate` scope-aware biến đường dẫn này thành `/p/<projectId>`. Vì vậy người dùng rời `/p/<projectId>/new` sau khi host vừa đóng pane, trái với host contract/test mong đợi giữ URL `/new`. Nhánh `launched`/`cancelled` cũng khiến surface tự chọn URL thay vì để host chọn cách phản ánh kết quả trong workspace.

**Bằng chứng:**

```tsx
// new-task-surface.tsx
const finishSchedule = async (scheduled, preserveDraft) => {
  onScheduled()
  ...
  navigate(scheduled.outcome === 'launched' && scheduled.runIds[0]
    ? `/tasks/${scheduled.runIds[0]}`
    : '/')
}
```

`WorkspaceHost` cung cấp callback đóng pane và báo toast (`workspace-host.tsx:185-187`), nhưng test thay `NewTaskSurface` bằng mock chỉ gọi callback (`workspace-host.test.tsx:20-36`). Test sau đó xác nhận route vẫn `/p/shop/new` (`:110-119`), nhưng không thực thi `finishSchedule` thật. Điều này cũng khớp kết quả suite: test pass dù luồng production có lệnh điều hướng thứ hai.

**Cách tái hiện bằng code path:** từ `/p/shop/new`, tạo schedule trả `{ outcome: 'pending', runIds: [] }`. `finishSchedule` gọi host callback (đóng draft) rồi điều hướng `/`; project-router scope đường dẫn thành `/p/shop`. Route không còn là `/p/shop/new` như test host kỳ vọng.

**Đề xuất:** để host sở hữu điều hướng sau schedule: truyền kết quả schedule vào callback và bỏ điều hướng nội bộ của surface, hoặc cấp chính sách completion rõ ràng cho từng host. Thêm integration test dùng `NewTaskSurface` thật trong `WorkspaceHost`, với deferred-start `pending`, rồi khẳng định draft đóng và pathname còn ở `/p/:id/new`.

## Verified OK

- `new-task-draft.ts` dùng `default` để giữ nguyên key legacy; các ID khác có suffix đã encode. Draft cache và attachment map đều được key theo storage key chung.
- Test xác nhận đọc legacy draft qua default ID (`new-task-draft.test.ts:138-142`), xóa draft không ảnh hưởng ID khác (`:130-135`), attachment tách biệt theo ID (`:285-292`), và không ghi ảnh lớn vào localStorage (`:308-313`).
- Bookmarklet giữ logic bắt search params trước khi dọn URL, kiểm launch key trước khi auto-start và không start khi key sai; bộ test bao gồm URL cleanup và focus nút Start (`new-task.test.tsx:1603+`, `1785+`, `1854-1864`).
- Project switching có kiểm thử chuyển prompt/attachment và không ghi đè draft đích đang có (`new-task-project.test.tsx`); `handOffComposition` chỉ chuyển giữa các key cùng `draftId`.
- `startedRunPath` và host chọn run đầu tiên khi response có variants; test xác nhận body variants và URL variant đầu tiên (`new-task.test.tsx:1280-1307`). Host promote draft pane thành run và push URL tương ứng (`workspace-host.test.tsx:97-108`).
- Xóa draft sau khi start nằm ở callback của từng host; ID truyền vào callback là ID pane đang chạy. `ManagerWorkerPill` vẫn nối `roster`, `rosterMode` và `managerFullAccess` vào draft/component; các test preset và panel vẫn bao phủ state chính.
- Các suite hiện có chạy thành công: `new-task-draft.test.ts` 40/40; `new-task.test.tsx` 146/146; `new-task-project.test.tsx` 8/8; `workspace-host.test.tsx` 13/13.

## Not covered

- Không chạy e2e trình duyệt hay kiểm tra trực quan; audit dựa trên đọc code và các suite đơn lẻ nêu trên.
- Không tìm thấy file QA RULES riêng trong `agentic-workspace`; các hard rule trong task order được áp dụng.
- Chưa kiểm tra hành vi nhiều tab trình duyệt cùng sửa draft; attachment map chủ ý chỉ sống trong memory của tab.

## Tóm tắt

Số finding: CRITICAL 0, HIGH 0, MEDIUM 1, LOW 0, INFO 0.

Ba điểm quan trọng nhất:

1. **A-01:** schedule trong workspace tự điều hướng khỏi `/new` sau khi host đóng draft pane.
2. Test host schedule dùng mock surface nên không bắt được điều hướng phụ này.
3. Các kiểm tra key legacy, draft ID/attachment isolation, bookmarklet, project switching và variants đều pass hoặc có assertion tương ứng.

