# AUDIT_REPORT.md — Onni Work trước khi build desktop

Ngày audit: 2026-11-01 (Asia/Bangkok)  
Trạng thái: Pha 1 đã hoàn tất. Pha 2: F-07, F-01 và F-03 đã hoàn tất; F-02, F-04–F-06 còn lại.

## Kết luận điều hành

### CHƯA SẴN SÀNG để sign-off một bản desktop cài được ngay

Build/typecheck TypeScript pass; Tauri compile/test pass; installer NSIS cũng build được khi chọn target tường minh. F-07 đã qua đầy đủ UI smoke: health sau 1,633 ms, tạo/cancel `mock:slow`, thoát app rồi mở lại thấy task vẫn Cancelled. Hai smoke ẩn cũ timeout; chúng dùng `Start-Process -WindowStyle Hidden`, và lần chạy lại không ghi `supervisor-start`, vì thế không đại diện cho desktop UI được hỗ trợ. Chưa xác minh cài/gỡ installer trên Windows; ba nhóm test Node không hoàn tất do lỗi môi trường; build mặc định chỉ tạo executable. Trên máy mới, shell còn cần Node 20+ và engine đã build/link trước khi chạy.

F-07 được phân loại là lỗi của audit harness, không phải lỗi của desktop path được hỗ trợ: hai lần timeout trước dùng executable ẩn; lần smoke ẩn mới nhất không vào `supervisor-start`, còn lần chạy có UI thật spawn Node và trả health sau 1,633 ms. Task `mock:slow` được tạo/cancel, app thoát, rồi sau khi mở lại task vẫn hiện trạng thái Cancelled (ảnh chụp người dùng cung cấp). Logger cục bộ và script smoke nhìn thấy cửa sổ được thêm để không mất bằng chứng nếu lỗi tái diễn. F-01 đã sửa: build dọn `packages/work/dist` trước `tsc`; pack gate kiểm tra mọi output có source tương ứng và chặn module legacy. Build sạch hiện có 897 file trong dist, tất cả khớp source; 72 output legacy từ inventory ban đầu không còn. F-03 đã thêm `npm run build:windows` để tạo NSIS; lệnh build mặc định và target nền tảng khác không đổi. Installer NSIS đã build được để thử nội bộ, nhưng chưa có bằng chứng đủ để cam kết flow cài/gỡ.

## 0. Phạm vi và điều kiện

- Audit source hiện có trong repo, tập trung các luồng đang dùng và artifact desktop Windows. Pha 1 chỉ đọc/chạy kiểm tra; không sửa code sản phẩm. File này là artifact được yêu cầu.
- `git status --short` trước khi audit báo tám file ADR bị xóa dưới `docs/adr/0001`–`0008`. Đây là thay đổi có sẵn của working tree; audit không khôi phục hay sửa chúng. Các link trong `AGENTS.md` và tài liệu khác tới các ADR này cần được đánh giá như trạng thái đầu vào hiện tại.
- Hướng dẫn repo được cung cấp trong yêu cầu được đối chiếu với `AGENTS.md`. Mã nguồn và `AGENTS.md` là chuẩn khi spec cũ bất đồng.
- Môi trường ban đầu: Windows 11/PowerShell; `node` v24.21.0; `npm.cmd` 11.19.0; `cargo`/`rustc` 1.99.1. `sh` không có trên PATH, WSL chưa cài; lệnh `npm` PowerShell shim bị ExecutionPolicy chặn nhưng `npm.cmd` chạy được. Các điều kiện này ảnh hưởng test/build được ghi cụ thể bên dưới.

## 1. Bản đồ hệ thống và luồng phát hiện (Pha A)

### Kiến trúc

