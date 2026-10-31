# FEATURES.md — bản chụp hiện trạng tính năng (Onni Work)

Ngày chụp: **2026-10-30** · nhánh `docs/architecture-snapshot` · chỉ đọc code, không sửa code.

Cột "Nơi trong code" dùng đường dẫn tương đối repo; số sau `:` là dòng tại thời điểm chụp.

## Cách đọc cột "Trạng thái"

| Giá trị | Nghĩa |
| --- | --- |
| **ĐÃ XÁC MINH** | Đã chạy thật trong phiên chụp (dry-run `ONNI_DRY_RUN=1`) **hoặc** có test cụ thể đứng tên và test đó pass. |
| **CÓ TRONG CODE** | Đã đọc source, đã lần đường gọi tới UI/CLI/API, nhưng chưa chạy. |
| **NỬA VỜI** | Có trong code nhưng chưa nối xong, hoặc nối rồi mà mặc định tắt/không tới được từ người dùng, hoặc chỉ chạy được trên nền tảng khác. |
| **ĐÃ VÔ HIỆU** | Bị cờ tắt hẳn, hoặc đã cố ý xoá, hoặc code còn đó nhưng không còn đường gọi. |

## Bằng chứng đã chạy trong phiên chụp

**Dry-run** (server đã build, `ONNI_DRY_RUN=1 npm run dev:server`, cockpit gọi `/api/v1`):

| Kịch bản | Chuỗi trạng thái quan sát được |
| --- | --- |
| quick-task | run `queued → running → done`, step `pending → running → done` |
| check thất bại, `onFail.retry.max: 1` | `running → running (loop 1/1) → failed`, `retriesUsed = 1` |
| `produces-diff` + `ONNI_REVIEW_GATE=1` | `running → review` |
| `review → POST /runs/:id/finish-review` | `review → done` |
| `ask-user` | `running → waiting`; gửi message → `waiting → running → review` |
| continue trên run đã settled | run `done → running`, sinh step mới `continue-1` |
| cancel | `running → cancelled` |
| dispatch | parent `running (activity: monitoring)`, child `queued → running → done`; event `dispatched "child-1"` + `report received … status done`; ledger `.ai/onni/dispatch/<rootRunId>/` ghi file |
| `onni task create` (CLI) | tạo được subtask, parent nhận report |
| draft PR khi dry-run | `{ url: …/pull/777, dryRun: true }`, run `review → done` |

**Test** — chạy **toàn bộ** `npm test` trên máy Windows 11 (Git Bash), 385s:

→ `Test Files 85 failed | 672 passed | 4 skipped (761)` · `Tests 339 failed | 11942 passed | 47 skipped (12328)`.
Con số 339 **khớp chính xác** cảnh báo trong `AGENTS.md` §Windows ("~340 test fail, nearly all environment-shaped"). Đã phân loại thủ công từng file được trích dẫn, và cả 4 file fail nhiều nhất (`workflows/run.test.ts` 54, `graph-system-nodes.test.ts` 17, `worktree-lifecycle/coordinator.test.ts` 15, `monitoring-exit.test.ts` 15): `expected 438 to be 384` = chmod `0600` trên NTFS · `EPERM/EBUSY … rmSync/rmdir` = dọn thư mục temp · `exits 143` = tín hiệu POSIX · `/x` vs `\x` và `base\r\n` vs `base\n` = đường dẫn & line ending POSIX · `sed -i`, `launchd`, `SIGKILL`, khoá `wx` = không có trên Windows.
Mỗi dòng **ĐÃ XÁC MINH** ở dưới hoặc là dry-run thật, hoặc là test file **xanh hoàn toàn** trên máy này; nếu file còn fail vì môi trường thì ghi rõ trong cột Căn cứ. Bốn trường hợp **không** quy được cho môi trường thì để `CÓ TRONG CODE` và ghi "cần CI": `create-project`, `project-context`, `worktree-lifecycle`, `deferred-start` (+ `checkout`, `repo-sync`, `tracker-association`, `ubuntu-vps`, `macosx-ngrok`, `server-install/state`, `workspace/secrets`, `workflows/secrets`).

Lệnh tái hiện: `npm test` (toàn bộ) hoặc hẹp hơn:
`npm test -- runs/store runs/retention runs/layouts runs/drafts runs/auto-name dispatch/ git-diff-base review-gate workspace/semaphore server/ws terminal/ runner-factory skills uploads.test todos.test e2e-setup start-app automations/ webhooks/ server/capabilities secrets-api server-install/ versioned-surface`

---

## 1. Task / Run: tạo, hàng đợi, vòng đời, tương tác

| Chức năng | Mô tả ngắn | Nơi trong code | Cách dùng | Trạng thái | Căn cứ |
| --- | --- | --- | --- | --- | --- |
| Tạo run từ cockpit | Nhập prompt, chọn backend + workflow, run mới có worktree riêng | `packages/work/src/server/server.ts:4666` · `packages/web/src/routes/new-task.tsx` | UI `/new` · API `POST /api/v1/runs` | ĐÃ XÁC MINH | dry-run quick-task → `done` |
| `onni run` không cần server | Chạy một workflow ngay trong terminal, không boot service | `packages/work/src/index.ts:438` (default `quick-task`) | CLI `onni run "<prompt>" -w <wf>` | CÓ TRONG CODE | `index.ts:438` |
| Hàng đợi + pump | Run quá `maxParallel` nằm `queued`, pump khi có slot | `packages/work/src/workflows/run.ts:1910` | API/UI tự động | ĐÃ XÁC MINH | `workspace/semaphore.test.ts` pass |
| Semaphore theo workspace | Chặn 2 run song song mặc định | `packages/work/src/workspace/semaphore.ts` · `config.ts:39` | `config.json.resources.maxParallel` | ĐÃ XÁC MINH | `workspace/semaphore.test.ts` pass |
| Máy trạng thái run | 7 trạng thái + `activity:'monitoring'` | `packages/contract/src/runs.ts:50` · `run.ts:5320,7740,7714,5191,5177` | UI badge | ĐÃ XÁC MINH | dry-run (khớp hình 09) |
| Máy trạng thái step | `pending/running/waiting/done/failed/cancelled/skipped` | `contract/runs.ts:69` · `run.ts:5778,5802,4936,5198,5189,5176` | UI thread | ĐÃ XÁC MINH | dry-run; `skipped`/`review` không bao giờ ghi → §16 |
| Cancel run | Gửi SIGTERM cho provider, `CANCEL_GRACE_MS` 1s rồi reap | `run.ts:5177` · `server.ts` `…/cancel` | UI · CLI · API | ĐÃ XÁC MINH | dry-run `running → cancelled` |
| Continue sau khi settled | Run đã `done/failed/review` chạy tiếp, sinh step `continue-N` | `run.ts:4443` `continueRun` · `server.ts:4992` | UI task thread · API `…/continue` | ĐÃ XÁC MINH | dry-run sinh `continue-1`; `server/continue-run.test.ts` |
| Gửi message khi đang `waiting` | câu trả lời `ask-user` được đẩy vào session đang chờ | `run.ts:4350` `deliverMessage` · `server.ts:4846` | UI composer | ĐÃ XÁC MINH | dry-run `waiting → running → review` |
| Hàng đợi message khi đang chạy | message đến giữa turn được buffer rồi flush | `packages/work/src/server/queued-messages.ts` | UI composer | ĐÃ XÁC MINH | `server/queued-messages.test.ts` pass |
| Ask-user / attention | step `ask-user` đậu `waiting`, phát yêu cầu | `graph.ts:50` (`ask-user`) · `run.ts:4935,7360,8601` | UI thread | ĐÃ XÁC MINH | dry-run `waiting` |
| Retry khi check fail | `onFail.retry.max` + `retryOn` lọc theo exit code | `workflows/graph.ts:79` · `run.ts:5986-5992` | workflow YAML | ĐÃ XÁC MINH | dry-run loop 1/1 → `failed` (assertion pass; afterEach fail vì `EPERM`) |
| Retention runs | Giữ 300 run + 500 archived, ghi đè NDJSON | `packages/work/src/runs/store.ts:504-505` | `ONNI_RUNS_KEEP`/`ONNI_ARCHIVED_RUNS_KEEP` | ĐÃ XÁC MINH | `runs/retention.test.ts`, `runs/store.test.ts` pass |
| Persist run | `runs.json` + `runs/<id>.ndjson` (event history) | `runs/store.ts:1212,1347` | tự động | ĐÃ XÁC MINH | `runs/store.test.ts`, `runs/event-history.test.ts` pass |
| Attachments (ảnh) | Staging khi soạn, tối đa 20 ảnh/28 MB base64 mỗi message | `packages/web/src/components/composer/composer-attachments.tsx` · `contract/runs.ts:1121,1125` · `uploads.ts:18-19` | UI kéo-thả | ĐÃ XÁC MINH | `uploads.test.ts`, `composer-attachments.test.ts` pass |
| Notes của run | Markdown per-run, agent và người cùng đọc/ghi | `packages/work/src/handoff.ts:264` · `.ai/onni/notes/` | UI tab `/tasks/:id/notes` | CÓ TRONG CODE | `handoff.ts:264` |
| Draft (soạn offline) | Nháp prompt + ảnh, 16 surface, 100k ký tự | `packages/work/src/runs/drafts.ts:18,22,25,49` | UI `/new` | ĐÃ XÁC MINH | `runs/drafts.test.ts`, `server/drafts-api.test.ts` pass |
| Layout workspace | Lưu/cài bố cục tab, 3 cột × 12 tab × 50 layout | `packages/work/src/runs/layouts.ts:16,37` · `contract/src/workspace-layouts.ts:21-24,53` | UI kéo tab | ĐÃ XÁC MINH | `runs/layouts.test.ts`, `web/src/routes/task-workspace/use-saved-layouts.test.ts` pass |
| Auto-name nhánh + title | Agent đặt tên nhánh/màn hình sau turn đầu | `packages/work/src/runs/auto-name.ts:25` | `ONNI_AUTONAME=0` tắt | ĐÃ XÁC MINH | `runs/auto-name.test.ts:213-218` pass |
| Idle timeout theo dõi | 15 phút mặc định; `MONITORING_LIVENESS_MS` = 4× | `workspace/config.ts:85,94` · `run.ts:249` | Settings · config | CÓ TRONG CODE | `core/inactivity-deadline.test.ts` pass |
| Reap tiến trình còn sót | Sau khi run settle, dọn PID con theo `ONNI_TASK_ID` | `packages/work/src/core/task-processes.ts:159,27` · gọi `run.ts:2550` | `ONNI_TASK_PROCESS_REAP=0` | NỬA VỜI | Linux-only (`/proc`, `ps -E`); test guard skip trên Win |
| Todos / follow-ups | Danh sách việc phát sinh từ run, đổ về Inbox | `packages/work/src/todos.ts:10,35` · `run.ts:1556` | UI `/inbox` · API `/todos` | ĐÃ XÁC MINH | `todos.test.ts`, `server/todos-start.test.ts` pass |
| Task markers in-band | Agent khai báo PR/issue bằng marker trong text của chính turn đó (`ONNI:PR=…`, `ONNI:DONE`) — không parse tool output | `packages/work/src/runs/task-markers.ts:1-14` · `task-refs.ts` | tự động | ĐÃ XÁC MINH | `runs/task-markers.test.ts` pass |
| Inbox gate | Trang inbox ẩn khi `localHandoff` tắt | `server/capabilities.ts:232` · `server/inbox-gate.test.ts` | UI `/inbox` | ĐÃ XÁC MINH | `server/inbox-gate.test.ts` pass |

