# Kế hoạch: Project Graph (đồ thị dự án)

Trạng thái: **kế hoạch, chưa triển khai** (2026-11-06). Chủ dự án đã quyết: đây là chức năng **thêm mới, tách
riêng**, không thay thế và không sửa Automations.

Tài liệu này tổng hợp bốn báo cáo khảo sát (đã merge trong cùng thư mục):

| Báo cáo | Nội dung | Người làm |
| --- | --- | --- |
| [`survey-server.md`](survey-server.md) | Engine, state, HTTP, WS, CLI, git, run, đo TypeScript 7, quy mô | codex |
| [`survey-web.md`](survey-web.md) | Route, nav, đồ thị hiện có, WS client, i18n, test, desktop | codex |
| [`research-engines.md`](research-engines.md) | 22 engine phân tích code, bản đồ repo cho agent, khai thác git | codex |
| [`research-viz.md`](research-viz.md) | 20 sản phẩm trực quan hóa, thư viện render, đề cương UX | codex |

Đọc kèm: [`AGENTS.md`](../../../AGENTS.md), [`docs/design/manager-worker-proposals.md`](../manager-worker-proposals.md),
[`.ai/specs/2026-07-23-websocket-subscriptions.md`](../../../.ai/specs/2026-07-23-websocket-subscriptions.md).

> **Cách đọc độ tin cậy.** Mọi khẳng định về code dẫn đường dẫn và symbol từ các khảo sát; một bản review độc
> lập đối chiếu kế hoạch với code sẽ chạy sau khi tài liệu này được commit (xem §14). Số liệu "mục tiêu"
> (ngân sách hiệu năng, ngưỡng render) là **giả thuyết cần kiểm bằng spike ở Giai đoạn 0**, không phải kết quả đo.
> Chỗ nào chưa kiểm được ghi "chưa kiểm".

---

## 0. Tóm tắt điều hành

**Là gì.** Biểu diễn repository thành đồ thị node–cạnh (module, file, test, tài liệu, chuỗi contract
schema→route→client→hook, đồng thay đổi theo git, run của agent) để (a) người dùng nhìn thấy liên kết trong dự
án trên cockpit, (b) agent truy vấn qua CLI `onni graph …` với ngân sách token, (c) manager–worker dùng để chia
phạm vi rời nhau, dự đoán xung đột và chọn test.

**Quyết định cốt lõi (đề xuất, xem §13 để chủ dự án xác nhận):**

1. **Xây bằng code, xác định, tăng dần.** Không cần agent để xây hay cập nhật cây. Agent chỉ là *người dùng*
   của đồ thị. Lớp tóm tắt bằng LLM là tùy chọn, tắt mặc định, đến sau (Giai đoạn 5).
2. **MVP là đồ thị cấp file/module**, không phải cấp symbol. Đủ để trả lời câu hỏi chính "đổi X thì cái gì bị
   ảnh hưởng?" và rẻ, ổn định. Symbol, call graph, đa ngôn ngữ là giai đoạn sau, có điều kiện.
3. **Engine phân tích chốt bằng spike, không chốt bằng tài liệu** (xem §3.1). Hai khảo sát cho kết luận chưa
   khớp về TypeScript 7; phải đo trên máy thật (Windows, Node 20+, tarball).
4. **Mỗi cạnh có nguồn gốc** `extracted | declared | inferred` cùng độ tin cậy; không bao giờ trộn.
5. **Cache là bản dựng lại được** dưới `.ai/onni/project-graph/`; mất thì tự dựng lại; không bao giờ là điều
   kiện để khởi động.
6. **UI mặc định ở mức gộp** (workspace/package/folder), mở dần theo yêu cầu; tái dùng `@xyflow/react` cho đồ
   thị nhỏ, đánh giá canvas/WebGL chỉ khi benchmark đòi hỏi.
7. **Local-first tuyệt đối.** Đồ thị chỉ lưu đường dẫn, tên export, hash, quan hệ; không lưu nội dung code,
   không upload.

**Lộ trình ngắn gọn.**

| Giai đoạn | Nội dung | Kết quả kiểm được |
| --- | --- | --- |
| 0 | Spike: engine phân tích, benchmark render, bộ vàng | Quyết định engine và renderer có số đo |
| 1 | MVP: engine cấp file + contract/route/CLI đọc + màn hình xem | `onni graph neighbors/impact/path` chạy; màn Graph xem được |
| 2 | Tín hiệu sống: git co-change, run-touched, overlay worktree, WS | Node sáng khi worker sửa; impact của diff |
| 3 | Agent và manager–worker dùng đồ thị | `graph context` trong order; chia vùng; chọn test |
| 4 | Automations gắn node, "giao task tại đây" có scope | Hành động trên node |
| 5 | Symbol, đa ngôn ngữ, tóm tắt AI (opt-in), time travel | Mở rộng theo nhu cầu thật |

---

## 1. Mục tiêu, không mục tiêu, nguyên tắc

### 1.1 Mục tiêu

- **Người dùng:** hiểu cấu trúc và liên kết dự án trong vài giây; thấy tác động của một thay đổi; thấy agent đang
  đụng vào đâu.
- **Agent:** truy vấn chính xác, có trần token, có dẫn chứng (đường đi và nguồn gốc cạnh), thay vì tự `grep` lại mỗi lần
  (hai file `run.ts` 10.144 dòng và `server.ts` 8.422 dòng khiến việc định vị rất tốn lượt).
- **Manager–worker:** phân vùng phạm vi rời nhau, cảnh báo trùng vùng trước khi giao, chọn đúng test cho `verify`
  (liên hệ [`manager-worker-proposals.md`](../manager-worker-proposals.md) A1/A2).

### 1.2 Không mục tiêu (giai đoạn này)

- Không thay hay sửa Automations; chỉ thêm liên kết tùy chọn ở Giai đoạn 4.
- Không xây call graph đầy đủ hay phân tích kiểu (type) ở MVP.
- Không dịch vụ lưu trữ ngoài, không upload mã, không MCP server riêng (CLI và HTTP là đủ).
- Không quét nền liên tục ở MVP (không watcher mặc định).
- Không thay thế `AGENTS.md` hay hệ thống tài liệu; đồ thị *bổ sung* ngữ cảnh dự án.

### 1.3 Nguyên tắc ràng buộc (từ `AGENTS.md`)

| Nguyên tắc | Hệ quả cho Project Graph |
| --- | --- |
| Zero config | Không file cấu hình bắt buộc; mọi khóa có mặc định; thiếu parser/git thì thu nhỏ, không hỏng boot |
| State được ghi, không bắt buộc | Cache dưới `.ai/onni/project-graph/`, thêm vào `DATA_GITIGNORE_ENTRIES` cùng commit, xóa đi tự dựng lại |
| Thứ làm tăng chi phí/phơi bày phải opt-in | Tóm tắt AI, watcher nền, MCP: tắt mặc định, có công tắc `ONNI_*` ghi trong `.env.example` |
| API chỉ `/api/v1`, mô tả bằng zod | Schema trong `packages/contract` (Node-free), route chuỗi vào family builder, validator là middleware |
| Suy biến là giá trị | Lỗi git/parser/cache trả `{ available:false, reason }`, không throw |
| Ghi nguyên tử | `writeAtomic` + `withPathLock` (`dispatch/state-file.ts`) |
| Một socket WS | Thêm topic, không `new WebSocket` |
| Test cạnh code, không `.skip` | Mỗi module có `*.test.ts`; test cần git/Windows dùng guard bên trong test |
| Không bump version tay, commit kiểu Conventional | `feat(graph): …`, `docs(graph): …` |

