# ADR 0007 — Antigravity (`agy`) as a backend: native pipe, fail-closed permissions

- Status: accepted
- Date: 2026-10-31
- Design: [`docs/design/antigravity-spike.md`](../design/antigravity-spike.md) (spike, step-0 results, deviations)
- Builds on: [ADR 0005](0005-unattended-safety.md), [ADR 0006](0006-manager-worker.md)

## Context

Google's Antigravity CLI (`agy`) should be usable as a manager or a worker like the other backends. Its
print mode (`agy -p … --output-format stream-json`) is the only headless surface, and two things make it
unlike the rest: it **cannot ask for approval** when stdout is a pipe (a tool that needs a permission is
auto-denied), and it reports a blocked turn as **success** (`status: SUCCESS`, empty `response`, exit 0).

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
     notes land on the run, and `RunRecord.deniedActions` feeds the morning digest.
3. **Tokens only, no USD.** The stream has no cost. `antigravity` joins `RUNNERS_WITHOUT_COST`, so a cost
   ceiling does not apply to it and the cockpit says "not reported"; token, time and iteration ceilings do. A
   resumed `result.usage` is **cumulative over the conversation**, so the runner sums the step usages of the
   process instead (otherwise `Continue` would count earlier turns again).
4. **Three permission levels, per backend, in Settings → Agent permissions** (`agentPermissions.antigravity`):
   `files-only` (default; no flag — file edits in the worktree, commands denied), `allow-rules` (a narrow
   `--settings` allowlist of `command(<prefix>)` grants) and `bypass` (`--dangerously-skip-permissions`).
   - `bypass` is explicit: a confirmation dialog, and the server refuses it without `confirmBypass: true`.
   - **It is never inherited.** An unattended run (autonomous, or dispatched — every manager–worker child)
     runs on `allow-rules` even when Settings says `bypass`, and says so in a run note. Presets
     (`rosterSchema` is closed) cannot carry a level, and neither can a `dispatch` request.
   - The allowlist is the worker set below plus the step's own `bashAllowlist`; a prefix naming push, network or
     delete tools is dropped even from a step. Anything not granted is denied by default (verified).
5. **`canManage`** (`RUNNER_CAPABILITIES` in the contract): `false` for antigravity. `rosterSchema` refuses it
   as a manager — at the door, the CLI and a saved preset alike, not only in the UI — and it is offered as a
   worker only, with the reason shown. It becomes `true` only after the checks in *Not verified*.
6. **It cannot hang a run.** Two watchdogs (no output after start; silence mid-run, reusing the run's own
   `timeoutMs`), a post-`result` exit grace, and a tree kill (`taskkill /T` on Windows, the process group
   elsewhere) when the run ends, is stopped or onni exits. Output is buffered from spawn: Node discards a
   child's unread stdout when it exits, which dropped every frame of a fast-failing agy.
7. **Detection without a model call**: installed = `agy --version`; signed in = `agy models` lists at least
   one model (also the model catalog). A dry run uses a bundled mock for both. Version goes on the run record
   (`agentVersion`) and in the run's first agent event, because agy updates itself between runs.

## Rule sets

Worker and solo task (implemented, `ANTIGRAVITY_WORKER_COMMANDS`): `git status`, `git diff`, `git log`,
`git show`, `git add`, `git commit`, `node "$ONNI_BIN" task report`, the step's test/build prefixes, and
read/write grants for the handoff directory.

Manager (**proposal, not implemented**): the worker set plus `node "$ONNI_BIN" task create`, `git merge` and
`git cherry-pick`. Never granted to either role: `git push`, `curl`/`wget`/`gh`, `rm`, `sudo`, `npm publish`.

## Consequences

- Antigravity is a worker whose default is "edits files, runs nothing". That is safe and, for most tasks, too
  little: running tests needs `allow-rules`.
- An unattended worker can never skip permissions, however Settings is set. A user who wants a worker that
  runs arbitrary commands cannot have it; that is the point of ADR 0005.
- Accounts: agy authenticated with an empty HOME, so its login is not under `~/.gemini` and no variable moves
  it. `PROFILE_ENV_VAR.antigravity` is `null`; a second Antigravity account is not supported.
- `--add-dir` is not passed: with it agy wrote the task's file into the added directory instead of the cwd.
- Windows: a command agy left running past its own exit cannot be reaped (`taskkill /T` needs the parent).

## Not verified

- Whether `command(git status)` also matches `git status --short`. If not, a worker is denied and the run
  says so (fail-closed). Only the exact `command(node --version)` and a denied `a && b` were observed.
- `;`, pipes, subshells and `$()` against a prefix rule; wildcards; `read_file`/`write_file` path grants and
  their Windows spelling; whether agy sees `$ONNI_BIN` expanded.
- `--sandbox`, `--mode`, `--input-format stream-json`, workspace trust, quota exhaustion, and the real
  "not signed in" output (an empty HOME still authenticated, and signing out was off-limits).
- A real manager run end to end. **`canManage` stays `false` until the three groups above are checked and a
  manager task has run.**
