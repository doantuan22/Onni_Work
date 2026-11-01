/**
 * Cline CLI's ACP dialect — the per-runner mapper `AGENT_PROTOCOL.md` §9 step 4 asks for, over the
 * shared `acp-ui-mapper.ts`.
 *
 * Read off a live `cline --acp` 3.0.74 session (`__fixtures__/cline/README.md` has the record).
 * Cline is close to plain ACP: a tool call goes `pending` → `in_progress` → `completed`, and a
 * `session/request_permission` arrives while it is still `pending`. What differs:
 *  - a tool call carries **no tool name**, only `kind` and a `title` of the form `<tool>: <args>`
 *    (`editor: {"path":…}`, `run_commands: echo done`), so the name is the title's prefix;
 *  - a finished call carries its result in `rawOutput` (never in ACP `content`), as one
 *    `{query, result, success, error?}` object or an array of them — `success: false` is how a
 *    failing command is reported, while the update's own status still says `completed`;
 *  - an edit's change is `rawInput.{path, old_text?, new_text?}`, not an ACP diff block;
 *  - `session/prompt` answers `{stopReason}` with **no usage**, and no frame carries token or cost
 *    figures, so the cockpit has no token metrics for this backend;
 *  - an unusable model or a missing login can end a prompt with `end_turn` and **zero frames**
 *    (the runner turns that into a failure — see `cline-acp-runner.ts`).
 */
import {
  createAcpUiState,
  mapAcpFrame,
  type AcpDialect,
  type AcpUiMapperState,
  type AcpUiMapping,
} from './acp-ui-mapper.ts';
import type { FileDiff, ToolStatus } from './ui-events.ts';

/** What a user needs in order to run Cline CLI. */
export const CLINE_AUTH_HINT =
  'Cline CLI needs a signed-in provider — run `cline auth` (or `cline` once) and pick a provider and model.';

/** The run-time line for a rejected credential. "authentication failed" is what
 *  `isRuntimeProviderAuthFailure` keys on, so the server raises `provider-auth-required`. */
export const CLINE_AUTH_FAILURE_MESSAGE =
  'Cline CLI authentication failed — run `cline auth` to sign in or set a provider API key, then retry.';

/** What a turn that ended with no text and no tool call is reported as. */
export const CLINE_EMPTY_TURN_MESSAGE =
  'Cline CLI ended the turn without any output — the selected model is probably not usable with your login, or the provider is not signed in. Check `cline auth` and the model, then retry.';

/**
 * How an unauthenticated Cline reads on the wire. The ACP `initialize` result lists
 * `authMethods`, and a request that needs a login answers with the standard `-32000
 * "Authentication required"` — the same code Copilot uses. The prose patterns cover the failure
 * arriving as text on another frame or on stderr.
 */
const AUTH_FAILURE_PATTERNS = [
  /authentication required/i,
  /not (?:logged in|authenticated|signed in)/i,
  /\bcline auth\b/i,
  /invalid api key|unauthorized|\b401\b/i,
] as const;

/** True for the Cline auth failures onni has seen (or can reasonably expect) on the wire. */
export function isClineAuthFailure(text: string): boolean {
  return AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The tool's own name: the `title` prefix before the first `: `. Cline titles every call
 * `<tool>: <args>` and truncates the args with `...`, so the prefix is always whole. A title
 * without that shape (or none) falls back to the ACP kind, then to `tool`.
 */
export function clineToolName(update: Record<string, unknown>): string {
  const title = typeof update.title === 'string' ? update.title : '';
  const colon = title.indexOf(': ');
  const prefix = colon > 0 ? title.slice(0, colon).trim() : '';
  if (prefix && /^[A-Za-z0-9_.-]+$/.test(prefix)) return prefix;
  return typeof update.kind === 'string' && update.kind ? update.kind : 'tool';
}

/** The `{query, result, success, error?}` records of a finished call, whichever shape carried them. */
function rawResults(update: Record<string, unknown>): Record<string, unknown>[] {
  const raw = update.rawOutput;
  const list = Array.isArray(raw) ? raw : isRecord(raw) ? [raw] : [];
  return list.filter(isRecord);
}

/** A call that finished with `success: false` failed, whatever status the update claims. */
function clineToolStatus(update: Record<string, unknown>): ToolStatus | undefined {
  if (update.status !== 'completed') return undefined;
  return rawResults(update).some((record) => record.success === false) ? 'failed' : undefined;
}

/** Kept bounded: a command's whole output rides one frame and is persisted in the run's NDJSON. */
const MAX_OUTPUT_CHARS = 32_000;

function clineToolOutput(update: Record<string, unknown>): string | undefined {
  const parts = rawResults(update).flatMap((record) => {
    const text = typeof record.result === 'string' ? record.result : typeof record.error === 'string' ? record.error : '';
    return text.trim() === '' ? [] : [text.trimEnd()];
  });
  if (parts.length === 0) return undefined;
  const joined = parts.join('\n');
  return joined.length > MAX_OUTPUT_CHARS ? `${joined.slice(0, MAX_OUTPUT_CHARS)}… (truncated)` : joined;
}

/** `editor` calls carry the change as `path` + `old_text` / `new_text` (create = `new_text` only). */
function clineToolDiffs(update: Record<string, unknown>): FileDiff[] | undefined {
  const input = isRecord(update.rawInput) ? update.rawInput : undefined;
  if (!input || typeof input.path !== 'string' || input.path === '') return undefined;
  const oldText = typeof input.old_text === 'string' ? input.old_text : null;
  const newText = typeof input.new_text === 'string' ? input.new_text : undefined;
  if (oldText === null && newText === undefined) return undefined;
  return [{ path: input.path, oldText, ...(newText !== undefined ? { newText } : {}) }];
}

/**
 * Cline's own title is `<tool>: <JSON args>` cut at ~50 characters. When the structured input
 * says what the call is about, name that instead: a path for `editor`, the paths for
 * `read_files`, the command line for `run_commands`. Anything else keeps the wire title.
 */
function clineToolTitle(update: Record<string, unknown>, name: string): string | undefined {
  const input = isRecord(update.rawInput) ? update.rawInput : undefined;
  if (!input) return undefined;
  if (typeof input.path === 'string' && input.path !== '') return `${name}: ${input.path}`;
  if (Array.isArray(input.files)) {
    const paths = input.files.flatMap((file) => (isRecord(file) && typeof file.path === 'string' ? [file.path] : []));
    if (paths.length > 0) return `${name}: ${paths.join(', ')}`;
  }
  if (Array.isArray(input.commands)) {
    const commands = input.commands.filter((command): command is string => typeof command === 'string');
    if (commands.length > 0) return `${name}: ${commands.join(' && ')}`;
  }
  return undefined;
}

export const clineDialect: AcpDialect = {
  backend: 'cline',
  toolNameOf: clineToolName,
  toolTitleOf: clineToolTitle,
  toolStatusOf: (update) => clineToolStatus(update),
  toolOutputOf: clineToolOutput,
  toolDiffsOf: clineToolDiffs,
  errorMessage: (error) => {
    const text = `${typeof error.message === 'string' ? error.message : ''} ${JSON.stringify(error.data ?? '')}`;
    return isClineAuthFailure(text) ? CLINE_AUTH_FAILURE_MESSAGE : undefined;
  },
};

export type ClineUiMapperState = AcpUiMapperState;

export function createClineUiState(): ClineUiMapperState {
  return createAcpUiState();
}

export function mapClineFrame(frame: unknown, state: ClineUiMapperState): AcpUiMapping {
  return mapAcpFrame(frame, state, clineDialect);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