## 2. Workflow & Skill

| Chức năng | Mô tả ngắn | Nơi trong code | Cách dùng | Trạng thái | Căn cứ |
| --- | --- | --- | --- | --- | --- |
| Workflow repo | `.yaml`/`.yml` trong `.ai/onni/workflows/` là nguồn duy nhất | `packages/work/src/workflows/load.ts:15,43` | UI `/workflows` · file | CÓ TRONG CODE | `load.ts:15` — chưa có test riêng cho loader |
| Catalog = file + builtin | Tên file thắng bản dựng sẵn | `load.ts:98,122` | UI `/workflows` | CÓ TRONG CODE | `load.ts:98` |
| `quick-task` builtin | 1 step agent, default của `onni run` | `packages/work/src/workflows/types.ts:242` | UI/CLI | ĐÃ XÁC MINH | dry-run |
| 4 workflow dựng sẵn dạng graph | implement-and-verify / implement-review-pr / review-council / fix-ci | `packages/work/src/workflows/templates.ts:203` | UI `/workflows/new` | CÓ TRONG CODE | `templates.ts:203` |
| `version: 2` → graph path | v2 biên dịch thẳng ra graph, v1 compile sang graph | `load.ts:53,69` · `graph.ts:527` `compileV1` | YAML | CÓ TRONG CODE | `workflows/graph.test.ts` pass |
| 21 loại node graph | loop, agent, check, gate.human, ask-user, dispatch, git.*, github.*, fork, join, workflow, if, notify.webhook | `packages/work/src/workflows/graph.ts:50,169,175,212` | YAML · UI graph editor | ĐÃ XÁC MINH | `workflow-graph-sim.test.ts`, `workflows/graph.test.ts` pass |
| `graphToSteps` | fallback sinh steps từ graph | `graph.ts:410` | tự động | CÓ TRONG CODE | `graph.ts:410` |
| Editor workflow trên UI | trang `/workflows/new`, `/workflows/:name` | `packages/web/src/routes/workflows*.tsx` | UI | CÓ TRONG CODE | `routes.tsx` |
| Skill discovery | 7 thư mục repo + 2 global + team + builtin, sâu 4 | `packages/work/src/skills.ts:50,64,91,170` | UI `/skills` | ĐÃ XÁC MINH | `skills.test.ts` pass |
| Skill từ repo từ xa | clone vào `~/.cache/onni/skills/<owner>__<name>/` | `skills-remote.ts:149,157` · TTL 6h `:448` | UI `/settings/skills` | ĐÃ XÁC MINH | `skills-remote.test.ts`, `org-skills-repos-api.test.ts` pass |
| ~~Auto-update skill (Open Mercato)~~ | ~~`npx --yes skills check` rồi apply~~ | ~~`skills-update.ts`, coordinator trong `server.ts`, 3 route `/workspace/skills-update*`, `skillsAutoUpdate`, thẻ cập nhật + toggle trong UI~~ | ~~`ONNI_SKILLS_AUTO_UPDATE=0`~~ | ĐÃ VÔ HIỆU | **ĐÃ XOÁ 2026-10-31** (ADR 0004). `skillsAutoUpdate` cũ trong `config.json` được giữ như khoá lạ, không đọc |
| Slash-skill expand | `/<skill>` trong prompt được nội dung hoá | `run.ts:8964,8979` (dùng `:4321,5082,6848`) | UI composer | ĐÃ XÁC MINH | `run.ts:8964` + batch tests pass |
| Provision skill khi init | `onni init` đổ bộ skill mặc định | `packages/work/src/skills-provision.ts` | CLI `onni init` | ĐÃ XÁC MINH | `skills-provision.test.ts` pass |
| Planner (tạo workflow từ prompt) | model `sonnet`, 1–5 steps, 60s, **chỉ backend Claude** | `packages/work/src/workflows/planner.ts:19,21,56,69` | API `POST /api/v1/plan` (`server.ts:3869`) | NỬA VỜI | không có nút UI; plan không lưu — xem §16 |

## 3. Agent backend & cấu hình agent

