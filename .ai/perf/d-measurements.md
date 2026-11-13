# Area D — Runtime performance measurements

## Scope and method

Measured on 2026-11-13 in an isolated temporary Git repository and temporary `ONNI_HOME`; benchmark state was removed afterward. No source, test, config, or package files were changed. No tests were run.

| Machine context | Value |
|---|---|
| OS | Windows 11 Pro 10.0.26200 |
| CPU / RAM | AMD Ryzen 7 7735HS; 15.2 GiB visible RAM |
| Node / npm | Node v24.21.0; npm 11.19.0 |
| Install | `npm ci`: 25.62 s; 528 packages added |
| Runtime mode | `ONNI_DRY_RUN=1`, `ONNI_MOCK_PACE=0`, loopback HTTP, Node `fetch` with keep-alive |

The initial exploratory mock prompt without a completion marker parked in `waiting`; it and a queued successor were canceled. The measured workload used the bundled mock's `mock:done` completion hook and 20 tasks all settled `done`. One observed active run exposed process telemetry `procCount=3`; this is a concurrent process count, not a lifetime spawn total. Timings reflect a local dry-run mock, not a real provider or network-connected agent. Requests were sequential, 50 per endpoint; p95 is nearest-rank. Cold boot is process start to first healthy response, sampled with a 100 ms polling interval.

## Build and boot

| Measurement | Result |
|---|---:|
| `npm run build` complete | 15.3 s wall time, exit 0 |
| Server build phase (`npm run build:server`) | 8.62 s, exit 0 |
| Web build phase (`npm run build:web`) | 4.31 s, exit 0; Vite reported 1.26 s internal build time |
| Pack gate (`npm run check:pack`) | 5.17 s, exit 0; 1,344 packed files checked |
| Cold boot to healthy | 1.70 s |
| Idle RSS | 92.3 MB after 2.5 s. An immediate post-health sample was 152.3 MB, then settled to 92.3 MB within two seconds; likely startup allocation/working-set settling (estimate). |
| RSS after 20 completed tasks | 98.6 MB on the benchmark server, about 6.3 MB over its stable idle sample |

The separately timed build phases are separate npm invocations and are not additive to the full-build wall time. The web build emitted Vite's warning that a minified chunk exceeds 500 kB.

## API latency

Milliseconds, 50 sequential requests per endpoint after warm-up. The final three routes were measured with 20 completed runs in the store.

| Endpoint | Response bytes | p50 | p95 | Mean |
|---|---:|---:|---:|---:|
| `GET /api/v1/health` | 1,622 | 1.51 | 5.06 | 4.15 |
| `GET /api/v1/runs` | 32,852 at 20 runs | 1.96 | 2.48 | 2.07 |
| `GET /api/v1/runs/:id` | 1,824 | 0.71 | 1.11 | 0.77 |
| `GET /api/v1/projects` | 382, one project | 3.87 | 5.34 | 7.18 |
| `GET /api/v1/runs/:id/diff` | 65 (empty no-worktree diff) | 0.53 | 0.91 | 0.61 |

## Dry-run task and state measurements

Eight representative tasks were sampled from the 20-task run; all 20 reached `done`.

| Metric | n | p50 | p95 | Notes |
|---|---:|---:|---:|---|
| Create → first persisted event | 8 | 118 ms | 137 ms | Difference between run `createdAt` and first event timestamp |
| Create → terminal `done` | 8 | 1,036 ms | 1,174 ms | Difference between `createdAt` and `finishedAt` |
| Active process count | 1 observed | 3 | — | Run process telemetry during one active Claude mock run; not lifetime spawn count |
| Run-state footprint | 20 runs | 65 files / 164,316 bytes | — | Temporary Onni home plus repo `.ai/onni`; `runs.json` was 36,472 bytes, per-run NDJSON about 5.2 KB, handoff about 0.4 KB, mock screenshot about 0.6 KB |

## Findings

### 1. Medium — the run index is rewritten as a whole during active saves

