# Review độc lập: Project Graph PLAN

Ngày review: 2026-11-06. Đối tượng: PLAN.md trong commit 910c61e, nhánh onni/e16b2fd9. Diff từ dccc6b0 chỉ thêm PLAN.md (646 dòng); bốn báo cáo khảo sát nằm cùng thư mục. Không tìm thấy report.md hoặc notes.md của run gốc trong thư mục dispatch được chỉ định, nên không có bản tự báo cáo để đối chiếu.

Các số đếm mã nguồn được tính lại trên bốn thư mục src của contract, api-client, work và web. License được kiểm tra bằng npm metadata ngày 2026-11-06; es-module-lexer, Cosmograph và GPL được đối chiếu thêm với upstream. “CONFIRMED” nghĩa là khẳng định hiện trạng khớp với mã nguồn; tên có nhãn “mới/đề xuất” được xem là thiết kế tương lai, không phải mã đã có.

## Bảng kiểm chứng

| # | Khẳng định trong PLAN.md | Kết luận | Bằng chứng |
| ---: | --- | --- | --- |
| 1 | §3.2: package.json workspaces hiện có 5 package. | WRONG — root package.json khai báo 4 npm workspaces; packages/desktop có package.json riêng và không thuộc workspace. | package.json, mục workspaces; packages/desktop/package.json; AGENTS.md, Repository layout |
| 2 | §2.1: 797 file nguồn production, 199.375 LOC; 837 test/testkit file, 191.823 LOC. | CONFIRMED — đếm lại bốn thư mục src với phần mở rộng và loại test như survey-server.md. | packages/{contract,api-client,work,web}/src; survey-server.md §10 |
| 3 | §2.1: khoảng 1.510 cạnh import tương đối. | UNVERIFIABLE — survey-server.md mô tả phép đếm gần đúng một dòng, import/export tương đối, dấu nháy đơn; con số không phải inventory chính xác và chưa được tái lập bằng đúng script gốc. Giữ nhãn ước lượng, không dùng làm số đo chuẩn. | survey-server.md §10 |
| 4 | §1.1: workflows/run.ts có 10.144 dòng, server/server.ts có 8.422 dòng. | CONFIRMED — số dòng hiện tại khớp. | packages/work/src/workflows/run.ts; packages/work/src/server/server.ts |
| 5 | §2.1: web khai báo @xyflow/react ^12.12.0 và @dagrejs/dagre ^3.1.1; đã có workflow, task và activity graph. | CONFIRMED — cả hai range và ba view/model đều hiện có. | packages/web/package.json; packages/web/src/routes/workflow-graph/; lib/workflow-graph.ts; lib/activity-graph.ts |
| 6 | §2.1: Sigma, Cytoscape và ELK chưa có trong web package. | CONFIRMED — không có trong dependencies của packages/web/package.json. | packages/web/package.json |
| 7 | §2.1: automations, dispatch và worktree-lifecycle là các mẫu store/lifecycle hiện có. | CONFIRMED. | packages/work/src/automations/{store,coordinator,scheduler}.ts; packages/work/src/dispatch/{state-file,tree-fs}.ts; packages/work/src/worktree-lifecycle/store.ts |
| 8 | §2.1: requireRootManager và worktreeChangedFilesReadOnly tồn tại. | CONFIRMED. | packages/work/src/dispatch/access.ts: requireRootManager; packages/work/src/git-worktree.ts: worktreeChangedFilesReadOnly |
| 9 | §2.1, §3.5: git-changes.ts dùng git log/diff-tree -M, nhận diện rename; listRepoPaths có trần 20.000 path và 8 MiB. | CONFIRMED. | packages/work/src/server/git-changes.ts: collectRunCommits, collectCommitChanges, listRepoPaths, REPO_TREE_CAP, REPO_TREE_BYTES_CAP |
| 10 | §3.5: worktreeChangedFilesReadOnly là đường đọc; worktreeChangedFiles chạy git add -N và thay đổi index. | CONFIRMED. Hàm read-only có timeout mặc định 3 giây và AbortSignal; hàm còn lại ghi intent-to-add. | packages/work/src/git-worktree.ts: gitReadOnly, worktreeChangedFilesReadOnly, worktreeChangedFiles |
| 11 | §2.1, §3.7: RunRecord.diffStat chỉ lưu adds/dels/files/repointed, không có danh sách path. | CONFIRMED. | packages/contract/src/runs.ts: diffStatSchema; packages/work/src/runs/store.ts: runRecordSchema |
| 12 | §3.8: FILE_CONTENT_CAP tương đương 512 KiB. | WRONG — giá trị là 512.000 byte, không phải 524.288 byte. | packages/work/src/server/git-changes.ts: FILE_CONTENT_CAP |
| 13 | §2.1, §3.1: TypeScript là 7.0.2; require('typescript').createProgram không có; unstable/sync và unstable/async có Project, unstable/ast có AST helpers; repo dùng import .js trong TypeScript. | CONFIRMED — probe Node cho version 7.0.2, createProgram undefined và Project có ở sync/async; source TypeScript có .js specifiers với NodeNext resolution. | package.json; packages/work/package.json; packages/work/tsconfig.json: moduleResolution NodeNext; packages/work/src/core/*.ts; Node probe; survey-server.md §9 |
| 14 | §2.1, §3.1: TypeScript trong @onni/work là devDependency, không được đóng gói như runtime parser; parser runtime mới phải thuộc @onni/work. | CONFIRMED. | packages/work/package.json: devDependencies, files; packages/work/scripts/check-pack.mjs; AGENTS.md, dependency/workspace rule |
| 15 | §2.3, §3.1: es-module-lexer phân tích JavaScript và file .ts/.tsx thường cần loại kiểu trước; esbuild đã là devDependency. | WRONG phần transform — full build hỗ trợ erasable TypeScript, gồm import/export type, không cần transform; minimal build JS-only. esbuild hiện là devDependency, còn TSX phải được xác minh trong spike. | README upstream của es-module-lexer: mục TypeScript và Full Build; packages/work/package.json: esbuild; survey-server.md §9 |
| 16 | §2.3: mức tương thích ts-morph với TypeScript 7.0.2 chưa được kiểm. | UNVERIFIABLE — đây là mô tả đúng về phần chưa thử, không phải kết luận tương thích. Cần spike nếu chọn ts-morph. | research-engines.md §“TypeScript Compiler API và ts-morph”; survey-server.md §9 |
| 17 | §3.1, §6.3: license của oxc-parser, es-module-lexer, Cytoscape, Sigma, elkjs và Cosmograph. | CONFIRMED về license cơ bản: npm metadata lần lượt ghi MIT, MIT, MIT, MIT, EPL-2.0 OR GPL-3.0-or-later, CC-BY-NC-4.0. Snapshot metadata: oxc-parser 0.157.0; es-module-lexer 3.0.4; cytoscape 3.34.4; sigma 4.0.4; elkjs 0.12.1; @cosmograph/react 2.5.1. | npm metadata: npmjs.com/package/oxc-parser, es-module-lexer, cytoscape, sigma, elkjs, @cosmograph/react |
| 18 | §2.2: Code Maat là GPL-3.0, vì vậy không thể dùng trong sản phẩm thương mại. | WRONG ở hệ quả pháp lý — GPL-3.0 cho phép bán và phân phối thương mại nếu tuân điều khoản copyleft; việc tích hợp vào sản phẩm phân phối cần rà soát nghĩa vụ nguồn. | GitHub adamtornhill/code-maat, LICENSE/README; GNU GPL FAQ, mục bán bản sửa đổi |
| 19 | §2.2, §6.3: Cosmograph/cosmos.gl có license CC-BY-NC-4.0 nên không dùng được cho sản phẩm thương mại. | WRONG nếu diễn đạt như cấm tuyệt đối — license miễn phí là non-commercial, trang chính thức cung cấp license riêng cho thương mại. Có thể ghi “không dùng theo license miễn phí; thương mại cần proprietary license”. | npm metadata @cosmograph/react; cosmograph.app/licensing |
| 20 | §2.2: license elkjs là EPL-2.0 OR GPL-3.0. | WRONG về chuỗi SPDX đầy đủ: npm metadata ghi EPL-2.0 OR GPL-3.0-or-later. Kích thước 427 kB gzip cần gắn rõ là số của elkjs 0.12.0 trong research-viz.md, không phải size/version hiện hành. | npm metadata elkjs; npmjs.com/package/elkjs; research-viz.md, bảng thư viện |
| 21 | §2.2: scip-typescript cần Node 22/24, Joern cần JDK 21; stack-graphs đã archived. | CONFIRMED theo nghiên cứu upstream được trích trong research-engines.md; Node tối thiểu của repo là >=20. | research-engines.md: scip-typescript, Joern, stack-graphs; package.json: engines |
| 22 | §2.1, §6.1: route lazy, page title, nav filter và command palette dùng cùng NAV_ITEMS; route graph nên theo project scope. | CONFIRMED về wiring hiện tại và khả năng tái dùng. | packages/web/src/routes.tsx: lazyRoute, ProjectScopeRoute, PAGE_TITLE_ROUTES; components/nav-items.ts: NAV_ITEMS, visibleNavItems; components/command-palette.tsx |
| 23 | §2.1, §6.4: chưa có topic “worker đang sửa file”; useRunChanges poll 4 giây. | CONFIRMED. | packages/web/src/api/queries.ts: useRunChanges; packages/web/src/api/ws.ts; packages/work/src/server/ws.ts; survey-web.md §4 |
| 24 | §2.1, §6.5: NewTaskDraft chưa có scope path dạng danh sách. | CONFIRMED. | packages/web/src/routes/new-task-draft.ts: NewTaskDraft |
| 25 | §6.5: new-task-params.ts hiện chỉ có {skill, ref, todo}. | WRONG — NewTaskParams còn có auto và key; parseNewTaskParams nhận task làm alias cũ của ref. Chỉ newTaskPrefillHref nhận các trường skill/ref/todo. | packages/web/src/routes/new-task-params.ts: NewTaskParams, parseNewTaskParams, newTaskPrefillHref |
| 26 | §5: objective/order của dispatch giới hạn 4.000 ký tự. | CONFIRMED — dispatchInputSchema.objective có max(4000). | packages/contract/src/dispatch.ts: dispatchInputSchema |
| 27 | §7.1: Automation kinds là github/schedule/tracker; quy mô khoảng 4.700 dòng server, 3.300 dòng web runtime và liên kết hơn 30 file. | CONFIRMED ở mức làm tròn: đếm lại 4.651 LOC work automations và 3.315 LOC web runtime; hơn 30 file nguồn có tham chiếu automation. Survey web ghi 25 file/3.294 LOC; chênh lệch nhỏ ở phép đếm nguồn, không làm sai số làm tròn của PLAN. | packages/work/src/automations/; packages/web/src/routes/automations/; packages/work/src/server/server.ts; survey-web.md §1 |
| 28 | §11: capabilities.ts có comment opt-in cho Automations nhưng code mặc định bật. | CONFIRMED — resolveCapabilities dùng env.ONNI_AUTOMATIONS !== '0'; comment đầu file đã drift. | packages/work/src/server/capabilities.ts: resolveCapabilities; packages/work/src/server/server.ts: requireAutomations |
| 29 | §1.3: DATA_GITIGNORE_ENTRIES hiện cần bổ sung project-graph/. | CONFIRMED — danh sách hiện có state khác nhưng chưa có project-graph/. | packages/work/src/data-gitignore.ts: DATA_GITIGNORE_ENTRIES, ensureDataGitignore |
| 30 | §1.3, §3.3: writeAtomic và withPathLock là primitives hiện có; withPathLock chỉ khóa trong process, Automations dùng proper-lockfile. | CONFIRMED. | packages/work/src/dispatch/state-file.ts: writeAtomic, withPathLock; packages/work/src/automations/store.ts |
| 31 | §1.3, §3.4, §4.1: contract Zod Node-free, family Hono phải chain vào v1, validators là middleware; v1 hiện mount cả scoped và default project path. | CONFIRMED. | packages/contract/tsconfig.json; packages/work/src/server/validators.ts; server/server.ts: v1, V1_SCOPED_PREFIX, V1_PREFIX; server/app-type.ts |
| 32 | §1.3, §4.2: WS dùng một socket chung; publisher chạy khi subscriber đổi 0→1, dừng 1→0; loopbackReadable mặc định false. | CONFIRMED. | packages/work/src/server/ws.ts: TopicPublisher, TopicOptions, registerTopic, subscribe/unsubscribe; packages/web/src/api/ws.ts: subscribeTopic |
| 33 | §5: PROMPT_MAX_CHARS hiện có và phải được cập nhật nếu thêm GRAPH_COMMANDS_MAX_CHARS. | CONFIRMED về hằng hiện có; GRAPH_COMMANDS_MAX_CHARS là tên mới được đề xuất. | packages/work/src/dispatch/prompt-budget.ts; packages/work/src/workflows/manager-worker.ts |
| 34 | §3.7: child report/turn-end capture có changedFiles/filesOmitted trước cleanup, khác với diffStat số lượng. | CONFIRMED. | packages/work/src/workflows/run.ts: child report capture, recordTurnEnd; packages/work/src/git-worktree.ts: worktreeChangedFilesReadOnly |
| 35 | §9: Tauri dùng cùng web bundle, không có graph UI riêng trong splash UI. | CONFIRMED. | packages/desktop/ui/index.html; packages/desktop/scripts/stage-engine.mjs; packages/desktop/src-tauri/tauri.conf.json |
| 36 | §9: các command typecheck/test/test:unit/build/test:package và UI e2e qua .ai/scripts/e2e.sh tồn tại. | CONFIRMED — các script có trong package manifests; e2e status skipped không phải pass theo AGENTS.md. | package.json; packages/work/package.json; packages/web/package.json; AGENTS.md, Commands |
| 37 | §10: AGENTS.md có 295 dòng. | CONFIRMED — đếm file hiện tại được 295 dòng. | AGENTS.md |
| 38 | §10: có 14 file .ai/specs còn nhắc tên cũ cezar/CEZ_. | WRONG — tìm trong markdown hiện có 12 file có nội dung khớp, 0 filename khớp. | rg -l -i 'cezar\|CEZ_' .ai/specs --glob '*.md'; rg --files .ai/specs |
| 39 | Các route, schema, capability, CLI, cache và topic Project Graph trong §§3–8, 12. | CONFIRMED là đề xuất mới: chưa có project-graph implementation, graph CLI hoặc projectGraph capability hiện tại; PLAN đánh dấu các file mới/đề xuất. | packages/work/src/index.ts; packages/work/src/server/capabilities.ts; packages/contract/src/index.ts; packages/web/src/routes.tsx |
| 40 | §3.2, §6.2: test/doc/schema/route/client/hook có thể coi là các kind/node riêng trong khi dùng cùng ID file. | WRONG — mô hình chưa chốt được đây là node riêng hay role trên một file node; test/doc dùng file ID, còn schema/route/client/hook chưa được khai báo trong bảng Node. | PLAN.md §§3.2, 3.4, 6.2 |
| 41 | §3.2: mọi import không tương đối trở thành node ext. | WRONG nếu áp dụng nguyên văn — import @onni/contract, @onni/api-client, @onni/work và @onni/web là workspace import nội bộ, không phải external dependency. | package.json workspaces; packages/{work,web,api-client}/package.json; source imports dưới packages/*/src |
| 42 | §8: G1 độc lập với G2/G3/G4 vì G1 chỉ chạm project-graph/. | UNVERIFIABLE — G1/G3/G4 không có phạm vi file độc quyền trong bảng; G3 overlay/impact có khả năng dùng cùng module graph. G2/G4 được nói cùng chạm run.ts nhưng hàng G4 không liệt kê file đó. | PLAN.md §§8, 12; packages/work/src/workflows/run.ts |
| 43 | §13: mặc định D1 sẽ áp dụng nếu chủ dự án không chỉ đạo khác, với ONNI_PROJECT_GRAPH mặc định bật. | WRONG theo AGENTS.md — default-on exception cần được owner duyệt rõ. Trong PLAN D1 vẫn là câu hỏi xác nhận, nên “không có chỉ đạo” không thể tính là duyệt. | PLAN.md §§4.4, 13; AGENTS.md, Zero config |
| 44 | §§1.3, 4.4, 6.6, 13: AI summary tắt mặc định theo Settings là đủ. | WRONG/thiếu invariant — summary có thể phát sinh cost/exposure; cần chốt local-only/no-upload hoặc giới hạn rõ. Nếu summary gọi process/network ngoài, phải có ONNI_* off switch và .env.example; Settings không được vượt qua off switch. | PLAN.md §§1.2–1.3, 4.4, 6.6, 13; AGENTS.md, Zero config và Local-first |
| 45 | §3.8: .npmrc chỉ deny nếu có token, đồng thời file denylist không bao giờ được đọc nội dung. | WRONG — không thể biết .npmrc có token mà không đọc nó. Deny toàn bộ đường dẫn .npmrc mặc định, và không đưa path/hash của file denylist vào node/cache nếu mục tiêu là tránh lộ tên file. | PLAN.md §3.8; packages/work/src/server/git-changes.ts: listRepoPaths; AGENTS.md, Local-first |

