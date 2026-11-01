/** Vietnamese gap-fill and wording fixes. Merged LAST in `messages.ts`, so a key here overrides the
 *  same key in an area file. Keys are the exact English source strings. */
export const viPolish: Record<string, string> = {
  // Agent runners and model presets (rendered through t() by the pickers)
  'Claude Code CLI': 'Claude Code CLI',
  'OpenAI Codex (app-server)': 'OpenAI Codex (app-server)',
  'JetBrains Junie CLI': 'JetBrains Junie CLI',
  'OpenCode (serve)': 'OpenCode (serve)',
  'Cursor Agent CLI': 'Cursor Agent CLI',
  'pi CLI (provider/model)': 'pi CLI (nhà cung cấp/model)',
  'GitHub Copilot CLI (ACP)': 'GitHub Copilot CLI (ACP)',
  'Cline CLI (ACP, provider/model)': 'Cline CLI (ACP, nhà cung cấp/model)',
  'Google Antigravity CLI (agy)': 'Google Antigravity CLI (agy)',
  'Pick the best model per step': 'Tự chọn model phù hợp nhất cho từng bước',
  'Most capable, for the hardest tasks': 'Mạnh nhất, dành cho những nhiệm vụ khó nhất',
  'Deep reasoning for hard tasks': 'Suy luận sâu cho nhiệm vụ khó',
  'Fast and cheap': 'Nhanh và rẻ',
  'Fastest — simple, scoped tasks': 'Nhanh nhất — cho nhiệm vụ đơn giản, phạm vi hẹp',
  'Use your Codex default model': 'Dùng model mặc định của Codex',
  'Use your OpenCode default model': 'Dùng model mặc định của OpenCode',
  'Use your Junie default model': 'Dùng model mặc định của Junie',
  'Use your Cursor default model': 'Dùng model mặc định của Cursor',
  'Use your pi default model': 'Dùng model mặc định của pi',
  'Let Copilot pick the model': 'Để Copilot tự chọn model',
  'Use your Cline default model': 'Dùng model mặc định của Cline',
  'Use your Antigravity default model': 'Dùng model mặc định của Antigravity',
  'Custom or legacy model': 'Model tùy chỉnh hoặc cũ',

  // Provider status
  'Credentials found': 'Đã có thông tin xác thực',
  'Not connected': 'Chưa kết nối',

  // Task settings panel
  'Task settings': 'Cài đặt nhiệm vụ',
  'Open {section} settings': 'Mở cài đặt {section}',
  'Collapse task settings': 'Thu gọn cài đặt nhiệm vụ',
  'Manager–Worker preset': 'Preset quản lý–worker',
  'Discard these changes and use the preset again': 'Bỏ các thay đổi này và dùng lại preset',
  'Rename {name}': 'Đổi tên {name}',
  'Rename preset': 'Đổi tên preset',
  'Delete preset': 'Xoá preset',
  'Name this preset…': 'Đặt tên cho preset này…',
  'Save current as preset': 'Lưu cấu hình hiện tại thành preset',

  // New task
  'Splits this task into subtasks it runs as separate tasks. Worktree stays on. Its own limits are in Advanced.':
    'Chia nhiệm vụ này thành các nhiệm vụ con và chạy riêng từng cái. Worktree luôn bật. Giới hạn riêng nằm trong phần Nâng cao.',
  'Single agent': 'Một agent',
  'Replaced by the manager: it runs this task with the backend and model you pick on the right.':
    'Được thay bằng agent quản lý: nó chạy nhiệm vụ này với backend và model bạn chọn ở bên phải.',
  'The only connected agent on this host': 'Agent duy nhất đã kết nối trên máy này',
  Variants: 'Biến thể',
  'Manager and workers': 'Quản lý và worker',
  'Manager–Worker needs Dispatch, which is off on this server or in a folder without git.':
    'Chế độ quản lý–worker cần Giao việc, nhưng tính năng này đang tắt trên server này hoặc thư mục không có git.',
  'No git repository — the run stays in this folder. There is no worktree to isolate in, so it cannot run unattended.':
    'Không có kho git — lượt chạy diễn ra ngay trong thư mục này. Không có worktree để cô lập nên không thể chạy không giám sát.',
  'A read-only question runs in your checkout and changes nothing — there is no worktree to choose.':
    'Câu hỏi chỉ đọc chạy ngay trong bản checkout của bạn và không thay đổi gì — không cần chọn worktree.',
  'Where it runs': 'Nơi chạy',
  'Isolated worktree': 'Worktree tách biệt',
  'A separate copy of the repo. Review the diff before anything lands.':
    'Một bản sao riêng của repo. Xem diff trước khi bất kỳ thay đổi nào được đưa vào.',
  "The manager's workers fork its commits — a manager–worker task needs a worktree":
    'Các worker của agent quản lý rẽ nhánh từ commit của nó — nhiệm vụ quản lý–worker cần có worktree',
  'Edit my checkout directly': 'Sửa trực tiếp bản checkout của tôi',
  'Runs in the repo working tree. Changes appear in your checkout immediately.':
    'Chạy ngay trong thư mục làm việc của repo. Thay đổi xuất hiện trong checkout của bạn tức thì.',
  'A worktree already forks from the base; this applies when you edit your checkout directly.':
    'Worktree vốn đã rẽ nhánh từ nhánh gốc; tuỳ chọn này chỉ áp dụng khi bạn sửa trực tiếp checkout.',
  'Autonomous runs need an isolated worktree, and this folder is not a git repository.':
    'Lượt chạy tự động cần worktree tách biệt, mà thư mục này không phải kho git.',
  'Unavailable: there is no worktree to isolate, so the run must stay attended.':
    'Không khả dụng: không có worktree để cô lập nên lượt chạy phải có người theo dõi.',
  'The run will not pause for your approval. It stays fenced: no auto-land, and the limits below bound cost, time and steps.':
    'Lượt chạy sẽ không dừng lại chờ bạn duyệt. Nó vẫn bị rào lại: không tự đưa thay đổi vào, và các giới hạn bên dưới chặn chi phí, thời gian và số bước.',
  'The run pauses when the agent needs you. Turning Autonomous on forces an isolated worktree.':
    'Lượt chạy sẽ dừng khi agent cần bạn. Bật chế độ tự động sẽ bắt buộc dùng worktree tách biệt.',
  Limits: 'Giới hạn',
  'This run: {limits}': 'Lượt chạy này: {limits}',
  'Read-only question': 'Câu hỏi chỉ đọc',
  'Follow-up generation': 'Tạo gợi ý tiếp theo',
  'Dispatch (subtasks)': 'Giao việc (nhiệm vụ con)',
  'Tap to turn it on; its own limits open from the arrow beside it.':
    'Chạm để bật; giới hạn riêng của nó mở từ mũi tên bên cạnh.',

  // Settings
  'Effective values come from this process’s own cgroup; host totals are labelled.':
    'Giá trị hiệu lực lấy từ cgroup của chính tiến trình này; tổng của máy chủ được ghi rõ.',

  // Toasts
  'Started "{name}" — the task is queued.': 'Đã khởi chạy "{name}" — nhiệm vụ đang chờ trong hàng đợi.',
  'Checking events for "{name}" now.': 'Đang kiểm tra sự kiện cho "{name}".',
  'Preview queued for "{name}" — no tasks will launch. See the execution log for results.': 'Đã xếp hàng xem trước cho "{name}" — sẽ không có nhiệm vụ nào được chạy. Xem nhật ký thực thi để biết kết quả.',
  'Duplicated as "{name}", paused.': 'Đã nhân bản thành "{name}", ở trạng thái tạm dừng.',
  'Copied to the clipboard.': 'Đã sao chép vào bộ nhớ tạm.',
  'Copy failed — select the text to copy it.': 'Sao chép thất bại — hãy chọn văn bản để tự sao chép.',
  'Cleanup requested. The task is kept until cleanup completes.': 'Đã yêu cầu dọn dẹp. Nhiệm vụ được giữ lại cho đến khi dọn xong.',
  'Run manually: {text}': 'Hãy tự chạy: {text}',
  'Removed the shortcut for {label}': 'Đã gỡ phím tắt của {label}',
  'Committed {sha} — pushing…': 'Đã commit {sha} — đang push…',
  'Committed {sha}': 'Đã commit {sha}',
  'Another message to the task is still being delivered — try again in a moment': 'Một tin nhắn khác tới nhiệm vụ vẫn đang được gửi — hãy thử lại sau giây lát',
  'Still loading this task — click the element again in a moment.': 'Nhiệm vụ vẫn đang tải — hãy bấm lại vào phần tử sau giây lát.',
  'Too many comments to keep as a draft — send the ones you have first.': 'Quá nhiều bình luận để giữ làm bản nháp — hãy gửi các bình luận hiện có trước.',

  // Wording fixes: literal renderings that read stiffly
  Comfortable: 'Thoáng',
  Full: 'Toàn chiều rộng',
  'Full gives task sessions, commits, and skill content the whole available area. Narrow keeps a comfortable reading column. The Changes tab is always full-width.':
    'Toàn chiều rộng cho phiên nhiệm vụ, commit và nội dung skill dùng hết vùng trống. Hẹp giữ một cột đọc dễ chịu. Tab Thay đổi luôn ở toàn chiều rộng.',
  'Compact tightens spacing across the cockpit — text stays the same size.':
    'Gọn sẽ thu hẹp khoảng cách trong toàn bộ cockpit — cỡ chữ giữ nguyên.',
}
