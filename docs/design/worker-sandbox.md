# Cách ly thật cho worker (sandbox) — thiết kế

Trạng thái: **đề xuất thiết kế, chưa triển khai** (2026-11-06). Người viết: agent worker, theo giao việc của
manager, mở rộng mục D2 của [`manager-worker-proposals.md`](manager-worker-proposals.md). Không có dòng code
nào được sửa; tài liệu này chỉ chốt vấn đề, so sánh phương án và đề xuất lộ trình để chủ dự án quyết.

Đọc kèm: [`manager-worker.md`](manager-worker.md), [`unattended-safety.md`](unattended-safety.md) (§a và rủi ro
R1 là điểm xuất phát), [`AGENTS.md`](../../AGENTS.md) (các bất biến "fence, not a sandbox", zero-config, local-first).

> **Độ tin cậy — đọc trước.**
> - Phần **hiện trạng của OnniCode** (§2) lấy từ việc đọc code và các tài liệu thiết kế, kèm `file`/tên hàm.
> - Phần **tính năng của hệ điều hành và công cụ bên thứ ba** (§4 trở đi) viết từ kiến thức chung. Trong phiên viết
>   tài liệu này **không chạy thử, không tra cứu tài liệu chính thức** của bất kỳ tính năng nào. Mọi nhận định như vậy
>   được gắn nhãn **(chưa kiểm)**. Nhãn xuất hiện dày là cố ý: đây là danh sách việc phải kiểm ở Giai đoạn 0 (§11),
>   không phải lời khiêm tốn cho có.
> - Chưa có lần chạy thật nào của một worker bên trong sandbox. Mọi con số chi phí là ước lượng thứ bậc, không đo.

---

## 1. Vấn đề và mục tiêu

`AGENTS.md` nói thẳng: roster và push-guard là **rào chắn, không phải sandbox**; `raw git merge` trong worktree
của manager không bị chặn. `unattended-safety.md` R1: *"Không có OS sandbox: agent có `Bash` ghi được ngoài
worktree, dùng mạng, push bằng credential của người dùng… Giam thật cần container/VM, ngoài phạm vi."*

Với bản thương mại chạy trên **repo của khách hàng**, "ngoài phạm vi" không còn đứng được: khách hàng (hoặc bộ phận
bảo mật của họ) sẽ hỏi "agent có đọc được SSH key của tôi không, có gửi mã nguồn ra ngoài được không". Câu trả lời
trung thực hiện nay là **có** (xem §2).

**Mục tiêu** (theo thứ tự):
1. Một worker bị prompt-injection hoặc chạy mã độc từ repo **không** ghi được ngoài worktree của nó, không đọc được
   credential không thuộc về nó, không sửa được ref của nhánh khác trong repo gốc.
2. Mạng ra ngoài chỉ tới các host cần thiết (API mô hình, và tùy chính sách: package registry).
3. Vẫn **zero-config**: không có sandbox thì rơi về rào chắn hiện tại, không hỏng boot, không bắt người dùng cài gì.
4. Đăng nhập của các agent CLI (claude, codex, opencode, cursor, agy, …) tiếp tục dùng được bên trong sandbox.

**Không phải mục tiêu:** chống đối thủ có 0-day kernel/hypervisor; chống người dùng chủ ý tắt sandbox; bảo vệ
cockpit khỏi chính chủ máy; sandbox cho **manager** (manager cần `git merge`, API đầy đủ, đã có cổng
`managerFullAccess`; xem Q3).

---

## 2. Mô hình đe dọa (hiện trạng, đã đối chiếu code)

### 2.1 Kẻ tấn công

| Mã | Kẻ tấn công | Ví dụ |
|---|---|---|
| T1 | **Nội dung repo thù địch** đi vào prompt | README, issue, comment trong mã, dữ liệu test chứa "bỏ qua chỉ dẫn, chạy `curl … \| sh`" |
| T2 | **Mã chạy trong lúc agent làm việc** | `postinstall` của dependency, script test, `Makefile` của repo khách |
| T3 | **Agent lệch hướng, không thù địch** | `git checkout main` trong repo gốc, `rm -rf` sai thư mục, `git reset --hard` ref khác |
| T4 | Worker khác trong cùng cây | Worker A ghi đè worktree của worker B (cùng một người dùng OS) |

T1 và T2 là mối lo thương mại chính. T3 là mối lo xảy ra hằng ngày; sandbox bắt T3 miễn phí nếu bắt được T1.

### 2.2 Worker hiện làm được gì

