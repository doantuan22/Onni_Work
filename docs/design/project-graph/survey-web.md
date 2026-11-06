Truy cập web trực tiếp: có; các nguồn chính thức dưới đây được kiểm tra ngày 2026-11-06.

# Khảo sát cockpit web cho Project Graph

Phạm vi là khảo sát và khuyến nghị cho một view đồ thị repository mới, nằm cạnh các chức năng hiện tại. Đây không phải thiết kế chi tiết hay thay đổi sản phẩm đã triển khai. Các nhận định về code dẫn đường dẫn và symbol trong repo; nhận định thư viện dẫn tài liệu chính thức. Chỗ nào chưa kiểm chứng được ghi rõ.

## 1. Thêm view top-level và giữ project scope

### Cách định tuyến hiện nay

- `packages/web/src/routes.tsx`: `lazyRoute()` tạo lazy chunk cho route; `PAGE_TITLE_ROUTES` ánh xạ pattern sang `pageLabel`; `AppRoutes` dựng route tree. Route `/p/:projectId` được bọc bởi `ProjectScopeRoute`/`ProjectScopeProvider`; các route con của project được lồng bên dưới. View đồ thị repository nên là route project-scoped để project đang chọn quyết định repo nào được đọc. Thêm entry page title cùng route thay vì tạo một URL ngoài project scope.
- `ProjectScopeRoute` đợi `useProjects()` khi registry chưa tải xong, đối chiếu `projectId` với project đã đăng ký và chuyển sang `UnknownProjectRoute` nếu ID không tồn tại. Project khởi chạy cockpit (boot project) dùng API scope `null`, do đó đường dẫn cũ `/api/v1` vẫn được giữ; project khác được gọi qua `/api/v1/p/:projectId`. Nguồn: `packages/web/src/routes.tsx` (`ProjectScopeRoute`) và `packages/web/src/api/project-scope-context.tsx` (`ProjectScopeProvider`, `useProjectScope`).
- Dùng `scopeTo()`/`useActiveProjectId()` từ `packages/web/src/lib/project-router.tsx` để tạo link trong app. `packages/api-client/src/utils/project-scope.ts` cung cấp `apiPath()` và `queryScope()`; `packages/web/src/api/client.ts` dùng các helper này để gọi project route của Hono. Tránh tự ghép `/api/v1/p/...` trong component.
- `packages/web/src/routes/unknown-project.tsx` hiển thị trạng thái không tìm thấy project và liên kết rõ ràng đến project hợp lệ. Giữ hành vi này cho deep link đồ thị; đừng âm thầm chuyển người dùng sang repo khác.
- `packages/web/src/components/nav-items.ts` khai báo `NAV_ITEMS`; `visibleNavItems()` áp dụng các capability filter; `activeNavPath()` quyết định active item. `AppShell` nhận các item hiển thị từ `AppShellContainer`; nơi này lấy capability từ health response. `packages/web/src/components/command-palette.tsx` tạo nhóm Views từ cùng danh sách nav, vì vậy item mới có thể vào cả sidebar lẫn palette. Route label vẫn cần `PAGE_TITLE_ROUTES`.

### Automations là mẫu wiring, không phải phạm vi thay đổi

- `routes.tsx` khai báo `AutomationsRoute` bằng `lazyRoute()` và các đường dẫn list/new/edit/log; các trang dùng `Suspense` với `AutomationsLoading` (`packages/web/src/routes/automations/automations-loading.tsx`). `nav-items.ts` đánh dấu Automations theo capability; `app-shell-container.tsx` lấy `health.data?.capabilities.automations` và đưa vào shell.
- `packages/work/src/server/capabilities.ts` (`resolveCapabilities`) hiện tính `automations: env.ONNI_AUTOMATIONS !== '0'`, phù hợp quy tắc trong `AGENTS.md`: mặc định bật, tắt bằng `ONNI_AUTOMATIONS=0`. `packages/work/src/server/server.ts` (`requireAutomations`) trả 409 nếu capability tắt và gắn middleware cho các route automation. Scheduler cũng kiểm tra capability trước khi khởi động/reschedule.
- Có comment cũ mâu thuẫn với hành vi đang chạy: phần mô tả đầu `capabilities.ts` ghi opt-in `ONNI_AUTOMATIONS=1`, và comment cạnh `requireAutomations` nói unset sẽ tắt. Đây là comment drift; căn cứ hành vi hiện tại là biểu thức trong `resolveCapabilities`, middleware và quy tắc `AGENTS.md`. Chưa thấy lý do để đổi gate khi thêm Project Graph.
- Kiểm kê `packages/web/src/routes/automations/`: 45 file `.ts/.tsx`; 25 file runtime sau khi bỏ `*.test.*` và fixture, khoảng 3,294 dòng runtime; tổng 5,617 dòng tính cả test/fixture. Con số là lần đếm file nguồn, không tính CSS. Surface gồm route/list/table, editor và draft, trường GitHub/schedule/tracker/dispatch/run-as, calendar day/week, log, stats/last-run/next-runs, template palette, tracker-label suggestions, copy CLI và row actions. Comment tại `routes.tsx` cũng mô tả route này cỡ 3k dòng. Giữ nguyên `routes/automations/` và capability hiện tại; view đồ thị là feature song song.

