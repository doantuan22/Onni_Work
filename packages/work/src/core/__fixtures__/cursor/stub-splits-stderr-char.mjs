#!/usr/bin/env node
// Stub agent binary that fails with a stderr message whose last character (a 4-byte emoji) arrives in two
// separate writes, so the parent sees two 'data' chunks with the character cut between them.
const emoji = Buffer.from('🙂', 'utf8');
const pause = () => new Promise((resolve) => setTimeout(resolve, 150));
process.stdin.resume();
process.stderr.write('boom ');
await pause();
process.stderr.write(emoji.subarray(0, 2));
await pause();
process.stderr.write(emoji.subarray(2));
await pause();
process.stderr.write('\n');
process.exit(3);
