import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { resolveProgram } from './disclaim-spawn.ts';
import { spawnableCommand } from './windows-shim.ts';

/**
 * A change token for the file a CLI actually runs: its path, size and mtime. A CLI update
 * rewrites that file, so a model catalog cached under the old token is refreshed on the next
 * read — a new model list shows up without waiting out the TTL, a restart or a click.
 *
 * Null when nothing can be stat'ed (not installed yet, or a path that no longer exists). That is
 * not an error: an install after a failed discovery then reads as a change too.
 */
export function programFingerprint(program: string): string | null {
  const target = executableFile(program);
  if (!target) return null;
  try {
    const { size, mtimeMs } = statSync(target);
    return `${target}:${size}:${mtimeMs}`;
  } catch {
    return null;
  }
}

/** The file whose replacement means "new version": an npm shim's script, else the binary itself. */
function executableFile(program: string): string | null {
  if (process.platform === 'win32') {
    // Exactly the file the spawn runs, so a bare `codex` is found on PATH and unwrapped to the
    // `codex.js` an npm update rewrites (the shim and that script change together).
    const [file, argv] = spawnableCommand(program, []);
    return basename(file).toLowerCase() === 'node.exe' && argv[0] ? argv[0] : file;
  }
  // `stat` follows a symlink, so Claude's `versions/2.1.295` link reports the real binary.
  return resolveProgram(program, process.env.PATH);
}