| Chức năng | Mô tả ngắn | Nơi trong code | Cách dùng | Trạng thái | Căn cứ |
| --- | --- | --- | --- | --- | --- |
| 7 backend | claude, codex, opencode, cursor, pi, junie, copilot | `packages/work/src/core/runner-factory.ts:19` | UI chọn backend | ĐÃ XÁC MINH | `core/runner-factory.test.ts` pass |
| Seam `AgentRunner`/`AgentSession` | contract cho runner mới | `packages/work/src/core/agent-runner.ts:211,230` · `AGENT_PROTOCOL.md` | code | ĐÃ XÁC MINH | `core/ui-parity.test.ts` pass |
| Event v1 (11 kiểu) | protocol nội bộ runner | `core/agent-runner.ts:161` | tự động | ĐÃ XÁC MINH | golden fixture `workflows/run-graph` tests pass |
| Event v2 `UiEvent` | protocol ra cockpit | `core/ui-events.ts:392` | WS/SSE | ĐÃ XÁC MINH | `core/ui-events.test.ts` pass |
| stdio stream-json | Claude `claude-cli-runner.ts:100`, Cursor `cursor-agent-runner.ts:147` | spawn + parse JSONL | UI/CLI | ĐÃ XÁC MINH | `claude-cli-runner.test.ts`, `cursor-agent-runner.test.ts` pass (1 fail còn lại của file = "exits 143", tín hiệu POSIX, máy này không có) |
| JSON-RPC 2 over stdio | Codex `codex-app-server-runner.ts:70`, Pi `pi-runner.ts:39` | `codex-app-server-transport.ts:44` | UI/CLI | ĐÃ XÁC MINH | `codex-app-server-runner.test.ts`, `pi-runner.test.ts` pass (1 fail = "exits 143", POSIX signal) |
| ACP | Junie `junie-runner.ts:74`, Copilot `copilot-acp-runner.ts:65` | `acp-client.ts:52` · `junie-acp-transport.ts:72` | UI/CLI | ĐÃ XÁC MINH | `acp-client.test.ts`, `junie-acp-transport.windows.test.ts` pass |
| HTTP + SSE | Opencode `opencode-server-runner.ts:96` | `opencode-http.ts:53` | UI/CLI | ĐÃ XÁC MINH | `opencode-server-runner.test.ts` pass |
| Model catalog per-backend | `core/<backend>-model-catalog.ts`, gộp ở `runner-model-catalog.ts:42` | `agent-config/models.ts:38` | UI `/settings` · API `/models` | ĐÃ XÁC MINH | `models.test.ts`, `runner-model-catalog.test.ts`, `models-api.test.ts` pass |
| Khoá model | `ONNI_AGENT_MODELS_LOCKED=1` hoặc `modelsLocked` → từ chối model ngoài danh sách | `core/agent-model-policy.ts:7,19,41` · `server.ts:4669,5006,6045,7101` | config | ĐÃ XÁC MINH | `core/agent-model-policy.test.ts` pass |
| Agent config files | AGENTS/CLAUDE/config.toml per-vendor, không chứa model list | `agent-config/catalog.ts:97` · `findConfigFile :480` | UI `/settings` · API `/agent-config` (`server.ts:7253`) | ĐÃ XÁC MINH | `agent-config/files.test.ts`, `agent-config-api.test.ts` pass; `catalog.test.ts` còn 3 fail vì so đường dẫn POSIX |
| Agent profiles | hồ sơ prompt/flags per-backend | `core/agent-profiles.ts` · routes `server.ts:2447-2767` (gate `capabilities.ts:192`) | UI `/settings` | ĐÃ XÁC MINH | `core/agent-profiles.test.ts`, `agent-profiles-api.test.ts` pass |
| Private MCP | `mcp.local.json` dịch ra từng vendor (5 backend) | `core/private-mcp.ts:26,29,48` · injection `:459/653/359/348/325` · gọi `run.ts:1578` | file + UI | ĐÃ XÁC MINH | `core/private-mcp.test.ts` pass — 2 fail cuối là `mode & 0o777 == 0o600`, NTFS không có bit đó |
| Agent accounts | đăng nhập nhiều tài khoản per-project | `paths.ts:122` · `workspace/agent-accounts.ts:12` | UI `/settings` | ĐÃ XÁC MINH | `web/src/api/agent-accounts.test.ts`, `account-identity.test.ts` pass |
| Provider availability/auth | phát hiện binary + trạng thái login | `core/provider-availability.ts` · `core/provider-auth.ts` | UI pills | ĐÃ XÁC MINH | `provider-availability.test.ts`, `provider-auth.test.ts` pass; `providers-api.test.ts` chỉ fail ở `rmSync` teardown (EPERM) |
| Usage / cost | token + chi phí báo về, chỉ hiển thị | `core/usage.ts` · `runs/store-reported-cost.ts` | UI `/settings/global` | ĐÃ XÁC MINH | `usage.test.ts`, `store-reported-cost.test.ts` pass |
| Usage windows + giới phí | cửa sổ 5h/7d của Claude, `~/.onni/usage-windows` | `core/usage-windows.ts` | UI dashboard | ĐÃ XÁC MINH | `core/usage-windows.test.ts`, `usage-windows-runner.test.ts` pass; bản `workspace/usage-windows.test.ts` còn 1 fail chmod |
| `ONNI_CODEX_REASONING` | override `reasoningSummary` cho Codex | `core/codex-app-server-runner.ts:749-754` | env | ĐÃ XÁC MINH | `test/unit/codex-reasoning-summary.test.ts` pass |
| Chạy thật agent CLI | KHÔNG chạy trong phiên chụp (login/chi phí thật) | — | — | ĐÃ VÔ HIỆU | ràng buộc của yêu cầu; `ONNI_DRY_RUN=1` thay thế |

## 4. Git & worktree

| Chức năng | Mô tả ngắn | Nơi trong code | Cách dùng | Trạng thái | Căn cứ |
| --- | --- | --- | --- | --- | --- |
| Một worktree mỗi task | `.ai/onni/worktrees/<runId>` | `packages/work/src/git-worktree.ts:20` | API/UI tự động | ĐÃ XÁC MINH | `git-worktree.test.ts` pass (1 test Win-shape — §16) |
| Nhánh `onni/<id8>` | tên nhánh lưu trên run record, không tính lại | `git-worktree.ts:84` · `contract/runs.ts` | tự động | ĐÃ XÁC MINH | `git-worktree.test.ts`, `git-refs.test.ts` pass |
| Diff base | "ref nào neo diff của task" chỉ ở một chỗ | `packages/work/src/git-diff-base.ts` `resolveTaskDiffBase` | UI `/tasks/:id/changes` | ĐÃ XÁC MINH | `git-diff-base.test.ts` pass |
| Diff/patch view | cap 200 KB patch, 20k path, 8 MiB, file 512 KB | `server/git-changes.ts:75,489,497,568` | UI · API `/git/changes` | ĐÃ XÁC MINH | `server/git-changes.test.ts` pass |
| Loại `.ai/onni` khỏi diff | pathspec exclude | `data-gitignore.ts:64` · `git-changes.ts:327` · `workflows/landing.ts:34` | tự động | ĐÃ XÁC MINH | `data-gitignore.test.ts` pass |
| Autosave commit | WIP commit khi agent dừng giữa turn | `git-worktree.ts:447-457,504` · gate `run.ts:474` | `ONNI_AUTOSAVE=1` | CÓ TRONG CODE | `autosave-conflict-guard.test.ts` pass |
| Commit / push từ cockpit | tạo commit rồi push nhánh của run | `server.ts:5426` `git/commit` · `:5440` `git/push` | UI review surface | ĐÃ XÁC MINH | `server/git.test.ts` pass |
| Worktree lifecycle | reclaim/prune/retention 10 mặc định | `server/worktree-lifecycle.ts` (16 route) · `config.ts:27` | UI `/git` · API | CÓ TRONG CODE | `git-worktree-disk.test.ts` pass; `server/worktree-lifecycle.test.ts` có 1 fail thật trên máy này (`'running'` ≠ `'needs_attention'`) + 1 EPERM — chưa kết luận được, cần CI |
| Repo groups / compare | nhóm repo, so sánh `refs/onni/pr/<n>` | `server/git/groups` · `automations/pr-head.ts:12` | UI `/compare/:groupId` | ĐÃ XÁC MINH | `server/group-pick.test.ts` pass |
| Sync base / checkout | `git.sync-base` node, checkout route | `graph.ts:50` · `server/checkout.ts` | workflow · API | CÓ TRONG CODE | `server/checkout.test.ts` 1 fail (credential helper Windows), `repo-sync.test.ts` 1 timeout — chưa kết luận được, cần CI |
| Remotes | đọc remote, suy fork parent bằng `gh` | `git-remotes.ts` | tự động | ĐÃ XÁC MINH | `git-remotes.test.ts` pass |

## 5. Dispatch (task cha → task con)

| Chức năng | Mô tả ngắn | Nơi trong code | Cách dùng | Trạng thái | Căn cứ |
| --- | --- | --- | --- | --- | --- |
| Bật dispatch cho run | node `dispatch` trong graph, mặc định ON | `graph.ts:50` · `capabilities.ts:244` (`ONNI_DISPATCH=0`) | workflow YAML · composer toggle | ĐÃ XÁC MINH | dry-run parent `monitoring`, child `done` |
| Engine dispatch | spawn con, theo dõi, nhận report | `packages/work/src/dispatch/engine.ts:20-70` | tự động | ĐÃ XÁC MINH | `dispatch/engine.test.ts` pass |
| Cây task trên đĩa | `.ai/onni/dispatch/<rootRunId>/` | `dispatch/tree-fs.ts` | UI `/tasks` tree | ĐÃ XÁC MINH | `dispatch/tree-fs.test.ts` pass; 1 fail duy nhất là regex đường dẫn POSIX → §16 |
| `onni task create` / `report` / `list` | CLI cho agent con gọi về cha | `packages/work/src/dispatch/task-cli.ts` | CLI trong worktree | ĐÃ XÁC MINH | `dispatch/task-cli.test.ts` + dry-run CLI |
| Budget cho con | `budgetUsd` (trần 10 000 USD) carve cho con; `enforceDispatchBudget` đậu run `waiting` khi spent ≥ budget | `contract/dispatch.ts:78,130` · `run.ts:2827-2842,3004-3020` · `engine.ts:54` | composer · `onni task create --budget` | ĐÃ XÁC MINH | `dispatch/engine.test.ts` pass |
| Report buffer | giữ tối đa 20 report mới nhất cho cha | `dispatch/engine.ts:30,209-211` | tự động | ĐÃ XÁC MINH | `dispatch/engine.test.ts` pass |
| Trần con đang chạy | 4 in-flight (`DISPATCH_MAX_IN_FLIGHT`) | `contract/dispatch.ts:57` · `engine.ts:25` | env/composer chỉ hạ được | ĐÃ XÁC MINH | `contract-parity.dispatch.test.ts` pass |
| Trần số subtask | `dispatch()` đếm con theo `rootRunId` và từ chối khi vượt: `intent.maxSubtasks` nếu root có, **nếu không thì `safety.dispatchMaxSubtasks` (mặc định 12)** — cây không `intent` cũng bị chặn. (Bản chụp 2026-10-30 ghi "engine không đếm": **sai**, bộ đếm đã có ở `run.ts` từ trước; nhánh `feat/unattended-safety` chỉ thêm mặc định cho cây không `intent`) | `workflows/run.ts` (`dispatch()`, "Structural brakes") · `contract/limits.ts` | composer · automation · Settings → Resources → Limits → Advanced | ĐÃ XÁC MINH | `workflows/dispatch-structure.test.ts`, `dispatch-engine.test.ts` pass |
| Prompt cho con | briefing/return format | `dispatch/prompts.ts` | tự động | ĐÃ XÁC MINH | `dispatch/prompts.test.ts` pass |
| Depth cap | `safety.dispatchMaxDepth`, mặc định **1** (worker không dispatch tiếp), tối đa 3; độ sâu tính bằng cách đi ngược `parentRunId` | `dispatch/engine.ts` (`dispatchDepth`) · `workflows/run.ts` (`dispatch()`) | Settings → Resources → Limits → Advanced | ĐÃ XÁC MINH | `workflows/dispatch-structure.test.ts` pass |
| `retry_limit` | Được thực thi: cùng một order (cùng `title` dưới cùng parent) chỉ được dispatch lại tối đa `min(retry_limit, safety.dispatchRetryLimit)` lần sau khi failed/cancelled; order chỉ được hạ trần, không nâng | `workflows/run.ts` (`dispatch()`) | `onni task create --retry-limit` | ĐÃ XÁC MINH | `workflows/dispatch-structure.test.ts` pass |

