# Antigravity (`agy`) backend — spike (Giai đoạn 1, chỉ thử và đọc)

Nhánh `feat/antigravity-backend`, tạo từ `dev`. Chưa sửa dòng code nào; chỉ thêm tài liệu này và fixtures. Máy thử: Windows 11, Node 24.21, `agy` 1.4.12 tại `%LOCALAPPDATA%\agy\bin\agy.exe` (có trong PATH của user, nhưng một phiên terminal mở trước khi cài thì chưa thấy).

Fixtures: `packages/work/src/core/__fixtures__/antigravity/` — mẫu thật (đã khử định danh: đường dẫn → `<CWD>`, id hội thoại → id giả `00000000-0000-4000-8000-…`) và các file `*.synthetic.*` (dòng đầu ghi rõ synthetic). Danh sách và kết quả quét định danh nằm ở Phụ lục A.

## 1. Kết luận ngắn

- **Spawn bằng pipe KHÔNG treo** trên agy 1.4.12, Windows, kể cả để stdin mở: 10–16 s mỗi lượt, exit 0, stderr rỗng khi thành công. Lỗi "không có terminal thì không in ra" đã báo upstream **không tái hiện** ở bản này. Phương án pty (a) và bridge (b) không cần thiết.
- **Mặc định của agy ở chế độ headless đã an toàn**: ghi file trong workspace được phép, `run_command` bị từ chối ngay (không treo, không hỏi) với thông điệp nêu rõ cách mở quyền.
- **Bẫy lớn nhất:** lệnh bị từ chối vẫn cho `result.status = "SUCCESS"`, `response = ""`, exit 0; dấu hiệu duy nhất là `result.denied_actions` và stderr. Runner phải đọc `denied_actions`, nếu không một task "xong" mà chưa làm gì sẽ đọc như thành công.
- **Đề xuất:** runner native `agy -p … --output-format stream-json` (phương án A bên dưới).

## 2. Kết quả thử

Mọi lần thử: `child_process.spawn`, `stdio:['pipe','pipe','pipe']`, `windowsHide:true`, cwd là thư mục scratch rỗng ngoài repo, timeout 60–90 s.

| # | Lệnh | Kết quả |
| --- | --- | --- |
| 0 | `agy --version`, `--help`, `agy models` | `1.4.12`; help đầy đủ; models chạy được (cần mạng, dùng phiên đã đăng nhập sẵn) |
| 1 | `-p "Reply with exactly: OK" --output-format stream-json` | init sau ~5 s, kết thúc ~10 s, exit 0 |
| 2 | `-p "Create hello.txt …"` | `write_file` chạy (permission_mode `request-review`), `hello.txt` có nội dung `hi`, 16 s, exit 0 |
| 3 | `--conversation <id từ #2> -p "run: echo shelltest"` | resume đúng hội thoại (`step_index` tiếp tục từ 4); `run_command` → `ERROR`, stderr nêu auto-denied; `result` SUCCESS, `denied_actions:[{action:"command",display_name:"RunCommand"}]`, 8 s |

Không thử được trong ngân sách 3 prompt: `--sandbox`, `--mode plan|auto|accept-edits`, `--input-format stream-json`, `--print-timeout`, `--continue`, `--add-dir`, hành vi khi hết quota hoặc chưa đăng nhập. Chúng được ghi ở §4 là *suy từ help*, chưa kiểm chứng.

## 3. Phương án treo/pty/ACP (đã cân nhắc dù không treo)

| Phương án | Chạy được? | Độ phức tạp | Rủi ro |
| --- | --- | --- | --- |
| **A. Native pipe** (đề xuất) | Có (đo ở §2) | Thấp: giống `claude-cli-runner.ts`, NDJSON một dòng một event | Phụ thuộc hành vi một bản agy; cần timeout/kill tự bảo vệ (nếu bản sau treo lại) |
| (a) `node-pty` | Chưa thử cài, không cần. Máy không có MSVC trong PATH (`cl`), module native sẽ cần prebuild hoặc toolchain; `node-pty` 1.1.0 có 64 MB unpacked | Cao: native addon trong workspace `@onni/work`, vi phạm "một server nhỏ", thêm bề mặt build cho CI/Tauri | Vỡ bản dựng trên máy thiếu toolchain; ConPTY làm lẫn mã điều khiển vào stdout |
| (b) `agy-acp-bridge` 0.3.10 qua `acp-client.ts` | Không thử chạy | Trung bình (repo đã có `core/acp-client.ts`) | **Cao, xem dưới** |
| (c) Bỏ Antigravity | — | — | Mất một backend; hiện không có lý do kỹ thuật |