**Đếm theo 45 dòng kiểm chứng:** CONFIRMED 29; WRONG 13; UNVERIFIABLE 3.

## Kiểm tra tính nhất quán và invariant

1. Giai đoạn 0 không nêu xung đột: S1–S4 có đầu ra riêng. Giai đoạn 1 có thứ tự hợp lý C0 → (E1 ∥ W1) → N1; E1 và W1 tách package, N1 chạy sau E1. N1 có graph-cli.ts dưới thư mục E1 sở hữu, nhưng hai bước đang tuần tự nên không phải xung đột song song.
2. Giai đoạn 2 tuyên bố G1 song song với G3 nhưng không khai báo phạm vi file cho G1–G4. Không thể xác nhận phạm vi rời nhau; G1 chỉ ghi “project-graph/”, còn overlay/impact G3 có thể sửa cùng engine/API. G2/G4 được ghi là tuần tự do run.ts, nhưng G4 cũng cần liệt kê run.ts hoặc các runner file cụ thể. Không nên giao song song trước khi thêm ma trận file độc quyền.
3. Zero-config/cache: cache là state tái tạo được, có DATA_GITIGNORE_ENTRIES và đường rebuild. Các đề xuất Zod/Node-free, validator middleware, route family builder và một WS bus phù hợp AGENTS.md.
4. D1 default-on chỉ được áp dụng sau khi owner duyệt rõ như ngoại lệ. Mục mở đầu §13 “mặc định sẽ được áp dụng nếu không có chỉ đạo khác” mâu thuẫn với yêu cầu đó.
5. AI summary được gọi là opt-in theo Settings, nhưng chưa có đường xử lý local-only/no-upload hoặc ONNI_* off switch trong .env.example. Mục này cần sửa trước khi đưa vào phạm vi triển khai.
6. Cache, prompt và topic cần giữ nguyên nguyên tắc atomic write, secret exclusion, request/output caps, không .skip và demand-driven 0→1/1→0 subscription.

