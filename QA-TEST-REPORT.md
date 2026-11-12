# QA toàn hệ thống — báo cáo kiểm thử và sửa lỗi

Ngày: 2026-11-12.
- Kiểm thử: nhánh `test/full-system-audit` @ `af6023d` (tách từ `dev` @ `fc6f5a7`) — chỉ thêm test và báo cáo,
  `git diff --stat` trên mã nguồn bằng rỗng.
- Sửa lỗi: nhánh `fix/audit-findings` (tách từ nhánh kiểm thử), theo yêu cầu "fix toàn bộ lỗi tìm thấy". Mọi
  thay đổi mã logic của đợt này nằm trên nhánh sửa; báo cáo được cập nhật tại chỗ với trạng thái từng mục.

Máy: Windows 11 (10.0.26200), Git Bash, Node 24.21.0, npm 11.19.0, Chrome hệ thống, Rust 1.99.1.
Phạm vi theo yêu cầu: luồng hoạt động, chức năng, giao diện, tối ưu hệ thống, tương thích Windows.

## 1. Kết quả các cổng

### 1.1 Trước khi sửa (nhánh kiểm thử)

| Cổng | Lệnh | Kết quả |
| --- | --- | --- |
| Kiểu | `npm run typecheck` | **exit 0** (contract, api-client, server, web + test tsconfig) |
| Vitest | `npm test` | **13 522 pass / 58 fail / 47 skip** (866 file; 23 file đỏ) |
| Unit | `npm run test:unit` | **46 pass / 1 fail / 1 skip** — fail là `spawnSync /bin/sh ENOENT`, đúng lỗi môi trường đã ghi trong AGENTS.md |
| Build | `npm run build` | **exit 0**; `check:pack ok — 1340 packed files, 176 under web/dist` |
| Đóng gói | `npm run test:package` | lần 1 fail ở teardown (`EBUSY rmdir consumer`), **lần 2 exit 0** – mọi assertion CLI đều qua |
| Desktop | `cargo check` | **exit 0** |
| Desktop test | `cargo test` | **23 pass, 0 fail, 3 ignored**; `cargo test -- --ignored` → **3/3 pass** (`#[ignore = "needs node"]`) |
| UI thật | kịch bản browser smoke | **pass** (12 ảnh, 0 page error) |
| Test QA mới | 3 file trong `packages/*/src/qa/` | **31/31 pass** |

Diễn giải 58 test đỏ: **chỉ 2 test là lỗi thật** và nằm cùng một file (`dispatch/commands.test.ts`, xem M1).
13 file đỏ còn lại đã được chạy lại riêng lẻ (`--no-file-parallelism`, tổng 438 test) — **tất cả xanh**. Chúng
thuộc đúng nhóm AGENTS.md đã mô tả: `EPERM/EBUSY` khi dọn thư mục temp, timeout 20 s khi 13,6 nghìn test chạy
song song trên NTFS, và subprocess `node --eval` quá tải. CI (Linux, chia 3 shard) vẫn là thẩm quyền.

### 1.2 Sau khi sửa (nhánh `fix/audit-findings`)

| Cổng | Lệnh | Kết quả |
| --- | --- | --- |
| Kiểu | `npm run typecheck` | **exit 0** (contract, api-client, server, web + test tsconfig) |
| Vitest — vùng bị ảnh hưởng | 27 file (dispatch, server, paths, qa, i18n, note-i18n, scope, palette, task-changes) | **367/367 pass** — gồm 2 test M1 từng đỏ |
| Vitest — bộ QA | `packages/work/src/qa` + `packages/web/src/qa` | **33/33 pass** (windows-compat 24, performance 4, i18n-integrity 5) |
| Vitest — asset tĩnh | `packages/work/src/server/static-assets.test.ts` | **8/8 pass** |
| Unit | `npm run test:unit` | vẫn **46 pass / 1 fail / 1 skip** — chỉ `test-env-launcher.test.ts` (`spawnSync /bin/sh ENOENT`), giới hạn native Windows đã ghi trong AGENTS.md, không phải hồi quy |
| Build | `npm run build` | **exit 0**; `check:pack ok — 1344 packed files, 1147 dist files mapped` |
| Đóng gói | `npm run test:package` | **4/4 pass** |
| Desktop | `cargo test` | **25 pass, 0 fail, 3 ignored** (thêm 2 test Windows cho `open_url`); `cargo test -- --ignored` **3/3 pass** |
| Live — nén | server dựng từ bản build, `curl -H 'Accept-Encoding: gzip'` | **`content-encoding: gzip`**, `vary: accept-encoding`, `cache-control: public, max-age=31536000, immutable` |
| Live — tiếng Việt | Chrome thật qua `playwright-core` | đổi sang VI: `html lang="vi"`, sidebar/placeholder dịch, giữ sau reload, **0 lỗi console** |
| Live — L4 | 6 lần nạp lạnh `/p/demo/tasks/<id>` | **0 request project-level không scope, 0 response ≥400**; `⌘P` mở đủ danh sách lệnh |