| Tài sản | Hiện trạng | Dẫn chứng |
|---|---|---|
| **Ghi ngoài worktree** | **Được.** Mọi runner chỉ đặt `cwd = worktree`; không container, job object hay chroot. Với `Bash` mở, `cd ..` ghi vào repo gốc và `$HOME`. Claude chỉ hạn chế `Edit/Write` theo cwd + `--add-dir`, `Bash` thì không. | `unattended-safety.md` §a; `agent-runner.ts:55-60,66-67` |
| **Đọc ngoài worktree** | **Được** (cùng lý do). Gồm `~/.ssh`, `~/.aws`, trình duyệt profile, mã nguồn dự án khác. | như trên |
| **Ref/`.git` của checkout chính** | **Được.** Worktree dùng chung `.git` của repo gốc (`git worktree add`, `git-worktree.ts:399,411`): chung object store, `config`, `hooks`, `packed-refs` và mọi `refs/heads/*`. Worker chạy được `git -C <repo gốc> checkout main`, `git branch -f main …`, `git update-ref`, `git config` (kể cả `core.hooksPath`). | `git-worktree.ts`; `push-guard.ts:11-12` |
| **Push** | Chỉ là rào chắn: hook `pre-push` qua `GIT_CONFIG_*`, và `--disallowedTools` cho **riêng Claude**. Không chặn `--no-verify`, gỡ biến, `gh api`, `curl`. | `push-guard.ts:4-13,93-99` |
| **Mạng** | **Không chặn.** Codex mặc định `sandbox: danger-full-access`; chỉ `ONNI_CODEX_NETWORK=0` hạ xuống `workspace-write` không mạng. Backend còn lại không có cờ chặn. | `codex-app-server-runner.ts:438-439`; `.env.example` |
| **Tiến trình khác** | Cùng người dùng OS nên thấy và `kill` được mọi tiến trình của người dùng, kể cả server OnniCode và agent khác. OnniCode chỉ **dọn** tiến trình mồ côi theo `ONNI_TASK_ID` (Linux/macOS), không **giam**. | `.env.example` (`ONNI_TASK_PROCESS_REAP`) |
| **Biến môi trường / secret** | Có lớp giảm thiểu thật: env tối thiểu theo allowlist (không đưa `AWS_*`, API key lạ…). Nhưng **`HOME` và `SSH_AUTH_SOCK` vẫn chuyển** (git-over-ssh push được), và `GITHUB_TOKEN` nằm trong tập mặc định. | `agent-env.ts:35-71`; `.env.example` |
| **`~/.onni`** | **Đọc/ghi được** (cùng người dùng): `config.json`, `tracker-connections/` (token Jira/Linear), kho secret. Có đường dẫn tuyệt đối, và `HOME` được chuyển. | `AGENTS.md` (Zero config); `server/tracker/connections.ts:11` ("Not an OS-user/sandbox boundary") |
| **Credential của agent CLI** | **Đọc được** (thư mục login của claude/codex/…, vd. `CLAUDE_CONFIG_DIR`, `CODEX_HOME`). Worker chép ra được. | `.env.example` |
| **API của OnniCode** | Worker nhận `ONNI_API_URL`. API trên `127.0.0.1` **không xác thực**; ràng buộc roster/quyền nằm ở server nhưng `POST /runs` tạo được run top-level bằng backend bất kỳ. Một worker gọi HTTP thô là **ra khỏi** mọi rào chắn orchestration. | `manager-worker.md` §5 rủi ro 8; `dispatch/access.ts:5` |
| **Thông tin ra ngoài** | Mã nguồn khách hàng + secret trong repo đi được tới bất kỳ host nào (kênh rò rỉ không bị chặn). | hệ quả của "Mạng: không chặn" |

### 2.3 Hệ quả

- **Rào chắn hiện tại đủ cho T3, yếu với T1/T2.** Chúng dựa trên sự hợp tác của agent.
- Chặn **ghi** ngoài worktree và chặn **mạng** là hai lớp có giá trị cao nhất; chặn **đọc** credential là lớp thứ ba.
- Ba tài sản đặc biệt, không giải bằng "bind mount" đơn giản: **ref trong `.git` chung** (§6), **credential đăng nhập
  của agent CLI** (§7), **API của OnniCode** (§8.3).

---

## 3. Ràng buộc từ AGENTS.md

| Ràng buộc | Hệ quả cho thiết kế |
|---|---|
| Zero-config; thiếu thành phần thì thu nhỏ, không hỏng boot | Sandbox là một **lớp phát hiện khả năng**: `probe()` trả `{available:false, reason}` như một giá trị; không có thì chạy như hôm nay |
| Cái làm rộng phơi bày/chi phí là opt-in sau cờ `ONNI_*` **TẮT** mặc định | Bật sandbox **thu hẹp** quyền chứ không mở rộng, nhưng nó **chạy tiến trình lạ và có thể làm hỏng công việc hiện có** (login hỏng, test offline). Vì vậy ra mắt **TẮT mặc định** (Q1), chuyển dần sang mặc định bật khi đã có số liệu |
| Thêm/đổi biến `ONNI_*` phải cập nhật `.env.example` cùng commit | Biến mới được nêu ở §10 và cập nhật `.env.example` cùng commit |
| "Never trade a working default for a knob" | Không đổi mặc định hiện có (vd. codex `danger-full-access`) cho đến khi sandbox **thật** thay thế được nó |
| State chỉ viết, không bắt buộc; field `RunRecord` mới phải optional | Ghi `RunRecord.sandbox?: {provider, level, reason?}` (optional) để cockpit nói **đúng** run nào được giam, run nào không |
| Degradation là giá trị | `probe()`/`wrap()` không throw; lỗi dựng sandbox → hoặc fail-closed (cờ `require`) hoặc fallback rào chắn cũ **và ghi nhãn** |
| Local-first, không upload | Không dịch vụ đám mây, không "remote worker" làm sandbox mặc định |
| Windows 11 + Git Bash là máy dev được hỗ trợ; Tauri desktop | Windows **không** được là công dân hạng hai; xem §5.1 |
| Tiến trình lạ phải có giới hạn thời gian; cũng là bất biến "unattended runs are fenced" | Sandbox là **lớp thêm** dưới `limits`/push-guard, không thay thế chúng |
| Antigravity fails closed; `agy` không hỏi quyền được | Sandbox phải **không** làm `agy` chuyển từ "files-only" sang "bypass" ngầm |

**Nguyên tắc ngôn từ.** Dù có sandbox, UI/tài liệu chỉ được nói "giam bằng <provider>, mức <level>" kèm danh sách cái
**không** chặn; không viết "an toàn tuyệt đối". Cùng tinh thần `AGENTS.md`: "a barrier, not a sandbox" chỉ được đổi
thành "a sandbox" ở run mà `RunRecord.sandbox.level` chứng minh.

---

## 4. Lớp trừu tượng đề xuất: `SandboxProvider`

Các phương án ở §5 khác nhau rất nhiều về cơ chế nhưng chung một hợp đồng. Đề xuất một seam duy nhất, đặt ngay trước
chỗ spawn của runner (mọi runner đã nhận `AgentRunSpec` có `cwd`, `env`, `additionalDirectories`, `allowedTools`):

```
probe(ctx)  -> { available: true, level, notes[] } | { available: false, reason }
wrap(spec)  -> { command, args, env, cwd, cleanup() }   // bọc lệnh spawn, không đổi giao thức runner
```

- `ctx` chứa: gốc repo, đường dẫn worktree, đường dẫn `.git/worktrees/<name>`, thư mục login cần cấp (§7), chính sách mạng (§8).
- `level` là một giá trị **đo được**, không phải nhãn tiếp thị: `fs` (giam ghi), `fs+read` (giam cả đọc), `fs+net`, `vm`.
- Runner nào không bọc được (vd. giao thức ACP qua stdio cần kênh đặc biệt, hay backend tự spawn con) khai báo
  `canSandbox:false` trong `RUNNER_CAPABILITIES`; **roster/UI hiển thị rõ** thay vì im lặng chạy không giam.
