# Perf survey B — agent-run streaming pipeline

Phạm vi: runner stdout → mapper → `UiEventSink` → `RunStore.appendEvent` → NDJSON / SSE / WS; dispatch; run dài.
Máy đo: Windows 11, Node 24, git ~80 ms/spawn. Script bench ném đi nằm ngoài repo (temp dir, đã xoá, không commit). "Đo" = chạy thật; "ước lượng" = suy đoán từ code/số đo.

## Tóm tắt chung

Đường nóng được thiết kế tốt: `readNdjson` tuyến tính, delta được coalesce 40 ms và không ghi đĩa, SSE reload dùng cursor + history phân trang đọc ngược, `run` frame được memo hoá theo dispatch, WS serialise 1 lần/publish, client batch 50 ms, store không giữ event trong RAM (chỉ `lastSeq`). Chi phí thật nằm ở **ghi đồng bộ trên event loop** (append từng event, rewrite toàn bộ `runs.json`) và ở **không có giới hạn kích thước** cho tool output (lại còn ghi trùng v1/v2).

Số đo:

| Thí nghiệm | Kết quả |
| --- | --- |
| `readNdjson` + `JSON.parse`, 10 000 dòng nhỏ + 1 dòng 5 MB (8.3 MB) | **32 ms** (không có chi phí bậc hai) |
| `redactSecrets` 16 KB / 256 KB / 1 MB / 5 MB, 6 secrets | 0.3 / 0.6 / 2.4 / **11 ms** |
| 200 snapshot `item.updated` lớn dần tới 527 KB qua `redactDeep` (quét tổng 52 MB) | 169 ms (≈0.8 ms/snapshot) |
| `appendFileSync` 10 000 dòng ×1 KB (mở/ghi/đóng mỗi lần) | **796 ms ≈ 80 µs/event**, đồng bộ |
| Index save mô phỏng N=100 record (0.65 MB) | ≈ 35 ms |
| Index save mô phỏng N=800 record (5.2 MB ≈ 300+500 run giữ lại): parse 13.5 + zod 63 + stringify-per-run 11.4 + stringify/write 28.6 | **≈ 117 ms** đồng bộ, chưa tính khoá + so sánh từng key |
| `git status` / `node -e ""` (spawn) | 82–92 ms / 82 ms |
| NDJSON thật của task này: 76 event, 234 KB | `tool-result` 110 KB + `item.completed` 117 KB = **97 %** dung lượng, cùng một output |

## Findings

### 1. [High] `flush()` đồng bộ ghi lại toàn bộ `runs.json` ở mỗi biên turn, cộng save debounce 1 s
- `workflows/run/agent-step.ts:704-712` (`persistUsageCheckpoint` → `ctx.store.flush()`), gọi tại `:638`, `:670`, `:694` (đầu invocation, `turn.started`, `turn.completed`); `runs/store.ts:2278-2296` (`scheduleSave`/`saveNow`, `SAVE_DEBOUNCE_MS = 1_000` ở `:561`), `:2325-2360` (`mergeWithIndexOnDisk`).
- Chuyện gì xảy ra: mỗi lần save = `lockRunIndex` → `readFileSync` + `JSON.parse` index → `runRecordSchema.safeParse` **mọi** record → với mỗi run: `JSON.parse(baseline)` + `JSON.stringify` từng key hai phía → `JSON.stringify(merged)` → `writeFileSync` + rename → `JSON.stringify(run)` lại cho **mọi** run để cập nhật `persisted` (`:2301`). Tất cả đồng bộ.
- Vì sao tốn: CPU + I/O đồng bộ chặn SSE/WS/stdout của mọi run đang chạy. Chi phí tỷ lệ **tổng số run lưu** (tối đa 300 + 500, `store.ts:553-554`), không phải số run đang chạy.
- Scale: ≥ 1 lần/giây khi có bất kỳ `touch()` (usage, step, status) + 2–3 lần/turn/run live; manager + K worker nhân lên. Đo ≈117 ms/lần ở N=800 (~12 % event loop nếu mỗi giây; ước lượng thêm 30–80 ms cho vòng so sánh key). Record thật trung bình 6.9 KB.
- Fix: (a) thay `flush()` đồng bộ trong `persistUsageCheckpoint` bằng ghi 1 dòng checkpoint vào NDJSON của run (đường append sẵn có) hoặc `saveNow` chỉ cho record dirty; (b) `mergeWithIndexOnDisk` chỉ zod-parse record trong tập dirty, giữ nguyên phần còn lại; (c) giữ `dirty: Set<id>` thay vì `JSON.stringify` mọi run. Effort **M** (phải giữ bảo đảm crash-safety mà comment `:700-703` nêu).

