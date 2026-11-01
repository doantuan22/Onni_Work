#!/usr/bin/env node
/**
 * An offline stand-in for `cline --acp`, so `ONNI_DRY_RUN=1` never reaches a model provider — the
 * same role `mock-copilot-acp.mjs` and `mock-junie-acp.mjs` play for their runners.
 *
 * It speaks the frames the real CLI spoke on a live 3.0.74 session
 * (`src/core/__fixtures__/cline/README.md`): the `initialize` capabilities are the real ones, a
 * tool call is titled `<tool>: <args>` and goes `pending` → `in_progress` → `completed` with a
 * `session/request_permission` while it is still `pending` (Cline asks even with its own
 * auto-approve on), and `session/prompt` answers `{stopReason}` with NO usage. An unauthenticated
 * `session/new` answers the real `-32000 "Authentication required: …"`.
 *
 * Deliberately small: enough to prove the transport, the session lifecycle, follow-ups, cancel,
 * resume and the empty-turn failure end to end. It is not a Cline simulator.
 */
import { writeFileSync } from 'node:fs';
import readline from 'node:readline';

const SESSION_ID = '1700000000000_mockCl_cli';
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const answer = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const update = (sessionId, body) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: body } });

let turn = 0;
let cancelled = false;
/** Set by ONNI_MOCK_CLINE_UNAUTHENTICATED=1, so the auth path is testable offline. */
const unauthenticated = process.env.ONNI_MOCK_CLINE_UNAUTHENTICATED === '1';
/** Set by ONNI_MOCK_CLINE_EMPTY_TURN=1: a prompt answered `end_turn` with no frame at all — what a
 *  model the login cannot use did on the real CLI. */
const emptyTurn = process.env.ONNI_MOCK_CLINE_EMPTY_TURN === '1';
/** Inbound requests onni answers, keyed by the id this mock sent them under. */
const pendingRequests = new Map();
let nextRequestId = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// So the runner test can assert the exact flags the runner spawned with, without a real CLI.
if (process.env.ONNI_MOCK_CLINE_ARGS_FILE) {
  writeFileSync(process.env.ONNI_MOCK_CLINE_ARGS_FILE, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));
}

/** Handling a frame must NEVER block the read loop: the permission answer can only arrive on stdin. */
async function handle(frame) {
  const { id, method, params } = frame;

  // An answer to a request THIS process sent (session/request_permission).
  if (method === undefined && id !== undefined && pendingRequests.has(id)) {
    pendingRequests.get(id)(frame);
    pendingRequests.delete(id);
    return;
  }

  if (method === 'initialize') {
    answer(id, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true, audio: false, embeddedContext: false } },
      agentInfo: { name: 'cline', version: 'mock (ONNI_DRY_RUN=1)' },
      authMethods: [{ id: 'cline', name: 'Sign in with Cline' }],
    });
    return;
  }

  if (method === 'session/new') {
    if (unauthenticated) fail(id, -32000, 'Authentication required: Call authenticate before starting a session');
    else {
      answer(id, {
        sessionId: SESSION_ID,
        modes: { availableModes: [{ id: 'plan', name: 'Plan' }, { id: 'act', name: 'Act' }], currentModeId: 'act' },
        models: {
          availableModels: [
            { modelId: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5' },
            { modelId: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol' },
          ],
          currentModelId: 'anthropic/claude-sonnet-5.5',
        },
      });
    }
    return;
  }

  if (method === 'session/load') {
    answer(id, {});
    update(params?.sessionId ?? SESSION_ID, { sessionUpdate: 'available_commands_update', availableCommands: [] });
    return;
  }

  if (method === 'session/set_model' || method === 'session/set_mode') {
    answer(id, {});
    return;
  }

  if (method === 'session/cancel') {
    cancelled = true;
    return; // a notification: no answer, the pending prompt resolves `cancelled`
  }

  if (method === 'session/prompt') {
    if (process.env.ONNI_MOCK_CLINE_EXIT_MID_TURN === '1') process.exit(0);
    if (process.env.ONNI_MOCK_CLINE_PROMPT_HANGS === '1') return;
    turn += 1;
    cancelled = false;
    const sessionId = params?.sessionId ?? SESSION_ID;
    const text = (params?.prompt ?? [])
      .filter((block) => block?.type === 'text')
      .map((block) => block.text)
      .join('\n');

    if (emptyTurn) {
      update(sessionId, { sessionUpdate: 'session_info_update', updatedAt: new Date().toISOString() });
      answer(id, { stopReason: 'end_turn' });
      return;
    }

    const toolCallId = `toolu_mock_${turn}`;
    const call = {
      toolCallId,
      title: 'run_commands: echo dry-run',
      kind: 'execute',
      status: 'pending',
      rawInput: { commands: ['echo dry-run'] },
    };
    update(sessionId, { sessionUpdate: 'tool_call', ...call });

    // Cline asks for every tool call even with its own auto-approve on.
    const requestId = nextRequestId++;
    const answered = new Promise((resolve) => pendingRequests.set(requestId, resolve));
    send({
      jsonrpc: '2.0',
      id: requestId,
      method: 'session/request_permission',
      params: {
        sessionId,
        toolCall: call,
        options: [
          { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'allow_always', name: 'Allow always', kind: 'allow_always' },
          { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
        ],
      },
    });
    const reply = await answered;
    // Echo what onni picked, so the test can assert the choice reached the agent.
    update(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: `[permission:${reply?.result?.outcome?.optionId ?? 'none'}] ` },
    });
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' });

    // A beat, so a cancel arriving mid-turn is actually mid-turn.
    await sleep(20);
    if (cancelled) {
      answer(id, { stopReason: 'cancelled' });
      return;
    }

    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: 'completed',
      rawOutput: [{ query: 'echo dry-run', result: 'dry-run\r\n', success: true }],
    });
    update(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: `[ONNI_DRY_RUN] Cline mock answering turn ${turn}: ${text.slice(0, 120)}` },
    });
    update(sessionId, { sessionUpdate: 'session_info_update', updatedAt: new Date().toISOString() });
    answer(id, { stopReason: 'end_turn' });
    return;
  }

  if (id !== undefined && method) fail(id, -32601, `Method not found: ${method}`);
}

for await (const line of readline.createInterface({ input: process.stdin })) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  let frame;
  try {
    frame = JSON.parse(trimmed);
  } catch {
    continue; // the real agent skips a line it cannot parse; so does this
  }
  void handle(frame);
}
