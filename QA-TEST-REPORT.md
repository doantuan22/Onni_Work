# QA toàn hệ thống — báo cáo kiểm thử

Ngày: 2026-11-12 · Nhánh: `test/full-system-audit` (tách từ `dev` @ `fc6f5a7`)
Máy: Windows 11 (10.0.26200), Git Bash, Node 24.21.0, npm 11.19.0, Chrome hệ thống, Rust 1.99.1.
Phạm vi theo yêu cầu: luồng hoạt động, chức năng, giao diện, tối ưu hệ thống, tương thích Windows.
Ràng buộc: **chỉ kiểm thử và viết code test — không sửa mã logic.** Bản thay đổi của nhánh này gồm đúng ba
file test mới và báo cáo này; `git diff --stat` trên mã nguồn bằng rỗng.

## 1. Kết quả các cổng (chạy trên checkout này)

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

## 2. Phát hiện

### HIGH

**H1 — Desktop: chèn lệnh qua `cmd /C start` khi mở URL chứa `&`**
- Vị trí: `packages/desktop/src-tauri/src/lib.rs:1712-1718` (`open_url`), được gọi từ `on_new_window`
  (`:258-260`), `on_navigation` (`:265-271`), `on_page_load` (`:293`).
- Hiện tượng: trên Windows, URL được đưa vào `Command::new("cmd").args(["/C", "start", "", url])`.
  Rust chỉ đặt ngoặc kép khi tham số có dấu cách; URL do `Url::as_str()` sinh ra không có dấu cách, nên `&`
  `|` `<` `>` `^` `%VAR%` vẫn còn sống với `cmd.exe`. Bất kỳ liên kết `target="_blank"` nào trong cockpit
  (markdown của agent, dữ liệu repo, tracker, redirect của trang preview) đều đi qua `open_url`.
- Bằng chứng (tái lập được, xem phụ lục A): chương trình Rust tối giản gọi
  `Command::new("cmd").args(["/C","echo","https://e.test/?a=1&ver"])` in ra
  `https://e.test/?a=1` **và cả `Microsoft Windows [Version 10.0.26200.9974]`** — tức `ver` đã được thi hành
  như lệnh thứ hai. `fn open_url` chỉ thay `echo` bằng `start ""`, cơ chế phân tách không đổi.
