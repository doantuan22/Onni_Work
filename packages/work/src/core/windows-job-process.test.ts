import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createConnection, createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { spawnTaskProcess } from './task-process-spawn.ts';

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

async function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 300);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('could not reserve a loopback port');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function runTree(naturalExitMs?: number): Promise<void> {
  if (process.platform !== 'win32') return;

  const scratch = mkdtempSync(path.join(tmpdir(), 'onni-job-tree-'));
  const pidFile = path.join(scratch, 'pids.json');
  const readyFile = path.join(scratch, 'listening');
  const port = await unusedPort();
  const serverCode = [
    "const http = require('node:http');",
    `const server = http.createServer((_req, res) => res.end('alive')); server.listen(${port}, '127.0.0.1', () => require('node:fs').writeFileSync(${JSON.stringify(readyFile)}, 'ready'));`,
    'setInterval(() => {}, 1000);',
  ].join('\n');
  const taskCode = [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(serverCode)}], { stdio: 'ignore' });`,
    `fs.writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, child.pid]));`,
    naturalExitMs === undefined ? 'setInterval(() => {}, 1000);' : `setTimeout(() => process.exit(0), ${naturalExitMs});`,
  ].join('\n');

  const task = spawnTaskProcess(process.execPath, ['-e', taskCode], {
    cwd: process.cwd(),
    env: { ...process.env, ONNI_TASK_ID: randomUUID() },
  });
  let stderr = '';
  task.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
  try {
    expect(await waitFor(() => existsSync(readyFile)), stderr || 'the child server did not start').toBe(true);
    expect(await portOpen(port)).toBe(true);
    const pids = JSON.parse(readFileSync(pidFile, 'utf8')) as number[];
    expect(pids).toHaveLength(2);

    if (naturalExitMs === undefined) {
      const closed = new Promise<void>((resolve) => task.once('close', () => resolve()));
      task.kill('SIGTERM');
      await closed;
    } else {
      await new Promise<void>((resolve) => task.once('close', () => resolve()));
    }

    expect(await waitFor(() => pids.every((pid) => !processAlive(pid)), 5_000)).toBe(true);
    expect(await waitFor(async () => !(await portOpen(port)), 5_000)).toBe(true);
  } finally {
    if (task.exitCode === null && task.signalCode === null) {
      const closed = new Promise<void>((resolve) => task.once('close', () => resolve()));
      task.kill();
      await closed;
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe('Windows task Job Objects', () => {
  it('cancel/timeout closes the task tree and releases a descendant server port', async () => {
    await runTree();
  }, 20_000);

  it('natural task completion closes a surviving descendant and releases its port', async () => {
    await runTree(300);
  }, 20_000);
});
