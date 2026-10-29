# Tổng quan dự án Onni Work

> Báo cáo cấu trúc – kiến trúc – luồng hoạt động – chức năng của repo tại `D:\Multi Agent`.
> Cập nhật: 2026-10-29. Nội dung phản ánh trạng thái mã nguồn hiện tại (commit `5f81448`, nhánh `dev`).
>
> Lưu ý: đây là ảnh chụp **trước** Phase 2 (fork hardening). Các thay đổi về license, updater,
> telemetry, star-count, skills mặc định và publish nằm ở [`docs/upstream-audit.md`](upstream-audit.md) §10.

---

## 1. Dự án là gì

Onni Work là một **cockpit chạy local để điều phối nhiều AI coding agent song song** trên một repo.
Người dùng nhập task, chọn workflow và backend (Claude Code, Codex, OpenCode, Cursor, Copilot ACP, Junie, Pi),
rồi theo dõi agent làm việc theo thời gian thực: từng bước, tool call, token, diff.

Các nguyên tắc cốt lõi:

- **Local-first**: không account, không database, không cloud. Trạng thái là JSON/NDJSON/Markdown trên đĩa.
- **Zero-config**: mọi thứ được *khám phá* từ repo, môi trường, `gh`; thiếu dependency thì hệ thống thu nhỏ lại chứ không chết.
- **Cách ly bằng git worktree**: mỗi task chạy trong worktree + branch riêng, kết thúc ở **review gate**, không bao giờ tự merge.
- **Bề mặt chính là app desktop** (Tauri), HTTP loopback chỉ là transport nội bộ.

---

## 2. Trạng thái repo hiện tại

| Hạng mục | Giá trị |
| --- | --- |
| Remote | `origin` → `https://github.com/doantuan22/Onni_Work.git` |
| Nhánh | `main` và `dev` (đang đứng ở `dev`), cùng trỏ một commit |
| Lịch sử | 1 commit gốc: `d5146dc Initial commit: Onni Work` + `5f81448 docs: clear README` |
| Tag | không còn (đã xoá toàn bộ tag upstream) |
| Dung lượng `.git` | ~27 MB sau khi `gc --prune=now` (trước đó 1.3 GB vì chứa lịch sử upstream) |
| Nội dung đã lược bỏ | README.md (rỗng), `README.zh-CN.md`/`README.zh-TW.md` (còn), `docs/architecture/`, `docs/mockups/`, component `scroll-area.tsx`, permission `request_update.toml` |

Lịch sử upstream (open-mercato/cezar) **không còn** trong repo này; muốn lấy cập nhật gốc phải thêm lại remote và merge với `--allow-unrelated-histories`.

---

## 3. Cấu trúc thư mục

```
D:\Multi Agent
├── packages/
│   ├── cezar/            @open-mercato/cezar        Service + CLI (toàn bộ engine)
│   │   ├── src/          ~150 module nguồn + test cạnh file
│   │   ├── test/         unit (node:test) + e2e package (pack/install tarball)
│   │   └── web/dist/     cockpit đã build, CLI phục vụ tĩnh (gitignored)
│   ├── contract/         @open-mercato/cezar-contract  Zod schema cho toàn bộ HTTP API
│   ├── api-client/       @open-mercato/cezar-api-client  Typed client + kiểu SSE/WS (Node-free)
│   ├── web/              @open-mercato/cezar-web     Cockpit SPA (React 19 + Vite + Tailwind v4)
│   └── desktop/          @open-mercato/cezar-desktop Shell Tauri 2 (KHÔNG phải npm workspace)
│       ├── src-tauri/    Rust: lib.rs, node_runtime.rs, telemetry.rs, disclaim.rs
│       └── ui/           Splash page + icon
├── docs/
│   ├── site/             Trang docs Next.js + Fumadocs (không phải workspace), port 4322
│   ├── adr/, brand/, screenshots/, server-install/, superpowers/
│   └── *.md              reference, publishing, telemetry, e2e-verification, …
├── scripts/              dev.mjs (boot API + Vite)
├── tests/                Smoke e2e cho runner agentic `e2e` (KHÔNG do vitest chạy)
├── .ai/                  Bộ nhớ vận hành: specs/, runs/, scripts/, skills/, qa/, plans/
├── .github/workflows/    ci, codeql, desktop-check, desktop-release, release-*, backport, nightly
├── AGENTS.md             Quy ước làm việc trong repo (đọc trước khi sửa code)
├── AGENT_PROTOCOL.md     Hợp đồng event giữa runner và UI
├── BACKWARD_COMPATIBILITY.md  Bề mặt công khai không được phá vỡ
└── e2e.config.ts         Cấu hình runner e2e agentic (target: web, CEZ_DRY_RUN=1)
```

