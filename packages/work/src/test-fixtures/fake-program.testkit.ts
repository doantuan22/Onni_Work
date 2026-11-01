import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { vi } from 'vitest';

/**
 * Put a fake external program on PATH that the product's `execFile(name, …)` really runs.
 *
 * A `#!/bin/sh` file is enough on POSIX, but Windows has no equivalent that `execFile` can
 * start: libuv does not expand PATHEXT, and since the CVE-2024-27980 fix Node refuses a
 * `.cmd`/`.bat` when `shell` is false (`spawn EINVAL`, measured on Node 24.21). So on Windows
 * the fake is a real `name.exe` — the running `node.exe` (symlinked, copied only when symlinks
 * are unavailable) — and a `NODE_OPTIONS=--require` shim hands control to the body before Node
 * tries to resolve the first argument as a script file.
 *
 * Why bother: a test that *thinks* it substituted `gh` but is silently running the real one
 * reaches the network. The shim also strips GitHub credentials and points `GH_CONFIG_DIR` at
 * an empty directory, so even a failed substitution cannot touch an account.
 *
 * `body` is CommonJS evaluated with `args` (the argv the caller passed) in scope, plus the
 * usual `require`, `process` and `__dirname`. Interpolate paths into it from the test (the body
 * is a template literal, so `${join(dir, 'argv')}` is resolved before it is written). It runs
 * to completion; the runner then exits with `process.exitCode`, so `process.exit(n)` inside
 * the body wins and a plain return exits 0.
 */
export interface FakeProgramOptions {
  /** Directory for the executable; created when omitted. Tests that already own one pass it. */
  dir?: string;
  body: string;
}

export interface FakeProgram {
  dir: string;
  executable: string;
  /** Prepend the fake to PATH, clear GitHub credentials and install the Windows shim. */
  use(): void;
}

/** One shim per process: `NODE_OPTIONS` is a single value, so it maps every installed fake. */
let shimDir: string | undefined;

function shimPath(): string {
  if (shimDir) return join(shimDir, 'node-options-shim.cjs');
  shimDir = mkdtempSync(join(tmpdir(), 'onni-fake-shim-'));
  writeFileSync(
    join(shimDir, 'node-options-shim.cjs'),
    `'use strict';
const path = require('node:path');
const map = JSON.parse(process.env.ONNI_FAKE_PROGRAMS || '{}');
const name = path.basename(process.execPath).replace(/\\.exe$/i, '').toLowerCase();
const target = map[name];
if (!target) return; // A real node child inherited our env: leave it alone.
// Node has already resolved argv[1] as a script candidate (and path.basename mangles a
// Windows flag such as /PID), so take the untouched command line from the report instead.
const commandLine = process.report && process.report.getReport().header.commandLine;
const raw = commandLine && commandLine.length > 1
  ? commandLine.slice(1)
  : process.argv.slice(1).map((arg, index) => (index === 0 ? path.basename(arg) : arg));
process.argv = [process.execPath, target, ...raw];
require(target);
`,
  );
  // The shim must outlive every fake directory a test removes, or a later fake in the same
  // worker would point at a missing preload; drop it when the worker exits instead.
  process.once('exit', () => {
    try {
      rmSync(shimDir!, { recursive: true, force: true });
    } catch {
      // A directory still held open is not worth failing a green run over.
    }
  });
  return join(shimDir, 'node-options-shim.cjs');
}

const singleQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

export function fakeProgram(name: string, options: FakeProgramOptions): FakeProgram {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), `onni-fake-${name}-`));
  mkdirSync(dir, { recursive: true });
  const bodyPath = join(dir, `${name}.fake.cjs`);
  writeFileSync(
    bodyPath,
    `'use strict';\nconst args = process.argv.slice(2);\n${options.body}\nprocess.exit(process.exitCode ?? 0);\n`,
  );

  const executable = process.platform === 'win32' ? join(dir, `${name}.exe`) : join(dir, name);
  if (process.platform === 'win32') {
    if (!existsSync(executable)) {
      try {
        symlinkSync(process.execPath, executable, 'file');
      } catch {
        copyFileSync(process.execPath, executable);
      }
    }
  } else {
    writeFileSync(executable, `#!/bin/sh\nexec ${singleQuote(process.execPath)} ${singleQuote(bodyPath)} "$@"\n`, {
      mode: 0o755,
    });
  }

  return {
    dir,
    executable,
    use() {
      const currentPath = process.env.PATH ?? '';
      vi.stubEnv('PATH', currentPath ? `${dir}${delimiter}${currentPath}` : dir);
      // Belt and braces for a failed substitution: no token, no user config, no account.
      vi.stubEnv('GH_TOKEN', '');
      vi.stubEnv('GITHUB_TOKEN', '');
      vi.stubEnv('GH_ENTERPRISE_TOKEN', '');
      const ghConfig = join(dir, 'gh-config');
      mkdirSync(ghConfig, { recursive: true });
      vi.stubEnv('GH_CONFIG_DIR', ghConfig);

      if (process.platform === 'win32') {
        const map = JSON.parse(process.env.ONNI_FAKE_PROGRAMS || '{}') as Record<string, string>;
        map[name.toLowerCase()] = bodyPath;
        vi.stubEnv('ONNI_FAKE_PROGRAMS', JSON.stringify(map));
        const requireArg = `--require "${shimPath().replaceAll('\\', '/')}"`;
        const existing = (process.env.NODE_OPTIONS ?? '').trim();
        vi.stubEnv('NODE_OPTIONS', existing.includes(requireArg) ? existing : `${existing} ${requireArg}`.trim());
      }
    },
  };
}