- **File:line:** `packages/work/src/runs/store.ts:560-561,2277-2298`
- **What happens:** The store serializes the merged run map to a temporary JSON file and renames it over `runs.json`. Saves are debounced to one second, but each save still rewrites the full index.
- **Cost and scale:** JSON serialization and disk I/O scale with the number and size of retained runs per save. Active-run updates can keep scheduling saves; debounce coalesces bursts but does not make each flush incremental.
- **Evidence:** At 20 completed tasks, `runs.json` measured 36,472 bytes and the total run-state footprint was 164,316 bytes. This was fast at this sample size; larger indexes or concurrent active runs increase write amplification.
- **Fix proposal:** Keep per-run records or append-only deltas and compact into snapshots periodically, while retaining the existing atomic recovery guarantees. **Effort: L.**

### 2. Medium — the largest browser JavaScript chunk remains over the warning threshold

- **File:line:** `packages/web/vite.config.ts:16-22,51-55`
- **What happens:** The React runtime is split into a named chunk, but the production build still emits an `index-*.js` chunk of 636.29 kB minified (176.80 kB gzip), and Vite warns that some chunks exceed 500 kB.
- **Cost and scale:** Every browser opening the cockpit pays network transfer and JavaScript parse/compile cost for initial entry chunks; this affects initial load rather than scaling per task.
- **Evidence:** `npm run build:web` output: `index-BuvZMnPy.js 636.29 kB │ gzip: 176.80 kB`; Vite emitted “Some chunks are larger than 500 kB after minification.”
- **Fix proposal:** Identify the largest entry dependencies and move infrequently used route or visualization code behind dynamic imports, then compare initial compressed bytes and route navigation cost. **Effort: M.**

### 3. Low — the run list payload grows linearly with retained run count

- **File:line:** `packages/work/src/server/routes/runs.ts:323-330`
- **What happens:** The default list maps every stored run and serializes its full summary record, omitting only `workflowDef` unless `?full=1`.
- **Cost and scale:** Response construction, JSON serialization, and local transfer are O(number of listed runs). At current retention defaults, older or numerous runs can make the list payload and serialization work grow together.
- **Evidence:** 20 runs produced a 32,852-byte response; latency stayed low at p50 1.96 ms / p95 2.48 ms. This benchmark shows linear payload growth risk, not a current latency problem.
- **Fix proposal:** Add cursor pagination or a compact list DTO and fetch full records on demand if real projects show list sizes becoming material. **Effort: M.**

### 4. Low — project listing performs work per registered root

- **File:line:** `packages/work/src/workspace/projects.ts:350-357`
- **What happens:** Each projects request loads workspace config, then calls the cached root probe for every selected project concurrently.
- **Cost and scale:** Config access and Promise coordination grow with project count; uncached probes may also do filesystem/Git work per root. The per-root status probe has a TTL cache, which limits repeated Git cost.
- **Evidence:** With one registered project, 50 requests measured p50 3.87 ms / p95 5.34 ms, slower than the 20-run list route at 1.96 / 2.48 ms, but still small in absolute terms.
- **Fix proposal:** If multi-project measurements show this route becoming expensive, cache the assembled project list and invalidate it on registry writes or probe expiry. **Effort: S.**

### 5. Low — each agent step launches a CLI process

- **File:line:** `packages/work/src/core/claude-cli-runner.ts:123-135`
- **What happens:** Starting a Claude session calls `spawnTaskProcess`; sessions reuse that child for turns, while a new invocation needs another process start.
- **Cost and scale:** Subprocess startup and IPC are paid per agent invocation/step, not per API read. In this mock run the observed active process count was 3, create-to-first-event p50 was 118 ms, and full create-to-done p50 was 1.04 s. Mock timings should not be treated as real CLI startup estimates.
- **Fix proposal:** Preserve session reuse across follow-up turns and avoid splitting workflows into unnecessary one-step invocations; profile real-provider startup separately before changing process lifetime. **Effort: S.**

## Ranked top 5

1. **Medium — Whole-index JSON rewrites:** O(retained run data) disk and serialization work per debounced save (`store.ts:560-561,2277-2298`).
2. **Medium — 636 kB JavaScript entry chunk:** initial browser transfer and parse cost (`vite.config.ts:16-22,51-55`).
3. **Low — Run-list payload growth:** 32.9 kB for 20 runs, O(run count) (`routes/runs.ts:323-330`).
4. **Low — Project-list per-root work:** p95 5.34 ms at one project; potential O(project count) work (`workspace/projects.ts:350-357`).
5. **Low — Agent CLI process startup:** per invocation subprocess cost; mock p50 end-to-end 1.04 s (`claude-cli-runner.ts:123-135`).
