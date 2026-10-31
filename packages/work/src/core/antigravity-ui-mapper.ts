/**
 * Antigravity CLI (`agy -p … --output-format stream-json`) → v1 `AgentEvent` + protocol v2 `UiEvent`.
 *
 * Wire shapes are what the spike recorded from agy 1.4.12 (`__fixtures__/antigravity/`, docs/design/
 * antigravity-spike.md): one JSON object per line — `init`, `step_update` (user_input / agent_response /
 * tool / system_message steps with ACTIVE → DONE | ERROR states) and one `result`. There is no
 * documented schema, so the parser is lenient: unknown events, steps and fields are ignored, and a
 * line that is not an object maps to nothing. It never throws.
 *
 * What the wire cannot say, and this mapper therefore does not fake: no reasoning text (only a
 * token count), no diff for an edit (the tool carries a path, so the cockpit reads the worktree's
 * git diff), no plan entries, no USD cost.
 *
 * Token accounting uses the SUM OF STEP USAGES of this process. `result.usage` is cumulative over
 * the whole conversation, so after `--conversation` it would count the earlier turns again.
 *
 * Both streams come from ONE fold so they cannot drift apart. State is immutable: callers thread the
 * returned `state` into the next call.
 */
import type { AgentEvent } from './agent-runner.ts';
import type {
  StopReason,
  TokenUsage,
  ToolKind,
  ToolLocation,
  UiEvent,
  UiMessageItem,
  UiToolItem,
} from './ui-events.ts';

/** The permission levels' labels as Settings shows them (for messages the user reads). */
const LEVEL_LABEL: Record<string, string> = {
  'files-only': 'Files only',
  'allow-rules': 'Allow-rules',
  bypass: 'Skip all confirmations',
};

interface Counts {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly total: number;
}

const NO_COUNTS: Counts = { input: 0, output: 0, reasoning: 0, cacheRead: 0, total: 0 };

export interface AntigravityState {
  readonly model?: string;
  /** The permission level the run started with, for the "denied" messages. */
  readonly level: string;
  readonly conversationId?: string;
  readonly turnSeq: number;
  readonly currentTurnId: string | null;
  readonly itemSeq: number;
  /** Open assistant messages by `step_index`. */
  readonly texts: ReadonlyMap<number, { id: string; text: string }>;
  /** Open tool items by `step_index`. */
  readonly tools: ReadonlyMap<number, UiToolItem>;
  /** What each permission-denied tool tried, in order (the result frame only names the action). */
  readonly denied: readonly string[];
  /** Sum of the step usages seen in this process. */
  readonly usage: Counts;
}

export interface AntigravityFold {
  /** v1 events, in order. */
  agent: AgentEvent[];
  /** v2 events, in order. */
  ui: UiEvent[];
  state: AntigravityState;
}

export function createAntigravityState(opts: { model?: string; level?: string } = {}): AntigravityState {
  return {
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    level: opts.level ?? 'files-only',
    turnSeq: 0,
    currentTurnId: null,
    itemSeq: 0,
    texts: new Map(),
    tools: new Map(),
    denied: [],
    usage: NO_COUNTS,
  };
}

// ---- the result, judged ---------------------------------------------------------------------

export interface AntigravityResultInput {
  status: string;
  response: string;
  /** `result.denied_actions[].display_name` (falls back to `action`). */
  deniedActions: readonly string[];
  /** What each denied tool tried, when the stream showed it. */
  deniedDetails: readonly string[];
  level: string;
}

export type AntigravityOutcome =
  | { kind: 'ok' }
  /** The turn answered but something it tried was denied: one note per denied action. */
  | { kind: 'warn'; notes: string[] }
  | { kind: 'fail'; message: string };

/**
 * agy reports a turn that was blocked as `status: SUCCESS` with an empty `response` and exit 0, so
 * the exit code and the status cannot be trusted alone (spike step 0). Decision 2 of ADR 0007:
 *  - empty response + denied actions → the run fails, naming every denied action;
 *  - empty response, nothing denied  → the run fails (nothing visible was done);
 *  - a response + denied actions     → the run continues, with a warning per denied action.
 */