---

## 2. Phát hiện chính từ khảo sát

### 2.1 Từ code hiện tại

- **Quy mô vừa phải:** 797 file nguồn production (~199k dòng) + 837 file test trong bốn package; ước lượng sàn
  ~800 node và ~1.510 cạnh import tương đối ở cấp file (≈1.634 node nếu tính cả test). Cấp file là khả thi trong
  RAM và render; cấp symbol lớn hơn nhiều (`survey-server.md` §10).
- **Mẫu để sao chép đã có:** `automations/` (store + coordinator + scheduler), `dispatch/` (state-file, tree-fs),
  `worktree-lifecycle/` (store theo project); `requireRootManager`, git chỉ-đọc `worktreeChangedFilesReadOnly`,
  `git-changes.ts` (có `git log`, `diff-tree -M` nhận rename, `listRepoPaths` giới hạn 20.000 path/8 MiB).
- **Chưa có:** miner co-change, đồ thị theo commit, overlay worktree, mã hóa path→run (`RunRecord.diffStat` chỉ có
  số lượng, không có danh sách path).
- **TypeScript 7.0.2 (đã đo):** `require('typescript').createProgram` **không có**; có `typescript/unstable/sync`,
  `/async` (`Project`) và `/ast`. Ở `packages/work`, TypeScript chỉ là `devDependency`, không có trong tarball.
  Bất kỳ parser runtime nào cũng phải khai báo trong `packages/work/package.json` (`survey-server.md` §9).
- **Web:** đã có `@xyflow/react ^12.12.0` + `@dagrejs/dagre ^3.1.1`; ba đồ thị hiện có (workflow, task,
  activity) tái dùng được khung, panel, node memo hóa; **không** tái dùng được mô hình dữ liệu. Chưa có Sigma,
  Cytoscape, ELK. Route lazy sẵn. Chuỗi UI dùng khóa tiếng Anh + bản dịch `vi-*.ts` (`survey-web.md` §1–§6).
- **Tín hiệu live:** chưa có topic "worker đang sửa file nào"; chỉ có diff sau khi sinh ra (poll 4 giây
  `useRunChanges`). Cần tín hiệu mới (§6.4).
- **Chưa có trường scope dạng danh sách** trong `new-task-params.ts`/`NewTaskDraft` (`survey-web.md` §7).

### 2.2 Từ nghiên cứu bên ngoài

- Không có engine nào đáp ứng đồng thời: TS chính xác, đa ngôn ngữ, provenance, cập nhật tăng dần, UI nhúng,
  nhẹ. Cần tự dựng schema đồ thị; mượn *thành phần*, không mượn *sản phẩm* (`research-engines.md` Tóm tắt).
- **Aider repo-map** (PageRank + trần token) là mẫu tốt cho "ngữ cảnh gọn"; **Nx affected graph** là mẫu tốt
  cho "đồ thị trả lời *sửa gì?*"; **CodeScene** cảnh báo co-change là suy luận, không phải phụ thuộc.
- **scip-typescript** cần Node 22/24, trong khi `engines` của dự án là Node ≥20 → không dùng làm mặc định.
- **stack-graphs đã archived (2025-09-09)**, Sourcetrail archived (2021): chỉ tham khảo, không phụ thuộc.
- **Code Maat là GPL-3.0**, Joern cần JDK 21: không nhúng vào sản phẩm thương mại; tự cài đặt thuật toán
  co-change đơn giản (đếm cặp file cùng commit trong cửa sổ có trần).
- **Render:** React Flow không có trần cứng công bố; ngưỡng đề xuất ~1.500 node đang vẽ (cần benchmark);
  Cytoscape.js 1.500–10.000; Sigma.js (WebGL) cho >10.000 nếu cần. **Cosmograph/cosmos.gl: CC-BY-NC-4.0 →
  không dùng được cho sản phẩm thương mại.** ELK: EPL-2.0 OR GPL-3.0 và bundle ~427 kB gzip → chỉ khi thật cần
  compound layout.
- **UX:** mở ở mức gộp; "impact of this diff" là cửa vào chính; cạnh inferred không được giả làm phụ thuộc;
  luôn có chế độ bảng/cây tương đương cho trình đọc màn hình (`research-viz.md` §Đề cương UX, Anti-patterns).

### 2.3 Mâu thuẫn giữa các báo cáo, và cách xử lý

| Điểm | Báo cáo A | Báo cáo B | Xử lý |
| --- | --- | --- | --- |
| Engine TS | `research-engines`: dùng TS Compiler API (+ ts-morph) qua adapter phiên bản | `survey-server`: TS 7.0.2 không có `createProgram`; `unstable` API; ts-morph × TS7 **chưa kiểm** | Spike S1 (§3.1) quyết định; **không** khóa TS API trong kế hoạch |
| `es-module-lexer` | `survey-server`: "hỗ trợ JS/TS module syntax" | Chưa kiểm bằng chạy thật: lexer này phân tích JS, file `.ts/.tsx` thường cần bước loại kiểu trước | Spike S1 phải thử trên chính `.ts/.tsx` của repo |
| Ngưỡng render | `survey-web`: không có hard cap | `research-viz`: ngưỡng thử ~1.500/10.000 | Dùng làm giả thuyết; Spike S2 đo trên máy Windows + WebView Tauri |

---

## 3. Kiến trúc engine

### 3.1 Chọn engine phân tích (Spike S1, bắt buộc trước khi viết engine)

**Mục tiêu spike:** chọn bộ trích import/export cho `.ts/.tsx/.js/.mjs/.json` (và `package.json` exports/workspaces)
đáp ứng đủ điều kiện sau; kết quả ghi vào `docs/design/project-graph/spikes/engine.md`.

Ứng viên (đều phải thử trên chính repo này):

| Ứng viên | Ghi chú đã biết | Cần kiểm |
| --- | --- | --- |
| `oxc-parser` (hoặc `oxc` resolver) | Parser Rust, MIT, nhanh; có binding npm | Binary native có sẵn cho Windows/Linux/macOS? Có fallback WASM? Kích thước gói? |
| `es-module-lexer` (+ bước loại kiểu bằng `esbuild`, đã là devDependency của `packages/work`) | Nhẹ, MIT; chỉ cho cạnh import/export | Có thể dùng với TS/TSX sau transform? Chi phí transform? Dynamic import? |
| TS 7 `typescript/unstable/*` (`Project`) | Có trong 7.0.2, nhãn *unstable*; README cảnh báo API 7.1 khác | Có chạy trong Node 20? Native optional packages trong tarball? Độ ổn định giữa 7.0 và 7.1 |
| `tree-sitter` (WASM) + grammar TS/TSX | MIT, đa ngôn ngữ, chịu lỗi cú pháp | Kích thước grammar; Windows; tốc độ khởi động; bundling |
| (đối chứng) tự viết bằng regex | Rẻ nhất | Chỉ để đo độ lệch so với "sự thật" |

