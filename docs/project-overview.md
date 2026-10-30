# Tổng quan dự án Onni Work

> Tài liệu này phản ánh **code tại nhánh `chore/docs-ai`**, commit gốc `52fc641` (2026-10-30).
> Mọi khẳng định dưới đây đã được đối chiếu với source; chỗ nào chưa kiểm được ghi rõ.
> Khi tài liệu này mâu thuẫn với code, **code thắng**.

---

## 1. Sản phẩm là gì

Onni Work là cockpit **local** để chạy và theo dõi nhiều task của AI coding agent trên một repo.
Người dùng nhập task, chọn backend (`claude`, `codex`, `opencode`, `cursor`, `pi`, `junie`,
`copilot`) và workflow; mỗi task chạy trong **một git worktree riêng**, stream realtime các bước,
tool call, token và diff, rồi dừng ở một trạng thái kết thúc do người dùng quyết định.

Ba nguyên tắc:

- **Local-first**: không account, không database, không cloud. Trạng thái là JSON / NDJSON /
  Markdown trên đĩa, dưới `.ai/onni/` (theo repo) và `~/.onni/` (theo user).
- **Zero-config**: mọi thứ được khám phá từ repo, môi trường, `gh` và tiến trình đang chạy; thiếu
  dependency thì thu nhỏ tính năng, không chết boot.
- **Không tự merge**: không có auto-merge. Task kết thúc ở `review` **chỉ khi** review gate được
  bật (mặc định TẮT); merge PR là thao tác người dùng bấm.

---

## 2. Cấu trúc package

Bốn npm workspace dưới root `private`, cộng một package desktop cố ý nằm ngoài workspace:

| Đường dẫn | Package | Vai trò |
| --- | --- | --- |
| `packages/work` | `@onni/work` | Service + CLI + toàn bộ engine. `bin`: `onni`, `onni-cli`, `onni-run`. Phục vụ cockpit đã build từ `packages/work/web/dist`. |
| `packages/contract` | `@onni/contract` | Toàn bộ schema zod của HTTP API; type suy ra bằng `z.infer`. Node-free. |
| `packages/api-client` | `@onni/api-client` | Typed client trên `AppType` của Hono + kiểu SSE/WS + helper scope `/p/:projectId`. Node-free. |
| `packages/web` | `@onni/web` | Cockpit SPA (React 19 + Vite + Tailwind v4 + shadcn/ui). Build ra `packages/work/web/dist`. |
| `packages/desktop` | `@onni/desktop` | Shell Tauri 2 (Rust). **Không phải npm workspace**; có `package-lock.json` riêng; nằm ngoài `npm install` ở root. |

`packages/work/scripts/inline-contract.mjs` chạy ở `postbuild`: nó nhúng `@onni/contract` (bundle
và declaration) vào `dist/contract/` rồi trỏ lại các import, vì contract là package `private`
mà tarball không thể resolve từ npm.

---

## 3. Kiến trúc ba lớp

```
┌──────────────────────────────────────────────────────────────────────┐
│  DESKTOP SHELL — packages/desktop/src-tauri (Rust, Tauri 2)          │
│  cửa sổ + tray (Open/Quit) + badge taskbar + single-instance          │
│  chạy engine đã build: ONNI_DESKTOP_ENTRY, nếu không thì              │
│  ~/.onni/versions/current; menu Versions đổi link; trang lỗi + Restart│
└───────────────┬──────────────────────────────────────────────────────┘
                │ sidecar: node <entry> --no-open  ·  HTTP loopback
┌───────────────▼──────────────────────────────────────────────────────┐
│  SERVICE + ENGINE — packages/work (Node 20+, TypeScript ESM)          │
│  Hono: /api/v1 · SSE /api/v1/workspace/events · WS /api/v1/ws         │
│  RunManager + workflow runner + 7 runner adapter                      │
│  git worktree mỗi task · diff base · draft PR qua gh                  │
│  dispatch, automations, skills, tracker, webhooks, agent-config       │
└───────────────┬──────────────────────────────────────────────────────┘
                │ contract (zod) — một định nghĩa cho cả hai phía
┌───────────────▼──────────────────────────────────────────────────────┐
│  COCKPIT SPA — packages/web (React 19)                                │
│  TanStack Query · một SSE toàn cục · một WebSocket (bus subscription) │
│  route dưới /p/:projectId/…; settings ngoài scope                     │
└──────────────────────────────────────────────────────────────────────┘
```