| Thành phần | Vai trò và điểm vào | Mã nguồn chính |
|---|---|---|
| Desktop Tauri 2 | Ứng dụng native, một cửa sổ webview, tray/menu, thông báo, giám sát tiến trình Node sidecar; chọn cổng loopback và chờ `/api/v1/health`. Đọc engine đã build từ `ONNI_DESKTOP_ENTRY` hoặc `~/.onni/versions/current`; không tự tải engine/Node. | `packages/desktop/src-tauri/src/lib.rs`, `main.rs`, `disclaim.rs`; `tauri.conf.json`; `capabilities/default.json`; `packages/desktop/ui/index.html` |
| Engine/CLI Node 20+ | CLI `onni`/`onni run`, khởi động Hono server, quản lý project, run/worktree, workflow, giới hạn, recovery và lịch. | `packages/work/src/index.ts`; `packages/work/src/server/server.ts`; `runs/`; `workflows/`; `automations/` |
| HTTP contract/client | Zod schemas dùng chung; client typed cho REST, SSE, WebSocket. API versioned `/api/v1`; project route có alias boot và `/p/:projectId`. | `packages/contract/src/`; `packages/api-client/src/`; `server/server.ts` |
| Cockpit | React 19/Vite; task list/thread, inbox, dashboard, repo, GitHub, tracker, workflow, automations, settings, terminal, preview, project/workspace navigation. | `packages/web/src/app.tsx`, `routes.tsx`, `routes/`, `api/`, `components/`, `lib/` |
| State | JSON/NDJSON/Markdown cục bộ, không database/cloud. Dữ liệu repo ở `.ai/onni/`; registry, config, secret và engine versions ở `~/.onni/`; cache có thể xóa ở `~/.cache/onni/`. | `packages/work/src/paths.ts`, `data-gitignore.ts`, `runs/store.ts`, `workspace/`, `BACKWARD_COMPATIBILITY.md` §§3,9 |
| Build/CI | Root npm workspaces: contract, API client, work, web. Desktop cố ý tách workspace, có lockfile/npm install riêng và Cargo lockfile riêng. | `package.json`; `packages/desktop/package.json`; `packages/desktop/src-tauri/Cargo.toml`; `.github/workflows/` |

### Luồng và chế độ cần kiểm tra

1. Khởi động CLI/server; chọn repo hoặc project; phục hồi run sau restart; serve UI tĩnh hoặc dev proxy. (`work/src/index.ts`, `server/server.ts`, `scripts/dev.mjs`)
2. Khởi động desktop: kiểm tra Node, phân giải engine, chọn project/cổng, spawn sidecar, readiness qua health, điều hướng webview, restart/switch engine, tray/close/quit và badge. (`desktop/src-tauri/src/lib.rs`)
3. Tạo task từ UI/API/CLI; workflow YAML/graph hoặc `quick-task`; tạo branch/worktree; chạy check/agent; stream event/tokens; lưu run/events; cập nhật UI qua SSE/WS. (`server/server.ts`, `workflows/run.ts`, `git-worktree.ts`, `runs/store.ts`, `api-client/src/protocol/`)
4. Run mode và vòng đời: queued/deferred, running, waiting/ask, monitoring/wake, review, done, failed/cancelled; retry/continue/resume/limit/usage reset; cancel hoặc app/server crash; boot recovery. (`contract/src/runs.ts`, `workflows/run.ts`, `workflows/limits.ts`, `runs/store.ts`)
5. Git/worktree và lifecycle: diff/base, file browser/edit, commit/push, sync/fetch/pull, branch, reclaim/retention, task process cleanup; review gate, draft PR, mở/adopt PR. (`git-worktree.ts`, `git-diff-base.ts`, `server/server.ts`, `worktree-lifecycle/`)
6. Runner/backend: Claude, Codex, OpenCode, Cursor, Pi, Junie, Copilot, Cline, Antigravity; model/auth/profile probe, session resume, event mapping, terminal conditions; dry-run mocks. (`core/runner-factory.ts`, `core/*runner.ts`, `AGENT_PROTOCOL.md`)
7. Dispatch và manager/worker roster; lệnh `onni task create/report/list`, tree budget/depth/worker restrictions; child task reporting. (`workflows/manager-worker.ts`, `server/server.ts`, `workflows/limits.ts`)
8. Automation theo lịch/GitHub, deferred start, tracker poll/watch, receipts/state, task khởi chạy và pause/disable. (`automations/`, `server/tracker/`)
9. Workflow webhook outbound; project lifecycle webhook receiver; launch-key/deep link; GitHub PR/issues/comments/checks; Jira/Linear; GitHub `gh` CLI. (`workflows/graph.ts`, `webhooks/`, `server/forge/`, `server/tracker/`)
10. Terminal tương tác trong worktree; URL/command discovery; mở app/terminal ngoài; preview proxy/Design Mode/iframe. (`server/terminal/`, `server/preview/`, `server/open-in-app.ts`)
11. Settings/config: agent account/profile, provider auth/model, secrets, tracker connection, workspace/project registry, run limits, UI state, workflow/skills, e2e setup, browse root, agent config files. (`workspace/`, `server/server.ts`, `packages/web/src/routes/settings/`)
12. Inbox/follow-ups; handoff journal, attachments/uploads, drafts/layouts; dashboard/usage/host data. (`todos.ts`, `handoff.ts`, `uploads.ts`, `server/dashboard.ts`, `workspace/usage-windows.ts`)
13. CLI headless `onni run`; `init`, `projects`, `runs`, `task`, `automation`, `secrets`, tracker connections, server install/deploy/uninstall, link/unlink. (`work/src/index.ts`)
14. Build/package npm tarball guard; Vite static bundle; Tauri app bundle; runtime entry/asset inclusion; Windows install/update/uninstall and persisted data. (`package.json`, `work/scripts/check-pack.mjs`, `desktop/src-tauri/tauri.conf.json`, `.github/workflows/desktop-check.yml`)

