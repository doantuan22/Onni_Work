# QA7 — Server Phase 5

## Kết luận

Phase 5 có cấu trúc route và giới hạn trang cơ bản đúng hướng, nhưng chưa đạt mức an toàn để phát hành: dữ liệu `runs.json` của project lạnh được coi là đáng tin khi dựng đường dẫn transcript, tạo đường đọc vượt thư mục `runs`; bộ đọc NDJSON có thể giữ một dòng tùy ý lớn trong bộ nhớ dù tuyên bố giới hạn 1 MiB; và read receipt không giữ được tính đơn điệu khi hai cockpit cùng ghi. Cursor của thread cũng có thể làm mất mục trong trường hợp run ID bị trùng giữa các project. Không có thay đổi nguồn nào được thực hiện trong audit này.

## Phát hiện

### A-01 — HIGH — path traversal từ `runs.json` của project lạnh

- **Vị trí:** `packages/work/src/runs/store.ts:151-153`, `packages/work/src/server/routes/workspace-search.ts:73-83`, `packages/work/src/server/routes/workspace-threads.ts:224-227`.
- **Vấn đề:** `runRecordSchema` chỉ yêu cầu `id: z.string()`. Hai route workspace đọc index của project không được sở hữu qua `readRunIndexFromDisk()`, rồi ghép trực tiếp `run.id` vào tên file. Khác với route `/runs/:id/*`, giá trị này không đi qua `runIdParamSchema` (regex an toàn ở `contract/events.ts:33-35`). Vì vậy index hợp lệ về schema nhưng chứa `id: "../../secret"` sẽ khiến `join(dataDir, 'runs', `${run.id}.ndjson`)` thoát khỏi `runs`. Search có thể trả snippet từ nội dung ngoài vùng transcript nếu nó parse được như event; threads có thể đọc preview từ đó.
- **Bằng chứng/tái hiện:** Tạo/copy một `.ai/onni/runs.json` ở một project đã đăng ký với một RunRecord đầy đủ hợp lệ, đặt `id` thành `../../secret`; request `GET /api/v1/workspace/search?q=<chuỗi>` sẽ xây đường dẫn `<project>/.ai/onni/runs/../../secret.ndjson`. `readRunIndexFromDisk` parse record ở dòng 28-34 và không kiểm tra ID; đường dẫn được xây ở `workspace-search.ts:77` và `workspace-threads.ts:227`. Đây là đường mới sau baseline `c6db20f`.
- **Đề xuất:** Dùng cùng định nghĩa ID an toàn cho `runRecordSchema`/đọc index hoặc kiểm tra ID trước mọi ghép đường dẫn; bỏ qua record không hợp lệ. Tốt hơn, tạo một helper tạo transcript path kiểm tra `resolve()` vẫn nằm dưới `<dataDir>/runs` và dùng helper đó cho cả search lẫn preview.

### A-02 — MEDIUM — giới hạn 1 MiB không chặn một dòng NDJSON cực lớn

- **Vị trí:** `packages/work/src/runs/transcript-search.ts:197-226`, đặc biệt dòng 214-218.
- **Vấn đề:** `readline` chỉ yield sau khi đã tích lũy trọn dòng. `parseLine(line)` (bao gồm `JSON.parse`) chạy trước kiểm tra `input.bytesRead >= maxBytes`. Một transcript có một dòng JSON hợp lệ 100 MiB sẽ được đưa thành một string 100 MiB và parse toàn bộ trước khi giới hạn 1 MiB có cơ hội dừng. Điều này làm sai ràng buộc “bounded” của search và có thể gây CPU/RAM spike cho mỗi trong tối đa 25 run.
- **Bằng chứng/tái hiện:** `streamRunEventsBounded()` tạo `createInterface({ input })` ở dòng 213, `for await (const line ...)` nhận whole line ở 214, gọi `parseLine` ở 215, chỉ sau đó mới kiểm tra budget ở 217. Test hiện có `transcript-search.test.ts:309-336` tạo 100 dòng nhỏ, nên không thử physical line lớn hơn budget.
- **Đề xuất:** Đếm byte trên raw stream trước khi đưa vào line decoder và hủy stream ngay khi vượt ngân sách; đồng thời đặt giới hạn byte từng dòng trước `JSON.parse`. Thêm test một dòng dài hơn budget để khẳng định không parse/giữ cả dòng.

### A-03 — MEDIUM — `markViewed` mất tính đơn điệu giữa hai process

- **Vị trí:** `packages/work/src/runs/store.ts:1631-1641`, `packages/work/src/runs/store.ts:2212-2226`, `packages/work/src/runs/store.ts:2240-2277`.
- **Vấn đề:** Trong một `RunStore`, `markViewed` chỉ tăng `lastViewedSeq`; nhưng các process/cockpit khác nhau có snapshot `persisted` riêng. Nếu A ghi `15` rồi B (đã mở index khi receipt còn vắng) ghi `10`, merge của B coi `lastViewedSeq` là field local đã đổi so với baseline và ghi đè disk `15` bằng `10`. Comment ở dòng 2240-2243 xác nhận chính sách “same field use last serialized writer”, trái với hợp đồng receipt đơn điệu.
- **Bằng chứng/tái hiện:** Mở hai `RunStore` trên cùng `dataDir` khi `lastViewedSeq` chưa có; A gọi `markViewed(id, 15); flush()`, sau đó B gọi `markViewed(id, 10); flush()`. Trong `mergeWithIndexOnDisk`, baseline B thiếu field, local B là `10`, nên vòng lặp 2270-2274 thay giá trị disk `15` bằng `10`. Khi event sequence 11–15 đã được xem, unread lại bật sai.
- **Đề xuất:** Với `lastViewedSeq`, merge conflict phải lấy `max(disk,last local)` (và xử lý absent như chưa xem), thay vì last-writer-wins; bổ sung test hai store/process mô phỏng thứ tự trên.