## 6. Automations, webhooks, tracker

| Chức năng | Mô tả ngắn | Nơi trong code | Cách dùng | Trạng thái | Căn cứ |
| --- | --- | --- | --- | --- | --- |
| 3 loại automation | `github` (default), `schedule`, `tracker` | `automations/types.ts:110` | UI `/automations` · CLI `onni automation` | ĐÃ XÁC MINH | `automations/types.test.ts` pass |
| Scheduler | một `setTimeout` mỗi workspace, re-arm | `automations/scheduler.ts:313,346,393` | tự động | ĐÃ XÁC MINH | `automations/scheduler.test.ts` pass |
| GitHub poller | shell-out `gh`, **polling, không có inbound webhook** | `automations/github-poller.ts:1` · `types.ts:92` | UI | ĐÃ XÁC MINH | `github-poller.test.ts` pass |
| Tracker poller | theo dõi event Jira/Linear | `automations/tracker-poller.ts` | UI | ĐÃ XÁC MINH | `tracker-poller.test.ts` pass |
| Receipt idempotency | `reserved / launched / launch-error / skipped` | `automations/types.ts:251` · `store.ts:273` | tự động | ĐÃ XÁC MINH | `automations/store.test.ts` pass; 1 fail còn lại là chmod `0o600` |
| 4 file state automations | `automations/‑state/‑receipts.ndjson/‑log.ndjson` | `automations/store.ts:31-34` | `.ai/onni/` | ĐÃ XÁC MINH | `automations/store.test.ts` pass |
| Cron/once schedule + auto-pause | grace 10′, catch-up 24h, pause sau 3 lần lỗi | `automations/schedule-runner.ts:29-31,93` | UI editor | ĐÃ XÁC MINH | `schedule-runner.test.ts` pass |
| Gate ONNI_AUTOMATIONS | route trả 409 `AUTOMATIONS_OFF` khi tắt | `capabilities.ts:247` · `server.ts:4012,4023` | env | ĐÃ XÁC MINH | `automations-gate.test.ts` pass; 1 fail là `rmSync` EPERM |
| Deferred start | khởi động trễ, chịu được SIGKILL | `automations/deferred-start.ts` · 7 route | UI `/automations/:id` | CÓ TRONG CODE | `deferred-start.test.ts`, `deferred-binding-check.test.ts`, `deferred-dispatch.test.ts`, `deferred-graph.test.ts`, `deferred-reset.test.ts`: 5 fail vì máy Windows không có `SIGKILL` → chưa kết luận được, cần CI |
| Webhook **outbound** chỉ khi bật | 409 nếu `ONNI_WEBHOOKS!=1` | `server/webhooks.ts:17` · `capabilities.ts:248` | env | ĐÃ XÁC MINH | `webhooks.test.ts`, `single-project-webhooks.test.ts` pass |
| 40 route webhooks | endpoint/history/operations/chat | `server/server.ts` family `webhooks` | API | ĐÃ XÁC MINH | `contract-parity.webhooks.test.ts` pass |
| Lifecycle events | `task.attention_required/review_ready/finished/failed/cancelled` | `webhooks/lifecycle.ts:6` | subscription | ĐÃ XÁC MINH | `webhooks/lifecycle.test.ts` pass |
| Chữ ký HMAC | `v1,<b64>` over `id.timestamp.body`, `whsec_`, `timingSafeEqual`, cửa sổ 300s | `webhooks/signing.ts:11,16` · header `transport.ts:120` | endpoint config | ĐÃ XÁC MINH | `webhooks/signing.test.ts` pass |
| Retry/backoff | 5s×2^n, trần 1h; outbox `outbox.ndjson` 50 MiB | `transport.ts:185` · `outbox.ts:25` | tự động | ĐÃ XÁC MINH | `webhooks/outbox.test.ts` pass |
| Admission + giới hạn | 8 MiB payload, hết hạn 72h, 10 token, 3 test/phút, 10 manual fail/60s | `admission.ts:40,156,158` · `limits.ts:7,62,63` | tự động | ĐÃ XÁC MINH | `webhooks/limits.test.ts`, `admission.test.ts` pass |
| `notify.webhook` trong workflow | node riêng, cần `ONNI_WORKFLOW_WEBHOOKS=1` | `graph.ts:232` · `run.ts:6437` | YAML | ĐÃ XÁC MINH | `contract-parity.automations.test.ts` pass |
| Attention request payload | `requestId/askedAt/questions 1..20` | `contract/webhooks.ts:20` · sinh `run.ts:2766,2805` · render `payload.ts:63` | API | CÓ TRONG CODE | `webhooks/contract.test.ts` pass |
| ~~Slack/Discord~~ | ~~không ký, chỉ POST~~ | ~~`webhooks/slack.ts` · `discord.ts`, format `slack.v1`/`discord.v1`, bộ chọn Destination + preview trong UI~~ | ~~UI~~ | ĐÃ VÔ HIỆU | **ĐÃ XOÁ 2026-10-31** (ADR 0004). Receiver Slack/Discord đã lưu bị bỏ khi load và để lại 1 dòng history; webhook `onni.json.v1` (HMAC, outbox, retry) giữ nguyên |
| Tracker: chỉ Jira + Linear | 2 vendor, không có Asana/Shortcut… | `contract/tracker.ts:4` | UI `/tracker` | ĐÃ XÁC MINH | `tracker/jira.test.ts`, `linear.test.ts` pass |
| Credential tracker | `~/.onni/tracker-connections/<sha256(realpath)>.env`, 0600/0700 | `server/tracker/connections.ts:16,20` | Settings | CÓ TRONG CODE | `connections.test.ts`: assertion mode fail trên Win |
| Xoá connection | `onni tracker-connections list` / `remove <64hex>`; **không revoke phía vendor** | `connections-cli.ts:9` | CLI | ĐÃ XÁC MINH | `connections-cli.test.ts` pass |
| Association | `.ai/onni/tracker.json`, mkdir lock | `tracker-association.ts:17,38` | UI | CÓ TRONG CODE | `tracker-association.test.ts` 1 timeout ("does not steal an old lease from a live process") — chưa kết luận được, cần CI |
| Cấp credential cho agent | `JIRA_*`/`LINEAR_API_KEY` theo revision đã chốt | `server/tracker/agent-credentials.ts:25` | tự động | ĐÃ XÁC MINH | `agent-credentials.test.ts` pass |

## 7. Trang UI (SPA)

| Chức năng | Mô tả ngắn | Nơi trong code | Cách dùng | Trạng thái | Căn cứ |
| --- | --- | --- | --- | --- | --- |
| `/dashboard` | feed live, cost, automation snapshot | `packages/web/src/routes/dashboard/*` | UI | ĐÃ XÁC MINH | `routes/dashboard/state.test.ts`, `api/dashboard-live.test.ts` pass |
| `/tasks` + `/tasks/:id/*` | 10 sub-route: changes, chat, commits, `/commits/:sha`, files, graph, notes, preview, terminal | `packages/web/src/routes.tsx` · `routes/tasks-overview.tsx` · `routes/task-thread/*` | UI | ĐÃ XÁC MINH | `routes/task-thread/thread-state.test.ts`, `routes/task-git/file-tree.test.ts` pass |
| `/new` | form tạo task, dispatch toggle, attachments | `packages/web/src/routes/new-task.tsx` | UI | ĐÃ XÁC MINH | `new-task-form.test.ts`, `new-task-params.test.ts`, `new-task-draft.test.ts`, `new-task-autostart.test.ts` pass |
| `/inbox` | attention + todos chờ | `packages/web/src/routes/inbox.tsx` | UI | ĐÃ XÁC MINH | `routes/inbox.test.tsx`, `server/inbox-gate.test.ts` pass |
| `/git*` | branches/commits/files + `/compare/:groupId` | `packages/web/src/routes/repo-git/*` · `compare-variants.tsx` | UI | ĐÃ XÁC MINH | `repo-git/match-paths.test.ts`, `compare-variants.test.tsx` pass |
| `/github*` | PR list, diff, issues, hand-to-agent | `packages/web/src/routes/github/*` | UI | ĐÃ XÁC MINH | `github/github-filter.test.ts`, `github/hand-to-agent-draft.test.ts` pass |
| `/skills`, `/workflows*` | catalog + editor + graph | `packages/web/src/routes/skills.tsx` · `routes/workflows/*` · `routes/workflow-graph/*` | UI | ĐÃ XÁC MINH | `routes/skills.test.tsx`, `workflow-graph/workflow-graph-sim.test.ts` pass |
| `/settings*` | agents, prompt-templates, skills, `/settings/global` | `packages/web/src/routes/settings/*` | UI | ĐÃ XÁC MINH | `settings/agent-descriptors.test.ts` pass |
| `/tracker*`, `/automations*` | assoc + editor + log | `packages/web/src/routes/tracker/*` · `routes/automations/*` | UI | ĐÃ XÁC MINH | `routes/automations/editor-draft.test.ts`, `dashboard/automations-data.test.ts` pass |
| `/p/:projectId` | scope đa dự án; mở task của project khác không cần reload | `packages/api-client/src/utils/project-scope.ts` · `packages/web/src/routes.tsx` | UI | ĐÃ XÁC MINH | `project-scope.test.ts`, `routes/cross-project-task-navigation.test.tsx` pass |
| Preview/Design Mode | proxy app của run, picker, location reporter | `packages/work/src/server/preview/design-proxy.ts:12,27,64,101` · `start-app.ts:11` · `routes/task-preview/*` | UI `/tasks/:id/preview` | ĐÃ XÁC MINH | `server/design-proxy-api.test.ts`, `task-preview/browser-view.test.ts` pass; **tắt trên hosted** |
| Keybindings, theme, sidebar | tiện ích cockpit | `packages/web/src/lib/keybindings.ts` · `theme.ts` · `sidebar-width.ts` | UI | ĐÃ XÁC MINH | `lib/keybindings.test.ts`, `lib/theme.test.ts`, `lib/sidebar-width.test.ts` pass |
| Notifications | thông báo trình duyệt khi cần chú ý | `packages/web/src/lib/notifications.ts` | UI | ĐÃ XÁC MINH | `lib/notifications.test.ts` pass |