### Tích hợp ngoài và ranh giới tin cậy

- Coding-agent CLIs/provider sessions: `claude`, `codex`, `opencode`, `cursor-agent`, `pi`, `junie`, `copilot`, `cline`, `agy`; từng runner spawn tiến trình cục bộ với prompt, cwd/worktree, env và permission mode.
- Git executable/worktrees/remotes/hooks; GitHub qua `gh`/GitHub HTTP; Jira/Linear qua API credentials theo project; webhook destinations/receivers; agent MCP servers và project-local MCP configuration.
- Optional native modules `@lydell/node-pty`, `@napi-rs/keyring`; Tauri/WebView2, Rust crates, Node/npm. Preview/Design Mode mở kết nối loopback; hosted bind, workflow webhook, remote terminal/account features widens exposure only under explicit configuration.
- Ranh giới quan trọng: browser/API → filesystem paths, worktree operations, secret/tracker storage, local process spawn/terminal, external URL fetch/post, webhook signature/launch key, desktop webview → Tauri IPC, sidecar environment → child CLIs.
- HTTP loopback default, Host/Origin checks, body limits, CORS health exception, WebSocket upgrade validation và capability gates tập trung trong `work/src/server/server.ts`; desktop chỉ tin splash/cockpit của port do chính shell chọn theo `desktop/src-tauri/src/lib.rs`.

## 2. Kế hoạch kiểm tra đã dùng (Pha B)

1. Đọc cấu trúc repo, hướng dẫn được cung cấp, entry point, routes/contracts, workflow/run lifecycle, integrations, persistence, process boundaries, desktop shell/config và CI; lập bản đồ ở §1.
2. Chạy kiểm tra TypeScript, Vitest, node:test, package tests, build và pack gate. Ghi nguyên văn các lỗi môi trường; không skip test và không sửa source.
3. Chạy cargo check/test cho Tauri trên Windows; build desktop mặc định rồi thử tạo NSIS bằng lệnh tường minh.
4. Đọc các ranh giới bảo mật, lưu trữ/atomic write, task process cleanup, các nhánh Node/engine thiếu, và đối chiếu spec cũ với implementation hiện tại.
5. Dùng repo và ONNI_HOME tạm cùng ONNI_DRY_RUN=1 cho smoke flow desktop nếu cài được; không dùng credential hoặc project thật. Script thử cài/gọi/gỡ nằm trong .tmp/audit/desktop-install-smoke.ps1.
6. Quét artifact pack và source để tìm mã Cezar/tính năng đã bỏ; rà soát lại từng dòng trong bản đồ để phân biệt chạy thật, đọc tĩnh và chưa xác minh.

Kế hoạch chạm tới UI, API/IPC, CLI, lifecycle task, workflow/automation, agent runners, integrations, state, process management, security, build/package, CI và Windows. Các integration cần tài khoản/credential hoặc dịch vụ ngoài được đọc tĩnh, không gọi thật để tránh tác động tài khoản/dữ liệu.

### Kết quả lệnh chính