Không chạy lại toàn bộ 13,6 nghìn test trên Windows sau khi sửa (cùng lý do môi trường ở §1.1); các suite bị
ảnh hưởng đã chạy riêng và xanh, CI vẫn là thẩm quyền.

## 2. Phát hiện và trạng thái sửa

### HIGH

**H1 — Desktop: chèn lệnh qua `cmd /C start` khi mở URL chứa `&`** — **ĐÃ SỬA**
- Vị trí: `packages/desktop/src-tauri/src/lib.rs` (`open_url`), được gọi từ `on_new_window`, `on_navigation`,
  `on_page_load`.
- Hiện tượng: trên Windows, URL được đưa vào `Command::new("cmd").args(["/C", "start", "", url])`.
  Rust chỉ đặt ngoặc kép khi tham số có dấu cách; URL do `Url::as_str()` sinh ra không có dấu cách, nên `&`
  `|` `<` `>` `^` `%VAR%` vẫn còn sống với `cmd.exe`. Bất kỳ liên kết `target="_blank"` nào trong cockpit
  (markdown của agent, dữ liệu repo, tracker, redirect của trang preview) đều đi qua `open_url`.
- Bằng chứng ban đầu (phụ lục A): chương trình Rust tối giản gọi
  `Command::new("cmd").args(["/C","echo","https://e.test/?a=1&ver"])` in ra
  `https://e.test/?a=1` **và cả `Microsoft Windows [Version 10.0.26200.9974]`** — tức `ver` đã được thi hành
  như lệnh thứ hai. `fn open_url` chỉ thay `echo` bằng `start ""`, cơ chế phân tách không đổi.