Điểm quan trọng: **desktop không có logic nghiệp vụ**. Nó spawn engine Node và điều hướng webview
tới cockpit. Cùng engine đó chạy được không cần desktop: `node packages/work/dist/index.js`.

### 3.1 Thành phần engine (`packages/work/src`)

| Thư mục / file | Chức năng |
| --- | --- |
| `index.ts` | CLI. Lệnh: `serve` (mặc định), `run`, `init`, `projects`, `task`, `automation`, `runs`, `tracker-connections`, `secrets`, `server-install`, `server-deploy`, `server-uninstall`, `link`, `unlink`. |
| `server/` | Hono app, ~40 family route, SSE, WS hub, guard origin, static UI, GitHub/PR, capabilities, validators. |
| `runs/` | `RunStore` (index `runs.json`, một file NDJSON mỗi run, bus sự kiện in-process), retention, review gate, auto-name, layouts, drafts. |
| `workflows/` | Load/normalize YAML, chạy step, retry, continue, recovery, dispatch, landing, graph (`version: 2`). |
| `core/` | Seam `AgentRunner`/`AgentSession`, adapter từng backend, mapping v1 `AgentEvent` → v2 `UiEvent`, model catalog, detect, agent profiles. |
| `dispatch/` | Agent cha giao task con qua `onni task`; tối đa 4 con in-flight, budget con trích từ cha. |
| `automations/` | Poll GitHub / lịch, deferred start, receipts, coordinator. |
| `skills*.ts` | Playbook Markdown: local → `.agents` mirror → global → team repo (cache nền). |
| `workspace/` | Registry `~/.onni/config.json`, migrations, semaphore `maxParallel`, agent accounts, secrets. |
| `git-worktree.ts`, `git-diff-base.ts`, `git-remotes.ts` | Worktree mỗi task, chọn base diff đúng, chọn remote push/PR. |
| `agent-config/` | Đọc/ghi file config gốc của agent (byte-exact, chỉ local). |
| `self-update/` | **Chỉ còn layout phiên bản local**: `onni link` / `onni unlink` ghi `~/.onni/versions`. Không registry, không npm, không server. |
| `server-install/`, `webhooks/`, `worktree-lifecycle/` | Cài cockpit lên VPS, webhook ra ngoài, lịch sử chuẩn bị/dọn worktree. |
| `paths.ts` | `onniHomeDir()` — mọi đường dẫn `~/.onni` đi qua đây; `ONNI_HOME` cho test/container. |

### 3.2 Backend agent

`RUNNER_IDS = ['claude','codex','opencode','cursor','pi','junie','copilot']` trong
`core/agent-runner.ts` là nguồn duy nhất; `runnerSchema` trong contract phải khớp.
`claude-cli` là id cũ, chỉ giữ để đọc run record cũ. Mỗi backend implement cùng một seam và phát
đồng thời stream v1 + v2. `ONNI_DRY_RUN=1` dùng mock agent: không login, không mạng.

---

## 4. Luồng chạy một task

1. **Tạo** — `POST /api/v1/p/:projectId/runs` (hoặc composer). Record được tạo với
   `status: 'queued'`, snapshot workflow + step.
2. **Xếp hàng** — `WorkspaceSemaphore` giữ `resources.maxParallel` (mặc định 2) cho cả process.
   Prompt của run `queued` vẫn sửa được (`queuedMessages`), gộp vào `{{task}}` lúc dequeue.