| Lệnh | Kết quả |
|---|---|
| npm.cmd run typecheck | ✅ Pass: contract, API client, server, web. Lệnh cũng build server trước typecheck. |
| npm.cmd test | ❌ Không hoàn tất. Chạy hơn 9 phút rồi dừng sau nhiều lỗi Windows-shaped và timeout; không có summary đầy đủ. Thấy EPERM, path/permission khác POSIX, Git ignore permission denied, Filename too long, và Node uv_os_get_passwd returned ENOMEM. |
| npm.cmd run test:unit | ❌ 7/7 file dừng trước test vì Node/tsx uv_os_get_passwd returned ENOMEM. |
| npm.cmd run test:package | ❌ Dừng trước test vì cùng lỗi uv_os_get_passwd returned ENOMEM. |
| npm.cmd run test:e2e | ❌ Script gọi sh .ai/scripts/e2e.sh; Windows báo sh is not recognized. WSL không cài. |
| npm.cmd run build ở repo root | ✅ Pass TypeScript, Vite và check:pack sau khi đặt npm_config_cache vào .tmp/audit/npm-cache; cache npm mặc định trong profile gây EPERM. Vite báo một chunk minified >500 KB. |
| cargo check --locked --all-targets (packages/desktop/src-tauri) | ✅ Pass trên Windows. |
| cargo test --locked --lib | ✅ 19 pass, 0 fail, 3 ignored. |
| cargo test --locked --lib -- --ignored --test-threads=1 | ✅ 3 ignored test được gọi tường minh đều pass, gồm Node trên PATH, sidecar health handshake và splash script parse. |
| npm.cmd run build (packages/desktop) | ✅ Pass; tạo src-tauri/target/release/onni-desktop.exe. Không tạo installer với cấu hình target mặc định. |
| npm.cmd run tauri -- build --bundles nsis | ✅ Pass; tạo src-tauri/target/release/bundle/nsis/Onni Work_0.1.11_x64-setup.exe (2,718,160 bytes). |
| npm.cmd pack --dry-run --json --workspace=@onni/work | ✅ Chạy với cache riêng; tarball dự kiến 1,151 file, 4,143,389 bytes nén. Phát hiện các output cũ được ghi ở F-01. |
| node.exe packages/work/dist/index.js serve --no-open --port 54321 --repo .tmp/audit/engine-repo (ONNI_DRY_RUN=1, ONNI_HOME=.tmp/audit/engine-home) | ✅ health 0.17.0-dev; mock:done → done; mock:slow cancel → cancelled; runs.json được ghi. Sau restart, GET hai run cũ trả lại cả hai. |

Không coi lỗi Node/Windows của các suite là lỗi sản phẩm đã xác nhận. Chúng khiến chưa có một lượt test suite đầy đủ để sign-off.

## 3. Phát hiện