- Đối chiếu: phía server đã vá đúng lớp lỗi này — `server/open-in-app.ts`, `server/open-in-terminal.ts` và
  `core/windows-shim.ts` đều từ chối đi qua `cmd.exe` (BatBadBut, #459). Desktop là chỗ duy nhất còn lại.
- **Cách sửa:** bỏ hẳn shell trên Windows. `open_url` chuyển URL sang UTF-16 và gọi `ShellExecuteW` qua
  `windows-sys` 0.61 (feature `Win32_UI_Shell`); một helper `wide()` từ chối URL có NUL nội bộ thay vì để
  shell cắt chuỗi. macOS (`open`) và Linux (`xdg-open`) giữ nguyên.
- **Kiểm chứng:** 2 test Rust mới — `a_url_reaches_the_shell_as_one_argument` (URL
  `https://e.test/?a=1&ver|calc^%PATH%` đến shell nguyên vẹn, một tham số) và
  `a_url_with_an_interior_nul_is_dropped`; `cargo test` **25 pass** trên Windows. `Cargo.toml` chỉ thêm
  `windows-sys` cho `cfg(windows)`.

### MEDIUM

**M1 — Bảng lệnh `onni task` vượt ngân sách prompt: mất `onni task tree` + test đỏ thường trực** — **ĐÃ SỬA**
- Vị trí: `packages/work/src/dispatch/commands.ts` (mục `roster` thêm trong `75cfc0c`),
  `packages/work/src/dispatch/prompt-budget.ts` (`MANAGER_COMMANDS_MAX_CHARS = 2100`, không đổi),
  `packages/work/src/dispatch/commands.test.ts` (`CLI_COMMANDS` không có `roster`; test canh `tree`).
- Hiện tượng: `briefCommands('manager')` dài **2246 ký tự**, ngân sách 2100, `clampLines` cắt dòng cuối nên
  block còn **1991 ký tự** và **mất dòng `onni task tree`**. Test `keeps every brief block inside its own budget`
  fail đúng như thiết kế canh gác của nó; test `holds every command the CLI answers` fail vì danh sách kỳ vọng
  chưa có `roster`. Đây là test đỏ **tất định**, không phải flake.
- Bằng chứng ban đầu: `npm test -- --no-file-parallelism packages/work/src/dispatch/commands.test.ts` →
  `Tests 2 failed | 22 passed`; đo trực tiếp: `managerCommandsBlock().length === 1991`, `budget 2100`,
  `briefCommands('manager').length === 2246`, `includes('onni task tree') === false`.
- Hệ quả: cổng `npm test`/CI đỏ từ `75cfc0c`, và prompt của manager không còn được dạy lệnh `tree` đã có trong
  `docs/reference.md`.
- **Cách sửa:** nâng `MANAGER_COMMANDS_MAX_CHARS` lên **2400** (kèm ghi chú vì sao) và thêm `roster` vào
  `CLI_COMMANDS`. Test ngân sách nay còn canh thêm: **mọi** mục `manager` có `brief` phải xuất hiện trong block,
  nên một lệnh mới không thể lặng lẽ đẩy lệnh khác ra ngoài nữa.
- **Kiểm chứng:** đo sau sửa — block **2246** ký tự (ngân sách 2400), `includes('onni task tree') === true`,
  `includes('onni task roster') === true`; `dispatch/commands.test.ts` xanh trong lượt 367 test.

**M2 — Asset tĩnh không nén và đọc đồng bộ mỗi request** — **ĐÃ SỬA**
- Vị trí: `packages/work/src/server/server.ts` (`app.get('/assets/:file')` → `readFileSync(path)`), không có
  middleware nén nào trong `packages/work`.
- Hiện tượng: `curl -H "Accept-Encoding: gzip, br" /assets/i18n-*.js` trả về **không có `Content-Encoding`**,
  `Content-Length: 498612`. Tải cockpit đầu tiên: **50 file JS preload, 1 708 KB thô / 536 KB nếu gzip**; riêng
  chunk `i18n-*.js` là 498,6 KB thô (149,4 KB gzip) và nằm trong `modulepreload` của `index.html`.
- Đo trong Chrome thật: `transferSize` cộng dồn ≈ 2 569 KB cho 55 resource (tức bằng `decodedBodySize`), FCP
  404 ms, load 520 ms trên loopback. Với bản `onni server-install` (truy cập qua ngrok) đây là chi phí thật.
- **Cách sửa:** module mới `packages/work/src/server/static-assets.ts` — `AssetCache` đọc mỗi file một lần cho
  cả process (tên asset do Vite fingerprint nên bất biến), nén gzip bằng `node:zlib` khi client nhận
  (`Accept-Encoding` có `gzip`/`*` và không `q=0`), chỉ nén `js/css/svg/json/map` từ 1 KB, trả kèm
  `Vary: Accept-Encoding`; miss không được cache nên bản build mới vẫn được nhận. Route chỉ còn gọi
  `assets.respond(...)`.
- **Kiểm chứng:** `static-assets.test.ts` **8/8** (thương lượng `q=0`/`*`, ngưỡng nén, header/body, cache lần
  đọc thứ hai, 404 cho tên không an toàn); live probe trên server dựng từ bản build trả
  `content-encoding: gzip` + `vary: accept-encoding` + `immutable`.

**M3 — Toàn bộ từ điển tiếng Việt được tải cho cả người dùng tiếng Anh** — **ĐÃ SỬA**
- Vị trí: `packages/web/src/lib/i18n/messages.ts` gộp mọi `vi-*.ts` vào một chunk; `index.html` modulepreload
  chunk đó.
- Hiện tượng: chunk `i18n-*.js` 498,6 KB thô / 149,4 KB gzip; bản dịch có 3 245 mục, trong khi mặc định là
  tiếng Anh (`translate('en')` là identity).
- **Cách sửa:** từ điển chuyển sang `vi-messages.ts`, chỉ vào graph qua `loadViMessages()` (`import()` động,
  một lần cho cả phiên). `messages.ts` giữ `viMessages = {}` và thêm `setViMessages()` cho test;
  `I18nProvider` gọi `loadViMessages()` khi `language === 'vi'` rồi ép render lại một lần; `i18n/index.ts`
  không còn re-export `viMessages`. Cam kết "tiếng Anh là key" và fallback về tiếng Anh giữ nguyên.
- **Kiểm chứng:** bản build tách đôi — `i18n-*.js` còn **216 KB** và **không chứa chuỗi tiếng Việt** nào;
  từ điển nằm ở `vi-messages-*.js` **283 KB**, **không** có trong `modulepreload` của `index.html`, chỉ tải khi
  chọn VI. Live probe: đổi sang VI dịch đầy đủ sidebar/placeholder, giữ sau reload, 0 lỗi console.
  `messages.test.ts` (6), `provider.test.tsx` (3), `note-i18n.test.ts` (3) và `i18n-integrity.test.ts` (5) đều
  xanh; các test seed từ điển bằng `setViMessages` thay vì import tĩnh.

### LOW

**L1 — `~\` không được hiểu là home trên Windows** — **ĐÃ SỬA**
- Vị trí: `packages/work/src/paths.ts` — chỉ xử lý `~` và `~/`.
- Bằng chứng ban đầu (API thật): `POST /api/v1/projects` với `{"root":"~\\projects"}` → `400 "not a folder:
  ~\projects is not an absolute path"`; `~/projects` được expand; `\\?\D:\...` và `D:/...` được nhận (đều 409
  nếu trùng).
