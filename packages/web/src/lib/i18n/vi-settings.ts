/** Vietnamese for Settings. Keys are exact English source strings. */
export const viSettings: Record<string, string> = {
  // Appearance
  Language: 'Ngôn ngữ',
  'Applies to this browser only. Server messages, run output and agent replies stay in English.':
    'Chỉ áp dụng cho trình duyệt này. Thông báo từ server, kết quả lượt chạy và phản hồi của agent vẫn bằng tiếng Anh.',
  Theme: 'Chủ đề',
  System: 'Theo hệ thống',
  Light: 'Sáng',
  Dark: 'Tối',
  'System follows your OS preference. Applies to this browser.':
    'Theo hệ thống sẽ bám cài đặt của hệ điều hành. Chỉ áp dụng cho trình duyệt này.',
  Accent: 'Màu nhấn',
  Lime: 'Xanh chanh',
  Violet: 'Tím',
  "The primary action color. Saved with this repo's cockpit state.":
    'Màu của hành động chính. Được lưu cùng trạng thái cockpit của repo này.',
  Density: 'Mật độ',
  Comfortable: 'Thoải mái',
  Compact: 'Gọn',
  'Compact for real': 'Gọn thật sự',
  'Compact tightens spacing across the cockpit — text stays the same size.':
    'Gọn sẽ thu hẹp khoảng cách trong toàn bộ cockpit — cỡ chữ giữ nguyên.',
  'Reading width': 'Độ rộng đọc',
  Narrow: 'Hẹp',
  Full: 'Toàn phần',
  'Full gives task sessions, commits, and skill content the whole available area. Narrow keeps a comfortable reading column. The Changes tab is always full-width.':
    'Toàn phần cho phiên nhiệm vụ, commit và nội dung skill dùng hết vùng trống. Hẹp giữ một cột đọc thoải mái. Tab Thay đổi luôn ở toàn phần.',
  'Project order': 'Thứ tự dự án',
  'The sidebar is in the order you dragged it into. Reset puts it back to most-recently-opened first. Shared with every browser signed in to this onni.':
    'Thanh bên đang theo thứ tự bạn kéo. Đặt lại sẽ trả về dự án mở gần nhất trước. Dùng chung cho mọi trình duyệt đăng nhập vào onni này.',
  'Reset order': 'Đặt lại thứ tự',
  'Instance name': 'Tên instance',
  'Shown in the sidebar and browser tab across this workspace.':
    'Hiển thị ở thanh bên và tab trình duyệt trong toàn workspace này.',
  'Reset name': 'Đặt lại tên',
  Logo: 'Logo',
  'PNG, JPEG, WebP, GIF, AVIF, or safe SVG up to 2 MB. Stored on this machine and shared by its browsers.':
    'PNG, JPEG, WebP, GIF, AVIF hoặc SVG an toàn, tối đa 2 MB. Lưu trên máy này và dùng chung cho các trình duyệt ở đây.',
  'Logo preview': 'Xem trước logo',
  'Current instance logo': 'Logo instance hiện tại',
  'Current logo': 'Logo hiện tại',
  'No logo selected': 'Chưa chọn logo',
  'Choose an image to preview it before saving.': 'Chọn ảnh để xem trước rồi mới lưu.',
  'Upload logo': 'Tải logo lên',
  'Choose logo': 'Chọn logo',
  'Save logo': 'Lưu logo',
  Cancel: 'Huỷ',
  'Remove logo': 'Xoá logo',

  // Settings sections (in gap-file order)
  ' — remove it below, or restore the folder': ' — hãy xoá nó bên dưới, hoặc khôi phục thư mục',
  ' — restore the folder at the path above': ' — khôi phục thư mục ở đường dẫn trên',
  ' at most': ' là tối đa',
  '— re-drag the buttons after changing this': '— hãy kéo lại các nút sau khi thay đổi mục này',
  ', a git URL or a local path; access uses your existing git credentials.':
    ', một URL git hoặc đường dẫn cục bộ; việc truy cập dùng thông tin git hiện có của bạn.',
  ', then': ', sau đó',
  ', then reload this page. If someone else runs this server, ask them to turn webhooks on.':
    ', sau đó tải lại trang này. Nếu người khác chạy server này, hãy nhờ họ bật webhooks.',
  '. Local deletion does not revoke the vendor token.':
    '. Xoá cục bộ không thu hồi token của nhà cung cấp.',
  '. The folder, its git history and its task history all stay exactly where they are, and adding it back later finds everything intact.':
    '. Thư mục, lịch sử git và lịch sử nhiệm vụ đều giữ nguyên tại chỗ, và khi thêm lại sau này mọi thứ vẫn còn nguyên.',
  '. The result filter applies to loaded entries. Times in {zone}.':
    '. Bộ lọc kết quả áp dụng cho các mục đã tải. Thời gian theo {zone}.',
  '(availability unknown)': '(không rõ tình trạng)',
  '(default)': '(mặc định)',
  '(deleted)': '(đã xoá)',
  '(effective)': '(hiệu lực)',
  '(no skills match)': '(không có skill nào khớp)',
  '(no skills yet — the generic launcher above still works)':
    '(chưa có skill — trình khởi chạy chung ở trên vẫn dùng được)',
  '(optional)': '(tuỳ chọn)',
  '(reclaimable)': '(có thể thu hồi)',
  '{action} {name}?': '{action} {name}?',
  '{action} {provider} credentials': '{action} thông tin đăng nhập {provider}',
  '{active} active · {paused} paused': '{active} đang hoạt động · {paused} đã tạm dừng',
  '{chord} moved from {previous} to {current}': '{chord} đã chuyển từ {previous} sang {current}',
  '{count} attempt': '{count} lần thử',
  '{count} attempts': '{count} lần thử',
  '{count} characters — the limit is {limit}.': '{count} ký tự — giới hạn là {limit}.',
  '{count} cores': '{count} lõi',
  '{count} failed attempt in a row.': '{count} lần thử thất bại liên tiếp.',
  '{count} failed attempts in a row.': '{count} lần thử thất bại liên tiếp.',
  '{count} inactive': '{count} không hoạt động',
  '{count} need attention': '{count} cần xử lý',
  '{count} pending': '{count} đang chờ',
  '{count} pending deliveries': '{count} lượt gửi đang chờ',
  '{count} pending deliveries will be cancelled; one already sending may still arrive.':
    '{count} lượt gửi đang chờ sẽ bị huỷ; một lượt đang gửi có thể vẫn đến.',
  '{count} pending delivery': '{count} lượt gửi đang chờ',
  '{count} pending delivery will be cancelled; one already sending may still arrive.':
    '{count} lượt gửi đang chờ sẽ bị huỷ; một lượt đang gửi có thể vẫn đến.',
  '{count} presets is the cap — edit or delete one first':
    'Đã đạt giới hạn {count} preset — hãy sửa hoặc xoá một preset trước',
  '{count} queued now': '{count} đang trong hàng đợi',
  '{count} receiver': '{count} receiver',
  '{count} receivers': '{count} receiver',
  '{count} sending': '{count} đang gửi',
  '{count} worktree': '{count} worktree',
  '{count} worktrees': '{count} worktree',
  '{name} — deleted {time}': '{name} — đã xoá {time}',
  '{name} — history': '{name} — lịch sử',
  '{name} can be tried again.': 'Có thể thử lại {name}.',
  '{name} connected': 'Đã kết nối {name}',
  '{name} contents': 'Nội dung {name}',
  '{name} manual sign-in': 'Đăng nhập thủ công {name}',
  '{name} removed': 'Đã xoá {name}',
  '{name} removed from the workspace — its files are untouched':
    'Đã xoá {name} khỏi workspace — các tệp của nó không bị động đến',
  '{name} saved': 'Đã lưu {name}',
  '{path} — click to copy': '{path} — bấm để sao chép',
  '{phase} — command {number}': '{phase} — lệnh {number}',
  '{profile} content': 'Nội dung {profile}',
  '{provider} credentials for this project': 'Thông tin đăng nhập {provider} cho dự án này',
  '{provider} picker': 'Bộ chọn {provider}',
  '{receivers} will be paused. {deliveries} will be cancelled; {inFlight} in flight may still arrive.':
    '{receivers} sẽ bị tạm dừng. {deliveries} sẽ bị huỷ; {inFlight} đang gửi có thể vẫn đến.',
  '{size} on disk': '{size} trên đĩa',
  '1 means a worker cannot dispatch further tasks. Higher values let workers fan out too.':
    '1 nghĩa là worker không thể giao thêm nhiệm vụ. Giá trị cao hơn cho phép worker cũng phân nhánh.',
  A: 'Một',
  'A browser notification when a task starts waiting, asks for review, or fails — only while this tab is in the background. Off by default.':
    'Thông báo trên trình duyệt khi nhiệm vụ bắt đầu chờ, cần đánh giá hoặc thất bại — chỉ khi tab này ở chế độ nền. Mặc định tắt.',
  'A fence, not a sandbox: unattended agents get a pre-push hook that refuses refs outside onni/*, and Claude sessions deny git push. A backend can still reach your home folder, the network and files outside its worktree, and':
    'Một hàng rào, không phải sandbox: agent chạy không giám sát nhận hook pre-push từ chối các ref ngoài onni/*, và phiên Claude chặn git push. Backend vẫn có thể truy cập thư mục home, mạng và các tệp ngoài worktree của nó, và',
  'A manager and its workers share one set of ceilings, and workers run within the parallel-task cap.':
    'Quản lý và các worker dùng chung một bộ giới hạn, và worker chạy trong giới hạn nhiệm vụ song song.',
  'A manager and the workers it may use. Choose one in the new-task composer, or adjust it for a single task there. Only the agents listed are ever used.':
    'Một quản lý và các worker mà nó được dùng. Chọn một preset trong khung soạn nhiệm vụ mới, hoặc chỉnh cho một nhiệm vụ tại đó. Chỉ những agent được liệt kê mới được dùng.',
  absent: 'không có',
  'Account added — use Connect to sign in': 'Đã thêm tài khoản — dùng Kết nối để đăng nhập',
  'Account email': 'Email tài khoản',
  'Account name': 'Tên tài khoản',
  Activate: 'Kích hoạt',
  activation: 'kích hoạt',
  Activity: 'Hoạt động',
  'Add account': 'Thêm tài khoản',
  'Add agent account': 'Thêm tài khoản agent',
  'Add cleanup command': 'Thêm lệnh dọn dẹp',
  'Add or replace a secret': 'Thêm hoặc thay secret',
  'Add receiver': 'Thêm receiver',
  'Add repository': 'Thêm repository',
  'Add setup command': 'Thêm lệnh thiết lập',
  'Add to your projects': 'Thêm vào dự án của bạn',
  'Add your own endpoint. Send a test, then activate it.':
    'Thêm endpoint của riêng bạn. Gửi thử, sau đó kích hoạt.',
  Added: 'Đã thêm',
  Advanced: 'Nâng cao',
  'Advanced timeout': 'Thời gian chờ nâng cao',
  'After saving, use Rotate key and copy the new signing key into your receiver before testing.':
    'Sau khi lưu, dùng Xoay khoá và sao chép khoá ký mới vào receiver trước khi kiểm tra.',
  Age: 'Thời gian tồn tại',
  Agent: 'Agent',
  'Agent config did not load': 'Không tải được cấu hình agent',
  'Agent permission settings did not load': 'Không tải được cài đặt quyền của agent',
  'Agent settings did not load': 'Không tải được cài đặt agent',
  'Agentic browser end-to-end testing': 'Kiểm thử end-to-end bằng agent trình duyệt',
  'Agents are never an audience: a secret cannot be handed to a Claude Code, Codex or OpenCode session.':
    'Agent không bao giờ là đối tượng nhận: secret không thể trao cho phiên Claude Code, Codex hay OpenCode.',
  'agy cannot ask you before running a command when Onni drives it, so what it may do is decided here. It applies to every project.':
    'Khi Onni điều khiển agy, nó không thể hỏi bạn trước khi chạy lệnh, nên những gì nó được làm sẽ quyết định ở đây. Áp dụng cho mọi dự án.',
  'Allow a receiver on this computer or private network':
    'Cho phép receiver trên máy này hoặc mạng riêng',
  Allowed: 'Được phép',
  'and cancels {count} pending deliveries': 'và huỷ {count} lượt gửi đang chờ',
  'and cancels {count} pending delivery': 'và huỷ {count} lượt gửi đang chờ',
  'Antigravity is set to skip all confirmations for watched tasks. Choose another level to turn it off.':
    'Antigravity đang được đặt bỏ qua mọi xác nhận cho các nhiệm vụ được theo dõi. Chọn mức khác để tắt.',
  'Antigravity permission level': 'Mức quyền của Antigravity',
  'Antigravity will run shell commands, drive a browser and fetch web pages without asking, as you, in the task worktree and beyond it. Onni’s push guard is a barrier, not a sandbox. This applies to tasks you start yourself; unattended tasks keep the narrow allow-rules.':
    'Antigravity sẽ chạy lệnh shell, điều khiển trình duyệt và tải trang web mà không hỏi, với quyền của bạn, trong worktree của nhiệm vụ và cả bên ngoài. Hàng rào push của Onni là rào chắn, không phải sandbox. Điều này áp dụng cho nhiệm vụ bạn tự khởi động; nhiệm vụ không giám sát vẫn giữ allow-rules hẹp.',
  'Any local process, including agents, can change receivers and read signing keys. If this wasn’t you, review it.':
    'Mọi tiến trình cục bộ, kể cả agent, đều có thể thay đổi receiver và đọc khoá ký. Nếu không phải bạn, hãy xem lại.',
  'API key': 'API key',
  'Applied consistently to Claude, Codex and OpenCode.':
    'Áp dụng nhất quán cho Claude, Codex và OpenCode.',
  'Applies to Claude, Codex and OpenCode — whenever the provider says when the limit lifts.':
    'Áp dụng cho Claude, Codex và OpenCode — bất cứ khi nào nhà cung cấp cho biết thời điểm hết giới hạn.',
  'Applies to newly started tasks.': 'Áp dụng cho nhiệm vụ mới bắt đầu.',
  'Applies when the task was not started with its own subtask limit.':
    'Áp dụng khi nhiệm vụ không được khởi động với giới hạn subtask riêng.',
  'Ask skill': 'Skill cho Ask',
  'auto (default)': 'tự động (mặc định)',
  'Auto-land applies to tasks that work in the checkout — set "Where tasks work" first.':
    'Tự động merge áp dụng cho nhiệm vụ làm việc trong checkout — hãy đặt "Nơi nhiệm vụ làm việc" trước.',
  'Auto-land off': 'Tự động merge tắt',
  'Auto-land on — finished tasks push to the base branch':
    'Tự động merge bật — nhiệm vụ hoàn tất được push lên nhánh nền',
  'Auto-land on the base branch': 'Tự động merge vào nhánh nền',
  'Auto-land: a finished task waits for your review — check Changes, send corrections, then use the task header\'s Commit to the base branch: it commits, rebases on the remote, runs the required checks and pushes. Autonomous tasks land on their own. A conflict or a failing check goes back to the agent. The agent is told this permission is granted.':
    'Tự động merge: nhiệm vụ đã xong sẽ chờ bạn đánh giá — xem tab Thay đổi, gửi chỉnh sửa, rồi dùng nút "Commit to the base branch" ở đầu nhiệm vụ: nó commit, rebase trên remote, chạy các kiểm tra bắt buộc và push. Nhiệm vụ tự động sẽ tự merge. Xung đột hoặc kiểm tra thất bại sẽ quay lại agent. Agent được thông báo rằng quyền này đã được cấp.',
  'Auto-resume after a usage limit': 'Tự động tiếp tục sau khi hết giới hạn sử dụng',
  'Automatic cleanup is suppressed for this generation because it was kept or cancelled. Explicit removal is still available.':
    'Tự động dọn dẹp bị tắt cho thế hệ này vì nó đã được giữ hoặc huỷ. Vẫn có thể xoá thủ công.',
  'Automatic cleanup suppressed': 'Đã tắt tự động dọn dẹp',
  'Autonomous by default': 'Tự chủ theo mặc định',
  available: 'khả dụng',
  Branch: 'Nhánh',
  'branch {branch}': 'nhánh {branch}',
  'Branch naming': 'Cách đặt tên nhánh',
  'Branch naming cleared': 'Đã xoá cách đặt tên nhánh',
  'Branch naming saved': 'Đã lưu cách đặt tên nhánh',
  'Branch or ref': 'Nhánh hoặc ref',
  'Branch per task (default) — a worktree and branch per task, reviewed before merging':
    'Nhánh riêng cho mỗi nhiệm vụ (mặc định) — mỗi nhiệm vụ một worktree và nhánh, được đánh giá trước khi merge',
  'Branch-per-task defaults restored':
    'Đã khôi phục mặc định nhánh riêng cho mỗi nhiệm vụ',
  'Browse {provider}': 'Duyệt {provider}',
  'Browse…': 'Duyệt…',
  'Cancel, check the refreshed receiver or its history, then choose the action again. Earlier consent is not reused.':
    'Huỷ, kiểm tra receiver đã làm mới hoặc lịch sử của nó, rồi chọn lại hành động. Sự đồng ý trước đó không được dùng lại.',
  'Cancels every queued and running task in every project. Also: onni stop --all.':
    'Huỷ mọi nhiệm vụ đang chờ và đang chạy trong mọi dự án. Còn có: onni stop --all.',
  'Capacity: {active} active + {monitoring} monitoring. Set 0 to make monitoring share active slots.':
    'Sức chứa: {active} đang hoạt động + {monitoring} đang theo dõi. Đặt 0 để phiên theo dõi dùng chung slot hoạt động.',
  'cgroup limits detected': 'đã phát hiện giới hạn cgroup',
  'cgroup limits detected · {source}': 'đã phát hiện giới hạn cgroup · {source}',
  'Change the shortcut for {command} ({chord})': 'Đổi phím tắt cho {command} ({chord})',
  'Changed: {fields}': 'Đã thay đổi: {fields}',
  'Changing where or what {name} sends makes it Inactive again{cancels}. A delivery already sending may still arrive. Renaming alone keeps it active.':
    'Thay đổi nơi hoặc nội dung {name} gửi sẽ khiến nó Không hoạt động trở lại{cancels}. Một lượt gửi đang đi có thể vẫn đến. Chỉ đổi tên thì vẫn giữ hoạt động.',
  'Check again': 'Kiểm tra lại',
  'Check the highlighted command before saving.': 'Kiểm tra lệnh được đánh dấu trước khi lưu.',
  'Check the highlighted commands before saving.':
    'Kiểm tra các lệnh được đánh dấu trước khi lưu.',
  'Choose a provider.': 'Chọn một nhà cung cấp.',
  'Choose a tracker project first.': 'Chọn một dự án tracker trước.',
  'Choose events': 'Chọn sự kiện',
  'Cleanup requested. The worktree remains until cleanup and removal complete.':
    'Đã yêu cầu dọn dẹp. Worktree vẫn còn cho đến khi dọn dẹp và xoá hoàn tất.',
  'Clipboard unavailable': 'Không dùng được clipboard',
  'cloned from GitHub': 'được clone từ GitHub',
  'Command {number}': 'Lệnh {number}',
  'Command copied': 'Đã sao chép lệnh',
  'Composer default (isolated worktree)': 'Mặc định của khung soạn (worktree riêng)',
  'Config folder': 'Thư mục cấu hình',
  Configure: 'Cấu hình',
  'Configure credentials for this project to browse.':
    'Cấu hình thông tin đăng nhập cho dự án này để duyệt.',
  'Configure per-project limits': 'Cấu hình giới hạn cho từng dự án',
  Configured: 'Đã cấu hình',
  Confirm: 'Xác nhận',
  Connect: 'Kết nối',
  'Connect a project or team from your issue tracker. Credentials belong only to this project and are stored locally outside the repository. Server-wide environment keys are not used.':
    'Kết nối một dự án hoặc nhóm từ issue tracker của bạn. Thông tin đăng nhập chỉ thuộc dự án này và được lưu cục bộ bên ngoài repository. Khoá môi trường cấp server không được dùng.',
  'Connect a provider': 'Kết nối nhà cung cấp',
  'Connect the coding agents available on this computer.':
    'Kết nối các agent lập trình có trên máy này.',
  'Connection status unavailable.': 'Không có trạng thái kết nối.',
  'Copy command': 'Sao chép lệnh',
  'Copy it into your receiver now — it is shown only once. If you lose it, use Rotate key to get a new one (or Revoke old keys while a rotation is still overlapping).':
    'Hãy sao chép nó vào receiver ngay — khoá chỉ hiện một lần. Nếu làm mất, dùng Xoay khoá để lấy khoá mới (hoặc Thu hồi khoá cũ khi việc xoay khoá vẫn còn thời gian chồng lấn).',
  'Copy key': 'Sao chép khoá',
  'Copy the project folder path': 'Sao chép đường dẫn thư mục dự án',
  'Cost, token, time and step ceilings, the subtask cap and the unanswered-wait expiry are under':
    'Giới hạn chi phí, token, thời gian và số bước, giới hạn subtask và thời hạn chờ không phản hồi nằm trong',
  'Could not copy the command': 'Không sao chép được lệnh',
  'Could not load bookmarklets': 'Không tải được bookmarklet',
  'Could not load project connection.': 'Không tải được kết nối dự án.',
  'Could not read the file.': 'Không đọc được tệp.',
  'Could not read the project registry — {message}':
    'Không đọc được sổ đăng ký dự án — {message}',
  'Couldn’t copy — select the key and copy it manually before closing.':
    'Không sao chép được — hãy chọn khoá và sao chép thủ công trước khi đóng.',
  'Couldn’t load the latest settings.': 'Không tải được cài đặt mới nhất.',
  'CPU over the last up to {seconds} seconds': 'CPU trong tối đa {seconds} giây gần nhất',
  'Credentials saved for this project. Browse and connect a scope.':
    'Đã lưu thông tin đăng nhập cho dự án này. Hãy duyệt và kết nối một phạm vi.',
  'Current: {destination} (path hidden)': 'Hiện tại: {destination} (đường dẫn bị ẩn)',
  'Custom receiver (signed onni JSON)': 'Receiver tuỳ chỉnh (JSON onni có ký)',
  Default: 'Mặc định',
  'Default agent': 'Agent mặc định',
  'Default model for {runner}': 'Model mặc định cho {runner}',
  'Default models': 'Model mặc định',
  'Default preset': 'Preset mặc định',
  'Default skills': 'Skill mặc định',
  'Delete "{name}"?': 'Xoá "{name}"?',
  'Delete {name}': 'Xoá {name}',
  'Delete {name}?': 'Xoá {name}?',
  'Delete receiver': 'Xoá receiver',
  'Delete the worktree for {task}': 'Xoá worktree của {task}',
  'Delete this worktree?': 'Xoá worktree này?',
  'Deleted {time} — read-only. Its settings and signing keys are gone; history is kept for up to 30 days.':
    'Đã xoá {time} — chỉ đọc. Cài đặt và khoá ký đã mất; lịch sử được giữ tối đa 30 ngày.',
  Deliveries: 'Lượt gửi',
  'Delivery ID': 'ID lượt gửi',
  'Delivery needs an OS-verified process identity to keep a single sender. Linux, macOS and Windows provide one; this platform does not.':
    'Việc gửi cần danh tính tiến trình do hệ điều hành xác minh để đảm bảo chỉ một nguồn gửi. Linux, macOS và Windows có; nền tảng này thì không.',
  'Delivery results and setting changes for this receiver.':
    'Kết quả gửi và thay đổi cài đặt của receiver này.',
  'Describe your branch naming convention…': 'Mô tả quy ước đặt tên nhánh của bạn…',
  Destination: 'Đích',
  'Development model': 'Mô hình phát triển',
  Disabled: 'Đã tắt',
  Disconnect: 'Ngắt kết nối',
  'Dispatch depth': 'Độ sâu giao việc',
  'Display name (optional)': 'Tên hiển thị (tuỳ chọn)',
  docs: 'docs',
  "Drag a button below to your browser's bookmarks bar. On any GitHub PR or issue, click it to open this cockpit directly. The cockpit must be running:":
    'Kéo một nút bên dưới vào thanh bookmark của trình duyệt. Trên bất kỳ PR hoặc issue GitHub nào, bấm nút để mở thẳng cockpit này. Cockpit phải đang chạy:',
  'e2e setup started': 'Đã bắt đầu thiết lập e2e',
  'e2e status': 'Trạng thái e2e',
  'Each receiver gets the task updates you choose while onni is running. New receivers stay Inactive until you test and activate them.':
    'Mỗi receiver nhận các cập nhật nhiệm vụ bạn chọn khi onni đang chạy. Receiver mới ở trạng thái Không hoạt động cho đến khi bạn kiểm tra và kích hoạt.',
  'Earlier webhook action failed: {message}': 'Hành động webhook trước đó thất bại: {message}',
  'Edit receiver': 'Sửa receiver',
  'Effective values come from this process’s own cgroup; host totals are labelled.':
    'Giá trị hiệu lực lấy từ cgroup của chính tiến trình này; tổng của máy chủ được ghi rõ.',
  'Emergency stop': 'Dừng khẩn cấp',
  'Enter a whole number from {min} to {max} (0 = unlimited).':
    'Nhập số nguyên từ {min} đến {max} (0 = không giới hạn).',
  'Enter a whole number from 1 to 60 minutes.': 'Nhập số nguyên từ 1 đến 60 phút.',
  'Enter a whole number of at least {min} MiB, or leave empty for no limit.':
    'Nhập số nguyên tối thiểu {min} MiB, hoặc để trống nếu không giới hạn.',
  'Event ID': 'ID sự kiện',
  Events: 'Sự kiện',
  'Example data only — nothing is sent.': 'Chỉ là dữ liệu ví dụ — không gửi gì cả.',
  'Example preview — illustrative values': 'Xem trước ví dụ — giá trị minh hoạ',
  'Example values (illustrative)': 'Giá trị ví dụ (minh hoạ)',
  Excluded: 'Bị loại trừ',
  'Extra monitoring sessions': 'Phiên theo dõi bổ sung',
  'Extra rules for every agent run — conventions, tone, review requirements…':
    'Quy tắc bổ sung cho mọi lượt chạy agent — quy ước, giọng điệu, yêu cầu đánh giá…',
  'Failures that resume automatically': 'Các lỗi sẽ tự động tiếp tục',
  'Filter bookmarklet skills': 'Lọc skill bookmarklet',
  'Filter skills…': 'Lọc skill…',
  Find: 'Tìm',
  'Finish signing in in the terminal, then check again.':
    'Hoàn tất đăng nhập trong terminal, rồi kiểm tra lại.',
  'Finished worktrees beyond the keep-limit are reclaimed now (directory only). Their branches are kept, so the work stays recoverable.':
    'Các worktree đã xong vượt giới hạn giữ lại sẽ được thu hồi ngay (chỉ thư mục). Nhánh của chúng được giữ, nên công việc vẫn có thể khôi phục.',
  Folder: 'Thư mục',
  'follow checked-out branch (default)': 'theo nhánh đang checkout (mặc định)',
  'for literal double braces, for example': 'cho dấu ngoặc nhọn kép theo nghĩa đen, ví dụ',
  'For local credential cleanup, run': 'Để dọn thông tin đăng nhập cục bộ, chạy',
  'for task {taskId}': 'cho nhiệm vụ {taskId}',
  'General rules for every project — conventions, tone, review requirements…':
    'Quy tắc chung cho mọi dự án — quy ước, giọng điệu, yêu cầu đánh giá…',
  "Git repositories whose skills are available in every project, kept up to date from the remote. A project's own skills with the same name win. Use":
    'Các repository Git có skill dùng được trong mọi dự án, được cập nhật từ remote. Skill cùng tên của dự án sẽ được ưu tiên. Dùng',
  'Global instructions cleared': 'Đã xoá hướng dẫn toàn cục',
  'Global instructions saved': 'Đã lưu hướng dẫn toàn cục',
  'Global system prompt': 'System prompt toàn cục',
  'Hide deleted receivers': 'Ẩn receiver đã xoá',
  'Hide folders': 'Ẩn thư mục',
  History: 'Lịch sử',
  'History kept until': 'Lịch sử được giữ đến',
  'host {cores} · {memory} RAM': 'máy chủ {cores} · {memory} RAM',
  'host {count} cores': 'máy chủ {count} lõi',
  'Host totals - no cgroup limit tighter than the host detected for this process.':
    'Tổng của máy chủ - không phát hiện giới hạn cgroup chặt hơn máy chủ cho tiến trình này.',
  'Host totals are unavailable right now.': 'Hiện không có tổng của máy chủ.',
  'How changes land': 'Cách thay đổi được merge',
  'How long a plain waiting session may stay open without activity before its live backend session ends. Continue resumes it; set 0 to keep it open indefinitely.':
    'Thời gian một phiên chờ thường có thể mở mà không hoạt động trước khi phiên backend trực tiếp kết thúc. Continue sẽ tiếp tục phiên; đặt 0 để giữ mở vô hạn.',
  'How many agent sessions may wait on CI, sub-agents, or monitored commands without using an active task slot. Extra sessions stay alive but pause the queue.':
    'Số phiên agent được chờ CI, agent con hoặc lệnh được theo dõi mà không chiếm slot nhiệm vụ đang hoạt động. Phiên dư vẫn sống nhưng tạm dừng hàng đợi.',
  "How many of this project's tasks may run at once — leave it empty to inherit the workspace limit. The workspace limit ({limit}) still applies as an overall ceiling, so a higher value here has no extra effect until that one is raised.":
    'Số nhiệm vụ của dự án này có thể chạy cùng lúc — để trống để kế thừa giới hạn workspace. Giới hạn workspace ({limit}) vẫn là mức trần chung, nên giá trị cao hơn ở đây chưa có tác dụng cho đến khi mức đó được nâng.',
  "How many of this project's tasks may run at once — leave it empty to inherit the workspace limit. The workspace limit still applies as an overall ceiling.":
    'Số nhiệm vụ của dự án này có thể chạy cùng lúc — để trống để kế thừa giới hạn workspace. Giới hạn workspace vẫn là mức trần chung.',
  'How many tasks run at once across every project. The rest wait in the queue. A non-git directory always runs one at a time.':
    'Số nhiệm vụ chạy cùng lúc trên mọi dự án. Phần còn lại chờ trong hàng đợi. Thư mục không phải git luôn chạy từng nhiệm vụ một.',
  'How many times the same order may be dispatched again after it failed. An order can only lower this.':
    'Số lần cùng một lệnh có thể được giao lại sau khi thất bại. Lệnh chỉ có thể giảm giá trị này.',
  'How new task branches are named. Generated from the first prompt.':
    'Cách đặt tên nhánh cho nhiệm vụ mới. Sinh từ prompt đầu tiên.',
  'How to build a receiver': 'Cách tạo một receiver',
  'HTTP is unencrypted — others on the network may read these messages. Use HTTPS where possible.':
    'HTTP không được mã hoá — người khác trên mạng có thể đọc các thông điệp này. Hãy dùng HTTPS khi có thể.',
  'HTTP status': 'Trạng thái HTTP',
  'I allow delivery to this computer or private network.':
    'Tôi cho phép gửi đến máy này hoặc mạng riêng.',
  'I understand Standard sends task titles, questions and error text to this receiver.':
    'Tôi hiểu Standard gửi tiêu đề nhiệm vụ, câu hỏi và nội dung lỗi đến receiver này.',
  'I’ve saved the key': 'Tôi đã lưu khoá',
  'If the test passes, {name} becomes Active and sends its queued deliveries that are still current{queued}.':
    'Nếu bài kiểm tra đạt, {name} sẽ Hoạt động và gửi các lượt gửi đang chờ còn hiệu lực{queued}.',
  'in {path} — onni does not edit Claude’s state file.':
    'trong {path} — onni không sửa tệp trạng thái của Claude.',
  'In the checkout: no worktree or branch per task. Write tasks take turns on the working tree, so two tasks started together never conflict. The composer can still ask for a worktree per task.':
    'Trong checkout: không có worktree hay nhánh riêng cho mỗi nhiệm vụ. Các nhiệm vụ ghi lần lượt trên cây làm việc, nên hai nhiệm vụ khởi động cùng lúc không bao giờ xung đột. Khung soạn vẫn có thể yêu cầu worktree riêng cho mỗi nhiệm vụ.',
  'In your projects': 'Trong dự án của bạn',
  'Include failures that will resume automatically (always included in All results)':
    'Bao gồm cả lỗi sẽ tự động tiếp tục (luôn có trong kết quả Tất cả)',
  Included: 'Được bao gồm',
  'Inherit environment': 'Kế thừa môi trường',
  'Inherited:': 'Kế thừa:',
  'Insert {variable} into {phase} command {number}': 'Chèn {variable} vào lệnh {number} của {phase}',
  'Install {name}, then run': 'Cài {name}, rồi chạy',
  Installed: 'Đã cài',
  'Instructions did not load': 'Không tải được hướng dẫn',
  'Interactive skills may recommend both off. Multi-step and parallel runs remain isolated.':
    'Skill tương tác có thể khuyến nghị tắt cả hai. Lượt chạy nhiều bước và song song vẫn được tách riêng.',
  'Invalid template': 'Mẫu không hợp lệ',
  'is kept as written and expanded when the agent runs.':
    'được giữ nguyên khi ghi và mở rộng khi agent chạy.',
  'Isolated worktree per task': 'Worktree riêng cho mỗi nhiệm vụ',
  'Issue tracker': 'Issue tracker',
  'its draft PR is ready — merge it to finish.':
    'PR nháp của nó đã sẵn sàng — merge để hoàn tất.',
  'Its settings and signing keys are removed; delivery history stays for up to 30 days.':
    'Cài đặt và khoá ký của nó bị xoá; lịch sử gửi được giữ tối đa 30 ngày.',
  'Jira site URL': 'URL trang Jira',
  'Keep draft and review again': 'Giữ bản nháp và xem lại',
  'Keep it': 'Giữ lại',
  'Keep last N finished worktrees': 'Giữ N worktree đã xong gần nhất',
  'Keep last N worktrees': 'Giữ N worktree gần nhất',
  'keeping all (unlimited)': 'giữ tất cả (không giới hạn)',
  'Keeping all worktrees (unlimited)': 'Đang giữ tất cả worktree (không giới hạn)',
  'Keeping every finished worktree.': 'Đang giữ mọi worktree đã xong.',
  'keeping the last {count}': 'giữ {count} cái gần nhất',
  'Keeping the last {count} finished worktree': 'Đang giữ {count} worktree đã xong gần nhất',
  'Keeping the last {count} finished worktree on disk.':
    'Đang giữ {count} worktree đã xong gần nhất trên đĩa.',
  'Keeping the last {count} finished worktrees': 'Đang giữ {count} worktree đã xong gần nhất',
  'Keeping the last {count} finished worktrees on disk.':
    'Đang giữ {count} worktree đã xong gần nhất trên đĩa.',
  'Key copied. Store it in your receiver.': 'Đã sao chép khoá. Hãy lưu vào receiver của bạn.',
  'Label for {name}': 'Nhãn cho {name}',
  'last known': 'lần cuối đã biết',
  'Last opened': 'Mở gần nhất',
  'Last test: {result}': 'Lần kiểm tra cuối: {result}',
  'Latest: revision {revision} · {state}': 'Mới nhất: bản sửa đổi {revision} · {state}',
  'Leave blank to keep the current URL': 'Để trống để giữ URL hiện tại',
  'Leave empty and save to clear. Applied to new runs only.':
    'Để trống và lưu để xoá. Chỉ áp dụng cho lượt chạy mới.',
  'Leave empty for the default names. A new task waits for its name before it forks.':
    'Để trống để dùng tên mặc định. Nhiệm vụ mới sẽ chờ có tên trước khi fork.',
  'Lifecycle state could not be loaded: {message}':
    'Không tải được trạng thái vòng đời: {message}',
  'Limits that apply to the whole tree': 'Giới hạn áp dụng cho toàn bộ cây',
  live: 'trực tiếp',
  'Live title updates': 'Cập nhật tiêu đề trực tiếp',
  'Live title updates off': 'Đã tắt cập nhật tiêu đề trực tiếp',
  'Live title updates on': 'Đã bật cập nhật tiêu đề trực tiếp',
  'Load average': 'Tải trung bình',
  'Load older': 'Tải mục cũ hơn',
  'Loaded saved scripts.': 'Đã tải script đã lưu.',
  'Loading activity…': 'Đang tải hoạt động…',
  'Loading agent config…': 'Đang tải cấu hình agent…',
  'Loading agent settings…': 'Đang tải cài đặt agent…',
  'Loading bookmarklets…': 'Đang tải bookmarklet…',
  'Loading branches…': 'Đang tải nhánh…',
  'Loading connection…': 'Đang tải kết nối…',
  'Loading deliveries…': 'Đang tải lượt gửi…',
  'Loading file…': 'Đang tải tệp…',
  'Loading history…': 'Đang tải lịch sử…',
  'Loading instructions…': 'Đang tải hướng dẫn…',
  'Loading project…': 'Đang tải dự án…',
  'Loading prompt templates…': 'Đang tải mẫu prompt…',
  'Loading receivers…': 'Đang tải receiver…',
  'Loading resource settings…': 'Đang tải cài đặt tài nguyên…',
  'Loading skill settings…': 'Đang tải cài đặt skill…',
  'Loading task settings…': 'Đang tải cài đặt nhiệm vụ…',
  'Loading the latest settings…': 'Đang tải cài đặt mới nhất…',
  'Loading the workspace limit…': 'Đang tải giới hạn workspace…',
  'Loading tracker settings…': 'Đang tải cài đặt tracker…',
  'Loading webhook status…': 'Đang tải trạng thái webhook…',
  'Loading worktree settings…': 'Đang tải cài đặt worktree…',
  'Loading worktrees…': 'Đang tải worktree…',
  Machine: 'Máy',
  'Manage webhooks': 'Quản lý webhook',
  'Managed by': 'Được quản lý bởi',
  'Manager–worker settings did not load': 'Không tải được cài đặt quản lý–worker',
  'Mark as reviewed': 'Đánh dấu đã đánh giá',
  'Max parallel tasks': 'Số nhiệm vụ song song tối đa',
  Memory: 'Bộ nhớ',
  'Memory limit cleared': 'Đã xoá giới hạn bộ nhớ',
  'Memory limit set to {size} MiB': 'Đã đặt giới hạn bộ nhớ {size} MiB',
  'merge {target} to finish.': 'merge {target} để hoàn tất.',
  'Message content': 'Nội dung thông điệp',
  Minimal: 'Tối thiểu',
  'Minimal — IDs, status and your own title': 'Tối thiểu — ID, trạng thái và tiêu đề của bạn',
  minutes: 'phút',
  'Minutes an autonomous or dispatched task may wait for an answer before it ends as failed (worktree and session kept; Continue answers it). Cannot be switched off.':
    'Số phút một nhiệm vụ tự động hoặc được giao việc có thể chờ phản hồi trước khi kết thúc với trạng thái thất bại (worktree và phiên được giữ; Continue sẽ trả lời). Không thể tắt.',
  'Minutes; 0 keeps plain waiting sessions alive. Monitoring sessions are already exempt.':
    'Số phút; 0 giữ cho phiên chờ thường vẫn sống. Phiên theo dõi vốn đã được miễn.',
  'Model key:': 'Khoá model:',
  'Model provider': 'Nhà cung cấp model',
  'Models are locked to the defaults configured in the native coding-agent settings.':
    'Model bị khoá theo mặc định đã cấu hình trong cài đặt gốc của agent lập trình.',
  'Monitoring wake-up': 'Đánh thức khi theo dõi',
  'Monitoring will re-check every {count} minutes': 'Theo dõi sẽ kiểm tra lại mỗi {count} phút',
  'Monitoring will stay parked': 'Theo dõi sẽ tạm dừng hẳn',
  'More actions for {name}': 'Thêm hành động cho {name}',
  'Move {phase} command {number} down': 'Chuyển lệnh {number} của {phase} xuống',
  'Move {phase} command {number} up': 'Chuyển lệnh {number} của {phase} lên',
  'Move down': 'Chuyển xuống',
  'Move up': 'Chuyển lên',
  'Need a different limit for one project?': 'Cần giới hạn khác cho một dự án?',
  'New and changed receivers stay Inactive until you test and activate them.':
    'Receiver mới và receiver đã thay đổi ở trạng thái Không hoạt động cho đến khi bạn kiểm tra và kích hoạt.',
  'New events aren’t queued.': 'Sự kiện mới không được xếp hàng.',
  'New events won’t be queued while it is paused.': 'Sự kiện mới sẽ không được xếp hàng khi nó đang tạm dừng.',
  'New preset': 'Preset mới',
  'New runs are unlimited ∞': 'Lượt chạy mới không giới hạn ∞',
  'New task defaults': 'Mặc định cho nhiệm vụ mới',
  'New task skill': 'Skill cho nhiệm vụ mới',
  'New task worktrees branch from this and draft PRs target it. Also settable from the Git view.':
    'Worktree của nhiệm vụ mới tách nhánh từ đây và PR nháp nhắm vào đây. Cũng có thể đặt từ chế độ xem Git.',
  'Next attempt': 'Lần thử tiếp theo',
  'Next retry {time}.': 'Thử lại tiếp theo {time}.',
  'No — served because onni was started here': 'Không — được phục vụ vì onni được khởi động ở đây',
  'No activity in the retained history.': 'Không có hoạt động trong lịch sử được giữ.',
  'No cgroup information available for this process - host totals only.':
    'Không có thông tin cgroup cho tiến trình này - chỉ có tổng của máy chủ.',
  'No commands. This phase completes without running a script.':
    'Không có lệnh. Giai đoạn này hoàn tất mà không chạy script.',
  'No deleted receivers are kept.': 'Không giữ receiver đã xoá nào.',
  'No deliveries match.': 'Không có lượt gửi nào khớp.',
  'No model key — smoke tests run without one; agent steps need one':
    'Không có khoá model — smoke test chạy không cần; các bước agent thì cần',
  'No payload was created for this delivery.': 'Không có payload nào được tạo cho lượt gửi này.',
  'No presets yet.': 'Chưa có preset nào.',
  'No projects or teams match.': 'Không có dự án hay nhóm nào khớp.',
  'No receivers yet': 'Chưa có receiver',
  'No receivers yet.': 'Chưa có receiver.',
  'No secrets stored.': 'Chưa lưu secret nào.',
  'no shortcut': 'không có phím tắt',
  'No subfolders here — pick this folder by typing its path above.':
    'Không có thư mục con ở đây — chọn thư mục này bằng cách nhập đường dẫn ở trên.',
  'No task worktrees on disk.': 'Không có worktree nhiệm vụ nào trên đĩa.',
  'No team skill repository is configured. OnniCode ships none by default — add "skillsRepos" to .ai/onni/config.json to load skills from a repository of your own.':
    'Chưa cấu hình repository skill của nhóm. OnniCode không kèm sẵn cái nào — thêm "skillsRepos" vào .ai/onni/config.json để tải skill từ repository của riêng bạn.',
  'No templates. Add one below, or reset to the built-ins.':
    'Chưa có mẫu. Thêm một mẫu bên dưới, hoặc đặt lại về mẫu có sẵn.',
  'No tracker connected.': 'Chưa kết nối tracker.',
  'No user-scoped MCP servers.': 'Không có MCP server phạm vi người dùng.',
  'No worktrees reclaimed yet. Pending cleanup or retained worktrees may keep usage above the limit.':
    'Chưa thu hồi worktree nào. Worktree đang chờ dọn dẹp hoặc được giữ lại có thể khiến mức dùng vẫn vượt giới hạn.',
  None: 'Không dùng',
  'Not a git repository — tasks run in place, no branching.':
    'Không phải repository git — nhiệm vụ chạy tại chỗ, không tách nhánh.',
  'not added yet': 'chưa được thêm',
  'Not allowed': 'Không được phép',
  'Not available on this server’s platform.': 'Không có trên nền tảng của server này.',
  'Not configured in this checkout': 'Chưa cấu hình trong checkout này',
  'Not connected: {backends}': 'Chưa kết nối: {backends}',
  'not installed': 'chưa cài đặt',
  'Not set up': 'Chưa thiết lập',
  'Nothing is queued, so nothing will be retried until the next event.':
    'Không có gì trong hàng đợi, nên sẽ không thử lại cho đến sự kiện tiếp theo.',
  'nothing on disk is deleted': 'không có gì trên đĩa bị xoá',
  'Nothing to reclaim — all worktrees are within the limit':
    'Không có gì để thu hồi — mọi worktree đều trong giới hạn',
  'Notify when an agent needs you': 'Thông báo khi agent cần bạn',
  Off: 'Tắt',
  'Off on this server.': 'Đã tắt trên server này.',
  'Old and new keys both sign deliveries for 24 hours. Install the new key in your receiver within that time.':
    'Khoá cũ và mới cùng ký lượt gửi trong 24 giờ. Hãy cài khoá mới vào receiver trong thời gian đó.',
  'Old keys stop signing immediately, and deliveries fail until your receiver uses the new key. Also remove old keys from your receiver — onni can’t revoke keys it still accepts.':
    'Khoá cũ ngừng ký ngay lập tức, và việc gửi sẽ thất bại cho đến khi receiver dùng khoá mới. Đồng thời xoá khoá cũ khỏi receiver — onni không thể thu hồi khoá mà nó vẫn chấp nhận.',
  'Older finished worktrees are reclaimed to free disk; their branch is kept so the work stays recoverable. 0 = unlimited. In-review and running tasks are never reclaimed, so the count on disk can exceed this.':
    'Worktree đã xong cũ hơn sẽ được thu hồi để giải phóng đĩa; nhánh của chúng được giữ để công việc vẫn khôi phục được. 0 = không giới hạn. Nhiệm vụ đang đánh giá và đang chạy không bao giờ bị thu hồi, nên số trên đĩa có thể vượt mức này.',
  On: 'Bật',
  'One-click launch (auto-submit)': 'Khởi chạy một bấm (tự gửi)',
  'Only events from now on are sent — nothing from before {action}.':
    'Chỉ những sự kiện từ giờ trở đi được gửi — không có gì từ trước {action}.',
  'onni ({project}): this PR/issue': 'onni ({project}): PR/issue này',
  'onni installs it for this project, points it at your dev server, writes a smoke test and an':
    'onni cài nó cho dự án này, trỏ vào dev server của bạn, viết một smoke test và một',
  'onni is serving this folder because you started it here — starting onni somewhere new never adds it to your project list for you. Adding it keeps it in the sidebar between runs and gives it a registry entry to hold settings like the task cap. Nothing on disk changes either way.':
    'onni đang phục vụ thư mục này vì bạn khởi động nó ở đây — khởi động onni ở nơi khác sẽ không tự thêm vào danh sách dự án. Thêm vào giúp nó luôn có trên thanh bên giữa các lần chạy và có mục trong sổ đăng ký để lưu cài đặt như giới hạn nhiệm vụ. Không có gì trên đĩa thay đổi dù chọn cách nào.',
  'onni is serving this project — stop it and use `onni projects remove`':
    'onni đang phục vụ dự án này — hãy dừng nó và dùng `onni projects remove`',
  'onni is serving this project — stop onni and run `onni projects remove` to drop it.':
    'onni đang phục vụ dự án này — dừng onni và chạy `onni projects remove` để bỏ nó.',
  'onni: this PR/issue': 'onni: PR/issue này',
  'Open the draft PR': 'Mở PR nháp',
  'Open the setup task': 'Mở nhiệm vụ thiết lập',
  'Open webhook settings': 'Mở cài đặt webhook',
  'Open with': 'Mở bằng',
  'opened locally': 'được mở cục bộ',
  'Opening the project folder in {app}': 'Đang mở thư mục dự án trong {app}',
  'Opening…': 'Đang mở…',
  'Opens the new-task composer with this preset switched on. None keeps manager–worker off until you turn it on for a task.':
    'Mở khung soạn nhiệm vụ mới với preset này được bật. Chọn Không dùng để giữ chế độ quản lý–worker tắt cho đến khi bạn bật cho một nhiệm vụ.',
  'Optional — show one task’s deliveries': 'Tuỳ chọn — hiển thị lượt gửi của một nhiệm vụ',
  'Organisation skills repositories': 'Repository skill của tổ chức',
  'Orphan {id}': 'Worktree mồ côi {id}',
  'Orphan cleanup requested. Review its progress below.':
    'Đã yêu cầu dọn worktree mồ côi. Xem tiến trình bên dưới.',
  'orphan worktree': 'worktree mồ côi',
  'Orphan worktree': 'Worktree mồ côi',
  'Orphan worktree {id}': 'Worktree mồ côi {id}',
  'Park until resumed': 'Tạm dừng cho đến khi được tiếp tục',
  'Park uses no model turns. Re-check sends the same agent a follow-up on this cadence until work completes or the 40-wakeup safety cap is reached.':
    'Tạm dừng không dùng lượt model nào. Kiểm tra lại sẽ gửi agent đó một tin nhắc theo nhịp này cho đến khi xong việc hoặc chạm giới hạn an toàn 40 lần đánh thức.',
  'Pause {name}?': 'Tạm dừng {name}?',
  'Pause receiver': 'Tạm dừng receiver',
  'Paused scripts wait for an explicit recovery choice.':
    'Script bị tạm dừng chờ bạn chọn cách khôi phục rõ ràng.',
  'Paused when this project was removed from the workspace.':
    'Đã tạm dừng khi dự án này bị xoá khỏi workspace.',
  'Paused.': 'Đã tạm dừng.',
  'Payload availability is unknown.': 'Không rõ tình trạng payload.',
  'Payload kept until': 'Payload được giữ đến',
  'Per-task memory limit': 'Giới hạn bộ nhớ mỗi nhiệm vụ',
  'Per-task memory limit in MiB': 'Giới hạn bộ nhớ mỗi nhiệm vụ (MiB)',
  'pick at least one audience': 'chọn ít nhất một đối tượng nhận',
  'Plain HTTP is not encrypted. Use HTTPS outside a trusted local network.':
    'HTTP thường không được mã hoá. Dùng HTTPS ngoài mạng nội bộ tin cậy.',
  'prefills the form — nothing starts by itself': 'điền sẵn biểu mẫu — không có gì tự khởi chạy',
  'Preselected for new tasks in THIS repo, and used by the chain planner. Each task can still pick another agent or account. The account is stored on this machine only — it is never committed, so a teammate keeps their own.':
    'Được chọn sẵn cho nhiệm vụ mới trong repo NÀY, và dùng cho chain planner. Mỗi nhiệm vụ vẫn có thể chọn agent hoặc tài khoản khác. Tài khoản chỉ lưu trên máy này — không bao giờ được commit, nên đồng nghiệp giữ tài khoản riêng.',
  'Preselected for new tasks in THIS repo, and used by the chain planner. Each task can still pick another runner.':
    'Được chọn sẵn cho nhiệm vụ mới trong repo NÀY, và dùng cho chain planner. Mỗi nhiệm vụ vẫn có thể chọn runner khác.',
  'Preselected in the composer when nothing is picked: one for a new task, one for a read-only question (the Ask chip). A trunk-based project picks Ask on its own when the message ends with a question mark.':
    'Được chọn sẵn trong khung soạn khi chưa chọn gì: một cho nhiệm vụ mới, một cho câu hỏi chỉ đọc (chip Ask). Dự án trunk-based tự chọn Ask khi tin nhắn kết thúc bằng dấu hỏi.',
  'Preset name — e.g. Claude manages, Codex and OpenCode work':
    'Tên preset — ví dụ: Claude quản lý, Codex và OpenCode làm việc',
  Presets: 'Preset',
  'Press keys… (esc cancels, ⌫ removes)': 'Nhấn phím… (esc huỷ, ⌫ xoá)',
  Preview: 'Xem trước',
  'Preview {phase} command {number}': 'Xem trước lệnh {number} của {phase}',
  'Preview context': 'Ngữ cảnh xem trước',
  'Preview does not execute commands or expand shell expressions.':
    'Xem trước không chạy lệnh hay mở rộng biểu thức shell.',
  'Preview failed': 'Xem trước thất bại',
  'Preview JSON · {profile}': 'Xem trước JSON · {profile}',
  'Previewing…': 'Đang xem trước…',
  'Private network': 'Mạng riêng',
  'Project credentials removed': 'Đã xoá thông tin đăng nhập dự án',
  'Project folder': 'Thư mục dự án',
  'Project folder copied': 'Đã sao chép thư mục dự án',
  'Prompt templates did not load': 'Không tải được mẫu prompt',
  'Prompt templates saved': 'Đã lưu mẫu prompt',
  'Prompts and transcripts are never sent. Redaction of other text is best effort.':
    'Prompt và bản ghi hội thoại không bao giờ được gửi. Việc ẩn thông tin trong văn bản khác chỉ là nỗ lực tối đa.',
  'Provider is already connected.': 'Nhà cung cấp đã được kết nối.',
  'Provider status could not be loaded': 'Không tải được trạng thái nhà cung cấp',
  Providers: 'Nhà cung cấp',
  'Re-check on an interval': 'Kiểm tra lại theo chu kỳ',
  'Read by every agent step of every new task in this project, whichever runner executes it. Added after the global instructions (General settings → Instructions) and takes precedence over them.':
    'Được mọi bước agent của mọi nhiệm vụ mới trong dự án này đọc, bất kể runner nào thực thi. Được thêm sau hướng dẫn toàn cục (Cài đặt chung → Hướng dẫn) và có hiệu lực cao hơn.',
  "Read by every agent step of every new task, in every project. A project's own system prompt is added after it and takes precedence where they conflict.":
    'Được mọi bước agent của mọi nhiệm vụ mới đọc, trong mọi dự án. System prompt riêng của dự án được thêm sau và có hiệu lực cao hơn khi xung đột.',
  'Read-only: agent config is edited from the machine that owns the checkout (this cockpit runs in hosted mode). You can still see every file and which one wins.':
    'Chỉ đọc: cấu hình agent được sửa từ máy sở hữu checkout (cockpit này chạy ở chế độ hosted). Bạn vẫn xem được mọi tệp và tệp nào đang thắng.',
  'Ready for review — {next}': 'Sẵn sàng đánh giá — {next}',
  Reason: 'Lý do',
  Receiver: 'Receiver',
  'Receiver history': 'Lịch sử receiver',
  'Receiver URL': 'URL receiver',
  Receivers: 'Receiver',
  'Reclaim now': 'Thu hồi ngay',
  'Reclaim old worktrees?': 'Thu hồi worktree cũ?',
  'Reclaimed {count} worktree (branch kept)': 'Đã thu hồi {count} worktree (giữ nhánh)',
  'Reclaimed {count} worktrees (branch kept)': 'Đã thu hồi {count} worktree (giữ nhánh)',
  "Refresh a task's short title through the namer model as the run progresses. A manual rename always wins and stops updates for that task.":
    'Làm mới tiêu đề ngắn của nhiệm vụ qua model đặt tên khi lượt chạy tiến triển. Đổi tên thủ công luôn thắng và dừng cập nhật cho nhiệm vụ đó.',
  'Refresh latest settings': 'Làm mới cài đặt mới nhất',
  'Reload from disk': 'Tải lại từ đĩa',
  'Reload saved scripts': 'Tải lại script đã lưu',
  Remove: 'Xoá',
  'Remove {name} from the workspace — unregisters it, no files are deleted':
    'Xoá {name} khỏi workspace — chỉ bỏ đăng ký, không xoá tệp nào',
  'Remove {name} from the workspace?': 'Xoá {name} khỏi workspace?',
  'Remove {phase} command {number}': 'Xoá lệnh {number} của {phase}',
  'Remove {repo}': 'Xoá {repo}',
  'Remove from list': 'Xoá khỏi danh sách',
  'Remove from workspace': 'Xoá khỏi workspace',
  'Remove orphan worktree': 'Xoá worktree mồ côi',
  'Remove project credentials': 'Xoá thông tin đăng nhập dự án',
  'Remove the shortcut for {command}': 'Xoá phím tắt của {command}',
  Replace: 'Thay thế',
  Replay: 'Phát lại',
  'Replay this event?': 'Phát lại sự kiện này?',
  'Replay unavailable: {reason}': 'Không phát lại được: {reason}',
  'Required checks': 'Kiểm tra bắt buộc',
  'Required checks saved': 'Đã lưu kiểm tra bắt buộc',
  'Reset {command} to {shortcut}': 'Đặt lại {command} về {shortcut}',
  'Reset all': 'Đặt lại tất cả',
  'Reset to default': 'Đặt lại về mặc định',
  'Resource settings did not load': 'Không tải được cài đặt tài nguyên',
  Result: 'Kết quả',
  Resume: 'Tiếp tục',
  resuming: 'đang tiếp tục',
  'Retries per dispatched order': 'Số lần thử lại cho mỗi lệnh được giao',
  'Retries until': 'Thử lại đến',
  'Retry in {count}s': 'Thử lại sau {count} giây',
  'Retry now': 'Thử lại ngay',
  'Retry this delivery now?': 'Thử lại lượt gửi này ngay?',
  'Return to {task} and Retry': 'Quay lại {task} và Thử lại',
  'Reusable snippets you can insert into a prompt — the new-task composer, the GitHub hand-over, and the Inbox\'s “Add instructions” box all offer this list. Assign a template to a skill and it fills the prompt in for you when you pick that skill, as long as you have not typed anything yet.':
    'Các đoạn tái sử dụng có thể chèn vào prompt — khung soạn nhiệm vụ mới, luồng bàn giao GitHub và ô "Add instructions" của Hộp thư đều dùng danh sách này. Gán một mẫu cho skill thì mẫu sẽ tự điền prompt khi bạn chọn skill đó, miễn là bạn chưa nhập gì.',
  Revert: 'Hoàn tác',
  'Review — nothing lands by itself (default)': 'Đánh giá — không gì tự merge (mặc định)',
  'Review changes': 'Xem lại thay đổi',
  'Review changes before finishing': 'Xem lại thay đổi trước khi hoàn tất',
  'Review gate off': 'Đã tắt cổng đánh giá',
  'Review gate on': 'Đã bật cổng đánh giá',
  'revision {revision}': 'bản sửa đổi {revision}',
  'Revoke old keys': 'Thu hồi khoá cũ',
  'Revoke old signing keys now?': 'Thu hồi khoá ký cũ ngay?',
  'Rotate key': 'Xoay khoá',
  'Rotate signing key?': 'Xoay khoá ký?',
  'Run a task’s commands from the keyboard while the task is open. {palette} lists them all; press {setShortcut} on a row there to set its shortcut. {modifier} chords also work while you type.':
    'Chạy lệnh của nhiệm vụ bằng bàn phím khi nhiệm vụ đang mở. {palette} liệt kê tất cả; nhấn {setShortcut} trên một dòng để đặt phím tắt. Tổ hợp {modifier} cũng dùng được khi bạn đang gõ.',
  'Run after a worktree is created and before its agent starts, including recreation after reclamation.':
    'Chạy sau khi worktree được tạo và trước khi agent khởi động, kể cả khi tạo lại sau thu hồi.',
  'Run limits saved': 'Đã lưu giới hạn lượt chạy',
  'Run while the worktree files still exist, before removal or reclamation. Failure retains the directory for recovery.':
    'Chạy khi các tệp trong worktree vẫn còn, trước khi xoá hoặc thu hồi. Nếu thất bại, thư mục được giữ lại để khôi phục.',
  'Runtime: noninteractive Bash, in the isolated worktree directory. Bash must be installed on the host. Commands run in order; the default timeout is 30 minutes.':
    'Môi trường chạy: Bash không tương tác, trong thư mục worktree riêng. Bash phải được cài trên máy chủ. Các lệnh chạy theo thứ tự; thời gian chờ mặc định là 30 phút.',
  'Save changes?': 'Lưu thay đổi?',
  'Save limits': 'Lưu giới hạn',
  'Save preset': 'Lưu preset',
  'Save project credentials': 'Lưu thông tin đăng nhập dự án',
  'Save receiver': 'Lưu receiver',
  'Save scripts': 'Lưu script',
  'Save secret': 'Lưu secret',
  'Save your signing key': 'Lưu khoá ký của bạn',
  Saved: 'Đã lưu',
  "Saved in a private .env file for this project, without encryption. Use read-only access limited to this project's data. Saving replaces this project's connection and requires selecting its scope again.":
    'Được lưu trong tệp .env riêng của dự án này, không mã hoá. Hãy dùng quyền chỉ đọc giới hạn ở dữ liệu của dự án này. Lưu sẽ thay kết nối hiện tại của dự án và phải chọn lại phạm vi.',
  'Saved. Retry uses these commands. Saving does not restart paused scripts.':
    'Đã lưu. Thử lại sẽ dùng các lệnh này. Lưu không khởi động lại script bị tạm dừng.',
  'Saving…': 'Đang lưu…',
  'Scripts apply only to this project. Saving commands opts in to running them as the Onni host user, with that user’s local privileges.':
    'Script chỉ áp dụng cho dự án này. Lưu lệnh nghĩa là bạn đồng ý chạy chúng dưới người dùng Onni host, với quyền cục bộ của người dùng đó.',
  'Search {scopes}': 'Tìm {scopes}',
  'Search by name…': 'Tìm theo tên…',
  seeded: 'đã tạo sẵn',
  'Select a config file to view or edit it.': 'Chọn một tệp cấu hình để xem hoặc sửa.',
  'Selected worktree preview': 'Xem trước worktree đã chọn',
  'Send a passing test of these settings before activating.':
    'Gửi một bài kiểm tra đạt cho các cài đặt này trước khi kích hoạt.',
  'Send task updates to your own endpoint when a task needs you, is ready for review or finishes.':
    'Gửi cập nhật nhiệm vụ đến endpoint của bạn khi nhiệm vụ cần bạn, sẵn sàng đánh giá hoặc hoàn tất.',
  'Send test': 'Gửi thử',
  'Sends the same event again with a new 72-hour retry window. Your receiver or channel may show it twice.':
    'Gửi lại đúng sự kiện đó với cửa sổ thử lại 72 giờ mới. Receiver hoặc kênh của bạn có thể hiển thị hai lần.',
  'Sends the same message again now. Rate limits and freshness checks still apply.':
    'Gửi lại đúng thông điệp đó ngay. Giới hạn tần suất và kiểm tra độ mới vẫn áp dụng.',
  'Set a shortcut for {command}': 'Đặt phím tắt cho {command}',
  'Set stable composer defaults across projects. Explicit choices and run-shape constraints still win.':
    'Đặt mặc định ổn định cho khung soạn trên mọi dự án. Lựa chọn rõ ràng và ràng buộc của lượt chạy vẫn được ưu tiên.',
  'Set up again': 'Thiết lập lại',
  'Set up e2e': 'Thiết lập e2e',
  'Setting up': 'Đang thiết lập',
  'Setting up — onni is installing and configuring e2e in its own worktree.':
    'Đang thiết lập — onni đang cài và cấu hình e2e trong worktree riêng của nó.',
  'Settings → Resources → Run limits': 'Cài đặt → Tài nguyên → Giới hạn lượt chạy',
  'Settings closed; saving cancelled.': 'Đã đóng cài đặt; huỷ lưu.',
  'Settings could not be loaded': 'Không tải được cài đặt',
  'Setup finished — {next}': 'Thiết lập xong — {next}',
  'Setup finished.': 'Thiết lập xong.',
  'Setup in progress…': 'Đang thiết lập…',
  'Shell commands, one per line, run in the checkout before every auto-land (e.g. npm test). A failure goes back to the agent with its output.':
    'Các lệnh shell, mỗi dòng một lệnh, chạy trong checkout trước mỗi lần tự động merge (ví dụ npm test). Nếu thất bại, kết quả được gửi lại agent.',
  'Show deleted receivers ({count})': 'Hiện receiver đã xoá ({count})',
  'Showing {range} of {total}': 'Đang hiện {range} trong {total}',
  'Showing the latest 100 actions.': 'Đang hiện 100 hành động mới nhất.',
  Size: 'Kích thước',
  'size unavailable': 'không rõ kích thước',
  'Skill settings did not load': 'Không tải được cài đặt skill',
  'Skills from the shared team repositories. Turn off for a project whose skills live in the repo itself. Project-wide instructions for every task are under Instructions.':
    'Skill từ các repository chung của nhóm. Tắt đi nếu dự án có skill nằm ngay trong repo. Hướng dẫn cho mọi nhiệm vụ của dự án nằm trong Hướng dẫn.',
  'Skip all Antigravity confirmations?': 'Bỏ qua mọi xác nhận của Antigravity?',
  'Skip confirmations': 'Bỏ qua xác nhận',
  'Skipped if you reply, or the task stops waiting or leaves review, before the delay ends.':
    'Sẽ bỏ qua nếu bạn trả lời, hoặc nhiệm vụ thôi chờ hoặc rời khỏi đánh giá, trước khi hết thời gian trễ.',
  'skips the hook.': 'bỏ qua hook.',
  'Source-dependent — skills on, workflows off': 'Tuỳ nguồn — bật skill, tắt workflow',
  Standard: 'Tiêu chuẩn',
  'Standard — task titles, questions and errors': 'Tiêu chuẩn — tiêu đề nhiệm vụ, câu hỏi và lỗi',
  'Start onni with': 'Khởi động onni bằng',
  'Status unavailable — could not load server health.':
    'Không có trạng thái — không tải được tình trạng server.',
  'Status unavailable — open Webhooks for details.':
    'Không có trạng thái — mở Webhooks để xem chi tiết.',
  stored: 'đã lưu',
  'stored — leave empty to keep it': 'đã lưu — để trống để giữ nguyên',
  'Stored encrypted as a project secret for check steps only — never handed to an agent session.':
    'Được lưu mã hoá như secret của dự án, chỉ cho các bước kiểm tra — không bao giờ trao cho phiên agent.',
  'Stored project secrets': 'Secret của dự án đã lưu',
  'Stored workspace secrets': 'Secret của workspace đã lưu',
  'Parallel runs': 'Chạy song song',
  'How many tasks and monitoring sessions run at the same time.': 'Số nhiệm vụ và phiên theo dõi chạy cùng lúc.',
  'Waiting sessions and memory': 'Phiên chờ và bộ nhớ',
  'When an idle session closes, and how much memory one task may use.': 'Khi nào phiên nhàn rỗi đóng, và một nhiệm vụ được dùng bao nhiêu bộ nhớ.',
  'Monitoring and auto-resume': 'Theo dõi và tự động tiếp tục',
  'How waiting tasks are re-checked and continued after a usage limit.': 'Cách kiểm tra lại nhiệm vụ đang chờ và tiếp tục sau khi hết giới hạn sử dụng.',
  'New tasks': 'Nhiệm vụ mới',
  'Defaults the composer starts with.': 'Giá trị mặc định của ô soạn nhiệm vụ.',
  'Use as the default agent for new projects': 'Đặt làm agent mặc định cho dự án mới',
  'Hide subtasks': 'Ẩn task con',
  'Show subtasks': 'Hiện task con',
  'Hand complex work to workers': 'Giao việc phức tạp cho worker',
  'A manager may do a small job itself (about 2 files, 40 lines). Bigger or multi-part work it must hand to workers or split with them, and onni warns it when it does a big job alone. Off restores the old behaviour.':
    'Manager được tự làm việc nhỏ (khoảng 2 file, 40 dòng). Việc lớn hoặc nhiều phần thì phải giao cho worker hoặc chia việc cùng họ, và onni sẽ cảnh báo khi manager tự làm trọn việc lớn. Tắt để quay về hành vi cũ.',
  'Search…': 'Tìm kiếm…',
  'Nothing found': 'Không tìm thấy',
  'Full manager access': 'Full quyền manager',
  'Give the manager full access?': 'Cấp full quyền cho manager?',
  'Give managers full access?': 'Cấp full quyền cho các manager?',
  'Allow merging': 'Cho phép merge',
  'On — managers may merge': 'Bật — manager được phép merge',
  'full access': 'full quyền',
  'This manager may merge (Full manager access)': 'Manager này được phép merge (Full quyền manager)',
  'Lets the manager merge worker branches into its own branch and into the local base branch. Never pushes.': 'Cho phép manager merge nhánh của worker vào nhánh của nó và vào nhánh base cục bộ. Không bao giờ push.',
  'The manager will be allowed to merge worker branches into its own branch, and its branch into the base branch of this project (locally; it never pushes). Check the result before you push.': 'Manager sẽ được merge nhánh của worker vào nhánh của nó, và nhánh của nó vào nhánh base của dự án này (cục bộ; không bao giờ push). Hãy kiểm tra kết quả trước khi bạn push.',
  'The highest permission: the manager may merge worker branches into its own branch and its branch into the local base branch. Off by default; it never pushes. A single task can override this in its Task settings.': 'Quyền cao nhất: manager được merge nhánh worker vào nhánh của nó và nhánh của nó vào nhánh base cục bộ. Mặc định tắt; không bao giờ push. Từng task có thể ghi đè trong Cài đặt nhiệm vụ.',
  'Every new manager–worker task will be allowed to merge worker branches into its own branch, and its branch into the base branch of its project (locally; it never pushes). You can still turn it off per task.': 'Mọi task quản lý–worker mới sẽ được merge nhánh worker vào nhánh của nó, và nhánh của nó vào nhánh base của dự án (cục bộ; không bao giờ push). Bạn vẫn có thể tắt cho từng task.',
  '5-hour window': 'Cửa sổ 5 giờ',
  'Weekly window': 'Cửa sổ 7 ngày',
  'Primary window': 'Cửa sổ chính',
  'Secondary window': 'Cửa sổ phụ',
  'Other window': 'Cửa sổ khác',
  'Usage limits': 'Hạn mức sử dụng',
  'Usage tracking is not supported yet': 'Chưa hỗ trợ theo dõi hạn mức',
  'Usage is unavailable right now. Try again in a moment.': 'Hiện chưa lấy được hạn mức. Thử lại sau ít phút.',
  'No usage data yet — it appears after this agent runs a task.': 'Chưa có dữ liệu — số liệu xuất hiện sau khi agent này chạy một nhiệm vụ.',
  'No usage data yet.': 'Chưa có dữ liệu.',
  'blocked': 'bị chặn',
  'Resets in {time}': 'Reset sau {time}',
  'updated {time} ago': 'cập nhật {time} trước',
  'These numbers are old — they refresh when the agent next runs.': 'Số liệu đã cũ — sẽ cập nhật khi agent chạy lần tới.',
  'Live read failed; showing the last known numbers.': 'Không đọc trực tiếp được; đang hiện số liệu gần nhất.',
  'Refresh': 'Làm mới',
  'OpenCode only reports local token and cost totals, not the provider limit.': 'OpenCode chỉ báo tổng token và chi phí cục bộ, không báo hạn mức của nhà cung cấp.',
  'The Antigravity CLI shows models but no quota or reset time.': 'Antigravity CLI chỉ liệt kê model, không có hạn mức hay giờ reset.',
  'The Cursor CLI has no usage or limit command.': 'Cursor CLI không có lệnh xem hạn mức.',
  'The Copilot CLI has no usage or limit command.': 'Copilot CLI không có lệnh xem hạn mức.',
  'The Cline CLI has no usage or limit command.': 'Cline CLI không có lệnh xem hạn mức.',
  'The Junie CLI has no usage or limit command.': 'Junie CLI không có lệnh xem hạn mức.',
  'pi has no usage or limit command.': 'pi không có lệnh xem hạn mức.',
  'Drives': 'Ổ đĩa',
  'Delete project data': 'Xoá dữ liệu dự án',
  'Deletes every task of this project with its chat, notes, worktree and branch. Running tasks are kept. The project folder, its files and its git history are not touched.': 'Xoá mọi nhiệm vụ của dự án này cùng đoạn chat, ghi chú, worktree và nhánh của chúng. Nhiệm vụ đang chạy được giữ lại. Thư mục dự án, các tệp và lịch sử git không bị đụng tới.',
  'Delete all tasks and chats…': 'Xoá mọi nhiệm vụ và đoạn chat…',
  'Delete all tasks and chats of {name}?': 'Xoá mọi nhiệm vụ và đoạn chat của {name}?',
  'This cannot be undone. Every finished, failed or cancelled task of this project is deleted with its chat, notes, worktree and branch. Tasks that are still running are kept.': 'Không thể hoàn tác. Mọi nhiệm vụ đã xong, lỗi hoặc đã huỷ của dự án này sẽ bị xoá cùng đoạn chat, ghi chú, worktree và nhánh. Nhiệm vụ đang chạy được giữ lại.',
  'Type the project name to confirm:': 'Gõ tên dự án để xác nhận:',
  'Project name': 'Tên dự án',
  'Deleting…': 'Đang xoá…',
  'Delete everything': 'Xoá tất cả',
  'Deleted {count} tasks and their chats': 'Đã xoá {count} nhiệm vụ cùng đoạn chat',
  'Deleted {count} tasks; kept {skipped} that are still running': 'Đã xoá {count} nhiệm vụ; giữ lại {skipped} nhiệm vụ đang chạy',
  'type the project name to confirm': 'hãy gõ đúng tên dự án để xác nhận',
  'Subtasks per tree': 'Lượt gọi worker mỗi cây',
  'Unlimited worker calls': 'Không giới hạn lượt gọi worker',
  'Total worker calls in one tree (not the number running at once). Applies when the task was not started with its own subtask limit.':
    'Tổng số lượt gọi worker trong một cây nhiệm vụ (không phải số worker chạy song song). Áp dụng khi nhiệm vụ không có giới hạn riêng.',
  Swap: 'Bộ nhớ hoán đổi',
  'Synthetic JSON sample': 'Mẫu JSON tổng hợp',
  'System prompt': 'System prompt',
  'System prompt cleared': 'Đã xoá system prompt',
  'System prompt saved': 'Đã lưu system prompt',
  'task {id}': 'nhiệm vụ {id}',
  'task at once (same page).': 'nhiệm vụ cùng lúc (cùng trang).',
  'Task ID': 'ID nhiệm vụ',
  'Task settings did not load': 'Không tải được cài đặt nhiệm vụ',
  'Task shortcuts': 'Phím tắt nhiệm vụ',
  'Task updates sent to your own endpoint.':
    'Cập nhật nhiệm vụ được gửi đến endpoint của bạn.',
  'Task worktrees currently materialized on disk': 'Worktree nhiệm vụ hiện có trên đĩa',
  'Task worktrees currently on disk. Delete one to reclaim its space now, or reclaim everything past the keep-limit at once. Reclamation keeps branches; deleting a worktree also deletes its managed branch.':
    'Worktree nhiệm vụ hiện có trên đĩa. Xoá một cái để lấy lại dung lượng ngay, hoặc thu hồi mọi thứ vượt giới hạn giữ lại cùng lúc. Thu hồi giữ nhánh; xoá worktree cũng xoá nhánh được quản lý của nó.',
  'Tasks already started under another account can’t be resumed here — their sessions live in that account’s folder.':
    'Các nhiệm vụ đã bắt đầu dưới tài khoản khác không thể tiếp tục ở đây — phiên của chúng nằm trong thư mục của tài khoản đó.',
  'tasks at once (same page).': 'nhiệm vụ cùng lúc (cùng trang).',
  'Tasks stopped by a usage limit will resume themselves':
    'Nhiệm vụ bị dừng do giới hạn sử dụng sẽ tự tiếp tục',
  'Tasks stopped by a usage limit will stay failed':
    'Nhiệm vụ bị dừng do giới hạn sử dụng sẽ vẫn ở trạng thái thất bại',
  'Team skill repositories': 'Repository skill của nhóm',
  'Test after repair': 'Kiểm tra sau khi sửa',
  'Test and recover': 'Kiểm tra và khôi phục',
  'Test and recover?': 'Kiểm tra và khôi phục?',
  'Test frameworks': 'Framework kiểm thử',
  'Tests will contact this private address. Hosted onni sends to public HTTPS receivers only.':
    'Bài kiểm tra sẽ gọi địa chỉ riêng này. onni hosted chỉ gửi đến receiver HTTPS công khai.',
  'The config folder this account uses. It does not have to exist yet — Connect signs in and the CLI creates it.':
    'Thư mục cấu hình tài khoản này dùng. Chưa cần tồn tại — Kết nối sẽ đăng nhập và CLI tạo nó.',
  'The default for new runs. Capped applies only the numbers you enter (blank = no limit on that axis); Unlimited applies none. Each run keeps the values it started with, and a task tree shares its root\'s ceilings.':
    'Mặc định cho lượt chạy mới. Có giới hạn chỉ áp dụng các con số bạn nhập (trống = không giới hạn ở trục đó); Không giới hạn thì không áp dụng gì. Mỗi lượt chạy giữ giá trị lúc bắt đầu, và cây nhiệm vụ dùng chung mức trần của gốc.',
  'The file changed on disk since you opened it.':
    'Tệp đã thay đổi trên đĩa kể từ khi bạn mở.',
  'The last setup failed — open the task to see why, then try again.':
    'Lần thiết lập trước thất bại — mở nhiệm vụ để xem lý do, rồi thử lại.',
  'The last setup was cancelled.': 'Lần thiết lập trước đã bị huỷ.',
  'The last test failed with a temporary error, so delivery may still fail.':
    'Lần kiểm tra trước thất bại do lỗi tạm thời, nên việc gửi có thể vẫn thất bại.',
  'The model preselected in the composer for each runner. Auto lets the runner decide per task.':
    'Model được chọn sẵn trong khung soạn cho từng runner. Tự động để runner quyết định theo từng nhiệm vụ.',
  'the payload or receiver is no longer eligible.':
    'payload hoặc receiver không còn đủ điều kiện.',
  'The preset is removed. Tasks already started with it keep their roster.':
    'Preset đã bị xoá. Nhiệm vụ đã bắt đầu với nó vẫn giữ roster.',
  'The previous signing key stops working {time}.': 'Khoá ký trước sẽ ngừng hoạt động {time}.',
  'The registry entry for this checkout — re-probed every time the project list is read.':
    'Mục sổ đăng ký cho checkout này — được dò lại mỗi lần đọc danh sách dự án.',
  'The repo checkout, one write task at a time': 'Checkout của repo, mỗi lần một nhiệm vụ ghi',
  "The server refused this origin's host topic, so live values are polled from the authenticated route instead.":
    'Server từ chối host topic của origin này, nên giá trị trực tiếp được lấy định kỳ từ route đã xác thực.',
  'the setup task’s branch': 'nhánh của nhiệm vụ thiết lập',
  'The worker list steers orchestration: the server refuses a dispatch to any agent outside it. It is not a security boundary — an agent can still run a CLI or call the HTTP API directly, and a top-level task started that way is not bound to a roster.':
    'Danh sách worker định hướng việc điều phối: server từ chối giao việc cho bất kỳ agent nào ngoài danh sách. Đây không phải ranh giới bảo mật — agent vẫn có thể chạy CLI hoặc gọi thẳng HTTP API, và nhiệm vụ cấp cao nhất khởi động theo cách đó không bị ràng buộc bởi roster.',
  'These stay on whichever mode you choose: they stop a night-long task from hanging or fanning out.':
    'Những mục này luôn bật ở mọi chế độ bạn chọn: chúng ngăn nhiệm vụ chạy qua đêm bị treo hoặc phân nhánh quá mức.',
  'These workers may run {workers} at once; the workspace runs {tasks} tasks in parallel.':
    'Các worker này có thể chạy {workers} cùng lúc; workspace chạy {tasks} nhiệm vụ song song.',
  'This browser does not support notifications, so the toggle is unavailable here.':
    'Trình duyệt này không hỗ trợ thông báo, nên nút bật/tắt không dùng được ở đây.',
  "This browser is blocking notifications for the cockpit. The preference is saved, but nothing will be delivered here until you allow notifications in the browser's site settings.":
    'Trình duyệt này đang chặn thông báo cho cockpit. Tuỳ chọn đã được lưu, nhưng sẽ không có gì được gửi ở đây cho đến khi bạn cho phép thông báo trong cài đặt trang của trình duyệt.',
  'This only unregisters the project —': 'Thao tác này chỉ bỏ đăng ký dự án —',
  'This receiver changed in the meantime, so nothing was applied. Review its latest state and confirm again.':
    'Receiver đã thay đổi trong lúc này, nên không có gì được áp dụng. Xem trạng thái mới nhất và xác nhận lại.',
  'This receiver link is invalid.': 'Liên kết receiver này không hợp lệ.',
  'This receiver no longer exists. Close this dialog to return to the list.':
    'Receiver này không còn tồn tại. Đóng hộp thoại này để quay lại danh sách.',
  'This receiver’s history is unavailable or no longer kept.':
    'Lịch sử của receiver này không có hoặc không còn được giữ.',
  'This receiver’s settings are unavailable — it may have been deleted.':
    'Cài đặt của receiver này không có — có thể nó đã bị xoá.',
  'This removes the worktree directory and its branch — the local-only work is not recoverable afterwards. Configured cleanup scripts run first; failures retain the directory for your recovery choice.':
    'Thao tác này xoá thư mục worktree và nhánh của nó — công việc chỉ có cục bộ sẽ không khôi phục được sau đó. Script dọn dẹp đã cấu hình chạy trước; nếu thất bại, thư mục được giữ để bạn chọn cách khôi phục.',
  "This scope needs reconnection with this project's credentials. Configure a connection, then browse and select its scope again.":
    'Phạm vi này cần kết nối lại bằng thông tin đăng nhập của dự án. Hãy cấu hình kết nối, rồi duyệt và chọn lại phạm vi.',
  'this template': 'mẫu này',
  'Timeout in seconds (1–86,400; blank uses 1,800)':
    'Thời gian chờ tính bằng giây (1–86.400; trống thì dùng 1.800)',
  'Times in {zone}.': 'Thời gian theo {zone}.',
  'Tools onni can set up in this project for you — each one as a task you review and merge.':
    'Các công cụ onni có thể thiết lập trong dự án này cho bạn — mỗi công cụ là một nhiệm vụ để bạn đánh giá và merge.',
  'Tracker disconnected': 'Đã ngắt kết nối tracker',
  'Trunk-based — work in the checkout, land checked changes on the base branch':
    'Trunk-based — làm việc trong checkout, merge các thay đổi đã kiểm tra vào nhánh nền',
  'Trunk-based defaults applied': 'Đã áp dụng mặc định trunk-based',
  'Trunk-based: tasks work directly in the checkout one at a time, and changes that pass the required checks land on the base branch without a PR. Read-only questions run beside them. Every setting below stays adjustable.':
    'Trunk-based: nhiệm vụ làm việc trực tiếp trong checkout, lần lượt từng cái, và các thay đổi vượt qua kiểm tra bắt buộc được merge vào nhánh nền mà không cần PR. Câu hỏi chỉ đọc chạy song song. Mọi cài đặt bên dưới đều có thể chỉnh.',
  'Unanswered-wait expiry': 'Thời hạn chờ không phản hồi',
  'Unregisters this project so it leaves the sidebar and the project list. Nothing on disk is deleted — the folder, its git history and its task history all stay, and adding it back later finds everything intact.':
    'Bỏ đăng ký dự án này để nó rời thanh bên và danh sách dự án. Không có gì trên đĩa bị xoá — thư mục, lịch sử git và lịch sử nhiệm vụ đều còn, và khi thêm lại sau này mọi thứ vẫn nguyên vẹn.',
  'Unsaved changes': 'Thay đổi chưa lưu',
  'updated {seconds} s ago': 'cập nhật {seconds} giây trước',
  URL: 'URL',
  'Use {name}': 'Dùng {name}',
  'Use a worktree by default': 'Mặc định dùng worktree',
  'Use this after completing the provider sign-in flow. onni cannot validate the credential without a task/model request; it will verify it on the next task.':
    'Dùng mục này sau khi hoàn tất đăng nhập với nhà cung cấp. onni không thể xác thực thông tin đăng nhập nếu không có yêu cầu nhiệm vụ/model; nó sẽ kiểm tra ở nhiệm vụ tiếp theo.',
  'User & local scopes': 'Phạm vi người dùng & cục bộ',
  Value: 'Giá trị',
  'Values are shell-escaped; do not wrap variable tokens in quotes. Use':
    'Giá trị được escape cho shell; đừng bọc token biến trong dấu nháy. Dùng',
  Variables: 'Biến',
  'Verification failed. Check again when the provider is available.':
    'Xác thực thất bại. Kiểm tra lại khi nhà cung cấp sẵn sàng.',
  'via {source}': 'qua {source}',
  'View activity': 'Xem hoạt động',
  'View its history': 'Xem lịch sử',
  'Waiting and review delay': 'Độ trễ chờ và đánh giá',
  'Waiting-session idle timeout': 'Thời gian nhàn rỗi của phiên chờ',
  'waiting…': 'đang chờ…',
  'Wake interval in minutes': 'Khoảng đánh thức (phút)',
  'Webhook delivery needs attention. Open Webhooks for details.':
    'Việc gửi webhook cần xử lý. Mở Webhooks để xem chi tiết.',
  'Webhook state is unavailable. Removal will report whether receivers could be paused.':
    'Không có trạng thái webhook. Khi xoá sẽ báo có tạm dừng được receiver hay không.',
  'Webhook status unavailable — could not load server health.':
    'Không có trạng thái webhook — không tải được tình trạng server.',
  Webhooks: 'Webhooks',
  'Webhooks are off': 'Webhooks đang tắt',
  'Webhooks aren’t available on this platform': 'Webhooks không có trên nền tảng này',
  "When a task's whole process tree crosses this, the engine pauses it with a warning and starts the next queued task. Leave empty for no limit.":
    'Khi toàn bộ cây tiến trình của nhiệm vụ vượt mức này, engine sẽ tạm dừng với cảnh báo và chạy nhiệm vụ tiếp theo trong hàng đợi. Để trống nếu không giới hạn.',
  'When an agent stops because its provider usage limit is reached, onni waits for the reset the provider named and continues the task 30 seconds later — up to 12 times in a row without you. Off leaves the task failed with its Continue button.':
    'Khi agent dừng vì chạm giới hạn sử dụng của nhà cung cấp, onni chờ đến thời điểm đặt lại mà nhà cung cấp nêu và tiếp tục nhiệm vụ sau 30 giây — tối đa 12 lần liên tiếp mà không cần bạn. Tắt thì nhiệm vụ vẫn thất bại kèm nút Continue.',
  'When on, a task with changes pauses so you can Accept, Send back, or open a Draft PR. Autonomous tasks always skip this and finish on their own. Default: off — tasks finish without asking.':
    'Khi bật, nhiệm vụ có thay đổi sẽ tạm dừng để bạn Chấp nhận, Gửi trả lại hoặc mở PR nháp. Nhiệm vụ tự động luôn bỏ qua bước này và tự hoàn tất. Mặc định: tắt — nhiệm vụ kết thúc mà không hỏi.',
  'Where tasks work': 'Nơi nhiệm vụ làm việc',
  'Where this project lives on disk. Every task worktree, git command and agent run resolves against it.':
    'Vị trí dự án này trên đĩa. Mọi worktree nhiệm vụ, lệnh git và lượt chạy agent đều dựa vào đó.',
  'Who may read it': 'Ai được đọc',
  Work: 'Công việc',
  'workflow, proves it all passes in a real browser and opens a draft PR for you to merge.':
    'workflow, chứng minh mọi thứ đều đạt trong trình duyệt thật và mở PR nháp để bạn merge.',
  'Working directory: {path}': 'Thư mục làm việc: {path}',
  'Working…': 'Đang xử lý…',
  'Workspace parallelism is currently': 'Mức song song của workspace hiện là',
  'Worktree removed': 'Đã xoá worktree',
  'worktree retained.': 'worktree được giữ lại.',
  'Worktree settings did not load': 'Không tải được cài đặt worktree',
  worktrees: 'worktree',
  Worktrees: 'Worktree',
  'Worktrees did not load: {message}': 'Không tải được worktree: {message}',
  'Your draft is kept. Saving it replaces the latest settings below; a blank URL keeps the current destination.':
    'Bản nháp của bạn được giữ. Lưu sẽ thay thế cài đặt mới nhất bên dưới; để trống URL thì giữ đích hiện tại.',

  // Agent accounts
  '— folder not created yet; Connect will make it': '— thư mục chưa được tạo; Connect sẽ tạo nó',
  '— this folder does not look like {provider} config yet': '— thư mục này chưa giống cấu hình {provider}',
  Account: 'Tài khoản',
  Accounts: 'Tài khoản',
  'Agent accounts are disabled for remote access. On a trusted, authenticated self-hosted deployment, set ONNI_REMOTE_AGENT_ACCOUNTS=1 and restart onni.':
    'Tài khoản agent bị tắt khi truy cập từ xa. Trên triển khai tự lưu trữ đáng tin cậy và đã xác thực, đặt ONNI_REMOTE_AGENT_ACCOUNTS=1 rồi khởi động lại onni.',
  'Agent accounts did not load': 'Không tải được tài khoản agent',
  'Config files': 'Tệp cấu hình',
  Connected: 'Đã kết nối',
  'Could not verify': 'Không kiểm chứng được',
  'Default model per agent': 'Model mặc định cho mỗi agent',
  'Defaults for new projects': 'Mặc định cho dự án mới',
  discovered: 'được phát hiện',
  'Finish signing in in the terminal, then Check again.': 'Hoàn tất đăng nhập trong terminal, rồi bấm Check again.',
  'Hide details': 'Ẩn chi tiết',
  'Loading agent accounts…': 'Đang tải tài khoản agent…',
  Logins: 'Đăng nhập',
  'Name for {name}': 'Tên cho {name}',
  'No —': 'Không —',
  'No account details to show.': 'Không có chi tiết tài khoản để hiển thị.',
  'Not connected': 'Chưa kết nối',
  'Not installed': 'Chưa cài đặt',
  'One list of agents: pick one to see whether it is installed, which logins you have and its defaults. Add a second config folder to keep a work account beside a personal one; each project picks which it uses in its own Agents settings.':
    'Một danh sách agent: chọn một agent để xem nó đã được cài chưa, bạn có những đăng nhập nào và các mặc định của nó. Thêm thư mục cấu hình thứ hai để giữ tài khoản công việc bên cạnh tài khoản cá nhân; mỗi dự án tự chọn dùng tài khoản nào trong cài đặt Agents của nó.',
  'Opened {label}': 'Đã mở {label}',
  'Reading account details…': 'Đang đọc chi tiết tài khoản…',
  'Remove “{name}”?': 'Xoá “{name}”?',
  'Removed {name}': 'Đã xoá {name}',
  Rename: 'Đổi tên',
  'Renaming changes what onni calls this account, not its folder.':
    'Đổi tên chỉ thay đổi cách onni gọi tài khoản này, không đổi thư mục của nó.',
  "Re-probe this account's login now, instead of waiting for the cached answer":
    'Dò lại đăng nhập của tài khoản này ngay, thay vì chờ kết quả đã lưu',
  'Show details': 'Hiện chi tiết',
  'System default': 'Mặc định của hệ thống',
  'the discovered one': '1 tài khoản được phát hiện',
  'This account is already connected.': 'Tài khoản này đã được kết nối.',
  'This only forgets the account. Nothing in {path} is deleted — not your login, not your sessions. Projects using it fall back to the default account, and tasks that ran under it can no longer be resumed from here.':
    'Thao tác này chỉ quên tài khoản. Không có gì trong {path} bị xoá — không xoá đăng nhập, cũng không xoá phiên. Các dự án đang dùng tài khoản này sẽ quay về tài khoản mặc định, và những nhiệm vụ đã chạy dưới tài khoản đó không thể tiếp tục từ đây nữa.',
  'Version': 'Phiên bản',
  'What a project runs when it has not chosen for itself — set once instead of per repository. A project that has chosen keeps its own.':
    'Thứ dự án dùng để chạy khi chưa tự chọn — đặt một lần thay vì từng kho lưu trữ. Dự án đã tự chọn sẽ giữ lựa chọn riêng.',
  '{count} (1 discovered, {added} added)': '{count} (1 được phát hiện, {added} được thêm)',
  '{path} — not created yet': '{path} — chưa được tạo',
  '{provider} can only hold one account here: it keeps its credentials outside its config folder, so a second folder would change settings without changing the login — which would say “work account” while billing the other one.':
    '{provider} chỉ giữ được một tài khoản ở đây: nó lưu thông tin đăng nhập bên ngoài thư mục cấu hình, nên thư mục thứ hai sẽ đổi cài đặt mà không đổi đăng nhập — tức là hiển thị “tài khoản công việc” nhưng lại tính phí tài khoản kia.',
  Yes: 'Có',

  // Projects
  '· not registered': '· chưa đăng ký',
  '“{tag}” removed from {name}': 'Đã gỡ “{tag}” khỏi {name}',
  '‹ General settings': '‹ Cài đặt chung',
  'Add a tag to {name}': 'Thêm thẻ cho {name}',
  'Add {name} to your projects': 'Thêm {name} vào dự án của bạn',
  'Add tag…': 'Thêm thẻ…',
  'Browse folder': 'Thư mục duyệt',
  'Checkout folder': 'Thư mục checkout',
  'Choose an existing folder; it is verified writable before saving.':
    'Chọn một thư mục có sẵn; thư mục được kiểm tra quyền ghi trước khi lưu.',
  'Default browse folder': 'Thư mục duyệt mặc định',
  'Default checkout folder': 'Thư mục checkout mặc định',
  'Inherit ({limit})': 'Kế thừa ({limit})',
  'Loading projects…': 'Đang tải dự án…',
  'Max parallel': 'Song song tối đa',
  'Max parallel tasks for {name}': 'Số nhiệm vụ song song tối đa cho {name}',
  'no git repo': 'không phải repo git',
  'No projects registered yet.': 'Chưa đăng ký dự án nào.',
  ok: 'ổn',
  'Only affects folder browsing; GitHub checkouts use the separate checkout folder.':
    'Chỉ ảnh hưởng đến việc duyệt thư mục; bản checkout từ GitHub dùng thư mục checkout riêng.',
  'Only affects new checkouts; projects already registered keep their location.':
    'Chỉ ảnh hưởng đến bản checkout mới; dự án đã đăng ký giữ nguyên vị trí.',
  'onni is serving this folder — save it to your projects': 'onni đang phục vụ thư mục này — hãy lưu nó vào dự án của bạn',
  'Project settings did not load': 'Không tải được cài đặt dự án',
  'Projects in this workspace': 'Dự án trong workspace này',
  'Registered projects': 'Dự án đã đăng ký',
  'Remove tag {tag} from {name}': 'Gỡ thẻ {tag} khỏi {name}',
  'Settings for {name}': 'Cài đặt cho {name}',
  'Tags used in this workspace': 'Thẻ đang dùng trong workspace này',
  'The folder is created recursively if needed, then verified writable before saving.':
    'Thư mục được tạo đệ quy nếu cần, rồi kiểm tra quyền ghi trước khi lưu.',
  "The folders you have added. While this list is empty the folder onni is serving is listed as “not registered” with an Add button; once you have projects, starting onni somewhere new neither registers nor lists that folder — use “Add project” when you want to keep it. “Tags” group connected repositories — give the API, the web app and the design system a shared “storefront” tag and the global Tasks page can show all three as one piece of work. “Max parallel” caps how many of that project's tasks run at once (leave it empty to inherit the workspace limit); the workspace limit ({max}) still applies as an overall ceiling, so a per-project value above it has no extra effect until the workspace limit is raised. Removing a project only unregisters it — no files on disk are deleted.":
    'Những thư mục bạn đã thêm. Khi danh sách này còn trống, thư mục onni đang phục vụ được liệt kê là “chưa đăng ký” kèm nút Add; sau khi đã có dự án, khởi động onni ở một nơi mới sẽ không đăng ký cũng không liệt kê thư mục đó — hãy dùng “Add project” khi bạn muốn giữ nó. “Tags” nhóm các kho lưu trữ đã kết nối — gắn cho API, ứng dụng web và design system cùng một thẻ “storefront” để trang Tasks toàn cục hiển thị cả ba như một phần việc. “Max parallel” giới hạn số nhiệm vụ của dự án đó chạy cùng lúc (để trống để kế thừa giới hạn workspace); giới hạn workspace ({max}) vẫn là mức trần tổng thể, nên giá trị riêng của dự án cao hơn mức đó không có tác dụng thêm cho đến khi giới hạn workspace được nâng. Xoá dự án chỉ bỏ đăng ký — không có tệp nào trên đĩa bị xoá.',
  'Where “Clone from GitHub” and “New project” put new projects: <folder>/<project name>.':
    'Nơi “Clone from GitHub” và “New project” đặt dự án mới: <folder>/<project name>.',
  'Where “Open local folder…” starts. You can still browse to any folder or drive from there.':
    'Nơi trình chọn bắt đầu. Từ đó bạn vẫn duyệt tới được bất kỳ thư mục hay ổ đĩa nào.',
  'Your home directory or a onni task worktree cannot be a project — start onni in a project folder, or use Open local folder':
    'Thư mục home hoặc worktree nhiệm vụ của onni không thể là dự án — hãy khởi động onni trong thư mục dự án, hoặc dùng Open local folder',
  '{error} — setting unchanged': '{error} — cài đặt không thay đổi',
  '{label} set to {value}': 'Đã đặt {label} thành {value}',
  '{name} added to your projects': 'Đã thêm {name} vào dự án của bạn',
  '{name} already has the maximum of {count} tags': '{name} đã có tối đa {count} thẻ',
  '{name} inherits the workspace limit ({limit})': '{name} kế thừa giới hạn của workspace ({limit})',
  '{name} runs at most {count} task at a time': '{name} chạy tối đa {count} nhiệm vụ cùng lúc',
  '{name} runs at most {count} tasks at a time': '{name} chạy tối đa {count} nhiệm vụ cùng lúc',
  '{name} tagged “{tag}”': 'Đã gắn thẻ “{tag}” cho {name}',

  // Settings shell
  'Back (Esc)': 'Quay lại (Esc)',
  Collapse: 'Thu gọn',
  General: 'Chung',
  'General settings': 'Cài đặt chung',
  "Open {name}'s {section}": 'Mở {section} của {name}',
  'Open settings menu': 'Mở menu cài đặt',
  'Project settings': 'Cài đặt dự án',
  'Sections of this area': 'Các mục của khu vực này',
  'Settings navigation': 'Điều hướng cài đặt',
  'Settings sections': 'Các mục cài đặt',
  'Stored in ~/.onni': 'Lưu trong ~/.onni',
  'This project': 'Dự án này',
  '{name} is gone — remove it in Projects': '{name} không còn — hãy xoá nó trong Projects',

  // Webhook test feedback
  'Address is never allowed': 'Địa chỉ không bao giờ được phép',
  'A newer action replaced it': 'Một thao tác mới hơn đã thay thế',
  'A newer update replaced it': 'Một cập nhật mới hơn đã thay thế',
  'Automatic resume changed': 'Cài đặt tự động tiếp tục đã đổi',
  cancelled: 'bị huỷ',
  'Check that your receiver is reachable and responds within 10 seconds.':
    'Kiểm tra xem receiver có truy cập được và phản hồi trong 10 giây không.',
  'Check the receiver’s authentication and the signing key in its verifier.':
    'Kiểm tra xác thực của receiver và khoá ký trong verifier của nó.',
  'Check the URL and that the endpoint still exists.': 'Kiểm tra URL và xem endpoint còn tồn tại không.',
  'Could not connect to the receiver': 'Không kết nối được tới receiver',
  'Delivery failed': 'Gửi thất bại',
  dropped: 'bị bỏ',
  'Fix the receiver, then send a new test. Tests are not retried automatically.':
    'Sửa receiver rồi gửi thử mới. Lần gửi thử không được thử lại tự động.',
  'History storage is full': 'Bộ nhớ lịch sử đã đầy',
  'Message could not be built': 'Không tạo được nội dung tin nhắn',
  'Network error': 'Lỗi mạng',
  'onni restarted during delivery': 'onni khởi động lại trong khi gửi',
  'Private-network delivery not allowed': 'Không cho phép gửi trong mạng riêng',
  'Rate limited': 'Bị giới hạn tần suất',
  'Receiver did not respond within 10 seconds': 'Receiver không phản hồi trong 10 giây',
  'Result unknown — it may have arrived': 'Không rõ kết quả — có thể đã đến',
  'Retry window ended': 'Hết thời gian thử lại',
  Stopped: 'Đã dừng',
  superseded: 'bị thay thế',
  'Test delivered to {name}': 'Đã gửi thử tới {name}',
  'Test delivered.': 'Đã gửi thử thành công.',
  'Test result for {name} is unknown': 'Không rõ kết quả gửi thử tới {name}',
  'Test result is unavailable. Check the history.': 'Không có kết quả gửi thử. Xem trong lịch sử.',
  'Test result unknown — it may have arrived. Check your receiver before testing again.':
    'Không rõ kết quả — có thể đã đến. Kiểm tra receiver trước khi gửi thử lại.',
  'Test sent — waiting for the result…': 'Đã gửi thử — đang chờ kết quả…',
  'Test sent. Its result is in the history.': 'Đã gửi thử. Kết quả có trong lịch sử.',
  'Test to {name} failed': 'Gửi thử tới {name} thất bại',
  'Test {status}{reason}.': 'Gửi thử {status}{reason}.',
  'The receiver hostname did not resolve to a usable address.':
    'Tên máy chủ của receiver không phân giải tới địa chỉ dùng được.',
  'The receiver hostname does not resolve. Check the URL.': 'Tên máy chủ của receiver không phân giải được. Kiểm tra URL.',
  'The receiver hostname resolves to both public and private addresses. Use a hostname with one kind of address.':
    'Tên máy chủ của receiver phân giải tới cả địa chỉ công khai và riêng tư. Hãy dùng tên máy chủ chỉ có một loại địa chỉ.',
  'The receiver resolves to an address that is never allowed.':
    'Receiver phân giải tới một địa chỉ không bao giờ được phép.',
  'The receiver URL is not allowed. Use a plain http(s) URL without credentials or a fragment.':
    'URL của receiver không được phép. Hãy dùng URL http(s) thuần, không có thông tin đăng nhập hay fragment.',
  'This address is on this computer or a private network. Edit the receiver and turn on “Allow a receiver on this computer or private network”.':
    'Địa chỉ này nằm trên máy tính này hoặc một mạng riêng. Sửa receiver và bật “Allow a receiver on this computer or private network”.',
  "This address points at the onni server itself. Use your receiver's own port.":
    'Địa chỉ này trỏ vào chính server onni. Hãy dùng cổng riêng của receiver.',
  'This server only sends to HTTPS receivers. Use an https:// URL.':
    'Server này chỉ gửi tới receiver HTTPS. Hãy dùng URL https://.',
  'This server only sends to public receivers. Use a publicly reachable HTTPS URL.':
    'Server này chỉ gửi tới receiver công khai. Hãy dùng URL HTTPS truy cập được từ Internet.',
  'View in history': 'Xem trong lịch sử',
  'Webhook data was reset': 'Dữ liệu webhook đã được đặt lại',
  '{action} the receiver to start sending task updates.': '{action} receiver để bắt đầu gửi cập nhật nhiệm vụ.',
  '{hint} Activation stays blocked until a test passes.':
    '{hint} Kích hoạt vẫn bị chặn cho đến khi có lần gửi thử thành công.',

  // Prompt templates
  'Add template': 'Thêm template',
  'Apply {name} automatically with a skill': 'Tự động áp dụng {name} với một skill',
  'apply with…': 'áp dụng với…',
  'Every template needs both a label and text.': 'Mỗi template cần cả nhãn và nội dung.',
  'Label (e.g. "Add tests")': 'Nhãn (ví dụ "Add tests")',
  'New template label': 'Nhãn template mới',
  'New template text': 'Nội dung template mới',
  'no skills found': 'không tìm thấy skill nào',
  'Pick the skills this template applies itself to': 'Chọn những skill mà template này tự áp dụng',
  'Remove this template': 'Xoá template này',
  'Reset to defaults': 'Đặt lại về mặc định',
  'Stop applying “{label}” automatically with {skill}': 'Ngừng tự động áp dụng “{label}” với {skill}',
  'Text for {name}': 'Nội dung cho {name}',
  'The instructions to insert…': 'Hướng dẫn cần chèn…',

  // Tracker
  'API token': 'Token API',

  // Settings section registry — titles
  'Secrets': 'Secrets',
  'External integrations': 'Tích hợp bên ngoài',
  'Agents': 'Agent',
  'Instructions': 'Hướng dẫn',
  'Tasks': 'Nhiệm vụ',
  'Agent config': 'Cấu hình agent',
  'Bookmarklets': 'Bookmarklet',
  'Appearance': 'Giao diện',
  'Notifications': 'Thông báo',
  'Keyboard': 'Bàn phím',
  'Resources': 'Tài nguyên',
  'Manager–Worker': 'Quản lý–Worker',
  'Agent permissions': 'Quyền của agent',
  'Skills': 'Skill',
  'Agent accounts': 'Tài khoản agent',
  'Projects': 'Dự án',

  // Settings section registry — descriptions
  'Connect this project to Jira or Linear.': 'Kết nối dự án này với Jira hoặc Linear.',
  'Encrypted values for this project’s check steps and onni — never for agents.':
    'Giá trị mã hoá cho các bước kiểm tra của dự án này và onni — không bao giờ cho agent.',
  'Send task updates to your own endpoint.': 'Gửi cập nhật nhiệm vụ tới endpoint của riêng bạn.',
  'Third-party tools onni installs and wires into this project — test frameworks first.':
    'Các công cụ bên thứ ba mà onni cài và nối vào dự án này — ưu tiên framework kiểm thử.',
  'Providers, default runner and models.': 'Nhà cung cấp, runner mặc định và model.',
  'What you write for the models: system prompt, branch naming, prompt templates.':
    'Những gì bạn viết cho model: system prompt, cách đặt tên branch, template prompt.',
  'Development model, landing, required checks, base branch, review, live titles.':
    'Mô hình phát triển, cách land, kiểm tra bắt buộc, base branch, đánh giá, tiêu đề trực tiếp.',
  'Edit the coding agents’ own config files, per scope.': 'Sửa tệp cấu hình riêng của các agent lập trình, theo từng phạm vi.',
  'How many finished task worktrees this project keeps on disk.':
    'Số worktree của nhiệm vụ đã xong mà dự án này giữ lại trên ổ đĩa.',
  'Launch skills from a GitHub PR or issue.': 'Chạy skill từ PR hoặc issue trên GitHub.',
  'Theme, accent and density.': 'Chủ đề, màu nhấn và mật độ.',
  'Browser notifications when an agent needs you.': 'Thông báo trình duyệt khi agent cần bạn.',
  'Shortcuts for task commands.': 'Phím tắt cho các lệnh nhiệm vụ.',
  'Parallel tasks and per-task memory limit, across every project.':
    'Số nhiệm vụ song song và giới hạn bộ nhớ mỗi nhiệm vụ, trên mọi dự án.',
  'Presets: one agent manages, chosen agents work.': 'Preset: một agent quản lý, các agent được chọn làm việc.',
  'What Antigravity may do without asking.': 'Những gì Antigravity được làm mà không cần hỏi.',
  'Updates for skills installed on this machine.': 'Cập nhật cho các skill đã cài trên máy này.',
  'A system prompt for every task in every project; a project’s own wins where they conflict.':
    'System prompt cho mọi nhiệm vụ ở mọi dự án; prompt của dự án sẽ thắng khi xung đột.',
  'Encrypted values shared by every project on this machine — never for agents.':
    'Giá trị mã hoá dùng chung cho mọi dự án trên máy này — không bao giờ cho agent.',
  'Second logins, and the agent and models a project uses when it has chosen none.':
    'Đăng nhập phụ, cùng agent và model mà dự án dùng khi chưa tự chọn.',
  'The workspace registry and where GitHub checkouts land.':
    'Danh sách workspace và nơi lưu bản checkout GitHub.',
  'Manager memory': 'Bộ nhớ manager',
  'Lessons managers leave for later tasks in this project.': 'Bài học manager để lại cho các nhiệm vụ sau trong dự án này.',
  'Manager memory did not load': 'Không tải được bộ nhớ manager',
  'Lessons for later tasks': 'Bài học cho các nhiệm vụ sau',
  'Managers write here with "onni task memory add". Every manager–worker task in this project reads this list into its brief when it opens — keep it short and specific.':
    'Manager ghi vào đây bằng "onni task memory add". Mọi nhiệm vụ quản lý–worker trong dự án này đọc danh sách này vào brief khi mở phiên — hãy giữ ngắn và cụ thể.',
  'Project memory': 'Bộ nhớ dự án',
  '- Run the database migrations before the unit suite.\n- The payments module must not import the UI package.':
    '- Chạy migration cơ sở dữ liệu trước bộ test unit.\n- Module payments không được import gói UI.',
  '{bytes} / {max} bytes': '{bytes} / {max} byte',
  'Over the limit — remove a lesson before saving.': 'Vượt giới hạn — hãy xoá bớt một bài học trước khi lưu.',
  'Save memory': 'Lưu bộ nhớ',
  'Clear memory': 'Xoá bộ nhớ',
  'Stored lessons': 'Bài học đã lưu',
  'Each line names the task that wrote it. Lessons are not orders: a manager is told they never override the user’s request.':
    'Mỗi dòng ghi nhiệm vụ đã viết nó. Bài học không phải mệnh lệnh: manager được dặn rằng chúng không bao giờ đè lên yêu cầu của người dùng.',
  'No lessons yet.': 'Chưa có bài học nào.',
  'new': 'mới',
  'Clear project memory?': 'Xoá bộ nhớ dự án?',
  'Every stored lesson is removed. Managers that are already running keep the copy they opened with.':
    'Mọi bài học đã lưu sẽ bị xoá. Các manager đang chạy vẫn giữ bản sao lúc mở phiên.',
  'Project memory saved': 'Đã lưu bộ nhớ dự án',
  'Memory changed in another window — reloaded the latest version': 'Bộ nhớ đã thay đổi ở cửa sổ khác — đã tải lại bản mới nhất',
}