- Đối chiếu: phía server đã vá đúng lớp lỗi này — `server/open-in-app.ts`, `server/open-in-terminal.ts` và
  `core/windows-shim.ts` đều từ chối đi qua `cmd.exe` (BatBadBut, #459). Desktop là chỗ duy nhất còn lại.
- Hướng sửa (không thực hiện trong nhánh này): không dùng shell — `rundll32 url.dll,FileProtocolHandler <url>`
  hoặc `ShellExecuteW`; đồng thời từ chối scheme ngoài `http/https/mailto` trước khi mở.

### MEDIUM

**M1 — Bảng lệnh `onni task` vượt ngân sách prompt: mất `onni task tree` + test đỏ thường trực**
- Vị trí: `packages/work/src/dispatch/commands.ts:77-84` (mục `roster` thêm trong `75cfc0c`),
  `packages/work/src/dispatch/prompt-budget.ts:17` (`MANAGER_COMMANDS_MAX_CHARS = 2100`, không đổi),
  `packages/work/src/dispatch/commands.test.ts:15` (`CLI_COMMANDS` không có `roster`), `:51` (canh `tree`).
- Hiện tượng: `briefCommands('manager')` dài **2246 ký tự**, ngân sách 2100, `clampLines` cắt dòng cuối nên
  block còn **1991 ký tự** và **mất dòng `onni task tree`**. Test `keeps every brief block inside its own budget`
  fail đúng như thiết kế canh gác của nó; test `holds every command the CLI answers` fail vì danh sách kỳ vọng
  chưa có `roster`. Đây là test đỏ **tất định**, không phải flake.
- Bằng chứng: `npm test -- --no-file-parallelism packages/work/src/dispatch/commands.test.ts` →
  `Tests 2 failed | 22 passed`; đo trực tiếp: `managerCommandsBlock().length === 1991`, `budget 2100`,
  `briefCommands('manager').length === 2246`, `includes('onni task tree') === false`.
- Hệ quả: cổng `npm test`/CI đỏ từ `75cfc0c`, và prompt của manager không còn được dạy lệnh `tree` đã có trong
  `docs/reference.md`.
- Hướng sửa: thêm `roster` vào `CLI_COMMANDS`, và nâng `MANAGER_COMMANDS_MAX_CHARS` (hoặc rút gọn brief của
  `roster`) để block chứa đủ 16 dòng.

**M2 — Asset tĩnh không nén và đọc đồng bộ mỗi request**
- Vị trí: `packages/work/src/server/server.ts:1331-1341` (`app.get('/assets/:file')` → `readFileSync(path)`),
  không có middleware nén nào trong `packages/work` (không phụ thuộc `compress`, không `zlib`).
- Hiện tượng: `curl -H "Accept-Encoding: gzip, br" /assets/i18n-*.js` trả về **không có `Content-Encoding`**,
  `Content-Length: 498612`. Tải cockpit đầu tiên: **50 file JS preload, 1 708 KB thô / 536 KB nếu gzip**; riêng
  chunk `i18n-*.js` là 498,6 KB thô (149,4 KB gzip) và nằm trong `modulepreload` của `index.html`.
- Đo trong Chrome thật: `transferSize` cộng dồn ≈ 2 569 KB cho 55 resource (tức bằng `decodedBodySize`), FCP
  404 ms, load 520 ms trên loopback. Với bản `onni server-install` (truy cập qua ngrok) đây là chi phí thật.
- Hướng sửa: nén khi phục vụ (`CompressionStream('gzip')` của Web Streams, không cần dependency mới) hoặc phát
  file `.gz`/`.br` lúc build; thêm cache byte vào bộ nhớ cho `/assets/*` đã `immutable` để khỏi `readFileSync`
  đồng bộ 50 lần mỗi lần tải.

**M3 — Toàn bộ từ điển tiếng Việt được tải cho cả người dùng tiếng Anh**
- Vị trí: `packages/web/src/lib/i18n/messages.ts` gộp mọi `vi-*.ts` vào một chunk; `index.html` modulepreload
  chunk đó.
- Hiện tượng: chunk `i18n-*.js` 498,6 KB thô / 149,4 KB gzip; bản dịch có 3 245 mục, trong khi mặc định là
  tiếng Anh (`translate('en')` là identity).
- Hướng sửa: `import()` từ điển VI theo ngôn ngữ đã lưu (hoặc theo route Settings → Appearance), chỉ nạp khi
  `language === 'vi'`; giữ nguyên cam kết "tiếng Anh là key".

### LOW

**L1 — `~\` không được hiểu là home trên Windows**
- Vị trí: `packages/work/src/paths.ts:134-137` — chỉ xử lý `~` và `~/`.
- Bằng chứng (API thật): `POST /api/v1/projects` với `{"root":"~\\projects"}` → `400 "not a folder: ~\projects is
  not an absolute path"`; `~/projects` được expand; `\\?\D:\...` và `D:/...` được nhận (đều 409 nếu trùng).
- Hệ quả: người dùng PowerShell gõ `~\projects` bị từ chối như đường dẫn tương đối.
- Hướng sửa: nhận thêm `~\\` trong `expandTilde`.

**L2 — Pane Changes giữ câu trả lời 409 trước khi worktree sẵn sàng**
- Vị trí: UI changes pane + `GET /runs/:id/changes`.
- Bằng chứng: ngay sau khi tạo task, `GET /api/v1/p/demo/runs/<id>/changes` → `409 {"error":"no worktree — this
  task ran directly in the repo working tree"}` (bắt được trong lúc chạy flow tạo task). Pane render nguyên văn
  "No changes to show / no worktree …" trong khi header đã hiện `+1 −0` và chat đã có "worktree ready"
  (ảnh `03-run.png`). Mở lại trang: `200` với `notes.md` (ảnh `14-run-tall.png`).
- Hệ quả: thông điệp sai ("ran directly in the repo") + 1 dòng console error; tự khỏi khi điều hướng lại.
- Hướng sửa: trả `200 {files:[], pending:true}` khi chưa có worktree, hoặc refetch pane theo sự kiện
  "worktree ready".

**L3 — Nhãn trạng thái trong danh sách task không dịch ở chế độ tiếng Việt**
- Vị trí: `packages/web/src/components/task-quick-list.tsx:192` render `deriveAttention(run).label` **không qua
  `t()`**; nguồn nhãn: `packages/web/src/lib/attention.ts:131-183`.
- Bằng chứng: ảnh `12-new-vi.png` — tiêu đề nhóm là "CẦN BẠN" nhưng hàng task vẫn ghi "needs you". Trong từ
  điển VI còn thiếu hẳn hai nhãn `running` và `cancelled` (các nhãn khác đã có).
- Hướng sửa: bọc `t(label)` và bổ sung hai khoá còn thiếu.

**L4 — Deep link vào task sinh một 404 vô hại lúc nạp lạnh**
- Bằng chứng: mở thẳng `/p/demo/tasks/<id>` → `404 GET /api/v1/runs/<id>` trước khi request có scope
  (`/p/demo/runs/<id>`) thành công; 404 này đã được ghi nhận là chủ ý trong
  `packages/web/src/api/project-scope-context.test.tsx:93`.
- Hệ quả: chỉ là nhiễu console; trang vẫn tải đúng.

**L5 — `.env.example` thiếu biến runtime đang được đọc**
- `ONNI_CODEX_REASONING` (`packages/work/src/core/codex-app-server-runner.ts:772`) và
  `ONNI_DESKTOP_DEBUG_IPC` (`packages/desktop/src-tauri/src/lib.rs:2055`) có trong code nhưng không có trong
  `.env.example`; `ONNI_AUTO_NAMING` chỉ xuất hiện trong test, không source nào đọc (đã ghi ở
  `docs/FEATURES.md:345,367`). Vi phạm quy ước "mọi `ONNI_*` phải có trong `.env.example`".

**L6 — Thiếu `.gitattributes`, checkout Windows có script `.sh` kiểu CRLF**
- `core.autocrlf=true`, không có `.gitattributes`; `git ls-files --eol` cho `.ai/scripts/e2e.sh` và
  `test-env-up.sh` là `i/lf w/crlf`. Đã thử: Git Bash `sh` vẫn chạy đúng cả trường hợp dùng
  `$(dirname "$0")`, nên hiện chưa gây lỗi; nhưng WSL/CI shell khác có thể vỡ.
- Hướng sửa: `.gitattributes` với `*.sh text eol=lf`, `*.ps1 text eol=crlf`.

### INFO
- 47 test vitest bị skip đều là `skipIf` theo khả năng hệ điều hành (ví dụ không có `SIGKILL`), không phải
  `.skip` cấm trong quy ước.
- `test:package` fail lần đầu chỉ ở `finally { rm(root) }` (`EBUSY`), không phải assertion CLI.
- Thư mục temp `onni-*` còn lại sau suite trên Windows — cùng nhóm vấn đề dọn dẹp của hệ điều hành.
- Kích thước phát hành: tarball 4,9 MB / 18,9 MB giải nén / 1 340 file; `packages/work/dist` 15 MB,
  `packages/work/web/dist` 6,9 MB (173 asset).
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

Hạn chế: cửa sổ Browser trong Qoder không có surface hiển thị (viewport 0×0) nên ảnh được chụp bằng
`playwright-core` + Chrome hệ thống; các bước click/fill chạy trên đúng Chromium ở trên, không phải mock DOM.

## 4. Bộ test mới trên nhánh

| File | Số test | Nội dung |
| --- | --- | --- |
| `packages/work/src/qa/windows-compat.test.ts` | 23 | `isAbsolutePath` win32 (`C:\`, `\\?\C:\`, `\\.\pipe\`), `expandTilde` (`~`, `~/x`, `~user` giữ nguyên), `allocateProjectSlug` (đường dẫn có dấu cách, id trùng, hậu tố `-N`, trần 64 ký tự, unicode), `instanceSlug`; loại run id độc hại (`..`, dấu phân cách, `C:\Windows\win.ini`, 129 ký tự); `resolveRunEventsPath` không thoát thư mục; `isPathInsideDir` chống tiền tố anh em; `readEventsTailFromPath` CRLF/dòng rách/ngoài thư mục; `agentHomePaths` ưu tiên `HOME`, fallback `USERPROFILE`; `claudeStateFilePath` |
| `packages/work/src/qa/performance.test.ts` | 4 | đọc tail 20 MB <2 s và đúng seq cuối; preview từ tail 20k dòng; `searchTranscripts` dừng đúng `maxBytesPerRun`; `RunStore.open` + `listRuns` với 2 000 record <3 s, thứ tự mới→cũ, `getRun` đúng |
| `packages/web/src/qa/i18n-integrity.test.ts` | 4 | từ điển >1 000 mục (thực tế 3 245), không bản dịch rỗng, placeholder hai chiều khớp key, giữ nguyên số dòng và không sinh `\r`/`\t` ngoài key |

Chạy: `npm test -- packages/work/src/qa packages/web/src/qa` → **31 passed (2,4 s)**.

## 5. Khoảng trống và khuyến nghị

1. Sửa M1 trước khi đóng gói — hiện `npm test`/CI đỏ và prompt manager thiếu một lệnh đã tài liệu hoá.
2. Sửa H1 ở desktop trước khi phát hành bản cài Windows (đây là đường RCE cục bộ cần một cú click).
3. Trước khi test dùng thật: nâng `MANAGER_COMMANDS_MAX_CHARS`, thêm `.gitattributes`, và cân nhắc nén asset
   nếu cockpit sẽ chạy qua `onni server-install`/ngrok.
4. Chưa bao phủ: cài/gỡ NSIS thật (`npm run build:windows`), tray Quit, `npm run test:e2e` (cần browser provider
   cấp phát) và đối chiếu thị giác với bộ ảnh reference. Ba mục này thuộc checklist "máy thật" của
   `AUDIT_REPORT.md §7` và vẫn nên chạy trước khi phát hành.
5. Không chạy được trên máy này: `npm test` native Windows luôn có ~50–60 fail dạng thời gian/dọn temp; dùng CI
   làm thẩm quyền (đúng như AGENTS.md).

## Phụ lục A — tái lập nhanh

```bash
# H1: Rust + cmd chia tách tham số
cd .tmp/qa && rustc -O cmd-probe.rs -o cmd-probe.exe && ./cmd-probe.exe
# → in "https://e.test/?a=1" rồi "Microsoft Windows [Version 10.0.26200.9974]"

# M1: test đỏ tất định + đo ngân sách
npm test -- --no-file-parallelism packages/work/src/dispatch/commands.test.ts
node --import tsx -e "import {managerCommandsBlock} from './packages/work/src/dispatch/commands.ts'; console.log(managerCommandsBlock().length, managerCommandsBlock().includes('onni task tree'))"

# M2: asset không nén
curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip, br' http://localhost:4399/assets/i18n-DEkbFErM.js | grep -i 'content-encoding\|content-length'

# L1: tilde kiểu Windows
node .tmp/qa/project-paths.mjs
```

Ảnh: `.tmp/qa/shots/01-landing.png`, `02-new-task.png`, `03-run.png`, `04-tab-*.png`, `05-*.png`,
`06-command-palette.png`, `07-appearance.png`, `08-mobile-new.png`, `10-settings-vi.png`, `12-new-vi.png`,
`14-run-tall.png`, `15-run-reply.png`, `16-live-signal.png`.
Dữ liệu thô: `.tmp/qa/smoke-report.json`, `http-errors.json`, `changes-probe.json`, `i18n-switch.json`,
`run-reply2.json`, `vitest-report.json`, `cargo-check.log`, `cargo-test.log`, `test-package*.log`.