## Các sửa bắt buộc trong PLAN.md

1. **§3.2, dòng package.** Thay dòng package bằng:

   > | package | pkg:<name> | Root package.json workspaces | 4 npm workspace; packages/desktop nằm ngoài workspace và chỉ thêm như package riêng nếu cần |

   Đồng thời thay dòng ext bằng:

   > | ext | ext:<pkg> | Chỉ package bên thứ ba chưa resolve | Gói nội bộ @onni/* phải resolve về workspace/package/file nội bộ qua manifests, exports và aliases; chỉ dependency thực sự bên ngoài mới thành ext |

2. **§3.2, Node/test/doc và §6.2, bộ lọc.** Thay các hàng test/doc bằng định nghĩa role trên cùng một node file:

   > test và doc là role/flag của node file:<repo-rel-posix-path>, không phải node có ID trùng. Schema/route/client/hook cũng là role của file node trong contract-flow; bộ lọc truy vấn role này.

   Nếu muốn các node riêng, cấp ID riêng và định nghĩa edge ánh xạ file↔role trước khi vẽ.

3. **§2.3 và §3.1, es-module-lexer.** Thay mô tả “thường cần loại kiểu trước” và candidate row bằng:

   > es-module-lexer full build đọc JavaScript và erasable TypeScript, bao gồm import/export type mà không cần transform. Spike S1 kiểm tra cú pháp của repo, dynamic import và resolver; chỉ thêm bước esbuild transform nếu fixture chứng minh cần. Minimal build chỉ hỗ trợ JavaScript; cú pháp TypeScript không erasable nằm ngoài phạm vi lexer.

4. **§2.1 và §6.5, new-task-params.ts.** Thay “chỉ có {skill, ref, todo}” bằng:

   > Hiện parseNewTaskParams trả NewTaskParams gồm skill, ref, auto, key và todo; task là alias cũ cho ref. newTaskPrefillHref chỉ nhận skill/ref/todo. NewTaskDraft chưa có scope path dạng danh sách.

5. **§3.8, FILE_CONTENT_CAP.** Thay “512 KiB, như FILE_CONTENT_CAP” bằng:

   > Trần mặc định 512.000 byte mỗi file, hiện tương ứng FILE_CONTENT_CAP; không gọi là 512 KiB.

6. **§8, G1–G4.** Thay câu “G1 độc lập với G2/G3/G4” bằng:

   > Chỉ xếp G1–G4 song song sau khi bảng phạm vi file độc quyền chứng minh không chồng lấn. G1 và G3 phải chạy tuần tự nếu cùng sửa bất kỳ file nào của project-graph engine/API; G2 và G4 chạy tuần tự khi cùng sửa workflows/run.ts. Mỗi hàng phải ghi đầy đủ file server, runner và web sẽ chạm.

7. **§13, D1 và phần dẫn nhập.** Thay quy tắc “mặc định sẽ được áp dụng nếu không có chỉ đạo khác” bằng:

   > Mặc định đề xuất chỉ có hiệu lực sau khi chủ dự án xác nhận tại cổng G0. ONNI_PROJECT_GRAPH mặc định bật chỉ khi owner duyệt rõ ngoại lệ default-on; nếu chưa duyệt thì mặc định tắt.

8. **§1.3, §4.4, §6.6 và D5.** Thay mô tả AI summary bằng:

   > AI summary thuộc giai đoạn sau, tắt mặc định ở engine. Dữ liệu Project Graph không được upload; chỉ dùng xử lý local. Chỉ bật qua ONNI_PROJECT_GRAPH_AI_SUMMARY=1; khi flag unset hoặc bằng 0 thì tắt. Ghi biến vào .env.example và docs/reference.md; Settings theo project không thể vượt qua flag.

9. **§3.8, secret denylist.** Thay mục .npmrc conditional bằng:

   > Deny toàn bộ .npmrc theo path mà không đọc nội dung để dò token. File thuộc denylist không được đọc, băm, cache hoặc đưa tên/path vào graph; chỉ có thể bật ngoại lệ qua quyết định riêng.

10. **§2.2, giấy phép.** Thay câu Code Maat bằng:

   > Code Maat ghi GPL-3.0; GPL cho phép sử dụng và phân phối thương mại theo điều khoản copyleft. Không nhúng dependency GPL vào sản phẩm phân phối trước khi rà soát nghĩa vụ nguồn; thuật toán co-change tự cài đặt vẫn là lựa chọn MVP.

   Sửa ELK thành “EPL-2.0 OR GPL-3.0-or-later; 427 kB gzip là số của elkjs 0.12.0 theo research-viz.md”. Sửa Cosmograph thành “license miễn phí CC-BY-NC-4.0; sử dụng thương mại cần proprietary license theo trang chính thức”.

11. **§10, số file tên cũ.** Thay 14 bằng:

   > Có 12 file Markdown trong .ai/specs còn nhắc cezar/CEZ_ theo phép đếm rg -l -i; không có filename hiện tại chứa chuỗi đó. Cập nhật số này khi chạy lại kiểm kê.

## Cải thiện tùy chọn

- Trong bảng API ghi rõ path tương đối với family và hai mount hiện tại: /api/v1/graph cho project boot mặc định, /api/v1/p/:projectId/graph cho project tường minh; nêu cách bảo đảm route chỉ đọc project context hợp lệ.
- Topic theo project nên gọi disposer registerTopic khi project bị unregister; ghi rõ vòng đời publisher/observer và cách dọn subscription.
- Lưu script tạo inventory cạnh spike để 1.510 cạnh import có thể tái lập; xác định rõ có tính dynamic import, test/testkit, multiline và package imports hay không.
- Tách role “worker đang sửa” khỏi node run nếu worker chỉ là overlay; nêu cách map file path repo↔worktree và giới hạn payload WS.
- Ghi rõ project graph không đọc file denylist, không lưu path/hash của chúng và không đưa mã hoặc nội dung tài liệu vào AI summary.

## Kiểm tra thực thi trên nhánh review

- `npm run typecheck` và `npm run build` đều dừng tại `packages/work/src/webhooks/transport.ts:108`: TS2353, `maxRedirections` không có trong kiểu options hiện tại của undici.
- `npm test` bị dừng sau hơn 5 phút; trước khi dừng đã báo lỗi ở nhiều suite git/worktree và guard. Kết quả suite đầy đủ chưa được thu thập.
- `npm run test:unit`: 45/48 pass, 2 fail, 1 capability-guarded skip. Hai lỗi Windows là `spawnSync mkdir ENOENT` và `spawnSync /bin/sh ENOENT`.
- `npm run test:package`: 2/4 pass, 2 fail do build chưa tạo `dist/contract/index.js` và `web/dist/index.html`; lệnh build đã lỗi như trên.

Các lỗi trên ngăn việc dùng bộ test để chứng nhận bản build, nhưng không thuộc phạm vi diff đang review (chỉ có PLAN.md). Không coi chúng là bằng chứng về tính đúng/sai của thiết kế Project Graph.

## Kết luận

**ready after corrections** — cấu trúc và các phase chính có cơ sở từ repo, nhưng các lỗi workspace/task/parser/cap/license, mô hình node và các invariant default-on/AI/secret chưa đủ rõ để chuyển thẳng sang triển khai.
