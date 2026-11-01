import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { processJobs } from './process-jobs.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '../..');
const PARENT_SCRIPT = path.join(PACKAGE_ROOT, 'src/test-fixtures/job-parent.cjs');
const ENGINE_SCRIPT = path.join(PACKAGE_ROOT, 'src/test-fixtures/job-engine.mjs');
const win = process.platform === 'win32';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

/** A holder process that does nothing but stay alive — the "detached descendant" under test. */
function scratchDir(): { dir: string; holder: string; pidFile: string; goFile: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'onni-job-'));
  const holder = path.join(dir, 'holder.cjs');
  writeFileSync(holder, 'setInterval(() => {}, 1000);\n');
  return { dir, holder, pidFile: path.join(dir, 'pids.json'), goFile: path.join(dir, 'go') };
}

function forceKill(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // Already gone.
  }
}

/**
 * C-05: the engine's job, not the wrapper's. The wrapper's kill-on-close job dies with the
 * wrapper, and a wrapper outlives a hard-killed engine as an orphan — measured, a mock agent CLI
 * stayed alive after its cockpit was killed. These tests own the tree from the engine instead.
 */
describe('engine-wide job ownership (C-05)', () => {
  it('owns nothing on a host with no keeper', async () => {
    if (win) {
      expect(processJobs.supported).toBe(true);
      return;
    }
    expect(processJobs.supported).toBe(false);
    expect(await processJobs.job('off-platform').assign(1)).toBe(false);
    expect(await processJobs.job('off-platform').terminate()).toBe(false);
  });

  it('assign() owns a detached grandchild, and terminate() takes it down', async () => {
    if (!win) return;
    const scratch = scratchDir();
    expect(await processJobs.ready()).toBe(true);
    const job = processJobs.job(`test-${randomUUID()}`);
    const parent = spawn(process.execPath, [PARENT_SCRIPT, scratch.holder, scratch.pidFile, scratch.goFile], { stdio: 'ignore' });
    try {
      // Assign BEFORE the grandchild exists: job membership is inherited at creation, never
      // retroactively, which is exactly why the engine waits for `ready()` before spawning.
      expect(await job.assign(parent.pid!)).toBe(true);
      writeFileSync(scratch.goFile, 'go');
      expect(await waitFor(() => existsSync(scratch.pidFile), 10_000)).toBe(true);
      const pids = JSON.parse(readFileSync(scratch.pidFile, 'utf8')) as { parent: number; child: number };
      expect(alive(pids.child)).toBe(true);

      expect(await job.terminate()).toBe(true);
      expect(await waitFor(() => !alive(pids.parent) && !alive(pids.child), 10_000)).toBe(true);
    } finally {
      forceKill(parent.pid);
      rmSync(scratch.dir, { recursive: true, force: true });
    }
  }, 40_000);

  it('a hard-killed engine takes the whole tree with it', async () => {
    if (!win) return;
    const scratch = scratchDir();
    const engine = spawn(process.execPath, ['--import', 'tsx', ENGINE_SCRIPT, PARENT_SCRIPT, scratch.holder, scratch.pidFile], {
      cwd: PACKAGE_ROOT,
      stdio: 'ignore',
    });
    let pids: { parent: number; child: number } | undefined;
    try {
      expect(await waitFor(() => existsSync(`${scratch.pidFile}.started`), 40_000)).toBe(true);
      expect(readFileSync(`${scratch.pidFile}.started`, 'utf8')).toBe('started');
      const enginePids = JSON.parse(readFileSync(`${scratch.pidFile}.engine`, 'utf8')) as {
        ready: boolean;
        assigned: boolean;
      };
      expect(enginePids).toMatchObject({ ready: true, assigned: true });
      pids = JSON.parse(readFileSync(scratch.pidFile, 'utf8')) as { parent: number; child: number };
      expect(alive(pids.child)).toBe(true);

      // The engine alone. No /T: nothing else is signalled, so anything that dies is the job.
      execFileSync('taskkill', ['/F', '/PID', String(engine.pid)], { stdio: 'ignore' });
      expect(await waitFor(() => !alive(pids!.parent) && !alive(pids!.child), 15_000)).toBe(true);
    } finally {
      forceKill(engine.pid);
      forceKill(pids?.parent);
      rmSync(scratch.dir, { recursive: true, force: true });
    }
  }, 60_000);
});