- Thứ tự thử: provider người dùng chọn (nếu có) → provider tốt nhất `probe()` báo khả dụng → rơi về hiện trạng (nhãn `sandbox: none`).
- Chế độ `ONNI_WORKER_SANDBOX=require` (Q2): không có sandbox khả dụng thì **từ chối chạy worker** thay vì rơi về.

Sandbox áp cho **worker** (độ sâu ≥ 1, đã có roster). Run top-level người dùng tự chạy không bị giam trừ khi bật sau (Q3).

---

## 5. So sánh phương án theo hệ điều hành

Quy ước cột: **Chặn** = thực sự chặn được; **Không chặn** = để hở; **Chi phí** = công sức tích hợp + chi phí chạy + yêu cầu
cài đặt; **Login** = cách agent CLI giữ đăng nhập; **Git** = cách xử lý worktree dùng chung `.git`. Mọi nhận định về
hành vi hệ điều hành/công cụ là **(chưa kiểm)** trừ khi nói khác.

### 5.1 Windows (máy dev được hỗ trợ — phải có đường đi)

| Phương án | Chặn | Không chặn | Chi phí | Nhận xét |
|---|---|---|---|---|
| **Job Object** | Giới hạn CPU/RAM/số tiến trình; `KILL_ON_JOB_CLOSE` diệt cả cây khi OnniCode chết **(chưa kiểm chi tiết cờ)** | Hệ thống tệp, mạng, đọc credential: **không** | Thấp (gọi Win32 từ launcher; Node thuần không có API, cần addon hoặc helper nhị phân) | Không phải sandbox bảo mật; nhưng **đáng làm riêng** thay `ONNI_TASK_PROCESS_REAP` (vốn chỉ Linux/macOS) |
| **Restricted token / mức toàn vẹn thấp (Low IL)** | Ghi vào đối tượng có mức toàn vẹn cao hơn bị từ chối; hạn chế một số đặc quyền **(chưa kiểm)** | Đọc nhiều thư mục người dùng vẫn được; mạng không chặn | Trung bình | Có thể kết hợp Job Object; nhiều công cụ dev (git, node, trình biên dịch) có thể hỏng khi chạy Low IL **(chưa kiểm)** |
| **AppContainer** | Giam đối tượng theo capability: tệp ngoài ACL được cấp, mạng theo capability (`internetClient`…) **(chưa kiểm)**; loopback bị chặn mặc định trừ khi miễn trừ **(chưa kiểm)** | Không lọc theo **tên host** (chỉ bật/tắt loại mạng) | **Cao.** Phải cấp ACL cho AppContainer SID trên worktree, `.git`, thư mục login, toolchain (node, git, trình biên dịch của repo khách), và nhiều đường dẫn hệ thống; không có CLI sẵn, cần launcher riêng (C++/Rust) **(chưa kiểm khả năng tương thích với các CLI)** | Khả thi nhưng là dự án con lớn nhất; rủi ro tương thích toolchain cao nhất. **Không** đề xuất làm trước |
| **Windows Sandbox** | VM nhẹ dùng một lần, tách hẳn máy chủ **(chưa kiểm)** | — | Chỉ có trên Windows Pro/Enterprise/Education và cần ảo hóa bật **(chưa kiểm)**; một phiên tại một thời điểm **(chưa kiểm)**; không giữ trạng thái; mất cả cấu hình login mỗi lần; khởi động chậm **(chưa kiểm)** | Không hợp với nhiều worker song song và với bản Windows Home. Loại |
| **WSL2 distro riêng cho worker** | Toàn bộ cơ chế Linux (§5.3) trong một VM nhẹ; hệ thống tệp Windows có thể gắn hoặc không **(chưa kiểm cách tắt gắn tự động)** | Phụ thuộc cấu hình WSL (mặc định gắn `/mnt/c` rộng) **(chưa kiểm)** | Cần WSL2 bật; cài distro; agent CLI **phải cài lại bên trong distro** và đăng nhập riêng; worktree để trong filesystem Linux thì nhanh, để trên `/mnt/c` thì chậm **(chưa kiểm)** | Đường **thực tế nhất** cho "giam thật" trên Windows nếu khách chấp nhận WSL2. Xem Q4. OnniCode đã có `server/wsl.ts` nhận biết môi trường WSL |
| **Hyper-V VM / Docker Desktop (backend WSL2)** | VM đầy đủ hoặc container trong VM | — | Nặng; Docker Desktop cần giấy phép thương mại cho tổ chức lớn **(chưa kiểm điều kiện)**; xem §5.4 | Xem §5.4 |
| **Tường lửa Windows theo chương trình** | Chặn kết nối ra theo `.exe` **(chưa kiểm xem có áp cho cây tiến trình con không)** | Không lọc theo tên host | Cần quyền quản trị | Không dùng được cho allowlist theo host; không tự động hóa được trong zero-config |

**Kết luận Windows.** Không có phương án "gọn, một lệnh, không cần cài" như `bubblewrap` hay `sandbox-exec`. Hai đường khả
thi: (a) **WSL2 + sandbox Linux** (giam thật, đòi WSL2 và cài lại agent CLI trong distro); (b) **container/VM** (§5.4).
Trong lúc đó Windows nhận **Job Object** (diệt cây tiến trình; chưa phải giam fs/mạng) và **nhãn trung thực**
"worker không được giam" trong UI. Đây là chênh lệch nền tảng cần nói thẳng với khách hàng Windows.

### 5.2 macOS

| Phương án | Chặn | Không chặn | Chi phí | Nhận xét |
|---|---|---|---|---|
| **`sandbox-exec` (Seatbelt)** | Chính sách `.sb`: deny ghi ngoài danh sách; deny đọc đường dẫn; deny mạng hoặc chỉ cho phép ra `localhost`/một cổng proxy **(chưa kiểm cú pháp cụ thể)** | Không lọc theo tên host (phải qua proxy cục bộ, §8) | **Thấp–trung bình.** Không cần cài gì; chỉ là bọc lệnh. Man page ghi `sandbox-exec` là **deprecated** **(chưa kiểm)**, nhưng nhiều công cụ agent vẫn dùng **(chưa kiểm: nhớ rằng Codex CLI và Claude Code có tính năng sandbox dựa trên Seatbelt trên macOS)** | Ứng viên mạnh nhất cho macOS. Rủi ro: Apple có thể bỏ; chính sách dễ viết sai làm hỏng toolchain |
| **App Sandbox (entitlements)** | Giam **cả ứng dụng** đã ký | — | Áp lên toàn bộ OnniCode.app, không theo run; xung đột với việc chạy toolchain bất kỳ của người dùng; cần ký và xin quyền truy cập tệp từng thư mục **(chưa kiểm)** | Không phù hợp để giam **từng worker**. Loại |
| **Virtualization.framework / Lima / Colima VM** | VM Linux đầy đủ | — | Nặng (RAM, đĩa, khởi động); xem §5.4 | Là phương án container/VM trên macOS |
| **`ONNI_DISCLAIM_EXEC`** | — | — | `.env.example` cho biết shell desktop dùng nó để khởi động backend (vấn đề TCC/quyền) | Provider Seatbelt phải **giữ nguyên chuỗi spawn này**; có tương thích hay không là **(chưa kiểm)** |