3. **Chuẩn bị worktree** — `.ai/onni/worktrees/<runId>` trên nhánh `onni/<id8>` (hoặc branch do
   namer đặt theo `branchNaming`), fork từ base branch.
4. **Chạy step** — `RunManager.execute` mở session tới backend, chuyển `queued → running`, stream
   event vào NDJSON và SSE. Mỗi step là agent (`prompt`/`skill`) XOR check (`command`).
5. **Park** — agent kết thúc lượt nhưng còn việc downstream và khai báo `ONNI:MONITORING`:
   `running` + `activity: 'monitoring'`, có timer đánh thức. Hỏi người dùng (`ONNI:ASK`) hoặc chờ
   CI/con: `waiting`.
6. **Kết thúc** — `settleSuccess`:
   - gate BẬT + có diff + không autonomous → `review`;
   - ngược lại → `done`, diff để nguyên trong worktree.
7. **Sau kết thúc** — người dùng xem Changes, `Continue` (mở lại session), `Finish`/accept
   (`review → done`), tạo draft PR qua `gh` (`POST /runs/:id/pr`), hoặc merge PR
   (`POST /api/v1/github/prs/:number/merge`, thao tác người dùng).

Realtime: event đi vào `runs/<id>.ndjson` (append-only) và được SSE replay + stream live, dedupe
theo `seq`. Cockpit giữ **một** SSE toàn cục và **một** WebSocket; tín hiệu khác dùng topic của
WS bus, không dùng `refetchInterval`.

---

## 5. State machine của run (đối chiếu `packages/contract/src/runs.ts`)

`runStatusSchema` (dòng 50) có đúng 7 trạng thái:
`queued`, `running`, `waiting`, `review`, `done`, `failed`, `cancelled`.
`runActivitySchema` chỉ có `monitoring` — là **sub-state của `running`**, không phải status riêng.

```
            tạo
             │
             ▼
         ┌────────┐  scheduler nhận slot   ┌─────────┐
         │ queued │ ──────────────────────▶ │ running │◀────────┐
         └────────┘                          └─────────┘         │
             ▲                               │  │  │            │ resume/continue
             │ retry / requeue               │  │  └─▶ running   │
             │                               │  │      + activity: monitoring
             │                               │  │      (ONNI:MONITORING, có timer)
             │                               │  ▼
             │                            ┌─────────┐
             │        ONNI:ASK / chờ CI   │ waiting │
             │        / worktree scripts  └─────────┘
             │                               │
             │             settleSuccess     │
             │        ┌──────────────────────┴─────────────┐
             │        ▼                                    ▼
             │   ┌────────┐  gate BẬT + có diff      ┌──────┐
             │   │ review │  + không autonomous  ──▶ │ done │
             │   └────────┘                          └──────┘
             │        │ accept / Finish                  ▲
             │        └──────────────────────────────────┘
             │
             ▼
      failed / cancelled  (terminal; retry đưa về queued)
```

Bảng chuyển trạng thái đã kiểm trong code:

| Từ | Sang | Điều kiện / nơi phát |
| --- | --- | --- |
| — | `queued` | tạo run (`runs/store.ts`, `workflows/run.ts`) |
| `queued` | `running` | scheduler nhận slot |
| `running` | `waiting` | `ONNI:ASK`, chờ CI/con, worktree scripts cần can thiệp |
| `running` | `running` + `monitoring` | `ONNI:MONITORING`; timer đánh thức đưa lại `running` |
| `waiting` | `running` | người dùng nhắn, nudge tự động, timer monitoring |
| `running`/`waiting` | `review` | `settleSuccess` khi `reviewGateEnabled && có diff && !autonomous` |
| `running`/`waiting` | `done` | settle không qua gate, hoặc autonomous |
| `review` | `done` | accept/Finish (`completionReason: 'accepted'`) |
| `review`/`running`/`waiting` | `cancelled` | `POST /runs/:id/cancel` |
| `failed` | `queued` | retry / retry step |
| `waiting` (worktree scripts) | `queued` | hành động recovery tường minh |