**Điều kiện chấp nhận (mỗi ứng viên được chấm):**

1. Chạy trên Windows 11 + Node 20 và 22; trong tarball của `@onni/work` (`npm pack` + cài thử) mà không cần
   toolchain biên dịch.
2. Khớp ≥ **99%** với *bộ vàng* (xem S3) về cạnh import tương đối, `export … from`, `import type`, `import()`
   với chuỗi hằng, `package.json` workspaces, ánh xạ đuôi `.js→.ts` như repo đang dùng.
3. Tốc độ: dựng nguội toàn repo (~1.634 file code) **mục tiêu ≤ 10 giây**; tăng dần 1 file **mục tiêu ≤ 300 ms**
   (giả thuyết; spike ghi số đo thật).
4. Bộ nhớ đỉnh **mục tiêu ≤ 200 MB**; không giữ AST của cả repo.
5. Giấy phép tương thích thương mại (MIT/Apache-2.0/ISC); tránh GPL/EPL/CC-NC.
6. Dependency khai báo trong `packages/work/package.json` (quy tắc workspace), không đụng `contract`/`api-client`.
7. Nâng cấp phiên bản không phá: có kiểm tra phiên bản trong test.

**Kết quả mong đợi:** một `GraphExtractor` (interface) cho cấp file; adapter symbol đến sau (Giai đoạn 5), tuỳ
kết quả spike.

### 3.2 Mô hình dữ liệu

**Node**

| Kind | ID | Nguồn | Ghi chú |
| --- | --- | --- | --- |
| `package` | `pkg:<name>` | `package.json` workspaces | 5 package của repo |
| `dir` | `dir:<repo-rel path>` | cây thư mục | Dùng để gộp khi thu nhỏ |
| `file` | `file:<repo-rel posix path>` | `git ls-files` + untracked không ignore | Thuộc tính: ngôn ngữ, kích thước, hash nội dung, `isTest`, `isGenerated` |
| `test` | như `file` + cờ | quy ước `*.test.*`, `test/`, `e2e/` | Cạnh `tested-by` |
| `doc` | `file:` + cờ | `*.md`, `docs/`, `.ai/specs` | Có trạng thái spec (xem §10) |
| `ext` | `ext:<pkg>` | import không tương đối | Phụ thuộc ngoài, gộp theo tên gói |
| `run` | `run:<id>` | run store | Lớp sống, chỉ khi bật (§6.3) |
| `symbol` | `sym:<file>#<name>` | adapter symbol | Giai đoạn 5, có điều kiện |

**Cạnh**

| Kind | Hướng | Nguồn | Mặc định hiển thị |
| --- | --- | --- | --- |
| `imports` | file → file/ext | `extracted` | bật |
| `reexports` | file → file | `extracted` | bật |
| `tested-by` | file → test | `declared` (quy ước tên/vị trí) hoặc `extracted` (test import file) | bật |
| `documents` | doc → file/dir | `extracted` (đường dẫn nhắc trong markdown, link) / `inferred` (tên symbol) | bật |
| `contract-flow` | schema → route → client → hook | `declared` bởi bộ nhận diện quy ước dự án (§3.4) | bật |
| `co-change` | file ↔ file | `inferred` (git, có `count`, `window`, `lastCommit`) | tắt mặc định |
| `run-touched` | run → file | `extracted` từ ảnh chụp thay đổi lúc settle | tắt mặc định |
| `owns` / `declared-by` | node → node | `declared` (chú thích người viết) | bật, Giai đoạn 5 |

**Thuộc tính chung của cạnh:** `kind`, `from`, `to`, `provenance`, `confidence` (0–1, chỉ bắt buộc với
`inferred`), `extractor` + `extractorVersion`, `evidence` (path:dòng nếu có), `observedAt`/`commit`. Cạnh dynamic
import không giải được là `unresolved` (không bịa đích).

**ID ổn định qua đổi tên.** ID là đường dẫn tương đối chuẩn hoá POSIX, chữ thường *không* ép (giữ nguyên chữ
hoa); khi git `-M` phát hiện rename, lưu bảng `aliases` (cũ → mới) trong snapshot để link sâu và dữ liệu run cũ vẫn
trỏ đúng. Không dùng đường dẫn tuyệt đối trong bất kỳ ID hay cache key nào.

**Phiên bản schema:** `GRAPH_SCHEMA_VERSION` (số nguyên); khác phiên bản → bỏ cache cũ, dựng lại (không cố đọc).

### 3.3 Pipeline, cache và cập nhật tăng dần

```
liệt kê file (git ls-files, ignore, denylist)
      │
      ▼
băm nội dung ──► (cache theo hash: kết quả trích từng file) ──► ghép đồ thị
                                                                   │
                                          hậu xử lý: tested-by, documents, contract-flow, gộp dir/pkg
                                                                   │
                                           ghi snapshot nguyên tử + manifest
```

- **Vị trí:** `packages/work/src/project-graph/` (mới), tách khỏi HTTP/CLI; `server/project-graph.ts` chỉ nối dây
  để không phình `server.ts`.
- **Cache:** `.ai/onni/project-graph/` gồm `manifest.json` (schema, extractor+version, tsconfig/workspace hash,
  `head`, số node/cạnh), `files/<hash>.json` (kết quả trích bất biến theo nội dung), `snapshot-<head>.ndjson`
  (hoặc một shard/`nodes.ndjson`+`edges.ndjson`). Ghi qua `writeAtomic`; con trỏ manifest đổi sau cùng dưới khóa
  liên tiến trình (mẫu `proper-lockfile` của Automations) vì `withPathLock` chỉ khóa trong một process.
- **Tăng dần:** so hash nội dung (không dùng mtime một mình); file đổi → trích lại, thay node/cạnh sinh ra từ file
  đó, **tính lại cạnh vào** (inbound) bị ảnh hưởng; rename/xóa dọn cạnh cũ; snapshot chỉ công bố khi lô thành
  công; lỗi → giữ snapshot cũ + đánh dấu `stale`.
- **Khi nào chạy:** theo yêu cầu (UI mở màn Graph, CLI, agent hỏi) và lúc kết thúc run; không quét nền vô hạn
  ở MVP. Mọi lệnh có `AbortSignal`, trần thời gian, trần byte/file, trần node/cạnh, nhường event loop theo lô.
- **Luôn có đường dựng lại toàn bộ.**

### 3.4 Nhận diện chuỗi contract (đặc thù dự án này)

`contract-flow` là điểm khác biệt, và là thứ phân tích import thuần không tạo ra trọn vẹn. Bộ nhận diện theo
quy ước (mỗi quy ước một hàm có test, `provenance: declared`):

