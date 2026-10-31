import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnableCommand } from './windows-shim.ts';

/** True when `path` is an existing regular file (the executable bit is not meaningful on Windows). */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The real Antigravity CLI binary — `ONNI_ANTIGRAVITY_BIN`, else `agy` on PATH, else the installer's
 * own directory (`%LOCALAPPDATA%\agy\bin` on Windows, `~/.local/bin` elsewhere), else a bare `agy`
 * (so a spawn fails with the usual "not found"). A terminal opened before the installer ran has
 * no PATH entry yet, which is why the installer directory is checked too (spike step 0).
 */
export function resolveAntigravityBin(
  optsBin?: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  if (optsBin) return optsBin;
  if (env.ONNI_ANTIGRAVITY_BIN) return env.ONNI_ANTIGRAVITY_BIN;
  const name = platform === 'win32' ? 'agy.exe' : 'agy';
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (dir && isFile(join(dir, name))) return join(dir, name);
  }
  const installerDir =
    platform === 'win32'
      ? env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'agy', 'bin') : undefined
      : join(home, '.local', 'bin');
  if (installerDir && isFile(join(installerDir, name))) return join(installerDir, name);
  return 'agy';
}

/** Path to the bundled mock (`scripts/mock-antigravity.mjs`), for ONNI_DRY_RUN=1. */
export function mockAntigravityPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // here = <pkg>/dist/core (built) or <pkg>/src/core (tsx dev).
  return resolvePath(here, '..', '..', 'scripts', 'mock-antigravity.mjs');
}

/**
 * The binary every Onni call site spawns: an explicit override, else (under `ONNI_DRY_RUN=1`) the
 * bundled mock — a dry run never reaches the real agy, not even for `--version` or `models` — else
 * the real one. The mock implements `--version`, `models` and `-p`.
 */
export function resolveAntigravityExecutable(optsBin?: string): string {
  if (optsBin) return optsBin;
  if (process.env.ONNI_ANTIGRAVITY_BIN) return process.env.ONNI_ANTIGRAVITY_BIN;
  if (process.env.ONNI_DRY_RUN === '1') return mockAntigravityPath();
  return resolveAntigravityBin();
}

/** `[file, argv]` for a spawn: a `.mjs` mock runs under this node, a native exe runs as is. */
export function antigravityLaunch(bin: string, args: readonly string[]): [string, string[]] {
  if (/\.[cm]?js$/.test(bin)) return [process.execPath, [bin, ...args]];
  return spawnableCommand(bin, args);
}
