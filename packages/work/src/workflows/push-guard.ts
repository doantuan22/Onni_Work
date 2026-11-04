import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A fence, not a sandbox (docs/design/unattended-safety.md §5): unattended agents get a git
 * `pre-push` hook that refuses any ref outside `refs/heads/onni/*` (plus the run's own recorded
 * branch). It is injected per run through `GIT_CONFIG_*` environment variables (git >= 2.31), so
 * nothing in the user's repository or its shared config changes — `extensions.worktreeConfig`
 * would have to be switched on repo-wide, breaking older git tooling for every worktree.
 *
 * What it does NOT stop: `git push --no-verify`, an agent that unsets the variables or rewrites
 * `core.hooksPath` itself, a push through another tool (`gh api`, curl), and anything git-free.
 */
export const PRE_PUSH_HOOK = `#!/bin/sh
# onni push guard (docs/design/unattended-safety.md): an unattended run may push only its own branch.
allowed="\${ONNI_PUSH_ALLOW_BRANCH:-}"
while read -r local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/onni/*) continue ;;
  esac
  if [ -n "$allowed" ] && [ "$remote_ref" = "refs/heads/$allowed" ]; then continue; fi
  echo "onni: push to $remote_ref refused — an unattended run may only push its own onni/* branch" >&2
  exit 1
done
exit 0
`;

/** Branch names a task branch may never be called, whatever the namer produced. */
const PROTECTED_BRANCHES = new Set(['main', 'master', 'trunk', 'develop', 'dev', 'head']);

/** Whether onni itself may push `branch` for a run (the `git.push` node): never a base, never a force. */
export function pushRefusal(branch: string, protect: readonly (string | undefined)[] = []): string | undefined {
  if (branch.startsWith('+')) return `refusing a forced push: ${branch}`;
  if (PROTECTED_BRANCHES.has(branch.toLowerCase())) return `refusing to push the protected branch "${branch}" from a task`;
  if (protect.some((name) => name !== undefined && name === branch)) return `refusing to push the base branch "${branch}" from a task`;
  return undefined;
}

/** Write the hook (idempotently) and return its directory, or undefined when the data dir is read-only. */
export function ensurePushGuard(dataDir: string): string | undefined {
  try {
    const dir = join(dataDir, 'hooks');
    const file = join(dir, 'pre-push');
    if (!existsSync(file) || readFileSync(file, 'utf8') !== PRE_PUSH_HOOK) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, PRE_PUSH_HOOK, { mode: 0o755 });
      try { chmodSync(file, 0o755); } catch { /* not meaningful on Windows */ }
    }
    return dir.replace(/\\/g, '/');
  } catch {
    return undefined;
  }
}

/** More inherited pairs than any real setup has; a larger COUNT is a mistake, not a list to walk. */
const MAX_INHERITED_CONFIG_PAIRS = 1_000;

/**
 * The environment that arms the hook for one unattended run. Existing `GIT_CONFIG_*` pairs are
 * carried across, renumbered without gaps (git refuses a COUNT whose KEY_n is missing), so
 * appending ours at the next index cannot orphan them. A COUNT that is not a plain number, or is
 * absurdly large, is ignored — git would reject it anyway, and walking `GIT_CONFIG_COUNT=1e9`
 * synchronously froze the server.
 */
export function pushGuardEnv(
  dataDir: string,
  run: { branch?: string },
  base: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const dir = ensurePushGuard(dataDir);
  if (!dir) return {};
  const declared = (base.GIT_CONFIG_COUNT ?? '').trim();
  const existing = /^\d+$/.test(declared) ? Number(declared) : 0;
  const count = existing <= MAX_INHERITED_CONFIG_PAIRS ? existing : 0;
  const env: Record<string, string> = {};
  let next = 0;
  for (let i = 0; i < count; i++) {
    const key = base[`GIT_CONFIG_KEY_${i}`];
    const value = base[`GIT_CONFIG_VALUE_${i}`];
    if (key !== undefined && value !== undefined) {
      env[`GIT_CONFIG_KEY_${next}`] = key;
      env[`GIT_CONFIG_VALUE_${next}`] = value;
      next += 1;
    }
  }
  env.GIT_CONFIG_COUNT = String(next + 1);
  env[`GIT_CONFIG_KEY_${next}`] = 'core.hooksPath';
  env[`GIT_CONFIG_VALUE_${next}`] = dir;
  if (run.branch) env.ONNI_PUSH_ALLOW_BRANCH = run.branch;
  return env;
}

/** Bash rules an unattended Claude session may not run (`--disallowedTools`); other backends have no such seam. */
export const UNATTENDED_DENIED_TOOLS: readonly string[] = [
  'Bash(git push:*)',
  'Bash(gh pr merge:*)',
  'Bash(git remote add:*)',
  'Bash(git remote set-url:*)',
];