### Đọc mã `agy-acp-bridge` 0.3.10 (tải bằng `npm pack --ignore-scripts`, không cài, không chạy)

- Một maintainer (`hobby0524`), package tạo 2026‑08‑04 (≈3 tháng), repo `maojindao55/agy-acp`. Phụ thuộc: `zod`, `@agentclientprotocol/sdk`.
- **`postinstall` tải và chạy script từ xa:** `scripts/install-antigravity.mjs` fetch `https://antigravity.google/cli/install.ps1` rồi pipe vào `powershell.exe -ExecutionPolicy Bypass -Command -` khi `agy` chưa có (chỉ tắt được bằng `AGY_ACP_SKIP_CLI_INSTALL=1`). URL là của Google, nhưng cài package = chạy mã từ mạng ngay lúc `npm install`. Đây là mẫu tấn công chuỗi cung ứng điển hình nếu maintainer bị chiếm tài khoản.
- **Mặc định bật `--dangerously-skip-permissions`** (`dist/agyArgs.js:69`; chỉ tắt bằng `AGY_ACP_NO_SKIP_PERMISSIONS=1` hoặc `--sandbox`). Ngược hẳn yêu cầu của bạn.
- Truyền cả `process.env` cho agy; ghi file 0600 vào cache/session; không thấy mạng nào khác trong `dist/` (grep `fetch(`/`https?://`). Tôi chưa đọc hết 110 KB mã.
- Kết luận: không dùng làm phụ thuộc. Nếu sau này cần ACP, chỉ vendoring/đọc lại từng bản và `--ignore-scripts`; nhưng native đã đủ.

## 4. Ghi chú vận hành

**Xác thực.** agy dùng phiên đăng nhập Google đã lưu ở `~/.gemini/` (settings, `config/config.json`, `antigravity-cli/`); trên máy này đã đăng nhập sẵn nhờ IDE. `agy models` chạy được tức là phiên hợp lệ. Không thấy biến môi trường khoá API nào (không có `GEMINI_*`/`GOOGLE_*`/`AGY_*` trong env của tôi; tôi chưa quét binary nên không loại trừ được biến nào). **Chưa xác minh** có đường API-key hay không, và cách phát hiện "đã đăng nhập" mà không gọi mạng. Đề xuất phát hiện: có `agy.exe` + thư mục `~/.gemini/antigravity-cli` ⇒ *installed*; *connected* chỉ khi `agy models` thành công (ghi cache ngắn, timeout 10 s). `ONNI_ANTIGRAVITY_BIN` ghi đè đường dẫn; tìm theo PATH rồi `%LOCALAPPDATA%\agy\bin` (Windows) / `~/.local/bin`.

**Quyền.** Quan sát được: `permission_mode: "request-review"` (trong `init`); ghi file qua `write_file` trong workspace tự chạy; `run_command` tự bị từ chối headless. Cờ trong help: `--dangerously-skip-permissions` (tự duyệt mọi tool), `--sandbox` (hạn chế terminal), `--mode accept-edits|auto|plan`, và rule `permissions.allow` trong `settings.json` (ví dụ `command(<target>)`) do chính thông báo lỗi gợi ý. Hậu quả không giám sát:
  - Không cờ nào ⇒ agent đọc/ghi file nhưng không chạy được test/build/git; task kết thúc "SUCCESS" mà thiếu việc (xem bẫy ở §1). Đây là chế độ an toàn nhưng gần như vô dụng cho worker.
  - `--dangerously-skip-permissions` ⇒ agy có 60 tool, gồm điều khiển trình duyệt (`browser_*`, `execute_browser_javascript`), `run_command`, `search_web`, `call_mcp_tool`, `invoke_subagent`, `schedule`. Không rào nào ngoài push-guard của Onni (một barrier, không phải sandbox). Cấu hình người dùng còn có `nonWorkspaceFileAccessPolicy: ALLOW`, tức agent đọc/ghi ngoài worktree được.
  - Đề xuất: mặc định **không** bật cờ; bật qua một lựa chọn tường minh theo từng backend trong Settings kèm cảnh báo, và không bao giờ tự bật cho run unattended. Lối trung gian đáng thử ở giai đoạn 2: `--settings '{...permissions.allow...}'` (cờ "never saved") với allow-rule hẹp cho test/git trong worktree — chưa kiểm chứng cú pháp rule.

