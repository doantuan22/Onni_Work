#!/usr/bin/env node
// Mock `agy` binary for ONNI_DRY_RUN=1 — implements `--version`, `models` and print mode with the
// stream-json shape recorded from agy 1.4.12 (src/core/__fixtures__/antigravity). Prompt markers
// pick a scenario so tests can reach every outcome without the real CLI:
//   mock:denied          a command is denied and nothing is answered     (run fails)
//   mock:denied-answer   a command is denied but the turn still answers  (run continues, warning)
//   mock:empty           an empty answer, nothing denied                 (run fails)
//   mock:silent          init, then no output at all                     (watchdog)
//   mock:nostart         no output at all                                (startup watchdog)
//   mock:badlines        noise and a cut-off line around valid frames

import { appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);

// `process.exit` right after a write can drop it on a pipe (Windows especially): flush first.
const exitAfterFlush = (code) => process.stdout.write('', () => process.exit(code));

if (process.env.ONNI_MOCK_ARGS_FILE) {
  try {
    appendFileSync(process.env.ONNI_MOCK_ARGS_FILE, `${JSON.stringify(argv)}\n`);
  } catch {
    /* ignore */
  }
}

if (argv[0] === '--version') {
  process.stdout.write('1.4.12-mock\n');
  exitAfterFlush(0);
}
if (argv[0] === 'models') {
  process.stderr.write('Fetching available models...\n');
  process.stdout.write('mock-fast\tMock Fast\nmock-smart\tMock Smart (Thinking)\n');
  exitAfterFlush(0);
}

const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const prompt = flag('-p') ?? flag('--print') ?? flag('--prompt') ?? '';
const conversationId = flag('--conversation') ?? 'mock-conversation';
const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const step = (index, state, type, extra = {}) =>
  emit({ event: 'step_update', step_update: { conversation_id: conversationId, step_index: index, state, step_type: type, ...extra } });
const usage = { input_tokens: 100, output_tokens: 20, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 120 };

if (prompt.includes('mock:nostart')) setInterval(() => {}, 1_000_000);
else {
  emit({
    event: 'init',
    conversation_id: conversationId,
    init: { cwd: process.cwd(), tools: ['write_file', 'run_command'], permission_mode: 'request-review' },
  });
  if (prompt.includes('mock:silent')) setInterval(() => {}, 1_000_000);
  else run();
}

function run() {
  step(0, 'DONE', 'user_input');
  if (prompt.includes('mock:badlines')) {
    process.stdout.write('this is not json\n');
    process.stdout.write('{"event":"step_update","step_update":{"conversation_id":"x","step_index":1,"state":"ACT\n');
    emit({ event: 'future_event', anything: true });
  }
  const denied = prompt.includes('mock:denied');
  if (denied) {
    const parameters = { CommandLine: 'npm test' };
    step(1, 'ACTIVE', 'tool', { tool_name: 'run_command', tool_info: { name: 'run_command', parameters } });
    step(1, 'ERROR', 'tool', {
      tool_name: 'run_command',
      tool_info: {
        name: 'run_command',
        parameters,
        error: { type: 'TOOL_ERROR', message: 'permission check failed for unsandboxed "npm test": user denied permission to run command' },
      },
    });
  }
  const answer = prompt.includes('mock:empty') || prompt.includes('mock:denied') && !prompt.includes('mock:denied-answer')
    ? ''
    : 'mock: antigravity dry-run completed the task.';
  if (answer) {
    step(2, 'ACTIVE', 'agent_response', { text_delta: answer });
    step(2, 'DONE', 'agent_response', { text_delta: '\n', usage });
  } else {
    step(2, 'DONE', 'agent_response', { usage });
  }
  emit({
    event: 'result',
    result: {
      conversation_id: conversationId,
      status: 'SUCCESS',
      response: answer ? `${answer}\n` : '',
      duration_seconds: 0.1,
      num_turns: 1,
      usage,
      ...(denied ? { denied_actions: [{ action: 'command', display_name: 'RunCommand' }] } : {}),
    },
  });
  exitAfterFlush(0);
}
