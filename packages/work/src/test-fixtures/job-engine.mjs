// A mock engine for the C-05 test: it owns a job through the REAL engine module, hands a parent to
// it, and then idles until the test hard-kills it (`taskkill /F` without /T, so nothing but the
// engine and the keeper's stdin-EOF path can be doing the cleanup).
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { processJobs } from '../core/process-jobs.ts';

const [parentScript, holderScript, pidFile] = process.argv.slice(2);
const goFile = `${pidFile}.go`;

const ready = await processJobs.ready();
const job = processJobs.job('c05-fixture');
const parent = spawn(process.execPath, [parentScript, holderScript, pidFile, goFile], { stdio: 'ignore' });
const assigned = await job.assign(parent.pid);
writeFileSync(`${pidFile}.engine`, JSON.stringify({ ready, assigned, engine: process.pid, parent: parent.pid }));
// Only now may the grandchild exist: assignment is not retroactive.
writeFileSync(goFile, 'go');

const deadline = Date.now() + 20_000;
while (!existsSync(pidFile) && Date.now() < deadline) await delay(20);
writeFileSync(`${pidFile}.started`, existsSync(pidFile) ? 'started' : 'timeout');
setInterval(() => {}, 1000);