## 2. Các UI đồ thị hiện có và phần có thể tái sử dụng

### Ba model khác nhau

| Surface | Model và layout | Tương tác / tests |
| --- | --- | --- |
| Workflow editor | `packages/web/src/lib/workflow-graph.ts` (`WorkflowGraph`, `autoLayout`) ánh xạ workflow thành node/edge; Dagre `rankdir: LR`, node dimensions tùy biến, weight nhánh lỗi cao hơn nhánh thành công. | `routes/workflow-graph/workflow-graph.tsx` dùng `@xyflow/react`, custom `EditorNode`, custom edge, nền/controls, drag để lưu layout, panel cấu hình node và validation. Tests: `lib/workflow-graph.test.ts`, `routes/workflow-graph/workflow-graph.test.tsx`, `workflow-graph-sim.test.ts`. |
| Task graph | `routes/workflow-graph/task-graph.tsx` lấy graph workflow và overlay trạng thái run (`runOverlay()` trong `lib/workflow-graph.ts`: node state, edge counts, nhánh/loop được chọn). | Read-only, fit view, click node mở panel chi tiết; custom node cards cho live run/subtask. Bao phủ bởi test task graph trong `routes/workflow-graph/`. |
| Activity graph | `packages/web/src/lib/activity-graph.ts` (`buildActivityGraph`) biến root/worker runs thành agent nodes và assign/report/after edges; layout deterministic theo generation và hàng, tối đa 4 cột; không dùng Dagre. | `routes/workflow-graph/activity-graph.tsx` vẽ node memoized, status/flow edges, selection panel; `lib/activity-graph.test.ts` và `routes/workflow-graph/activity-graph.test.tsx`. |

Dependency hiện có là `@xyflow/react` `^12.12.0` và `@dagrejs/dagre` `^3.1.1` trong `packages/web/package.json`. `graph-node.tsx` có `GraphNodeView` memoized và `LaneEdge` custom smooth-step; Activity có custom card và edge styling trong `activity-graph.css`. Nút hiện tại được chọn để mở panel (`FloatingPanel` trong `workflow-graph.tsx`); các canvas hỗ trợ fit view, zoom/pan và controls.

### Tái sử dụng và phần phải thiết kế mới

- Tái sử dụng: khung React Flow, controls/background, chọn node → `FloatingPanel`, memoization/custom node pattern, token-based colors, loading/error/empty states, bố trí route lazy, project scope, và cách Activity/Workflow mô hình hóa trạng thái. Dùng node mới cho repository entities; không tái sử dụng workflow node model vì graph repository khác ngữ nghĩa.
- Phải thiết kế: schema cho module/file/symbol/test/doc/contract/route/client/hook, provenance extracted/inferred/declared, edge-type filter, search, semantic zoom, clustering/collapse và expand-on-demand, repo/run heatmap, lịch sử co-change, layout phù hợp với file tree và dependency graph, cùng selection state/deep link. Activity collapse chỉ gom worker đã xong khi số worker lớn hơn `COLLAPSE_ABOVE=12`; đây không phải clustering repository graph. Activity grid cũng không xử lý hàng nghìn entity.
- `activity-graph.tsx` đặt `onlyRenderVisibleElements={nodes.length > 40}` và chỉ bật MiniMap khi có hơn 8 node. Đây là heuristic của Activity view, không phải cam kết giới hạn hoặc benchmark. Chúng là ví dụ để đo/điều chỉnh, không nên sao chép thành hard cap.

## 3. Scale, rendering, dependency và bundle