### 2. [High] Tool output không có trần và bị ghi/phát **hai lần** (v1 `tool-result` + v2 `item.completed`)
- `core/claude-cli-runner.ts:578-583` (`result: stringifyToolResultContent(...)`) và mapper `core/claude-ui-mapper.ts` (~`:760`, item `output`); `runs/store.ts:1747` (`persistEvent`). Chỉ `core/cline-ui-mapper.ts:86` có `MAX_OUTPUT_CHARS = 32_000`; claude/codex/opencode không có trần.
- Đo trên run thật: 16 `tool-result` = 110 KB và 17 `item.completed` = 117 KB trong file 234 KB (event lớn nhất 14.8 KB). Output 5 MB ⇒ ~10 MB đĩa/run; mỗi event đi qua redaction ×2 (`StreamRedaction.split` rồi `redactDeep`), `JSON.stringify` persist, `JSON.stringify` **mỗi subscriber SSE** (#4), `eventTextFragments().join(' ')` + 3 regex janitor (#6), rồi client giữ trong React state (#11).
- Vì sao tốn: memory, disk growth (file không trần, prune chỉ theo số run), băng thông SSE, render; và đọc lại toàn file (#5). Đo redact 5 MB chỉ 11 ms ⇒ CPU không phải nút cổ chai, **đĩa/mạng/render mới là**.
- Scale: per event, tuyến tính theo kích thước output, ×2 do trùng.
- Fix: (a) cắt output persisted ~32–64 KB (head+tail + "…N bytes omitted") như cline; (b) bỏ trùng: không persist `tool-result` v1 khi turn đã được v2 phủ (`event-history.ts:124` đã có khái niệm `turnHasV2`) hoặc bỏ `output` ở `item.completed`. Effort **S** (cắt), **M** (bỏ trùng, đụng tương thích replay).

### 3. [Medium] `appendFileSync` mở/ghi/đóng file cho **mỗi** event
- `runs/store.ts:1747-1772` (`persistEvent`); comment `:1774` nói "effectively free".
- Đo: 80 µs/event (796 ms/10 000) đồng bộ trên Windows; AV có thể nhân lên (suy đoán). 10k event ⇒ ~0.8 s chặn loop/run; N run live nhân lên.
- Scale: per event, per run live.
- Fix: giữ một fd append mỗi run (Map, đóng ở settle/`clearRunSecrets`) hoặc gom nhiều event vào 1 `writeSync` mỗi tick/10 ms (thứ tự không đổi vì đơn luồng). Lưu ý Windows không xoá file đang mở: phải đóng fd trước `rmSync` ở `:2095`, `:2266`; giữ nhánh `eventsUnwritable`. Effort **S–M**.

### 4. [Medium] SSE: không backpressure, stringify lại JSON mỗi subscriber, replay không cursor đọc cả file
- `server/routes/sse.ts:56-64` (`writeEvent` = `JSON.stringify(event)` bên trong từng stream), `:66` (`void writeEvent(event)` — không đợi drain), `:78-80` (không cursor ⇒ `streamRunEvents` từ byte 0), `:65` (`buffered` không trần khi đang replay); `server/sse-subscriptions.ts:22` (`[...listeners]` copy mỗi event).
- Vì sao tốn: N tab xem 1 run ⇒ N lần stringify cùng event (trái với `onRunFrames` đã memo, `server/run-frames.ts:31-45`). Client chậm ⇒ hàng đợi stream của Hono tăng không trần trong RAM server. Reconnect không cursor = O(kích thước file) parse; `Last-Event-ID` chỉ lọc `seq` sau khi đã parse từng dòng. Nhánh cursor (`event-history.ts:818-847`) tốt hơn nhưng gom cả đuôi vào một chuỗi rồi `split('\n')`.
- Scale: per event × per subscriber; per reconnect × file size.
- Fix: memo `frameFor(event)` dùng chung (như `onRunFrames`); kiểm tra backpressure (đếm ghi đang chờ / đóng stream chậm — client resume bằng cursor); với `Last-Event-ID`/`afterSeq` thì seek byte offset hoặc đọc ngược thay vì quét từ đầu. Effort **S** (memo), **M** (backpressure + seek).

### 5. [Medium] `store.readEvents()` đọc + parse toàn bộ file trong đường điều phối
- `runs/store.ts:2051` (`readFileSync` + `split` + `JSON.parse` mọi dòng). Gọi từ `workflows/run/settlement.ts:313` (`latestRequest` — chỉ để tìm `user-message` cuối), `workflows/run/continuation.ts:855` (replay khi resume), `workflows/run/agent-step.ts:558`, `store.ts:2166` (`rehydrateSeq` khi chưa có `lastSeq`), `server/provider-auth-runtime.ts:55` (mỗi lần báo lỗi auth).
- Vì sao tốn: O(file) đồng bộ + toàn bộ event thành object trong heap (file 10 MB ≈ 30–50 MB heap, ước lượng) chỉ để lấy 1 phần tử cuối.
- Scale: per turn-end/landing/auth-failure × kích thước run; run 10k event ⇒ hàng chục–trăm ms mỗi lần (ước lượng; parse thuần 8 MB đo được 32 ms nhưng object hoá nặng hơn).
- Fix: dùng `readEventsTail(runId, n)` (`store.ts:2078`) / quét ngược kiểu `tailSeq` (`:2171`) cho `latestRequest` và `provider-auth`. Effort **S**.

### 6. [Medium] Janitor quét văn bản của mọi event cho tới khi `janitorSettled` — thực tế gần như không bao giờ
- `runs/store.ts:1791-1832`, `janitorSettled` `:1840` (đòi đã có PR **và** ≥ 8 issue candidate).
- Mỗi event có text/output: `eventTextFragments` + `eventAgentTextFragments` + `eventCreationClaimFragments` (3 mảng) → `join(' ')` (copy toàn bộ output) → `PR_URL_RE`, `ISSUE_URL_RE`, `CREATED_PR_RE` trên cả chuỗi. Snapshot `item.updated`/`item.completed` của output lớn bị quét lặp. Chưa đo riêng (regex tuyến tính ⇒ vài ms/MB, ước lượng), nhưng thêm 2–3× copy bộ nhớ.
- Scale: per event × kích thước text.
- Fix: bỏ qua `item.updated`, cắt haystack ~64 KB đầu+đuôi, thêm điều kiện dừng "đã quét N event không ra candidate". Effort **S**.

### 7. [Low–Medium] `secretsForRun` sort lại mỗi event; redact hai lần cho item
- `runs/store.ts:2041-2044` (`[...hostSecrets(), ...runSecrets].sort(...)` mỗi lần gọi từ `redact` `:2011`, `drainStreamRedaction` `:1998`, `redactText` `:2019`); `runs/stream-redaction.ts:55` (`redactSecrets` trên snapshot) rồi `redactDeep` ngay sau (`store.ts:2014`) ⇒ item bị quét 2 lần; `split()` còn vòng `endsWith` O(secrets × len) mỗi delta.
- Đo: rẻ với 6 secret (0.8 ms/snapshot 500 KB). Máy dev nhiều biến `*_TOKEN/*_KEY` (hàng chục–trăm) nhân lên theo số secret (suy đoán).
- Fix: cache mảng đã sort theo `runId` (invalidate ở `registerRunSecrets`), bỏ lần redact thứ hai cho trường đã qua `transform`. Effort **S**.

### 8. [Low] Runner/`ActiveRun` giữ `toolCalls`/`textChunks` cả đời run; `turnText` nối chuỗi
- `core/claude-cli-runner.ts:248-249, 568-571` (push `input` của mọi tool call + mọi text block, chỉ dùng cho `AgentRunResult` `:354-388`); `workflows/run.ts:618` (`appendTurnText` nối chuỗi), `agent-step.ts:162, 209` (redact toàn `turnText` cuối turn).
- Bộ nhớ tuyến tính theo số event (input Write/Edit chứa cả file ⇒ có thể MB). Mapper state là `Map` copy-on-write nhỏ, không đáng kể.
- Fix: nếu người dùng kết quả không đọc `toolCalls[].input`, chỉ giữ `{id,name}`. Effort **S** (cần grep nơi tiêu thụ).

### 9. [Low] Dispatch: ~6 spawn git đồng bộ trước mỗi fork + nhiều `listRuns()` sort
- `workflows/run/dispatch.ts:144-154` → `git-worktree.ts:571-629` (`autosaveCommit`: `status`, `unresolvedConflicts`, `add -A`, `diff --cached`, `gitHasIdentity`, `commit`); `dispatch.ts:109, 196` và `workerEntryFull` gọi `store.listRuns()` (copy + sort toàn bộ run, `store.ts:1346`); `dispatchFromAgent` còn `loadWorkspaceConfig()` đọc đĩa mỗi lần.
- Đo: spawn ≈ 80–90 ms ⇒ cây bẩn ≈ 0.5 s (ước lượng) + `git worktree add` + node cold-start của `onni task create` (~80 ms trống + nạp module); cây sạch ≈ 1 spawn. Fan-out K worker từ một manager: K × ~0.6–1 s (ước lượng).
- Fix: bỏ `status` thừa (`add -A` + `diff --cached --quiet` đủ), cache git identity theo repo, thay `listRuns().find` bằng `getRun`/chỉ mục theo cây. Effort **S–M**.

### 10. [Low] WS: không kiểm tra `bufferedAmount`
- `server/ws.ts:140` (`ws.send` thẳng), `:165` (vòng gửi). Serialise 1 lần/publish là đúng. Topic hiện có (`health`, `host`, `tracker:*`, `terminal:*`) không phải luồng event run nên rủi ro thấp, trừ `terminal:*` (output lớn). Fix: bỏ/đóng subscriber khi `bufferedAmount` vượt ngưỡng. Effort **S**.

### 11. [Low, ngoài phạm vi B — chuyển team web] Client giữ toàn bộ event trong state, copy mảng mỗi 50 ms
- `packages/web/src/api/run-events.ts:211-216` (`[...current, ...batch]` O(N) mỗi flush). Run 10k event streaming ⇒ ~10k phần tử copy × ~20 lần/s (ước lượng) + render. Phân trang `RUN_HISTORY_PAGE_ITEMS = 100` giúp lúc mở nhưng live tích luỹ không trần.

## Điểm làm tốt (không cần đụng)
- `core/ndjson.ts` — đã sửa lỗi bậc hai; đo 8.3 MB/32 ms.
- `runs/ui-event-sink.ts` — delta coalesce 40 ms, không ghi đĩa; `item.updated` chỉ ghi đĩa khi shape đổi.
- `runs/event-history.ts` — trang theo item, đọc ngược, `deriveRunContextEvents` cache + resume fold.
- `server/run-frames.ts` — memo JSON frame cho N stream.
- Run detail không đọc file event (history là route riêng `routes/runs.ts:539`) ⇒ thời gian GET detail không tăng theo số event.

## Top 5 xếp hạng
1. **#1 Rewrite `runs.json` đồng bộ (flush mỗi turn + save 1 s)** — ~117 ms/lần ở 800 run, chặn event loop mọi run; fix M.
2. **#2 Tool output không trần + ghi trùng v1/v2** — 97 % dung lượng NDJSON mẫu; multi-MB nhân lên đĩa/RAM/mạng/render; fix S–M.
3. **#3 `appendFileSync` mỗi event** — 80 µs/event, ~0.8 s/10k event đồng bộ; fix S–M (giữ fd).
4. **#4 SSE không backpressure + stringify mỗi subscriber + replay không cursor đọc cả file**; fix S–M.
5. **#5 `readEvents()` toàn file ở turn-end/landing/auth** (kèm #6 janitor quét lặp) — O(file) để lấy 1 phần tử; fix S.