export function evaluateAntigravityResult(input: AntigravityResultInput): AntigravityOutcome {
  const response = input.response.trim();
  const label = LEVEL_LABEL[input.level] ?? input.level;
  const denied = input.deniedActions.map((action, i) => input.deniedDetails[i] ?? action);
  // A denial the stream showed but `denied_actions` did not list still counts as one.
  for (let i = input.deniedActions.length; i < input.deniedDetails.length; i++) denied.push(input.deniedDetails[i]!);

  if (input.status !== 'SUCCESS') {
    const tail = response ? `: ${response.slice(0, 300)}` : '';
    return { kind: 'fail', message: `antigravity ended the turn with status ${input.status || 'unknown'}${tail}` };
  }
  if (response === '' && denied.length > 0) {
    return {
      kind: 'fail',
      message:
        `antigravity was blocked and produced no answer — the "${label}" permission level denied: ${denied.join('; ')}. ` +
        'Raise the level in Settings → Agents, or give it a task that only edits files.',
    };
  }
  if (response === '') {
    return {
      kind: 'fail',
      message: 'antigravity returned an empty response and reported no denied actions, so nothing it did is visible to onni.',
    };
  }
  if (denied.length > 0) {
    return { kind: 'warn', notes: denied.map((what) => `antigravity: denied ${what} (permission level "${label}")`) };
  }
  return { kind: 'ok' };
}

// ---- tool presentation ----------------------------------------------------------------------

const TOOL_KINDS: Readonly<Record<string, ToolKind>> = {
  write_file: 'edit',
  write_to_file: 'edit',
  replace_file_content: 'edit',
  multi_replace_file_content: 'edit',
  sed_file: 'edit',
  notebook_edit: 'edit',
  view_file: 'read',
  list_dir: 'read',
  read_resource: 'read',
  find_by_name: 'search',
  grep_search: 'search',
  run_command: 'execute',
  send_command_input: 'execute',
  command_status: 'execute',
  search_web: 'fetch',
  read_url_content: 'fetch',
  invoke_subagent: 'task',
  define_subagent: 'task',
};

const PATH_KEYS = ['Path', 'AbsolutePath', 'TargetFile', 'File', 'DirectoryPath', 'SearchPath'];

function toolKind(name: string): ToolKind {
  return TOOL_KINDS[name.toLowerCase()] ?? 'other';
}

