/**
 * Node refuses to spawn a `.cmd`/`.bat` without a shell (EINVAL since 20.12, CVE-2024-27980), and
 * running one through `cmd.exe` would reopen the BatBadBut surface closed in #459. Yet `npm i -g`
 * on Windows installs every agent CLI as exactly such a shim, so a `ONNI_CODEX_BIN=…\codex.cmd`
 * threw before the CLI ever ran (telemetry a330744e).
 *
 * An npm or pnpm shim only ever runs `node <script> %*` or a native `<bin>.exe %*`, so this reads
 * the target out of it and spawns that directly: same program, no shell. The `.ps1` twin npm writes
 * beside it (what PowerShell's `Get-Command` names) is read the same way (telemetry 3626ac13), and
 * a `.js` override gets the same treatment.
 *
 * A bare `codex` never reached the shim: Node hands the name to CreateProcess, which appends only
 * `.exe` and knows nothing of `PATH`'s `.cmd`. So a bare name is first resolved the way cmd.exe
 * finds it — `PATH` × `PATHEXT` — and the hit then unwrapped. Nothing is cached: a CLI installed
 * while the server runs is found by the next probe.
 */
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';

const SHIM_EXTENSIONS = new Set(['.cmd', '.bat', '.ps1']);
const SCRIPT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const NATIVE_EXTENSIONS = new Set(['.exe', '.com']);
/** The quoted target right before `%*`: npm writes `"%dp0%\…"`, pnpm `"%~dp0\…"`. */
const CMD_TARGET_RE = /"%~?dp0%?\\?([^"%]+)"\s*%\*/g;
/** The `.ps1` twin npm and pnpm write beside it: `"$basedir/…"` right before `$args`. */
const PS1_TARGET_RE = /"\$basedir[\\/]([^"$]+)"\s*\$args/g;
const SHIM_MAX_BYTES = 64 * 1024;
const NODE_SHEBANG_RE = /^#!.*\bnode\b/;

export interface ShimOptions {
  platform?: NodeJS.Platform;
  /** The node to run a script with when the shim has none beside it; defaults to this process's. */
  nodePath?: string;
  /** Where `PATH` and `PATHEXT` come from; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** What a shim launches: a node script, or a native binary it calls directly (opencode). */
export interface ShimTarget {
  kind: 'node' | 'native';
  path: string;
}

/** Up to `maxBytes` of a file, or null when it is unreadable or longer. */
function readHead(path: string, maxBytes: number): string | null {
  try {
    // One descriptor, one bounded read: no stat-then-read gap (CodeQL js/file-system-race).
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes + 1);
      const bytes = readSync(fd, buffer, 0, buffer.length, 0);
      if (bytes > maxBytes) return null;
      return buffer.toString('utf8', 0, bytes);
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

function hasNodeShebang(path: string): boolean {
  try {
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.alloc(256);
      const bytes = readSync(fd, buffer, 0, buffer.length, 0);
      return NODE_SHEBANG_RE.test(buffer.toString('utf8', 0, bytes).split(/\r?\n/)[0]!);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** The program an npm/pnpm `.cmd`/`.bat`/`.ps1` shim launches, or null for anything else. */
export function shimTarget(shimPath: string): ShimTarget | null {
  const text = readHead(shimPath, SHIM_MAX_BYTES);
  if (text === null) return null;
  const pattern = extname(shimPath).toLowerCase() === '.ps1' ? PS1_TARGET_RE : CMD_TARGET_RE;
  // Both shims repeat the target in each branch; any disagreement is a shim we don't understand.
  const targets = new Set([...text.matchAll(pattern)].map((match) => match[1]!.trim()));
  if (targets.size !== 1) return null;
  const [relative] = targets;
  const path = resolve(dirname(shimPath), relative!.replace(/\\/g, '/'));
  if (!existsSync(path)) return null;
  const ext = extname(path).toLowerCase();
  if (NATIVE_EXTENSIONS.has(ext)) return { kind: 'native', path };
  // cmd-shim keeps a bin's own name, so a `#!/usr/bin/env node` bin often has no extension.
  if (SCRIPT_EXTENSIONS.has(ext) || (ext === '' && hasNodeShebang(path))) return { kind: 'node', path };
  return null;
}

/** The node script an npm/pnpm shim launches, or null for anything else. */
export function shimScript(shimPath: string): string | null {
  const target = shimTarget(shimPath);
  return target?.kind === 'node' ? target.path : null;
}

/**
 * `program` as an absolute path on `PATH`, the way cmd.exe finds a bare name: `PATH` × `PATHEXT`.
 * Null for anything that is already a path, so a missing absolute path keeps its own ENOENT.
 */
function resolveOnPath(program: string, env: NodeJS.ProcessEnv): string | null {
  if (isAbsolute(program) || /[\\/]/.test(program)) return null;
  const path = env.PATH ?? env.Path ?? env.path;
  if (!path) return null;
  // An extensionless bin on PATH is npm's POSIX twin — Windows cannot execute it — so a bare
  // name only ever gets PATHEXT candidates. Windows ignores case; lower-casing keeps the lookup
  // the same on a case-sensitive host (tests).
  const exts = (env.PATHEXT ?? env.Pathext ?? env.pathext ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);
  const names = extname(program) ? [program] : exts.map((ext) => program + ext);
  for (const entry of path.split(';')) {
    const dir = entry.trim().replace(/^"|"$/g, '');
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * `[file, args]` that run `program` without a shell. Untouched off Windows and for anything that
 * is not a recognisable shim or script, so a bad path still fails the spawn with its own error.
 */
export function spawnableCommand(
  program: string,
  args: readonly string[],
  opts: ShimOptions = {},
): [string, string[]] {
  if ((opts.platform ?? process.platform) !== 'win32') return [program, [...args]];
  const found = resolveOnPath(program, opts.env ?? process.env) ?? program;
  const ext = extname(found).toLowerCase();
  const nodePath = opts.nodePath ?? process.execPath;
  const shimPath = isAbsolute(found) ? found : resolve(found);
  if (SCRIPT_EXTENSIONS.has(ext) && existsSync(shimPath)) return [nodePath, [shimPath, ...args]];
  if (!SHIM_EXTENSIONS.has(ext)) return [found, [...args]];
  const target = shimTarget(shimPath);
  if (!target) return [program, [...args]];
  if (target.kind === 'native') return [target.path, [...args]];
  // The shim prefers a node.exe shipped beside it; mirror that.
  const bundledNode = join(dirname(shimPath), 'node.exe');
  return [existsSync(bundledNode) ? bundledNode : nodePath, [target.path, ...args]];
}