1. `packages/contract/src/<family>.ts` ← route family trong `server/server.ts` và `server/*.ts` (file import schema
   hoặc validator của family đó).
2. `AppType` (`server/app-type.ts`) → `packages/api-client` → `packages/web/src/api/client.ts` / `queries.ts`.
3. Hook/route cockpit import `queries.ts` hoặc `client.ts` → `packages/web/src/routes/**`.
4. Test parity (`contract-parity*.test.ts`, `route-parity.test.ts`) → `tested-by` cho family.

Ở cấp file, đây phần lớn là *tập con có nhãn* của đồ thị import (lọc theo thư mục + quy ước); cấp symbol
(schema nào ↔ route nào) chờ Giai đoạn 5. Nếu quy ước không khớp (repo khác), bộ nhận diện trả rỗng, không đoán.

### 3.5 Tín hiệu từ git

- **Co-change** (Giai đoạn 2): đọc `git log --name-status -M --no-merges` có giới hạn commit (mặc định N gần
  nhất, cấu hình hằng số), loại commit lớn (refactor/format: vượt ngưỡng số file/commit), đếm cặp file cùng
  commit; lưu `count`, `window`, `lastCommit`; luôn `inferred`. Tính tăng dần đến `lastIndexedCommit`, không quét
  toàn lịch sử mỗi yêu cầu. Cài đặt thuật toán đơn giản, **không** nhúng Code Maat (GPL).
- **Neo diff:** dùng `resolveTaskDiffBase` (`git-diff-base.ts`) — không tự tính lại.
- **Git chỉ đọc:** `worktreeChangedFilesReadOnly` và `gitReadOnly` (có timeout/`AbortSignal`); **không** dùng
  `worktreeChangedFiles` (nó chạy `git add -N`, ghi index).

### 3.6 Overlay theo worktree (mỗi task có worktree riêng)

Đồ thị nền (base) bất biến theo commit. Một task xem **overlay** ngắn hạn: các file đổi (từ helper chỉ-đọc) thay
thế/bổ sung node-cạnh tương ứng; overlay bị hủy khi worktree biến mất hoặc HEAD đổi; không sửa đồ thị nền để
phản ánh file bẩn. Chuẩn hoá đường dẫn giữa gốc repo và đường dẫn worktree là bắt buộc (§7.5 `survey-web.md`).

### 3.7 Cạnh `run-touched`

Lấy từ ảnh chụp thay đổi lúc worker settle (đã có `changedFiles`/`filesOmitted` trong báo cáo, `run.ts`
`childSettleReport`/`recordTurnEnd`), **không** suy từ transcript thô. Lưu `runId`, path tương đối, HEAD/base,
thời điểm; lọc path nhạy cảm; trần số path; theo retention của run store. `run → symbol` chỉ là suy luận từ diff.

### 3.8 An toàn, quyền riêng tư, hiệu năng

- **Denylist bí mật:** `.env`, `.env.*` (trừ `.env.example`), khóa/chứng chỉ (`*.pem`, `*.key`, `id_rsa*`,
  `*.p12`), `.npmrc` có token, `.git/`, thư mục `node_modules`, `dist/`, `web/dist`, sản phẩm sinh ra. File thuộc
  denylist **không bao giờ được đọc nội dung**; tôn trọng `.gitignore` *và* denylist (file đã track vẫn bị
  denylist chặn). Đồ thị lưu tên/đường dẫn/hash, không lưu mã.
- **Giới hạn:** trần byte mỗi file (mặc định 512 KiB, như `FILE_CONTENT_CAP`), trần tổng, trần node/cạnh, trần thời
  gian, đồng thời tối đa M tác vụ; không giữ cả AST repo trong RAM; symlink/junction không đi ra ngoài gốc repo.
- **Windows:** chuẩn hoá bằng `node:path` rồi tuần tự hoá POSIX; không nối đường dẫn POSIX thủ công; xử lý khác
  biệt hoa/thường, CRLF, `EPERM` khi đổi tên (`fs-rename.ts`); không yêu cầu symlink.
- **WS:** `loopbackReadable` giữ mặc định `false` (nội dung path/symbol không công khai cho mọi origin cục bộ).

---

## 4. API, WebSocket, CLI, công tắc

### 4.1 Contract và route

`packages/contract/src/project-graph.ts` (Node-free; export qua `index.ts`):

| Route (family `projectGraphRoutes`, chuỗi vào `v1`) | Mô tả | Quyền |
| --- | --- | --- |
| `GET /graph` | Trạng thái (`status`: `ready/building/stale/unavailable`, `head`, đếm node/cạnh, thời điểm, lý do) | project |
| `GET /graph/overview` | Cấp gộp (package/dir) với cạnh tổng hợp có `count` | project |
| `GET /graph/neighbors` | `node`, `depth`, `kinds`, `minProvenance`, `limit` | project |
| `GET /graph/impact` | `files[]` hoặc `runId`/`diff`; kết quả xếp hạng + lý do cạnh | project |
| `GET /graph/path` | `from`, `to`, `kinds` | project |
| `GET /graph/context` | `scope[]`, `maxTokens` → gói gọn (dùng cho agent) | project |
| `GET /graph/search` | tìm node theo tên/đường dẫn | project |
| `POST /graph/rebuild` | dựng lại (có trần tần suất) | project |

Mọi phản hồi có trần (số node/cạnh/byte) và cờ `truncated`. Đi qua validator làm middleware; parity hai chiều
(`contract-parity.projectGraph.test.ts`), `route-parity`, `versioned-surface`, `typed-bodies`. Đồ thị đọc theo
snapshot hiện tại, không bao giờ tạo trong handler đọc nếu không có (trả `building`).

### 4.2 WebSocket

Topic `project-graph` theo project: `snapshot` = `{status, revision}`; publisher bắt đầu ở 0→1 subscriber, lắng
nghe notifier của coordinator (không tự re-index định kỳ), dừng ở 1→0. Payload chỉ phiên bản/vô hiệu hoá + id
node bị tác động (nhỏ); dữ liệu đồ thị lấy qua HTTP. Topic thứ hai, `project-graph-activity` (Giai đoạn 2), phát
`{runId, paths[], state}` cho "worker đang sửa node này", chỉ id/path/trạng thái, không nội dung file.

### 4.3 CLI (`node "$ONNI_BIN" graph …`)

```
onni graph status
onni graph build [--full]
onni graph neighbors <node> [--depth 2] [--kind imports,tested-by] [--min-provenance extracted]
onni graph impact <file…> | --run <id> [--limit N]
onni graph path <from> <to>
onni graph context --scope <path…> [--max-tokens 3000] [--format text|json]
onni graph search <text>
```

Bộ phân tích `project-graph/graph-cli.ts`, nhánh trong `index.ts`; đầu ra `json` ổn định cho máy, `text` gọn cho
prompt. Mọi lệnh chỉ-đọc ngoại trừ `build`. Agent không nhận truy vấn tự do (không Cypher) — chỉ các động từ trên.

### 4.4 Công tắc và cờ

