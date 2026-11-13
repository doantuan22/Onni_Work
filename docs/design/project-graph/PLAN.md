# Kế hoạch: Project Graph (đồ thị dự án) — bản neo vào hành động có số đo

Trạng thái: **kế hoạch, chưa triển khai** (bản viết lại 2026-11-13; bản trước 2026-11-06). Chủ dự án đã quyết: đây là
chức năng **thêm mới, tách riêng**, không thay thế và không sửa Automations.

Tài liệu tổng hợp sáu báo cáo trong cùng thư mục:

| Báo cáo | Nội dung | Vai trò trong bản này |
| --- | --- | --- |
| [`research-agent-evidence.md`](research-agent-evidence.md) | Bằng chứng graph có giúp coding agent không (RepoGraph, LocAgent, Aider, ablation 2026…) | **Đầu vào chính** |
| [`research-impact-ux.md`](research-impact-ux.md) | Impact/chọn test, va chạm giữa agent, co-change, vì sao graph UI sống/chết | **Đầu vào chính** |
| [`research-engines.md`](research-engines.md) | 22 engine phân tích code, bản đồ repo cho agent, khai thác git | Nền |
| [`research-viz.md`](research-viz.md) | 20 sản phẩm trực quan hóa, thư viện render | Nền |
| [`survey-server.md`](survey-server.md), [`survey-web.md`](survey-web.md) | Khảo sát code server/web (số liệu 2026-11-06) | Nền, **một số con số đã cũ** (xem §2.1) |
| Review độc lập bản 2026-11-06 (đã gỡ khỏi repo; xem lịch sử git, commit `b5f6172`) | 45 khẳng định | Các sửa đổi "review #N" vẫn giữ |

Đọc kèm: [`AGENTS.md`](../../../AGENTS.md), [`.ai/perf/`](../../../.ai/perf/) (khảo sát hiệu năng hiện tại),
[`docs/design/manager-worker-proposals.md`](../manager-worker-proposals.md),
[`.ai/specs/2026-07-23-websocket-subscriptions.md`](../../../.ai/specs/2026-07-23-websocket-subscriptions.md).

> **Cách đọc độ tin cậy.** Khẳng định về code dẫn đường dẫn/symbol và đã được `grep` lại ngày 2026-11-13. Khẳng định
> về thế giới bên ngoài dẫn mục của hai báo cáo nghiên cứu mới. Mọi con số "mục tiêu" (độ trễ, ngưỡng precision) là
> **giả thuyết cần đo ở các cổng §9**, không phải kết quả. Chỗ chưa kiểm ghi "chưa kiểm".

---

## Thay đổi so với bản 2026-11-06

Bản cũ có đúng phần kỹ thuật (engine, cache, contract, an toàn) nhưng **không có phép đo giá trị**: mọi mục tiêu là
hiệu năng (dựng ≤ 10 s, truy vấn ≤ 100 ms) và 6 giai đoạn đi từ màn hình vẽ đồ thị đến tính năng giá trị nhất. Bản này
đảo thứ tự và thêm cổng đo.

| # | Thay đổi | Vì sao (nguồn) |
| --- | --- | --- |
| 1 | **Neo lại trên hành động lặp lại**: "impact của diff/run" theo lớp, ứng viên test cho `verify`, sở hữu phạm vi + cảnh báo trùng trước khi giao. Bản đồ toàn repo hạ xuống thành *điểm vào* đến sau. | Graph sống được khi một lệnh/CI/tool tiêu thụ nó (Nx affected, GitHub dependency graph); map độc lập thì không có bằng chứng dùng lặp (`research-impact-ux.md` §"Graph UX", bài học 1) |
| 2 | **Cổng go/no-go trước khi đầu tư**: G-A (A/B agent: graph-off vs graph-on vs grep), G-B (replay lịch sử git: precision/recall impact + test), G-C (co-change không chặn dispatch trước khi replay đạt). | Bằng chứng graph → resolve khiêm tốn (+2,3 điểm RepoGraph), chi phí tăng; chỉ ablation 2026 n=91 là mạnh (`research-agent-evidence.md` §Kết luận, bài học 1) |
| 3 | **CLI/agent trước, UI sau**; view neo vào "graph của diff/run" trước bản đồ toàn repo. | Value cũ nằm ở Giai đoạn 3 và UI ở Giai đoạn 1 (đánh giá điểm 3) |
| 4 | **Tái dùng authority có sẵn**: npm workspace graph, git, Nx/Turbo/Rush/Bazel/Pants nếu repo dùng, `vitest related/--changed`, `jest --findRelatedTests`; `onni task conflicts` (trial merge) vẫn là authority cho xung đột văn bản. Graph/co-change chỉ **cảnh báo**. | `research-impact-ux.md` §"Kết luận lựa chọn", bài học 2 và 8 |
| 5 | **Xử lý hub ngay trong MVP**: nhóm theo lớp, giảm nhiễu hub, cạnh cấp export cho vài hub, ego 1–2 hop, personalized ranking. | Flatten 2-hop làm *giảm* resolve (26% < baseline) (`research-agent-evidence.md` §RepoGraph budget/hops, §Hub) |
| 6 | **Ngôn ngữ**: tree-sitter breadth mặc định; TS semantic là adapter tùy chọn do spike quyết; **co-change được nâng lên MVP** (soft edge, có bộ lọc nhiễu). | `research-agent-evidence.md` §"Ngôn ngữ và parser"; `research-impact-ux.md` §4 |
| 7 | **Freshness = correctness**: băm nội dung + HEAD, kiểm trước truy vấn, stale → fallback grep. | `research-agent-evidence.md` §Freshness, bài học 5 |
| 8 | **Hiệu năng**: bỏ kế hoạch tái dùng poll 4 s `useRunChanges`; dùng tín hiệu WS; không thêm việc đồng bộ vào hot path `workflows/run*`. | `.ai/perf/c-cockpit-web.md` §3, `.ai/perf/a-server-state-git.md` §4–5, `.ai/perf/b-streaming-pipeline.md` §1, 3 |
| 9 | **Cắt phạm vi**: automations hooks, tóm tắt AI, time travel, renderer thứ hai, tài liệu-spec → mục "Ngoài phạm vi" (§14), chỉ mở lại khi có số đo. | Đánh giá điểm 7 |
| 10 | **Cập nhật theo code hiện tại**: `onni task verify` và `onni task conflicts` (trial merge `git merge-tree`) **đã có**; `workflows/run.ts` đã tách thành `workflows/run/*` (3.455 dòng) và `server.ts` còn 2.629 dòng. Bản cũ coi A1/A2 là chưa xây. | §2.1 (kiểm lại bằng `grep`/`wc -l`) |

### Đối chiếu bảy điểm đánh giá của manager (2026-11-13)

| Điểm | Kết luận | Xử lý trong bản này |
| --- | --- | --- |
| 1. Không có metric giá trị; cần spike CLI-only + A/B ~10 task manager–worker, có go/no-go | **Chấp nhận** | Cổng G-A ở §9.1; V1 (spike CLI) ở Giai đoạn 0 (§10). Metric: lượt, token, xung đột, test hit-rate |
| 2. File-level yếu ở file hub; cần hub handling trong MVP, symbol không chỉ ở phase 5 | **Chấp nhận một phần** | Hub: nhóm + giảm nhiễu + cạnh cấp export cho hub (§4.4). **Symbol đầy đủ vẫn ngoài MVP**: bằng chứng cho thấy file/module dùng để khoanh vùng, symbol để chọn hàm (`research-agent-evidence.md` §Trả lời thiết kế); làm export-level ("outline") trước, call graph chỉ khi G-A cho thấy thiếu |
| 3. Value dồn cuối; đảo thứ tự, CLI trước, view neo vào diff | **Chấp nhận** | Lộ trình §10: V1 CLI → P1 impact/tests → P2 manager → UI task-anchored. Ghi chú: phụ thuộc "A1/A2 chưa xây" nay **không còn đúng** — `verify` và `conflicts` đã có (§2.1) nên P2 nối vào cái đã tồn tại |
| 4. Hẹp cho repo người dùng (chỉ TS/JS; contract-flow riêng Onni); co-change nên được nâng | **Chấp nhận** | Tree-sitter đa ngôn ngữ mặc định, `contract-flow` thành plugin quy ước tùy chọn (không phải lõi), co-change vào MVP làm soft edge (§4.5) |
| 5. Tái dùng vitest related / jest findRelatedTests; `task conflicts` đã trial-merge | **Chấp nhận** | §3.2 (thang chọn test), §7 (graph chỉ cảnh báo, `task conflicts` là authority) |
| 6. Xung đột với khảo sát perf: poll 4 s, hook đồng bộ trong hot path run | **Chấp nhận** | §8.4, §11: tín hiệu WS ngay từ đầu; ghi hook ở thời điểm settle, bất đồng bộ, ngoài hot path; build nhường event loop |
| 7. Phạm vi quá rộng cho giả thuyết chưa chứng minh | **Chấp nhận** | 6 → 3 giai đoạn có cổng; 2 topic WS → 1; phần còn lại sang §14 |

---

## 0. Tóm tắt điều hành