`stepStatusSchema` rộng hơn run: thêm `pending` và `skipped`.

---

## 6. Lưu trữ

| Đường dẫn | Nội dung |
| --- | --- |
| `.ai/onni/runs.json` | Index run của project (JSON array của `runRecordSchema`), ghi atomic tmp+rename. |
| `.ai/onni/runs/<id>.ndjson` | Event append-only của từng run — nguồn replay SSE. |
| `.ai/onni/runs/<id>.handoff.md`, `<id>-images/` | Handoff journal và ảnh đính kèm. |
| `.ai/onni/worktrees/<runId>` | Worktree của task; orphan được prune lúc khởi động. |
| `.ai/onni/workflows/`, `skills/` | Workflow + skill của repo — **committable**. |
| `.ai/onni/config.json` | Cấu hình project, optional, mọi key có default. |
| `.ai/onni/ui-state.json`, `todos.json`, `attachments/`, `drafts/`, `layouts/`, `tmp/` | UI state, inbox, thư viện đính kèm, nháp composer, layout task, temp của agent. |
| `~/.onni/config.json` (+ `.bak`) | Workspace config **và** project registry; ghi qua read-modify-write + lock, `0600`. |
| `~/.onni/agent-accounts.json` | Account các agent (file riêng để không bị config cũ nuốt). |
| `~/.onni/secrets/` | Secret store (`0700`/`0600`). |
| `~/.onni/tracker-connections/` | Credential tracker theo project. |
| `~/.onni/versions/` | Layout engine cho desktop (`current` → `<id>`; junction trên Windows). |
| `~/.cache/onni/` | Cache mạng (skill team…) — xoá được, tự dựng lại. |

Nguyên tắc: **state được ghi, không bị bắt buộc**. Xoá `.ai/onni/` hay `~/.cache/onni/` thì hệ
thống tự dựng lại. Với `~/.onni`, xoá `config.json` thì `config.json.bak` khôi phục registry;
muốn reset thật thì xoá cả thư mục.

---

## 7. Bảo mật loopback

- Server bind `127.0.0.1` (mặc định; `--bind-host` chỉ dùng khi có reverse proxy).
- Guard chạy trước mọi route `/api/*` trừ `/api/v1/health`:
  - local mode: từ chối `Host` không phải loopback (`isLoopbackHostHeader`, neo đúng
    `127.0.0.0/8` — không dùng prefix `127.` để tránh `127.0.0.1.evil.com`);
  - cả hai mode: từ chối request ghi khác origin (CSRF).
- CORS **chỉ** mở cho `/api/v1/health` (discovery). Health không chứa path project hay secret.
- WebSocket không có CORS: upgrade guard chỉ nhận origin loopback/same-authority; topic
  `health` là topic duy nhất được đánh dấu `loopbackReadable`.
- Ghi file config agent (`PUT /api/agent-config/:id`) là năng lực local-only: 409 khi
  `capabilities().localHandoff === false` (đóng đường RCE qua hooks).
- `assertOnniHomeWriteIsSandboxed` chặn test ghi vào `~/.onni` thật.
- **Không có telemetry gửi đi.** Số liệu host/process trong app là local.

---

## 8. Dev — build — test

Đã chạy trên máy soạn tài liệu (Windows 11, Git Bash, Node 24):

| Lệnh | Kết quả |
| --- | --- |
| `npm run typecheck` | **pass** (contract → api-client → server → web) |
| `npm test` | **fail 342/12.328 test (89/761 file)** trên Windows native; mẫu lỗi đều do môi trường: `EPERM` khi dọn thư mục tạm/worktree, mode `0600` vs `0666`, `/bin/sh`, đường dẫn POSIX. **Chưa chạy lại trên Linux/WSL.** |
| `npm run test:unit` | **fail 1 test** trên Windows: `test-env-launcher.test.ts` (`spawnSync /bin/sh ENOENT`) — test POSIX-only |
| `npm run build` | **pass** (tsc + vite + `check:pack`: 1088 file, 167 file trong `web/dist`) |
| `npm run test:package` | **pass 4/4** (pack tarball, cài vào consumer tách biệt, chạy CLI `ONNI_DRY_RUN=1`) |
| `npm run test:e2e` | cần browser provider; **chưa chạy** |