- `ONNI_PROJECT_GRAPH=0` tắt hoàn toàn (nav ẩn, route 409, coordinator không khởi động) — *đề xuất mặc định BẬT*
  vì phân tích tĩnh cục bộ rẻ và chỉ-đọc; **cần chủ dự án duyệt như một ngoại lệ default-on** theo `AGENTS.md`
  (§13 D1). Thêm vào `.env.example` và `docs/reference.md` cùng commit.
- Tóm tắt AI: Settings → bật theo project, **tắt mặc định**, enforce phía engine (không chỉ ẩn UI), nhãn "AI viết".
- Capability: thêm `projectGraph` vào `server/capabilities.ts` (`resolveCapabilities`), mẫu như `automations`.

---

## 5. Tích hợp agent

Nguyên tắc: **không nhét đồ thị vào prompt**; agent truy vấn khi cần. Điểm tiêm (đã khảo sát):

| Điểm | Việc cần làm | Giới hạn |
| --- | --- | --- |
| `dispatch/commands.ts` (bảng lệnh) | Bảng/help riêng cho `onni graph` (không giả làm `task`); helper block cho manager và worker | Qua `prompt-budget.ts`: thêm hằng `GRAPH_COMMANDS_MAX_CHARS`, cập nhật `PROMPT_MAX_CHARS`, test trường hợp xấu nhất |
| `workflows/manager-worker.ts` (`managerPrompt`, `workerPrompt`) | 1–3 dòng: khi nào dùng `impact`/`context`/`neighbors` | Trần block |
| `workflows/run.ts` (`composeSystemPrompt`, `composeDispatchPrompt`, đường start + continuation) | Cùng một nguồn hướng dẫn cho run mới và run tiếp nối | Test hai đường |
| Skill dựng sẵn (mẫu `automations/builtin-skill.ts`, `skills-provision.ts`) | Skill `project-graph` ngắn, chỉ hiện khi capability bật | |
| `onni task create` | Tuỳ chọn `--context-from-graph` tự dựng gói `graph context` cho order (ghép vào mục tiêu, tôn trọng trần 4.000 ký tự của order — **hiện order bị giới hạn 4.000 ký tự**, nên gói phải ghi vào file trong thư mục cây, order chỉ trỏ tới) | Trần token |
| Khi `ONNI_BIN` không có | Hướng dẫn nói rõ đồ thị không khả dụng | |

**Gói ngữ cảnh (`graph context`)**: node trong scope + láng giềng 1 bước theo loại cạnh ưu tiên (imports, tested-by,
documents, contract-flow) + test liên quan + tài liệu liên quan; xếp hạng theo độ trung tâm (có thể dùng PageRank
nhẹ, tham khảo Aider) và nguồn gốc cạnh; đầu ra dạng outline có đường dẫn và lý do; cắt cứng theo `maxTokens`
(ước lượng bằng bộ tuần tự hoá thực, không đoán). Điều này đồng thời thực hiện đề xuất "gói ngữ cảnh cho order"
đã nêu trước đó.

---

## 6. Cockpit (web)

### 6.1 Chỗ đặt và quy ước

- Route project-scoped `/p/:projectId/graph` (lazy qua `lazyRoute`, có `GraphLoading`, `pageLabel`), mục nav mới
  trong `nav-items.ts` (lọc theo capability `projectGraph`), tự có trong command palette (nhóm Views). Nhãn UI:
  "Graph" (khóa tiếng Anh) / "Đồ thị dự án" (`vi-graph.ts` mới). Không chạm `routes/automations/`.
- Dữ liệu qua hook TanStack Query trong `api/queries.ts`; query key gồm `projectId`, `head/revision` và tham số
  truy vấn; phân biệt loading / chưa dựng (empty) / stale / lỗi / bị cắt (`truncated`).
- Tuân theo `design-guardian.test.ts` (token màu, không `dark:`, `100dvh`, không `confirm()` gốc), WCAG AA,
  `focus-visible`, `prefers-reduced-motion`.

### 6.2 Màn hình và tương tác

| Thành phần | Hành vi |
| --- | --- |
| Mặc định | Mức package/dir đã gộp, chú giải, trạng thái index + thời điểm; không bung mọi cấp |
| Thu phóng ngữ nghĩa | Z1 package + phụ thuộc trực tiếp; Z2 dir/file + imports/test; Z3 (sau) symbol + contract |
| Hàng xóm cục bộ | 1 bước mặc định, mở thêm theo yêu cầu; tìm kiếm → focus node |
| Bộ lọc | Theo loại node (package/dir/file/test/doc/ext/run), theo đường dẫn/ngôn ngữ; công tắc riêng từng loại cạnh với hướng + nhãn provenance (nét liền/đứt) |
| Overlay | Churn (kỳ chọn), co-change, task/worker đang hoạt động; ghi đơn vị/kỳ/nguồn; **dữ liệu thiếu không tô như 0** |
| Panel node (tái dùng khung `FloatingPanel`) | Tên/đường dẫn/loại, láng giềng vào/ra có lý do + provenance, test gần nhất, tài liệu, run gần đây |
| "Impact của diff" | Chọn run/diff → node đổi làm hạt giống; tô downstream + test ứng viên + độ tin cậy; click để thấy đường đi |
| "Giao task tại đây" | Mở `/new` với scope điền sẵn (§6.5) |
| "Worker đang sửa node này" | Node sáng qua WS topic hoạt động, tắt khi task kết thúc |
| Bảng/cây tương đương | Luôn có (cho trình đọc màn hình, và khi canvas không khả dụng) |
| Bàn phím | Tab vào đồ thị, mũi tên qua láng giềng, Enter chọn, Esc bỏ chọn, trợ giúp phím tắt |

### 6.3 Renderer

- **Mặc định:** `@xyflow/react` + layout phân cấp ổn định (Dagre đã có; tính ở server/worker cho vùng lớn, cache
  toạ độ). Không force-layout toàn repo mỗi lần pan.
- **Phía server gộp:** workspace → package → dir → file; cạnh tổng hợp mang `count` và nút "bung" ra đường dẫn thật;
  trình duyệt không bao giờ nhận cả đồ thị cấp symbol.
- **Ngưỡng chuyển (giả thuyết, Spike S2 đo):** ≤ ~1.500 node đang vẽ: React Flow; 1.500–10.000: Cytoscape.js
  (canvas, LOD); > ~10.000 hoặc không đạt 30 FPS: Sigma.js (WebGL). Thêm thư viện mới chỉ khi benchmark cho thấy cần;
  mô hình dữ liệu độc lập renderer để đổi được. Tránh Cosmograph (CC-BY-NC) và ELK (bundle/giấy phép) trừ khi có lý do.
- **Desktop (Tauri):** cùng bundle web; WebGL/WASM cần QA riêng trên WebView Windows đóng gói.

### 6.4 Sống (live)

- Hook `useGraphStatus` đăng ký topic `project-graph` (`subscribeTopic`, trả hàm huỷ trong `useEffect`); khi
  `revision` đổi → invalidate query. Topic hoạt động cho overlay worker. Không SSE/WS riêng cho tính năng.