**Là gì.** Một lớp *quan hệ* của dự án (file/module, import, test, package, co-change theo git) mà chương trình tính
được, để trả lời ba câu hỏi lặp lại: (1) **"thay đổi này ảnh hưởng gì, cần chạy test nào?"**; (2) **"hai worker có
đang đụng nhau không, mỗi phần nên giao cho ai?"**; (3) **"agent nên đọc file nào trước?"**. Giao diện chính là CLI
`onni graph …` (agent và manager dùng) và một view *neo vào diff/run*. Bản đồ toàn repo chỉ là điểm vào đến sau.

**Giả thuyết cần chứng minh** (mỗi cái gắn một cổng ở §9):

| # | Giả thuyết | Cổng |
| --- | --- | --- |
| H1 | Agent có `graph context/impact` định vị đúng file nhanh hơn, ít lượt/token hơn, không giảm tỉ lệ pass so với tự `grep` | G-A |
| H2 | Từ diff, "ứng viên test" từ graph + runner-native có recall ≥ ngưỡng trên lịch sử repo này | G-B |
| H3 | Cảnh báo trùng vùng của graph bắt được thêm xung đột mà `onni task conflicts` (trial merge) chưa thấy ở thời điểm lập kế hoạch, với precision chấp nhận được | G-B, G-C |

**Quyết định cốt lõi (đề xuất, xem §13):**

1. **Xây bằng code, xác định, tăng dần**; không cần agent để xây. Không embeddings, không tóm tắt LLM mặc định
   (`research-agent-evidence.md` bài học 7).
2. **Tái dùng authority** trước khi tự tính (§3.2). Graph là *lớp giải thích và bổ sung*, không phải bản sao của Nx/Bazel.
3. **Chỉ cảnh báo, không bao giờ nói "không xung đột/đã đủ test"**: tập ứng viên luôn kèm độ tin cậy và đường lui
   (chạy rộng hơn).
4. **Cạnh có nguồn gốc** `extracted | declared | inferred` + confidence; không trộn (giữ từ bản trước).
5. **Cache dựng lại được** dưới `.ai/onni/project-graph/`; mất thì dựng lại; hỏng/stale thì **fallback grep** có nhãn.
6. **Local-first tuyệt đối**; mọi số đo dùng nội bộ **chỉ trên máy** — `AGENTS.md` đã gỡ telemetry, không có đường gửi.
7. **Mỗi giai đoạn sau Giai đoạn 0 chỉ bắt đầu khi cổng trước đạt**; không đạt thì dừng ở cái đã đạt (CLI nhỏ hoặc bỏ).

**Lộ trình ngắn.**

| Giai đoạn | Nội dung | Cổng ra |
| --- | --- | --- |
| 0 | Spike giá trị + engine: V1 CLI-only prototype, R1 replay lịch sử git, S1 engine, S3 bộ vàng | **G0**: chủ dự án duyệt số đo; R1/V1 quyết định có làm P1 không |
| P1 | Engine lõi + CLI `impact/context/tests/overlap` + hub + co-change soft edge | **G-A** (A/B) và **G-B** (replay) |
| P2 | Manager–worker: scope ownership, cảnh báo trùng trước khi giao, gợi ý test cho `verify` | **G-C** (cảnh báo không chặn khi chưa đạt precision) |
| P3 | UI neo vào diff/run (overlay worktree, WS), sau đó mới điểm vào "bản đồ" | Phản hồi dùng thật, đo cục bộ |

---

## 1. Mục tiêu, không mục tiêu, nguyên tắc

### 1.1 Mục tiêu

- **Người dùng:** nhìn một run/diff và thấy ngay *file nào bị kéo theo, test nào nên chạy, vì sao* (đường đi + nguồn gốc
  cạnh); có danh sách/bảng trước, canvas sau.
- **Agent:** truy vấn có trần token, outline trước, 1–2 hop, có dẫn chứng và cờ "đầy đủ/bị cắt", luôn có đường lui
  `grep`/đọc source (`research-agent-evidence.md` bài học 2–3).
- **Manager–worker:** mỗi file/vùng chung có một chủ; cảnh báo trước khi giao nếu vùng ảnh hưởng của hai worker giao
  nhau; gợi ý tập test chạy trước cho `verify`.

### 1.2 Không mục tiêu

- Không thay hay sửa Automations; không móc Automations ở đợt này (§14).
- Không dự đoán xung đột bằng ML; không khẳng định "không xung đột" (`research-impact-ux.md` bài học 8).
- Không call graph/phân tích kiểu đầy đủ ở MVP; không embeddings; không tóm tắt AI mặc định.
- Không dịch vụ ngoài, không upload, không MCP server riêng ở MVP (CLI/HTTP đủ; adapter MCP tùy chọn về sau).
- Không watcher nền mặc định; không bản sao ngữ nghĩa Bazel/Nx/Pants.

### 1.3 Nguyên tắc ràng buộc (từ `AGENTS.md`)

| Nguyên tắc | Hệ quả cho Project Graph |
| --- | --- |
| Zero config | Không file cấu hình bắt buộc; thiếu parser/git thì thu nhỏ, không hỏng boot |
| State được ghi, không bắt buộc | Cache `.ai/onni/project-graph/`, thêm vào `DATA_GITIGNORE_ENTRIES` (`data-gitignore.ts`) cùng commit; xóa đi tự dựng lại |
| Thứ tăng chi phí/phơi bày phải opt-in | Nhân tố nào gọi subprocess ngoài (Nx/Turbo/runner `related`) hay chạy nền: có công tắc `ONNI_*` ghi `.env.example` |
| API chỉ `/api/v1`, mô tả bằng zod | Schema ở `packages/contract` (Node-free), route chuỗi vào family builder, validator là middleware (`server/validators.ts`) |
| Suy biến là giá trị | Lỗi git/parser/cache/subprocess trả `{ available:false, reason }`, không throw |
| Ghi nguyên tử | `writeAtomic` + khóa (`dispatch/state-file.ts`); config chỉ qua `mergeWriteWorkspaceConfig` |
| Một socket WS | Thêm topic, không `new WebSocket` (`server/ws.ts`, hook ở `web/src/api/ws.ts`) |
| Test cạnh code, không `.skip` | Mỗi module có `*.test.ts`; guard bên trong test |
| Run không tự merge, unattended bị rào | Graph **không** có đường merge/push; chỉ đọc + cảnh báo |
| Conventional Commits có scope | `feat(graph): …`, `docs(graph): …` |

---

## 2. Hiện trạng và bằng chứng

### 2.1 Từ code (đã kiểm lại 2026-11-13)

