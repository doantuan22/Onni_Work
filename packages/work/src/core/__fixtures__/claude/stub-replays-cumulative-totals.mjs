#!/usr/bin/env node
// Stub `claude` binary that answers with one `result` frame per entry of STUB_TOTALS (a JSON array of
// session-cumulative `total_cost_usd` values), as a multi-turn session does.
const totals = JSON.parse(process.env.STUB_TOTALS ?? '[]');
for (const total of totals) {
  process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: total })}\n`);
}
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