## 8. Desktop shell (Tauri 2)

| Chức năng | Mô tả ngắn | Nơi trong code | Cách dùng | Trạng thái | Căn cứ |
| --- | --- | --- | --- | --- | --- |
| Sidecar supervisor | vòng lặp 666ms restart node sidecar | `packages/desktop/src-tauri/src/lib.rs:922,666` | mở app | NỬA VỜI | không build được trên máy này (Smart App Control); `desktop-check.yml` là gate |
| Phát hiện Node | `require_node` kiểm tra binary | `lib.rs:890` | app | CÓ TRONG CODE | `lib.rs:890` |
| Chọn port tự do | `pick_port` | `lib.rs:1502` | app | CÓ TRONG CODE | `lib.rs:1502` |
| Env khi spawn | `ONNI_DESKTOP/SUPERVISED/SUPERVISOR_PID/DISCLAIM_EXEC` | `lib.rs:922` | app | CÓ TRONG CODE | `lib.rs:922` |
| Single instance + ctrl-c | `single-instance` 563, `ctrlc` 552 | `lib.rs:552,563` | app | CÓ TRONG CODE | `lib.rs:552` |
| Tray + badge | icon, đếm run đang chạy | `lib.rs:352-362,1378,1390,1410-1413` | app | CÓ TRONG CODE | `lib.rs:1390` |
| Close → hide | không thoát khi bấm X | `lib.rs:627,636` | app | CÓ TRONG CODE | `lib.rs:627` |
| Remember window geometry | lưu `~/.onni/desktop-window.json` | `lib.rs:577,1520` | app | CÓ TRONG CODE | `lib.rs:577` |
| Exit → stop sidecar | `RunEvent::Exit` gọi `stop_sidecar` | `lib.rs:466,651` | app | CÓ TRONG CODE | `lib.rs:466` |
| `restart_app` | IPC cho Settings | `lib.rs:873` | UI | CÓ TRONG CODE | `lib.rs:873` |
| Debug IPC | `ONNI_DESKTOP_DEBUG_IPC=1` chỉ debug build | `lib.rs:1653,1660` | env | NỬA VỜI | không có trong `.env.example` |
| Updater / deep-link | **không có** — đã xoá có chủ đích | `docs/adr/0002-…` | — | ĐÃ VÔ HIỆU | `lib.rs` không có path deep-link nào |
| `onni link` / `unlink` | đăng ký checkout đã build vào `~/.onni/versions` cho shell | `packages/work/src/self-update/checkouts.ts` | CLI | ĐÃ XÁC MINH | `self-update/checkouts.test.ts` pass |

## 9. CLI

| Chức năng | Mô tả ngắn | Nơi trong code | Cách dùng | Trạng thái | Căn cứ |
| --- | --- | --- | --- | --- | --- |
| `onni` (bare) | boot server + mở cockpit | `packages/work/src/index.ts:57-74` | `onni -p 4321` | CÓ TRONG CODE | help block `index.ts:57` |
| `onni run` | chạy workflow, không cần server | `index.ts:438` | CLI | ĐÃ XÁC MINH | `runs/runs-cli.test.ts` pass |
| `onni task create` / `report` / `list` | IPC cho subtask | `dispatch/task-cli.ts` | CLI trong worktree | ĐÃ XÁC MINH | `dispatch/task-cli.test.ts` + dry-run |
| `onni runs list` | liệt kê run đã lưu | `runs/runs-cli.ts` | CLI | ĐÃ XÁC MINH | `runs/runs-cli.test.ts` pass |
| `onni automation` | tạo/liệt kê automation | `automations/automation-cli.ts` | CLI | ĐÃ XÁC MINH | `automation-cli.test.ts` pass |
| `onni init` | đổ `.ai/onni/`, gitignore, skills | `index.ts` · `data-gitignore.ts` | CLI | CÓ TRONG CODE | `data-gitignore.test.ts` pass |
| `onni projects add` / `remove` | quản lý registry dự án | `workspace/projects.ts` | CLI | CÓ TRONG CODE | `projects-api.test.ts` pass (5 fail EPERM teardown); `create-project.test.ts` fail 12/12 với HTTP 500 — `gh` trên máy này chưa login → chưa kết luận được, cần CI |
| `onni tracker-connections` | list/remove | `server/tracker/connections-cli.ts` | CLI | ĐÃ XÁC MINH | `connections-cli.test.ts` pass |
| `onni secrets` | set/get secret | `workspace/secrets.ts` | CLI | ĐÃ XÁC MINH | `server/secrets-api.test.ts` pass; `workflows/secrets.test.ts` fail cả describe (EPERM setup) → chưa kết luận được, cần CI |
| `onni server-install` / `deploy` / `uninstall` | cài VPS/macOS | `server-install/engine.ts` | CLI | ĐÃ XÁC MINH | `engine.test.ts`, `steps.test.ts`, `strategies.test.ts` pass |
| `onni link` / `unlink` | version layout cho desktop | `self-update/checkouts.ts` | CLI | ĐÃ XÁC MINH | `self-update.test.ts` pass |
| Cờ | `-p/--port --repo --workflow --model --no-open --platform --domain --external-proxy --bind-host --yes --reconfigure --reinstall -h` | `index.ts:57-74` | CLI | CÓ TRONG CODE | help block |

## 10. Config & biến môi trường

| Chức năng | Mô tả ngắn | Nơi trong code | Cách dùng | Trạng thái | Căn cứ |
| --- | --- | --- | --- | --- | --- |
| Zero-config | không file nào bắt buộc phải tạo | `.ai/onni/config.json` optional `config.ts` | — | ĐÃ XÁC MINH | `work/src/config.test.ts` pass |
| Workspace config atomic | tmp + rename 0600, `mergeWriteWorkspaceConfig` | `workspace/config.ts:421,433,455` | Settings | CÓ TRONG CODE | chmod assertion fail trên Win |
| `ONNI_HOME` / `ONNI_DATA_DIR` | dời state về thư mục khác | `paths.ts:84,122` | env | ĐÃ XÁC MINH | `work/src/paths.test.ts` pass phần lớn; 13 fail còn lại là so chuỗi đường dẫn POSIX (`\tmp\…` vs `/tmp/…`) |
| State per-instance | `server-instances/<slug>.json` khi chạy nhiều instance | `paths.ts:63,84` · `index.ts:597-619` | env | CÓ TRONG CODE | `server-install/state.test.ts` 4 fail (1 chmod + 3 khoá `wx` — Windows không có ngữ nghĩa đó) → chưa kết luận được, cần CI |
| 77 biến `ONNI_*` có tài liệu (`grep -oE 'ONNI_[A-Z0-9_]+' .env.example \| sort -u \| wc -l`; con số 62 cũ là sai) | tất cả đều comment trong `.env.example`, mặc định 0 dòng đang bật | `.env.example:1-314` | env | ĐÃ XÁC MINH | `.env.example` (0 dòng không comment) |
| Feature off switches | `ONNI_DISPATCH=0`, `ONNI_AUTOMATIONS=0`, ~~`ONNI_SKILLS_AUTO_UPDATE=0`~~ (đã xoá, ADR 0004), `ONNI_DESIGN_MODE=0`, `ONNI_REVIEW_GATE=1` (bật mới có) | `capabilities.ts:205,244,246-248` · `review-gate.ts:16-21` | env | ĐÃ XÁC MINH | dry-run gate ON/OFF + `review-gate.test.ts` pass |
| Tri-state `ONNI_TERMINAL` | local: ON; hosted: cần `=1` | `capabilities.ts:229-232` · `server.ts:7323` | env | ĐÃ XÁC MINH | `terminal-routes.test.ts`, `capabilities.test.ts` pass |
| `ONNI_DRY_RUN=1` | mock mọi agent CLI | mọi runner | env | ĐÃ XÁC MINH | toàn bộ dry-run ở đầu file |
| `ONNI_REDACT_SECRETS=0` | tắt che secret trong log | `core/secret-redaction.ts:28` | env | ĐÃ XÁC MINH | `secret-redaction.test.ts` pass |
| `ONNI_ENV_PASSTHROUGH` / `ONNI_AGENT_ENV_FULL` | chọn env nào được đưa vào agent | `core/agent-env.ts` | env | ĐÃ XÁC MINH | `agent-env.test.ts` pass |
| `ONNI_*_BIN` | trỏ tới binary per-backend | `.env.example` (`ONNI_CLAUDE_BIN` …) | env | CÓ TRONG CODE | `claude-bin.test.ts` / `cursor-bin.test.ts` có guard theo nền tảng, trên máy này không chạy được |
| Mock backends | `ONNI_MOCK_*`, `ONNI_MOCK_ARGS_FILE` | `.env.example:ONNI_MOCK_*` | env | ĐÃ XÁC MINH | `copilot-acp-runner.test.ts`, `mock` tests pass |