- Trước khi có tín hiệu hoạt động thật, overlay dùng `useRunChanges` (poll 4 giây) cho "đã đổi"; "đang sửa ngay
  lúc này" cần tín hiệu mới từ runner (Giai đoạn 2).

### 6.5 Tích hợp "Giao task tại đây"

Hiện `new-task-params.ts` chỉ có `{skill, ref, todo}` và `NewTaskDraft` không có scope. Cần: (a) trường
`scope: string[]` trong draft (localStorage theo project) và một cách truyền ngắn trên URL (id đồ thị/ngưỡng độ dài;
danh sách dài đi qua draft, không qua URL); (b) quyết định *scope là ngữ cảnh gợi ý trong prompt* (MVP) hay *giới
hạn có cấu trúc do server thực thi* (sau, gắn với `--scope` của manager–worker). Đề xuất MVP: gợi ý trong prompt +
gói `graph context` đính kèm.

### 6.6 Cài đặt và dashboard

- Công tắc project: Settings → Project (mục riêng nếu nhiều điều khiển): bật/tắt đồ thị, "dựng lại", (sau) "Tóm tắt AI".
- Dashboard: thẻ nhẹ (số node, trạng thái index, số node đổi) → deep link; không nhúng đồ thị tương tác vào dashboard.

---

## 7. Quan hệ với Automations và manager–worker

### 7.1 Automations (giữ nguyên)

Hiện Automations là hệ con độc lập (~4.700 dòng server, ~3.300 dòng web runtime, nối vào >30 file) với
`kind: github | schedule | tracker`. Giữ nguyên. Về sau (Giai đoạn 4), "hành động trên node" là *lớp cộng thêm*:

1. Thêm `owner?: { kind: 'graph-node', nodeId }` tuỳ chọn trên định nghĩa automation (tương thích ngược,
   `RunRecord`/definition cũ vẫn parse). UI "Lên lịch trên node này" tạo automation `schedule` thường + gắn owner.
2. Chỉ khi cần "chạy khi node đổi" mới thêm kind mới `graph` + `graphTrigger` với nhánh scheduler rõ ràng; không đổi
   nghĩa trigger GitHub/tracker.
3. Kiểm tra `nodeId` tồn tại; đồ thị không khả dụng → trigger không chạy (không đoán).

Cần quyết định riêng của chủ dự án trước khi làm (D6).

### 7.2 Manager–worker

| Khả năng | Cách dùng đồ thị | Phụ thuộc |
| --- | --- | --- |
| Chia vùng rời nhau | Từ scope của các phần việc, tính vùng đóng (file + phụ thuộc trực tiếp); cảnh báo trùng vùng khi lập kế hoạch | `impact`, `neighbors` |
| Dự đoán xung đột | Giao nhau giữa vùng ảnh hưởng của hai worker ⇒ cảnh báo trước khi giao (bổ sung cho A2 trong `manager-worker-proposals.md`) | Giai đoạn 3 |
| Chọn test cho `verify` | `impact` → tập test ứng viên (`tested-by`) ⇒ chạy tập con trước, toàn bộ sau | A1 |
| Review worker | Phạm vi review = vùng ảnh hưởng của diff | |
| Brief của manager | 1–2 dòng hướng dẫn + bảng lệnh (trần prompt) | `prompt-budget.ts` |

Lưu ý: các tính năng ở bảng này phụ thuộc đề xuất A1/A2 trong tài liệu manager–worker, chưa được xây.

---

## 8. Lộ trình chi tiết và phân công worker

Quy ước: mỗi bước = một PR nhỏ qua đủ cổng (`typecheck`, `test`, `test:unit`, `build`, `test:package`; trên Windows
native CI là chuẩn). **Phạm vi file rời nhau cho các worker chạy song song**; các file nóng chung (`server.ts`,
`index.ts`, `run.ts`, `routes.tsx`, `nav-items.ts`, `contract/src/index.ts`, `data-gitignore.ts`) chỉ một worker
chạm trong một thời điểm. Backend: `codex` cho mọi việc cần chạy lệnh (test, build, git, web); `antigravity` chỉ cho
khám phá đọc file (ở mức quyền mặc định không chạy được lệnh — đã ghi vào bộ nhớ dự án).

### Giai đoạn 0 — Spike và nền chứng cứ (không đổi code sản phẩm)

| ID | Việc | Đầu ra | Điều kiện xong | Worker |
| --- | --- | --- | --- | --- |
| S1 | Spike engine phân tích (§3.1) | `docs/design/project-graph/spikes/engine.md` + script ngoài cây `src/` | Bảng chấm 5 ứng viên theo 7 điều kiện, có số đo Windows; khuyến nghị 1 lựa chọn + phương án dự phòng | codex |
| S2 | Benchmark render | `…/spikes/render.md` + trang Vite tạm (ngoài `src/`, xoá sau) | FPS/bộ nhớ/first paint ở 500/1.500/5.000/10.000 node cho React Flow, Cytoscape, Sigma; chạy trên Chrome + WebView Tauri nếu có | codex |
| S3 | Bộ vàng (golden) | `…/spikes/golden-graph.md` + fixture JSON nhỏ | Danh sách cạnh import "đúng" cho một tập con đại diện (kể cả `.js→.ts`, `export … from`, `import type`, dynamic import, workspace); cách sinh/kiểm lại | codex |
| S4 | Đo hiệu năng git | `…/spikes/git.md` | Thời gian `git ls-files`, `git log --name-status -M` N commit trên repo này (Windows) | codex |

S1–S4 độc lập (mỗi worker một file báo cáo + thư mục tạm riêng). **Cổng quyết định G0:** chủ dự án xác nhận engine
và ngưỡng renderer trước Giai đoạn 1.

### Giai đoạn 1 — MVP cấp file

| ID | Việc | Phạm vi file (độc quyền) | Phụ thuộc | Worker |
| --- | --- | --- | --- | --- |
| C0 | Contract Zod (§4.1) + fixture mẫu + tài liệu | `packages/contract/src/project-graph.ts`, `contract/src/index.ts` | G0 | codex |
| E1 | Engine lõi: `GraphExtractor`, liệt kê file + denylist, băm, cache, ghép đồ thị, tested-by, documents, dir/pkg, contract-flow; test + bộ vàng | `packages/work/src/project-graph/**` (mới), dependency mới trong `packages/work/package.json` | C0, S1, S3 | codex |
| W1 | Màn hình Graph: route, nav, hook, khung xyflow, panel, bộ lọc, bảng tương đương, i18n; chạy trên fixture C0 | `packages/web/src/routes/graph/**`, `lib/graph*`, `lib/i18n/vi-graph.ts`, + chạm tối thiểu `routes.tsx`, `nav-items.ts`, `api/queries.ts` | C0 | codex |
| N1 | Nối dây server: coordinator, route family, validator, CLI `onni graph`, capability, `data-gitignore`, `.env.example`, `docs/reference.md`, test parity | `server/project-graph.ts`, `server/server.ts`, `index.ts`, `project-graph/graph-cli.ts`, `data-gitignore.ts`, `capabilities.ts` | E1 | codex |

