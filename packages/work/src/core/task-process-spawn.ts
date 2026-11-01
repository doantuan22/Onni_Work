import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { jobKeyForEnv, processJobs } from './process-jobs.ts';

const INTERNAL_JOB_PAYLOAD = 'ONNI_INTERNAL_TASK_JOB_PAYLOAD';
const WINDOWS_JOB_SPAWN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/windows-job-spawn.ps1');

/**
 * Launch a task child inside a kill-on-close Job Object on Windows.
 *
 * Every Windows spawn is also assigned to the engine's own job (C-05): the wrapper's job covers a
 * run's leftovers, but it dies with the wrapper, and a wrapper outlives the engine as an orphan.
 * Membership is inherited, so the CLI and everything it starts die when the engine does — and
 * `jobKeyForEnv` keeps one job per run so a run's turns share it. Callers await
 * `processJobs.ready()` once before the first spawn of a run: on a cold keeper the assignment
 * could otherwise lose the race with the child the wrapper is already starting.
 */
export function spawnTaskProcess(
  file: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio = {},
): ChildProcessWithoutNullStreams {
  const env = options.env ?? process.env;
  const child = spawnOwned(file, args, options, env);
  if (child.pid !== undefined) void processJobs.job(jobKeyForEnv(env)).assign(child.pid);
  return child;
}

function spawnOwned(
  file: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
  env: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
  if (process.platform !== 'win32' || !env.ONNI_TASK_ID) {
    return nodeSpawn(file, [...args], options);
  }

  const cwd = options.cwd instanceof URL ? fileURLToPath(options.cwd) : options.cwd ?? process.cwd();
  const payload = Buffer.from(JSON.stringify({ file, args, cwd: path.resolve(cwd) })).toString('base64');
  const wrapperEnv = { ...env, [INTERNAL_JOB_PAYLOAD]: payload };
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return nodeSpawn(
    powershell,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WINDOWS_JOB_SPAWN],
    { ...options, env: wrapperEnv, shell: false, detached: false, windowsHide: true },
  );
}
