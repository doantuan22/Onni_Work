# Kế hoạch tách `server.ts` theo route family

> **Trạng thái (2026-11-09): đã làm xong cả 37 family.** `server.ts` còn 2.634 dòng (từ 8.479); mỗi
> family là một factory trong `packages/work/src/server/routes/`, mount ở đúng vị trí cũ trong chuỗi
> `v1`/`workspaceV1`. Guard theo đường dẫn (`requireDispatch`, `requireAutomations`, body cap) đi
> cùng family của nó; route `/runs/archive-finished` và `/runs/read-all` vẫn đứng trước `/runs/:id`;
> nút huỷ của cockpit (`POST /runs/:id/cancel`, family runs) tách riêng với `/worker-cancel` của
> manager (family dispatch, mount trước). Bản đồ dòng bên dưới là trạng thái TRƯỚC khi tách, giữ
> lại làm lịch sử.

Kế hoạch này dùng line number hiện tại của `packages/work/src/server/server.ts` trên nhánh `onni/2e572630` (đối chiếu `rg -n` ngày 2026-11-07). Khoảng dòng của mỗi builder chỉ tính từ khai báo `const ...Routes` tới dấu `;` kết thúc chuỗi Hono; phần khởi tạo state và helper dùng chung được ghi riêng. Một route là một lời gọi Hono có method và path literal; `.use()` không tính là route.