- **Quy mô** (từ `survey-server.md` §10, số của 2026-11-06, chưa đếm lại): ~797 file nguồn production (~199k dòng)
  trong bốn package; ước ~800 node/~1.510 cạnh import (ước lượng, UNVERIFIABLE theo review #3). Cấp file khả thi trong RAM.
- **Cái đã đổi so với bản cũ:**
  - `workflows/run.ts` hiện **3.455 dòng**, logic đã tách ra `workflows/run/*.ts` (`dispatch.ts`, `settlement.ts`,
    `verify.ts`, `manager-controls.ts`, `graph.ts`…). `server/server.ts` **2.629 dòng**, route nằm ở `server/routes/*.ts`.
    Các con số 10.144/8.422 dòng của bản cũ (và `manager-worker-proposals.md` D1) đã **cũ**.
  - `onni task verify <id> [--only] [--baseline]` đã có: `dispatch/commands.ts` (mục `verify`), route
    `POST /runs/:id/verify` (`server/routes/dispatch.ts`), logic `workflows/run/verify.ts`, lệnh kiểm tra từ
    `discoverVerifyCommands` (`core/verify-commands.ts`).
  - `onni task conflicts [<worker id>]` đã có: `dispatch/task-cli.ts` (case `conflicts`) → `GET /runs/:id/conflicts`;
    `dispatch/conflicts.ts` có `parseScope`, `findOverlaps`, `outsideScope`, `capOverlaps`, `formatConflicts`, và **trial
    merge** (`git merge-tree`, nhãn "trial merges unavailable" khi thiếu). Đây là authority xung đột văn bản.
- **Tái dùng được:** `resolveTaskDiffBase` (`git-diff-base.ts`) — neo diff duy nhất; `worktreeChangedFilesReadOnly`
  (`git-worktree.ts`, đã dùng ở `workflows/run/dispatch.ts`, `manager-controls.ts`); `server/git-changes.ts` (`git log`,
  `diff-tree -M`, `listRepoPaths` trần 20.000 path/8 MiB, `FILE_CONTENT_CAP`); `requireRootManager`
  (`dispatch/access.ts`); `childSettleReport` (`dispatch/engine.ts`); `protectedByLiveTree` (`runs/retention.ts`);
  `prompt-budget.ts` (trần block); mẫu store theo project `automations/`, `dispatch/state-file.ts`.
- **Chưa có:** miner co-change; ánh xạ path→run (`RunRecord.diffStat` chỉ số lượng); danh sách scope có cấu trúc
  (`NewTaskDraft` không có scope, `survey-web.md` §7); không có thư mục `packages/work/src/project-graph/`.
- **Rủi ro hiệu năng đã được khảo sát** (`.ai/perf/`): (a) `useRunChanges` poll 4 s (`web/src/api/queries.ts:1167`,
  `c-cockpit-web.md` §3) — khuyến nghị đổi sang WS marker; (b) `runs.json` ghi đồng bộ cả file mỗi flush
  (`runs/store.ts` `saveNow`, `a-server-state-git.md` §4; `b-streaming-pipeline.md` §1, ≈117 ms/lần ở N=800);
  (c) `appendFileSync` mỗi event (`runs/store.ts` `persistEvent`, `a` §5, `b` §3); (d) một trang diff có thể spawn nhiều
  process git tuần tự (`a` §3). **Hệ quả thiết kế: graph không được thêm việc đồng bộ vào các đường này.**
- **Hub (đo thô, grep import tương đối, ngoại suy được 1 bậc):** `runs/store` được import bởi ~62 file không-test,
  `paths` ~27, `git-worktree` ~25, `workflows/run` ~15. Với ~62 dependents trực tiếp, impact cấp file của một thay đổi
  trong `runs/store.ts` sẽ chạm hàng chục file chỉ ở 1 hop: đúng (nó thật sự quan trọng) nhưng **không phân biệt** —
  xem §4.4.
- **TypeScript 7.0.2 (đã đo ở bản trước):** `createProgram` không có; có `typescript/unstable/*`; ở `packages/work`
  TypeScript chỉ là `devDependency`. Mọi parser runtime phải khai báo trong `packages/work/package.json`.
- **Web:** có `@xyflow/react ^12.12.0` + `@dagrejs/dagre ^3.1.1`, ba đồ thị (workflow/task/activity); WS client
  `web/src/api/ws.ts`. Chưa có Sigma/Cytoscape/ELK.

### 2.2 Từ nghiên cứu bên ngoài (cô đọng)

| Chủ đề | Kết luận dùng | Nguồn |
| --- | --- | --- |
| Graph ↔ resolve | RepoGraph: resolve 27,33→29,67% (+2,34), file localization 68,7→74,3%, nhưng chi phí $0,34→$0,39 và token 42,4k→47,3k: **không phải tiết kiệm token** | `research-agent-evidence.md` §Benchmark |
| Ablation mạnh nhất | Hybrid structural index ON/OFF cùng harness: acc@5 44,3→84,5%, resolve 41,9→50,4% — nhưng index gồm semantic+lexical+call graph, **n=91, preprint** | cùng, hàng "Code Isn't Memory" |
| Grep vẫn mạnh | Với exhaustive/exact string, source đầy đủ grep/đọc thắng graph; đối chứng grep khác harness chưa đạt ý nghĩa thống kê (p=.08) | cùng, §Trả lời thiết kế, hàng Codebase-Memory |
| Hub/budget | Ego 1-hop ~11,6 node, 2-hop ~54,5; **flatten 2-hop → 26% < baseline**; cắt output lặng lẽ làm 7 lượt thành 18, token 267k→708k | cùng, §Hub/§Budget |
| Impact có sẵn | Nx/Turbo/Rush/Bazel/Pants chọn project affected; `vitest --changed/related`, `jest --findRelatedTests` chọn test | `research-impact-ux.md` §Impact và lựa chọn build/test |
| Hub làm impact "không phân biệt" | Hiển thị theo lớp: changed → dependents → package/target → tests, kèm số lượng/confidence/lý do | cùng, §Trả lời câu hỏi 1 |
| Va chạm | Worktree chỉ cô lập; thứ giảm va chạm là **một chủ mỗi vùng/file + hợp đồng trước + trial merge sớm**; graph/co-change chỉ xếp hạng cảnh báo | cùng, §Trả lời câu hỏi 2 |
| Co-change | Độc lập ngôn ngữ, nhiều nhiễu (commit lớn, test churn); phải lọc, min support, time decay, hiển thị commit mẫu | cùng, §Trả lời câu hỏi 4 |
| UX | Graph sống khi gắn action (Nx affected, Dependabot); CodeSee/Sourcetrail đóng vì economics/maintenance, **không** chứng minh map vô ích | cùng, §Trả lời câu hỏi 3 |
| Engine | Không engine nào đủ mọi thứ; tree-sitter cho breadth, TS compiler/SCIP cho depth và tốn cấu hình | `research-engines.md`; `research-agent-evidence.md` §Ngôn ngữ |
| Giấy phép | Code Maat GPL-3.0, Cosmograph CC-BY-NC, ELK EPL/GPL: loại khỏi lựa chọn mặc định | review bản 2026-11-06 #18–#20 (commit `b5f6172`) |

Hạn chế phải nói thẳng: **không có nghiên cứu A/B hiện đại nào đo "chia phạm vi bằng graph" cho agent**
(`research-impact-ux.md` §Trả lời câu hỏi 2); bằng chứng agent-graph chủ yếu là Python/SWE-bench. Vì vậy các cổng §9
là điều kiện cần, không phải hình thức.

---

## 3. Ba hành động neo

### 3.1 Impact của diff/run (hành động số 1)

Đầu vào: một tập file đổi — từ `worktreeChangedFilesReadOnly` (worktree đang chạy) hoặc diff có neo
`resolveTaskDiffBase` (run đã settle) hoặc danh sách `--files`. Đầu ra là **các lớp, mỗi lớp có đếm và mở rộng theo
yêu cầu**, không phải một canvas:

| Lớp | Nội dung | Nguồn/độ tin cậy |
| --- | --- | --- |
| L0 Đã đổi | Các file đổi (+ rename qua `-M`) | `extracted` (git) |
| L1 Dependents trực tiếp | File import L0 (1 hop), **nhóm theo thư mục/package**; hub được thu gọn (§4.4) | `extracted` (import) |
| L2 Package/target | Package workspace bị kéo theo; nếu repo có Nx/Turbo/Rush/Bazel/Pants: kết quả của chính tool đó | `extracted`/`declared` (manifest, tool) |
| L3 Ứng viên test | Giao của L1/L2 với test + test runner-native (§3.2) | gồm `confidence` + lý do |
| LX Gợi ý mềm | File thường sửa cùng (co-change) mà chưa có trong L0 | `inferred`, tách riêng, có commit mẫu |

Mỗi dòng mang: `provenance`, `confidence` (chỉ bắt buộc với `inferred`), lý do một dòng ("import `a.ts`"), và `via`
(đường đi ngắn nhất tới L0). Kết quả có cờ `complete`/`truncated` và, khi graph `stale` hoặc thiếu parser cho ngôn
ngữ của file, `coverage` nói rõ "không đánh giá được X file" — **không im lặng bỏ sót**.

### 3.2 Ứng viên test cho `verify` (hành động số 2)

Thang chọn, từ rẻ/chính xác nhất xuống, dừng ở nấc đầu tiên khả dụng và **luôn hợp nhất với nấc rộng hơn khi không
chắc** (`research-impact-ux.md` §Trả lời câu hỏi 1):

1. Tool của repo nếu có (`nx affected -t test`, `turbo run test --affected`, `rush`, `bazel query rdeps`, `pants
   --changed-since`): đọc output, không tự cài, có timeout/trần output. **Opt-in** qua `ONNI_PROJECT_GRAPH_TOOLS=1`
   (chạy subprocess ngoài; bật nhầm tốn CPU).
2. Runner-native: `vitest related <files>` / `vitest run --changed <ref>`, `jest --findRelatedTests`. Repo này dùng Vitest
   (`vitest ^4.1.10`, script `test`), nên nấc này là cái đầu tiên được thử trong Giai đoạn 0.
3. Tự suy từ graph: `tested-by` (test import file) + test trong cùng package.
4. Lưới an toàn: `discoverVerifyCommands` (`core/verify-commands.ts`) — toàn bộ lệnh kiểm tra như hôm nay.

Đầu ra là **gợi ý đi kèm lý do**, không đổi hành vi `onni task verify` mặc định cho đến khi cổng G-B đạt
(§9.2). Nếu replay phát hiện một failure thật bị bỏ sót, tính năng này **vĩnh viễn ở chế độ gợi ý** (chạy subset
trước, toàn bộ sau), theo `research-impact-ux.md` §Kế hoạch kiểm chứng mục 5.

### 3.3 Sở hữu phạm vi và cảnh báo trùng trước khi giao (hành động số 3)

Chi tiết ở §7. Tóm lược: graph tính *vùng ảnh hưởng dự kiến* cho scope của từng phần việc, so với các worker đang
chạy; trả cảnh báo xếp hạng (trùng chính xác = sự thật; trùng qua hub/co-change = gợi ý). Xung đột văn bản vẫn do
`onni task conflicts` quyết định.

---

## 4. Kiến trúc engine

### 4.1 Chiến lược ngôn ngữ

- **Mặc định: tree-sitter (WASM)** cho file/module/import/định nghĩa (outline) đa ngôn ngữ — để repo Python/Go/Java của
  người dùng cũng có giá trị, không chỉ TS (`research-agent-evidence.md` bài học 6; đánh giá điểm 4). Giới hạn đã biết:
  không phân giải type/dispatch động/macro (C macro-heavy 0,58 vs 1,00 trong paper Codebase-Memory); cạnh không giải
  được là `unresolved`, không bịa đích.
- **Adapter TS semantic (tùy chọn):** `oxc-parser`/`es-module-lexer`/TS 7 `unstable` — chỉ thêm nếu spike S1 chứng minh
  nó nâng độ chính xác import `.js→.ts`, `export … from`, workspace/alias đáng kể so với tree-sitter. Nếu không, bỏ.
- **Ngoài graph tĩnh:** `package.json` workspaces/`exports` (npm), `go.mod`, `pyproject` ở mức package khi dễ; không
  cố đạt đủ mọi ngôn ngữ.

### 4.2 Spike S1 — chọn engine bằng đo, không bằng tài liệu

Thang chấm giữ từ bản trước (7 điều kiện), **bỏ các ngưỡng "10 s/100 ms" làm cổng**; chúng chỉ còn là số báo cáo.

| Điều kiện | Ngưỡng/ghi chú |
| --- | --- |
| Chạy Windows 11 + Node 20 và 22, trong tarball `@onni/work` (`npm pack` + cài thử), không cần toolchain biên dịch | bắt buộc |
| Độ khớp với bộ vàng S3 trên cạnh import tương đối, `export … from`, `import type`, `import()` hằng, workspace | ≥ 99% cho adapter TS; tree-sitter đa ngôn ngữ báo riêng từng ngôn ngữ |
| Thời gian dựng nguội ~1.600 file code; tăng dần 1 file; RAM đỉnh; không giữ AST cả repo | báo số đo, mục tiêu tham khảo |
| **Event loop**: build chia lô, `await` nhường mỗi lô; đo độ trễ event loop khi build chạy cạnh một run đang stream | bắt buộc (§11) |
| Giấy phép MIT/Apache/ISC; dependency khai trong `packages/work/package.json` | bắt buộc |

Ứng viên: `tree-sitter` (WASM) + grammar; `oxc-parser`; `es-module-lexer` (+`esbuild` đã là devDependency của
`packages/work`); TS 7 `unstable`; regex (đối chứng). Kết quả ghi `docs/design/project-graph/spikes/engine.md`.

### 4.3 Mô hình dữ liệu

**Node:** `package` (`pkg:<name>`), `dir`, `file` (`file:<posix path>`, thuộc tính ngôn ngữ, kích thước, hash nội
dung, `roles[]` = `test|doc|…`), `ext` (phụ thuộc bên thứ ba gộp theo gói), `export` (`sym:<file>#<name>`, **chỉ cho
file hub**, §4.4). *Run* không còn là node của đồ thị nền; quan hệ run→file là bảng riêng (§4.6). Test/doc là *role*
trên node `file`, không phải node riêng (giữ từ review #40).

**Cạnh:**

| Kind | Hướng | Nguồn | Hiển thị mặc định |
| --- | --- | --- | --- |
| `imports`, `reexports` | file → file/ext | `extracted` | bật |
| `tested-by` | file → test | `declared` (tên/vị trí) hoặc `extracted` (test import file) | bật |
| `package-dep` | package → package | `extracted` (manifest) | bật |
| `co-change` | file ↔ file | `inferred` (git; `count`, `support`, `confidence`, `window`, `lastCommit`) | **bật trong lớp LX, tách khỏi dependent** |
| `exports-used` | file → export | `extracted` (chỉ hub) | theo yêu cầu |
| `contract-flow` | schema → route → client → hook | `declared`, **plugin quy ước tùy chọn của repo Onni** (§4.8) | tắt ngoài repo khớp |

Thuộc tính chung: `kind`, `from`, `to`, `provenance`, `confidence`, `extractor`+`extractorVersion`, `evidence`
(path:dòng), `commit`. `unresolved` cho dynamic import không giải được.

ID là đường dẫn tương đối POSIX giữ nguyên hoa/thường; bảng `aliases` từ rename (`-M`) để link cũ vẫn trỏ đúng; không
dùng đường dẫn tuyệt đối trong ID/cache key. `GRAPH_SCHEMA_VERSION` khác → bỏ cache, dựng lại.

### 4.4 Xử lý file hub (có trong MVP)

Hub = file có số dependents vào lớn (ví dụ `runs/store.ts` ~62 file, đo thô ở §2.1). Quy tắc:

1. **Ngưỡng hub tự thích nghi** (phân vị cao của in-degree, ví dụ ≥ p95 và ≥ N tuyệt đối; hằng số, spike S5 chỉnh).
   Dưới ngưỡng: cạnh file→file như thường.
2. **Giảm nhiễu khi là *hạt giống* hub:** thay vì "62 dependents", trả `62 file ở 14 thư mục` nhóm theo thư mục/package,
   mỗi nhóm có đếm và 3 file đại diện; mở rộng theo yêu cầu (`--expand <nhóm>`).
3. **Cạnh cấp export cho hub:** với file hub, ghi thêm `exports-used` (file X dùng export Y của hub) khi parser cho phép.
   `impact` trên *export đã đổi* (nếu diff cho biết hàm nào đổi) chỉ kéo file dùng export đó — đây là cách **thoát khỏi
   "half the repo"** mà không cần call graph. Khi không biết export nào đổi: trả nhóm + nhãn `hub: coarse`.
4. **Personalized ranking** (Aider/RepoGraph): xếp hạng theo khoảng cách tới hạt giống + PageRank cá nhân hóa, không
   dùng degree toàn cục; giới hạn 1–2 hop, dedupe (`research-agent-evidence.md` §Hub).
5. Barrel `index.ts` re-export: tính `reexports` nhưng thu gọn đường đi qua barrel khi tính impact (nhãn `via barrel`).

Đo hiệu quả bằng số **kích thước tập kết quả trung vị/p90 của impact** theo từng cách (không giảm, nhóm, export-level)
trên replay R1; nếu export-level không thu hẹp đáng kể → ghi nhận, không chuyển sang call graph trừ khi G-A đòi.

### 4.5 Co-change (nâng lên MVP, làm soft edge)

Language-agnostic, rẻ (chỉ `git log`). Tăng dần đến `lastIndexedCommit`; **tự cài thuật toán đếm cặp, không nhúng Code
Maat (GPL)**. Bộ lọc nhiễu bắt buộc (`research-impact-ux.md` §Trả lời câu hỏi 4):

- bỏ merge commit; bỏ commit bot/dependency bump/format/rename hàng loạt/generated/vendor/lockfile;
- bỏ commit vượt ngưỡng số file (phân vị mạnh, hằng số);
- yêu cầu `support` (số lần) ≥ N và `confidence` = P(B|A) ≥ ngưỡng; giảm trọng số theo tuổi commit (time decay);
- tách code↔test và code↔config (test churn gây nhiễu theo study 10.1145/3607183);
- luôn kèm commit mẫu để giải thích; cho loại trừ path.

Đối xử: là *soft edge* hiển thị ở lớp LX, **không** đổi tên thành dependency và **không** tham gia chọn test tự động.
**Không chặn dispatch cho đến khi replay (R1, cổng G-C) cho precision chấp nhận được** (§9.3). Công tắc nội bộ
`ONNI_PROJECT_GRAPH_COCHANGE` mặc định theo quyết định D5; dưới G-C nó chỉ in cảnh báo, không bao giờ làm `dispatch()`
trả 409.

### 4.6 Pipeline, cache, freshness

```
liệt kê file (git ls-files, ignore, denylist) ──► băm nội dung ──► (cache theo hash: kết quả trích từng file)
      ──► ghép đồ thị ──► hậu xử lý (tested-by, package-dep, hub, co-change) ──► ghi snapshot nguyên tử + manifest
```

- Vị trí: `packages/work/src/project-graph/` (mới); `server/project-graph.ts`/`server/routes/project-graph.ts` chỉ nối dây.
- Cache: `.ai/onni/project-graph/` gồm `manifest.json` (schema, extractor+version, workspace hash, `head`, đếm),
  `files/<hash>.json` (kết quả trích bất biến), snapshot NDJSON. Ghi qua `writeAtomic`; con trỏ manifest đổi sau cùng
  dưới khóa liên tiến trình (mẫu `proper-lockfile` của Automations).
- **Freshness (độ đúng, không phải tối ưu):** trước mỗi truy vấn, so `head` + hash file *liên quan tới câu hỏi* (lazy
  validation). Khác → cập nhật tăng dần **nguyên tử** (thay node/cạnh sinh ra từ file đó, tính lại cạnh vào, dọn rename/
  xóa) hoặc, nếu quá trần thời gian, trả kết quả cũ đánh dấu `stale` **và** chỉ dẫn "dùng grep/đọc source". Không có
  watcher ở MVP (D4). Mọi kết quả mang `snapshot.head`/`builtAt`/`stale`.
- **Event loop:** build chia lô (theo số file/thời gian), `await` nhường sau mỗi lô; mọi lệnh có `AbortSignal`, trần
  thời gian, trần byte/file, trần node/cạnh, đồng thời tối đa M tác vụ. **Không** build trong handler đọc.
- Dựng lại toàn bộ luôn khả dụng; cache hỏng → bỏ, dựng lại (không crash).

Ghi **run→file** (cho "run đụng file nào", cần cho G-B và cảnh báo trùng): lấy từ ảnh chụp thay đổi lúc settle đã có ở
`childSettleReport` (`dispatch/engine.ts`) — **đọc ở bước settle từ dữ liệu đã tính, ghi bất đồng bộ qua hàng đợi
riêng**, không thêm `flush()`/`appendFileSync` vào hot path `workflows/run/*` (`.ai/perf/b-streaming-pipeline.md` §1, §3).
Lọc path nhạy cảm, trần số path, theo retention của run store.

### 4.7 An toàn, quyền riêng tư (giữ từ bản trước, cập nhật)

- **Denylist bí mật:** `.env`, `.env.*` (trừ `.env.example`), `*.pem`, `*.key`, `id_rsa*`, `*.p12`, toàn bộ `.npmrc` theo
  đường dẫn, `.git/`, `node_modules`, `dist/`, `web/dist`, file sinh ra. File thuộc denylist **không đọc, không băm,
  không cache, tên/đường dẫn không vào đồ thị**; tôn trọng `.gitignore` *và* denylist (file đã track vẫn bị chặn).
  Đồ thị lưu tên/đường dẫn/hash, **không lưu mã**.
- **Giới hạn:** trần byte mỗi file 512.000 byte (cùng cỡ `FILE_CONTENT_CAP` trong `server/git-changes.ts`), trần tổng,
  trần node/cạnh, trần thời gian; symlink/junction không ra ngoài gốc repo; không giữ cả AST.
- **Windows:** chuẩn hóa bằng `node:path` rồi tuần tự hóa POSIX; xử lý hoa/thường, CRLF, `EPERM` khi đổi tên
  (`fs-rename.ts`); không yêu cầu symlink.
- **WS:** `loopbackReadable` giữ `false` (path/symbol không công khai cho mọi origin cục bộ).
- **Subprocess ngoài (Nx/Turbo/runner):** môi trường tối thiểu (không truyền `process.env` trần), timeout kill thật, trần
  output, `redactRunText` — cùng quy tắc với `onni task verify`.
- **Số đo giá trị chỉ lưu cục bộ** (xem §9.4); không có gửi đi.

### 4.8 `contract-flow` — plugin tùy chọn, không phải lõi

Chuỗi schema→route→client→hook (`packages/contract/src/<family>.ts` ← `server/routes/*.ts` ← `AppType` →
`packages/api-client` → `packages/web/src/api/*`) là đặc thù Onni. Hạ xuống **bộ nhận diện quy ước bật khi repo khớp**,
mỗi quy ước một hàm có test, `provenance: declared`, trả rỗng ở repo khác (không đoán). Không chặn MVP; giá trị chính của
nó ở dogfooding (R1/G-B trên repo này), không phải lý do bán chức năng.

---

## 5. API, WebSocket, CLI, công tắc

### 5.1 Contract và route (CLI trước, HTTP theo sau)

`packages/contract/src/project-graph.ts` (Node-free, export qua `index.ts`). Route family `projectGraphRoutes` chuỗi vào
`v1`, validator làm middleware:

| Route | Mô tả | Giai đoạn |
| --- | --- | --- |
| `GET /graph` | `status` (`ready/building/stale/unavailable`), `head`, đếm, thời điểm, lý do | P1 |
| `GET /graph/impact` | `files[]` hoặc `runId`/`diff` → các lớp §3.1, có `complete/truncated/coverage` | P1 |
| `GET /graph/tests` | ứng viên test (§3.2) | P1 |
| `GET /graph/context` | `scope[]`, `maxTokens` → gói gọn cho agent | P1 |
| `GET /graph/neighbors`, `/graph/path`, `/graph/search` | tra cứu cục bộ | P1 |
| `GET /graph/overlap` | cảnh báo trùng vùng giữa worker/phần việc (§7) | P2 |
| `GET /graph/overview` | cấp gộp (package/dir) — **điểm vào bản đồ, P3** | P3 |
| `POST /graph/rebuild` | dựng lại (có trần tần suất) | P1 |

Mọi phản hồi có trần số node/cạnh/byte, cờ `truncated`, `snapshot`. Parity hai chiều (`contract-parity.projectGraph.test.ts`),
`route-parity`, `versioned-surface`, `typed-bodies`. Handler đọc không tạo đồ thị (trả `building`).

### 5.2 WebSocket — **một** topic

Topic `project-graph` theo project: `{status, revision}` + id node bị tác động (nhỏ); dữ liệu lấy qua HTTP. Publisher
khởi động ở 0→1 subscriber, dừng ở 1→0, **chỉ phát khi đổi** (`AGENTS.md`, live signals). Topic `project-graph-activity`
của bản cũ **bỏ**: nhu cầu "worker đang sửa node nào" dùng cùng cơ chế marker WS "git changed" mà khảo sát perf đã
khuyến nghị làm cho Changes view (`.ai/perf/c-cockpit-web.md` §3) — dùng chung, không tạo kênh riêng.

### 5.3 CLI (`node "$ONNI_BIN" graph …`)

```
onni graph status
onni graph build [--full]
onni graph impact <file…> | --run <id> | --diff [--expand <group>] [--max-tokens N] [--format text|json]
onni graph tests  <file…> | --run <id>            ứng viên test + lý do + confidence
onni graph context --scope <path…> [--max-tokens 3000] [--format text|json]
onni graph overlap <scope…> [--against <worker id>]  (P2)
onni graph neighbors <node> [--depth 2] [--kind …] ; onni graph path <from> <to> ; onni graph search <text>
```

Verb cố định (không Cypher). `json` ổn định cho máy, `text` gọn cho prompt; text có outline trước, signature + line range
cho file lớn. Mọi lệnh chỉ-đọc ngoại trừ `build`. Cờ `--format json` mang `complete`, `truncated`, `stale`, `coverage`.

### 5.4 Công tắc

- `ONNI_PROJECT_GRAPH=0` tắt hoàn toàn (nav ẩn, route 409, không khởi động coordinator). **Mặc định BẬT chỉ khi chủ dự
  án duyệt ngoại lệ default-on (D1); chưa duyệt → mặc định TẮT** (review #43). Thêm vào `.env.example` và
  `docs/reference.md` cùng commit.
- `ONNI_PROJECT_GRAPH_TOOLS=1`: cho phép gọi tool/runner ngoài ở §3.2 (mặc định tắt).
- `ONNI_PROJECT_GRAPH_COCHANGE=0|1`: quyết định D5; mặc định theo D5.
- Capability `projectGraph` ở `server/capabilities.ts` (`resolveCapabilities`), mẫu như `automations`.
- Bỏ khỏi bản này: `ONNI_PROJECT_GRAPH_AI_SUMMARY` (chuyển §14).

---

## 6. Giao cho agent

Nguyên tắc: **agent truy vấn khi cần; không nhét đồ thị vào prompt** (pre-inject trả phí mỗi task và stale trong phiên,
`research-agent-evidence.md` §MCP/CLI). Chỉ tiêm một map nhỏ cho task nhiều file/chưa rõ đường dẫn, và chỉ sau G-A.

| Điểm | Việc | Giới hạn |
| --- | --- | --- |
| Bảng lệnh `dispatch/commands.ts` | Nhóm `graph` riêng (không giả làm `task`); mô tả 1–2 dòng | `prompt-budget.ts`: thêm hằng và test trường hợp xấu nhất (block lệnh hiện ~2.400 ký tự) |
| `workflows/manager-worker.ts` (`managerPrompt`, `workerPrompt`) | 1–3 dòng: khi nào dùng `impact`/`tests`/`context` | trần block |
| Run mới và run tiếp nối (`workflows/run/start.ts`, `continuation.ts`; `composeSystemPrompt`/`composeDispatchPrompt`) | cùng một nguồn hướng dẫn, test cả hai đường | tránh lệch twin |
| Skill dựng sẵn (mẫu `automations/builtin-skill.ts`) | skill ngắn, chỉ hiện khi capability bật | |
| `onni task create --context-from-graph` | gói `graph context` ghi vào **file trong thư mục cây**, order chỉ trỏ tới (order bị giới hạn 4.000 ký tự) | trần token |

**Hợp đồng đầu ra cho agent:**

- Outline trước (path, symbol/export, line range), rồi quan hệ; ego 1–2 hop; nhóm hub; dedupe; **personalized ranking**
  theo scope/diff; cắt theo `maxTokens` bằng bộ tuần tự hóa thật.
- **Không cắt lặng lẽ:** luôn có `complete: true|false`, `truncated`, `nextPage`/`--expand` (trường hợp output bị cắt
  khiến 7 lượt thành 18 trong case study, `research-agent-evidence.md` §Hub/§Budget).
- Mỗi kết quả: `provenance`, `confidence`, `evidence`, `snapshot.head`, `stale`. Stale hoặc `unresolved` → nói rõ
  **"dùng grep/đọc source"** (đường lui cố định).
- Khi `ONNI_BIN` không có hoặc graph không khả dụng, hướng dẫn nói thẳng là không khả dụng — agent làm như cũ.
- Backend antigravity (`agy`): theo `AGENTS.md`, lệnh cần khớp **cả dòng** và hạn chế; đồ thị là thứ dùng qua
  manager đọc hộ (bản report), không giả định `agy` gọi được `onni graph`.

Không dùng embeddings/tóm tắt LLM mặc định; chỉ xem lại nếu eval Onni cho thấy graph+grep còn thiếu
(`research-agent-evidence.md` bài học 7).

---

## 7. Manager–worker

Nền đã có: `onni task conflicts` (trùng file + `outsideScope` + trial merge `git merge-tree`), `onni task verify`
(`--baseline`), `requireRootManager`, phạm vi `scope` (hiện là chuỗi, `parseScope`/`globToRegExp` ở
`dispatch/conflicts.ts`). Graph **bổ sung ở thời điểm lập kế hoạch**, nơi các công cụ đó chưa với tới:

| Khả năng | Cách dùng graph | Là gì so với authority hiện có |
| --- | --- | --- |
| Phân vùng khi lập kế hoạch | `graph overlap <scope…>`: vùng đóng = file trong scope + dependents trực tiếp (nhóm hub) + co-change mạnh; so giữa các phần việc | **Cảnh báo.** `conflicts` chỉ nhìn thay đổi *đã có*; đây nhìn *dự kiến* |
| Chủ của file/vùng chung | Gợi ý một owner mỗi file hub / vùng chung (config, translations, type trung tâm); manager chọn | Convention + prompt; không khóa cứng |
| Trước khi giao worker thứ hai | Chạy `overlap` giữa scope mới và scope đang chạy → cảnh báo xếp hạng (trùng chính xác > qua hub > co-change) | **Không chặn dispatch** cho đến khi G-C đạt; không bao giờ trả "không xung đột" |
| Sau khi worker xong | Vẫn `onni task conflicts` (trial merge) — **là authority duy nhất cho xung đột văn bản** | Không đổi |
| Chọn test cho `verify` | `graph tests` → subset chạy trước, **toàn bộ chạy sau** (theo lưới an toàn §3.2) | Gợi ý; chỉ đổi mặc định khi G-B đạt |
| Review worker | Vùng review = L1 của diff | |

Các ràng buộc `AGENTS.md` giữ nguyên: roster là rào chắn, worker chỉ report; graph chỉ đọc nên không thay đổi bất biến
"không tự merge"; không có đường nào để graph gọi `merge`/`push`. Kiểm tra quyền ở server cho route `overlap` theo mẫu
`requireRootManager` (manager) hoặc project (CLI người dùng).

Điều kiện đưa vào prompt manager: chỉ sau khi G-A cho thấy manager dùng `overlap/impact` làm giảm xung đột hoặc lượt.

---

## 8. Cockpit (web) — sau CLI, neo vào diff/run

### 8.1 Thứ tự

1. **P3a — thẻ "Impact" trong view của một task/run** (cạnh Changes): bảng lớp L0–L3/LX có đếm, nhóm hub, mở rộng
   theo yêu cầu, "vì sao" (đường đi + provenance). Đây là view đầu tiên; **không** cần canvas.
2. **P3b — "đồ thị của diff"** (xyflow, ≤ vài chục node): bật khi người dùng bấm từ thẻ Impact; có bảng/cây tương đương.
3. **P3c — điểm vào bản đồ toàn repo** (package/dir gộp, mở dần) — chỉ khi dữ liệu dùng cục bộ (§9.4) cho thấy người dùng
   quay lại P3a/P3b; nếu không thì không làm.

### 8.2 Quy ước

Route project-scoped `/p/:projectId/graph` (lazy qua `lazyRoute`), mục nav lọc theo capability `projectGraph`; nhãn
"Graph"/"Đồ thị dự án" (`lib/i18n/vi-graph.ts`). Query key có `projectId`, `head/revision`, tham số; phân biệt loading /
chưa dựng / stale / lỗi / bị cắt. Tuân `design-guardian.test.ts`, WCAG AA, `focus-visible`, `prefers-reduced-motion`;
luôn có bảng/cây cho trình đọc màn hình. Không chạm `routes/automations/`.

### 8.3 Renderer

`@xyflow/react` + `@dagrejs/dagre` (đã có) đủ cho đồ thị diff nhỏ; **không thêm thư viện render thứ hai** trong phạm vi
này (§14). Phía server gộp; trình duyệt không nhận cả đồ thị.

### 8.4 Sống (live) — không poll

- **Không dùng `useRunChanges` (poll 4 s) làm tín hiệu** cho overlay. Khảo sát perf khuyến nghị đổi nó sang WS marker
  (`.ai/perf/c-cockpit-web.md` §3); thẻ Impact **đăng ký marker đó** (và topic `project-graph` khi `revision` đổi) rồi
  mới refetch, gộp (coalesce) một lần mỗi marker, có đối soát khi reconnect.
- Việc phát marker từ server phải bất đồng bộ, **không** chèn thêm công việc đồng bộ vào `workflows/run/*`; nếu marker
  "git changed" chưa có thì P3 đợi hoặc dùng nút "làm mới" thủ công — không quay lại poll.
- Hook `useGraphStatus` dùng `subscribeTopic`, trả hàm huỷ trong `useEffect`.

### 8.5 "Giao task tại đây" (hoãn)

Cần trường `scope: string[]` có cấu trúc trong `NewTaskDraft` (hiện chưa có). **Hoãn (§14)** cho đến khi P2 chứng minh
scope có giá trị; MVP chỉ cần `--scope` của manager (đã có dạng chuỗi).

---

## 9. Cổng xác nhận giá trị (go/no-go)

Cổng nằm **trước** khi đầu tư giai đoạn sau. Kết quả ghi `docs/design/project-graph/evals/*.md` (script nằm ngoài
`src/`), chỉ gồm số đo và mô tả; **không** chứa nội dung code của người dùng.

### 9.1 G-A — A/B trên tác vụ thật của OnniCode (H1)

- **Thiết kế:** ~10 tác vụ thật rút từ lịch sử OnniCode (kể cả ~5 tác vụ manager–worker nhiều worker); cùng model, cùng
  prompt, **cùng commit gốc**, **vài seed**; ba cánh: `graph-off` (như hiện nay), `graph-on` (CLI `impact/context`
  + đường lui), `grep` (đối chứng grep/đọc thuần có chủ đích để tách tác động graph khỏi harness).
- **Đo:** pass/resolve; định vị đúng file và hàm; token vào/ra; số lượt; thời gian; **số lần stale** gặp; với manager–
  worker: xung đột (qua `onni task conflicts`), số lần re-dispatch, test hit-rate (test chọn có chứa test fail thật).
- **Tiêu chí đi tiếp (đề xuất, chủ dự án duyệt ở G0):** định vị tăng, **pass không tụt, chi phí không tăng quá ngưỡng**
  (RepoGraph cho thấy token có thể *tăng* nên không hứa tiết kiệm token). Nếu graph-on ≈ grep hoặc tệ hơn → **no-go**:
  dừng ở CLI nhỏ (impact/tests) hoặc bỏ tiêm vào prompt.
- Cảnh báo thiết kế: mẫu nhỏ, nhiễu seed lớn; báo khoảng tin cậy, không chỉ trung bình.

### 9.2 G-B — Replay lịch sử git của repo này (H2, H3)

- **Dữ liệu:** các commit lịch sử (repo có hơn 600 commit; `git log` đếm 611 trên nhánh này); với mỗi commit/PR dựng lại
  tập file đổi và tập test thực sự thất bại/được sửa cùng.
- **Đo trên từng cách chọn** (§3.2 nấc 2, 3, kết hợp, co-change): precision/recall của *impact* (so với file thực sự
  đổi cùng nhau về sau) và của *ứng viên test* (test fail thật có nằm trong tập không?), kích thước tập kết quả trung vị/p90
  (đo hiệu ứng hub §4.4), số test chọn so với toàn bộ.
- **Cổng:** **không tự chọn subset test cho `verify` trước khi recall (không bỏ sót failure) đạt ngưỡng đã duyệt**; bất kỳ
  failure bị bỏ sót trong tập validation → tính năng giữ ở chế độ gợi ý (§3.2).
- Mở rộng (nếu thời gian): 3–5 repo khác đại diện (Python/Go) để kiểm tính tổng quát tree-sitter.

### 9.3 G-C — Co-change và cảnh báo trùng không chặn dispatch (H3)

- Replay ≥ 2 nhánh đồng thời: đo trùng file chính xác, xung đột `git merge-tree`, lỗi tích hợp, và **precision của cảnh
  báo co-change/hub riêng**, báo theo từng cặp (không một điểm tổng).
- **Điều kiện:** cho tới khi precision đạt ngưỡng đã duyệt, cảnh báo graph ở chế độ *thông tin* — không làm `dispatch()`
  trả 409, không chặn merge, không ghi "đã kiểm tra, không xung đột". Chỉ `onni task conflicts` là có thẩm quyền.

### 9.4 Đo sử dụng — chỉ cục bộ

Số đếm hành động (mở thẻ Impact, bấm "vì sao", dùng `graph tests` trước `verify`, lặp lại theo ngày) ghi vào
`.ai/onni/project-graph/usage.json` hoặc NDJSON cục bộ. **Không gửi đi bất cứ đâu** (`AGENTS.md`: telemetry đã gỡ, không
có consent bar, không `/api/v1/telemetry/*`). Không ghi path/nội dung, chỉ loại hành động và bộ đếm. Dùng để quyết định
P3c; xóa file là đủ để xóa số liệu.

---

## 10. Lộ trình và phân công

Mỗi bước = một PR nhỏ qua đủ cổng (`typecheck`, `test`, `test:unit`, `build`, `test:package`; CI là chuẩn trên Windows,
`AGENTS.md`). Phạm vi file rời nhau cho worker song song; file nóng chung (`server/server.ts`, `index.ts`,
`workflows/run.ts`, `routes.tsx`, `nav-items.ts`, `contract/src/index.ts`, `data-gitignore.ts`, `dispatch/commands.ts`)
chỉ một worker chạm tại một thời điểm. Backend `codex` cho việc cần chạy lệnh; `antigravity` chỉ cho khám phá đọc file.

### Giai đoạn 0 — Spike giá trị và nền chứng cứ (không đổi code sản phẩm)

| ID | Việc | Đầu ra | Điều kiện xong |
| --- | --- | --- | --- |
| V1 | **Prototype CLI-only** `impact` + `tests` trên repo này (script ngoài `src/`), dùng `git` + import regex/lexer đơn giản + `vitest related`; chạy A/B nhỏ trên ~3 tác vụ thử | `spikes/value.md` | Có số định vị/lượt/token cho graph-off vs on; quyết định có làm P1 không |
| R1 | **Replay lịch sử git** (G-B) bản thử nghiệm: precision/recall impact và chọn test, kích thước tập (hiệu ứng hub) | `spikes/replay.md` + script | Bảng số theo cách chọn; ngưỡng đề xuất cho chủ dự án |
| S1 | Spike engine (§4.2) | `spikes/engine.md` | Bảng chấm ứng viên + số đo Windows + khuyến nghị; thêm đo độ trễ event loop |
| S3 | Bộ vàng + fixture (kể cả barrel hub, dynamic import, subprocess, file sinh ra) | `spikes/golden-graph.md` | Danh sách cạnh đúng cho tập con đại diện; cách sinh lại |
| S4 | Đo git: `git ls-files`, `git log --name-status -M` N commit (Windows) | `spikes/git.md` | Số đo thời gian |
| S5 | Chỉnh ngưỡng hub và bộ lọc co-change trên R1 | `spikes/hub-cochange.md` | Bảng ngưỡng ↔ tập kết quả/precision |
| N0 | Baseline môi trường: `npm install` sạch trong worktree, `typecheck/build/test:package`, phân loại lỗi (môi trường Windows hay lỗi thật; ví dụ lệch `undici` `maxRedirections` ở `webhooks/transport.ts` ghi ở bản cũ — **chưa kiểm lại**) | `spikes/baseline.md` | Cổng chất lượng dùng được cho P1 |

(S2 benchmark render của bản cũ **bỏ** — không còn cần cho Giai đoạn 0; đồ thị diff nhỏ chạy trên xyflow có sẵn.)

**Cổng G0:** chủ dự án xem V1/R1/S1 và duyệt D1–D8. V1/R1 **không cho thấy lợi ích** → dừng, ghi lại, không làm P1.

### Giai đoạn P1 — Engine lõi + CLI hành động (cổng G-A, G-B)

| ID | Việc | Phạm vi file độc quyền | Phụ thuộc |
| --- | --- | --- | --- |
| C0 | Contract zod (§5.1) cho `status/impact/tests/context/neighbors` + fixture | `packages/contract/src/project-graph.ts`, `contract/src/index.ts` | G0 |
| E1 | Engine: `GraphExtractor` (tree-sitter + adapter nếu S1), liệt kê file + denylist, băm, cache, ghép đồ thị, tested-by, package-dep, hub (§4.4), freshness (§4.6), co-change (§4.5); test + bộ vàng | `packages/work/src/project-graph/**`, dependency mới trong `packages/work/package.json` | C0, S1, S3, S5 |
| T1 | Ứng viên test (§3.2): đọc `package.json`/runner, gọi `vitest related` (và tool ngoài khi `ONNI_PROJECT_GRAPH_TOOLS=1`) | `packages/work/src/project-graph/tests-select/**` | E1 |
| N1 | Nối dây: route, validator, CLI `onni graph`, capability, `data-gitignore`, `.env.example`, `docs/reference.md`, parity tests | `server/routes/project-graph.ts`, `server/server.ts`, `index.ts`, `project-graph/graph-cli.ts`, `data-gitignore.ts`, `capabilities.ts` | E1, T1 |

**Chấp nhận P1:** `impact/tests/context` đúng trên bộ vàng; xóa cache → tự dựng; không đọc `.env`/khóa (test); build không
làm trễ event loop quá ngưỡng đo ở S1 khi có run đang stream; tắt công tắc → route 409, không process nền; **G-A và G-B
chạy trên bản này và có kết luận ghi lại.**

### Giai đoạn P2 — Manager–worker (chỉ khi G-A không no-go)

| ID | Việc | Phạm vi |
| --- | --- | --- |
| M1 | `graph overlap`, vùng đóng của scope, gộp vào `onni task conflicts`/brief như dòng **cảnh báo** (không đổi kết quả trial merge) | `project-graph/overlap/**`, `dispatch/conflicts.ts` (nối nhỏ) |
| M2 | Tiêm hướng dẫn prompt (`dispatch/commands.ts`, `prompt-budget.ts`, `workflows/manager-worker.ts`, hai đường start/continuation) + skill dựng sẵn + `--context-from-graph` | các file prompt (một worker, tuần tự với M1) |
| M3 | Gợi ý subset test trong `onni task verify` (chỉ khi G-B đạt; ngược lại giữ ở `graph tests`) | `workflows/run/verify.ts`, `core/verify-commands.ts` |

`M1`/`M2`/`M3` cùng chạm vùng dispatch/prompt → **tuần tự**, order nêu danh sách file độc quyền (review #42). G-C chạy trên M1.

### Giai đoạn P3 — Cockpit neo vào diff/run

| ID | Việc |
| --- | --- |
| W1 | Thẻ Impact trong view task/run + hook `useGraphImpact` + WS `project-graph` (§8.1–8.4) |
| W2 | Đồ thị diff nhỏ (xyflow) + bảng tương đương |
| W3 | (có điều kiện, §8.1) điểm vào bản đồ toàn repo |

W1/W2 chạm tối thiểu `routes.tsx`, `nav-items.ts`, `api/queries.ts`, `api/ws.ts` — không worker nào khác chạm trong lúc đó.

### Ước lượng thô (độ lớn, không cam kết)

| Giai đoạn | Độ lớn | Rủi ro chính |
| --- | --- | --- |
| 0 | M | Kết quả V1/R1 không ủng hộ — đó là kết quả hợp lệ |
| P1 | M–L | Cache tăng dần đúng; event loop; tree-sitter đóng gói |
| P2 | M | Trần prompt; nhất quán 2 đường start/continuation |
| P3 | S–M | Chưa có marker WS "git changed" |

---

## 11. Kiểm thử, hiệu năng, chất lượng

- **Đơn vị:** extractor theo fixture (mỗi quy ước một test); cache (thiếu/hỏng/sai phiên bản → dựng lại); tăng dần (đổi,
  đổi tên, xóa); truy vấn (giới hạn depth/limit/token, `truncated`, `stale`); hub (nhóm, export-level); co-change
  (bộ lọc: commit lớn, bot, min support, decay); denylist; path Windows (guard *bên trong* test, không `.skip`).
- **Git thật:** repo tạm cho rename `-M`, co-change, huỷ giữa chừng (guard khả năng git).
- **Bộ vàng của repo này:** chạy lại mỗi khi đổi extractor; đo độ khớp.
- **Contract:** `contract-parity.projectGraph`, `route-parity`, `versioned-surface`, `typed-bodies`.
- **Web:** Vitest + Testing Library (thẻ Impact, nhóm hub, trạng thái stale/truncated, bàn phím, theme/token);
  e2e `.ai/scripts/e2e.sh` — `TEST_E2E_STATUS=skipped` **không phải** pass.
- **Hiệu năng — ràng buộc, không phải mục tiêu đẹp:**
  - Build/cập nhật **chia lô và nhường event loop**; có test đo độ trễ vòng lặp khi build chạy cạnh stream giả.
  - **Không** thêm việc đồng bộ vào `workflows/run/*` hay `runs/store.ts` (`.ai/perf/b-streaming-pipeline.md` §1,3;
    `a-server-state-git.md` §4–5). Ghi run→file qua hàng đợi bất đồng bộ riêng.
  - **Không** poll: dùng WS marker (§8.4).
  - Spawn git của graph dùng helper chỉ-đọc có timeout/`AbortSignal`, gộp lô, không fan-out tuần tự nhiều process
    (`a-server-state-git.md` §3).
  - Số đo thời gian/RAM ghi trong spike; **không** đặt thành cổng CI cho đến khi ổn định.
- **Gói:** `npm run test:package` phải chứng minh parser runtime (tree-sitter WASM/grammar) có trong tarball cài thử.
- **Ghi vết:** mỗi hành động ghi (rebuild) vào ledger; không ghi nội dung code.

---

## 12. Rủi ro và danh sách file chạm

### 12.1 Rủi ro

| Rủi ro | Mức | Giảm thiểu |
| --- | --- | --- |
| Graph không tạo giá trị đo được (H1–H3 sai) | **Cao** | Cổng G0/G-A/G-B; no-go là kết quả hợp lệ; dừng sớm giữ phần CLI nhỏ |
| Đồ thị sai mà trông đáng tin | Cao | Provenance + commit + `stale`; `inferred` tách riêng; bộ vàng; luôn có đường lui grep |
| Tập impact quá rộng do hub | Cao | §4.4 nhóm + export-level + ranking; đo kích thước tập ở R1 |
| Bỏ sót test khi chọn subset | Cao | Subset chỉ gợi ý; chạy toàn bộ sau; gate G-B; không bao giờ "đủ test" |
| Cảnh báo co-change nhiễu làm manager mất tin | Trung bình | Chỉ thông tin trước G-C; commit mẫu; bộ lọc §4.5 |
| Chi phí hiệu năng (event loop, spawn git) | Trung bình–Cao | Build chia lô; không đụng hot path; WS thay poll; trần |
| Parser/WASM không có trong tarball/Windows | Cao | S1 điều kiện 1; `test:package`; phương án dự phòng |
| API TypeScript 7.x thay đổi | Trung bình | Không phụ thuộc `createProgram`; adapter tùy chọn; test khóa phiên bản |
| Trần prompt bị vượt khi thêm hướng dẫn | Trung bình | `prompt-budget.ts` + test xấu nhất |
| Lộ bí mật qua tên file/đồ thị | Trung bình | Denylist; không lưu mã; `loopbackReadable=false` |
| Xung đột file nóng giữa worker | Trung bình | Phạm vi độc quyền; N1/M1/M2 tuần tự |
| Giấy phép (GPL, CC-NC, EPL) | Trung bình | Loại khỏi mặc định (§2.2); kiểm giấy phép khi thêm dependency |
| Phình phạm vi | Trung bình | §14; cổng giai đoạn |
| Comment drift `ONNI_AUTOMATIONS` (`capabilities.ts` nói opt-in, code mặc định bật) | Thấp | Việc riêng, không trộn vào đây |

### 12.2 Danh sách file chạm (tổng hợp)

| Khu vực | File | Giai đoạn |
| --- | --- | --- |
| Contract | `packages/contract/src/project-graph.ts` (mới), `index.ts` | P1 |
| Engine | `packages/work/src/project-graph/**` (mới), `packages/work/package.json` | P1–P2 |
| Server | `server/server.ts`, `server/routes/project-graph.ts` (mới), `server/capabilities.ts`, `server/ws.ts` (topic) | P1–P3 |
| CLI | `packages/work/src/index.ts`, `project-graph/graph-cli.ts` | P1 |
| State | `packages/work/src/data-gitignore.ts` (thêm `project-graph/`) | P1 |
| Dispatch | `dispatch/conflicts.ts` (nối cảnh báo), `dispatch/commands.ts`, `dispatch/prompt-budget.ts`, `workflows/manager-worker.ts`, `workflows/run/verify.ts` | P2 |
| Run | `workflows/run/settlement.ts`/`dispatch.ts` (chỉ đọc dữ liệu settle, ghi bất đồng bộ) | P2 |
| Web | `packages/web/src/routes/graph/**` hoặc thẻ trong view task, `routes.tsx`, `components/nav-items.ts`, `api/queries.ts`, `api/ws.ts`, `lib/i18n/vi-graph.ts` | P3 |
| Tài liệu | `.env.example`, `docs/reference.md`, `docs/design/project-graph/{spikes,evals}/**`, `docs/design/manager-worker.md` | 0+ |

---

## 13. Quyết định cần chủ dự án xác nhận

Mỗi mục có **mặc định đề xuất** để lập kế hoạch không bị chặn; **mặc định chỉ có hiệu lực sau khi chủ dự án xác nhận tại
G0**. D1 (default-on) và D5 (co-change) cần duyệt rõ ràng; chưa duyệt → chạy hướng an toàn (tắt). Im lặng không phải
là phê duyệt (review #43).

| # | Quyết định | Mặc định đề xuất | Hệ quả nếu đổi |
| --- | --- | --- | --- |
| D1 | `ONNI_PROJECT_GRAPH` mặc định BẬT (ngoại lệ default-on theo `AGENTS.md`)? | Đề xuất bật (phân tích tĩnh cục bộ, chỉ đọc); **chưa duyệt → tắt**. Chỉ xét sau khi G-A không no-go | Mặc định tắt → khó khám phá, nhưng an toàn |
| D2 | **Ngưỡng go/no-go** của G-A/G-B/G-C (định vị tăng bao nhiêu; chi phí/pass không tụt; recall test tối thiểu; precision cảnh báo tối thiểu) | Đề xuất số cụ thể sau V1/R1 (có khoảng tin cậy); chủ dự án duyệt | Ngưỡng lỏng → rủi ro đầu tư vào thứ chưa chứng minh |
| D3 | Tập tác vụ A/B (~10 tác vụ OnniCode thật, trong đó ~5 manager–worker) và cánh `grep` đối chứng | Do V1 đề xuất, chủ dự án chọn | Tập khác → số đo khó so sánh |
| D4 | Engine: tree-sitter breadth mặc định + adapter TS tùy chọn; quét nền (watcher) | Tree-sitter; **không watcher** (lazy hash validation) | Watcher cần cờ `ONNI_*`, trần CPU/RAM |
| D5 | Co-change: soft edge ở lớp LX; có tham gia cảnh báo manager? | Có hiển thị; cảnh báo chỉ "thông tin" tới khi G-C đạt; **không chặn dispatch** | Chặn sớm → nguy cơ báo sai làm đứng cây |
| D6 | Gọi tool ngoài (Nx/Turbo/Rush/Bazel/Pants, runner `related`) | Opt-in `ONNI_PROJECT_GRAPH_TOOLS=1`; `vitest related` thử ở spike | Mặc định bật → subprocess ngoài không lường |
| D7 | Tiêm map nhỏ vào prompt agent (không chỉ lệnh CLI) | Không; chỉ sau G-A nếu nó cho thấy lợi ích | Pre-inject tốn token mỗi task |
| D8 | Nav: tên/vị trí; có làm điểm vào bản đồ toàn repo (W3)? | "Graph"/"Đồ thị dự án"; W3 chỉ khi §9.4 cho thấy dùng lặp | Làm sớm → phí công nếu không ai quay lại |

Các quyết định cũ **rút khỏi bản này** (chuyển §14): AI summary (D5 cũ), automations `owner` (D6 cũ), scope có cấu trúc
trong "giao task tại đây" (D7 cũ), thư viện render thứ hai (D9 cũ).

---

## 14. Ngoài phạm vi / sau khi có số đo

Các mục dưới đây từng nằm trong bản 2026-11-06 và **bị cắt** vì chưa có bằng chứng; mở lại chỉ khi có kết quả cổng và
quyết định riêng:

| Mục | Mở lại khi |
| --- | --- |
| Móc Automations (`owner` trên automation, "lên lịch trên node này", kind `graph`) | P2 chứng minh giá trị; cần quyết định riêng (đụng scheduler) |
| Tóm tắt AI (`ONNI_PROJECT_GRAPH_AI_SUMMARY`) | Eval Onni cho thấy graph+grep còn thiếu; bằng chứng summary vừa giúp vừa hại (`research-agent-evidence.md` §RepoGraph hops) |
| Time travel theo commit | Có nhu cầu từ §9.4 |
| Renderer thứ hai (Cytoscape/Sigma), benchmark S2, ELK | Đồ thị diff vượt khả năng xyflow trong dùng thật |
| Adapter symbol/call graph đầy đủ (ngoài export-level cho hub) | G-A cho thấy thiếu hụt mà outline + export-level không bù được |
| Topic WS `project-graph-activity` | Marker "git changed" chung (§5.2) chưa đủ |
| "Giao task tại đây" + scope có cấu trúc trong `NewTaskDraft` | P2 chứng minh scope giá trị |
| Quản lý ngữ cảnh tài liệu: trạng thái spec, kiểm đường dẫn trong docs, tách `AGENTS.md`, bộ nhớ dự án có phạm vi | Việc riêng ("ngữ cảnh dự án"), không chặn graph |
| MCP adapter, embeddings, ML dự đoán test kiểu Meta | Có dữ liệu và nhu cầu; Meta tự báo cáo trên dữ liệu nội bộ, không ngoại suy (`research-impact-ux.md` bài học 7) |
| Quick-win kiến trúc (cycle/orphan/unused kiểu dependency-cruiser/Knip) | Tách thành finding CI riêng nếu cần; `research-impact-ux.md` bài học 6 |

---

## 15. Xác minh kế hoạch và checklist

### 15.1 Xác minh

1. **Review độc lập bản 2026-11-06 (đã chạy):** 29 CONFIRMED, 13 WRONG, 3 UNVERIFIABLE; các sửa đổi bắt buộc đã áp dụng
   (review đã gỡ khỏi repo, còn trong lịch sử git: commit `b5f6172`). Bản viết lại này **chưa được review lần hai**; các khẳng định code trong §2.1 và
   §3–§7 được `grep` lại 2026-11-13, nhưng số quy mô (~797 file/~1.510 cạnh) giữ nguyên từ khảo sát cũ và cần script tái lập
   (thuộc S3).
2. **Cổng:** G0 sau Giai đoạn 0; G-A/G-B sau P1; G-C sau M1 (§9).
3. Sau mỗi giai đoạn: cập nhật checklist và `docs/design/manager-worker.md` nếu chạm manager–worker.

### 15.2 Checklist tổng

- [x] Khảo sát + nghiên cứu (server, web, engines, viz, agent-evidence, impact-ux) + kế hoạch + review bản trước
- [x] Viết lại kế hoạch neo vào hành động có số đo (tài liệu này)
- [ ] Giai đoạn 0: V1 prototype CLI · R1 replay · S1 engine · S3 bộ vàng · S4 git · S5 hub/co-change · N0 baseline — rồi cổng **G0**
- [ ] P1: C0 contract · E1 engine (hub, freshness, co-change) · T1 ứng viên test · N1 nối dây — chấp nhận §10
- [ ] **G-A** (A/B graph-off/on/grep) và **G-B** (replay precision/recall) có kết luận ghi lại — go/no-go P2
- [ ] P2: M1 overlap (cảnh báo) · M2 prompt + skill + context-from-graph · M3 gợi ý subset test trong `verify` — rồi **G-C**
- [ ] P3: W1 thẻ Impact · W2 đồ thị diff · W3 (có điều kiện) bản đồ toàn repo
- [ ] Mỗi bước: contract + parity + CLI + prompt (nếu có) + UI (nếu có) + test + `.env.example`/`docs/reference.md`
- [ ] Trước mỗi commit: `typecheck`, `test`, `test:unit`, `build`, `test:package`
- [ ] Mọi số đo sử dụng chỉ lưu cục bộ; không có đường gửi đi
