#!/usr/bin/env node
// Stub `claude` binary whose stdout also carries lines that are VALID JSON but not objects — what a
// wrapper script, a shell profile or a hook can print around the real stream-json frames — followed
// by one genuine assistant turn and a result.

for (const stray of ['null', '42', 'true', '"warning: slow disk"', '[]', '[1,2]', '0']) {
  process.stdout.write(`${stray}\n`);
}
process.stdout.write(
  `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'work done' }] } })}\n`,
);
process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'work done', total_cost_usd: 0.01 })}\n`);
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