### A-04 — MEDIUM — cursor thread bỏ mục khi hai project có cùng run ID và timestamp

- **Vị trí:** `packages/work/src/server/routes/workspace-threads.ts:36-64`, `206-218`, `246-253`.
- **Vấn đề:** Cursor chỉ chứa `{updatedAt, runId}`, và comparator cũng chỉ dùng hai field đó, không có `projectId`. `runRecordSchema` không bảo đảm run ID duy nhất trên toàn workspace; copy/migrate `.ai/onni` sang project khác là đủ tạo collision. Hai candidate có cùng ID và cùng hoạt động sẽ so sánh bằng 0. Khi page 1 (limit 1) trả item đầu, page 2 dùng `findIndex(compare > 0)` không tìm thấy item thứ hai bằng 0, nên trả mảng rỗng và làm mất thread.
- **Bằng chứng/tái hiện:** Hai project đăng ký có record `id: "copied-run"` và `createdAt`/activity cùng `2026-11-11T10:00:00Z`; gọi `/workspace/threads?limit=1`, sau đó gọi cursor trả về. Code tạo cursor thiếu project ở 249-253; lọc page kế dùng strict `> 0` ở 214-217. Test `workspace-threads.test.ts:111-145` chỉ tạo UUID khác nhau với timestamp khác nhau, nên không chạm tie/collision.
- **Đề xuất:** Sắp xếp và encode cursor theo bộ khóa ổn định `(updatedAt, runId, projectId)` (hoặc một run key được namespaced bằng project), và thêm test collision cross-project cùng timestamp qua ranh giới trang.

### A-05 — LOW — các guard contract/parity chung chưa bao phủ đầy đủ route Phase 5

- **Vị trí:** `packages/work/src/server/typed-bodies.test.ts:36-137`, `packages/work/src/server/contract-parity.runs.test.ts:54-131`, `packages/work/src/server/contract-parity.workspace.test.ts:171-234`.
- **Vấn đề:** `typed-bodies` không assert body typed cho `POST /api/v1/runs/:id/viewed` hoặc `PUT /api/v1/workspace/panes`, và cũng không assert query typed cho `/workspace/threads` hay `/workspace/search`. `contract-parity.runs` không pin response của `viewed`; `contract-parity.workspace` chỉ pin runs-index/layouts, không pin threads/search/panes. Có test cục bộ (`workspace-search.test.ts:49-62`) cho response search, nhưng không thay thế coverage hai chiều chung cho toàn bộ surface mới.
- **Bằng chứng/tái hiện:** Danh sách assertion nêu trên không có các path/schema Phase 5. `route-parity.test.ts` chỉ lặp project-route manifest; `/workspace/threads` và `/workspace/search` là workspace-only, còn test non-GET chọn tay không gọi `viewed` (dòng 231-261).
- **Đề xuất:** Mở rộng typed-bodies và contract-parity tương ứng để pin input/query/200 response của threads, search, panes và viewed, rồi thêm một assertion manifest rằng hai route workspace-only không vô tình được mount project-scoped.

## Verified OK

- Param `:id` của `POST /runs/:id/viewed` đi qua `paramZodValidator(runIdParamSchema)`; regex chỉ cho `[A-Za-z0-9._-]`, chặn traversal từ URL trực tiếp.
- `projectId` của route project-scoped được resolver chung kiểm tra trước khi tạo context (`server.ts:1247-1277`); panes kế thừa đúng middleware/mount như các routes runs khác.
- Cursor search/thread bị giới hạn 2048 ký tự; decode chỉ parse JSON/base64 có schema. Cursor không được dùng trực tiếp làm đường dẫn hay index file.
- Search dùng `indexOf` case-insensitive, không biến query thành regex (không có ReDoS từ query), giới hạn 50 kết quả và mặc định scan tối đa 25 transcript/page.
- Pane state dùng `atomicWriteJsonSync`: tmp `0600`, `fsync`, rename, sau đó chmod `0600`; corrupt/missing state degrade về default. `workspace-panes.json` và tmp đã được thêm vào `data-gitignore.ts`.
- Response Phase 5 đang xây conditional fields đúng với schema optional (`preview`, `parentRunId`, `nextCursor`, `truncatedProjects`), tránh key `undefined` bị JSON drop.

## Not covered

- Không chạy được các HTTP test Phase 5 đầy đủ trong worktree này do junction `D:\Multi Agent\node_modules\@onni\contract` trỏ về parent checkout chưa export schema Phase 5: `workspace-threads.test.ts` fail lặp lại 14/19 với `threadsQuerySchema`/`markViewedInputSchema` là `undefined`; `workspace-search.test.ts` fail lặp lại 1/5 khi test gọi `transcriptSearchPageSchema.parse`. Đây là lỗi resolution môi trường worktree, không kết luận là lỗi source Phase 5. `npm test -- packages/work/src/runs/transcript-search.test.ts` pass 16/16.
- Không chạy toàn bộ suite, typecheck, hay test package theo giới hạn QA.
- Không thực hiện fuzzing filesystem/symlink hoặc benchmark tải lớn; A-01/A-02 được xác minh bằng đường đi mã end-to-end.

## Tóm tắt

**HIGH: 1, MEDIUM: 3, LOW: 1, CRITICAL: 0, INFO: 0.** Ba phát hiện quan trọng nhất: (1) A-01 traversal từ `runs.json` đọc file ngoài `runs`; (2) A-02 dòng NDJSON khổng lồ vượt giới hạn 1 MiB thực tế; (3) A-03 receipt `lastViewedSeq` có thể lùi khi hai process cùng ghi.
