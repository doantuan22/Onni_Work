# Cline CLI over ACP — golden fixtures

Design record: `docs/adr/0009-cline-backend.md`. Runner: `cline-acp-runner.ts`; dialect and
mapper: `cline-ui-mapper.ts` over the shared `acp-ui-mapper.ts`.

## Provenance

Every transcript here is a **live capture** from `cline` 3.0.74 (npm `cline@3.0.74`, core 0.2.0) on
Windows 11, recorded on 2026-11-01 by piping JSON-RPC to and from a real `cline --acp` child. No frame
was written by hand. Two things were trimmed, and nothing else was edited:

- the model catalog (`session/new`'s `models.availableModels`, ~300 entries) is cut to three;
- the capture machine's user name and temp path are replaced (`/work/repo`, `user`).

| Fixture | What it shows |
|---|---|
| `tool-lifecycle` | One turn: an `editor` call and a `run_commands` call. `tool_call` is `pending`, a `session/request_permission` follows **even though Cline's own auto-approve is on**, then `in_progress`, then `completed` with a `rawOutput`. |
| `reasoning-and-failed-command` | `agent_thought_chunk` reasoning, a `read_files` call, a shell command that exits 1 (reported as `completed`, with `[Command exited with code 1]` inside the output), and an `edit` whose `rawInput` is `{path, old_text, new_text}`. |
| `auth-required` | No login (captured with an empty `--config` / `--data-dir`): `initialize` succeeds, `session/new` fails with `-32000 "Authentication required: Call authenticate before starting a session"`. |
| `empty-turn` | `session/set_model` to a model this login could not use is accepted (`{}`), then `session/prompt` answers `end_turn` after one `session_info_update` — no text, no tool call, nothing changed. The runner turns this into a failure. |

## What the wire carries off-schema

Three things are not where core ACP puts them, so `cline-ui-mapper.ts` reads them from where Cline
puts them (the shared mapper gained three optional dialect hooks for it):

- a tool's **result** is `rawOutput` (`{query, result, success, error?}`, or an array of them), never ACP
  `content` — read as the tool's output;
- a **failing command** is `status: completed` plus `rawOutput.success: false` — read as `failed`;
- an edit's **diff** is `rawInput.{path, old_text?, new_text?}`, not an ACP diff block;
- its `title` is `<tool>: <JSON args>` cut at ~50 characters, so the title is rebuilt from the input.

## What the wire does not carry

These are the cells `ui-parity.test.ts` excludes for `cline`, each because the capture shows no such
frame — not because Cline cannot send one. A frame is never fabricated to fill a row; revisit when a
capture covers one.

- **Plan entries** — no `plan` update in any turn, even for a prompt that asked for a todo plan.
- **Sub-agents** — none observed.
- **Token usage and cost** — no frame and no `session/prompt` result field carries either. `cline
  history` prints a cost per session, but that is not on the ACP wire.

## File layout

Line 1 is a `{"fixture": {…}}` header. Every other line is `{"dir":"out"|"in","frame":<JSON-RPC
message>}` in wire order — `out` is what onni wrote to the agent's stdin, `in` is what the agent
wrote to stdout. `cline-ui-mapper.test.ts` replays exactly those frames through `mapClineFrame`
and compares the events with the `*.expected.json` next to each transcript.

To refresh a fixture, re-capture it against a real `cline --acp` and regenerate the expected file from
the mapper, then read the diff — an expected file is a contract, not a snapshot to accept blindly.