| ID | Mức độ | Khu vực | Mô tả | Bằng chứng / cách tái hiện | Nguyên nhân gốc | Đề xuất sửa + công |
|---|---|---|---|---|---|---|
| F-01 | P2 — đã sửa | Build / npm package | Baseline tarball chứa 24 nhóm output JavaScript mồ côi (72 entry tính cả .js, .d.ts và .js.map), gồm feature telemetry, self-update cũ, star-count, Slack/Discord, skills-update, install-as-command và module release/run. Nội dung artifact cũ nhắc Cezar, @open-mercato/cezar và telemetry path đã xóa. | Trước sửa: pack dry-run liệt kê 72 output entry legacy không có source. Sau sửa: `npm run build` pass; `check:pack` duyệt 897 file dist và không có source gap; 72 output legacy từ inventory ban đầu không còn. Quét Cezar, `@open-mercato/cezar`, `cezar telemetry`, `telemetry-service.json`, `stamp-telemetry-service` và `Settings → Privacy` trong dist không tìm thấy kết quả. Regression tests xác nhận output thiếu source, suffix không hỗ trợ và denylist làm gate fail. Các từ telemetry ở module hiện hành khác vẫn được giữ vì mô tả token/resource telemetry cục bộ. | `tsc` ghi output mới nhưng không xóa file từ source đã bị xóa; pack manifest chọn toàn bộ thư mục `dist`. | Đã thêm clean trước build và source mapping + denylist trong pack gate. Commit `fix(F-01): clean build outputs and reject stale package files`. M. |
| F-02 | P1* | Desktop / triển khai máy mới | Desktop là shell mỏng, không kèm engine Onni hoặc Node. Lần chạy đầu trên máy chưa có Node 20+ và engine đã build/link chỉ hiện trang hướng dẫn; không tự cài runtime/engine. Vì vậy NSIS không phải installer độc lập cho máy Windows sạch. | packages/desktop/src-tauri/src/lib.rs:701-711, 907-935, 1628-1657: tìm Node, lấy entry từ ONNI_DESKTOP_ENTRY hoặc ~/.onni/versions/current; thiếu thì hiện hướng dẫn npm install, npm run build, onni link --use. Tái hiện logic bằng máy không có Node hoặc version link. Đây là hành vi được thiết kế, không phải crash. | Engine và Node được tách khỏi shell để dùng Node/CLI của người dùng; installer không bootstrap phần phụ thuộc. | Nếu chỉ dùng trên máy dev hiện tại: thêm bước build + onni link --use vào quy trình. Nếu muốn cài cho máy sạch: đóng gói engine/runtime hoặc tạo onboarding/bootstrapper riêng; S cho tài liệu, L cho bootstrapper. P1* chỉ áp dụng cho mục tiêu “cài installer trên máy sạch là dùng được”. |
| F-03 | P2 — đã sửa | Desktop build target | Build mặc định trong `packages/desktop` chỉ tạo executable `onni-desktop.exe`, không tạo MSI/NSIS; target cấu hình Tauri là `app`. | Trước sửa: `npm run build` không sinh installer; lệnh Tauri tường minh `--bundles nsis` đã được chạy trực tiếp. Sau sửa: `npm run build:windows` pass và tạo `Onni Work_0.1.11_x64-setup.exe` (2,730,954 bytes) tại `.tmp/audit/desktop-target/release/bundle/nsis/`. Root typecheck pass; `cargo test --locked --lib` pass 20, 3 ignored. Build dùng target riêng vì executable release đang chạy và bị khóa; không dừng process người dùng. | Script build desktop không chọn bundle target Windows; `tauri.conf.json` vẫn cấu hình `app`. | Thêm `build:windows` gọi `tauri build --bundles nsis`; cập nhật lệnh trong AGENTS.md. Commit `fix(F-03): add explicit Windows NSIS build command`. S. |
| F-04 | P2 | Tài liệu desktop | Spec desktop distribution vẫn mô tả tải Node từ nodejs.org, tải/cài engine từ registry và cơ chế update cũ. Code hiện tại nói rõ không download engine/Node và engine phải được build + link thủ công. Dùng spec này làm runbook sẽ dẫn người build sai kỳ vọng. | .ai/specs/2026-09-25-desktop-distribution.md:150-159, 266-275 đối chiếu packages/desktop/src-tauri/src/lib.rs:905-935 và docs/reference.md:1137-1154. | Spec upstream chưa được sửa/đánh dấu superseded khi chủ đích distribution thay đổi; AGENTS.md/code mới hơn và thắng spec. | Đánh dấu spec cũ superseded, viết runbook desktop hiện hành gồm Node 20+, build engine, link, build NSIS/MSI. S. |
| F-05 | P2 (rủi ro chưa tái hiện) | Windows process cleanup | Bộ quét process sót lại sau task settle chỉ hỗ trợ Linux/macOS; Windows luôn nhận danh sách rỗng. Sidecar Tauri cũng chỉ gửi SIGTERM + grace trên macOS, còn Windows đi thẳng child.kill(). Nếu agent/test sinh process con sống độc lập hoặc app thoát giữa lúc chạy, chưa có bảo đảm dọn process tree trên Windows. Chưa tái hiện được với agent CLI thật. | packages/work/src/core/task-processes.ts:1-12, 128-133; packages/work/src/workflows/run.ts:2623-2628; giới hạn này được ghi ở docs/reference.md:517. packages/desktop/src-tauri/src/lib.rs:475-493, 668-675 hard-kill sidecar ngoài macOS. | Không có enumerator/process-group/Job Object Windows trong cơ chế reaper; shell Windows không có nhánh graceful stop cho Node. | Thêm Windows Job Object hoặc process-tree ownership/termination; kiểm thử task tạo process con, cancel, close/crash và xác nhận port/process sạch. M. |
| F-06 | P3 | Artifact cục bộ | Thư mục build còn installer cũ Cezar_0.1.11_x64-setup.exe (10/30) song song với installer Onni mới (11/01). Đây là file ignored, không được tạo bởi lệnh build audit hiện tại; có thể chọn nhầm khi phát hành thủ công. | packages/desktop/src-tauri/target/release/bundle/nsis/ chứa cả hai file. Quét source hiện hành không tìm thấy Cezar ở code desktop/work/web; tarball vẫn chứa output cũ theo F-01. | Build không dọn artifact cũ và cả hai cùng nằm trong cùng thư mục bundle. | Dọn/chuyển output trước khi phát hành; dùng thư mục artifact versioned riêng. S. |
| F-07 | P1 (đã xác minh; không cần sửa product behavior) | Desktop Windows launch | Hai smoke cũ dùng `Start-Process -WindowStyle Hidden` và timeout 60 giây. Lần smoke ẩn lặp lại sau khi thêm logger không ghi `supervisor-start`, nên không có bằng chứng sidecar được spawn. Ngược lại, executable có UI thật đã qua Node check, spawn với entry/cwd/args hợp lệ, health `0.17.0-dev` sau 1,633 ms; task `mock:slow` được cancel, app thoát và mở lại vẫn thấy task Cancelled. | Log UI người dùng gửi ngày 2026-11-01: entry linked canonical thành `\\?\D:\Multi Agent\packages\work\dist\index.js`; `health-ok elapsed_ms=1633`; `app-exit` ghi sidecar được dừng khi shell thoát. `.ai/onni/runs.json` xác nhận run `mock:slow` là cancelled; ảnh chụp sau lần mở lại cho thấy task vẫn hiển thị Cancelled. Typecheck, `cargo check --locked --all-targets`, `cargo test --lib` (20 pass), 3 test ignored chạy riêng và build desktop đều pass. | Finding xuất phát từ harness chạy executable ẩn, không có UI; timeout đó không chứng minh lỗi sidecar trong luồng desktop được hỗ trợ. Không xác định sâu vì sao lần ẩn không ghi `supervisor-start`. Không đổi hành vi khởi động; thêm diagnostics và script smoke chạy với UI để phát hiện health pass/fail. | Commit `fix(F-07): log and verify desktop sidecar startup`. Đã xác minh bằng UI thật; giữ script `packages/desktop/scripts/collect-startup-diagnostics.ps1` cho lần chạy chẩn đoán sau. Không dùng smoke ẩn làm tiêu chí F-07. M. |

