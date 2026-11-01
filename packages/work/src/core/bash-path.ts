/**
 * The shell check steps, landing checks and worktree lifecycle hooks run in.
 *
 * POSIX hosts have `bash` on PATH. Windows does not: Git for Windows installs it under
 * `Git\bin` and `Git\usr\bin`, while only `Git\cmd` (git.exe) is on PATH — so a bare
 * `spawn('bash')` fails with ENOENT on a stock install even though the machine has Git.
 * Derive the install root from `git.exe`, then fall back to the standard install dirs, so
 * "has Git for worktrees" also means "can run its checks" with no configuration.
 */
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface BashResolution {
  /** The bash executable to spawn. */
  path: string;
  /**
   * Directories to prepend to the child PATH. Windows bash lives beside its coreutils in
   * `usr\bin`; adding them keeps `printf`/`sleep`/`test` available even when the login
   * profile a `-lc` shell sources is absent or cannot reset PATH.
   */
  pathDirs: string[];
}

export interface BashOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Probe seam; defaults to "is a regular file". */
  isFile?: (path: string) => boolean;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function pathEntries(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(';')
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

function findIn(entries: string[], names: string[], probe: (path: string) => boolean): string | null {
  for (const dir of entries) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (probe(candidate)) return candidate;
    }
  }
  return null;
}

function envDir(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/** Standard Git for Windows install roots, richest first. */
function installRoots(env: NodeJS.ProcessEnv): string[] {
  const roots: string[] = [];
  for (const name of ['ProgramFiles', 'ProgramW6432', 'ProgramFiles(x86)']) {
    const base = envDir(env, name);
    if (base) roots.push(join(base, 'Git'));
  }
  const local = envDir(env, 'LOCALAPPDATA');
  if (local) roots.push(join(local, 'Programs', 'Git'));
  return roots;
}

/** Where bash sits under a Git for Windows root. `Git\cmd` → `..\bin`; `Git\ucrt64\bin` → `..\..\bin`. */
function bashUnder(root: string): string[] {
  return [
    join(root, 'bin', 'bash.exe'),
    join(root, 'usr', 'bin', 'bash.exe'),
  ];
}

/**
 * The bash a spawned shell should use, or null when a Windows host has no Git for Windows.
 * No caching: installing Git while onni runs is picked up by the next check.
 */
export function resolveBash(options: BashOptions = {}): BashResolution | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const probe = options.isFile ?? isFile;
  if (platform !== 'win32') return { path: 'bash', pathDirs: [] };

  const entries = pathEntries(env.PATH);
  const onPath = findIn(entries, ['bash.exe', 'bash'], probe);
  if (onPath) return { path: onPath, pathDirs: [dirname(onPath)] };

  const git = findIn(entries, ['git.exe', 'git'], probe);
  if (git) {
    const cmdDir = dirname(git);
    // Git\cmd\git.exe → Git\bin ; Git\ucrt64\bin\git.exe → Git\bin
    const roots = [join(cmdDir, '..'), join(cmdDir, '..', '..')];
    for (const root of roots) {
      for (const bash of bashUnder(root)) {
        if (probe(bash)) return { path: bash, pathDirs: pathDirsFor(bash, probe) };
      }
    }
  }

  for (const root of installRoots(env)) {
    for (const bash of bashUnder(root)) {
      if (probe(bash)) return { path: bash, pathDirs: pathDirsFor(bash, probe) };
    }
  }
  return null;
}

/** `Git\bin\bash.exe` → [`Git\bin`, `Git\usr\bin`]; `Git\usr\bin` → itself. */
function pathDirsFor(bash: string, probe: (path: string) => boolean): string[] {
  const dir = dirname(bash);
  const usrBin = join(dir, '..', 'usr', 'bin');
  return dir.endsWith(`${join('usr', 'bin')}`) ? [dir] : [dir, ...(probe(join(usrBin, 'bash.exe')) ? [usrBin] : [])];
}

/** The one-line failure a caller reports when no shell exists — not a stock ENOENT. */
export const BASH_MISSING_MESSAGE =
  'bash was not found — checks, landing and worktree lifecycle commands need Git for Windows (bash); install it or add its bin directory to PATH';

/** The env a spawned bash needs: its own directories first, separator native to the host. */
export function withBashPath(env: NodeJS.ProcessEnv, bash: BashResolution): NodeJS.ProcessEnv {
  if (bash.pathDirs.length === 0) return env;
  const current = env.PATH ?? env.Path ?? '';
  const merged = [...bash.pathDirs, ...(current ? current.split(';') : [])].filter(Boolean);
  return { ...env, PATH: merged.join(';') };
}