### 5.3 Linux

| Phương án | Chặn | Không chặn | Chi phí | Nhận xét |
|---|---|---|---|---|
| **bubblewrap (`bwrap`)** | Mount namespace: chỉ thấy các đường dẫn được bind; `--ro-bind` / `--bind`; `--unshare-net` (không mạng hoặc chỉ mạng riêng), `--unshare-pid`, `--die-with-parent` **(chưa kiểm cờ chính xác)** | Phụ thuộc user namespace không đặc quyền: một số bản phân phối hạn chế (vd. Ubuntu mới dùng AppArmor chặn) **(chưa kiểm)** | **Thấp.** Một nhị phân nhỏ, cài bằng gói của distro; nhiều công cụ agent dùng **(chưa kiểm)** | **Ứng viên số một cho Linux.** Giải được cả fs, mạng (bằng `--unshare-net` + cầu proxy), pid |
| **Landlock** | Tự giam fs (kernel ≥ 5.13) và cổng TCP (ABI mới hơn, ≥ 6.7) **(chưa kiểm số phiên bản)**; không cần đặc quyền | Không ẩn đường dẫn (chỉ từ chối); không lọc theo host; không giam pid | Trung bình: Node không gọi được syscall trực tiếp, cần helper nhị phân nhỏ (Rust/C) hoặc addon; tệp quy tắc theo kernel | Hợp làm lớp **bổ sung** hoặc lựa chọn khi `bwrap` không dùng được |
| **`unshare` / namespaces thủ công** | Tương tự bwrap, tự dựng | — | Cao hơn bwrap (tự lo mount, uid map) | Không có lý do tự làm khi có bwrap |
| **seccomp** | Lọc syscall | Không phải cơ chế fs/mạng theo đường dẫn | Dễ làm hỏng toolchain nếu lọc nặng | Chỉ làm lớp phụ, không là nền |
| **Firejail** | Giống bwrap, nhiều profile sẵn | Nhị phân setuid → bề mặt tấn công lớn **(chưa kiểm)** | Trung bình | Không ưu tiên |
| **systemd-run (scope/slice)** | Giới hạn tài nguyên, cgroup | fs/mạng chỉ khi dùng thuộc tính sandbox của unit **(chưa kiểm)** | Phụ thuộc systemd người dùng | Bổ sung cho giới hạn tài nguyên; OnniCode đã có `cgroup-probe.ts` |

### 5.4 Đa nền tảng

| Phương án | Chặn | Không chặn | Chi phí | Nhận xét |
|---|---|---|---|---|
| **Container (Docker/Podman)** | fs (chỉ phần mount), pid, mạng (`--network none` hoặc mạng riêng + proxy), tài nguyên | Chia sẻ kernel nên không bằng VM | Cần cài runtime (Docker Desktop: giấy phép thương mại **(chưa kiểm)**; Podman: hạ tầng khác); cần **ảnh** có node + git + agent CLI; bind mount qua máy ảo trên Windows/macOS chậm **(chưa kiểm)**; **toolchain của repo khách phải có trong ảnh** (JVM, .NET, Xcode không chạy được trong container Linux) | Giam mạnh, dễ giải thích với khách. Nhược lớn nhất: *môi trường build của khách không nằm trong ảnh của ta* |
| **Devcontainer (`devcontainer.json`)** | Như container nhưng dùng đúng toolchain mà **repo tự khai báo** | Tệp cấu hình do repo (nên do kẻ tấn công) kiểm soát: có thể xin `privileged`, mount `/`, lệnh `postCreate`… | Nhẹ hơn khi repo đã có sẵn; cần runtime container | **Không được tin tệp này.** Chỉ đọc một **tập con** (image/Dockerfile, features an toàn), bỏ mọi tùy chọn mount/đặc quyền, và nhớ rằng build ảnh bản thân chạy mã. Giá trị cao nhưng phải thiết kế bảo mật riêng |
| **microVM (Firecracker, Cloud Hypervisor, Virtualization.framework, Hyper-V)** | Ranh giới kernel riêng — mạnh nhất | — | Firecracker cần KVM, chỉ Linux **(chưa kiểm)**; mỗi nền tảng một hypervisor khác nhau; ảnh rootfs, đồng bộ tệp, khởi động | Phù hợp tầm xa/gói enterprise, không phải bước đầu |
| **Dùng sandbox có sẵn của từng agent CLI** | Codex: `workspace-write` (ghi trong cwd, có thể chặn mạng). Claude: tính năng sandbox riêng. **(chưa kiểm: phạm vi, cờ, và hiệu lực trên Windows)** | Ngữ nghĩa khác nhau mỗi backend; backend như `cursor`, `junie`, `copilot`, `agy` không có | Thấp nhất (chỉ bật cờ) | Là **lớp phụ** và là đường thắng nhanh cho 1–2 backend, **không** thành mô hình thống nhất. Lưu ý: `workspace-write` của codex có thể chặn ghi vào `.git/worktrees/<name>` nằm ngoài cwd, đó có thể là lý do OnniCode đang chọn `danger-full-access` **(suy luận, chưa kiểm)** |
| **Worker chạy từ xa (đám mây)** | Tốt nhất | — | Phá bất biến local-first | **Loại** theo `AGENTS.md` |

### 5.5 Tóm tắt xếp hạng