**4 npm workspace**: `contract`, `api-client`, `cezar`, `web`. `desktop` và `docs/site` cố ý đứng ngoài
để `npm ci` ở root không kéo Tauri CLI / Next.js.

---

## 4. Kiến trúc hệ thống

### 4.1 Ba lớp

```
┌──────────────────────────────────────────────────────────────────────┐
│  DESKTOP SHELL (Rust / Tauri 2)   packages/desktop/src-tauri         │
│  • cửa sổ + title bar overlay, splash, tray, single-instance, badge  │
│  • quản lý Node runtime riêng (node_runtime.rs)                      │
│  • spawn sidecar, chờ /api/v1/health, điều hướng webview tới cockpit │
│  • updater (app + cezar), error report (opt-in)                      │
└───────────────┬──────────────────────────────────────────────────────┘
                │ HTTP loopback 127.0.0.1:<port>  (transport nội bộ)
┌───────────────▼──────────────────────────────────────────────────────┐
│  SERVICE + ENGINE (Node 20+, TypeScript ESM)   packages/cezar        │
│  • Hono HTTP API dưới /api/v1  + SSE + WebSocket                     │
│  • RunManager, workflow runner, runner adapters cho từng CLI agent   │
│  • git worktree per task, diff base, review gate, tạo draft PR (gh)  │
│  • dispatch task con, automations, skills, tracker, webhooks          │
│  • trạng thái: JSON/NDJSON dưới .ai/cezar/ và ~/.cezar/              │
└───────────────┬──────────────────────────────────────────────────────┘
                │ contract (zod) — một định nghĩa cho cả hai phía
┌───────────────▼──────────────────────────────────────────────────────┐
│  COCKPIT SPA (React 19)   packages/web                               │
│  • TanStack Query + 1 kết nối SSE toàn cục + 1 WebSocket            │
│  • routes: tasks, task thread, diff, preview, github, inbox,         │
│    automations, skills, settings, workflows, dashboard…              │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 Hai package hợp đồng (dùng chung)

| Package | Vai trò | Ràng buộc |
| --- | --- | --- |
| `packages/contract` | Mỗi request/response là **một zod schema**, TypeScript type suy ra bằng `z.infer` | Không import `node:*`, không `@types/node` |
| `packages/api-client` | Typed client trên `AppType` của Hono, kiểu SSE/WS, helper scope `/p/:projectId` | Node-free; service chỉ được import trong test |

Bất biến HTTP (xem `AGENTS.md` § The HTTP API):
route phải được **chain vào family builder** để Hono suy ra type; validate body/param/query bằng middleware,
không parse trong handler; mọi thứ trả lời dưới `/api/v1`.
`contract-parity*.test.ts` kiểm tra schema và route khớp nhau cả hai chiều.

### 4.3 Thành phần engine (`packages/cezar/src`)

| Thư mục / file | Chức năng |
| --- | --- |
| `index.ts` | CLI: `serve` (mặc định), `run`, `init`, `projects`, `install`, `update`, `versions`, `use`, `link`, `server-*`, `telemetry` |
| `server/` | Hono app, route families, SSE, WS hub, guard origin/CSRF, static UI, GitHub/PR, checkout, capabilities |
| `runs/` | `RunStore`: index `runs.json` (atomic tmp+rename), 1 file NDJSON event/run, bus sự kiện in-process |
| `workflows/` | Load/normalize YAML (`steps` hoặc shorthand `skills`), chạy step, retry, continue, recovery, dispatch, landing |
| `core/` | Seam `AgentRunner`/`AgentSession`, adapters backend, mapping event v1/v2, model catalog, detect |
| `dispatch/` | Agent cha giao task con: tối đa 4 con in-flight, budget con trích từ cha, report queue 20 |
| `automations/` | Timer/poll GitHub, deferred start, coordinator, builtin skill |
| `skills*` | Playbook Markdown: local → `.agents` → global → team repo (cache nền) |
| `workspace/` | Registry `~/.cezar/config.json`, migrations, semaphore `maxParallel`, agent accounts |
| `git-worktree.ts`, `git-diff-base.ts`, `git-remotes.ts` | Worktree/task, chọn base diff đúng, chọn remote PR/push |
| `agent-config/` | Đọc/ghi file config gốc của các agent (chỉ local, byte-exact) |
| `paths.ts` | `cezarHomeDir()` — mọi đường dẫn `~/.cezar` đi qua đây (`CEZ_HOME` cho test/container) |
| `telemetry.ts`, `feature-telemetry.ts` | Telemetry **opt-in**, không gửi prompt/đường dẫn |
| `release/`, `self-update/`, `server-install/` | Đóng gói, tự cập nhật, cài server |

### 4.4 Backend agent hiện có

`claude-cli-runner` (id cũ `claude-cli` giữ để đọc run record cũ), `codex-app-server-runner`,
`opencode-server-runner`, `cursor-agent-runner`, `copilot-acp-runner`, `junie-runner`, `pi-runner`.
Tất cả đi qua một seam duy nhất và phát đồng thời stream v1 `AgentEvent` + v2 `UiEvent`
(`AGENT_PROTOCOL.md`). `CEZ_DRY_RUN=1` dùng mock agent có sẵn, không cần login, không cần mạng.

---

## 5. Chức năng chính

| Nhóm | Người dùng làm được gì |
| --- | --- |
| Task | Tạo task từ prompt/skill/workflow, gán project, chọn backend & model cho từng step; queue, sửa prompt khi còn queued, start-now, pause, cancel, continue, retry step |
| Theo dõi | Thread realtime: step, tool call, token/cost, diff, handoff note, monitoring state |
| Review gate | Mọi task dừng ở `review`; xem diff, commit theo step, chỉnh message, land vào branch |
| Git/PR | Tạo **draft PR** qua `gh` (không `gh` → `{available:false}`), base remote tự xác định (fork-parent) |
| So sánh | Chạy cùng một task trên nhiều backend rồi so sánh kết quả (`compare-variants`) |
| Dispatch | Agent cha tạo task con (`cez task create`), theo dõi/report; con có worktree + branch riêng |
| Automations | Bật automation theo lịch/poll GitHub issue-PR, có lookback an toàn |
| Skills | Playbook Markdown local/team áp vào system prompt; slash-skill trong prompt |
| Agent config | Sửa file settings/MCP/memory gốc của Claude/Codex/OpenCode theo scope |
| Settings | Workspace (maxParallel, memory limit), agent profiles/accounts, tracker, privacy |
| Đa project | Registry mọi repo đã mở; route `/p/:projectId`; `singleProject` mode |
| Desktop | Tray (Open/Quit), single-instance, badge số run đang chạy, updater, error report opt-in |

---

## 6. Luồng hoạt động

### 6.1 Khởi động desktop

```
Tauri start
  └─ setup: tạo window + splash, init tray, đăng ký single-instance
       └─ thread supervise():
            port = pick_port()                      # port trống
            spawn: node <entry> serve --no-open --port <port>
            poll GET /api/v1/health (timeout)
              ├─ OK    → webview.navigate http://127.0.0.1:<port>
              │          + thread monitor_badge: 10s/lần GET /api/v1/runs
              │            → đếm run "running" → set overlay icon (Windows) / badge count
              └─ FAIL  → trang failure + nút Restart / Send error report (consent từng lần)
       └─ đóng cửa sổ = ẩn xuống tray (agent vẫn chạy); Quit ở tray/menu mới dừng sidecar
