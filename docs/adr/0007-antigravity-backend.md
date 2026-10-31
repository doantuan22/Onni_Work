# ADR 0007 — Antigravity (`agy`) as a backend: native pipe, fail-closed permissions

- Status: accepted
- Date: 2026-10-31 (revised before merge: allow-rule semantics measured, see Appendix C of the spike)
- Design: [`docs/design/antigravity-spike.md`](../design/antigravity-spike.md) (spike, step-0 results, rule semantics, deviations)
- Builds on: [ADR 0005](0005-unattended-safety.md), [ADR 0006](0006-manager-worker.md)

## Context

Google's Antigravity CLI (`agy`) should be usable as a manager or a worker like the other backends. Its
print mode (`agy -p … --output-format stream-json`) is the only headless surface, and two things make it
unlike the rest: it **cannot ask for approval** when stdout is a pipe (a tool that needs a permission is
auto-denied, and **the first denial ends the turn**), and it reports a blocked turn as **success**
(`status: SUCCESS`, empty `response`, exit 0).

## Decision

1. **Native pipe, parse stream-json.** One `agy -p` process per turn, like cursor; `Continue` resumes the same
   conversation with `--conversation <id>` (the id agy mints, saved from the `session` event). Rejected:
   - **`node-pty`**: a native addon in a workspace that ships none, ConPTY control codes in stdout, and no
     longer needed — the hang reported upstream did not reproduce on 1.4.12 (spike step 0).
   - **`agy-acp-bridge`**: its `postinstall` downloads a PowerShell script from the network and runs it with
     `-ExecutionPolicy Bypass` when `agy` is missing, and it **defaults to `--dangerously-skip-permissions`**
     (`dist/agyArgs.js`). One maintainer, three months old. Not a dependency, and not a documented option.
   - **Skipping Antigravity**: no technical reason to.
2. **A blocked turn is a failed turn.** `result.denied_actions` carries no command text, so the runner joins it
   with the `tool` frames that ended in a permission error. Then (`evaluateAntigravityResult`):
   - empty response **and** denied actions → the run **fails**, listing every denied action;
   - empty response, nothing denied → the run **fails** (nothing visible was done);
   - a response **and** denied actions → the run continues, with one `denied-action` note per action. The
     notes land on the run, `RunRecord.deniedActions` lists them on the task page and in the morning digest.
3. **Tokens only, no USD.** The stream has no cost. `antigravity` joins `RUNNERS_WITHOUT_COST`, so a cost
   ceiling does not apply to it and the cockpit says "not reported"; token, time and iteration ceilings do. A
   resumed `result.usage` is **cumulative over the conversation**, so the runner sums the step usages of the
   process instead (otherwise `Continue` would count earlier turns again).
4. **Three permission levels, per backend, in Settings → Agent permissions** (`agentPermissions.antigravity`):
   `files-only` (default; no flag), `allow-rules` (a `--settings` allowlist; **labelled experimental**) and
   `bypass` (`--dangerously-skip-permissions`).
   - `bypass` is explicit: a confirmation dialog, and the server refuses it without `confirmBypass: true`.
   - **It is never inherited.** An unattended run (autonomous, or dispatched — every manager–worker child)
     runs on `allow-rules` even when Settings says `bypass`, and says so in a run note. Presets
     (`rosterSchema` is closed) cannot carry a level, and neither can a `dispatch` request.
5. **A grant is one exact command line (measured).** `command(<line>)` matches the WHOLE line: `command(git add -A)`
   ran `git add -A`, `command(git add)` and `command(git add *)` did not, `command(git status)` denied
   `git status --short`, and a redirect, `&&`, `;`, a pipe, `$()` or a backtick after a granted command was
   denied (10 real prompts, sentinel files as proof: spike Appendix C). So an allow-rule cannot be widened by
   syntax, and it cannot be a pattern. The default set is six read-only git lines (`ANTIGRAVITY_WORKER_COMMANDS`)
   plus the step's own test/build commands, each as **one exact line** (`bashAllowlist` entries are prefixes
   for Claude; here `npm test` allows `npm test` and nothing longer). Anything with shell syntax is dropped, and
   push, network and delete lines are dropped even from a step. `git commit` is not granted: its message
   differs every time, and Onni's own autosave commits the worktree at the end of a turn.
6. **What allow-rules do NOT limit, measured: agy's own file and web tools.** With the machine's agy config
   (`nonWorkspaceFileAccessPolicy: ALLOW`) the file tools wrote `../sibling/…` and read a secret outside the
   worktree, and the agent called `search_web` on its own — all under `allow-rules` (and the same holds under
   `files-only`). `command()` rules gate shell commands only. This is why the level stays **experimental** and the
   UI and docs say so. Onni cannot change agy's own policy; a user can, in agy's settings.