## 11. Multi-project

| Chức năng | Mô tả ngắn | Nơi trong code | Cách dùng | Trạng thái | Căn cứ |
| --- | --- | --- | --- | --- | --- |
| Project registry | `~/.onni/config.json` (+ `.bak`) | `workspace/projects.ts` · `paths.ts` | UI sidebar | ĐÃ XÁC MINH | `projects-api.test.ts` pass; 5 fail của file này là EPERM teardown |
| Scope `/p/:projectId` | mọi route project-aware có prefix | `packages/api-client/src/utils/project-scope.ts` | URL | ĐÃ XÁC MINH | `project-scope.test.ts` pass |
| ProjectContexts | một context/dự án, cô lập state | `server/project-context.ts` | server | CÓ TRONG CODE | `server/project-context.test.ts` fail 6/6 vì EPERM khi dọn temp → chưa kết luận được, cần CI |
| Project tags/order | gắn tag và thứ tự sidebar | `web/src/lib/project-tags.ts` | UI | ĐÃ XÁC MINH | `project-tags.test.ts`, `project-order.test.ts` pass |
| Global tasks view | chạy 1 task trên nhiều repo | `web/src/lib/global-tasks.ts` | UI `/tasks` | ĐÃ XÁC MINH | `global-tasks.test.ts` pass |
| `ONNI_SINGLE_PROJECT=1` | khoá thêm/bỏ dự án | `capabilities.ts:246` · `projects-cli.ts:57` | env | ĐÃ XÁC MINH | `capabilities.test.ts` pass |
| `ONNI_PROJECTS_DIR` | thư mục chứa clone | `.env.example` | env | CÓ TRONG CODE | `.env.example` |

## 12. Remote / hosted / cài server

| Chức năng | Mô tả ngắn | Nơi trong code | Cách dùng | Trạng thái | Căn cứ |
| --- | --- | --- | --- | --- | --- |
| Ubuntu VPS install | nginx + htpasswd + certbot + systemd che `127.0.0.1` | `server-install/platforms/ubuntu-vps.ts:22,48` · `index.ts:637` | `onni server-install --platform ubuntu-vps` | CÓ TRONG CODE | `ubuntu-vps.test.ts` 1 fail vì cần `sed -i` (không có trên Windows) → chỉ CI mới kết luận được |
| macOS + ngrok | `ngrok --basic-auth` + launchd | `platforms/macosx-ngrok.ts:41` | CLI | CÓ TRONG CODE | `macosx-ngrok.test.ts` 1 fail `ENOENT` (thiết bị macOS) → chỉ CI mới kết luận được |
| `ONNI_REMOTE=1` | cockpit hosted: tắt local handoff, terminal, design mode | `capabilities.ts:196,205,229` | env | ĐÃ XÁC MINH | `capabilities.test.ts` pass |
| Host/Origin guard | allowlist `Host`, same-origin; `/health` CORS-open | `server.ts:1606,1608,1646,1839` | tự động | ĐÃ XÁC MINH | `host-guard.test.ts`, `origin-guard.test.ts` pass |
| **Xác thực người dùng** | **không có** — "bind 127.0.0.1 + same-origin is not a perimeter" | `server.ts:1610` (comment) | — | ĐÃ VÔ HIỆU | code không có middleware auth nào |
| Bind host | `--bind-host` mặc định loopback | `index.ts` flag · `capabilities.ts:196` `isLoopbackHost` | CLI | CÓ TRONG CODE | `capabilities.test.ts` pass |

## 13. Security & privacy

| Chức năng | Mô tả ngắn | Nơi trong code | Cách dùng | Trạng thái | Căn cứ |
| --- | --- | --- | --- | --- | --- |
| Secrets AES-256-GCM | key per-machine, `.key` 0600 hoặc OS keychain | `workspace/secrets.ts:46,48,110-117` · `secret-keyring.ts:34` | Settings · `onni secrets` | ĐÃ XÁC MINH | `server/secrets-api.test.ts` pass; `workspace/secrets.test.ts` 3 fail (chmod/keychain/symlink) → phần at-rest chỉ CI mới kết luận được |
| AAD binds file+name | ciphertext không chuyển được giữa 2 file | `workspace/secrets.ts:449` | tự động | CÓ TRONG CODE | `workspace/secrets.test.ts` fail trên máy này (symlink/chmod) → cần CI |
| Audiences chỉ `checks`,`onni` | **không có audience cho agent** | `contract/secrets.ts:22` | workflow | ĐÃ XÁC MINH | `contract-parity.secrets.test.ts` pass |
| Value cap | 16 KiB mỗi secret | `contract/secrets.ts:14` | API | ĐÃ XÁC MINH | `secrets-api.test.ts` pass |
| Không secret vào `process.env` | tên giống secret bị drop khỏi env agent | `core/agent-env.ts:280,400` · `secret-redaction.ts:28` | tự động | ĐÃ XÁC MINH | `agent-env.test.ts` pass |
| Guard probe for checks | `ONNI_GUARD_PROBE_FOR_CHECKS` chứng minh chỉ audience `checks` mới resolve | `run.ts:8657,8662` | test | CÓ TRONG CODE | `workflows/secrets.test.ts:222` — cả describe fail vì EPERM setup → cần CI |
| Body limits | 32 MiB global · 128 KiB ui-state · 2 MiB branding | `server.ts:1107-1109,1606,3622,3706` | tự động | CÓ TRONG CODE | `request-validation.test.ts` pass |
| Zod tại mọi boundary | `validators.ts`, `bodyLimit`, `typed-bodies` | `packages/work/src/server/validators.ts` | tự động | ĐÃ XÁC MINH | `typed-bodies.test.ts`, `request-validation.test.ts` pass |
| `disclaim-exec` spawn | bỏ cờ exec tự động trên Windows | `core/disclaim-spawn.test.ts` | tự động | ĐÃ XÁC MINH | `disclaim-spawn.test.ts` pass (guard skip) |
| fs browse privacy | chặn duyệt ra ngoài repo | `server/fs-browse-privacy.ts` | API | ĐÃ XÁC MINH | `fs-browse-privacy.test.ts` pass |
| Telemetry | **đã xoá hẳn**, không phải tắt | ADR 0002 | — | ĐÃ VÔ HIỆU | không còn route `/telemetry` nào |
| Self-update từ registry | **đã xoá**; `self-update/` chỉ còn version layout (5 file đều phục vụ layout/link: `layout.ts`, `checkouts.ts`, `cli.ts`, `semver.ts`; `self-update.test.ts` test layout). 2026-10-31: bỏ nốt `WorkspaceSemaphore.activeRuns()/idle()` chỉ phục vụ dialog update-when-idle | `packages/work/src/self-update/` | `onni link` | ĐÃ VÔ HIỆU | `self-update.test.ts` pass |
| Token/cost cap | **Có** (2026-11-01): mỗi run chụp `limits` lúc bắt đầu (`capped` hoặc `none`), trần cost/token/phút/vòng; xem §17. `ONNI_HIDE_*` vẫn chỉ ẩn số liệu | `workflows/limits.ts` · `contract/limits.ts` | Settings → Resources → Limits · composer · `onni run --limit` | ĐÃ XÁC MINH | `workflows/limits.test.ts`, `limits-run.test.ts` pass |

---

## 14. Giới hạn và hằng số đang cứng trong code