```

Chế độ khác: `npm run dev` (API + Vite, `scripts/dev.mjs`), `cez serve` (port mặc định **4321**),
`cez run <workflow>` (headless, không cần server).

### 6.2 Tạo và chạy một task

```
POST /api/v1/runs  (project-scoped: /api/v1/p/:projectId/runs)
  └─ RunStore.create → status "queued"   (prompt còn sửa được, queuedMessages xếp chồng)
       └─ WorkflowRunner dequeue (scheduler / maxParallel semaphore)
            ├─ tạo worktree .ai/cezar/worktrees/<runId> + branch cez/<id8>
            ├─ với mỗi step: dựng prompt ({{task}} + skill + context)
            │    → AgentRunner(backend).start()  → stream AgentEvent
            │    → map sang UiEvent → ghi NDJSON + phát SSE
            │    → check step (shell command) hoặc agent step; onFail.retry
            ├─ hết step → status "review"  (không auto-merge)
            └─ người dùng: land / tạo draft PR / cancel / continue
```

**State machine của run** (`packages/contract/src/runs.ts`):

```
queued → running ⇄ waiting → review → done
   │         │         │        └→ failed / cancelled
   │         │         └→ running (activity: monitoring)
   └→ cancelled
```

Step có thêm `pending`, `skipped`, `waiting`, `review`.

### 6.3 Dữ liệu realtime (một kết nối mỗi loại)

| Kênh | Endpoint | Dùng cho |
| --- | --- | --- |
| SSE | `GET /api/v1/workspace/events` | Mọi event run (replay từ NDJSON rồi stream live, dedup theo `seq`), snapshot đa project |
| WebSocket | `/api/v1/ws` (topic `health`, …) | Tín hiệu live dạng "subscribe khi cần": publisher bật ở 0→1 subscriber, tắt ở 1→0 |

Cockpit giữ **một** SSE + **một** WS toàn cục và patch TanStack Query cache tại chỗ;
refetch toàn bộ chỉ khi reconnect hoặc tab hiện lại.

### 6.4 Dispatch (agent chính giao việc cho agent con)

`cez task create` (HTTP tới `CEZ_API_URL`) → task con có worktree/branch riêng, budget trích từ cha,
tối đa **4 con in-flight**, report queue 20, kết quả quay về agent cha (`cez task report`).
Bật mặc định; tắt bằng `CEZ_DISPATCH=0`.

### 6.5 Automations

Timer chỉ arm cho automation người dùng đã bật; poll GitHub theo lookback; kết quả dùng lại
đúng đường dispatch/deferred-start. Bật mặc định; `CEZ_AUTOMATIONS=0` để tắt.

### 6.6 Review → PR

Diff được neo bằng `resolveTaskDiffBase` (merge-base với base ref *mới nhất*, hoặc branch agent đã checkout
tại thời điểm run bắt đầu) để không tính lịch sử ngoài task. PR luôn là **draft**, target là remote
được `resolveTaskRemotes` xác định (không hard-code `origin`).

---

## 7. Lưu trữ & cấu hình (zero-config)

| Đường dẫn | Nội dung | Ghi chú |
| --- | --- | --- |
| `.ai/cezar/runs.json` | Index toàn bộ run của project | atomic tmp+rename, debounce, zod-validate |
| `.ai/cezar/runs/<id>.ndjson` | Event append-only của từng run | nguồn replay SSE |
| `.ai/cezar/runs/<id>.handoff.md`, `<id>-images/` | Handoff note, ảnh đính kèm | ảnh không nhét base64 vào runs.json |
| `.ai/cezar/worktrees/<runId>` | Worktree của task | prune orphan khi khởi động |
| `.ai/cezar/workflows/`, `skills/` | Workflow + skill của repo (committable) | `quick-task` luôn có sẵn |
| `.ai/cezar/config.json` (optional) | Cấu hình project | mọi key có default |
| `~/.cezar/config.json` (+ `.bak`) | Workspace config **và** registry project | ghi qua read-modify-write + lock |
| `~/.cezar/agent-accounts.json` | Account các agent | file riêng để không bị mất khi config cũ |
| `~/.cezar/tracker-connections/` | Credentials tracker theo project | parse vào object, không vào `process.env` |
| `~/.cache/cez/` | Cache mạng: skills team, star-count, … | xoá được, tự dựng lại |

Nguyên tắc: **state được ghi, không bao giờ bị bắt buộc**. Xoá `.ai/cezar/`, `~/.cache/cez/`, `~/.cezar/`
thì hệ thống tự tái tạo (riêng `~/.cezar` xoá cả thư mục mới là reset thật).

Các cờ môi trường đáng chú ý: `CEZ_HOME`, `CEZ_DRY_RUN`, `CEZ_DISPATCH`, `CEZ_AUTOMATIONS`,
`CEZ_TELEMETRY`, `CEZ_NO_BANNER`, `CEZ_DESIGN_MODE`, `CEZ_SKILLS_AUTO_UPDATE`.

---

## 8. Bảo mật & phạm vi local

- Server chỉ bind `127.0.0.1`; guard `/api/*` chặn `Host` không phải loopback (DNS-rebinding)
  và chặn request ghi khác origin (CSRF) — zero-config, cockpit same-origin đi qua bình thường.
- CORS chỉ mở cho `/api/v1/health`; WS chỉ nhận origin loopback (WS không có CORS).
- Ghi file config agent (`PUT /api/agent-config/:id`) là **năng lực local-only**, trả 409 khi
  `capabilities().localHandoff = false` — đóng đường RCE qua hooks.
- Telemetry **opt-in**: chưa trả lời consent thì không gửi gì; route gửi dạng "shape", không prompt/đường dẫn/tên repo.
- `assertCezarHomeWriteIsSandboxed` chặn test ghi nhầm vào `~/.cezar` thật.

---

## 9. Dev – Build – Test – CI

```bash
npm install                 # 4 workspace
npm run dev                 # API + Vite (HMR), mở browser cho dev
npm run typecheck           # contract + api-client + server + web
npm test                    # vitest: server + cockpit unit suites
npm run test:unit           # node:test: core module nhanh
npm run build               # tsc → dist, vite → packages/cezar/web/dist, check:pack
npm run test:package        # pack tarball rồi chạy CLI đã build
npm run test:e2e            # UI smoke thật (agent-browser), CEZ_DRY_RUN=1
npm run docs:dev            # docs site, port 4322
```

| Workflow CI | Nội dung |
| --- | --- |
| `ci.yml` | typecheck, vitest, test:unit, build, test:package |
| `desktop-check.yml` | `cargo check --locked --all-targets` + `cargo test --locked --lib` (Linux + Windows) |
| `codeql.yml` | Quét bảo mật CodeQL |

**Ràng buộc trên máy dev hiện tại (Windows 11)**: Smart App Control đã tắt và Developer Mode đã
bật, nên `cargo check` / `cargo test` / `cargo build` chạy được local (không còn os error 4551).

---

## 10. Khác biệt của bản này so với cezar gốc

| Hạng mục | cezar gốc | Bản hiện tại |
| --- | --- | --- |
| Bề mặt | Cockpit web mở bằng browser | **Desktop-first**: app Tauri, không còn mục "Open in browser" trong menu |
| Tray | không có | Tray icon Open/Quit, click trái mở lại cửa sổ |
| Đóng cửa sổ | thoát app | **Ẩn xuống tray**, agent tiếp tục chạy tới khi Quit |
| Nhiều instance | không kiểm soát | Single-instance: lần mở thứ hai focus cửa sổ đang chạy |
| Badge | không có | Đếm run `running` của project đang mở, poll loopback 10s; Windows dùng overlay icon |
| Lịch sử git | 1694 commit upstream | 1 commit gốc của dự án |
| Tài liệu thừa | `docs/architecture/`, `docs/mockups/` | đã xoá; README.md rỗng |

Phần **hosted/remote mode** (`CEZ_REMOTE`) được giữ nguyên, không đụng tới.

---

## 11. Việc còn mở

1. **Đóng cửa sổ = ẩn xuống tray**: hành vi mới, người dùng quen "đóng là thoát" sẽ thấy app còn chạy nền.
2. **Badge chỉ đếm run của project đang mở** (không phải toàn workspace) vì dùng `GET /api/v1/runs` của boot project.
3. **`cez serve` từ CLI vẫn tự mở browser** (`--no-open` để tắt) — desktop đã truyền `--no-open`, nhưng CLI thuần vẫn mở.
4. README rỗng — cần nội dung giới thiệu riêng cho Onni Work.
5. `README.zh-CN.md`, `README.zh-TW.md` vẫn là bản dịch của cezar.