- Hệ quả: người dùng PowerShell gõ `~\projects` bị từ chối như đường dẫn tương đối.
- **Cách sửa:** `expandTilde(path, platform = process.platform)` nhận thêm tiền tố `~\` khi nền tảng là win32;
  `~/` giữ nguyên cho mọi nền tảng.
- **Kiểm chứng:** `windows-compat.test.ts` nay **24 test**, thêm ca `~\projects` (cùng các ca `~`, `~/x`, `~user`
  giữ nguyên).

**L2 — Pane Changes giữ câu trả lời 409 trước khi worktree sẵn sàng** — **ĐÃ SỬA**
- Vị trí: UI changes pane + `GET /runs/:id/changes`.
- Bằng chứng ban đầu: ngay sau khi tạo task, `GET /api/v1/p/demo/runs/<id>/changes` → `409 {"error":"no worktree
  — this task ran directly in the repo working tree"}`. Pane render nguyên văn "No changes to show / no worktree …"
  trong khi header đã hiện `+1 −0` và chat đã có "worktree ready" (ảnh `03-run.png`). Mở lại trang: `200` với
  `notes.md` (ảnh `14-run-tall.png`).
- Hệ quả: thông điệp sai ("ran directly in the repo") + 1 dòng console error; tự khỏi khi điều hướng lại.
- **Cách sửa:** `ChangesView` poll tiếp khi run đang chạy **hoặc** `run.worktreeLifecycle?.activeOperationId`
  đang bật (worktree đang được dựng). Trong cửa sổ đó, 409 được hiểu là đang chuẩn bị: pane hiện
  **"Preparing worktree"** (`data-slot="changes-preparing"`) thay vì kết luận "No changes to show". Lỗi 409
  ngoài cửa sổ đó vẫn là câu trả lời như cũ.
- **Kiểm chứng:** test mới trong `task-changes.test.tsx` — run `running` + `/changes` 409 → có
  `changes-preparing`, không có heading "No changes to show".

**L3 — Nhãn trạng thái trong danh sách task không dịch ở chế độ tiếng Việt** — **ĐÃ SỬA**
- Vị trí: `packages/web/src/components/task-quick-list.tsx` render `deriveAttention(run).label` **không qua
  `t()`**; nguồn nhãn: `packages/web/src/lib/attention.ts`.
- Bằng chứng ban đầu: ảnh `12-new-vi.png` — tiêu đề nhóm là "CẦN BẠN" nhưng hàng task vẫn ghi "needs you".
  Trong từ điển VI còn thiếu hẳn hai nhãn `running` và `cancelled`.
- **Cách sửa:** bọc `t()` cho cả dòng nhãn trong `NeedsYouStrip` và `aria-label` của `StatusDot`; thêm
  `'running': 'đang chạy'` và `'cancelled': 'đã hủy'` vào `vi-polish.ts`.
- **Kiểm chứng:** live probe VI (0 lỗi console) cùng bộ test i18n; các nhãn còn lại đã có khoá từ trước.

**L4 — Deep link vào task sinh một 404 vô hại lúc nạp lạnh** — **ĐÃ SỬA**
- Bằng chứng ban đầu: mở thẳng `/p/demo/tasks/<id>` → `404 GET /api/v1/runs/<id>` trước khi request có scope
  (`/p/demo/runs/<id>`) thành công.
- Nguyên nhân: `TaskPalette` nằm **trên** `ProjectScopeProvider` (trong shell) và mount task của trang ngay cả
  khi palette đóng. Trên deep link lạnh, nó có thể commit trước provider của route, nên các hook dẫn scope
  (`git/status`, `repo`, `config`, `open-targets`) gửi request **không prefix** và nhận 404 từ boot project.
- **Cách sửa:**
  - `project-scope-context.tsx` công bố **committed scope** từ layout effect của provider qua
    `useSyncExternalStore` (`useCommittedProjectScope`) — khác `getApiScope()`, vốn được ghi trong render.
  - `task-palette.tsx`: `useLiveProject()` trả `{ projectId, boot, ready }`; `ready` chỉ đúng khi route đã
    commit đúng scope URL (boot project mount không scope nên `expected = null`).
  - Subject đọc run bằng `useProjectRun(projectId, id, …, boot)` **ngay** (đọc tường minh theo project, key
    `'default'` cho boot project để dùng chung cache với thread), nhưng các lệnh dẫn scope chỉ render khi
    `ready`.
- **Kiểm chứng:** test mới — scope công bố/clear ngoài provider (`project-scope-context.test.tsx`, 8 test) và
  2 test deep link lạnh trong `task-palette.test.tsx` (26 test) khẳng định **không có** request project-level
  không prefix. Live probe 6/6 lần nạp lạnh: 0 request không scope, 0 response ≥400; `⌘P` mở đủ danh sách lệnh.

**L5 — `.env.example` thiếu biến runtime đang được đọc** — **ĐÃ SỬA**
- `ONNI_CODEX_REASONING` (`packages/work/src/core/codex-app-server-runner.ts`) và
  `ONNI_DESKTOP_DEBUG_IPC` (`packages/desktop/src-tauri/src/lib.rs`) có trong code nhưng không có trong
  `.env.example`; `ONNI_AUTO_NAMING` chỉ xuất hiện trong test, không source nào đọc.
- **Cách sửa:** thêm hai mục có mô tả và giá trị mặc định vào `.env.example`; đổi 3 chỗ `vi.stubEnv` trong
  `landing-lifecycle.test.ts`, `lifecycle-settlement.test.ts`, `unattended-landing.test.ts` sang biến thật
  `ONNI_AUTONAME`; cập nhật `docs/FEATURES.md` (§16, §17) để không còn ghi tên biến đã chết.
- Ghi chú: `ONNI_ALLOW_TEST_SPAWN` (escape hatch của `open-in-terminal.ts` cho test) và
  `ONNI_GUARD_PROBE_FOR_CHECKS` (chỉ là giá trị probe trong `secrets.test.ts`) vẫn không có trong
  `.env.example` — đây là biến test, không phải runtime; đã ghi rõ trong `docs/FEATURES.md`.

**L6 — Thiếu `.gitattributes`, checkout Windows có script `.sh` kiểu CRLF** — **ĐÃ SỬA**
- `core.autocrlf=true`, không có `.gitattributes`; `git ls-files --eol` cho `.ai/scripts/e2e.sh`,
  `test-env-up.sh`, `test-env-down.sh` là `i/lf w/crlf`. Git Bash vẫn chạy đúng, nhưng WSL/CI shell khác có thể vỡ.
- **Cách sửa:** thêm `.gitattributes` với `*.sh text eol=lf` và `*.ps1 text eol=crlf`.
- **Kiểm chứng:** `git check-attr -a` trả `text: set`, `eol: lf`; `git ls-files --eol` nay hiện
  `attr/text eol=lf`. Bản trong working tree vẫn là CRLF cho tới lần checkout kế tiếp (lệnh
  `git checkout -- '*.sh'` đã bị bộ phân loại an toàn chặn và không được ép); index đã là LF nên mọi checkout
  mới sẽ ra LF đúng chuẩn, không cần thao tác thêm.

### INFO
- 47 test vitest bị skip đều là `skipIf` theo khả năng hệ điều hành (ví dụ không có `SIGKILL`), không phải
  `.skip` cấm trong quy ước.
- `test:package` fail lần đầu chỉ ở `finally { rm(root) }` (`EBUSY`), không phải assertion CLI.
- Thư mục temp `onni-*` còn lại sau suite trên Windows — cùng nhóm vấn đề dọn dẹp của hệ điều hành.
- Kích thước phát hành: tarball 4,9 MB / 18,9 MB giải nén / 1 344 file; `packages/work/dist` 15 MB,
  `packages/work/web/dist` 6,9 MB.
- Hiệu năng cục bộ: cockpit load 520 ms, FCP 404 ms; API `health` 102 ms (lần đầu), `projects` 339 ms,
  danh sách runs 10 ms.
- Tín hiệu sống: tạo task qua API trong lúc đang mở danh sách → hàng mới xuất hiện sau **522 ms** không cần
  reload. Gửi tiếp một tin nhắn vào run đang `waiting` → lượt thứ hai chạy xong trong **<1 s** (`turn_2`).

## 3. Kiểm thử giao diện thật (không mock)

Server dựng từ bản build (`node packages/work/dist/index.js serve --port 4399`, `ONNI_DRY_RUN=1`,
`ONNI_HOME=.tmp/qa/home`, project `demo` trỏ vào `.tmp/qa/demo-repo`). Trình duyệt: Chrome hệ thống qua
`playwright-core`. Ảnh trong `.tmp/qa/shots/`.

| Bước | Kết quả |
| --- | --- |
| `/` → `/p/demo/` | đúng chuyển hướng project gần nhất, "No tasks yet" |
| `/p/demo/new` | composer, model/backend/worktree/limits, gợi ý sẵn — không lỗi console |
| Tạo task (claude mock) | chuyển tới `/p/demo/tasks/<id>`; stream hiện `run started`, `worktree ready`, tool call, ảnh mock, kết luận "draft PR #123" |
| Trạng thái run | `waiting` ("needs you"); token IN 1,2k / OUT 185; branch `onni/<id8>`; diff `+1 −0` |
| 6 tab Chat/Changes/Commits/Files/Graph/Notes | render, không crash; Changes hiện `notes.md` +1 |
| 9 surface (git, git/branches, github, tracker, inbox, automations, workflows, skills, settings) | render; không 4xx/5xx |
| Command palette `Ctrl+K` | mở; theme toggle đổi `""` → `light` |
| Gửi tiếp lời nhắn | turn thứ hai hiện trong chat, usage tăng, không lỗi |
| Settings → Appearance → Tiếng Việt | `html lang="vi"`, placeholder/sidebar/danh sách dịch đầy đủ, giữ sau reload; 0 lỗi console |
| Mobile 390×844 | `scrollWidth − clientWidth = 0` (không tràn ngang) |

Bổ sung sau khi sửa: deep link lạnh vào task (6 lần) không còn request không scope / 4xx; `⌘P` trên deep link
lạnh render đủ lệnh; asset trả gzip khi client nhận.

Hạn chế: cửa sổ Browser trong Qoder không có surface hiển thị (viewport 0×0) nên ảnh được chụp bằng
`playwright-core` + Chrome hệ thống; các bước click/fill chạy trên đúng Chromium ở trên, không phải mock DOM.

## 4. Bộ test

| File | Số test | Nội dung |
| --- | --- | --- |
| `packages/work/src/qa/windows-compat.test.ts` | 24 | `isAbsolutePath` win32 (`C:\`, `\\?\C:\`, `\\.\pipe\`), `expandTilde` (`~`, `~/x`, **`~\x` trên win32**, `~user` giữ nguyên), `allocateProjectSlug` (đường dẫn có dấu cách, id trùng, hậu tố `-N`, trần 64 ký tự, unicode), `instanceSlug`; loại run id độc hại (`..`, dấu phân cách, `C:\Windows\win.ini`, 129 ký tự); `resolveRunEventsPath` không thoát thư mục; `isPathInsideDir` chống tiền tố anh em; `readEventsTailFromPath` CRLF/dòng rách/ngoài thư mục; `agentHomePaths` ưu tiên `HOME`, fallback `USERPROFILE`; `claudeStateFilePath` |
| `packages/work/src/qa/performance.test.ts` | 4 | đọc tail 20 MB <2 s và đúng seq cuối; preview từ tail 20k dòng; `searchTranscripts` dừng đúng `maxBytesPerRun`; `RunStore.open` + `listRuns` với 2 000 record <3 s, thứ tự mới→cũ, `getRun` đúng |
| `packages/web/src/qa/i18n-integrity.test.ts` | 5 | từ điển >1 000 mục (thực tế 3 245), không bản dịch rỗng, placeholder hai chiều khớp key, giữ nguyên số dòng và không sinh `\r`/`\t` ngoài key; nạp qua `loadViMessages` (chunk lười) |
| `packages/work/src/server/static-assets.test.ts` | 8 | thương lượng gzip (`gzip;q=0`, `*`, không header), ngưỡng nén theo đuôi/kích thước, `Vary`, cache byte lần hai, 404 cho tên không an toàn |
| `packages/desktop/src-tauri/src/lib.rs` (mod tests) | 2 | URL có ký tự cmd đến `ShellExecuteW` nguyên vẹn một tham số; URL có NUL nội bộ bị bỏ |
| `packages/web/src/components/task-palette/task-palette.test.tsx` | +2 (26) | deep link lạnh trong project khác: chờ request có scope, khẳng định **không** có request project-level không prefix |
| `packages/web/src/api/project-scope-context.test.tsx` | +1 (8) | committed scope công bố cho component ngoài provider và clear khi unmount |
| `packages/web/src/routes/task-git/task-changes.test.tsx` | +1 | 409 khi run đang chạy đọc là "Preparing worktree", không phải "No changes to show" |

Chạy: `npm test -- packages/work/src/qa packages/web/src/qa` → **33/33 pass (4,2 s)**;
`npm test -- packages/work/src/server/static-assets.test.ts` → **8/8 pass**;
nhóm 27 file bị ảnh hưởng → **367/367 pass**.

## 5. Khoảng trống và khuyến nghị

1. Toàn bộ H1, M1–M3, L1–L6 đã được sửa trên `fix/audit-findings` và có test/kiểm chứng tương ứng (bảng trên).
2. Chưa bao phủ: cài/gỡ NSIS thật (`npm run build:windows`), tray Quit, `npm run test:e2e` (cần browser provider
   cấp phát) và đối chiếu thị giác với bộ ảnh reference. Ba mục này thuộc checklist "máy thật" của
   `AUDIT_REPORT.md §7` và vẫn nên chạy trước khi phát hành.
3. `npm test` native Windows vẫn có ~50–60 fail dạng thời gian/dọn temp (đã có từ trước, không liên quan bản
   sửa); dùng CI làm thẩm quyền, đúng như AGENTS.md.
4. Việc còn lại (không phải lỗi): checkout lại để working tree nhận `eol=lf` cho script `.sh`; push/PR theo
   quyết định của người dùng.

## Phụ lục A — tái lập nhanh

```bash
# H1: URL có ký tự cmd phải đến shell nguyên vẹn (test Rust)
cd packages/desktop/src-tauri && cargo test a_url_reaches_the_shell_as_one_argument

# M1: ngân sách + có đủ tree/roster
node --import tsx -e "import {managerCommandsBlock} from './packages/work/src/dispatch/commands.ts'; const b=managerCommandsBlock(); console.log(b.length, b.includes('onni task tree'), b.includes('onni task roster'))"
# → 2246 true true (ngân sách 2400)

# M2: asset nén khi client nhận gzip
curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' http://localhost:4399/assets/<hashed>.js | grep -i 'content-encoding\|vary\|content-length'

# M3: từ điển không còn trong preload
grep -o 'vi-messages-[^"]*' packages/work/web/dist/index.html   # rỗng
ls -l packages/work/web/dist/assets/vi-messages-*.js            # ~283 KB, chunk riêng

# L1: tilde kiểu Windows
node .tmp/qa/project-paths.mjs

# L4: deep link lạnh không sinh request không scope
node .tmp/qa/l4-final.mjs
```

Ảnh: `.tmp/qa/shots/01-landing.png`, `02-new-task.png`, `03-run.png`, `04-tab-*.png`, `05-*.png`,
`06-command-palette.png`, `07-appearance.png`, `08-mobile-new.png`, `10-settings-vi.png`, `12-new-vi.png`,
`14-run-tall.png`, `15-run-reply.png`, `16-live-signal.png`.
Dữ liệu thô: `.tmp/qa/smoke-report.json`, `http-errors.json`, `changes-probe.json`, `i18n-switch.json`,
`run-reply2.json`, `vitest-report.json`, `cargo-check.log`, `cargo-test.log`, `test-package*.log`.