Thứ tự: C0 → (E1 ∥ W1) → N1. E1 và W1 có phạm vi file rời nhau (W1 chạm tối thiểu `routes.tsx`/`nav-items.ts`/
`queries.ts` — không worker nào khác chạm trong thời gian đó). N1 chạm các file nóng nên chạy một mình.

**Tiêu chí chấp nhận Giai đoạn 1:**

- `onni graph build` trên repo này xong trong ngân sách S1; `neighbors/impact/path/search` trả đúng trên bộ vàng.
- Xoá `.ai/onni/project-graph/` rồi chạy lại: tự dựng, không lỗi; cache hỏng → dựng lại, không crash.
- File `.env`/khoá không bao giờ được đọc (test).
- Màn Graph mở ở mức gộp ≤ 1 giây (mục tiêu), pan/zoom mượt ở ≤ 1.500 node (mục tiêu), có bảng tương đương, điều hướng
  bằng bàn phím; tất cả trạng thái loading/empty/stale/error/truncated.
- `contract-parity`, `route-parity`, `versioned-surface`, `typed-bodies`, `design-guardian` xanh.
- Tắt `ONNI_PROJECT_GRAPH=0`: nav ẩn, route 409, không process nền.

### Giai đoạn 2 — Tín hiệu sống và tác động

| ID | Việc | Worker |
| --- | --- | --- |
| G1 | Co-change miner (tăng dần, trần, loại commit lớn) + cạnh `co-change` + overlay churn | codex |
| G2 | Cạnh `run-touched` từ ảnh chụp lúc settle (chạm `run.ts`, một worker) + retention | codex |
| G3 | Overlay worktree + "impact của diff" (HTTP + UI) | codex |
| G4 | Topic WS `project-graph` + `project-graph-activity`; tín hiệu "đang sửa" từ runner; UI sáng node | codex |

G1 độc lập với G2/G3/G4 (G1 chỉ chạm `project-graph/`); G2 và G4 chạm `run.ts` ⇒ tuần tự.

### Giai đoạn 3 — Agent và manager–worker

| ID | Việc | Worker |
| --- | --- | --- |
| A1 | Tiêm hướng dẫn vào prompt (`commands.ts`, `prompts.ts`, `manager-worker.ts`, `run.ts` 2 đường), skill dựng sẵn, trần prompt | codex |
| A2 | `graph context` ghi vào thư mục cây; `task create --context-from-graph` | codex |
| A3 | Vùng rời nhau + cảnh báo trùng trước khi giao; chọn test cho `verify` (khi A1/A2 của manager–worker có) | codex |

### Giai đoạn 4 — Hành động trên node

| ID | Việc |
| --- | --- |
| H1 | Trường `scope` có cấu trúc trong `NewTaskDraft` + "Giao task tại đây" |
| H2 | `owner` tuỳ chọn trên automation + "Lên lịch trên node này" (cần duyệt D6) |

### Giai đoạn 5 — Mở rộng có điều kiện

Chỉ làm khi số đo/phản hồi cho thấy cần: adapter symbol (theo kết quả S1), `tree-sitter` đa ngôn ngữ, tóm tắt AI
(opt-in, cache theo hash nội dung, nhãn "AI viết"), time travel theo commit, chú thích `declared`, renderer
Cytoscape/Sigma, ngăn xếp tài liệu có trạng thái spec (§10).

### Ước lượng thô (độ lớn, không phải cam kết)

| Giai đoạn | Độ lớn | Rủi ro chính |
| --- | --- | --- |
| 0 | S | Kết luận engine ngược kỳ vọng |
| 1 | L | Cache tăng dần đúng; nối dây file nóng |
| 2 | M | Tín hiệu "đang sửa" cần chạm runner |
| 3 | M | Trần prompt; tính nhất quán 2 đường start/continuation |
| 4 | S–M | Chưa có scope có cấu trúc |
| 5 | L+ | Phạm vi phình |

---

## 9. Kiểm thử và chất lượng

- **Đơn vị:** extractor trên fixture nhỏ (mỗi quy ước một test); cache (thiếu/hỏng/sai phiên bản → dựng lại);
  tăng dần (đổi 1 file, đổi tên, xoá); truy vấn (giới hạn depth/limit/token, `truncated`); denylist; chuẩn hoá path
  Windows (guard *bên trong* test, không `.skip`).
- **Git thật:** repo tạm cho rename `-M`, co-change, overlay, huỷ giữa chừng (guard khả năng git).
- **Bộ vàng của chính repo này:** danh sách cạnh kiểm tay cho tập con; chạy lại mỗi lần đổi extractor; đo độ khớp.
- **Contract:** `contract-parity.projectGraph`, `route-parity`, `versioned-surface`, `typed-bodies`.
- **Web:** Vitest + Testing Library (builder mô hình, lọc, gộp, panel, trạng thái, bàn phím, theme/token); test thuần
  cho bộ gộp/chọn renderer; e2e `packages/web/e2e` + `.ai/scripts/e2e.sh` (deep link project, chọn node → panel,
  "giao task tại đây", overlay); lưu ý `TEST_E2E_STATUS=skipped` **không phải** pass.
- **Hiệu năng (mục tiêu, kiểm bằng benchmark có số đo, không đặt thành cổng CI nếu chưa ổn định):** dựng nguội ≤ 10 s,
  tăng dần ≤ 300 ms, truy vấn ≤ 100 ms, RAM ≤ 200 MB, màn Graph mức gộp ≤ 1 s.
- **Gói:** `npm run test:package` phải chứng minh parser runtime có trong tarball cài thử; `check-pack` không đủ
  (nó không kiểm dependency parser).
- **Ghi vết:** mỗi hành động ghi (rebuild, tạo task từ node) vào ledger; không ghi nội dung code.

---

## 10. Quản lý ngữ cảnh tài liệu đi kèm (liên quan nhưng tách việc)

Đồ thị chỉ hữu ích khi tài liệu nó trỏ tới còn đúng. Các việc này thuộc kế hoạch "ngữ cảnh dự án", không chặn
Giai đoạn 1 nhưng nên làm song song:

- Trạng thái spec (`draft/active/superseded`) trong front matter + mục lục `.ai/specs/README.md`; có 14 file
  còn tên cũ (`cezar`, `CEZ_`).
- Script CI kiểm đường dẫn/symbol được nhắc trong tài liệu còn tồn tại (cùng engine với cạnh `documents`).
- Tách `AGENTS.md` (295 dòng) theo tầng; `AGENTS.md` lồng theo module; một nguồn → sinh file theo vendor.
- Mở rộng trí nhớ dự án (có thẻ phạm vi, chia sẻ cho worker): chi tiết ở phần ngữ cảnh đã trao đổi.

---

