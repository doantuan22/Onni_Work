#!/usr/bin/env node
// A completed stream followed by agy's shutdown error observed in dispatched worker runs.
const conversationId = 'mock-exit-one';
const emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);

if (process.argv[2] === '--version') {
  process.stdout.write('1.4.12-mock\n');
  process.exit(0);
}

emit({ event: 'init', conversation_id: conversationId, init: { cwd: process.cwd(), tools: [] } });
emit({
  event: 'step_update',
  step_update: { conversation_id: conversationId, step_index: 0, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Completed successfully.' },
});
emit({
  event: 'step_update',
  step_update: { conversation_id: conversationId, step_index: 0, state: 'DONE', step_type: 'agent_response', text_delta: '\n' },
});
emit({ event: 'result', result: { conversation_id: conversationId, status: 'SUCCESS', response: 'Completed successfully.\n', duration_seconds: 0.1, num_turns: 1 } });
process.stdout.write('', () => process.exit(1));
