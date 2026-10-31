# Antigravity (`agy`) backend — spike (Giai đoạn 1, chỉ thử và đọc)

Nhánh `feat/antigravity-backend`, tạo từ `dev`. Chưa sửa dòng code nào; chỉ thêm tài liệu này và fixtures. Máy thử: Windows 11, Node 24.21, `agy` 1.4.12 tại `%LOCALAPPDATA%\agy\bin\agy.exe` (có trong PATH của user, nhưng một phiên terminal mở trước khi cài thì chưa thấy).

Fixtures: `packages/work/src/core/__fixtures__/antigravity/` (đã thay đường dẫn máy bằng `<CWD>`; vài `text_delta` trong mẫu ghi file bị cắt ở đoạn đường dẫn nên không dùng để so khớp nội dung văn bản):

| File | Nội dung |
| --- | --- |
| `write-file-allowed.ndjson` | init, tool `write_file` thành công, text stream, `result` |
| `resume-command-denied.ndjson` + `.stderr.txt` | `--conversation <id>`; `run_command` bị tự động từ chối |

Mẫu của prompt đầu ("Reply with exactly: OK") chỉ còn log rút gọn: `init` → `user_input` DONE → `agent_response` ACTIVE (`text_delta:"OK"`) → DONE (`usage`) → `result` (`response:"OK\n"`). Đủ 3 prompt thật đã dùng; không có mẫu thứ tư.

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