7. **`canManage`** (`RUNNER_CAPABILITIES` in the contract): `false` for antigravity. `rosterSchema` refuses it
   as a manager — at the door, the CLI and a saved preset alike — and it is offered as a worker only, with the
   reason shown. It stays `false`; what turning it on takes is under *To enable `canManage`*.
8. **It cannot hang a run, and a login is never waited for.** Two watchdogs (no output after start; silence
   mid-run, reusing the run's own `timeoutMs`), a post-`result` exit grace, and a tree kill (`taskkill /T` on
   Windows, the process group elsewhere) when the run ends, is stopped or onni exits. **stdin is closed at
   spawn** (verified with the real agy), so an agy asking for a pasted login reads EOF instead of waiting. A
   run whose stderr, `AGY_ERROR` line (exit code 3, documented in `agy changelog`) or non-JSON output says
   "sign in" fails with *authentication failed — not signed in: run `agy` once…*; `classifyAgentFailure` files it
   under `auth`, so the run gets the sign-in guidance, `RunRecord.failureClass = 'auth'` is set and the morning
   digest shows "needs sign-in". The real wording was never captured, so the patterns are loose and tested on
   synthetic scenarios only. Output is buffered from spawn: Node discards a child's unread stdout when it
   exits, which dropped every frame of a fast-failing agy.
9. **Detection without a model call**: installed = `agy --version`; signed in = `agy models` lists at least
   one model (also the model catalog). A dry run uses a bundled mock for both. Version goes on the run record
   (`agentVersion`) and in the run's first agent event, because agy updates itself between runs.

## Rule sets

Worker and solo task (implemented): `git status`, `git status --short`, `git diff`, `git diff --stat`,
`git log --oneline`, `git add -A`, and the step's own commands, each exact. Report-back needs none: a settled
child reports to its parent by itself, and `onni task report` takes free-text arguments that an exact grant cannot
carry.

Manager (**not implemented**): see below. Never granted to either role: `git push`, `curl`/`wget`/`gh`, `rm`,
`sudo`, `npm publish`.

## To enable `canManage`

The manager's commands take free-text arguments (`onni task create "<objective>" --backend … --model …`,
`git merge <branch>`), and an exact grant cannot. It would take, in order:

1. **A way to call onni with fixed lines.** For example `node "$env:ONNI_BIN" task create --from-file <path>`:
   the agent writes the request with its file tool (allowed), then runs the one granted line. Or `bypass` for the
   manager only. Neither exists.
2. **The right spelling of `$ONNI_BIN` per shell.** agy's shell on Windows is PowerShell: the dispatch prompt's
   `node "$ONNI_BIN" …` expands to nothing there (no sentinel ran), while `node "$env:ONNI_BIN" …` ran. A rule
   matches the command text *before* expansion, so the rule and the prompt must carry the same, shell-correct
   text.
3. **`git merge` / `git cherry-pick` of a branch whose name varies** (`onni/<id8>`): one grant per branch, or
   `bypass`.
4. **A real manager run end to end**, not only the pieces: dispatch, wait, reports, merge, on the real agy.

## Consequences

- Antigravity is a worker whose default is "edits files, runs nothing". `allow-rules` adds read-only git and the
  step's exact test/build lines. A worker cannot commit or report itself; Onni's autosave and the settle-time
  report cover both.
- An unattended worker can never skip permissions, however Settings is set (ADR 0005).
- Accounts: agy authenticated with an empty HOME, so its login is not under `~/.gemini` and no variable moves
  it. `PROFILE_ENV_VAR.antigravity` is `null`; a second Antigravity account is not supported.
- `--add-dir` is not passed: with it agy wrote the task's file into the added directory instead of the cwd.
- A step's `bashAllowlist` means "prefix" for Claude and "this exact line" for Antigravity. Documented, not hidden.

## Not verified

- `;` and `&` on their own (the `;` chain `git status ; git push` and `&&` were denied), and extra arguments on
  `node --version`. They follow the same whole-line mechanism but were not run alone: each denial ends a turn,
  and the budget was 10 prompts.
- `git push` run on its own (it was denied inside the `;` chain, remote unchanged).
- `read_file`/`write_file` path grants and their Windows spelling (not needed on this machine's config).
- `--sandbox`, `--mode`, `--input-format stream-json`, workspace trust, quota exhaustion, the real "not signed in"
  output, and a command agy leaves running after its own exit on Windows.
- A real manager run. **`canManage` stays `false`.**