P1* là điều kiện phát hành: không chặn build dùng cá nhân trên máy đã có Node + engine, nhưng chặn cam kết “cài installer trên máy sạch là dùng được”. Không phát hiện P0 đã xác nhận. LICENSE và NOTICE có ở repo; chưa xác nhận được nội dung thực sự bên trong NSIS do vòng cài/extract không hoàn tất.

## 4. Độ phủ

| Luồng/chế độ | Trạng thái | Bằng chứng/kết quả |
|---|---|---|
| Kiến trúc, entry point desktop/CLI/API/UI, workspace/package | 🔍 đọc code | Bản đồ ở §1; TypeScript typecheck pass. |
| Desktop khởi động, dò Node/engine, health handshake | ✅ UI smoke | UI thật: Node check pass, linked entry canonical path có `\\?\`, health pass sau 1,633 ms; tạo/cancel mock task, thoát app, mở lại và task vẫn ở trạng thái Cancelled. Smoke ẩn không được tính vì không ghi `supervisor-start`. Xem F-07. |
| Cài đặt/chạy/gỡ NSIS, license trong installer | ❌ chưa xác minh | Đã tạo .tmp/audit/desktop-install-smoke.ps1 với thư mục cài/repo/home tạm; gọi NSIS im lặng nhưng thư mục đích không xuất hiện. HKCU Uninstall key không tồn tại và không tìm thấy thư mục shortcut Start Menu khớp; không kết luận registry toàn máy. Nguyên nhân invocation chưa rõ; không kết luận installer lỗi. CUA/native UI host không khả dụng để xử lý prompt hoặc kiểm tra màn hình. |
| CLI/headless onni, onni run, init/link/unlink | 🔍 đọc code | Test package không chạy được vì Node uv_os_get_passwd ENOMEM. |
| Engine HTTP task/cancel/restart persistence | ✅ chạy thật | Direct Node engine trên repo mẫu: health, mock:done, mock:slow cancellation và readback hai run sau restart đều pass. Không thay thế smoke Tauri shell. |
| Tạo task bình thường, run state/event/UI stream | 🔍 đọc code | Đã lần UI → typed client → Hono route → RunManager/store. Direct Node REST smoke tạo/đọc task; chưa chạy UI/SSE/WS end-to-end. |
| Cancel, timeout, resume/recovery, concurrency/limits | 🔍 đọc code | Đã rà transitions, timers và store; direct smoke xác nhận cancel. Timeout, resume/recovery, concurrency và limits chưa chạy thật; suite regression không có kết quả đầy đủ. |
| Workflow graph, quick-task, skill/automation | 🔍 đọc code | Không chạy agent/network flow. |
| Git/worktree/diff/review/PR | 🔍 đọc code | Direct Node smoke chạy task trên repo mẫu; không kiểm tra diff/worktree/cleanup và không tạo PR. |
| 9 agent backends, auth/profile/session, token mapping | 🔍 đọc code | Không chạy CLI thật; không dùng credential của người dùng. |
| Manager/worker dispatch và roster | 🔍 đọc code | Chưa chạy cây task thật. |
| Scheduled automations, tracker Jira/Linear, GitHub/gh, webhooks | 🔍 đọc code | Chưa gọi dịch vụ ngoài hoặc dùng credential. |
| Terminal/PTY, preview, Design Mode, app launch | 🔍 đọc code | Không xác nhận runtime Windows/PTY/browser. |
| Settings, secrets, project registry, uploads/attachments, JSON/NDJSON state | 🔍/✅ một phần | Đã rà atomic write; desktop UI tạo task mock, lưu Cancelled và đọc lại task đó sau khi mở lại app. Các trạng thái/flows khác chưa kiểm tra end-to-end. |
| Request origin/Host, CORS, loopback và WebSocket boundary | 🔍 đọc code | server.ts có body limit, Host allowlist và same-origin write guard; chưa fuzz/test HTTP trong lượt này. |
| npm build/typecheck/pack gate | ✅ chạy thật | Root typecheck pass; clean root build và pack dry-run pass với npm cache trong workspace. `check:pack` xác nhận 897 dist files có source tương ứng, không có legacy output; 1,080 file trong tarball mô phỏng. |
| Vitest, node:test, package tests | ❌ không hoàn tất | npm test bị ngắt sau nhiều lỗi môi trường/timeout; unit/package test dừng trước test ở uv_os_get_passwd returned ENOMEM. |
| Tauri Rust check/unit tests | ✅ chạy thật | cargo check --locked --all-targets; 20 test thường và 3 test ignored chạy tường minh đều pass. |
| Windows artifact build | ✅ chạy thật | Default target vẫn tạo executable; `npm run build:windows` tạo NSIS qua target build riêng: `.tmp/audit/desktop-target/release/bundle/nsis/Onni Work_0.1.11_x64-setup.exe` (2,730,954 bytes). |
| E2E browser suite | ❌ không chạy | sh không có trên PATH, WSL không cài. |
| MIT/NOTICE và Cezar/service remnants trong package | 🔍 một phần | Root LICENSE, NOTICE, packages/work/LICENSE hiện diện; pack dry-run xác nhận legacy files còn trong dist. Nội dung NSIS chưa kiểm tra được. |

## 5. Những gì chưa kiểm tra được

- Không chạy đầy đủ npm test, test:unit, test:package do lỗi Windows/runtime nêu trên; kết quả không thay thế bằng CI.
- E2E không chạy do thiếu sh và WSL. Computer-use native pipe/browser host cũng không khả dụng, nên không kiểm tra splash, giao diện sau cài, menu/tray, prompt hoặc thao tác gỡ qua UI.
- NSIS installer được build nhưng không xác minh được install/uninstall trong môi trường cô lập: silent invocation không tạo thư mục cài đích. Chưa biết đây là tham số invocation, môi trường Windows hay lỗi installer. HKCU Uninstall key không tồn tại; không thấy thư mục Start Menu khớp. Chỉ kiểm tra profile user hiện tại, không kết luận về HKLM. Hai thư mục AppData có timestamp 10/30 đã tồn tại trước audit và không bị thay đổi.
- Không chạy agent CLI thật, GitHub/Jira/Linear, webhook, MCP, network integrations, Design Mode, terminal PTY hoặc automation scheduler; các mục này chỉ được đọc tĩnh để tránh credential/network side effect.
- F-07 đã xác minh qua UI thật. Hai smoke ẩn không vào `supervisor-start`, nên không đại diện cho desktop launch có UI. Chưa xác minh process descendant do agent tạo, installer install/uninstall, hoặc giữ dữ liệu qua uninstall.
- Nội dung license/NOTICE trong installer và việc installer được SmartScreen đối xử ra sao chưa xác minh. File setup build hiện tại là unsigned (Get-AuthenticodeSignature: NotSigned).
- Working tree ban đầu có tám ADR bị xóa (docs/adr/0001–0008); đây là thay đổi có sẵn, audit không sửa/khôi phục. Build output và .tmp/audit/ là ignored artifacts.

## 6. Thứ tự sửa đề xuất

1. **Tauri sidecar launch:** F-07 đã xác minh; không cần sửa hành vi sản phẩm. Diagnostic logger ghi stdout/stderr, env đã che, args/cwd/entry, health và exit; script `packages/desktop/scripts/collect-startup-diagnostics.ps1` tự báo `SIDECAR_HEALTH=PASS/FAIL` trong phiên Windows có UI.
2. **Build sạch và package gate:** F-01 đã hoàn tất trong commit `fix(F-01): clean build outputs and reject stale package files`. Clean build xóa 72 output cũ; pack gate xác nhận output còn lại đều có source và gói vẫn chứa cockpit.
3. **Quy trình desktop Windows:** F-03 đã hoàn tất trong commit `fix(F-03): add explicit Windows NSIS build command`; hướng dẫn ghi rõ `npm run build:windows`, target `app` mặc định không đổi. F-02 chỉ ghi chú khi thiếu Node/engine; F-03 không thay đổi phạm vi bootstrap.
4. **Tính nhất quán tài liệu:** F-04. Gắn nhãn spec phân phối cũ là superseded và cập nhật hướng dẫn từ code hiện tại.
5. **Dọn process trên Windows:** F-05. Thiết kế/kiểm thử cơ chế task process ownership trước khi khẳng định cancel/quit dọn mọi descendant.
6. **Artifact hygiene:** F-06. Tách output build theo version/commit hoặc dọn release folder trước khi phát hành.

Các bước sửa thuộc Giai đoạn 2; audit này không sửa code sản phẩm.

## 7. Checklist trước khi build desktop

- [x] Mở lại executable trong phiên UI thật và xác nhận task `mock:slow` còn hiển thị với trạng thái Cancelled.
- [x] Chạy build sạch; check:pack xác nhận 897 output dist khớp source và không còn 72 output legacy từ inventory F-01, gồm các nhóm Cezar/service telemetry, star-count, Slack/Discord và self-update registry.
- [ ] Chạy npm.cmd run typecheck, Vitest, test:unit, test:package trên môi trường được repo hỗ trợ (CI/WSL phù hợp); không coi lượt Windows bị EPERM/ENOMEM là pass.
- [x] Chốt lệnh tạo artifact Windows: `npm run build:windows` tạo NSIS; `npm run build` vẫn giữ target mặc định và không sinh installer.
- [ ] Chuẩn bị Node 20+ và engine đã build + onni link --use, hoặc quyết định/cung cấp quy trình đóng gói runtime/engine cho máy sạch.
- [ ] Kiểm tra installer trong VM/user profile tạm: cài, chạy, health, task dry-run, cancel, restart và đọc lại state, uninstall; xác nhận process/port/temp/worktree được dọn.
- [ ] Kiểm tra file license/NOTICE thật trong installer và các cảnh báo signing/SmartScreen trước khi chia sẻ binary.
- [ ] Đối chiếu ID/tên/URL/service của artifact vừa tạo; không chọn nhầm file Cezar_0.1.11_x64-setup.exe cũ trong thư mục ignored.
- [ ] Khi smoke pass, kiểm tra git status --short; giữ nguyên tám ADR bị xóa có sẵn nếu chúng không thuộc phạm vi build.









