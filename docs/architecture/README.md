# docs/architecture — current-state snapshot

Generated **2026-10-30** from the code on branch `dev` (commit `1cc14e0`), by reading
`packages/*/src` and by running the built service with `ONNI_DRY_RUN=1`. Nothing here is
inferred from `AGENTS.md`, `docs/project-overview.md` or `.ai/specs/` — where those disagree
with the tree, the tree won, and the disagreement is recorded in
[`docs/FEATURES.md`](../FEATURES.md).

Every element and every arrow carries a `file:line` citation into the source that produced it.
Line numbers are valid for the commit above; they drift as the tree moves.

## The diagrams

| # | File | What it shows |
| --- | --- | --- |
| 01 | [`01-layers.puml`](01-layers.puml) / [`.png`](01-layers.png) | Deployment layers on one machine: the Tauri shell, the WebView cockpit, the Node engine process, the two shared packages, and every channel between them (HTTP, SSE, WebSocket, child processes). |
| 02 | [`02-engine-components.puml`](02-engine-components.puml) / [`.png`](02-engine-components.png) | The module map of `packages/work/src`: HTTP edge, run engine, process layer, resource layer, feature modules, and who imports whom. |
| 03 | [`03-class-core.puml`](03-class-core.puml) / [`.png`](03-class-core.png) | The core classes and their seams: `RunManager`, `RunStore`, `WorkspaceSemaphore`, `WorktreeLifecycleCoordinator`, the dispatch engine, `RunRecord` / `StepState`. |
| 04 | [`04-class-agent-adapter.puml`](04-class-agent-adapter.puml) / [`.png`](04-class-agent-adapter.png) | The runner seam: `AgentRunner` / `AgentSession` / `AgentRunSpec`, the seven backends grouped by wire protocol, and the two event unions. |
| 05 | [`05-seq-run-task.puml`](05-seq-run-task.puml) / [`.png`](05-seq-run-task.png) | One task from `POST /runs` to a settled status: queue, semaphore, worktree, agent turn, check + retry, error classification, review gate, slot release. |
| 06 | [`06-seq-dispatch.puml`](06-seq-dispatch.puml) / [`.png`](06-seq-dispatch.png) | A parent task delegating a child: the CLI, the dispatch route, the three brakes, the tree files, and how the child's report reaches the parent. |
| 07 | [`07-seq-realtime.puml`](07-seq-realtime.puml) / [`.png`](07-seq-realtime.png) | Live signals: SSE replay by `Last-Event-ID`/`seq`, the client-side dedup and batching, the WebSocket topic bus, and what each side does on reconnect. |
| 08 | [`08-seq-desktop-startup.puml`](08-seq-desktop-startup.puml) / [`.png`](08-seq-desktop-startup.png) | The desktop shell: node discovery, entry resolution, port pick, sidecar spawn, health gate, navigate, badge, hide-to-tray, exit. |
| 09 | [`09-state-run.puml`](09-state-run.puml) / [`.png`](09-state-run.png) | The `RunRecord.status` and `StepState.status` machines — every arrow is a real `status:` write, cross-checked against a dry-run execution. |
| 10 | [`10-flow-review-land.puml`](10-flow-review-land.puml) / [`.png`](10-flow-review-land.png) | The review gate and landing: park, read the diff, commit / push / draft PR / merge, feed corrections back, or continue. |
| 11 | [`11-storage.puml`](11-storage.puml) / [`.png`](11-storage.png) | State on disk: `.ai/onni/` per project, `~/.onni/` per user, `~/.cache/onni/`, who writes each file and how. |
| 12 | [`12-http-api-map.puml`](12-http-api-map.puml) / [`.png`](12-http-api-map.png) | The `/api/v1` surface: route families with their real counts, the double mount, and the guard chain in front of it. |

## Re-rendering

PlantUML 1.2024.7 (or newer) plus a JRE is enough — none of these diagrams needs Graphviz, and
the smetana default layout is used throughout.

```bash
# one-time: fetch the jar into the (untracked) tools dir
curl -L -o .ai/tools/plantuml.jar \
  https://repo1.maven.org/maven2/net/sourceforge/plantuml/plantuml/1.2024.7/plantuml-1.2024.7.jar

# regenerate every PNG from the .puml beside it
java -Djava.awt.headless=true -jar .ai/tools/plantuml.jar \
  -tpng -o docs/architecture docs/architecture/*.puml
```

`.ai/tools/plantuml.jar` is deliberately **not committed** (22 MB of binary in a docs folder).

Sizing rules the files already follow, so a redraw does not regress them:

* `skinparam defaultFontName "Segoe UI"` + `skinparam dpi 150` (dpi 120–130 for the three
  widest ones) — PlantUML truncates any PNG side at **4096 px**, so a diagram that grows past
  that is silently cut on the right. Check `width x height` after rendering, not just the exit
  code.
* One pair `NN-name.puml` + `NN-name.png` per diagram; edit the `.puml` and re-render, never
  ship a PNG whose source is not in this folder.
