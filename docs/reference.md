# Onni Work reference

Everything the [README](../README.md) leaves out: the full configuration, every environment variable, agent backends, remote access, multiple projects and local development.

- [Core concepts](#core-concepts)
- [Cockpit tour](#cockpit-tour)
- [Multiple projects, one cockpit](#multiple-projects-one-cockpit)
- [Workflow format](#workflow-format)
- [How it runs agents](#how-it-runs-agents) (environment variables, troubleshooting)
- [Talking to a running cockpit](#talking-to-a-running-cockpit) (`onni runs`, `onni task`, `onni automation`, the HTTP API)
- [Coding agent backends](#coding-agent-backends)
- [Remote access (host Onni Work on a server)](#remote-access-host-onni-work-on-a-server)
- [Configuration](#configuration-optional)
- [Worktree lifecycle scripts](#worktree-lifecycle-scripts)
- [Builds and releases](#builds-and-releases)
- [Local development](#local-development)

---

## Core concepts

Three words, no jargon — **task**, **skill**, **chain**:

- 📋 **Tasks** are the unit of work. Every task is a **run**: `queued → running →
  review / done / failed / cancelled`, with a live event log, per-step token and
  cost usage, cancel/delete, and — for anything with a diff — a review gate. Attach
  screenshots, PDFs, `.txt` or `.md` files to the task (paperclip, ⌘V or drag-drop;
  the agent gets each one as a real file on disk), or send follow-up messages into
  the live session while it works.
- 📖 **Skills** are Markdown playbooks. Drop them in `.ai/skills/` or
  `.ai/onni/skills/`, or pull them from a shared **team skills repo** (a bare
  git clone cached globally in `~/.cache/onni/`). A workflow step references one by
  `skill: <name>` and its body becomes the agent's extra system prompt — so you
  shape *how* the agent reasons without touching code.
- 🔗 **Chains (workflows)** stitch steps into a pipeline: agent steps plus shell
  checks, with bounded `onFail` retry loops. Write the YAML yourself, build one by
  drag-ordering skills in the **Workflows** tab, or press **Plan first** and let the
  AI draft a chain for your task that you review, trim and start. The built-in
  `quick-task` (one agent step) works with zero setup.

Five moves that make the cockpit worth the browser tab:

- 🗃️ **Queue + orchestration.** Start as many tasks as you like: Onni Work runs up to
  `maxParallel` at once across every project (default **2**; a non-git directory
  always runs one) and
  holds the rest in a FIFO queue with visible positions (`#1`, `#2`, …). Cancel a
  queued task before it starts; the queue even survives a cockpit restart —
  everything still `queued` is re-enqueued in order. It's the orchestration layer
  that turns "one agent at a time" into a backlog that drains itself.
- 🧠 **Memory-aware runs.** Each run's whole process tree is sampled (~2 s) for CPU
  and RSS, and its **peak memory** is recorded and shown in the task table. Set an
  optional per-task **memory ceiling** (`memoryLimitMb`) and a run that crosses it
  is *paused* — freeing its tree so the queue keeps advancing — and resumes on
  demand. Event logs are append-only NDJSON and streamed rather than re-serialized,
  and live UI deltas are coalesced so they never hit disk.
- 🪞 **Parallel variants (×2 / ×3).** Run the same task as competing agents in
  separate worktrees, then compare their diffs side by side and **pick** one —
  the losers are archived and their worktrees cleaned up.
- 🧹 **Bounded worktree disk.** Each task runs in its own full checkout, so a busy
  cockpit would otherwise grow without limit. Onni Work keeps only the last
  `worktreeRetention` **finished** worktrees on disk (default **10**; `0` =
  unlimited) and reclaims the rest — directory only, the `onni/<id8>` branch is
  always kept, so the work stays recoverable. Settings → Resources shows every
  worktree's disk use with per-row delete and a **Reclaim now** button.
- 🛡️ **Review gate.** With the diff-first gate on (`ONNI_REVIEW_GATE=1` or
  Settings → Tasks; off by default), a successful run with changes waits in
  `review` instead of finishing. Read the diff, type notes that go straight back
  into the agent's session, or push a `gh pr create --draft`. Nothing ever merges
  itself — you stay the merge button either way.
- 📱 **Runs on your coding server, drives from your pocket.** The cockpit is a
  responsive web app streaming over SSE, so the box running Onni Work can be a
  **VPS, cloud, or dedicated server** you never sit in front of. Point a browser
  — laptop or **phone** — at it and run an **always-on coding team** on the move:
  start tasks, watch them live, and hit the review gate from anywhere.

---

## Cockpit tour

One browser window, with live task updates over Server-Sent Events:

| View | What's in it |
|---|---|
| **Dashboard** | **Overview** shows attention, completed/failed outcomes, median cycle time, project comparisons, live work, enabled automations with next run/check times, and recent results; **Usage & cost** shows reported usage and trends. Counters open matching tasks. Drag widgets to reorder them, customize optional tiles and export the current view to PDF/CSV; saved layout is shared by browsers using this workspace. |
| **Tasks** | Every task with its status, live event stream (agent text · tool calls · tool results · pasted/generated screenshots and file attachments), tokens and cost. Continue, cancel, open in terminal (`claude --resume`), review the diff, or push a draft PR. The composer can also **start a task later** — at a date and time in the server's time zone, or after the account's observed usage-limit reset — and such tasks wait under **Scheduled** until then (#1340). They are stored with the project's automations in `.ai/onni/automations.json`; observed reset times are cached, without any model call, in `~/.onni/usage-windows.json`. The server must be running at the start time. |
| **All tasks** | Every *registered project's* tasks in one table, filtered and grouped by tag, project, status or workflow — see [Grouping connected repositories](#grouping-connected-repositories-tags-and-the-all-tasks-page). Appears once a second project is registered. |
| **Inbox** | **Opt-in** (`ONNI_FOLLOWUPS=1`; hidden by default). Follow-ups an agent left behind (`todos.json`) — one click turns a suggestion into the next task, pre-wired to its suggested skill. Off, agents are never asked to leave follow-ups; each task's own **Notes** handoff journal is unaffected. |
| **Git** | Branch, working-tree status, diff vs HEAD, recent commits (click one for its inline patch + GitHub link), and the configurable base branch that worktrees fork from and PRs target. **Files** browses the whole repository — the tree on the left, the file on the right (syntax-highlighted, images inline, Markdown rendered with a toggle to the source), and a filter box that finds a path as you type. Every file is its own URL (`/git/files/<path>`), so a view can be refreshed or pasted to a colleague. The tree is git's own view of the repository, so `.gitignore`d build output and `node_modules` never appear — and a file git does not list cannot be opened, which is what keeps an ignored `.env` out of reach. Read-only: nothing here edits the checkout. |
| **GitHub** | Open issues and PRs of the repo's origin, read through your logged-in `gh`. Hand an issue straight to the agent — pick a workflow and skills, one click runs it. GitHub Enterprise works the same on any domain: a remote counts as GitHub when its host is `github.com`, `*.ghe.com`, or one `gh` is signed in to (`gh auth login --hostname <host>`, or `GH_HOST`). A self-hosted server on any other domain needs that login first. github.com and Enterprise projects work side by side; Onni Work pins the right host per repo, so `GH_HOST` never has to be exported. |
| **Skills** | Local skills plus the team skills repo, with a rendered body + prompt preview. Refresh pulls the latest from the remote. |
| **Workflows** | Build a workflow as a node graph, or let the planner draft one from a description; save it as YAML (a plain stack of skills stays in the portable `skills:` form), import/export, or delete. Built-ins always come back. |
| **Settings** | Appearance (dark/light theme, accent, density), agent backends, notifications, and the skills catalog. |

**Scheduled-start recovery:** a creation-key replay does not create another schedule, and the scheduler reconciles retained run records before retrying a partial start. This is not a global exactly-once execution guarantee: independent cockpits can recover the same queued run, and **Start missing runs** can recreate a variant whose record was deleted manually or by retention. Check existing work before retrying; **Dismiss** closes an ambiguous entry without starting work.


The cockpit is a React app served pre-built by the service — running `onni` means
no build step and no dev server on your machine — with a dark/light
theme, a ⌘K command palette, and bookmarklets that launch a task straight from
a GitHub page.

**⌘P / Ctrl+P** acts on one task: on a task page it lists that task's actions
(pin, archive, rename, stop, the git step, views, layouts, Open in…, copy). The
prefix picks the mode: `@` to switch tasks (a PR or issue number finds every task about it — in ⌘K too), `>` for commands only, `#` for the task's files.
Repeated ⌘P walks back through recent tasks; Tab on a task row (here or in ⌘K)
acts on that task without opening it; ⌥↵ opens a view beside the current one.
Shortcuts run those commands with the palette closed: ⌘1–⌘9 switch the task's tabs and
⌘/ opens the terminal in a column; hold ⌘ to see each tab's number. Rebind any command with ⇧↵ on its row, or in
Settings → Keyboard. Shortcuts are saved in `~/.onni/ui-state.json`.

---

## Multiple projects, one cockpit

One `onni serve` hosts **every repo you work in**, not just the one you started
it in. Projects live in a per-user registry at `~/.onni/config.json` — the
workspace file that also holds the global knobs
(the parallel cap, the memory ceiling, the browse root, and the checkout root). Nothing is added to
the repo: per-project state stays exactly where it was, in that repo's
`.ai/onni/`.

**Your first run registers the repo you start it in** — that is the whole setup.
After that the registry is yours to curate: starting Onni Work somewhere else serves
that folder as usual (its own tasks, its own `.ai/onni/`, reachable at
`/p/<slug>/`) and opens the browser on it, but does not add it to the list. While
you are in it the sidebar shows it marked **not saved**; switch to another project
and it drops out, so the sidebar keeps showing the projects you chose. A bare `/`
opens the page you were last on, or the most recent project. Keeping the folder is
the explicit click: **Add project** in its Settings (or `onni projects add` from
a terminal).

Project views are scoped to their repository; **Dashboard** at `/dashboard`, **All tasks**, and global settings span the workspace:

```
/p/<projectId>/            tasks · git · github · skills · workflows · settings
```

`<projectId>` is a slug derived from the folder name (`my-app`, then `my-app-2`
on a collision), and `/p/default/…` always means the project Onni Work was started
in. The sidebar shows one collapsible group per project — each with its own nav
and task list — and the new-task composer names the project it will run in.

**Adding a project** — the **+** button beside *New task*:

- 📂 **Open local folder…** browses from the configured browse root
  (**Settings → Projects**, default `~/`) in a folder picker and
  registers the folder you pick.
- ⬇️ **Clone from GitHub…** clones with your logged-in `gh` into the checkout
  root (**Settings → Projects**, default `~/onni/projects`) with live progress,
  then registers the clone. Close the dialog and the clone is killed and its
  partial directory removed.

Removing a project (**Settings → Projects**) drops the registry entry only — the
repo and its `.ai/onni/` are never touched, so re-adding it later finds all its
tasks intact. The project Onni Work is currently serving can't be removed from the
cockpit — stop the server and use `onni projects remove <id>` instead.

**From the terminal** — the same registry, no cockpit required (handy over ssh):

```bash
onni projects                    # list: id, branch or status, path, tags
onni projects add ~/code/api     # register a folder (defaults to the current repo)
onni projects remove api         # drop the registry entry; the repo is untouched
onni projects tag api storefront backend   # set the grouping tags (no tags clears them)
```

These read and write `~/.onni/config.json` directly, so they work with the
server stopped, and `ONNI_HOME` selects which workspace they operate on.

Settings is one full-screen surface with one navigation (the app sidebar is
hidden there; **Back** or Escape returns to the page you came from). The
**General settings** group — **Appearance**, **Notifications**, **Resources**,
**Skills**, **Secrets**, **Agent accounts**, **Projects** — is yours
or the machine's and lives at `/settings/global`. Below it, a **Project
settings** tree lists every registered project; each opens into **General**
(the project's folder, its registry facts, its parallel-task ceiling, and
Remove), **Tracker**, **Secrets**, **External integrations**, **Agents**,
**Instructions** (system prompt, branch naming, prompt templates), **Tasks**,
**Agent config**, **Worktrees** and **Bookmarklets**, which describe that one
repo and live under `/p/<projectId>/settings`. On any project page, clicking
another project in the tree opens the same place there: the same section, or
its General page when General is open; the previous project folds.

### Grouping connected repositories: tags and the All tasks page

Work rarely stops at a repo boundary. A storefront is an API, a web app and a
design system; a platform is a handful of services plus the infra that runs
them. **Tags** are how you say so, and **All tasks** is where saying so pays off.

**Tag a repo** in **Settings → Projects**: type into the *Tags* cell on its row
and press Enter (comma works too; the × on a chip, or Backspace in an empty
field, removes one). The field **autocompletes from the tags already used in the
workspace** — click the field to see them all, arrow keys and Enter to pick —
which is what keeps the second repo landing on the first one's spelling instead
of inventing `store-front` next to `storefront`. Anything not on the list is
just typed. A tag is a free-form label — `storefront`, `infra`, `client-acme` —
and a project can carry several, because a repo can belong to more than one
piece of work. Tags are trimmed, deduplicated case-insensitively (`API` and
`api` are one tag) and stored in `~/.onni/config.json` beside the rest of the
registry, so they are yours and this machine's, never something added to the
repo.

**All tasks** — the top item in the sidebar, `/tasks`, or `⌘K → All tasks` —
then shows every registered project's work in one table:

- **Filter** by tag, status and workflow. Tags are one-click chips; status and
  workflow are searchable multi-selects. Every facet ORs inside itself and ANDs
  across, so *"anything running or waiting in storefront or infra"* is one set
  of clicks. Each option carries how many tasks it would leave, so a filter that
  would empty the table says so before you click it. The search box matches
  title, project, workflow, branch and tags.
- **Group by** tag, project, status or workflow — click the pressed one again to
  ungroup. Grouping by tag is the reason tags exist: three repos tagged
  `storefront` become one section, and a repo tagged twice appears under both —
  it genuinely belongs to both.

The filters, the grouping and the Active/Archived tab live in the **URL**, so a
filtered view survives a refresh, pastes into a chat, and sits in a bookmark —
`/tasks?tag=storefront&status=running&group=tag` is a link to exactly what you
were looking at. Only what you changed shows up: Active is the default, so the
Archived view is `?archived=1` and a normal link carries no key for it.

Each row shows **every** PR and issue it references — a task opened on an issue
that landed a PR shows both — plus its cost and live CPU/memory, and can be
marked **read/unread** (the eye) or **archived** (or restored) right there. Every task title, project name and project group heading links into that
project, so the thread, its diff and its worktree are one click away and stay
exactly where they were.

There is deliberately **no project filter**: narrowing this page to one project
is that project's own Tasks page, which is a better version of the same answer
(live updates, the full column set, the composer). So picking a project *leaves*
for it rather than turning the global view into a worse local one.

Nothing else in Onni Work reads tags, on purpose: a tag is a lens, not a permission,
a queue or a routing rule. Removing one changes what you see and nothing else.

> The page reads a workspace-wide index capped at the newest 200 tasks per
> project — it says so, and names the projects it capped, rather than showing a
> short list as if it were complete. Older tasks are always in that project's own
> Tasks page.

**Old page URLs keep working.** Every unprefixed page path — `/`, `/tasks/<id>`,
`/settings` — still answers, bound to the project Onni Work was started in; the
cockpit redirects flat paths to their `/p/<boot>/…` twin, so existing bookmarks
and bookmarklets need no change. The HTTP API is the exception: it moved to
`/api/v1/…` (see the CHANGELOG and [The HTTP API](#the-http-api)), so a script
that calls it needs the extra segment.

> **Hosted cockpit?** The folder picker is confined to the independent browse
> root. Set `ONNI_BROWSE_ROOT` narrowly before first boot (or save it in
> **Settings → Projects**) when a remote viewer should not enumerate the host's
> whole home. Clones continue to use the separate checkout root.

---

## Workflow format

A workflow is a small YAML file in `.ai/onni/workflows/`:

```yaml
name: fix-and-verify
description: Implement the task, then verify; retry with failing output on red.
steps:
  - id: implement
    name: Implement
    prompt: "{{task}}"
    skill: project-conventions   # optional — from .ai/skills or .ai/onni/skills
    # model: opus                # optional per-step model override
    # runner: codex              # optional per-step backend: claude · codex · junie · opencode · pi
    # allowedTools: [Read, Edit, Write, Grep, Glob, Bash]
  - id: verify
    name: Verify
    command: "npm test"          # a check step: exit 0 passes
    onFail:
      retry: implement           # loop back to an earlier step…
      max: 2                     # …at most twice
      # retryOn: [1]             # optional: only these exit codes loop back
```

`{{task}}` is replaced with the task text you typed. When a check fails and loops
back, its failing output — with host secrets, the run's registered secrets and
known token shapes redacted — is appended to the retried agent's prompt so the
next attempt can see what broke.

A check step runs `bash -lc <command>` in the task's worktree with the server's
environment plus the **secrets** it may read, which no agent step ever
receives. A secret has a scope — the project (Settings → *Secrets*,
`onni secrets …`) or the whole workspace (Settings → Global → *Secrets*,
`onni secrets … --workspace`) — and audiences: `checks` (check steps) and/or
`onni` (Onni Work's own features). By default a check step gets every
`checks`-audience secret of the workspace and the project, the project's
winning on a shared name; a step can bind exactly the ones it needs instead:

```yaml
- id: e2e
  command: npx e2e run
  secrets:
    - E2E_GATEWAY_KEY                        # as itself
    - { name: STAGING_LOGIN, as: APP_PASSWORD }   # renamed on the way in
```

A bound name that is not stored, or that `checks` may not read, is said on the
step as a note; `secrets:` on an agent step is a load-time error. Manage secrets
with `onni secrets list | set <NAME> [--audience checks,onni] | unset <NAME>`
(`set` reads the value from stdin; nothing is taken from argv or printed back)
or in Settings. Names are `[A-Z_][A-Z0-9_]*`; `ONNI_*`, `DYLD_*` and shell/loader
variables (`PATH`, `HOME`, `NODE_OPTIONS`, `LD_PRELOAD`, …) are refused. This is
where an e2e runner's model key belongs: an exported `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY` also reaches the agents and switches them to API billing.

Values are stored encrypted (AES-256-GCM) under `~/.onni/secrets/`, with one
per-machine data key in the OS keychain (macOS Keychain, Linux Secret Service,
Windows Credential Manager) through the optional `@napi-rs/keyring` package.
Without a usable keychain — a server, a container, an install that skipped
optional packages, or `ONNI_SECRETS_KEYCHAIN=0` — the data key is a `0600` file
beside the secrets, which makes the store exactly as strong as a private
plaintext file; Settings and `onni secrets list` say which one is in use. A
secret is written for one machine: a reset keychain or a deleted key file
leaves the store unreadable (reported on the run as a note) until the secrets
are stored again.

Onni Work also tells a check step about the run it is verifying. These are set by
Onni Work, not settings — a variable the run does not have is absent (never empty),
and a value inherited from the server's own environment is replaced:

| Variable | Value |
|---|---|
| `ONNI_RUN_ID` | the run id |
| `ONNI_PROJECT_ID` | the project id |
| `ONNI_WORKTREE` | absolute path of the task's worktree (the check's cwd) |
| `ONNI_BRANCH` | the run's branch |
| `ONNI_BASE` | the recorded fork point |
| `ONNI_STEP_ID` | this check step's id |
| `ONNI_ATTEMPT` | 1-based attempt number of this check within the run |
| `ONNI_SHARED_CACHE_DIR` | `~/.onni/cache/<projectId>` (`0700`), shared by the project's tasks — e.g. an e2e replay cache |
| `ONNI_GITHUB_REPO`, `ONNI_GITHUB_NUMBER`, `ONNI_GITHUB_EVENT` | runs a GitHub automation launched only |
| `ONNI_PR_HEAD_SHA`, `ONNI_PR_HEAD_REF`, `ONNI_PR_BASE_REF` | runs a `checkout: "pr-head"` automation launched on a pull request's head only |

`ONNI_PROJECT_ID` is the one name in that table Onni Work also reads as an *input*
(it is how `onni task` and `onni automation` address a cockpit, see
[backward compatibility](../BACKWARD_COMPATIBILITY.md) §1). A run that knows its
own project replaces it; a headless `onni run` that does not leaves whatever
you exported alone, so a check step can still reach the cockpit you named.

A GitHub automation whose events are all `pull_request.*` can set `"checkout": "pr-head"` in its `task`: each launched run forks its worktree from the matched PR's head (fetched into `refs/onni/pr/<n>`) instead of the base branch, so its check steps verify the PR itself. A closed PR or a fork head launches nothing (`skipped` in the execution log) unless `"allowForkHeads": true` admits forks — whose checks then run without secrets. Such a run cannot open a draft PR (`409`). See [Verify a pull request](e2e-verification.md#verify-a-pull-request).

`onFail.retryOn` narrows the loop to the exit codes that mean *the work is
wrong*. Omitted, any non-zero code loops back — right for `npm test`, which
exits 1 whether a test failed or the runner could not start. A richer check
distinguishes the two: an `e2e` browser run exits 1 on a failed test, but 2 on a
config or credential error and 3 on an engine failure, none of which the agent
can fix and each of which would otherwise cost a full agent attempt per retry.
`retryOn: [1]` loops on the verdict and fails the run on the infrastructure,
naming the code. See [browser and mobile e2e as a verification
step](e2e-verification.md) for the worked chains, including an independent QA
exploration as the gate.

Prefer skills over steps? A workflow can also be written in the portable
shorthand — an ordered list of skill names, each becoming one agent step:

```yaml
name: triage-and-fix
skills: [reproduce, root-cause, implement, self-review]
```

---

### Workflow graphs (`version: 2`)

The **Workflows** page is a node editor: every step is a block on a canvas, and the
graph shows exactly how a task will run — which edge a failing check takes, where a
loop goes back, what happens when it gives up. It saves a `version: 2` file next to
the step-list ones (both keep loading; a step-list file opens as a graph):

```yaml
version: 2
name: implement-test-review
nodes:
  - { id: start, type: start }
  - { id: implement, type: agent, prompt: "{{task}}" }
  - { id: tests, type: check, command: npm test }
  - { id: retry, type: loop, max: 3 }
  - id: fix
    type: agent
    session: { continue: implement }    # reopen implement's session (claude · codex · pi)
    prompt: "Tests failed ({{nodes.retry.iteration}}/{{nodes.retry.max}}): {{nodes.tests.output}}"
  - { id: review, type: agent, skill: code-review, verdicts: [approve, changes] }
  - { id: ok, type: end, status: success }
edges:
  - { from: start, to: implement }
  - { from: implement.done, to: tests }
  - { from: tests.pass, to: review }
  - { from: tests.fail, to: retry }
  - { from: retry.repeat, to: fix }
  - { from: fix.done, to: tests }
  - { from: review.approve, to: ok }
  - { from: review.changes, to: retry }
```

**How a graph runs.** One node runs at a time. A node finishes by leaving through
exactly one **output port**; the edge wired to that port is the next step. An unwired
port ends the run — failed for failure ports (`failed`, `fail`, `exhausted`, `reject`,
`red`, `timeout`), successful otherwise. Every cycle must pass through a **loop** node,
whose counter never resets within a run, so every run is finite.

| Node | Ports | Outputs (`{{nodes.<id>.<field>}}`) |
| --- | --- | --- |
| `start` / `end` | `next` / — (`status: success\|failed`) | — |
| `loop` (`max`) | `repeat`, `exhausted` | `iteration`, `max` |
| `agent` (`prompt`, `skill`, `runner`, `model`, `session.continue`, `verdicts`; after a fork also `review`, `budgetUsd`) | `done`, `failed` — or one port per verdict | `summary`, `verdict`, `costUsd` (a fork branch: `runId`, `status`, `summary`) |
| `check` (`command`) | `pass`, `fail` | `exitCode`, `output` |
| `gate.human` (`message`, `timeoutMs?`) | `approve`, `reject` (+`timeout`) | `comment` |
| `ask-user` (`question`, `options?`, `timeoutMs?`) | `answered` (+`timeout`) | `answer` |
| `dispatch` (`prompt`, `runner?`, `budgetUsd?`) | `done`, `failed` | `runId`, `status`, `summary` |
| `git.commit` (`message`) | `done`, `nothing`, `failed` | `sha` |
| `github.draft-pr` (`title?`) | `created`, `failed` | `url`, `number` |
| `github.wait-ci` (`timeoutMs`, `pollMs`) | `green`, `red`, `timeout`, `failed` (the task has no PR) | `status` |
| `github.pr-comment` (`body`) | `done`, `failed` | — |
| `fork` (`branches: 2–4`) | `1` … `4`, each wired to an agent | `runIds` |
| `join` (`wait: all\|any`) | `done`, `failed` | `succeeded`, `failed` |
| `workflow` (`workflow`, `prompt?`, `runner?`, `budgetUsd?`) | `done`, `failed` | `runId`, `status`, `summary` |
| `if` (`condition`) | `true`, `false` | `result`, `value` |
| `git.push` | `done`, `failed` | — |
| `git.sync-base` | `done`, `conflict`, `failed` | `conflicts` |
| `github.pr-update` (`ready?`, `addLabels?`, `reviewers?`) | `done`, `failed` | — |
| `github.issue-comment` (`body`, `issue?` — default: the task's issue) | `done`, `failed` | `issue` |
| `notify.webhook` (`url`, `body?` — needs `ONNI_WORKFLOW_WEBHOOKS=1`) | `done`, `failed` | `status` |

- **Fork / join.** Each fork port leads to one agent node, and every one of those agents
  leads into the same `join`. The agents run at once as subtasks through dispatch — fresh
  sessions, each in its own worktree forked from the task branch (the fork commits the
  task's work first), with a budget carved from the parent's, at most four in flight. An
  agent with `review: true` runs as a reviewer of the task branch instead of an
  implementer. `wait: any` takes the first branch to succeed and cancels the rest.
  Sub-workflows run as subtasks the same way.
- **`if` conditions**: `diff-lines` / `diff-files` (`op`, `value`) on the task's own diff,
  `paths-changed` (`glob`: `*` within a folder, `**` across), `output` (`ref:
  <node>.<field>`, `op`, `value` — numeric when both sides are numbers) and `branch`
  (`equals` / `matches` on the base branch).
- **`git.sync-base`** merges the freshest base into the task branch. On a conflict it
  leaves the merge in progress and leaves by `conflict` — wire that to an agent to
  resolve it (`{{nodes.<id>.conflicts}}` lists the files).
- **Built-in templates** — `implement-and-verify`, `implement-review-pr`, `review-council`
  (three fresh reviewers at once, then a judge that ships or sends it back), `fix-ci` — sit
  next to `quick-task` (still the default). Open one in the editor; it saves as your copy.
- **Restarts** resume a walk parked at a gate, question, CI wait or subtask (or mid-check)
  at that node; an interrupted agent node keeps the usual Continue path.
- **Verdicts.** An agent with `verdicts` ends its turn with `ONNI:VERDICT <name>`; the
  graph branches on it. No verdict → one reminder in the same session, then `failed`.
- **Waits hold no slot.** A gate, question, subtask or CI wait gives its `maxParallel`
  slot back while it waits, and always has an exit: the answer, Cancel, Finish, its
  timeout, or a restart.
- **`ONNI_DRY_RUN=1`** fakes the PR and reports CI green, so a graph can be walked end
  to end offline. In the editor, **Simulate** walks it without running anything.
- **Watching a run.** A task started from a graph workflow gets a **Graph** tab: each
  node's status, iterations and cost, loop counters, and the edges the run took.

## How it runs agents

Onni Work shells out to your locally installed, logged-in agent CLI —
**your subscription, no API key**. With the default Claude Code backend that
means headless `stream-json` mode, tool access via `--allowedTools`, with
unapproved tools denied without prompting (`--permission-mode dontAsk`) inside
the task's worktree — but note the zero-config default list (`Read`, `Edit`,
`Write`, `Grep`, `Glob`, `Bash`) grants unrestricted `Bash` unless a step sets
`bashAllowlist`, so treat a run as having full shell access in its worktree,
not a sandboxed allowlist. Set `ONNI_APPROVAL_GATE=1` to select Claude's
`acceptEdits` mode, but Onni Work has no cockpit permission response channel, so
approval prompts are not actionable in the cockpit. Codex, Junie and OpenCode are driven through their own
native protocols and don't honor `allowedTools` at all — see
[Coding agent backends](#coding-agent-backends) for what each one actually
locks down. Nothing runs on a server you don't own.

Useful environment variables:

| Var | Effect |
|---|---|
| `ONNI_DRY_RUN=1` | Use the bundled mock instead of the real `claude` CLI — the entire cockpit works offline, for demos and development. |
| `ONNI_REMOTE_AGENT_ACCOUNTS=1` | Allow **Settings → Agent accounts** in a remote/self-hosted cockpit. Enable this only behind an authenticated perimeter: account folders expose absolute host paths and the details view can expose account identity. Remotely added folders are confined to `ONNI_BROWSE_ROOT`, including symlink ancestry. Local desktop actions stay disabled; **Connect** returns the exact login command to run on the host. |
| `ONNI_INSTANCE_ID` | Internal server-install identity set automatically in generated systemd/launchd services; normally leave unset. It is surfaced additively by `/api/v1/health` for install verification. |
| `ONNI_AGENT_MODELS_LOCKED=1` | Globally lock each runner to the model configured in its native Claude/Codex/OpenCode settings while keeping runner selection available. Exact `1` also delegates authentication and provider enablement to those native agents, so Onni Work skips its credential probes and provider-disable preferences. Existing Onni Work presets are preserved but ignored, and an environment change requires a restart. The config-file equivalent is `"modelsLocked": true` in global `~/.onni/config.json` or one repository's `.ai/onni/config.json`; config-file locks do not disable provider checks. |
| `ONNI_APPROVAL_GATE=1` | Select Claude's `acceptEdits` mode. Onni Work has no cockpit permission response channel; by default, unapproved tools are denied without interrupting the run. |
| `ONNI_RUNS_KEEP=<n>` / `ONNI_ARCHIVED_RUNS_KEEP=<n>` | How many settled runs (and archived ones) a project's index keeps before the oldest are pruned. Defaults 300 / 500, minimum 1; live runs and runs pinned by an active dispatch tree are never pruned. |
| `ONNI_DESIGN_MODE=0` | Turn off Design Mode in a task's **Preview** tab (spec `.ai/specs/2026-10-09-design-mode.md`). Unset, it is on for a local cockpit: switching it on makes Onni Work re-serve the previewed local `http://` dev server on a second `127.0.0.1` port with an element picker injected, so you can click an element and send the agent a note about it. The port opens only on that click and closes when idle. Always off on a hosted cockpit, where a loopback port reaches nobody — there is no `=1`. |
| `ONNI_FOLLOWUPS=1` | Turn on the global follow-up **Inbox**: agents are asked to leave follow-ups in `todos.json` when they finish, and the Inbox view appears. Off by default — each task's own **Notes** handoff journal runs either way. |
| `ONNI_AUTOMATIONS=0` | Turn **automations** off. On by default since the automations redesign (spec `.ai/specs/2026-09-14-automations-redesign.md`): the Automations view lists GitHub-triggered and scheduled automations, and Onni Work polls GitHub or fires schedules on each enabled one while it is running — nothing runs until you enable an automation yourself. An agent can also **create an automation from a prompt**: type "whenever a PR is opened, review it" into New task — pick the built-in `create-onni-automation` skill, or just ask; every task's system prompt teaches it to recognise the intent — and the agent writes the definition and creates it through `onni automation create` (paused, with a `onni automation check` preview of what it would match), then links the Automations page. Only the exact value `0` opts out (`ONNI_AUTOMATIONS=1`, the old opt-in, is accepted and changes nothing); opted out, the nav item is absent, the endpoints answer `409`, and the workspace scheduler never starts. Read at boot, so restart after changing it; definitions, receipts and high-watermarks are kept either way. |
| `ONNI_WEBHOOKS=1` | Enable project lifecycle notifications in Settings → Webhooks. Off by default; independent of graph workflow notifications. See the [receiver guide](../packages/work/docs/webhooks.md). |
| `ONNI_WORKFLOW_WEBHOOKS=1` | Let a workflow graph's **`notify.webhook`** node POST to the URL it names (JSON: `text`, `run`, `node`). Off by default: a workflow file — which can be imported from anywhere — calling out to an arbitrary URL widens exposure, so it is opt-in. Off, the node leaves by `failed` with a note; under `ONNI_DRY_RUN=1` nothing is sent either way. |
| `ONNI_TERMINAL=1` / `=0` | The task view's interactive **terminal** (spec `.ai/specs/2026-10-07-task-workspace.md` §6). Unset it is on for a local cockpit and off on a hosted one (`ONNI_REMOTE=1` or a non-loopback bind). `1` allows it there too — without a sign-in in front of Onni Work this hands a shell on the server to anyone your reverse proxy admits. `0` turns it off everywhere. A platform with no prebuilt PTY binary reports the terminal unavailable with a reason instead of failing. |
| `ONNI_DISPATCH=0` | Turn OFF **task dispatch**, which is on by default: a running task may start other Onni Work tasks with `onni task create` — each in its OWN worktree forked off the parent's branch, with a budget carved out of the parent's — and they report back into the parent's session when they settle (`onni task report`). Children appear nested under their parent in the task lists. Tasks talk through a tree directory (`.ai/onni/dispatch/<root>/`: the brief, each task's order/notes/report, an inbox per task) and Onni Work wakes a parked recipient when a file lands. A `--kind review` child judges another task's branch and answers with a verdict. ON by default (the owner-approved exception to "cost-widening features are opt-in" — see `AGENTS.md`), and only the exact value `0` turns it off; with it off the `/runs/:id/dispatch` and `/runs/:id/report` routes answer `409`, no task is told about the CLI, and the cockpit hides the "Review open PRs" template. A headless `onni run` never dispatches either way — there is no cockpit for the CLI to reach, so no task is told about it. Read at boot, so restart after changing it. This is the widest cost-widening flag here — one task can start four more agents — so give dispatching tasks a budget. |
| `ONNI_TASK_PROCESS_REAP=0` | Turn OFF **leftover-process reaping**, which is on by default (#1411): when a task settles, Onni Work stops every process still carrying that task's `ONNI_TASK_ID` in its environment — a hung test binary, a dev server, a `setsid`ed background job — with SIGTERM five seconds after the settle and SIGKILL three seconds later, and notes what it stopped in the task's timeline. On boot it does the same for tasks that settled while Onni Work was down. A task you Continue within the grace is left alone. Linux (`/proc`) and macOS (`ps -E`) only. Only the exact value `0` turns it off. |
| `ONNI_AUTOSAVE=1` | Re-enable the periodic (90 s) autosave commit in task worktrees. Off by default (#471) — turn-end and pre-PR flushes always run, so branches still end complete. Every autosave names its trigger in the commit subject (`onni autosave (periodic)` vs `(turn end)` / `(run finalize)` / `(pre-PR)`), so the flushes you keep are distinguishable from the timer you disabled. |
| `ONNI_CLAUDE_BIN=/path/to/claude` | Override which `claude` binary is used. Rarely needed: when it is unset, Onni Work takes `claude` from PATH, and failing that looks where Claude Code's own installers put it — `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin` — so an install the launching shell never added to PATH is still found. |
| `ONNI_CODEX_BIN=/path/to/codex` | Override which `codex` binary is used. |
| `ONNI_JUNIE_BIN=/path/to/junie` | Override which `junie` binary is used. |
| `ONNI_OPENCODE_BIN=/path/to/opencode` | Override which `opencode` binary is used. |
| `ONNI_CURSOR_AGENT_BIN=/path/to/cursor-agent` | Override which Cursor Agent CLI binary is used. Unset: `cursor-agent` on PATH, then `~/.local/bin/cursor-agent`, then `agent` on PATH. |
| `ONNI_PI_BIN=/path/to/pi` | Override which `pi` binary is used. |
| `ONNI_COPILOT_BIN=/path/to/copilot` | Override which GitHub Copilot CLI binary is used. |
| `ONNI_ANTIGRAVITY_BIN=/path/to/agy` | Override which Antigravity CLI (`agy`) binary is used. Unset: `agy` on PATH, then the installer's directory (`%LOCALAPPDATA%\agy\bin` on Windows, `~/.local/bin` elsewhere). |
| `CLAUDE_CONFIG_DIR`, `CODEX_HOME` | The agents' **own** variables, honoured where the vendor documents one. Setting one moves that agent's **default account** — the config folder Onni Work discovers. A *second* login of the same CLI is deliberately not an environment setting, since one process-wide value cannot differ per project: add it under **Settings → Agent accounts** and pick it per project. |
| `ONNI_BROWSE_ROOT=~/` | Default root for **Add project → Open local folder…**. The picker cannot navigate above it; a saved workspace value overrides the environment default and must name an existing folder. |
| `ONNI_PROJECTS_DIR=~/onni/projects` | Default destination for **Clone from GitHub**. Saved workspace settings override it, and missing directories are created recursively. |
| `ONNI_SUPERVISED=1` | Marks a supervised launch — the desktop shell sets it beside `ONNI_SUPERVISOR_PID`. Off by default. |
| `ONNI_AUTONOMOUS_DEFAULT=0` | Seed the New Task Autonomous default (`0` or `1`). Without a seed, skills default on and workflows off; a saved global Resources setting overrides it. |
| `ONNI_WORKTREE_DEFAULT=1` | Seed the New Task Worktree default (`0` or `1`). Without a seed, eligible runs default on; a saved global Resources setting overrides it. |
| `ONNI_DISABLE_REPO_LOCK=1` | **Dangerous escape hatch:** allow any run executing in the repository root — an explicit `worktree=false` run, non-Git degradation, or a continuation whose worktree cannot be restored — to proceed without Onni Work’s repository-root lease. Agents can overwrite each other’s files or Git state; isolated worktree runs are unaffected. Off by default; only the exact value `1` enables it. |
| `ONNI_SINGLE_PROJECT=1` | Opt into a launch-project-only cockpit: only the exact value `1` enables it. Project add, edit, checkout, folder browsing, and removal are refused and only the launch project is shown. Off by default; stored registry rows are retained, so unsetting it and restarting restores the full multi-project workspace without migration or data loss. |
| `ONNI_HIDE_TOKEN_USAGE=1` | Hide raw input/output token counts throughout the browser cockpit while leaving backend-reported cost visible. Only the exact value `1` enables it; API payloads are unchanged, and a restart is required after changing it. |
| `ONNI_HIDE_COST=1` | Hide backend-reported monetary cost throughout the browser cockpit while leaving raw input/output token counts visible. Only the exact value `1` enables it; API payloads are unchanged, and a restart is required after changing it. |
| `ONNI_HIDE_TOKEN_METRICS=1` | Legacy master switch that hides both token usage and cost. It takes precedence over the two independent flags; only the exact value `1` enables it, payloads are unchanged, and a restart is required. |
| `GITHUB_TOKEN` | Fallback for GitHub reads/PRs when `gh` isn't authenticated. |
| `ONNI_ENV_PASSTHROUGH=A,B` | Forward these extra host env vars to spawned agents. By default agents get a least-privilege env (safe shell/toolchain vars + the backend's own auth + `GITHUB_TOKEN` + `ONNI_*`), not your full environment — use this to add a var an agent needs. |
| `ONNI_AGENT_ENV_FULL=1` | Escape hatch: give spawned agents the full host environment (pre-hardening behavior). Off by default; only set it if you understand that this hands every host secret to the agent process. |
| `ONNI_AGENT_TMPDIR=0` | Stop giving each task its own temp directory and hand agents the host `TMPDIR` again (pre-#785 behavior). On by default: every run gets `TMPDIR`/`TEMP`/`TMP` pointing at `.ai/onni/tmp/<task-id>`, created and write-probed before the agent spawns and reaped when the run ends, so concurrent tasks stop sharing one directory and a task refuses to start rather than run against a temp directory that silently swallows its shell output (see Troubleshooting below). Only an exact `0` disables it, and it disables the whole thing — the pre-spawn check included, so this stays an escape hatch you can actually take. |
| `ONNI_SECRETS_KEYCHAIN=0` | Keep the secret store's data key out of the OS keychain and use the `0600` key file `~/.onni/secrets/.key` only. By default the key goes to the keychain (macOS Keychain, Linux Secret Service, Windows Credential Manager, via the optional `@napi-rs/keyring`) when one is usable, and to the file otherwise; Settings → Secrets and `onni secrets list` say which. Only the exact value `0`. |
| `ONNI_REDACT_SECRETS=0` | Disable scrubbing of credential values/token shapes from the on-disk state (the NDJSON transcript and the free-text fields of `runs.json`). On by default; leave it on. Best-effort defense-in-depth, not a guarantee: it catches known token shapes and the values of your own secret-named env vars, so a credential in neither category can still get through. |
| `ONNI_TITLE_UPDATES=0` | Turn off the live task-title refresh (namer re-runs on each turn end). The Settings → Tasks toggle overrides this default. |
| `ONNI_AUTONAME=0` | Disable ALL LLM task naming (creation + live) — titles stay heuristic (`437: /om-auto-review-pr`). Under `ONNI_DRY_RUN=1` naming is already off unless forced with `ONNI_AUTONAME=1`. |
| `ONNI_REVIEW_GATE=1` | Turn ON the optional diff-first review gate (#489): a successful, non-autonomous run with changes parks at `review` (Accept / Send back / Draft PR) instead of finishing. Off by default — changed runs settle to `done` with the diff left in the worktree. Only `1` enables. The Settings → Tasks toggle overrides this; autonomous runs always skip it. |
| `VITE_ONNI_API_BASE=http://localhost:4321` | **Build time only**, and only when the cockpit bundle is deployed apart from the service it talks to. Empty (the default) means "the origin that served this page", which is right for both normal cases: the CLI serves the bundle itself, and `npm run dev` proxies `/api` to the local service. A deployment that must be configured without a rebuild can put `<meta name="onni-api-base" content="…">` in the served HTML instead, which wins over this. |

### Troubleshooting: the agent's shell returns nothing

**Symptom.** A task on the Claude backend keeps working, but every shell command
comes back with no output and a spurious non-zero exit status — `echo hello`
included. Redirecting into a file inside the worktree still produces the right
content, so the commands genuinely run; only the *capture* is lost. Codex tasks
on the same machine are unaffected, because that backend streams over stdio
pipes instead of round-tripping a command's output through a temp file.

**Diagnosis.** The temp directory the agent was given is out of space or out of
quota. One line tells you:

```bash
echo probe > "${TMPDIR:-/tmp}/probe"   # "Disk quota exceeded" / "No space left on device"
df -i "${TMPDIR:-/tmp}"                # a tmpfs can exhaust inodes long before bytes
```

Under quota the file is *created* and the write then fails, so the backend reads
back a zero-byte capture file and hands the agent an empty result.

**Fix.** Since #785 Onni Work gives each task its own `TMPDIR` under
`.ai/onni/tmp/<task-id>` and write-probes it before spawning, so a broken temp
directory fails the task with `agent temp directory is not writable: …` on the
task thread instead of corrupting its work. If you see that error, free space on
the disk holding the repo. `ONNI_AGENT_TMPDIR=0` turns the whole mechanism off —
per-task directory and pre-spawn check alike — and hands agents the host
`TMPDIR` again, which is the way out if the check itself is wrong on your
platform.

---

## Talking to a running cockpit

The cockpit is a local HTTP server; three CLIs and any script can talk to it
while it runs. They find it through `ONNI_API_URL` — the address the cockpit
printed after `cockpit →` when it started (`http://127.0.0.1:4321` unless that
port was busy or you passed `--port`).

### From a shell: `onni runs`, `onni task`, `onni automation`

Inside a task, Onni Work sets `ONNI_API_URL`, `ONNI_PROJECT_ID` and `ONNI_TASK_ID` for
the agent. From your own terminal, set the address yourself:

```bash
export ONNI_API_URL=http://127.0.0.1:4321
onni runs list                       # this project's tasks, newest first
onni runs list --status running,review --json
onni automation list                 # automations, with state and counts
onni task tree <run id>              # a dispatch tree
```

On a cockpit that serves several projects, add `ONNI_PROJECT_ID=<id>`
(`onni projects` lists the ids); without it every command addresses the
project the cockpit was started in.

`ONNI_API_URL` is never guessed. For an agent, its absence is how the cockpit
says dispatch or automations are unavailable, and a fallback would let a task
write to whatever cockpit owns the port. So a command run without it exits `2`
and explains how to set it (inside a task, it tells the agent to stop and
report instead).

`onni runs` is read-only. Cancel, relaunch and archive from the cockpit, or call
the API below.

### Limits and unattended safety

Every run carries a snapshot of its **limits** (Settings → Resources → Limits, the composer's *Limits* pill, or
the CLI): *Capped* applies exactly the ceilings you give — max cost (USD), max tokens
(cost-weighted: cache reads count at 10%), max minutes of active running time, max agent steps —
and a blank ceiling is no limit on that axis; *Unlimited* (`∞`) applies none. A fresh install is
capped at 10 USD, 10 000 000 tokens, 240 minutes and 30 steps. Changing the setting affects new runs
only. A dispatched task inherits its parent's mode and may never be looser; a tree shares its root's
ceilings. Backends that report no USD (antigravity, codex, copilot, cursor) ignore the cost ceiling, and cursor
reports no tokens either. A run that hits a ceiling is cancelled with the reason on the record; its
worktree and session stay, and Continue asks before raising the ceiling by one more allowance.

```bash
onni run "refactor the parser" --limit cost=5,time=120,tokens=5000000,iterations=20
onni run "explore freely" --no-limit          # refused inside an agent task
onni stop --all [--port 4321]                 # emergency stop: every queued and live task
```

These stay on in **both** modes (Settings → Resources → Limits → *Advanced*): an autonomous or dispatched
task that waits for an answer longer than `safety.waitExpiryMinutes` (default 30) ends `failed`
(Continue answers it); dispatch depth (default 1), subtasks per tree (default 12) and `retry_limit`.
Autonomous and dispatched runs also never auto-land: `landing: "auto"` applies to attended in-place
runs only. They get a `pre-push` hook refusing any ref outside `refs/heads/onni/*`, and Claude
sessions deny `git push`. **This is a fence, not a sandbox**: `--no-verify`, an agent that rewrites its
own git config, writes outside its worktree, reads `$HOME` or uses the network are not stopped.

`POST /api/v1/workspace/stop-all` → `{ "stopped": n }` is the emergency stop. `POST /runs` accepts
`limits` (`{ mode: "default" | "none" | "capped", maxCostUsd?, maxTokens?, maxWallClockMinutes?,
maxStepIterations? }`) and `POST /runs/:id/continue` accepts `raiseLimits`.

### Manager / Worker

One agent can manage a task and hand work to a **roster** you choose; agents you do not list are never
used. Pick it in the new-task composer (**Manager / Workers**, optionally from a preset saved under
Settings → Manager–Worker), or from a shell with a cockpit running:

```bash
onni run "migrate the API to v2" --manager claude:opus --workers codex:gpt-5,opencode
```

Each worker is a backend, an optional model (the same backend may appear twice on different models), a
free-text role the manager reads, and how many of its tasks run at once. Only backends that are connected
and enabled can be chosen. The manager hands work over with `onni task create … --backend X --model Y`
(`--runner` still works); the server answers a backend outside the roster with `409` and the allowed list.
Workers fork the manager's branch (its uncommitted work is committed first as `onni: wip before dispatch`),
cannot dispatch further, and report back; the manager merges their `onni/<id8>` branches into its own
branch, resolves conflicts, runs the checks after each merge and reports. The roster is an
orchestration fence, **not a security boundary**: an agent can still call a CLI or the HTTP API directly,
and a top-level task created over raw HTTP is not bound to a roster. Cost, token, time and step ceilings,
the subtask cap and the wait expiry apply to the whole tree (see Limits above); `POST /runs` accepts
`roster`, and workspace presets live in `~/.onni/config.json` (`managerWorker`).

A backend can be a **worker only**: `RUNNER_CAPABILITIES[<backend>].canManage` in the contract is `false` for
`antigravity`, whose headless allow-rules are not yet verified for the manager's commands (`onni task create`,
`git merge`). The server refuses it as a manager (400, with the reason) — in `POST /runs`, `onni run --manager`
and saved presets alike — and the composer and Settings list it among the workers only.

### Antigravity permissions

Settings → **Agent permissions** (global; `agentPermissions.antigravity` in `~/.onni/config.json`) chooses what
`agy` may do without asking, because it cannot ask when Onni drives it:

| Level | What it passes to `agy` | What it can do |
|---|---|---|
| **Files only** (default) | nothing | No shell commands: tests, builds and git are denied. agy's own file and web tools are not limited by this level either, so it can still read and write outside the worktree and search the web. |
| **Narrow allow-rules** *(experimental)* | `--settings` with `command(<line>)` grants | Only these **exact lines**, each as the whole command: `git status`, `git status --short`, `git diff`, `git diff --stat`, `git log --oneline`, `git add -A`, plus the step's own test/build commands (`bashAllowlist` entries — for this backend each is one exact line, not a prefix). Anything added to a line — an argument, a redirect, a pipe, `&&`, `;`, `$()` — is denied, and so are `git push`, network tools and bulk delete. **It limits shell commands only:** agy's own file and web tools are not limited by it (they can read and write outside the worktree and search the web, per agy's own policy). `git commit` is not granted — Onni's autosave commits the worktree at the end of a turn. |
| **Skip all confirmations** | `--dangerously-skip-permissions` | Everything agy asks for is auto-approved — shell, browser and web tools included. Chosen explicitly (a confirmation dialog; the server rejects `bypass` without `confirmBypass: true`). |

`Skip all confirmations` is **never applied to an unattended task** (autonomous, or any dispatched worker): those
run on `Narrow allow-rules` and the run says so. A manager–worker preset cannot carry a level.

### The HTTP API

- **Everything is under `/api/v1`.** The unversioned `/api/*` spelling was
  removed on purpose and answers `404` — `GET /api/v1/runs` is right,
  `GET /api/runs` is not.
- **Project scope.** Every project route also answers under
  `/api/v1/p/<projectId>/…`; the unscoped path is bound to the project the
  cockpit was started in. Workspace-wide routes (`/api/v1/projects`,
  `/api/v1/workspace/…`) have no scoped twin.
- **Discovery.** `GET /api/v1/health` answers without the request-origin guard,
  so it is the call to probe whether a cockpit is up and which version it runs.
- **Routes and shapes.** Routes are chained into family builders in
  [`packages/work/src/server/server.ts`](../packages/work/src/server/server.ts);
  every request and response is a zod schema in
  [`packages/contract`](../packages/contract/src), and `contract-parity*.test.ts`
  plus `route-parity.test.ts` keep the two aligned (see
  [BACKWARD_COMPATIBILITY.md](../BACKWARD_COMPATIBILITY.md) §2).
  The common ones: `GET/POST /runs`, `GET /runs/:id`,
  `POST /runs/:id/{cancel,messages,continue,archive}`, `GET /automations`.
- **No built-in auth.** The cockpit binds `127.0.0.1` and trusts the machine;
  see [Remote access](#remote-access-host-onni-work-on-a-server) before exposing it.

---

## Coding agent backends

Onni Work is not married to one vendor. Every agent step runs through a single
`AgentRunner` seam with seven built-in backends:

| Backend | CLI | How Onni Work drives it | Tool access |
|---|---|---|---|
| **Claude Code** (default) | [`claude`](https://github.com/anthropics/claude-code) | Headless `stream-json` mode. | Per-tool `--allowedTools` (`bashAllowlist` scopes `Bash`); `dontAsk` denies unapproved tools without prompting (`ONNI_APPROVAL_GATE=1` selects `acceptEdits`, but Onni Work cannot answer permission prompts). |
| **Codex** | [`codex`](https://github.com/openai/codex) | `codex app-server` — JSON-RPC over stdio, the same transport the Codex IDE extensions use. | Ignores `allowedTools`; the default auto mode uses `danger-full-access` with `approvalPolicy: never` (`ONNI_CODEX_NETWORK=0` opts into the network-blocked `workspace-write` sandbox). |
| **Junie** _(experimental)_ | [`junie`](https://junie.jetbrains.com/cli) | `junie --acp=true` — the real Agent Client Protocol over stdio, the same transport JetBrains IDEs use. | Ignores `allowedTools`; every permission is auto-approved. |
| **OpenCode** _(experimental)_ | [`opencode`](https://opencode.ai) | `opencode serve` — a local HTTP server with an SSE event stream. | Ignores `allowedTools` entirely; every permission is auto-approved. |
| **Cursor** | [`agent`](https://cursor.com/docs/cli/overview) (Cursor Agent CLI) | Headless print mode: `agent -p --force --trust --output-format stream-json`. Continue is fresh-session in v1 (print mode exits per turn). Its documented output carries no token/cost figures, so a Cursor run's header always reads zero tokens and no cost — that is the backend not reporting usage, not the run using nothing. | Ignores `allowedTools`; `--force` / `--trust` auto-approves tool use for unattended runs. |
| **pi** _(experimental)_ | [`pi`](https://github.com/badlogic/pi-mono) | Persistent `--mode rpc` over JSONL; models are picked with the `provider/model` convention. | Maps `allowedTools` onto pi's `--tools` allowlist; a configured `bashAllowlist` disables Bash because pi cannot express command-prefix rules. |
| **Antigravity** | [`agy`](https://antigravity.google) (Google Antigravity CLI) | Headless print mode: `agy -p <prompt> --output-format stream-json` over a pipe, one process per turn; Continue resumes with `--conversation <id>`. Reports tokens only — no USD. Needs `agy` signed in (checked with `agy models`, no model call). | **Fails closed.** agy cannot ask for approval headless, so by default (`Files only`) it edits files and a shell command is denied. A turn that was blocked and answered nothing **fails**, naming what was denied; one that answered anyway keeps going with a warning per denied action. See *Antigravity permissions* below. |
| **GitHub Copilot** | [`copilot`](https://github.com/github/copilot-cli) | `copilot --acp --allow-all-tools --no-auto-update` — ACP over stdio, one long-lived child per task. | Ignores `allowedTools` / `bashAllowlist`; `--allow-all-tools` is the auto permission mode, and a permission request that still arrives is auto-approved. |

> ⚠️ **Junie, pi and OpenCode support are experimental.** All three runners work
> but are less battle-tested than the Claude Code and Codex backends, and Junie,
> OpenCode and Copilot auto-approve every permission (they ignore `allowedTools`).
> Treat them as previews and expect rough edges.

On startup Onni Work probes which CLIs are installed and the cockpit only offers
the backends it found — install any one of the seven and you're operational.

**Models come from your own machine.** The model picker does not ship a list of
vendor releases that goes stale between Onni Work versions. For Claude, Codex, Cursor, Junie and
OpenCode Onni Work asks the CLI on your host what *it* currently offers (Claude
Code's `list_models` control request; the Codex app-server's `model/list`;
Junie's ACP `session/new` config options; `opencode models`) and shows exactly
that, in that order — so a model your account gained yesterday is selectable
today with no Onni Work release, and one your provider retired stops being offered.
Discovery is read-only, costs no tokens, and is cached briefly in memory. If the
CLI is missing, logged out, too old or slow, the picker quietly falls back to
that runner's built-in entries (`auto` plus Claude's tier aliases) and says so
in a status row; `pi` and GitHub Copilot, which have no host-local catalog yet,
always show their built-in entries. `auto` — send no model at all and let the CLI decide — is
always available, and a model you pinned by hand stays selectable even when it
is no longer advertised.

**Pick a backend at three levels** (most specific wins):

1. **Config default** — `"defaultRunner": "codex"` in `.ai/onni/config.json`.
2. **Per task** — the backend picker next to the task box in the cockpit.
3. **Per workflow step** — `runner:` on any step in the YAML.

Per-step overrides are what make **mixed-agent strategies** a one-liner:
implement with one agent, review with another, and let a shell check referee:

```yaml
name: implement-and-cross-review
steps:
  - id: implement
    name: Implement
    prompt: "{{task}}"
    runner: codex                # one vendor writes the code…
  - id: review
    name: Cross-review
    prompt: "Review the diff produced for: {{task}}. Fix real issues only."
    runner: claude               # …another one reviews it
  - id: verify
    name: Verify
    command: "npm test"
    onFail: { retry: implement, max: 2 }
```

Parallel variants (×2/×3) of one task share that task's backend — mixing
happens per task and per step, not inside a variant group.

The seam is deliberately small: a backend is one class implementing the
`AgentRunner` interface (`packages/work/src/core/agent-runner.ts`) that turns a prompt into
a stream of normalized events. Other CLIs — pi, aider, whatever ships next —
can slot in the same way.

---

## Remote access (host Onni Work on a server)

Onni Work runs on `localhost` by default. To reach the cockpit from another machine —
a shared team box, a VPS, your phone — put an **authenticated public front** in
front of it. The built-in installer does this interactively, per **platform
strategy**, and never escalates silently: every privileged command is printed
and verified, and it ends with a real authenticated end-to-end check.

```bash
onni server-install   --platform ubuntu-vps   # stand it up
onni server-deploy    --platform ubuntu-vps   # roll out a new version (reload the service)
onni server-uninstall --platform ubuntu-vps   # reverse it

# host a SECOND cockpit for another domain on the same box (ubuntu-vps):
onni server-install   --platform ubuntu-vps --domain shop.example.com
```

From a source checkout the same commands run as `npm run server-install -- …`,
`npm run server-deploy -- …` and `npm run server-uninstall -- …`.

On `ubuntu-vps` a single host can run several independent cockpits — add
`--domain <host>` and each gets its own port, nginx site, login and service; a
new domain never resumes or clobbers the first install.

**Already running a reverse proxy?** If Dokploy, Coolify, Caddy or your own
nginx already owns `:80/:443`, Onni Work's would fight it for the ports. Install the
service only and let your proxy front it:

```bash
onni server-install --platform ubuntu-vps \
  --external-proxy --domain onni.example.com --bind-host 172.17.0.1
```

`--bind-host` is only needed when the proxy runs in a **container** (Traefik
can't reach the host's loopback); a host-installed proxy uses the `127.0.0.1`
default. In this mode **your proxy must enforce authentication** — Onni Work has
none of its own.

| Provider | `--platform` | Public front |
|----------|--------------|--------------|
| Ubuntu / Debian VPS | `ubuntu-vps` | nginx + Let's Encrypt HTTPS, htpasswd login, systemd |
| Ubuntu + existing proxy | `ubuntu-vps --external-proxy` | your Dokploy/Traefik/Caddy front; Onni Work ships the service only |
| macOS + ngrok | `macosx-ngrok` | ngrok tunnel + `--basic-auth`, launchd |

---

## Configuration (optional)

Workspace-wide defaults for run limits (`limits`) and the hang/dispatch guards (`safety`) live in
`~/.onni/config.json` and are edited in Settings → Resources → Limits; they take no environment variable.
The Antigravity permission level (`agentPermissions.antigravity`: `files-only` · `allow-rules` · `bypass`) lives
there too, edited in Settings → Agent permissions.

Zero config is the default — everything below is opt-in via
`.ai/onni/config.json` (a missing or invalid file simply uses the defaults, and
never blocks startup; configured lifecycle transitions pause on malformed configuration rather than treating it as an empty cleanup list):

```jsonc
{
  "skillsRepos": [{ "repo": "acme/team-skills", "ref": "main" }], // team skills; [] (the default) disables
  // Team-skill repos are code-trusted: a skill body becomes an agent system prompt.
  // Only owner/name, https/ssh URLs, or local paths (`/abs`, `./rel`, `~/dir`,
  // `C:\dir`) are accepted — no ext::/fd:: transport helpers. Write a relative
  // path as `./name`, not a bare `name`. Pin `ref` to a full commit SHA to freeze
  // the source against a moving branch head — Onni Work verifies it resolves to
  // exactly that commit, and reports it as `team.commit`.
  // Skills repos shared by every project (e.g. your organisation's) are added in Settings →
  // Global → Skills, not here; they are stored in `~/.onni/config.json` (`orgSkillsRepos`)
  // and merged after this list, with the same source rules. Only markdown under a folder named
  // `skills/` (any depth) is picked up from them: `…/skills/<name>/SKILL.md` is a directory skill
  // (its other files are its references), any other `…/skills/**/*.md` a flat one.
  "worktreeRetention": 10,   // keep the last N finished worktrees on disk; 0 = unlimited (branch always kept)
  "defaultRunner": "claude", // agent backend: "claude" (default) · "codex" · "opencode" · "cursor" · "pi" · "junie" · "copilot" · "antigravity"
  "modelsLocked": true,      // optional: native per-runner model is fixed/read-only; runner stays selectable
  "plannerModel": "sonnet",  // model the "Plan first" button uses to draft chains
  "baseBranch": "develop",   // branch worktrees fork from + PRs target (also settable in the Git tab)
  "branchNaming": "your branch naming preferences",
                             // optional: task branches are named from the first prompt under these
                             // instructions (Settings → Instructions); absent = onni/<id8>
  // Trunk-based projects (Settings → Tasks → Development model); every key optional:
  "taskWorkspace": "in-place", // tasks work in the checkout, write tasks one at a time
  "landing": "auto",           // finished in-place tasks commit, rebase, run requiredChecks, push
                               // (ignored while this file is tracked by git)
  "requiredChecks": ["npm test"],
  "defaultSkill": "my-skill",   // composer preselect; "askSkill" for read-only Ask tasks
  "startApp": { "services": ["npm run api", "npm run web"], "url": "http://localhost:5173" }
                             // optional: what the Preview's Start app runs, each service in its own
                             // terminal tab; url = the address to show (absent: the first one printed).
                             // A `startApp` in your project entry of ~/.onni/config.json wins.
}
```

**Trunk-based projects** (many small changes that should land straight on the
base branch — a docs or notes repo, a config repo, a solo project): set
**Settings → Tasks → Development model** to *Trunk-based*. Tasks then run in the
repo checkout instead of a worktree, write tasks take turns so two tasks never
conflict. A finished task waits for your review in Changes; reply with
corrections, then **Finish** commits, rebases on the remote, runs
`requiredChecks` and pushes to the base branch. Autonomous tasks land on their
own. A failed rebase or check goes back to the agent. The composer's **Ask** chip starts a
read-only question: no branch, no lease, runs beside a write task. Spec:
`.ai/specs/2026-10-20-trunk-based-projects.md`.

Put the same `"modelsLocked": true` key in `~/.onni/config.json` to apply it
to every registered project. When the key is absent or `false` in both config
files (and `ONNI_AGENT_MODELS_LOCKED` is not `1`), each runner's normal model
selector uses that runner's discovered model list. While locked, the model is
shown read-only and follows the selected runner's native settings; the runner
itself remains selectable.

Run data (`runs.json`, NDJSON event logs, worktrees, `todos.json`) is
git-ignored automatically; your workflows and skills stay committable.

Settings that belong to *you* rather than to a repo — the parallel cap
(`maxParallel`, default **2**), the per-task memory ceiling and the checkout
root — live once in `~/.onni/config.json`, alongside the
[project registry](#multiple-projects-one-cockpit), and are edited from
**Settings → Resources** and **Settings → Projects**. A `maxParallel` left over
in a repo's `.ai/onni/config.json` is imported into the workspace file the
first time Onni Work boots there, and ignored afterwards.

**Settings → Resources** opens on a live **Machine** card, and the sidebar carries
the same numbers as a one-row **glance** (CPU, its 60 s sparkline, compact RAM)
that links here. Samples arrive every ~2 s: a local cockpit gets them pushed over
the `host` WebSocket topic, a remote one reads `GET /api/v1/workspace/host-usage`
on mount, on a reconnect and when the tab becomes visible again - and follows a
first answer that carries no CPU figure with exactly **one** warm-up read ~2.5 s
later. That gap is honest, not a bug: CPU utilization is a delta between two
samples, so the first read after an idle period has no window to measure and the
readout shows `sampling…` instead of a number it cannot back. A metric the OS
does not expose (swap outside Linux, load on Windows) is omitted rather than
printed as a zero. The `updated N s ago` line is the age of the sample's own
server timestamp and ticks every second while the card is mounted, so a cockpit
that has stopped receiving data counts up instead of freezing at a fresh-looking
value. The 60 s sparkline is **local-only**: a remote cockpit's route answers are
sparse, so it shows the instantaneous bar and no chart rather than plotting
minutes as if they were seconds. A remount always re-reads the route (the host
query overrides the workspace's five-minute `staleTime`), so a cached sample can
never be stamped as fresh.

**Which numbers are effective.** The plain process reads **host totals**. When
Onni Work runs inside a cgroup with a real limit - a Docker `--cpus`/`--cpuset-cpus`,
a systemd scope, a sandbox - the same payload carries an optional `container`
object with the process's OWN cgroup limits and usage, and the card and the
glance show those as the effective values, labelled, with the host totals kept as
context (`host 64 CPU · 755 GB`). A usage-only cgroup emits no `container` at
all, so a normal host reads exactly as it always did. A limit whose value cannot
be read shows `—`; the host figure is never substituted for it. When one is
present, cpu/memory labels say `(effective)` and the load chip pairs with the host
core count. One case is deliberately NOT rendered as "no limit": when the probe
cannot read the process's cgroup at all (a masked `/proc`, no cgroupfs mounted)
the payload carries `cgroupProbe: 'unavailable'` and the card says **no cgroup
information available** — the process may well be capped, and host totals are not
evidence that it is not.

**When the sampler runs.** Below `md` the card's own subscription is the demand
(sampling lasts while the card is on screen, exactly as before). On a local
desktop the topic is held for the session, because the sidebar glance is always
there; the sidebar's machine row carries the staleness clock (`stale` after ~10 s
without a frame). A remote cockpit never opens a socket and keeps reading the
route. The `host` topic is **trusted-only**: the hub admits a socket whose page
origin matches the server's authority, and refuses the subscription (`forbidden
topic`) for anything else - a dev server proxying a `localhost` page to
`127.0.0.1` without `Sec-Fetch-Site: same-origin` is the common case. The card
says so and falls back to the authenticated same-origin route instead of showing
`sampling…` forever.

### Editing the agents' own config (Settings → Agent config)

Onni Work picks *which* agent runs; **Settings → Agent config** lets you edit *how* it
behaves — the raw config files Claude, Codex and OpenCode read for settings,
MCP, and memory. In the multi-project cockpit the section is project-scoped:
repo-relative files resolve from the selected project's root, while user-scope
files continue to resolve from the agent's home.

Each file keeps its native format and vendor-documented precedence. Tracked
files reach task worktrees after commit; Claude's gitignored personal layer is
seeded into each run's worktree. Editing is a local-machine capability, so a
hosted cockpit (`ONNI_REMOTE=1`) is read-only and never serves home-file contents.

---

## Worktree lifecycle scripts

**Project Settings → Worktrees** contains two optional ordered lists: **After
worktree creation** prepares a new directory before the agent starts; **Before
worktree removal** cleans up while its files still exist. Both lists default to
empty. There is no required config file, global inheritance, environment switch,
or command execution for projects without hooks. These are local settings for
the selected project, saved under `worktreeLifecycle` in `.ai/onni/config.json`.
Saving scripts does not execute them.

Setup also runs when Continue recreates a reclaimed directory. Continuing in an
already prepared directory does not repeat setup. Cleanup covers explicit
worktree removal, task deletion, retention/Reclaim now, discarded variants, and
known managed orphans. Finishing or archiving a task alone runs neither list;
non-Git and worktree-disabled tasks run neither list. Retention keeps its original
branch-preserving scope even when cleanup is forced. A failed cleanup may leave
the project temporarily above its retention limit; the Worktrees page shows the
operation requiring attention.

Add a display name, multiline Bash command, and optional timeout for each entry;
move entries up/down to set their order, then **Save**. Lists accept at most 32
commands each, command text up to 32 KiB and names up to 120 characters. Every
entry has a stable UUID: editing or reordering keeps it; adding a new entry creates
a new identity. Hand-authored entries must supply their own unique `id`.

The **Variables** disclosure inserts these tokens at the command editor's caret:

| Variable | Value |
| --- | --- |
| `{{ root_path }}` | Canonical absolute root of this project. |
| `{{ worktree_path }}` | The actual directory being prepared or removed; never a fallback to the project root. |
| `{{ worktree_id }}` | Stable resource identity `onni-<lowercase UUID>`, retained across reclamation and recreation. |
| `{{ task_id }}` | Original task ID, retained even if its task record is gone. |

Tokens accept optional inner whitespace. **Leave them unquoted**: Onni Work adds
shell escaping, so spaces and shell punctuation in paths remain inert data.
Static suffixes are supported:

```sh
cp {{ root_path }}/.env.local {{ worktree_path }}/.env.local
docker compose --project-directory {{ worktree_path }} -p {{ worktree_id }} up -d --build
```

For cleanup, a separate entry might use:

```sh
docker compose --project-directory {{ worktree_path }} -p {{ worktree_id }} down --volumes
```

These are examples, never installed defaults. Unknown or unclosed tokens and
tokens inside quotes, substitutions, backticks, arithmetic, comments, or
here-documents are rejected before execution. Put complex logic in a script and
pass variables as ordinary arguments. To pass literal double braces to another
tool, type `\{{` in the editor, including inside quoted strings:

```sh
docker inspect --format '\{{ .Name }}' {{ worktree_id }}
```

Onni Work consumes the escape and sends `{{ .Name }}` literally. A JSON-authored
command needs the usual additional JSON escaping for its backslash. **Preview**
only renders and redacts the command; it never runs a shell. Choose a real
worktree, or use the explicitly labelled example context.

Commands run sequentially as noninteractive `bash -c`, without a login profile,
in the worktree directory with closed stdin. Bash must be available on the host;
Onni Work does not install it or silently substitute another shell. Windows also uses
native `taskkill /PID … /T /F` to terminate an owned command tree. Native Windows
execution was not exercised by the implementation's local fixture tests. Each
command has a **30-minute wall-clock timeout**, with an optional
`timeoutSeconds` override from **1 through 86,400**. Silence is not an idle-timeout
trigger. Stop/timeout terminates supervised children; uncertain process exit
keeps the worktree protected until quiescence can be established.

Commands inherit the Onni Work host's environment and privileges. Repository `.env`
files are not automatically loaded and managed tracker/account credentials are
not injected. Source a file explicitly if your command needs it. The visiting
browser does not run these commands, including in remote mode. Output is
redacted before persistence/live delivery, limited to 1 MiB per execution with
16 KiB frames and a truncation marker; redaction covers known secrets and token
patterns, not arbitrary sensitive text a script invents.

Task Session and Worktrees show progress, attempts and expandable output.
**Retry loads the current saved lists**, in their current order. Durable
successes are reused only for the same operation, generation, entry ID, exact
command, resolved context and renderer contract. Editing a successful command
runs it again; changing only its name or timeout does not. Removed entries remain
in history but no longer run. Changing a script file alone does not invalidate a
successful entry: remove and add the entry to deliberately give it a new identity.
Saving, including clearing both lists, never resumes a failed operation; choose
**Retry** explicitly. Changes made while a command runs apply to later entries,
and configuration is checked again before the transition commits.

Setup recovery offers **Retry**, **Edit scripts**, **Start task anyway**, or
**Cancel task**. Bypass accepts an incomplete environment; cancellation retains
the directory and any resources already created. Cleanup recovery offers
**Retry**, **Edit scripts**, **Keep worktree**, or **Force delete**. Keep suppresses
automatic cleanup for that generation. Force skips remaining commands and carries
out the original removal intent: reclamation keeps its branch, whereas deleting
a task also deletes its record and managed branch. Partially stopped containers,
volumes and other resources may remain after Keep, Cancel or Force. There is no
automatic rollback of command effects.

**Stop scripts** parks the operation after stopping the current command; it does
not itself cancel a task or remove its directory. Normal shutdown and restart
wait for owned scripts to stop and save their recovery state, including scripts
in other opened projects. A crash leaves uncertain
execution for an explicit choice, never an automatic replay. There is no
exactly-once guarantee for external side effects. Completed scripts followed by a
filesystem failure appear as a commit failure; Retry rechecks current settings
before attempting the remaining transition.

Headless `onni run` uses the same preparation gate. If recovery is required, it
prints the operation ID and cockpit recovery instruction and exits **1**, rather
than waiting indefinitely or starting the agent. Normal done/review still exits
0. `ONNI_DRY_RUN=1` does not execute lifecycle commands or delete real worktrees
through this mechanism.

Lifecycle records and bounded output live independently under the ignored
`.ai/onni/lifecycle/` directory. Completed history is retained for **7 days**;
active/attention operations and retained directories are not age-pruned. Stable
identity survives as long as the task does, including after its directory was
reclaimed, so a later recreation uses the same resource identity.

**Before downgrading to a version without lifecycle support**, finish, Keep, or
explicitly Force pending operations, then disable the configured hooks. Older
binaries cannot enforce these gates and may remove directories without cleanup.
Deleting Onni Work state cannot undo external resources or reconstruct lost ownership
information.


---

## Builds and releases

Onni Work publishes nothing: there are no nightlies, previews or npm releases to install with
`npx`. Build and run it from source instead — see [Local development](#local-development) below.

---

## Local development

End-to-end, from a fresh clone to a global `onni` command you can run in **any**
repo on your machine — no npm publish required.

**1. Prerequisites** — Node 20+ and `git` (plus at least one logged-in agent CLI,
as in the [README](../README.md)).

**2. Clone & install**

```bash
git clone https://github.com/doantuan22/Onni_Work.git
cd Onni_Work
npm install
```

**3. Build** — compiles the api-client and the server (`tsc → packages/work/dist/`) and the cockpit
(`vite build → packages/work/web/dist/`), then runs the pack gate:

```bash
npm run build
```

**4. Run it** — straight from the built checkout:

```bash
node packages/work/dist/index.js          # cockpit for the current repo
node packages/work/dist/index.js --help   # flags, same binary as `onni`
```

To make this checkout the engine the **desktop app** runs, register it as a version
(see [Point the desktop app at a worktree](#point-the-desktop-app-at-a-worktree)):

```bash
node packages/work/dist/index.js link .   # a link, not a copy — rebuilds are live
```

**5. The change loop**

Edit source → `npm run build` → the linked version reflects it on the next restart. No relink
needed (it is a live symlink into this checkout — don't move or delete the checkout while it's
linked).

### Point the desktop app at a worktree

The desktop app runs whatever `~/.onni/versions/current` points at. A **linked checkout** puts a
worktree there without copying it: the version entry is a symlink to the worktree's
`packages/work`, so it runs straight off the worktree (and its own `node_modules`), and every
rebuild is live on the next restart.

A worktree has to be built to run (`npm install && npm run build` in it). Then pick one of:

- **Desktop menu**: **Onni Work ▸ Versions** lists linked checkouts by branch
  (`onni/cb28888e — 0.13.0 (worktree)`). Clicking one switches and restarts.
- **Terminal**:

  ```bash
  onni link [<dir>] --use   # link the checkout (default: cwd) and make it current
  onni unlink <id|dir>      # forget a link (the worktree is untouched)
  ```

  The desktop app picks up a terminal switch on its next start, and the Versions menu refreshes
  when the window regains focus.

Switch away before you remove a worktree the app is running from. Cockpits in hosted mode never
list worktrees and never link one.

### In-checkout scripts

```bash
npm run dev          # server (API :4321) + Vite dev server, opens the cockpit in the browser
npm run dev:server   # tsx packages/work/src/index.ts — the API server alone
npm run dev:web      # Vite dev server alone (proxies /api to :4321)
npm run build        # tsc → packages/work/dist/, vite build → packages/work/web/dist/, then the pack gate
npm run typecheck    # contract + api-client + server + web (tsc --noEmit)
npm test             # vitest — server + cockpit unit suites
npm run test:unit    # node:test — fast core-module tests
npm run test:package # pack/install and exercise the built CLI
npm run test:e2e     # real-browser cockpit suite (agent-browser)
```

The stack is deliberately small: **TypeScript** (strict, ESM), **Hono** + SSE for
the server, **Zod** at every boundary, **YAML** for workflows, and a **React 19 +
Vite + Tailwind v4 + shadcn/ui** cockpit, built into `packages/work/web/dist/` and served by
the service, so running `onni` never needs a bundler.
Every module is meant to be read in one sitting.

---