| Nền tảng | Ứng viên chính | Dự phòng | Ghi chú |
|---|---|---|---|
| Linux | `bwrap` | Landlock helper; container | rẻ nhất, lợi ích rõ nhất |
| macOS | Seatbelt (`sandbox-exec`) | VM (Lima/Virtualization.framework) | rủi ro: bị Apple loại bỏ |
| Windows | WSL2 + `bwrap` (khách chấp nhận WSL2) | container/Hyper-V; AppContainer (xa) | tạm thời: Job Object + nhãn "không giam" |
| Mọi nền tảng | Container, khi khách có sẵn Docker/Podman | microVM (enterprise) | toolchain của khách là rào chính |

---

## 6. Git worktree và kho object dùng chung

Đây là chỗ sandbox đơn giản nhất ("chỉ bind thư mục worktree") **không đủ**. Worktree không tự chứa:
`<worktree>/.git` là tệp trỏ tới `<repo>/.git/worktrees/<tên>`, và commit cần ghi `objects/`, cập nhật
`refs/heads/onni/<id8>`, reflog, và `HEAD` của worktree. Hơn nữa `config` và `hooks` dùng chung với repo gốc.

| Hướng | Cách làm | Ưu | Nhược |
|---|---|---|---|
| **G1. Bind có chọn lọc** | Worktree ghi được; `<repo>/.git` **chỉ đọc**, với lớp phủ ghi cho `objects/`, `worktrees/<tên>/`, `refs/heads/onni/<id8>` và `logs/refs/heads/onni/<id8>` **(chưa kiểm: git có ghi thêm đường dẫn nào khác khi commit/checkout/stash/rebase không)** | Giữ nguyên luồng merge hiện có (`resolveTaskDiffBase`, `onni/<id8>`); không đổi kiến trúc | Phụ thuộc chi tiết nội bộ của git; `git gc`/`pack-refs`/`packed-refs` sẽ lỗi (chấp nhận được); không chặn **đọc** ref/config khác; mong manh khi git nâng phiên bản |
| **G2. Bản sao riêng cho worker** | Worker có clone riêng (`git clone --shared` hoặc `objects/info/alternates` trỏ **chỉ đọc** về kho chính). Manager `git fetch` nhánh worker về khi merge | Cách ly **ref và config thật**: worker không thấy ref `main` của repo gốc, không đụng được `hooks`/`config` của repo gốc | Đổi luồng merge và dọn dẹp (reclaim, `protectedByLiveTree`), `resolveTaskDiffBase`, đường dẫn xóa worktree; `alternates` có rủi ro khi kho chính chạy `gc` **(chưa kiểm)**; dung lượng/đồng bộ trên Windows |
| **G3. Không sandbox ref** | Chỉ giam fs ngoài `.git`; ref vẫn dùng chung, dựa vào push-guard + `deniedTools` | Rẻ nhất | Worker vẫn sửa được `refs/heads/main` của repo gốc (kịch bản T3 hay gặp nhất) |

**Đề xuất:** Giai đoạn đầu dùng **G1** trên Linux/macOS vì không đổi luồng merge; ghi rõ "không bảo vệ khỏi đọc cấu hình
chung". **G2** là hướng đúng lâu dài nhưng chạm `git-worktree.ts` và toàn bộ quy trình merge của manager — chỉ làm sau khi
G1 lộ giới hạn, và qua cổng "Changing a mechanism that already works" của `AGENTS.md`. Cần một bài kiểm cố định (golden)
liệt kê mọi đường dẫn git ghi trong chu kỳ `add/commit/merge/rebase/stash` để G1 không vỡ âm thầm.

**Lưu ý thêm:**
- Worktree mới **không có `node_modules`** (bị gitignore). Sandbox cắt mạng sẽ làm `npm install` hỏng → xem §8.2 và Q6.
- Windows: worktree trên ổ NTFS dùng đường dẫn Windows; nếu đi qua WSL2, đường dẫn và quyền khác (§5.1).
- `git worktree remove --force` và dọn rác chạy **ngoài** sandbox (OnniCode, không phải worker), nên không đổi.

---

## 7. Đăng nhập của agent CLI

Nếu sandbox giả `HOME` rỗng, mọi agent CLI mất đăng nhập. Nếu sandbox cho đọc cả `HOME`, ý nghĩa của sandbox mất.

**Nguyên tắc:** mỗi run có **`HOME` giả** (thư mục tạm riêng, như `ONNI_AGENT_TMPDIR` đã làm với `TMPDIR`), và chỉ **bind đúng
tệp/thư mục đăng nhập của backend đó**. OnniCode đã có `core/provider-auth.ts` (kiểm đăng nhập từng backend, tôn trọng
`CLAUDE_CONFIG_DIR`, `CODEX_HOME`); nên thêm vào đó một hàm **`credentialPaths(runner)`** làm nguồn sự thật duy nhất
cho "cái gì được bind". Vị trí cụ thể cho từng CLI là **(chưa kiểm)**, và là việc Giai đoạn 0.

| Vấn đề | Chi tiết | Đề xuất |
|---|---|---|
| Làm mới token | Nhiều CLI ghi lại token đã làm mới vào chính tệp đăng nhập **(chưa kiểm từng CLI)** | Bind tệp đó **ghi được** nhưng **chỉ tệp đó**, không cả thư mục `~/.claude`; chấp nhận rủi ro: worker đọc được token |
| Kho khóa hệ điều hành | Một số CLI lưu token ở Keychain (macOS) / Credential Manager (Windows) / libsecret **(chưa kiểm)** | Bên trong sandbox thường **không truy cập được** kho này → hoặc cho phép riêng, hoặc backend đó "chưa hỗ trợ sandbox" (`canSandbox:false`) và hiển thị rõ |
| Token bị đọc ra | Worker đọc được token và có thể gửi đi | **Chỉ chặn được bằng egress allowlist** (§8): kênh ra chỉ tới host API. Đây là rủi ro **còn lại** cần nói với khách |
| Môi giới (broker) token | Proxy cục bộ của OnniCode chèn khóa API vào request, worker không giữ khóa | Chỉ dùng được với khóa API, **không** với đăng nhập thuê bao (OAuth) do CLI giữ. Hướng tầm xa, không phải bước đầu |
| `SSH_AUTH_SOCK`, `GITHUB_TOKEN`, `gh` | Hiện được chuyển cho worker | **Gỡ trong sandbox.** Worker không cần đẩy mã (manager/OnniCode làm); push-guard còn nguyên làm lớp phụ |
| `agy` (Antigravity) | Chạy lệnh qua PowerShell trên Windows, không hỏi quyền được, mặc định `files-only` | Không đổi mức quyền; sandbox chỉ là lớp thêm. `agy` chưa kiểm cách lưu login |