Không tìm thấy giới hạn cứng theo số node/edge trong repo hoặc tài liệu React Flow/Dagre đã đọc. Dagre README mô tả directed graph layout nhưng không đưa ra trần kích thước. React Flow khuyến cáo memoize node/edge/callback, tránh subscribe vào toàn bộ `nodes`/`edges`, giảm style/độ phức tạp và collapse các cây lớn ([React Flow performance](https://reactflow.dev/learn/advanced-use/performance), truy cập 2026-11-06). API `onlyRenderVisibleElements` render phần tử trong viewport nhưng có overhead và mặc định tắt ([React Flow API](https://reactflow.dev/api-reference/react-flow), truy cập 2026-11-06). Không có bằng chứng để nêu “xyflow/dagre chịu được tối đa N node”; cần benchmark với graph đại diện thực tế.

| Thư viện | Fact từ nguồn chính thức | Vai trò nếu cần |
| --- | --- | --- |
| React Flow / xyflow | Tài liệu performance nêu render/update node phức tạp có thể tốn kém, và đưa các kỹ thuật memoization/visible-only/collapse. Không nêu ngưỡng node cố định. | Đang dùng; hợp với editor/tương tác node-link. |
| Dagre | README mô tả layout directed graph phía JavaScript; không công bố scale cap. | Đang dùng cho workflow; đo lại nếu dùng cho repo graph. |
| Sigma.js | Rendering docs mô tả WebGL và hiệu năng mượt ở quy mô hàng chục nghìn node/edge ([Sigma rendering](https://www.sigmajs.org/concepts/rendering/), truy cập 2026-11-06). Đây là tuyên bố của thư viện, không thay benchmark trên cockpit. | Ứng viên render graph lớn; cần thêm dependency và đánh giá accessibility/interaction. |
| Cytoscape.js | Tài liệu performance lưu ý edge/style/label/animation/pixel ratio ảnh hưởng hiệu năng, có hướng dẫn tối ưu ([Cytoscape performance](https://js.cytoscape.org/#performance), truy cập 2026-11-06). Không thấy một con số trần áp dụng chung. | Renderer + graph analysis; cân nhắc nếu cần thêm thuật toán/phân tích. |
| D3 force | `d3-force` là simulation/layout mutable tick-based; node position/velocity bị cập nhật ([D3 force simulation](https://d3js.org/d3-force/simulation), truy cập 2026-11-06). | Bố trí force-directed, không phải renderer canvas thay thế. |
| ELK.js | README nói đây là layout engine, không render/style; hỗ trợ layered layout cho directed port/node-link diagrams ([ELK.js](https://github.com/kieler/elkjs/blob/master/README.md), truy cập 2026-11-06). | Tính layout phức tạp; không phải giải pháp hiển thị. |

`packages/web/package.json` chưa có Sigma, Cytoscape, D3 force hoặc ELK. Route lazy pattern trong `routes.tsx` tách code theo trang; graph view nên tiếp tục lazy-load. `packages/web/vite.config.ts` nhóm React runtime chunk; `packages/web/src/vite-config.test.ts` giữ ngưỡng cảnh báo bundle mặc định và bảo vệ cấu hình runtime chunk, không nâng ngưỡng cảnh báo để che bundle phình. Build assets `packages/work/web/dist` không có trong worktree khảo sát nên kích thước bundle thực tế: chưa kiểm.

Khuyến nghị cho graph lớn là inference cần benchmark: server-side hoặc worker-side aggregation/layout, tải neighborhood theo viewport/selection, cập nhật theo batch/revision, và semantic zoom/collapse. Nếu yêu cầu hiển thị nhiều node cùng lúc, benchmark React Flow trước; WebGL renderer chỉ nên là lựa chọn sau khi dữ liệu thực tế cho thấy cần. Không coi visible-only là thay thế cho giảm dữ liệu/layout.

## 4. Live updates và lớp overlay

- `packages/web/src/api/ws.ts` cung cấp một WebSocket client dùng chung tới `/api/v1/ws`; `subscribeTopic(topic, listener)` ref-count theo topic, kết nối khi có subscriber đầu tiên, gửi subscribe/unsubscribe và trả callback unsubscribe. Hook phải trả unsubscribe trong `useEffect` cleanup. Server `packages/work/src/server/ws.ts` (`registerTopic`) start publisher khi số subscriber tăng từ 0 và dừng ở 0; subscriber mới nhận snapshot.
- Đây khác với `packages/web/src/api/global-events.tsx`: `GlobalEventsProvider` mở một EventSource SSE dùng chung tới workspace events, được mount ở `app.tsx`; sự kiện run được gắn project scope, lọc theo project đang mở và cập nhật/reconcile TanStack Query cache. Không tạo một SSE/WebSocket connection riêng cho graph.
- Có thể thêm topic project-scoped, ví dụ một `project-graph:<projectId>` topic, với payload version/revision và ID các node bị tác động. Đây là đề xuất, chưa có topic graph trong repo. Dùng chung socket, validate payload ở contract boundary, chỉ publish khi đổi dữ liệu, và để producer demand-driven. Tránh một topic/connection cho mỗi node.
- SSE run events cho biết run status/activity, nhưng repo chưa có topic sự kiện “file đang được worker sửa”. `useRunChanges(id, live)` poll thay đổi run mỗi 4 giây khi live; `useRunGitStatus()` poll 10 giây; `useRunTree()` lấy tree/path. Các nguồn này có thể tô overlay các file thay đổi sau khi diff hiện ra. Đèn “đang sửa ngay lúc này” cần một tín hiệu mới từ runner/file watcher hoặc event khác, không thể suy ra chắc chắn chỉ từ diff đã ghi.
- `task-thread`, `task-workspace` và Git/Changes views hiện dùng run stream cùng hook changes/status. Có thể ánh xạ path trong `ChangesPayload`/repo tree sang file node và giữ runId làm overlay provenance. Các path là worktree/repo-relative, nên cần quy tắc normalize và chuyển path giữa project root với worktree trước khi nối graph.

## 5. Data fetching, query cache và trạng thái UI

`packages/web/src/api/queries.ts` đóng gói TanStack Query hooks và query keys; `query-client.ts` định nghĩa defaults chung (stale time, retry theo loại lỗi). `packages/web/src/api/client.ts` là wrapper HTTP/Hono typed client, dùng `apiPath()` và `queryScope()`; schema và type dùng trong client được re-export qua `packages/api-client`/`packages/contract`, không viết payload riêng không kiểm tra ở component. Route mới nên thêm contract schema + endpoint/client hook theo cấu trúc packages hiện tại trước khi render dữ liệu.

Các hook graph-neighbor/impact nên có query key chứa project ID, ref/hash graph và tham số query (node, depth, edge kinds, budget) để không trộn cache giữa project hoặc revision. Graph view cần phân biệt loading, empty (chưa index/graph rỗng), stale/indexing, error và partial/truncated. Mẫu UI là `CenteredState` cùng các loading/error view riêng; không để lỗi query thành canvas trống. `useRunChanges`, `useRunGitStatus`, `useRunTree`, `useRepoTree` là nguồn gần nhất cho dữ liệu file/run đang có (`packages/web/src/api/queries.ts`).

## 6. UI system, themes, accessibility, i18n và keyboard

- UI primitives ở `packages/web/src/components/ui/` (Button, Card, Dialog, Sheet, Tabs, Switch, Command, Skeleton, v.v.); styles/token trong `packages/web/src/styles/index.css`, Tailwind v4 CSS-first và theme variables. Dùng token `background`, `card`, `foreground`, `muted`, `border`, `ring`, status; tránh màu raw.
- Theme lưu dark/light/system; mặc định dark (`packages/web/src/lib/theme.ts`, `components/theme-provider.tsx`). Token stylesheet chuyển theme qua class `.light`/theme state; không dựa vào utility `dark:`.
- `packages/web/src/design-guardian.test.ts` kiểm soát một số vi phạm thiết kế: raw hex/màu trắng-đen, amber text chưa qua token tương phản, native confirm/alert/prompt, `dark:` variants, viewport height thay cho `100dvh`, focus state cho native select. Design record `.ai/specs/2026-07-14-cockpit-ui-redesign.md` § Accessibility yêu cầu focus-visible, aria-label cho icon button, reduced-motion fallback và WCAG AA; cùng spec là nguồn chính cho mobile-first, token/theme và `CenteredState`. Nghiên cứu nền ở `.ai/analysis/cockpit-ui-redesign/` (gồm `onni-code-map.md`, `protocol-rationale-and-performance.md`, `agent-desktop-apps-ux.md`).
- UI source strings là tiếng Anh làm key; `t()` trả English mặc định, Vietnamese lookup theo map và fallback English (`packages/web/src/lib/i18n/messages.ts`). Bản dịch phân khu trong `vi-*.ts`, gồm `vi-shell.ts`, `vi-content.ts`, `vi-tasks.ts`, `vi-settings.ts`, `vi-automations.ts`. Text mới cần vào i18n, tránh hard-code chỉ trong view.
- `NAV_ITEMS` xuất hiện trong palette Views; palette mở bằng `Mod+K` (`command-palette.tsx`). Các shortcut cụ thể khác đi qua `lib/keybindings.ts`, `use-command-shortcut.ts` và Settings → Keyboard (`keyboard-section.tsx`). View mới được nav đăng ký tự động vào nhóm Views; shortcut riêng chỉ cần nếu có thao tác phổ biến và phải được đưa vào registry/settings.

## 7. Tích hợp với task, settings, dashboard

### Chọn node và bắt đầu task

Graph node selection có thể dùng `FloatingPanel` đang dùng ở workflow/task/activity graphs để hiện path, loại node, provenance, inbound/outbound links, tests và run overlays. Với “Start task here”, `packages/web/src/routes/new-task-params.ts` có query prefill `{skill, ref, todo}`; `newTaskPrefillHref()` build `/new?...`, và `ref` được parse thành task text (`task` là alias cũ). Không có field hiện tại cho danh sách scope paths.

`packages/web/src/routes/new-task-draft.ts` (`NewTaskDraft`) lưu text, source, runner, model, worktree, autonomous/dispatch và các cài đặt composer trong localStorage với key theo project (`onni-new-task-draft:<projectId>`). Draft không có node/path scope. Hỗ trợ list scope sẽ cần field mới trong draft/query hoặc state transfer riêng, validation/normalization và cách chống URL phình. `CreateRunInput` hiện nhận prompt/options, không phải một danh sách graph constraint. Đây là kết luận từ `new-task-params.ts`, `new-task-draft.ts`, composer và contract `packages/contract/src/runs.ts`; cần chốt liệu scope là context gợi ý trong prompt hay giới hạn có cấu trúc do backend enforce.

### Run impact overlay, settings và dashboard

- Lấy changed files từ `useRunChanges()` và task Files/Changes views; map path sang file nodes để làm overlay theo run. `useRunGitStatus()` và `useRunTree()` bổ sung tình trạng worktree. Polling hiện tại phù hợp cho “đã thay đổi”; màu “đang được sửa” cần transport/event mới như mục 4.
- Settings khai báo trong `packages/web/src/routes/settings/registry.tsx` với `scope: 'project' | 'global'`. `ProjectGeneral` hiện là nơi có thiết lập mô tả project/config; một công tắc opt-in AI summary theo repo có thể nằm tại Project General nếu chỉ có một cài đặt. Nếu Project Graph có nhiều control, tạo section project-scoped riêng. Đây là đề xuất vị trí, chưa có switch graph hiện tại. Việc OFF-by-default cần được enforce trong engine/config, không chỉ ẩn UI; AI summary phải có nhãn rõ ràng.
- Dashboard ở `/dashboard` dùng `DashboardLayout`, module/order preferences (`routes/dashboard/index.tsx`) và `Overview`/Projects card (`routes/dashboard/overview.tsx`). Có thể thêm summary card nhẹ (node count, stale/index state, changed nodes) deep-link tới project view; full interactive graph trong dashboard là inference kém hợp lý vì view nặng và dashboard toàn-workspace.

## 8. Test conventions

Web unit/component tests dùng Vitest + Testing Library, đặt cạnh module (`*.test.ts`/`*.test.tsx`); ví dụ `lib/activity-graph.test.ts`, `routes/workflow-graph/activity-graph.test.tsx`, `workflow-graph.test.ts`, `routes/automations/automations-list.test.tsx` và `automations-table.test.tsx`. Test thuần model nên xác minh builder/edge provenance/layout/collapse/filter; render tests nên kiểm tra loading/empty/error, project scope, keyboard, theme tokens và node select/action. Không thêm `.skip`/`.only`; `AGENTS.md` cấm.

Browser suite nằm trong `packages/web/e2e/`; `.ai/scripts/e2e.sh` khởi app qua test-env và chạy e2e với agent-browser. Nếu có browser provider, thêm flow deep-link project, select node → panel, “start task here”, overlay và viewport/keyboard behavior. Exit `TEST_E2E_STATUS=skipped` nghĩa là provider chưa có, không phải pass (`AGENTS.md`, test-env scripts). Suite Vitest/unit phải giữ browser-free.

## 9. Tác động desktop (Tauri)

Không thấy UI graph thứ hai trong `packages/desktop/ui`; đó là splash/loading frontend (`ui/index.html`). Tauri shell stage engine và built web assets qua `packages/desktop/scripts/stage-engine.mjs`, chạy local service sidecar, rồi WebView tải cockpit. Do đó route/canvas trong `packages/web` dùng chung với desktop khi build/copy asset; không cần triển khai riêng ở splash UI. Nguồn: `packages/desktop/src-tauri/tauri.conf.json` (`frontendDist`), `packages/desktop/src-tauri/src/lib.rs` (sidecar), `packages/desktop/scripts/stage-engine.mjs`, `AGENTS.md` (desktop là Tauri shell).

Nếu chọn renderer có WebGL/WASM, cần kiểm tra khả năng khởi tạo, accessibility/keyboard và fallback trong WebView đóng gói. Đây là rủi ro kỹ thuật cần kiểm chứng trên desktop, không phải hành vi đã đo.

## Risks and open questions for the plan

- Graph repository chưa có contract/API/index builder hay topic live; schema và provenance semantics cần chốt trước UI.
- Dữ liệu toàn repo có thể quá lớn cho client layout; cần corpus benchmark và quyết định neighborhood/aggregation/viewport loading.
- React Flow/Dagre không công bố hard cap đã kiểm chứng; không thể đặt ngưỡng node đáng tin cậy từ tài liệu.
- Sigma nêu hàng chục nghìn node/edge nhưng hiệu năng và interaction thực tế cần benchmark trong cockpit/WebView.
- “Worker đang sửa file” chưa có tín hiệu live đáng tin; run diff hiện tại chỉ chứng minh file thay đổi sau khi có diff/status.
- Query snapshot và live update có thể đua nhau; cần revision/hash và cách reconcile cache.
- Scope paths trong “start task here” chưa có cơ chế structured, query list dài không phù hợp để nhét tùy tiện vào URL.
- Cần quyết định AI summary lưu ở đâu, invalidation theo content hash nào, và cách hiện provenance AI-written; OFF-by-default phải được enforce phía server/engine.
- Path normalization giữa repo root và task worktree quan trọng cho impact overlay và graph-to-task link.
- Tài liệu/comment ONNI_AUTOMATIONS không đồng nhất với code mặc định hiện tại; làm rõ comment ở công việc riêng nếu cần, không trộn vào feature graph.
- Bundle size hiện tại chưa kiểm vì `packages/work/web/dist` không tồn tại trong worktree; cần build đo chunk khi implementation sẵn sàng.
- WebView WebGL/WASM fallback và keyboard/accessibility cần được QA trên Tauri Windows, không suy ra từ browser tests.

## Reusable building blocks

- Routing/scope: `packages/web/src/routes.tsx` (`lazyRoute`, `ProjectScopeRoute`, `PAGE_TITLE_ROUTES`), `components/nav-items.ts` (`NAV_ITEMS`, `visibleNavItems`), `components/app-shell.tsx`, `components/command-palette.tsx`, `lib/project-router.tsx`, `packages/api-client/src/utils/project-scope.ts`.
- Canvas patterns: `routes/workflow-graph/workflow-graph.tsx` (`FloatingPanel`), `task-graph.tsx`, `activity-graph.tsx` (`ActivityCard`, `onlyRenderVisibleElements`), `graph-node.tsx` (`GraphNodeView`, `LaneEdge`), `lib/workflow-graph.ts` (`autoLayout`, `runOverlay`), `lib/activity-graph.ts` (`buildActivityGraph`).
- Fetch/live: `packages/web/src/api/queries.ts` (`useRunChanges`, `useRunGitStatus`, `useRunTree`, `useRepoTree`), `api/client.ts`, `api/ws.ts` (`subscribeTopic`), `api/global-events.tsx` (`GlobalEventsProvider`), `packages/work/src/server/ws.ts` (`registerTopic`).
- Task integration: `routes/new-task-params.ts` (`newTaskPrefillHref`), `routes/new-task-draft.ts` (`NewTaskDraft`), `routes/task-workspace.tsx`, task-thread Changes/Files hooks.
- UI/testing: `components/ui/*`, `CenteredState`, `lib/i18n/messages.ts`, `src/design-guardian.test.ts`, colocated `*.test.tsx` patterns and `packages/web/e2e/`.
- Settings/dashboard/desktop: `routes/settings/registry.tsx` (`SETTINGS_SECTIONS`), `routes/settings/project-general.tsx` (`ProjectGeneral`), `routes/dashboard/index.tsx` (`DashboardLayout`), `packages/desktop/scripts/stage-engine.mjs`.
