import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INTERNAL_JOB_PAYLOAD = 'ONNI_INTERNAL_TASK_JOB_PAYLOAD';
const WINDOWS_JOB_SPAWN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/windows-job-spawn.ps1');

/** Launch a task child inside a kill-on-close Job Object on Windows. */
export function spawnTaskProcess(
  file: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio = {},
): ChildProcessWithoutNullStreams {
  const env = options.env ?? process.env;
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