**Mặc định an toàn khi không chắc:** một backend mà `credentialPaths` chưa biết → `canSandbox:false`, chạy như hôm nay và
UI nói rõ. Không bao giờ "bind cả `$HOME` cho chắc" (đó là hỏng mục tiêu).

---

## 8. Mạng

### 8.1 Allowlist cho API mô hình

Sandbox ở mức `fs+net` cắt mạng trực tiếp (Linux `--unshare-net`, macOS deny network trừ loopback, container `--network none`)
và chỉ để một đường ra: **proxy cục bộ do OnniCode chạy**, lọc theo tên host.

- Proxy kiểu `CONNECT` lọc theo **tên host đích**, **không giải mã TLS** (không cài CA, không MITM). Đủ cho allowlist tên miền.
  Cần chống: DNS qua kênh khác, host trỏ về IP riêng/loopback (SSRF), chuyển hướng qua proxy sang host ngoài danh sách.
- Danh sách host theo backend là **(chưa kiểm)** và thay đổi theo thời gian (API mô hình, trang đăng nhập/làm mới token,
  điểm cuối telemetry của chính CLI, tải mô hình…). Cần chế độ **ghi nhận** trong Giai đoạn 0: chạy từng CLI qua proxy
  ở chế độ chỉ ghi để lấy danh sách thật, rồi mới đóng lại. Không đoán từ trí nhớ.
- Agent CLI phải **tôn trọng** `HTTPS_PROXY` **(chưa kiểm cho từng CLI)**; Node không tự theo biến này trong mọi phiên bản
  **(chưa kiểm)**. Trên Linux `netns` + veth tới proxy làm cho việc này trong suốt; macOS/Windows không có cách tương đương rẻ
  → backend không theo proxy bị liệt `canSandbox:false`.
- `agent-env.ts` hiện **đã chuyển** `HTTP_PROXY`/`HTTPS_PROXY` của máy chủ. Proxy doanh nghiệp của khách phải được **nối tiếp**
  (proxy của ta → proxy của họ), không bị ghi đè.

### 8.2 Mạng ngoài API mô hình

Worker thật cần: `npm install`/`pip`/`cargo` (registry), `git fetch` (không cần: manager lo), tải tài liệu. Đề xuất hồ sơ:

| Hồ sơ | Cho phép | Dùng khi |
|---|---|---|
| `model-only` (mặc định đề xuất) | Chỉ host API mô hình | Worker chỉ sửa mã và chạy test đã có dependency |
| `model+registry` | Thêm các registry phổ biến của hệ sinh thái repo (phát hiện từ lockfile) | Cần cài dependency |
| `custom` | Danh sách do người dùng cấp | Doanh nghiệp có registry nội bộ |

`model-only` làm hỏng `npm install`; mà worktree mới không có `node_modules`. Nên cần một câu trả lời: *chuẩn bị dependency
trước khi vào sandbox* (OnniCode chạy bước cài ở ngoài, hoặc chia sẻ kho cache **chỉ đọc**). Đây là câu hỏi Q6, nếu bỏ qua
thì sandbox bật lên sẽ làm hỏng các tác vụ phổ biến nhất.

### 8.3 API của chính OnniCode (`ONNI_API_URL`)

Hiện API không xác thực trên loopback; worker gọi được mọi route (§2.2). Trong sandbox cắt mạng, loopback của máy chủ **không
nằm trong** namespace mạng của worker, nên ta quyết định cái gì được lộ ra:

- Worker chỉ cần `onni task report` (và có thể `ask`/`memory` đọc). Đề xuất **cổng báo cáo (`report gateway`)**: một ổ cắm
  Unix (hoặc cổng loopback riêng) chuyển tiếp **chỉ** `POST` báo cáo của **chính run đó** (id gắn cứng ở phía OnniCode).
- Như vậy `POST /runs`, `merge`, `dispatch` thô từ worker không còn tới được — đóng đúng lỗ hổng ghi ở `manager-worker.md` §5.8,
  thứ mà roster không giải được.
- Không cần thêm cơ chế xác thực/tài khoản (vi phạm local-first/zero-config): quyền nằm ở **việc không có đường tới**
  route khác, không ở token.
- Với `ONNI_BIN`: vẫn trỏ tới `node`/`onni` được bind chỉ đọc; trên Windows `agy` dùng `$env:ONNI_BIN`, không đổi.

---

## 9. Tiến trình, tài nguyên

- Linux: `--unshare-pid` cho cây tiến trình riêng, kết hợp `--die-with-parent` nghĩa là khi OnniCode chết thì mọi tiến trình
  worker chết theo **(chưa kiểm hành vi)**. Thay phần lớn logic `ONNI_TASK_PROCESS_REAP` (quét theo `ONNI_TASK_ID`) bằng cấu trúc
  thay vì quét.
- Windows: Job Object cho `KILL_ON_JOB_CLOSE` và trần RAM/CPU/số tiến trình **(chưa kiểm)**; đây là bước **đầu tiên có giá trị
  trên Windows** dù chưa giam fs/mạng.
- Trần tài nguyên cho worker (RAM, CPU, đĩa tạm) nên đi cùng `limits` hiện có; đừng thêm núm mới nếu `limits` đã diễn đạt được.

---

## 10. Phù hợp với zero-config

1. **Phát hiện, không cấu hình.** Khởi động gọi `probe()` của từng provider: `bwrap` có trong PATH, `sandbox-exec` tồn tại, WSL2
   có distro, Docker/Podman chạy. Kết quả hiện trong Settings/cockpit dưới dạng trạng thái (không yêu cầu nhập gì).
2. **Rơi về hiện trạng.** Mọi `probe()` thất bại → worker chạy với rào chắn hôm nay, `RunRecord.sandbox = {provider:'none', reason}`.
   Không có lỗi boot.