function firstString(params: unknown, keys: readonly string[]): string | undefined {
  if (!isRecord(params)) return undefined;
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

function shorten(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function baseName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path;
}

function toolTitle(name: string, kind: ToolKind, params: unknown): string {
  if (kind === 'execute') {
    const command = firstString(params, ['CommandLine', 'Command', 'Input']);
    return command ? `Ran ${shorten(command)}` : name;
  }
  const path = firstString(params, PATH_KEYS);
  if (kind === 'edit') return path ? `Edit ${baseName(path)}` : name;
  if (kind === 'read') return path ? `Read ${baseName(path)}` : name;
  const query = firstString(params, ['Query', 'Url', 'URL', 'Pattern']);
  return query ? `${name} ${shorten(query, 80)}` : name;
}

/** What a denied tool tried, as one phrase for the "denied" message. */
function describeTool(name: string, params: unknown): string {
  const what = firstString(params, ['CommandLine', 'Command', ...PATH_KEYS, 'Query', 'Url', 'URL']);
  return what ? `${name} \`${shorten(what, 100)}\`` : name;
}

/** agy words a permission denial as "permission check failed … user denied permission". */
function isPermissionDenial(message: string): boolean {
  return /denied permission|permission check failed|auto-denied/i.test(message);
}

// ---- the fold -------------------------------------------------------------------------------

/** Fold one parsed stream-json line into v1 and v2 events. Never throws. */
export function foldAntigravityFrame(frame: unknown, state: AntigravityState): AntigravityFold {
  const nothing: AntigravityFold = { agent: [], ui: [], state };
  try {
    if (!isRecord(frame)) return nothing;
    if (frame.event === 'init') return foldInit(frame, state);
    if (frame.event === 'step_update' && isRecord(frame.step_update)) return foldStep(frame.step_update, state);
    if (frame.event === 'result' && isRecord(frame.result)) return foldResult(frame.result, state);
    return nothing;
  } catch {
    return nothing;
  }
}

function foldInit(frame: Record<string, unknown>, state: AntigravityState): AntigravityFold {
  const init = isRecord(frame.init) ? frame.init : {};
  const conversationId = str(frame.conversation_id) ?? state.conversationId ?? '';
  const turnId = `turn_${state.turnSeq + 1}`;
  const tools = Array.isArray(init.tools) ? init.tools.filter((t): t is string => typeof t === 'string') : undefined;
  const ui: UiEvent[] = [
    {
      type: 'session.started',
      sessionId: conversationId,
      backend: 'antigravity',
      ...(state.model !== undefined ? { model: state.model } : {}),
      ...(str(init.cwd) !== undefined ? { cwd: str(init.cwd)! } : {}),
      ...(tools ? { tools } : {}),
    },
    // Print mode has no stdin turn boundary: turn_1 starts with the session.
    { type: 'turn.started', turnId },
  ];
  return {
    agent: conversationId ? [{ type: 'session', sessionId: conversationId }] : [],
    ui,
    state: { ...state, conversationId, turnSeq: state.turnSeq + 1, currentTurnId: turnId },
  };
}

function foldStep(step: Record<string, unknown>, state: AntigravityState): AntigravityFold {
  const index = num(step.step_index);
  const kind = str(step.step_type);
  const phase = str(step.state);
  if (index === undefined || kind === undefined) return { agent: [], ui: [], state };
  if (kind === 'agent_response') return foldAssistant(step, index, phase, state);
  if (kind === 'tool') return foldTool(step, index, phase, state);
  return { agent: [], ui: [], state };
}

function foldAssistant(
  step: Record<string, unknown>,
  index: number,
  phase: string | undefined,
  state: AntigravityState,
): AntigravityFold {
  const agent: AgentEvent[] = [];
  const ui: UiEvent[] = [];
  let itemSeq = state.itemSeq;
  const texts = new Map(state.texts);
  const delta = typeof step.text_delta === 'string' ? step.text_delta : '';

  if (delta !== '') {
    agent.push({ type: 'text', text: delta });
    const open = texts.get(index);
    if (open) {
      texts.set(index, { id: open.id, text: open.text + delta });
      ui.push({ type: 'item.delta', itemId: open.id, field: 'text', delta });
    } else {
      const id = `item_${++itemSeq}`;
      texts.set(index, { id, text: delta });
      ui.push({ type: 'item.started', item: message(id, '') }, { type: 'item.delta', itemId: id, field: 'text', delta });
    }
  }

  let usage = state.usage;
  if (phase === 'DONE' || phase === 'ERROR') {
    const open = texts.get(index);
    if (open) {
      ui.push({ type: 'item.completed', item: message(open.id, open.text) });
      texts.delete(index);
    }
    const stepUsage = countsOf(step.usage);
    if (stepUsage) {
      usage = addCounts(usage, stepUsage);
      agent.push({ type: 'token-usage', tokensUsed: usage.total });
      ui.push({ type: 'usage.updated', usage: toTokenUsage(usage) });
    }
  }
  return { agent, ui, state: { ...state, itemSeq, texts, usage } };
}

function message(id: string, text: string): UiMessageItem {
  return { kind: 'message', id, role: 'assistant', text };
}

function foldTool(
  step: Record<string, unknown>,
  index: number,
  phase: string | undefined,
  state: AntigravityState,
): AntigravityFold {
  const info = isRecord(step.tool_info) ? step.tool_info : {};
  const name = str(step.tool_name) ?? str(info.name) ?? 'tool';
  const params = info.parameters;
  const id = `tool_${index}`;
  const tools = new Map(state.tools);
  const agent: AgentEvent[] = [];
  const ui: UiEvent[] = [];

  let item = tools.get(index);
  if (!item) {
    const kind = toolKind(name);
    item = { kind: 'tool', id, name, toolKind: kind, title: toolTitle(name, kind, params), status: 'running' };
    if (params !== undefined) item.input = params;
    const path = kind === 'edit' ? firstString(params, PATH_KEYS) : undefined;
    if (path) item.locations = [{ path } satisfies ToolLocation];
    ui.push({ type: 'item.started', item });
    agent.push({ type: 'tool-call', id, tool: name, input: params ?? {} });
    tools.set(index, item);
  }
  if (phase === 'ACTIVE' || phase === undefined) return { agent, ui, state: { ...state, tools } };

  tools.delete(index);
  if (phase === 'DONE') {
    ui.push({ type: 'item.completed', item: { ...item, status: 'completed' } });
    agent.push({ type: 'tool-result', toolCallId: id, result: '', isError: false });
    return { agent, ui, state: { ...state, tools } };
  }

  // ERROR: a permission denial is `declined` (the user's policy said no), anything else `failed`.
  const error = isRecord(info.error) ? info.error : {};
  const text = str(error.message) ?? 'the tool failed';
  const declined = isPermissionDenial(text);
  const firstLine = text.split('\n')[0]!.trim();
  ui.push({ type: 'item.completed', item: { ...item, status: declined ? 'declined' : 'failed', error: shorten(firstLine, 300) } });
  agent.push({ type: 'tool-result', toolCallId: id, result: shorten(firstLine, 300), isError: true });
  return {
    agent,
    ui,
    state: { ...state, tools, denied: declined ? [...state.denied, describeTool(name, params)] : state.denied },
  };
}

function foldResult(result: Record<string, unknown>, state: AntigravityState): AntigravityFold {
  const agent: AgentEvent[] = [];
  const ui: UiEvent[] = [];

  // A tool or message still open when the turn ended would stay "running" in the cockpit forever.
  for (const open of state.tools.values()) ui.push({ type: 'item.completed', item: { ...open, status: 'failed' } });
  for (const open of state.texts.values()) ui.push({ type: 'item.completed', item: message(open.id, open.text) });

  const usage = state.usage.total > 0 ? state.usage : countsOf(result.usage) ?? NO_COUNTS;
  if (usage.total > 0) agent.push({ type: 'token-usage', tokensUsed: usage.total });

  const deniedActions = Array.isArray(result.denied_actions)
    ? result.denied_actions.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const label = str(entry.display_name) ?? str(entry.action);
        return label ? [label] : [];
      })
    : [];
  const outcome = evaluateAntigravityResult({
    status: str(result.status) ?? '',
    response: typeof result.response === 'string' ? result.response : '',
    deniedActions,
    deniedDetails: state.denied,
    level: state.level,
  });
  if (outcome.kind === 'warn') {
    for (const note of outcome.notes) agent.push({ type: 'note', message: note, kind: 'denied-action' });
  } else if (outcome.kind === 'fail') {
    agent.push({ type: 'error', message: outcome.message });
  }
  agent.push({ type: 'turn-end' });

  const turnId = state.currentTurnId ?? `turn_${Math.max(1, state.turnSeq)}`;
  const stopReason: StopReason = outcome.kind === 'fail' ? 'error' : 'end_turn';
  ui.push({
    type: 'turn.completed',
    turnId,
    stopReason,
    ...(usage.total > 0 ? { usage: toTokenUsage(usage) } : {}),
  });
  return {
    agent,
    ui,
    state: { ...state, currentTurnId: null, tools: new Map(), texts: new Map(), denied: [] },
  };
}

// ---- helpers --------------------------------------------------------------------------------

function countsOf(raw: unknown): Counts | undefined {
  if (!isRecord(raw)) return undefined;
  const input = num(raw.input_tokens) ?? 0;
  const output = num(raw.output_tokens) ?? 0;
  const reasoning = num(raw.thinking_tokens) ?? 0;
  const cacheRead = num(raw.cache_read_tokens) ?? 0;
  const total = num(raw.total_tokens) ?? input + output;
  if (total <= 0) return undefined;
  return { input, output, reasoning, cacheRead, total };
}

function addCounts(a: Counts, b: Counts): Counts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    total: a.total + b.total,
  };
}

function toTokenUsage(counts: Counts): TokenUsage {
  return {
    input: counts.input,
    output: counts.output,
    total: counts.total,
    ...(counts.reasoning > 0 ? { reasoning: counts.reasoning } : {}),
    ...(counts.cacheRead > 0 ? { cacheRead: counts.cacheRead } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