Mục tiêu là tách từng family thành module riêng, mỗi lần một thay đổi hành vi không đổi. Giữ nguyên path, validator, middleware, thứ tự đăng ký, response và kiểu trả về suy luận. Đây là một nhánh của D1 trong [`manager-worker-proposals.md`](./manager-worker-proposals.md#d1-tách-runts-10144-dòng-và-serverts-8422-dòng), nơi khuyến nghị tách dần qua các PR nhỏ vì `server.ts` là file nóng.

## 1. Bản đồ `server.ts`

### Cách chia scope và cách mount

- `ServerDeps` nằm ở `server.ts:336-430`; `ProjectApiEnv`/`ProjectContext` ở `server.ts:456` và `project-context.ts`. `createApp` bắt đầu ở `server.ts:1357`.
- Context của project được phân giải tại `server.ts:1764-1794`. Bảng project `v1` dùng `.use('*', resolveProjectScope)` đầu tiên ở `server.ts:7845-7846`; handler lấy đúng project bằng `c.get('project')`, không dùng nhầm `bootRoot`/`bootStore`.
- Bảng project được lắp một lần từ các family ở `server.ts:7845-7873`, rồi mount tại hai tiền tố: `/api/v1/p/:projectId` (`V1_SCOPED_PREFIX`, khai báo ở `server.ts:641`) và `/api/v1` (`V1_PREFIX`, `server.ts:637`) ở `server.ts:8113-8114`. Mount `/api/v1` là alias project khởi động. Cả ba cách gọi — alias, `/p/<boot-id>` và `/p/default` — phải giữ cùng handler và câu trả lời; `route-parity.test.ts` kiểm tra manifest thật và byte parity.
- Bảng workspace được lắp tại `server.ts:8086-8100` và chỉ mount ở `/api/v1` tại `server.ts:8115`. Các route workspace không được mirror dưới `/p/:projectId`.
- `/api/v1/health` có middleware CORS riêng tại `server.ts:1881`. Workspace table phải mount **sau** project table: mount project mang theo `use('*')` của project scope; đặt workspace trước sẽ đưa `/health` qua resolver project và phá route discovery.
- Hai mount point của project table không phải hai implementation. `route-parity.test.ts` so sánh ba spelling bằng `projectRouteManifest` (được rút từ các đăng ký thật); workspace route được kiểm tra một lần trên `/api/v1`.

Ký hiệu trong bảng:

- **P** — project từ `c.get('project')`: `id`, `root`, `dataDir`, `store`, `manager`, `launchKey` và automation store; được gắn bởi `resolveProjectScope`.
- **W** — state/closure cấp workspace trong `createApp`, gồm `deps`, registry, `contexts`, `workspaceEvents` và `capabilities()`; family chỉ nhận đúng phần cần dùng.
- Các test `route-parity.test.ts` áp dụng cho family trong project table; nó không kiểm tra parity cho workspace-only routes. `versioned-surface.test.ts` kiểm tra các HTTP route đều nằm trong `/api/v1`; `typed-bodies.test.ts` là kiểm tra kiểu compile-time cho JSON body. Sau mỗi lần tách, chạy thêm test schema tương ứng trong cột và `npm run typecheck`.

### Builder trong `server.ts`

| Family | Dòng builder | Route | Closure/dependency chính | Test bao phủ |
|---|---:|---:|---|---|
| `healthRoutes` (workspace) | 2000 | 1 | `readHealth` (cache/refresh ở 1932-1992), `deps.socketHub`; việc đăng ký topic health/host vẫn ở `createApp` (2010-2044). | `health-topic.test.ts`, `health-forge.test.ts` |
| `modelsRoutes` (workspace) | 2079-2086 | 1 | `modelCatalog` tạo từ `deps.modelCatalog`/runner adapters. | `models-api.test.ts`, `contract-parity.workspace.test.ts` |
| `providersRoutes` (workspace) | 2179-2333 | 5 | `providerAuth`, `providerRuntimeAuth`, `workspaceEvents`, `watchOpenedLogin`, `resolveWorkspaceProfile`, `handoffEnv`, capability gates và các thao tác đăng nhập từ `deps`. | `providers-api.test.ts`, `provider-action-gating.test.ts`, `provider-action-gate.test.ts`, `provider-auth-runtime.test.ts`, `contract-parity.workspace.test.ts` |
| `agentProfilesRoutes` (workspace) | 2488-2846 | 8 | `loadAgentAccounts`, `agentAccountsEnabled`, provider auth/status, profile selection, local app handoff và các adapter `deps`. | `agent-profiles-api.test.ts`, `contract-parity.workspace.test.ts` |
| `projectsRoutes` (workspace) | 2874-3173 | 7 | Registry/config workspace, `contexts`, `workspaceEvents`, capability checks, checkout/clone adapters trong `deps`. | `projects-api.test.ts`, `create-project.test.ts`, `checkout.test.ts`, `contract-parity.workspace.test.ts` |
| `previewRoutes` (workspace) | 3354-3362 | 1 | Design proxy adapter trong `deps`/helper preview; validator body. | `design-proxy-api.test.ts`, `preview/design-proxy.test.ts`, `contract-parity.workspace.test.ts` |
| `workspaceConfigRoutes` (workspace) | 3433-3650 | 12 | `capabilities()`, project managers/`contexts`, host sampler, config/branding/upload helpers; `.use()` giới hạn body cho branding và UI state. | `workspace-api.test.ts`, `usage-scope.test.ts`, `ui-state-api.test.ts`, `contract-parity.workspace.test.ts` |
| `fsBrowseRoutes` (workspace) | 3656-3677 | 1 | Browser filesystem/query helper và capability gate; không cần scope project. | `fs-browse.test.ts`, `fs-browse-privacy.test.ts`, `contract-parity.workspace.test.ts` |
| `launchKeyRoutes` (project) | 3680-3681 | 1 | P.`launchKey`. | `route-parity.test.ts`, `project-context.test.ts` |
| `skillsRoutes` (project) | 3684-3715 | 3 | P.`root`/`dataDir`, skill catalog/import/refresh helpers và registry từ `deps`. | `org-skills-repos-api.test.ts`, `contract-parity.workflows.test.ts` |
| `uiStateRoutes` (project) | 3718-3738 | 2 | P.`dataDir`; `UI_STATE_BODY_LIMIT` middleware. | `ui-state-api.test.ts`, `ui-state.test.ts`, `contract-parity.workflows.test.ts` |
| `workflowsRoutes` (project) | 3744-3882 | 7 | P.`root`; workflow loading/validation/graph helpers và runner metadata. | `workflows-graph-api.test.ts`, `contract-parity.workflows.test.ts` |
| `planRoutes` (project) | 3885-3892 | 1 | `planChain`, P.`root`, provider/model capability checks. | `provider-action-gating.test.ts`, `request-validation.test.ts`, `contract-parity.workflows.test.ts` |
| `automationsRoutes` (project) | 4038-4509 | 14 | `requireAutomations` (4028-4036), `armAutomation`, `trackerTriggerIssue`, `scheduleHandle`, manual-check state, automation store, launch callbacks và `automationsChanged`. | `automations-api.test.ts`, `automations-gate.test.ts`, `deferred-start-api.test.ts`, `contract-parity.automations.test.ts`, `contract-parity.deferred-start.test.ts` |
| `automationChecksRoutes` (workspace) | 4515-4530 | 2 | Cùng `requireAutomations`; workspace check/template stores. Giữ route guard tường minh. | `automations-api.test.ts`, `automations-gate.test.ts`, `contract-parity.automations.test.ts` |
| `dispatchRoutes` (project) | 4549-4697 | 14 | `requireDispatch` (4540-4543), P.`manager`/`store`, tree plan/merge/peek/verify helpers và `capabilities()`. | `dispatch-api.test.ts`, `manager-worker-api.test.ts`, `roster-api.test.ts`, `contract-parity.dispatch.test.ts`, `deferred-dispatch-contract.test.ts` |
| `memoryRoutes` (project) | 4702-4725 | 3 | `requireDispatch` cho route memory của run; P.`manager`/`dataDir`; manager-memory file helpers. GET/PUT cài đặt vẫn dùng được khi dispatch tắt. | `manager-worker-api.test.ts`, `contract-parity.dispatch.test.ts` |
| `runsRoutes` (project) | 4790-5848 | 39 | P.`store`/`manager`/`root`/`dataDir`; `stopTaskProcesses`, `deleteRunFully`, `legacyWorktreeMutation`, repo sync, PR/ref-status và capability/provider helpers. Đây là builder lớn nhất và kết nối nhiều hành vi. | `contract-parity.runs.test.ts`, `start-run.test.ts`, `continue-run.test.ts`, `patch-run.test.ts`, `queued-messages.test.ts`, `read-run.test.ts`, `runs-list-slim.test.ts`, `start-now-api.test.ts`, `auto-resume-api.test.ts`, `project-data-api.test.ts` |
| `layoutRoutes` (project) | 5879-5903 | 2 | P.`dataDir`/`store`; `readRunLayouts`/`writeRunLayouts`. | `workspace-api.test.ts`, `route-parity.test.ts` |
| `draftRoutes` (project) | 5905-5997 | 6 | P.`dataDir`/`store`; file helpers trong `runs/drafts.ts`; validators `:surface` trước mọi handler chạm filesystem. | `drafts-api.test.ts`, `contract-parity.drafts.test.ts` |
| `groupsRoutes` (project) | 6008-6107 | 2 | P.`store`/`manager`, group selection/pick helper. | `group-pick.test.ts`, `contract-parity.workflows.test.ts` |
| `openTargetsRoutes` (project) | 6110-6139 | 2 | P.`root`; open-target/terminal handoff adapters từ `deps`. | `open-in-project.test.ts`, `open-in-terminal.test.ts`, `open-in-app.test.ts`, `open-in-file.test.ts` |
| `worktreesRoutes` (project) | 6190-6222 | 2 | P.`manager`/`store`; reclaim/worktree ownership helpers. | `worktrees-api.test.ts`, `worktree-lifecycle.test.ts`, `contract-parity.lifecycle.test.ts` |
| `todosRoutes` (project) | 6248-6325 | 3 | P.`store`/`manager`; follow-up availability và start helper. | `todos-start.test.ts`, `start-run-todo.test.ts`, `contract-parity.workflows.test.ts` |
| `sseRoutes` (project) | 6328-6457 | 2 | P.`store`; run event replay/subscription, `streamSSE` và header helpers. | `sse-subscriptions.test.ts`, `sse-headers.test.ts`, `run-events-replay.test.ts`, `run-events-replay-abort.test.ts` |
| `workspaceEventsRoutes` (project table) | 6460-6575 | 1 | `workspaceEvents` bus; `/workspace/events` là path trong project table nên alias vẫn phải giữ nguyên. | `workspace-events.test.ts`, `sse-subscriptions.test.ts`, `route-parity.test.ts` |
| `secretsRoutes` (project) | 6651-6669 | 3 | P.`dataDir`; project secret store/helpers. | `secrets-api.test.ts`, `contract-parity.secrets.test.ts` |
| `e2eRoutes` (project) | 6683-6719 | 2 | P.`root`/`manager`; setup/e2e helpers. | `e2e-setup-api.test.ts`, `contract-parity.e2e.test.ts` |
| `workspaceSecretsRoutes` (workspace) | 6724-6735 | 3 | Workspace secret store/helpers; không dùng P. | `secrets-api.test.ts`, `contract-parity.secrets.test.ts` |
| `trackerRoutes` (project) | 6737-6852 | 14 | `trackers`, `trackerWatches`, P.`root`/`dataDir`, `workspaceEvents`, association/connection helpers. | `tracker-api.test.ts`, `tracker-read-scope-api.test.ts`, `tracker-automations-api.test.ts`, `contract-parity-tracker.test.ts` |
| `githubRoutes` (project) | 6854-7010 | 8 | P.`root`; forge/GitHub service, checks/comments/search/merge and ref-status cache invalidation helpers. | `github-comments-api.test.ts`, `github-checks-api.test.ts`, `github-search-api.test.ts`, `github-ref-status-api.test.ts`, `github-merge-api.test.ts`, `github-pr-changes-api.test.ts`, `contract-parity.github.test.ts` |
| `repoRoutes` (project) | 7048-7257 | 12 | P.`root`/`store`; git tree/diff/file helpers, repo sync actions, worktree/branch conflict checks. | `repo-files-api.test.ts`, `repo-sync.test.ts`, `git-changes.test.ts`, `contract-parity.github.test.ts` |
| `configRoutes` (project) | 7324-7472 | 2 | P.`root`/`dataDir`; config read and locked `mergeWriteWorkspaceConfig` helper. | `config-api.test.ts`, `contract-parity.workspace.test.ts` |
| `agentConfigRoutes` (project) | 7489-7535 | 3 | P.`root`; safe agent config file discovery/read/write/version helpers. | `agent-config-api.test.ts`, `contract-parity.workflows.test.ts` |
| `terminalRoutes` (project) | 7608-7753 | 10 | P.`manager`/`store`/`root`; `terminalSessions`, `stopTaskProcesses`, session ownership/output helpers and socket-topic registration (7544-7607). | `terminal-routes.test.ts`, `terminal/lifecycle-routes.test.ts`, `terminal/sessions.test.ts`, `terminal/process-tree.test.ts` |
| `projectTerminalRoutes` (project) | 7765-7843 | 6 | P.`id`; shared terminal session registry and project owner/lookup helpers. | `project-terminal-routes.test.ts`, `terminal/sessions.test.ts` |
| `runsIndexRoutes` (workspace) | 7983-8043 | 1 | Registry/project contexts, run-index disk reader, ref-status cache, `RUNS_INDEX_PER_PROJECT`. | `runs-index-api.test.ts` |

### Family đã có module riêng và phần không thuộc bảng HTTP

Ba family được mount trong `createApp` nhưng implementation chain đã nằm ngoài `server.ts`; dùng chúng làm mẫu thay vì tách lại:

| Family | Builder/mount hiện tại | Route | Dependency | Test |
|---|---|---:|---|---|
| Webhooks | `createWebhookRoutes` tạo ở `server.ts:1600`, mount project table tại `7853`; chain ở `webhooks.ts:14` | 16 | Factory nhận resolver `ProjectContext -> WebhookService`; middleware và handler ở module. | `webhooks.test.ts`, `webhooks-loopback.test.ts`, `single-project-webhooks.test.ts`, `contract-parity.webhooks.test.ts` |
| Worktree lifecycle | mount tại `server.ts:7862`; factory ở `worktree-lifecycle.ts:21` | 7 | `stopTaskProcesses` được truyền vào factory; handlers dùng P.`manager.lifecycle`. | `worktree-lifecycle.test.ts`, `contract-parity.lifecycle.test.ts` |
| Dashboard | mount tại `server.ts:8098`; factory ở `dashboard.ts:22` | 8 | `DashboardReader`, policy về cost/tokens và closure capability automations. | `dashboard-api.test.ts`, `dashboard-costs-api.test.ts`, `dashboard-contract.test.ts`, `contract-parity.dashboard.test.ts` |

`/api/v1/ws` không phải route Hono và không nằm trong `AppType`: `WS_PATH` là `ws.ts:30`; `startServer` gắn upgrade listener bằng `socketHub.attach` tại `server.ts:8276`, còn `verifyWsUpgrade` bắt đầu tại `server.ts:8328`. Các topic được đăng ký trong `createApp` (health/host ở 2010-2044; terminal ở 7544-7607). Giữ topic, trust guard và attach lifecycle riêng; kiểm bằng `ws.test.ts`, `health-topic.test.ts`, `host-topic.test.ts` và test terminal/SSE tương ứng.

Các route phục vụ UI không phải API family: static/assets/icon handlers nằm khoảng `server.ts:1796-1864`, middleware global ở `1648-1751`, health CORS ở `1881`, SPA catch-all ở `8125`. Để nguyên trong `server.ts` khi tách API.

## 2. Mẫu tách giữ suy luận kiểu Hono

Mỗi module định nghĩa một `Env`/`ProjectApiEnv` cục bộ hoặc import type dùng chung, nhận đúng closure cần thiết qua dependency object và trả trực tiếp chuỗi Hono. Không ghi `: Hono`/`Promise<Hono>` cho giá trị trả về, không chuyển các `.get()` thành câu lệnh rời. Validator tiếp tục là middleware đứng trước handler.

```ts
// packages/work/src/server/routes/example.ts
import { Hono } from 'hono';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator } from '../validators.ts';

type Env = { Variables: { project: ProjectContext } };

export function exampleRoutes(deps: { save: (project: ProjectContext, value: Value) => Promise<Result> }) {
  return new Hono<Env>()
    .post('/example', jsonZodValidator(exampleInputSchema), async (c) => {
      const result = await deps.save(c.get('project'), c.req.valid('json'));
      return c.json(result);
    });
}
```

Trong `createApp`, giữ nguyên callback/service hiện có rồi chuyền vào factory; thêm factory vào đúng vị trí của family cũ trong biểu thức `v1`/`workspaceV1`:

```ts
const example = exampleRoutes({ save: existingSaveClosure });
const v1 = new Hono<ProjectApiEnv>()
  .use('*', resolveProjectScope)
  // ...các family hiện hữu giữ nguyên thứ tự...
  .route('/', example);
```

Mẫu đã dùng thật là `worktreeLifecycleRoutes` (`worktree-lifecycle.ts:21`): trả trực tiếp `new Hono<ProjectApiEnv>().get(...).post(...)`, truyền `stopTaskProcesses` qua options, rồi mount từ `createApp` ở `server.ts:7862`. Mẫu tương đương khác là `dashboardRoutes` (`dashboard.ts:22`) và `createWebhookRoutes` (`webhooks.ts:14`). Đây là bằng chứng rằng family ở module khác vẫn giữ route type khi factory trả chuỗi Hono có kiểu suy luận.

Luồng kiểu hiện tại: `createApp` trả về `routed` không annotation tại `server.ts:1353-1357, 8111-8127`; `AppType` là `ReturnType<typeof createApp>` tại `app-type.ts:22`. `createOnniClient<AppType>()` gọi `hc<T>` tại `api-client/src/client.ts:55-62`, và cockpit dùng generic đó tại `web/src/api/client.ts:303`. `typed-bodies.test.ts` kiểm tra body/query/param được suy luận, `versioned-surface.test.ts` bắt route API lọt ngoài `/api/v1`, còn `contract-parity*.test.ts` so sánh type của route với schema hai chiều. Do đó mỗi lần mount factory vào đúng chuỗi làm `AppType` nhận endpoint tự động; `new Hono()` bị annotate thành `Hono` chung hoặc gọi `.get()` rời sẽ làm mất route khỏi client dù server vẫn trả lời.

## 3. Rủi ro thứ tự middleware và đăng ký

1. **Middleware toàn app và route health.** `bodyLimit` chạy từ `app.use('*', ...)` ở `1648`; request-origin guard đăng ký tại `1684-1751`; health CORS đăng ký ở `1881`. Không đặt family nào trước middleware toàn app, không chuyển health ra sau project scope. Health là ngoại lệ CORS có chủ ý.
2. **Project scope là middleware của cả bảng.** `.use('*', resolveProjectScope)` ở `v1` (`7846`) phải đứng trước mọi family project. Các handlers cần dùng `c.get('project')`, tránh capture boot store/root từ `createApp`, nếu không route scoped sẽ đọc/ghi nhầm repo. Route workspace mount ở `8115` phải đứng sau hai mount project tại `8113-8114`.
3. **Dispatch gate phải đi trước các route manager.** `requireDispatch` được định nghĩa ở `4540-4543`. `dispatchRoutes` đăng ký `.use(path, requireDispatch)` cho `/dispatch`, `/report`, `/merge`, `/budget`, `/peek`, `/verify`, `/conflicts`, `/worker-message`, `/worker-cancel`, `/worker-redirect`, `/ask`, `/plan` và `/plan/parts/:partId` tại `4550-4562`, rồi mới chain endpoint từ `4566`. `memoryRoutes` cũng đặt `.use('/runs/:id/memory', requireDispatch)` trước route ở `4719`. Khi chuyển builder, để từng guard trong cùng router và trước route; không gom các guards thành một wildcard ở `v1`.
4. **Automation gate là guard theo đường dẫn rõ ràng.** `requireAutomations` ở `4028-4036`; `automationsRoutes` đăng ký guards cho `/automations`, `/automations/*`, `/automation-log` và con tại `4039-4042`; `automationChecksRoutes` guard `/automation-checks/*` và `/workspace/automation-templates` ở `4516-4517`. Giữ nguyên cả đường collection lẫn wildcard. Không dùng `.use('*')`: các router được `.route('/', ...)` ghép vào chung bảng và wildcard sẽ khóa nhầm API khác, kể cả health.
5. **Giới hạn body là middleware cục bộ cần giữ.** `workspaceConfigRoutes` có body cap cho branding/upload/UI state (`3576`, `3635`); `uiStateRoutes` có body cap riêng (`3722`). Giữ cap trước các route tương ứng và giữ cùng route prefix.
6. **Bulk runs trước `/:id`.** `runsRoutes` đăng ký `POST /runs/archive-finished` và `POST /runs/read-all` trước các route `/:id/...` (`4802-4815`) để các từ cố định không bị khớp như run id. `POST /runs/:id/unread` nằm sau và không có xung đột theo comment tại `4863-4866`. Không đảo thứ tự hoặc chia phần bulk sang sau phần dynamic.
7. **Manager actions khác với thao tác cockpit.** `POST /runs/:id/worker-cancel` là lệnh manager trong dispatch family (`4558`, `4580`) và chạy `cancelFor` trên cây; `POST /runs/:id/cancel` là nút cancel của cockpit trong runs family (`5048`) và chạy `manager.cancel`. Path, schema, authorization và response khác nhau. Không đổi tên/nhập hai route làm một. Dispatch family mount trước runs (`7854` so với `7856`); giữ thứ tự và giữ guard gắn với worker route.
8. **Thứ tự giữa các family cũng là thứ tự match.** Code ghi rõ ở `server.ts:7550-7554`: Hono giữ registration order. Khi trích family, chỉ thay mỗi builder bằng lời gọi factory tại đúng dòng mount cũ; không sắp xếp các `.route()` theo tên. Giữ thứ tự trong `workspaceV1` nữa, nhất là health đứng trước các workspace routes khác.
9. **WebSocket có guard riêng.** Không thêm Hono `GET /ws` để thay cho `socketHub.attach`. Giữ `verifyWsUpgrade`, trusted/untrusted, `loopbackReadable` của health và lifecycle cleanup theo `server.ts:8276-8354`/`ws.ts`; đường này không đi qua middleware HTTP hay `AppType`.

## 4. Thứ tự các phần tách

Mỗi phần dưới đây là một phạm vi cho một worker/PR: chuyển đúng builder và dependency riêng cần thiết vào một module mới, giữ path và vị trí đăng ký; thêm import và thay đúng một link `.route()` ở bảng hiện có. Các family đã có module riêng được ghi ở mục 1 và không phải phần tách mới. Kiểm tra bắt buộc sau mỗi phần: `npm run typecheck`, test tập trung nêu dưới, `npm test -- packages/work/src/server/route-parity.test.ts packages/work/src/server/versioned-surface.test.ts`, và chạy `typed-bodies.test.ts` khi có input/body mới hoặc đã chuyển validator. Thêm `contract-parity` liên quan nếu được nêu.

| # | Family (theo rủi ro tăng dần) | Dòng hiện tại | Module mới | Test tập trung |
|---:|---|---:|---|---|
| 1 | `modelsRoutes` | 2079-2086 | `packages/work/src/server/routes/models.ts` | `models-api.test.ts`, `contract-parity.workspace.test.ts` |
| 2 | `fsBrowseRoutes` | 3656-3677 | `.../routes/fs-browse.ts` | `fs-browse.test.ts`, `fs-browse-privacy.test.ts`, `contract-parity.workspace.test.ts` |
| 3 | `workspaceSecretsRoutes` | 6724-6735 | `.../routes/workspace-secrets.ts` | `secrets-api.test.ts`, `contract-parity.secrets.test.ts` |
| 4 | `previewRoutes` | 3354-3362 | `.../routes/preview.ts` | `design-proxy-api.test.ts`, `preview/design-proxy.test.ts`, `contract-parity.workspace.test.ts` |
| 5 | `healthRoutes` | 2000 | `.../routes/health.ts` | `health-topic.test.ts`, `health-forge.test.ts` |
| 6 | `launchKeyRoutes` | 3680-3681 | `.../routes/launch-key.ts` | `route-parity.test.ts`, `project-context.test.ts` |
| 7 | `skillsRoutes` | 3684-3715 | `.../routes/skills.ts` | `org-skills-repos-api.test.ts`, `contract-parity.workflows.test.ts` |
| 8 | `uiStateRoutes` | 3718-3738 | `.../routes/ui-state.ts` | `ui-state-api.test.ts`, `ui-state.test.ts`, `contract-parity.workflows.test.ts` |
| 9 | `secretsRoutes` | 6651-6669 | `.../routes/secrets.ts` | `secrets-api.test.ts`, `contract-parity.secrets.test.ts` |
| 10 | `e2eRoutes` | 6683-6719 | `.../routes/e2e.ts` | `e2e-setup-api.test.ts`, `contract-parity.e2e.test.ts` |
| 11 | `groupsRoutes` | 6008-6107 | `.../routes/groups.ts` | `group-pick.test.ts`, `contract-parity.workflows.test.ts` |
| 12 | `openTargetsRoutes` | 6110-6139 | `.../routes/open-targets.ts` | `open-in-project.test.ts`, `open-in-terminal.test.ts`, `open-in-app.test.ts`, `open-in-file.test.ts` |
| 13 | `todosRoutes` | 6248-6325 | `.../routes/todos.ts` | `todos-start.test.ts`, `start-run-todo.test.ts`, `contract-parity.workflows.test.ts` |
| 14 | `worktreesRoutes` | 6190-6222 | `.../routes/worktrees.ts` | `worktrees-api.test.ts`, `worktree-lifecycle.test.ts`, `contract-parity.lifecycle.test.ts` |
| 15 | `layoutRoutes` | 5879-5903 | `.../routes/layouts.ts` | `workspace-api.test.ts`, `route-parity.test.ts` |
| 16 | `draftRoutes` | 5905-5997 | `.../routes/drafts.ts` | `drafts-api.test.ts`, `contract-parity.drafts.test.ts` |
| 17 | `workflowsRoutes` | 3744-3882 | `.../routes/workflows.ts` | `workflows-graph-api.test.ts`, `contract-parity.workflows.test.ts` |
| 18 | `planRoutes` | 3885-3892 | `.../routes/plan.ts` | `provider-action-gating.test.ts`, `request-validation.test.ts`, `contract-parity.workflows.test.ts` |
| 19 | `configRoutes` | 7324-7472 | `.../routes/config.ts` | `config-api.test.ts`, `contract-parity.workspace.test.ts` |
| 20 | `agentConfigRoutes` | 7489-7535 | `.../routes/agent-config.ts` | `agent-config-api.test.ts`, `contract-parity.workflows.test.ts` |
| 21 | `sseRoutes` | 6328-6457 | `.../routes/sse.ts` | `sse-subscriptions.test.ts`, `sse-headers.test.ts`, `run-events-replay.test.ts`, `run-events-replay-abort.test.ts` |
| 22 | `workspaceEventsRoutes` | 6460-6575 | `.../routes/workspace-events.ts` | `workspace-events.test.ts`, `sse-subscriptions.test.ts` |
| 23 | `providersRoutes` | 2179-2333 | `.../routes/providers.ts` | `providers-api.test.ts`, `provider-action-gating.test.ts`, `provider-action-gate.test.ts`, `provider-auth-runtime.test.ts`, `contract-parity.workspace.test.ts` |
| 24 | `agentProfilesRoutes` | 2488-2846 | `.../routes/agent-profiles.ts` | `agent-profiles-api.test.ts`, `contract-parity.workspace.test.ts` |
| 25 | `projectsRoutes` | 2874-3173 | `.../routes/projects.ts` | `projects-api.test.ts`, `create-project.test.ts`, `checkout.test.ts`, `contract-parity.workspace.test.ts` |
| 26 | `workspaceConfigRoutes` | 3433-3650 | `.../routes/workspace-config.ts` | `workspace-api.test.ts`, `usage-scope.test.ts`, `ui-state-api.test.ts`, `contract-parity.workspace.test.ts` |
| 27 | `runsIndexRoutes` | 7983-8043 | `.../routes/runs-index.ts` | `runs-index-api.test.ts` |
| 28 | `trackerRoutes` | 6737-6852 | `.../routes/tracker.ts` | `tracker-api.test.ts`, `tracker-read-scope-api.test.ts`, `tracker-automations-api.test.ts`, `contract-parity-tracker.test.ts` |
| 29 | `githubRoutes` | 6854-7010 | `.../routes/github.ts` | `github-comments-api.test.ts`, `github-checks-api.test.ts`, `github-search-api.test.ts`, `github-ref-status-api.test.ts`, `github-merge-api.test.ts`, `github-pr-changes-api.test.ts`, `contract-parity.github.test.ts` |
| 30 | `repoRoutes` | 7048-7257 | `.../routes/repo.ts` | `repo-files-api.test.ts`, `repo-sync.test.ts`, `git-changes.test.ts`, `contract-parity.github.test.ts` |
| 31 | `automationChecksRoutes` | 4515-4530 | `.../routes/automation-checks.ts` | `automations-api.test.ts`, `automations-gate.test.ts`, `contract-parity.automations.test.ts` |
| 32 | `automationsRoutes` | 4038-4509 | `.../routes/automations.ts` | `automations-api.test.ts`, `automations-gate.test.ts`, `deferred-start-api.test.ts`, `contract-parity.automations.test.ts`, `contract-parity.deferred-start.test.ts` |
| 33 | `dispatchRoutes` | 4549-4697 | `.../routes/dispatch.ts` | `dispatch-api.test.ts`, `manager-worker-api.test.ts`, `roster-api.test.ts`, `contract-parity.dispatch.test.ts`, `deferred-dispatch-contract.test.ts` |
| 34 | `memoryRoutes` | 4702-4725 | `.../routes/memory.ts` | `manager-worker-api.test.ts`, `contract-parity.dispatch.test.ts` |
| 35 | `terminalRoutes` + helper/topic block | 7544-7753 | `.../routes/terminal.ts` | `terminal-routes.test.ts`, `terminal/lifecycle-routes.test.ts`, `terminal/sessions.test.ts`, `terminal/process-tree.test.ts` |
| 36 | `projectTerminalRoutes` | 7765-7843 | `.../routes/project-terminal.ts` | `project-terminal-routes.test.ts`, `terminal/sessions.test.ts` |
| 37 | `runsRoutes` | 4790-5848 | `.../routes/runs.ts` | `contract-parity.runs.test.ts`, `start-run.test.ts`, `continue-run.test.ts`, `patch-run.test.ts`, `queued-messages.test.ts`, `read-run.test.ts`, `runs-list-slim.test.ts`, `start-now-api.test.ts`, `auto-resume-api.test.ts`, `project-data-api.test.ts` |

### Các cặp/nhóm có thể làm song song

Trong mỗi batch sau, **mọi cặp phần tử trong cùng batch đều có thể chạy song song**: source range và file mới tách biệt; mỗi worker chỉ thêm import riêng và sửa đúng link `.route()` riêng ở bảng mount. Không format lại cả biểu thức `v1`/`workspaceV1`. Mọi family vẫn được thay ở vị trí mount cũ, nên parallel không đồng nghĩa với đổi registration order.

- **Batch A:** #1, #2, #3, #4, #5 (các family nhỏ của workspace).
- **Batch B:** #6, #7, #8, #9, #10 (các family project nhỏ).
- **Batch C:** #11, #12, #13, #14, #15, #16 (các family project độc lập).
- **Batch D:** #17, #18, #19, #20, #21, #22 (workflow/settings/event streams).
- **Batch E:** #23, #24, #25, #26, #27 (các family workspace; giữ provider/registry singleton trong `createApp`, truyền cùng instance vào factory).
- **Batch F:** #28, #29, #30 (tracker, GitHub và repo; không chuyển helper dùng chung giữa các family trong cùng PR).
- **Batch G:** #31, #32 (automation checks và automation routes). `requireAutomations` ở nguyên trong `createApp`, truyền vào cả hai factory; giữ `.use()` từng family trước endpoint.
- **Batch H:** #33, #34 (dispatch và memory). `requireDispatch` ở nguyên trong `createApp`, truyền vào hai factory; giữ từng `.use()` trước routes.

Mỗi batch là một bậc tăng dần: hoàn tất và review batch trước rồi mới bắt đầu batch tiếp theo. #35 rồi #36 phải tuần tự vì cùng dùng registry session, quyền sở hữu project và helper đăng ký WebSocket topic. #37 làm cuối, một worker/PR riêng: đây là family 39 route, dùng nhiều helper cùng vòng đời run/worktree/terminal và chứa hazard thứ tự bulk-vs-`:id` ở mục 3. Sau #37 chạy lại đầy đủ test run/route/parity; không gom nhiều family vào một PR để tiết kiệm bước review.

Một worker trong batch được sửa `server.ts` ở ba điểm rời nhau: chuyển builder của family mình, thêm import riêng, thay một link mount của family mình. Nếu cần đổi interface của closure dùng chung (ví dụ registry/provider state, `requireDispatch`/`requireAutomations`, terminal sessions), hãy tách bước interface trước hoặc chuyển các family liên quan về chạy tuần tự; không để hai worker cùng sửa định nghĩa closure đó.