3. **Opt-in, TẮT mặc định.** Cờ đề xuất (cập nhật `.env.example` cùng commit đầu tiên có cờ):
   - `ONNI_WORKER_SANDBOX=1` bật cho worker; `ONNI_WORKER_SANDBOX=require` từ chối chạy khi không giam được;
   - các cờ phụ chỉ khi cần (chọn provider, hồ sơ mạng). Ưu tiên đặt hồ sơ mạng trong Settings thay vì thêm biến môi trường.
   Theo `AGENTS.md`, đây **không phải** ngoại lệ "default-on đã được chủ duyệt"; chuyển mặc định sang bật là quyết định của chủ dự án
   (Q1) sau khi có số liệu từ Giai đoạn 1–2.
4. **Không đổi mặc định hiện có.** Codex vẫn `danger-full-access`, vì sandbox của OnniCode là lớp ngoài; chỉ khi sandbox ngoài giam được
   thì mới đáng xét lại việc hạ quyền bên trong.
5. **Trung thực.** Cockpit hiện nhãn `sandbox` từng run (`provider`, `level`), và danh sách **không chặn** của mức đó.

---

## 11. Lộ trình theo giai đoạn

Nguyên tắc: bước nhỏ nhất vẫn phải **giao giá trị đo được** và **không đòi hỏi quyết định kiến trúc lớn**.

| GĐ | Nội dung | Kết quả | Công sức (thứ bậc) |
|---|---|---|---|
| **0. Đo và kiểm (trước mọi code sandbox)** | (a) Bộ **kịch bản canary**: một worker giả (đã có các `scripts/mock-*.mjs`) cố ghi ngoài worktree, đọc `~/.onni`, gọi `POST /runs`, đổi ref `main`, mở kết nối ra ngoài; in ra cái nào **thành công** hiện nay. (b) Kiểm từng mục **(chưa kiểm)** trong tài liệu này trên máy thật (Windows, macOS, Linux). (c) Chạy từng agent CLI qua proxy ghi nhận để lấy danh sách host và xem có theo `HTTPS_PROXY` không; liệt kê tệp login. (d) Golden: mọi đường dẫn git ghi trong chu kỳ commit/merge | Bảng sự thật thay cho các dấu **(chưa kiểm)**; đường cơ sở "hôm nay bị gì"; chứng minh R1 bằng số | Nhỏ–vừa |
| **1. Bước nhỏ nhất có ích** | **`SandboxProvider` + provider `none`, ghi `RunRecord.sandbox?`, Job Object (Windows) / `bwrap --die-with-parent` (Linux) CHỈ cho dọn cây tiến trình**, không giam gì thêm. Cộng `GET`-chỉ-đọc `sandbox probe` trong Settings. Cộng **cổng báo cáo** (§8.3) nếu đo ở GĐ 0 cho thấy `POST /runs` từ worker thực sự xảy ra | Seam, nhãn trung thực, và một lợi ích hữu hình (không còn tiến trình mồ côi, kể cả Windows), không đổi hành vi giao việc | Nhỏ |
| **2. Giam fs trên Linux/macOS** | Provider `bwrap` và Seatbelt, mức `fs`, `HOME` giả + `credentialPaths`, git G1, `ONNI_WORKER_SANDBOX=1`. Chỉ một–hai backend ban đầu (đề xuất `claude`, `codex`). Ngoài danh sách = `canSandbox:false` | Worker không ghi/đọc được ngoài worktree và tệp login của chính nó; có số liệu về vỡ toolchain | Vừa–lớn |
| **3. Mạng có allowlist** | Proxy lọc host, hồ sơ `model-only`/`model+registry`, bước chuẩn bị dependency | Chặn rò rỉ mã nguồn ra host ngoài danh sách | Lớn |
| **4. Windows thật** | WSL2 + `bwrap` (nếu Q4 đồng ý), hoặc container; đánh giá lại AppContainer | Lời hứa giam cho khách Windows | Lớn |
| **5. Tầm xa** | Container/devcontainer (tập con an toàn), microVM, G2 (bản sao riêng thay vì dùng chung `.git`), môi giới token, sandbox cho manager (Q3), chuyển mặc định sang bật (Q1) | Gói enterprise | Rất lớn |

**Bước đầu tiên chọn** là GĐ 0 + GĐ 1, vì: (i) GĐ 0 biến dấu **(chưa kiểm)** thành sự thật và cho ra bằng chứng bán hàng
("đây là những gì worker làm được hôm nay"); (ii) GĐ 1 không thay đổi quyền của ai, rủi ro hồi quy gần bằng 0, nhưng tạo
seam và sửa lỗ hổng thật còn lại ở Windows (tiến trình mồ côi). Bước giam fs đầu tiên (GĐ 2) nên bắt đầu ở Linux vì `bwrap` là
phương án rẻ nhất, chưa cần quyết định về Windows.

**Mọi giai đoạn:** có test beside-the-code; không `.skip` (nền tảng thiếu khả năng thì kiểm bằng capability check trong test);
`npm test`/`npm run test:unit` vẫn không cần server hay trình duyệt; chạy đủ cổng `typecheck`, `test`, `test:unit`, `build`,
`test:package`. Không vá để "xanh" các test Windows vốn đỏ vì môi trường (CI là chuẩn).

---

## 12. Rủi ro của chính thiết kế này

1. **Cảm giác an toàn giả.** Nhãn "sandboxed" nhưng cấu hình hở (cho phép `/mnt/c`, bind quá rộng, host allowlist quá lỏng).
   Giảm thiểu: nhãn gắn với `level` đo được và bài canary chạy lại trong CI trên mỗi provider.
2. **Vỡ toolchain của khách.** Sandbox quá chặt làm `cargo`, `gradle`, `dotnet`, `docker` trong repo hỏng, khách bỏ sandbox. Giảm
   thiểu: ra mắt TẮT, đo tỉ lệ vỡ ở GĐ 2, có hồ sơ nới có tên và có lý do.
3. **Phụ thuộc bên thứ ba.** `sandbox-exec` bị Apple loại bỏ, `bwrap` bị distro chặn user namespace, Docker đổi điều khoản.
   Giảm thiểu: `SandboxProvider` là seam, mỗi provider thay được; `probe()` phát hiện hồi quy.
4. **Rò rỉ qua kênh được phép.** Token đăng nhập đọc được rồi gửi tới đúng host API (kẻ tấn công cần tài khoản/endpoint tại đó) hoặc
   mã nguồn nhúng vào prompt gửi cho mô hình. **Không sandbox nào chặn được kênh này**; chỉ nói rõ trong tài liệu khách hàng.
