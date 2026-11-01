# ADR 0009 — Cline CLI as a backend: ACP, worker only, an empty turn is a failed turn

- Status: accepted
- Date: 2026-11-01
- Evidence: [`packages/work/src/core/__fixtures__/cline/README.md`](../../packages/work/src/core/__fixtures__/cline/README.md) — four live captures from `cline` 3.0.74
- Builds on: [ADR 0005](0005-unattended-safety.md), [ADR 0006](0006-manager-worker.md), [ADR 0007](0007-antigravity-backend.md)

## Context

Cline's CLI should be usable like the other backends. It speaks the Agent Client Protocol
(`cline --acp`, `protocolVersion: 1`, `loadSession`, image prompts), so it belongs on the shared ACP
layer next to Copilot (`acp-client.ts`, `acp-ui-mapper.ts`). Four things measured on the live CLI
make it unlike Copilot:

1. **It asks for permission anyway.** Every tool call is followed by `session/request_permission`, with
   Cline's own auto-approve setting on. The options are `allow_once`, `allow_always`, `reject_once`;
   `allow_always` persists a rule in the user's Cline settings.
2. **A turn can do nothing and succeed.** `session/set_model` to a model the login cannot use answers
   `{}`; the next `session/prompt` answers `end_turn` after one `session_info_update` — no text, no tool
   call, no file written.
3. **Its tool frames are not core ACP.** A result is `rawOutput` (never `content`); a failing command is
   `status: completed` with `rawOutput.success: false`; an edit's change is `rawInput.old_text/new_text`;
   `title` is `<tool>: <JSON args>` cut at ~50 characters.
4. **It reports no usage at all** — no token or cost field on any frame or on the `session/prompt` result.

## Decision

1. **A thin ACP runner.** `ClineAcpRunner` is the Copilot runner's shape: one `cline --acp` child per
   session, follow-ups as further `session/prompt` calls, Continue through `session/load`, images through
   `promptCapabilities.image`. The only argument is `--acp`. Not passed: `--worktree` (onni owns the one
   worktree per task), `--zen` (a background hub outliving the run), `--yolo`, `-m` (it needs `-P` to mean
   anything). The model goes through `session/set_model` after `session/new`, and **a model Cline rejects
   fails the run** rather than silently keeping another.
2. **Every permission request is answered once, never "always".** The runner picks `allow_once` and emits
   a `note`. This is a full-shell backend like Codex and Copilot: `allowedTools` and `bashAllowlist` are
   not translated, because a partial mapping looks like a sandbox and behaves like none. The unattended
   fence (ADR 0005) is a barrier here too, not a sandbox.
3. **An empty turn is a failed turn.** A turn that ended with no text and no tool call fails with
   `CLINE_EMPTY_TURN_MESSAGE`, unless onni itself ended or timed out the session. Reporting it as success
   would settle a run that changed nothing as `done` (the ADR 0007 trap).
4. **The dialect absorbs the off-schema frames** through four optional `AcpDialect` hooks —
   `toolOutputOf`, `toolDiffsOf`, `toolTitleOf`, and the existing `toolStatusOf` — so Cline's results,
   diffs and failures reach the cockpit. The hooks are additive: no other backend's mapping changes.
   `rawOutput.success: false` becomes `failed`.
5. **Worker only.** `RUNNER_CAPABILITIES.cline.canManage` is `false`, enforced by `rosterSchema`: the
   manager's commands (`onni task create`, `git merge`) were not verified to run through Cline's permission
   flow unattended. Turning it on takes what ADR 0007 lists under "To enable `canManage`", not a flag flip.
6. **No token or cost ceiling can bind it.** `cline` joins `RUNNERS_WITHOUT_COST` and
   `RUNNERS_WITHOUT_TOKENS` (as `cursor` does); only the time and step ceilings, the sweep and the wait
   expiry bound a Cline run. "Unlimited" changes nothing for it.
7. **Credentials are Cline's own.** `BACKEND_ALLOW_PREFIXES.cline` is `['CLINE_']`. The provider login and
   any BYOK key live in `~/.cline/data/settings`, written by `cline auth`; forwarding the multi-provider
   prefixes would hand every key in the user's shell to a CLI that already holds the one it uses.
8. **Auth is probed over ACP, no model call.** An unauthenticated `session/new` answers `-32000
   "Authentication required: Call authenticate before starting a session"` (captured with an empty
   `--config` / `--data-dir`), the same code Copilot uses, so the provider descriptor reuses the Copilot
   probe. Detection is `cline --version`; `ONNI_CLINE_BIN` overrides the binary, and `ONNI_DRY_RUN=1`
   stands the runner up on `scripts/mock-cline-acp.mjs`.
9. **Models are `provider/model`, undiscovered.** `BACKEND_MODEL_MAP.cline` is `{}` (a bare id fails loud,
   like opencode and pi). The composer offers `auto` (no `set_model`) and a free-text field; there is no
   live catalog yet — Cline's ~300 ids only come out of `session/new`, and wiring that into
   `RunnerModelCatalog` is a follow-up.

## Consequences

- Private project MCP is not wired: `initialize` advertises no `mcpCapabilities`, so servers are skipped
  with a run note and `cline` is not in `PRIVATE_MCP_RUNNERS`.
- Cline appears in the thread, settings, accounts and provider-status surfaces like any runner;
  `cline history` shows the cost per session, but that is not on the ACP wire and is not read.
- `ui-parity.test.ts` excludes `cline` from four rows — plan entries, sub-agents, `usage.updated`,
  per-turn usage — each because the live captures show no such frame. A frame is never fabricated.
- The resume command for a terminal take-over is `cline --tui --id <session-id>`. Whether `--id` accepts
  an ACP session id was not exercised; `cline history` lists those ids.
- Unverified, and listed so nobody assumes otherwise: `session/load` replay behaviour, cancel mid-tool,
  image prompts, and a provider other than the one logged in during capture.