| Giá trị | Ở đâu | Ý nghĩa | đổi được bằng |
| --- | --- | --- | --- |
| 2 (min 1, max **16**) | `work/src/config.ts:39` | run song song mỗi workspace | `config.json.resources.maxParallel` |
| 10 | `work/src/config.ts:27,47,303` | worktree giữ lại | `worktreeRetention` |
| 300 / 500 | `work/src/runs/store.ts:504-505` | run / archived giữ lại | `ONNI_RUNS_KEEP`, `ONNI_ARCHIVED_RUNS_KEEP` |
| 15 phút (min 0, max 1440) | `work/src/workspace/config.ts:85,94` | idle timeout | Settings |
| 4 × idle | `work/src/workflows/run.ts:249` | `MONITORING_LIVENESS_MS` | **không** |
| 1 s / 5 s | `run.ts:247` `CANCEL_GRACE_MS`, `:251` `LEFTOVER_SETTLE_GRACE_MS` | grace cancel & reap | **không** |
| 4 / 50 | `contract/src/dispatch.ts:57,59` | con in-flight / subtask | **không** |
| 20 | `work/src/dispatch/engine.ts:30` | report chờ cho một cha | **không** |
| 20 / 28 000 000 | `contract/src/runs.ts:1121,1125` | attachments / tổng base64 | **không** |
| 32 MiB / 128 KiB / 2 MiB+64 KiB | `work/src/server/server.ts:1107-1109`, `:3563,3622,3706` | body limits | **không** |
| 256 000 / 32 / 24 / 60 s | `work/src/server/terminal/sessions.ts:31,35,39,48` | scrollback, sessions, service sessions, giữ session đã exit | **không** |
| 60..86 400 s, default 300 (github) / 1800 (tracker) | `work/src/automations/types.ts:96,112` | chu kỳ poll | `intervalSeconds` |
| ≤90 ngày / ≤100 bản ghi (default 7/25) | `automations/types.ts:38,39` | lookback & cap poll | per-automation |
| 90 ngày | `automations/store.ts:47` | retention receipts/log | **không** |
| 120 s / 60 s / 2 147 483 647 ms | `automations/scheduler.ts:12,302,304` | cursor overlap, retry floor, timer ceiling | **không** |
| 10′ / 24 h / 3 | `automations/schedule-runner.ts:29-31` | grace, catch-up, auto-pause sau N lỗi | **không** |
| 8 MiB / 72 h / 50 MiB | `webhooks/admission.ts:40,158` · `outbox.ts:25` | payload, hạn, outbox | **không** |
| 10 token · 500 ms refill · 3 test/phút · 10 manual fail/60 s | `webhooks/limits.ts:7,48,62-63` | rate limit | **không** |
| 5 s×2^n, trần 1 h · cửa sổ chữ ký 300 s | `webhooks/transport.ts:185` · `signing.ts:16` | backoff, replay window | **không** |
| 4 project song song · 1 in-flight/host | `webhooks/scheduler.ts:21` | delivery concurrency | **không** |
| 16 KiB | `contract/secrets.ts:14` | độ dài secret | **không** |
| 24 h / 512 MiB | `work/src/uploads.ts:18-19` | TTL & cap file đính kèm | **không** |
| 3 cột / 12 tab / 80 ký tự / 50 layout | `workspace-layouts.ts:21-24,53` | bố cục | **không** |
| 100 000 ký tự / 16 surface | `runs/drafts.ts:18,25` | draft | **không** |
| 200 KB / 20 000 / 8 MiB / 512 KB | `server/git-changes.ts:75,489,497,568` | patch, tree, repo scan, file | **không** |
| 30 phút mỗi turn | `claude-cli-runner.ts:40` · `copilot-acp-runner.ts:34` · `pi-runner.ts:22` · `cursor-agent-runner.ts:81` | `DEFAULT_RUN_TIMEOUT_MS` | env per-runner |
| 30 s / 5 s / 10 phút | `opencode-server-runner.ts:45,67,75` | boot, poll, idle | **không** |
| 4 | `core/codex-usage-probe.ts:15` | probe song song | **không** |
| 1–5 bước, 60 s, model `sonnet` | `workflows/planner.ts:19,21,56,69` | planner | **không** |
| sâu 4 / TTL 6 h | `skills.ts:170` · `skills-remote.ts:448,456` | quét skill, cache | **không** |
| `~/.onni/cache/<projectId>` (0700) | `run.ts:8813,8839` | cache share cho check step | `ONNI_SHARED_CACHE_DIR` |

## 15. Điểm mở rộng

| Mở rộng | Copy file nào | Đăng ký ở đâu |
| --- | --- | --- |
| Backend agent mới | `packages/work/src/core/claude-cli-runner.ts` + `claude-ui-mapper.ts` + `claude-model-catalog.ts` | `core/runner-factory.ts:19`, rồi `AGENT_PROTOCOL.md` checklist; bộ `core/claude-cli-runner.test.ts` + `core/claude-ui-mapper.test.ts` là mẫu |
| Loại node workflow mới | `graph.ts:50` schema + `:175 NODE_PORTS` + `:212 NODE_CATALOG` + executor trong `workflows/run.ts` | `graph.ts` (đủ 4 chỗ) |
| Loại automation mới | `automations/github-poller.ts` + `event-poll-cycle.ts:10` | `automations/types.ts:110` (kind enum) + `scheduler.ts:313` |
| Vendor tracker mới | `server/tracker/jira.ts` + `jira-events.ts` | `contract/tracker.ts:4` (union) + `tracker-poller.ts` |
| ~~Webhook channel mới~~ | ~~`webhooks/discord.ts`~~ — đã xoá (ADR 0004); format chỉ còn `onni.json.v1` | `webhooks/transport.ts` + `endpoints.ts` |
| Platform cài server mới | `server-install/platforms/ubuntu-vps.ts:22` | `server-install/index.ts:637` |
| Route mới | `packages/contract/src/runs.ts` (schema) + `server/validators.ts` | chain vào family ở `server.ts`; `route-parity.test.ts` + `contract-parity.runs.test.ts` (15 file `contract-parity*`) bắt đủ 2 mount point |
| Trang cockpit mới | `packages/web/src/routes/dashboard/state.ts` | `packages/web/src/routes.tsx` |
| Provider config file mới | `agent-config/catalog.ts:97 CONFIG_FILES` | catalog đó; model list để riêng ở `core/*-model-catalog.ts` |
| Skill source từ xa mới | `skills-remote.ts:96 safeRemoteFor` | `workspace/config.ts` (`DEFAULT_SKILLS_REPOS:24`) |

## 16. Mã chết, nửa vời hoặc nghi ngờ

| Mục | Hiện tượng | Bằng chứng |
| --- | --- | --- |
| Step status `review` và `skipped` | Khai báo trong `stepStatusSchema` nhưng **không có chỗ nào ghi**: cả 2 chỗ `status:'review'` trong repo đều là cấp run (`store.updateRun`). UI vẫn có nhánh render `skipped` không bao giờ chạy | `contract/runs.ts:69-78` · `server.ts:5829` · `run.ts:7714` · `web/src/routes/task-thread/step-rail.tsx:31,41` |
| `ONNI_AUTO_NAMING` | 2 test stub biến này nhưng **không source nào đọc**; biến thật là `ONNI_AUTONAME` | `workflows/landing-lifecycle.test.ts:16`, `lifecycle-settlement.test.ts:28` vs `runs/auto-name.ts:25` |
| ~~Dispatch depth~~ | **Đã xử lý 2026-11-01**: trần độ sâu mặc định 1 — xem §5 và §17 | |
| ~~`retry_limit` dispatch~~ | **Đã xử lý 2026-11-01**: được thực thi — xem §5 | |
| ~~`maxSubtasks` dispatch~~ | Ghi nhận sai trong bản chụp: bộ đếm có sẵn khi root có `intent`; từ 2026-11-01 cây không `intent` cũng bị trần mặc định 12 | |
| Planner | Chỉ POST được (`server.ts:3869`), **không có nút UI**, plan không lưu: trả về rồi dựng workflow tạm `'(planned)'` (`server.ts:4678`) | `workflows/planner.ts:69` cũng khoá Claude-only |
| Không có xác thực | Mọi thứ dựa vào loopback + origin guard; `server.ts:1610` tự nói "not a perimeter" | chỉ host/port, không session/token |
| ~~Không có trần chi phí cho run thường~~ | **Đã xử lý 2026-11-01** (§17). Bản cài mới mặc định "Bật trần" 10 USD / 10M token / 240 phút / 30 vòng; "Không giới hạn" phải được chọn rõ ràng | |
| `git-worktree` recovery trên Windows | `createWorktree` idempotent trả `path` **forward-slash** lần thứ 2 (`git worktree list`), back-slash lần đầu → `expect(second).toEqual(first)` fail | `git-worktree.test.ts:161` fail; branch/baseBranch vẫn khớp |
| Xoá tracker connection | Xoá file `.env` local, **không revoke** token phía Jira/Linear | `server/tracker/connections-cli.ts:9` |
| `.ai/cezar/` | State runtime của tên cũ (`attachments`, `launch-key`, `runs`, `runs.json`, `tmp`) còn trên đĩa, untracked | `git status` khi chụp |
| `ONNI_DESKTOP_DEBUG_IPC` | Có trong code, không có trong `.env.example` | `desktop/src-tauri/src/lib.rs:1660` |
| Desktop build tại máy này | `cargo build/check` bị Smart App Control chặn (os error 4551) | memory + `AGENTS.md` §Windows |
| 13 test guard theo nền tảng | `describe.skipIf` / `it.skipIf` / `runIf` — không phải `.skip`, nhưng vẫn không chạy trên Windows | `claude-bin.test.ts:18,184`, `cursor-bin.test.ts:20`, `disclaim-spawn.test.ts:40`, `task-processes.test.ts:119`, `agent-tmpdir.test.ts:82`, `store.test.ts:80`, `copilot-acp-runner.smoke.test.ts:34` |
| Webhook inbound | Chỉ có outbound; không route nào nhận POST từ GitHub | `server/webhooks.ts` không có `app.post` inbound; `automations/types.ts:92` polling |

