#!/usr/bin/env node
// Stub `claude` binary that replays `two-turn-cost.ndjson`: two turns of ONE session, recorded from the
// real CLI (2.1.316, haiku). `total_cost_usd` is session-cumulative, so the second `result` carries the
// first turn's cost again. STUB_RESUMED=1 replays only the second turn, as a `--resume` process does
// (its first `result` already includes the cost of the resumed session).
import { readFileSync } from 'node:fs';

const lines = readFileSync(new URL('./two-turn-cost.ndjson', import.meta.url), 'utf8').split('\n').filter(Boolean);
let skipping = process.env.STUB_RESUMED === '1';
for (const line of lines) {
  const frame = JSON.parse(line);
  if (frame.type === 'system' || !skipping) process.stdout.write(`${line}\n`);
  if (frame.type === 'result') skipping = false;
}
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
