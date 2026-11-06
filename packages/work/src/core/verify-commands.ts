import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** package.json scripts a worker needs to check its own work. Each becomes one exact line. */
const VERIFY_SCRIPTS = ['test', 'build', 'lint', 'typecheck', 'check'] as const;

/**
 * The repo's own verification commands, as exact grant lines (measured in a live run: a worker at
 * allow-rules could run `git status` but not `npm test`, so it could never check its work). Found,
 * not configured — `npm test` / `npm run <script>` for the scripts above, `cargo check`/`cargo test`
 * when there is a Cargo.toml. Only the allow-rules level uses them. They run repo-defined scripts,
 * which a worker can edit: the same exposure as Claude's `bashAllowlist` prefixes, and still a
 * barrier, not a sandbox.
 */
export function discoverVerifyCommands(cwd: string | undefined): string[] {
  if (!cwd) return [];
  const lines: string[] = [];
  try {
    const manifest = join(cwd, 'package.json');
    if (existsSync(manifest)) {
      const scripts = (JSON.parse(readFileSync(manifest, 'utf8')) as { scripts?: Record<string, unknown> }).scripts ?? {};
      for (const name of VERIFY_SCRIPTS) {
        if (typeof scripts[name] === 'string') lines.push(name === 'test' ? 'npm test' : `npm run ${name}`);
      }
    }
  } catch {
    /* an unreadable manifest just means no discovered commands */
  }
  if (existsSync(join(cwd, 'Cargo.toml'))) lines.push('cargo check', 'cargo test');
  return lines;
}