## 17. Mâu thuẫn giữa tài liệu hiện có và code

| Tài liệu | Nói gì | Code nói gì |
| --- | --- | --- |
| `AGENTS.md` (invariants) | "Không có auto-merge anywhere" | Đúng, nhưng `POST /api/v1/github/prs/:number/merge` (`server.ts:6725`) merge **trực tiếp** khi user bấm — tài liệu cần nói rõ đây là nút người bấm, không phải luồng tự động |
| `AGENTS.md` layout | "server phục vụ cockpit từ `packages/work/web/dist`" | Đúng; nhưng cũng có 2 mount point `/api/v1` (`server.ts:7785-7787`) — 380 route đăng ký, **216 route gốc distinct**, 164 path scoped-project. Tài liệu không nêu con số này nên dễ đếm nhầm gấp đôi |
| `AGENTS.md` §Commands | "`npm run test:unit` phủ core modules" | Trên Windows bộ này fail ~340 test vì môi trường (chmod/`/bin.sh`/EPERM) — fail **không** nghĩa là hỏng code; CI là authority |
| `AGENTS.md` §Zero config | "mọi `ONNI_*` đổi tên/thay default phải cập nhật `.env.example` cùng commit" | `ONNI_CODEX_REASONING`, `ONNI_DESKTOP_DEBUG_IPC`, `ONNI_ALLOW_TEST_SPAWN`, `ONNI_GUARD_PROBE_FOR_CHECKS` có trong code mà **không** có trong `.env.example` |
| `docs/reference.md:521` | `VITE_ONNI_API_BASE` là build-time | Đúng (`web/src/main.tsx:21`), và `<meta name="onni-api-base">` thắng — tài liệu nói đúng, nhưng `.env.example:265` chỉ ghi biến env, không ghi meta |
| `docs/project-overview.md:57` | Sơ đồ kênh ghi "SSE `/api/v1/workspace/events` · WS `/api/v1/ws`" | Code có **hai** stream SSE: `/runs/:id/events` (`server.ts:6094`) — chính là dòng mang step/tool/diff của task — và `/workspace/events` (`:6225`), cộng bản root-mount `/events` (`:6177`). Sơ đồ bỏ mất stream quan trọng nhất |
| `.ai/specs/*` | Dùng tên cũ (brand trước khi đổi) + event kind `RUN_EVENT_*` cũ | Source đã đổi sang `onni`/`ONNI_*`; `AGENTS.md` xác nhận specs là hồ sơ lịch sử, **code thắng** |
| `AGENT_PROTOCOL.md` | v1 `AgentEvent` + v2 `UiEvent` | Khớp: `core/agent-runner.ts:161`, `core/ui-events.ts:392` |
| Review gate | Nhiều tài liệu gọi nó là "gate" như thể mặc định bật | Mặc định **TẮT** (`review-gate.ts:16-21`: chỉ `'1'` mới bật; `'true'`/`'yes'` không có tác dụng) và run autonomous luôn bỏ qua |
| Skills | Tài liệu từng gợi ý repo skill có thể cung cấp workflow | `skills.ts` không bao giờ nạp workflow; workflow **chỉ** từ `.ai/onni/workflows/` (`load.ts:15`) |

---

## 17. An toàn khi không giám sát (2026-11-01, nhánh `feat/unattended-safety`)

"Run không giám sát" = `autonomous === true` **hoặc** task con trong cây dispatch (`workflows/unattended.ts`). Thiết kế: [`docs/design/unattended-safety.md`](design/unattended-safety.md); quyết định: [ADR 0005](adr/0005-unattended-safety.md).

| Chức năng | Mô tả ngắn | Nơi trong code | Cách dùng | Trạng thái | Căn cứ |
| --- | --- | --- | --- | --- | --- |
| Hai chế độ trần | `none` = không áp trần nào; `capped` = chỉ áp số đã nhập, ô trống = không giới hạn mục đó. Chụp vào `RunRecord.limits` lúc start | `contract/limits.ts` · `workflows/limits.ts` · `workflows/run.ts` (`startRun`, `sweepLimits`) | Settings → Resources → Limits · composer "Limits" · `onni run --no-limit` / `--limit cost=5,time=120,tokens=5000000,iterations=20` | ĐÃ XÁC MINH | `limits.test.ts`, `limits-run.test.ts`, `runs/stop-cli.test.ts` pass |
| Mặc định cài mới | Bật trần 10 USD · 10 000 000 token · 240 phút · 30 vòng | `contract/limits.ts` (`DEFAULT_RUN_LIMITS`) | Settings → Resources → Limits | ĐÃ XÁC MINH | `limits-run.test.ts` |
| Bộ đếm bền | cost/token cộng từ step; thời gian chạy tích lũy `limitUsage.wallMs` mỗi 15 s; `recover()` không reset | `workflows/run.ts` (`sweepLimits`) | tự động | ĐÃ XÁC MINH | `limits-run.test.ts` (đọc lại store từ đĩa) |
| Cây dùng chung trần gốc | tổng cả cây không vượt trần của root; con nhận phần còn lại của cha, không bao giờ nới hơn cha; con thừa kế chế độ cha | `workflows/limits.ts` (`carveChildLimits`, `evaluateLimits`) | tự động | ĐÃ XÁC MINH | `limits.test.ts`, `limits-run.test.ts` |
| Backend không báo USD | codex, copilot, cursor: trần USD không áp; cursor không báo cả token → chỉ trần thời gian/vòng | `contract/limits.ts` (`RUNNERS_WITHOUT_COST/TOKENS`) | UI ghi "not reported" | ĐÃ XÁC MINH | `limits.test.ts`, `lib/run-limits.test.ts` |
| Chạm trần | run (hoặc cả cây) bị cancel với `limitHit` + `error` nêu trần nào; worktree và session giữ nguyên; Continue yêu cầu `raiseLimits` (cộng thêm một suất của trần đã chạm) | `workflows/run.ts` (`stopForLimit`, `raiseAfterLimit`) | nút Continue hỏi xác nhận | ĐÃ XÁC MINH | `limits-run.test.ts` |
| Chờ trả lời hết hạn | run không giám sát ở `waiting` quá `safety.waitExpiryMinutes` (mặc định 30, 1–1440, không tắt được) → `failed`, `waitExpiredAt`, giữ worktree+session. `waiting`/`review` không giữ slot; `review` không hết hạn | `workflows/run.ts` (`armIdleTimer`) | Settings → Resources → Limits → Advanced | ĐÃ XÁC MINH | `wait-expiry.test.ts` |
| Cấm auto-land | `landingPolicy` trả `undefined` cho run autonomous/con dispatch bất kể config | `workflows/run.ts` · `workflows/unattended.ts` | — | ĐÃ XÁC MINH | `unattended-landing.test.ts` (fail khi gỡ fix) |
| Rào push | hook `pre-push` qua `GIT_CONFIG_*` env cho run không giám sát: chỉ cho `refs/heads/onni/*` + nhánh của run; Claude thêm `--disallowedTools` (`git push`, `gh pr merge`, `git remote add/set-url`); `git.push` node từ chối nhánh base/protected, refspec cố định, không bao giờ `+` | `workflows/push-guard.ts` · `git-worktree.ts` (`pushBranch`) | tự động | ĐÃ XÁC MINH | `push-guard.test.ts` (push thật tới remote bare) |
| Dừng khẩn | `RunManager.cancelAll()` + reap tiến trình con; `POST /api/v1/workspace/stop-all`; nút "Stop all"; `onni stop --all` | `workflows/run.ts` · `server/server.ts` · `runs/stop-cli.ts` | Tasks header · Settings → Resources → Limits | ĐÃ XÁC MINH | `limits-run.test.ts`, `runs/stop-cli.test.ts` |
| Tóm tắt buổi sáng | Inbox: run xong / lỗi / chạm trần / cần chú ý trong N giờ (1–48, mặc định 12), kèm cost/token | `web/src/lib/morning-digest.ts` · `components/morning-digest.tsx` | Inbox | ĐÃ XÁC MINH | `lib/morning-digest.test.ts` |
| Thông báo desktop | `tauri-plugin-notification` + `__TAURI_INTERNALS__.invoke`, dùng chung công tắc Settings → Notifications; chỉ khi cửa sổ ẩn | `desktop/src-tauri` · `web/src/lib/desktop-notify.ts` | Settings → Notifications | CÓ TRONG CODE | `desktop-notify.test.ts` pass; `cargo check` pass; chưa chạy shell thật |

**Giới hạn đã biết:** hook pre-push và deny rule là *rào*, không phải sandbox — `git push --no-verify`, agent gỡ biến môi trường, ghi ngoài worktree, `$HOME` và mạng không bị chặn (backend khác Claude không có seam deny).