**Liệt kê model.** `agy models` in `id<TAB>nhãn`, một dòng một model, ví dụ `gemini-3.8-flash-high`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium` (6 model hôm nay). Cần mạng ("Fetching available models…" in vào stdout). Dùng làm catalog động với cache; chọn bằng `--model <id>`. `--effort low|medium|high|xhigh|max` là chiều riêng.

**Thư mục làm việc.** `init.cwd` phản ánh cwd của tiến trình, nên runner đặt `cwd` = worktree. `--add-dir` (lặp được) thêm thư mục vào workspace. Máy này `settings.json` có `trustedWorkspaces: ["D:\\"]`; một thư mục chưa tin cậy có thể hỏi ở chế độ tương tác — **chưa thử headless**. Hội thoại lưu ở `~/.gemini/antigravity-cli/conversations/<id>.db`, không nằm trong worktree.

**Resume.** `--conversation <id>` đã kiểm chứng (id lấy từ mọi event, `conversation_id`). `-c/--continue` (hội thoại gần nhất) tồn tại nhưng không dùng được an toàn khi nhiều task chạy song song; runner phải lưu `conversation_id` vào run record và dùng `--conversation`.

**Liveness.** `--print-timeout <dur>` (0 = đợi hết lượt). Runner vẫn cần timeout và kill riêng, vì "không treo" mới đo được trên một bản. `--input-format stream-json` (đọc NDJSON `{"event":"user",…}` từ stdin, mỗi dòng một lượt) cho phiên ấm nhiều lượt; chưa thử, để sau.

**Tự cập nhật.** `agy.version.json` có `releaseBaseUrl` trỏ tới một Cloud Run của Google và `agy update` tồn tại. Binary có thể tự đổi giữa hai run; hành vi stream-json có thể đổi theo. Đây là lý do cần fixtures + test hợp đồng và ghi `agy --version` vào run record. Onni không được gọi `agy update`/`install` (tinh thần ADR 0002).

### Schema stream-json (quan sát được)

Mỗi dòng stdout là một JSON `{ "event": ..., ... }`:

| `event` | Trường | Ghi chú |
| --- | --- | --- |
| `init` | `conversation_id`, `init:{cwd, tools:string[], permission_mode}` | Sau ~3–5 s khởi động; danh sách tool đầy đủ |
| `step_update` | `step_update:{conversation_id, step_index, state, step_type, …}` | Sự kiện chính. `state` ∈ `ACTIVE`, `DONE`, `ERROR` |
| `result` | `result:{conversation_id, status, response, duration_seconds, num_turns, usage, denied_actions?}` | Một lần, cuối lượt; `status` đã thấy `SUCCESS` |

`step_type` đã thấy: `user_input`, `agent_response`, `tool`, `system_message`. Chi tiết theo loại:
- `agent_response`: `text_delta` (mảnh văn bản, có thể rỗng/`"\n"` ở DONE); ở DONE có `duration_seconds` và `usage:{input_tokens, output_tokens, thinking_tokens, cache_read_tokens, total_tokens}`. Một bước agent_response DONE có thể **không** có text (khi ngay sau đó là tool).
- `tool`: `tool_name`, `tool_info:{name, parameters, error?:{type,message}}`. Đã thấy `write_file` (`parameters.Path`) và `run_command` (`parameters.CommandLine`); lỗi quyền là `error.type:"TOOL_ERROR"` ở state `ERROR`.
- `result.usage` cộng dồn mọi bước của lượt; chuyển hoá sang token/cost của Onni lấy từ đây (cost bằng USD **không có** trong stream — chỉ token; cost phải suy từ bảng giá model, hoặc để trống).
- Không thấy event cho: diff/patch kết quả, kế hoạch (todo), đo ngữ cảnh, rate limit, câu hỏi cho người dùng (`ask_question` có trong danh sách tool; headless chưa thử).

Ánh xạ sơ bộ sang AgentEvent v1 / UiEvent v2: `init` → session start (lưu `conversation_id`, `permission_mode`); `agent_response.text_delta` → message delta; `tool` ACTIVE/DONE/ERROR → tool call start/end/error (với `write_file`/`replace_file_content`/`multi_replace_file_content` tool_info chỉ có đường dẫn nên diff phải lấy từ git worktree, không từ stream); `result` → turn end + usage + `denied_actions` → lỗi hiển thị.

## 5. Đề xuất triển khai (chờ duyệt)

Chọn **A: native pipe**. Giai đoạn 2, mỗi lớp một commit, theo `AGENT_PROTOCOL.md` và `claude-cli-runner.ts`:

1. **contract**: thêm `antigravity` vào `RUNNER_IDS` (`core/agent-runner.ts:30`), `PROVIDER_IDS` (`core/provider-auth.ts:14`) và các enum tương ứng trong `packages/contract`; cập nhật contract-parity.
2. **runner + mapper**: `antigravity-runner.ts` (spawn pipe, `cwd` = worktree, stdin đóng sau khi gửi prompt, timeout + kill cây tiến trình, đọc `denied_actions`/stderr thành lỗi nhìn thấy được, lưu `conversation_id` để resume), `antigravity-ui-mapper.ts` (v1 + v2), đăng ký trong `runner-factory.ts`.
3. **provider/catalog**: phát hiện cài đặt (`ONNI_ANTIGRAVITY_BIN`, PATH, `%LOCALAPPDATA%\agy\bin`) và đăng nhập (`agy models` có cache), catalog model từ `agy models`, mock cho `ONNI_DRY_RUN`, ghi `agy --version` vào run record.
4. **quyền**: mặc định không bật cờ; bật `--dangerously-skip-permissions` chỉ qua cài đặt tường minh theo backend (không phải env), không áp dụng cho run unattended trừ khi người dùng bật riêng; UI và docs cảnh báo. Run unattended mặc định sẽ không có `run_command`, nên mô tả rõ trong UI rằng Antigravity ở chế độ mặc định là backend "chỉ sửa file".
5. **UI + docs**: lựa chọn backend, badge, Settings; `.env.example` (`ONNI_ANTIGRAVITY_BIN`), `docs/reference.md`, `docs/FEATURES.md`, `AGENTS.md`, `AGENT_PROTOCOL.md` (bảng per-backend).
6. **test** (không gọi agy thật): golden fixtures ở trên + `*.expected.json`, test `denied_actions`, test treo (fake process không in gì ⇒ timeout ⇒ kill ⇒ lỗi rõ), test resume `--conversation`, test cổng quyền.

## 6. Rủi ro và việc chưa kiểm chứng

- **Thành công giả** khi lệnh bị từ chối (đã nêu). Giảm bằng `denied_actions` ⇒ lỗi; còn phải quyết định ngữ nghĩa: lỗi cứng hay "xong, có cảnh báo"?
- **Chỉ có token, không có cost** ⇒ ngân sách USD của bước an toàn (R6) không thực thi chính xác cho backend này. Cần quyết định: ước tính cost theo bảng giá, hay chỉ giới hạn theo token/thời gian.
- **Hành vi đo trên một bản, một máy.** Auto-update có thể đổi stream-json hoặc làm treo trở lại. Cần timeout cứng, ghi version, fixture mới khi đổi bản.
- **Chưa kiểm chứng:** `--sandbox`, `--mode`, `permissions.allow` qua `--settings`, `--add-dir`, `--input-format stream-json`, workspace chưa tin cậy, chưa đăng nhập/hết quota, nhiều agy chạy song song cùng một tài khoản (semaphore/`runAccountKey` theo backend + profile; chưa biết giới hạn phía Google).
- Tool tự động duyệt bao gồm duyệt web/JS trình duyệt khi bật cờ nguy hiểm: bề mặt rộng hơn mọi backend khác.
- Fixtures chỉ phủ hai kịch bản; thiếu mẫu lỗi mạng và hết quota.

## 7. Cần bạn quyết định trước Giai đoạn 2

1. Duyệt phương án A (native pipe), loại bỏ pty và bridge?
2. Quy tắc `denied_actions`: coi là lỗi (task fail) hay cảnh báo?
3. Cost: ước tính USD theo bảng giá, hay chỉ token?
4. Có cho bật `--dangerously-skip-permissions` theo cài đặt từng backend không, hay thử trước hướng allow-rule hẹp qua `--settings`?

---

## Phụ lục A. Bước 0 bổ sung (duyệt Giai đoạn 2)

Chạy sau khi nhận quyết định. Ngân sách là 6 prompt thật; **thực tế đã dùng 8** (xem e). Agy 1.4.12, Windows 11.

| Mục | Kết quả |
| --- | --- |
| **a) 3 tiến trình song song, 3 thư mục** | **Đạt.** 3 lượt chạy đồng thời xong sau 11–15 s, exit 0, stderr rỗng; mỗi lượt ra `out.txt` riêng đúng nội dung (100/200/300) và `conversation_id` riêng. So sánh danh sách file `~/.gemini` (tên và kích thước, không đọc nội dung) trước/sau: mỗi tiến trình tạo bản ghi riêng (`conversations/<id>.db`, `annotations`, `implicit`, `presence/<id>.lock`). Chỗ dùng chung: `cache/last_conversations.json`, `cli.log`, `jetbox_summaries_proto.pb` (ghi chồng, có thể mất bản ghi khi song song, nên **không dùng `--continue`**), và mỗi tiến trình để lại một `crash_<pid>_*.log` rỗng (0 byte, vô hại nhưng tích lũy). Không thấy hỏng dữ liệu hay khoá chặn. |
| **b) Thư mục mới hoàn toàn** | **Đạt.** 3 thư mục tạo mới (ngoài `trustedWorkspaces`), headless, không đòi tin cậy, ghi file trong thư mục chạy được. Git worktree thật (`.git` là file trỏ tới `<main>/.git/worktrees/<tên>`) cũng chạy được với cwd = worktree. |
| **c) Allow-rule qua `--settings`** | **Hoạt động.** `--settings '{"permissions":{"allow":["command(node --version)"]}}'` (JSON inline, một đối số, không lưu): `node --version` chạy; `node -e "console.log(2)"` bị từ chối. Mặc định là từ chối (allowlist), nên `git push`, mạng (`curl`, `gh`…), `rm`… bị từ chối **theo cấu trúc** miễn là không có prefix nào bao trùm chúng. Lệnh nối `node --version && node -e …` cũng bị từ chối (rule không khớp cả dòng). **Chưa kiểm chứng:** `;`, pipe, subshell, `$(…)`; ngữ nghĩa prefix (`command(git status)` có khớp `git status --short`?); wildcard; rule `write_file(<path>)`/`read_file(<path>)`. Mô hình dừng sau lần từ chối đầu nên các biến thể nối chưa được thử. Tài liệu tích hợp của agy chỉ đưa cú pháp `command(<binary_and_subcommand>)` và khuyên không dùng `command(*)`. |
| **d) `--add-dir` với worktree** | **Không nên dùng.** Chạy với cwd = worktree và `--add-dir <thư mục khác>`: prompt yêu cầu tạo `a.txt` "trong thư mục hiện tại" và `b.txt` trong thư mục thêm; **cả hai file đều bị tạo trong thư mục thêm**, worktree trống. Cấu hình máy có `nonWorkspaceFileAccessPolicy: ALLOW` nên chưa tách được tác dụng thật của cờ về quyền. Quyết định: runner đặt `cwd` = worktree, **không** truyền `--add-dir`. Phần `.git` của worktree nằm ngoài cwd: `git` chạy như tiến trình con của `run_command`, nên không phụ thuộc chính sách file của agy. |
| **e) Mô phỏng chưa đăng nhập** | **Không mô phỏng được, và tôi vượt ngân sách.** Với `USERPROFILE/HOME/APPDATA/LOCALAPPDATA` trỏ vào thư mục rỗng, `agy --version`, `agy models` và cả hai lệnh `-p` (2 prompt thật, chạy ngoài kế hoạch; lẽ ra chỉ nên chạy `agy models`) **đều thành công**: credential không nằm dưới `~/.gemini` (khả năng cao là kho khoá của hệ điều hành). Đăng xuất bị cấm, nên **chưa có thông điệp/exit code thật của "chưa đăng nhập"**; fixture `not-logged-in.synthetic.txt` chỉ là giữ chỗ. Hệ quả: (1) không thể tách tài khoản theo task bằng cách đổi HOME, nên `agentProfile` không áp dụng được cho backend này; (2) phát hiện "chưa đăng nhập" phải suy từ thất bại của `agy models`, không dựa vào câu chữ. |
| **f) API key / tự cập nhật** | Không có cờ hay biến môi trường API-key trong `agy --help`; tài liệu cục bộ (`~/.gemini/antigravity-cli/builtin/skills`) chỉ nói cấu hình ở `~/.gemini/antigravity-cli/settings.json` và trỏ tới trang tài liệu trực tuyến (chưa truy cập). Không xác nhận có đường API-key; **không dùng**. Tự cập nhật: có `agy update`, `updater/update_status.json` (`"Already on the latest version."`), `last_check.timestamp`, `agy.version.json` có `releaseBaseUrl` (Cloud Run của Google). Không thấy cờ tắt hay ghim trong help. Onni không gọi `agy update`/`install`; ghi `agy --version` vào run record để biết bản nào đã chạy. |
| **g) Phát hiện đã cài / đã đăng nhập** | **Đã cài:** `agy.exe` tồn tại (PATH, `%LOCALAPPDATA%gyingy.exe` trên Windows, `~/.local/bin/agy` nơi khác, hoặc `ONNI_ANTIGRAVITY_BIN`) và `agy --version` thành công, không gọi mạng/model. **Đã đăng nhập:** `agy models` thành công và in ≥ 1 dòng `id<TAB>nhãn` (có gọi mạng, không gọi model, không đọc credential). Cả hai bằng spawn có timeout; kết quả cache ngắn. `agy models` thất bại/rỗng/timeout ⇒ `disconnected` kèm một dòng stderr; không đoán nguyên nhân. |

Fixtures thật thêm: `allow-rule-partial-denied`, `allow-rule-chained-denied`, `add-dir-writes-to-added-dir`, `write-file-then-done`. Synthetic: `denied-with-response`, `denied-empty-response`, `empty-response-no-denied`, `truncated-and-noise`, `not-logged-in`.

Ghi chú định dạng bổ sung: `denied_actions[]` chỉ có `{action, display_name}`, **không có chuỗi lệnh**; để liệt kê lệnh bị từ chối runner phải ghép với event `tool` ở state `ERROR` (`tool_info.parameters.CommandLine`). `response` có thể rỗng dù một lệnh đã chạy thành công (mô hình không viết lời kết).

## Phụ lục B. Chỗ lệch so với phần trên (theo quyết định Giai đoạn 2)

1. §3: pty và bridge không còn là phương án; lý do (postinstall chạy PowerShell từ xa với ExecutionPolicy Bypass; mặc định bật `--dangerously-skip-permissions`) vào ADR 0007.
2. §6/§7: `denied_actions`: response rỗng + denied ⇒ run fail liệt kê hành động; response không rỗng + denied ⇒ cảnh báo (note event) cho từng hành động; response rỗng không denied ⇒ fail.
3. Cost: chỉ token, không ước tính USD.
4. §4: quyền có ba mức theo từng backend (Chỉ ghi file mặc định, Allow-rule hẹp, Bỏ qua mọi xác nhận), không thừa kế ngầm cho task con hay preset.
5. Mới: cờ `canManage`; antigravity chỉ là worker cho tới khi allow-rule được kiểm chứng đủ cho vai manager (xem ADR 0007).
6. §4 "Thư mục làm việc": không dùng `--add-dir` (mục d). §4 "Xác thực": credential ngoài `~/.gemini` (mục e).
7. Quyết định cuối được ghi ở [ADR 0007](../adr/0007-antigravity-backend.md). Chỗ diễn giải thêm ngoài thông điệp duyệt: **"không thừa kế ngầm cho task con"** được hiểu là run không giám sát (autonomous hoặc con dispatch) luôn dùng `allow-rules` dù Settings là `bypass`, kèm một note trong run; preset không có chỗ chứa mức quyền (`rosterSchema` đóng). Hệ quả: một worker không bao giờ bỏ qua xác nhận.
8. §5 "token": runner cộng usage từng step của tiến trình, **không** dùng `result.usage` (cộng dồn cả hội thoại sau `--conversation`; kiểm chứng trên mẫu resume: 23119 so với 8033 của riêng tiến trình).
9. Spike bước 0 dùng **8 prompt thật**, không phải 6: hai lệnh `-p` ở mục (e) chạy thành công dù HOME rỗng (xem Phụ lục A), ngoài kế hoạch.
10. Bộ rule đề xuất cho vai manager chỉ nằm trong ADR 0007; code chỉ có bộ của worker/solo vì `canManage = false`.