```bash
npm install
npm run dev            # API :4321 + Vite
npm run typecheck
npm test               # vitest
npm run test:unit      # node:test (POSIX)
npm run build          # tsc + vite + check:pack
npm run test:package   # pack tarball và chạy CLI đã build
npm run test:e2e       # smoke UI thật (ONNI_DRY_RUN=1)
```

Desktop (cài riêng):

```bash
cd packages/desktop
npm install
npm run dev            # tauri dev
npm run build          # tauri build
```

Trên Windows, **Smart App Control phải TẮT** (nếu không `cargo` lỗi 4551) và **Developer Mode phải
BẬT** (nếu không test tạo symlink lỗi `EPERM`). CI: `ci.yml` (typecheck, vitest shard 3, unit,
build, package, webhook đa nền tảng) + `desktop-check.yml` (`cargo check`/`cargo test`, Linux và
Windows) + `codeql.yml`.

---

## 9. Mâu thuẫn giữa tài liệu cũ và code (đã sửa)

Bản `docs/project-overview.md` trước đây được viết từ một commit khác và có các điểm sai:

| Tài liệu cũ nói | Code thực tế |
| --- | --- |
| "Mọi task dừng ở `review`" | Review gate **mặc định TẮT**. Run thành công không có gate (hoặc autonomous) về thẳng `done`; diff nằm lại worktree. Chỉ khi `config.reviewGate` / `ONNI_REVIEW_GATE=1` mới park ở `review`. |
| CLI có `install`, `update`, `versions`, `use` | Không tồn tại. CLI thật: `serve`, `run`, `init`, `projects`, `task`, `automation`, `runs`, `tracker-connections`, `secrets`, `server-install/deploy/uninstall`, `link`, `unlink`. |
| "1 commit gốc, nhánh `dev`, `.git` ~27 MB" | Sai; lịch sử riêng đã có 30+ commit, nhánh làm việc là `chore/docs-ai`. |
| `README.md` rỗng, còn `README.zh-CN.md` | README có nội dung; không còn file README tiếng Trung. |
| Có thư mục `release/` | Không tồn tại. |
| Ba lớp: desktop là "bề mặt chính", HTTP chỉ là transport nội bộ | Đúng về định hướng, nhưng engine chạy độc lập được: `node packages/work/dist/index.js` phục vụ đúng cockpit đó qua browser. |
| `npm run typecheck` chỉ "server + web" (trong `docs/reference.md`) | Thực tế chạy cả `contract` và `api-client` trước. |

Ngoài ra, comment trong code cũng có chỗ lệch (đã ghi nhận, không sửa logic):
`core/agent-runner.ts` nói "Five interchangeable backends" nhưng liệt kê sáu và `RUNNER_IDS` có
bảy; `contract/src/health.ts` mô tả automations "off — the default" trong khi code là
`ONNI_AUTOMATIONS !== '0'` (mặc định BẬT).

---

## 10. Việc còn mở / chưa xác minh

- `npm run test:e2e` chưa chạy trong đợt này (cần browser provider).
- `npm test` chưa chạy lại trên Linux/WSL; trên Windows native có 342 test fail do môi trường
  (xem bảng §8). CI là cổng tham chiếu.
- `cargo check` / `cargo test` của desktop chưa chạy lại; `desktop-check.yml` là cổng CI.
- `.ai/specs/` còn 4 link tương đối trỏ tới thư mục đã bị xoá (`.ai/runs/`, `.ai/data-model/`,
  `.ai/prototypes/`). Specs là hồ sơ gốc, không viết lại — xem `.ai/specs/README.md`.