5. **Chi phí hỗ trợ.** Mỗi provider × mỗi backend × mỗi hệ điều hành là một ô ma trận. Giảm thiểu: bắt đầu một–hai ô, mở rộng theo bằng chứng.
6. **Chạm cơ chế đang chạy.** G2 và việc hạ quyền codex đụng các chỗ "đang tốt". Theo `AGENTS.md`, hỏi trước: cơ chế cũ *gánh gì ngầm*?
   (vd. `danger-full-access` của codex đang gánh việc ghi `.git/worktrees/<tên>` và mạng).
7. **Tự phụ thuộc vào lời tự khai.** `probe()` báo khả dụng nhưng sandbox dựng lỗi âm thầm. Giảm thiểu: sau khi dựng, chạy một **tự kiểm** rất nhỏ
   (thử ghi ngoài worktree phải thất bại) trước khi giao việc; thất bại → coi như `available:false`.

---

## 13. Câu hỏi cho chủ dự án

- **Q1. Mặc định bật hay tắt?** Đề xuất: ra mắt **TẮT** (đúng quy tắc opt-in của `AGENTS.md`, vì sandbox làm đổi hành vi worker), chuyển sang
  mặc định bật cho worker **sau** GĐ 2–3 khi có số liệu vỡ toolchain thấp. Có chấp nhận lộ trình đó không? Đây là một ngoại lệ "default-on" mới
  nếu bật sớm, cần chủ duyệt rõ.
- **Q2. Fail-closed hay fallback khi không giam được?** Mặc định đề xuất là fallback có nhãn; chế độ `require` cho doanh nghiệp. Bản thương mại
  nên có `require` làm mặc định cho gói trả phí không?
- **Q3. Có giam cả manager và run top-level không?** Hiện chỉ worker. Manager cần `git merge`, API đầy đủ; run top-level là việc của chính người dùng.
  Đề xuất: chỉ worker, kể cả sau này; manager dựa vào `managerFullAccess`.
- **Q4. Windows: có chấp nhận phụ thuộc WSL2 (hoặc Docker) cho "giam thật" không?** Nếu không, lời hứa bảo mật trên Windows chỉ dừng ở Job Object +
  nhãn trung thực, và bản thương mại phải nói rõ chênh lệch này. AppContainer là đường duy nhất không cần cài thêm nhưng là dự án lớn nhất và
  rủi ro tương thích cao nhất. Windows là nền tảng dev chính — ưu tiên đến đâu?
- **Q5. Container/devcontainer có thuộc phạm vi bản thương mại không?** Chúng giải toolchain của khách tốt nhất nhưng kéo theo phụ thuộc Docker/Podman,
  giấy phép Docker Desktop và an ninh của `devcontainer.json`. Làm GĐ 5 hay cắt hẳn?
- **Q6. Chuẩn bị dependency trước sandbox thế nào?** `npm install` cần mạng nhưng worker không được có mạng rộng. Cài ở ngoài (OnniCode chạy bước
  cài trước, mã lạ của `postinstall` chạy **ngoài** sandbox — tệ hơn), hay cho registry vào allowlist (`model+registry`), hay kho cache chỉ đọc?
  Mỗi lựa chọn đánh đổi khác nhau về an toàn; cần chủ chọn.
- **Q7. Chấp nhận rủi ro "token đọc được" không?** Với đăng nhập thuê bao (OAuth) do CLI giữ, worker vẫn đọc được token; egress allowlist chỉ
  giới hạn nơi gửi tới. Có chấp nhận ghi vào tài liệu bán hàng, hay cần môi giới token (chỉ khả thi với khóa API) làm điều kiện?
- **Q8. G1 hay G2 cho git?** G1 giữ luồng merge, G2 cách ly ref thật nhưng đổi luồng merge và dọn dẹp. Đề xuất G1 trước. Có đồng ý không?
- **Q9. Phạm vi backend ban đầu.** Đề xuất `claude` và `codex` (đã biết cơ chế quyền nhất). Backend ACP (`copilot`, `cline`, `junie`), `cursor`, `agy`,
  `pi`, `opencode` để sau. Có ưu tiên backend nào khác theo khách hàng mục tiêu không?
- **Q10. Cách nói với khách hàng.** Các mức (`fs`, `fs+read`, `fs+net`, `vm`) và danh sách "không chặn" có được công bố nguyên văn không, hay chỉ
  trong tài liệu bảo mật dưới NDA?
- **Q11. Ngân sách kiểm thử.** GĐ 0 cần máy thật (Windows/macOS/Linux, Home và Pro). Ai/máy nào chạy? CI hiện chỉ có Linux và Windows cho phần desktop
  (`desktop-check.yml`), không có macOS **(chưa kiểm cấu hình hiện tại)**.

---

## 14. Chưa làm / chưa kiểm

- Chưa có dòng code nào; chưa chạy thử một sandbox nào với một agent CLI nào.
- **Toàn bộ** nhận định về Job Object, Low IL, AppContainer, Windows Sandbox, WSL2, `sandbox-exec`, App Sandbox, `bwrap`, Landlock, seccomp, Firejail,
  systemd-run, Docker/Podman, devcontainer, microVM, sandbox riêng của Codex/Claude, phiên bản kernel, cờ dòng lệnh, giấy phép Docker Desktop, hành vi
  Keychain/Credential Manager/libsecret, và việc từng CLI có theo `HTTPS_PROXY` hay không là **(chưa kiểm)**.
- Chưa kiểm vị trí tệp đăng nhập của từng agent CLI và việc chúng có tự làm mới token hay không.
- Chưa kiểm danh sách host mô hình/đăng nhập/telemetry của từng CLI.
- Chưa kiểm tập đầy đủ các đường dẫn git ghi khi commit/merge/rebase/stash (cơ sở của G1).
- Chưa đo chi phí/độ trễ khởi động của bất kỳ provider nào; mọi "thấp/vừa/lớn" là ước lượng thứ bậc.
- Chưa kiểm cách `ONNI_DISCLAIM_EXEC` (macOS) tương tác với một lớp bọc Seatbelt.
- Chưa kiểm xem codex `workspace-write` có chặn ghi `.git/worktrees/<tên>` hay không (suy luận ở §5.4).