## 11. Rủi ro và giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
| --- | --- | --- |
| Đồ thị sai mà trông đáng tin | Cao | Nhãn provenance + commit tạo ra; `inferred` tách riêng; trạng thái `stale`; bộ vàng |
| API TypeScript 7.x đổi/không ổn định | Cao | Không phụ thuộc `createProgram`; Spike S1; interface `GraphExtractor`; test khóa phiên bản |
| Parser native không có trên mọi nền tảng/trong tarball | Cao | S1 điều kiện 1; phương án dự phòng WASM; `test:package` |
| Hiệu năng repo lớn (repo của khách ≫ repo này) | Trung bình–Cao | Cấp file trước; gộp phía server; bung dần; ngân sách và benchmark; phân trang |
| Phình phạm vi (đồ thị "mọi thứ") | Trung bình | Chốt câu hỏi chính "đổi X thì gì bị ảnh hưởng?"; giai đoạn có điều kiện |
| Lộ bí mật qua tên file/đồ thị | Trung bình | Denylist, không lưu nội dung, `loopbackReadable=false` |
| Xung đột file nóng giữa các worker | Trung bình | Phạm vi độc quyền; N1/G2/G4 tuần tự |
| Trần prompt bị vượt khi thêm hướng dẫn | Trung bình | `prompt-budget.ts` + test trường hợp xấu nhất |
| Giấy phép (GPL, CC-NC, EPL) lọt vào sản phẩm | Trung bình | Danh sách loại trừ ở §2.2; kiểm giấy phép khi thêm dependency |
| Windows: đường dẫn, junction, `EPERM`, WebView | Trung bình | Chuẩn hoá path; test có guard; QA Tauri |
| Co-change gây nhiễu | Thấp–Trung bình | Loại commit lớn; `count/window/confidence`; tắt mặc định |
| Comment drift về `ONNI_AUTOMATIONS` (`capabilities.ts` ghi opt-in, code mặc định bật) | Thấp | Việc riêng, không trộn vào tính năng này |

---

## 12. Danh sách file sẽ chạm (tổng hợp)

| Khu vực | File | Giai đoạn |
| --- | --- | --- |
| Contract | `packages/contract/src/project-graph.ts` (mới), `index.ts` | 1 |
| Engine | `packages/work/src/project-graph/**` (mới), `packages/work/package.json` | 1–2 |
| Server | `server/server.ts`, `server/project-graph.ts` (mới), `server/capabilities.ts`, `server/ws.ts` (đăng ký topic) | 1–2 |
| CLI | `packages/work/src/index.ts`, `project-graph/graph-cli.ts` | 1 |
| State | `packages/work/src/data-gitignore.ts` (thêm `project-graph/`) | 1 |
| Run | `workflows/run.ts` (G2, G4, A1) | 2–3 |
| Prompt | `dispatch/commands.ts`, `dispatch/prompts.ts`, `dispatch/prompt-budget.ts`, `workflows/manager-worker.ts`, skill dựng sẵn | 3 |
| Web | `packages/web/src/routes/graph/**` (mới), `routes.tsx`, `components/nav-items.ts`, `api/queries.ts`, `api/ws.ts` (hook), `lib/i18n/vi-graph.ts`, `routes/new-task-*.ts` (H1), `routes/settings/**` | 1–4 |
| Tài liệu | `.env.example`, `docs/reference.md`, `docs/design/` (spec thiết kế sau G0), `docs/design/manager-worker.md` | 1+ |

---

## 13. Quyết định cần chủ dự án xác nhận

Mỗi mục có **mặc định đề xuất** để không bị chặn; mặc định sẽ được áp dụng nếu không có chỉ đạo khác.

| # | Quyết định | Mặc định đề xuất | Hệ quả nếu đổi |
| --- | --- | --- | --- |
| D1 | `ONNI_PROJECT_GRAPH` mặc định BẬT (ngoại lệ default-on theo `AGENTS.md`)? | Bật; tắt bằng `=0` | Nếu mặc định tắt: người dùng phải bật, giảm khả năng khám phá |
| D2 | Phạm vi MVP: cấp file (không symbol, không đa ngôn ngữ) | Cấp file, TS/JS trước | Symbol/đa ngôn ngữ sớm ⇒ tăng mạnh công sức và rủi ro |
| D3 | Hướng tới repo chỉ TypeScript hay đa ngôn ngữ cho bản thương mại? | TS/JS trước, đa ngôn ngữ ở Giai đoạn 5 | Quyết định dependency (oxc/TS7 vs tree-sitter) |
| D4 | Quét nền (watcher)? | Không ở MVP; theo yêu cầu + cuối run | Watcher cần cờ `ONNI_*`, trần CPU/RAM |
| D5 | Tóm tắt AI | Tắt mặc định, opt-in theo project, Giai đoạn 5 | Mở sớm ⇒ tốn chi phí, cần UI chi phí |
| D6 | Gắn Automations vào node (Giai đoạn 4) | Chỉ `owner` tùy chọn, chưa kind mới | Kind `graph` ⇒ đụng scheduler, cần thiết kế riêng |
| D7 | Scope của "giao task tại đây" | Gợi ý trong prompt + gói ngữ cảnh | Scope thực thi cưỡng bức ⇒ liên quan manager–worker, phức tạp hơn |
| D8 | Tên và vị trí nav | "Graph" / "Đồ thị dự án", cạnh Automations | Đổi tên là việc i18n nhỏ |
| D9 | Thư viện render thứ hai | Chưa thêm; chờ S2 | Thêm Cytoscape/Sigma làm tăng bundle và công QA |

---

## 14. Xác minh kế hoạch này

1. **Review độc lập (đã lên lịch):** một worker `review` đối chiếu mọi khẳng định về code trong tài liệu này
   (đường dẫn, symbol, số liệu, thứ tự phụ thuộc) với repo và các báo cáo khảo sát; kết quả ghi vào
   `docs/design/project-graph/PLAN-review.md`. Chỗ sai sẽ được sửa trong `PLAN.md` trước khi bất kỳ bước
   triển khai nào bắt đầu.
2. **Cổng G0** sau Giai đoạn 0 (chủ dự án xác nhận engine, renderer, D1–D9).
3. Sau mỗi giai đoạn: cập nhật checklist dưới đây và `docs/design/manager-worker.md` nếu chạm manager–worker.

## 15. Checklist tổng

- [ ] Giai đoạn 0: S1 engine · S2 render · S3 bộ vàng · S4 git — rồi cổng G0
- [ ] Giai đoạn 1: C0 contract · E1 engine · W1 màn hình · N1 nối dây — chấp nhận §8
- [ ] Giai đoạn 2: G1 co-change · G2 run-touched · G3 overlay + impact · G4 WS + hoạt động
- [ ] Giai đoạn 3: A1 prompt · A2 context-from-graph · A3 vùng/test cho manager–worker
- [ ] Giai đoạn 4: H1 scope có cấu trúc · H2 owner cho automation
- [ ] Giai đoạn 5: theo nhu cầu (symbol, đa ngôn ngữ, AI, time travel)
- [ ] Mỗi bước: contract + parity + CLI + prompt (nếu có) + UI (nếu có) + test + `.env.example`/`docs/reference.md`
- [ ] Trước mỗi commit: `typecheck`, `test`, `test:unit`, `build`, `test:package`
