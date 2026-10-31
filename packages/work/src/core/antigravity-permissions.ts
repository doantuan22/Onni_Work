/**
 * What an Antigravity (`agy`) run is allowed to do headlessly (ADR 0007).
 *
 * agy cannot ask for approval when stdout is a pipe: a tool that needs a permission is auto-denied.
 * Three levels decide what the runner passes (spike step 0, c): none, a narrow `--settings`
 * allowlist, or `--dangerously-skip-permissions`. Anything not allowed stays denied by default.
 */
import type { AgentPermissionLevel } from '@onni/contract';

/**
 * The prefixes a worker (or a solo task) may run, as `command(<prefix>)` grants. Read and commit
 * git inside the worktree, and the one onni command a worker needs. Deliberately absent: `git push`,
 * network tools (`curl`, `gh`, `npm publish`…), `rm`, `git reset`/`clean`, `git merge` and
 * `onni task create` — those are the manager's, and the manager is not offered for this backend yet.
 *
 * Verified: a grant is an allowlist entry (an unlisted command is denied) and a chained
 * `a && b` line is not matched by a rule for `a`. NOT verified: whether a prefix grant also matches
 * the same command with extra arguments — if it does not, the worker is denied and the run reports
 * it (fail-closed), it never silently gains reach.
 */
export const ANTIGRAVITY_WORKER_COMMANDS: readonly string[] = [
  'git status',
  'git diff',
  'git log',
  'git show',
  'git add',
  'git commit',
  // The prompt tells the agent to call onni as `node "$ONNI_BIN" task …`; agy matches the command
  // line as the model wrote it (spike step 0), so the grant is that literal text. Unverified end to end.
  'node "$ONNI_BIN" task report',
];

/** Prefixes that must never be granted through the step's own `bashAllowlist`. */
const NEVER_GRANT = [/^git\s+push\b/i, /^curl\b/i, /^wget\b/i, /^gh\b/i, /^rm\b/i, /^sudo\b/i, /^npm\s+publish\b/i];

export interface AntigravitySettingsInput {
  /** The step's own test/build prefixes (`AgentRunSpec.bashAllowlist`). */
  bashAllowlist?: readonly string[];
  /** Extra directories the run must read/write besides the worktree (the handoff file lives in one). */
  directories?: readonly string[];
}

/** Forward slashes keep one grant spelling across Windows and POSIX. */
function grantPath(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** `command(<prefix>)` for each safe prefix; a prefix that names a network or destructive tool is dropped. */
export function commandGrants(prefixes: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of prefixes) {
    const prefix = raw.trim();
    if (!prefix || prefix.includes('*') || prefix.includes(')') || NEVER_GRANT.some((re) => re.test(prefix))) continue;
    const grant = `command(${prefix})`;
    if (!out.includes(grant)) out.push(grant);
  }
  return out;
}

/** Path grants for the extra directories (documented `read_file`/`write_file` grants; unverified on Windows paths). */
export function directoryGrants(dirs: readonly string[]): string[] {
  return dirs.flatMap((dir) => {
    const path = grantPath(dir);
    return path ? [`read_file(${path})`, `write_file(${path})`] : [];
  });
}

/** The `--settings` JSON for a level, or undefined when the level passes none. */
export function antigravitySettings(level: AgentPermissionLevel, input: AntigravitySettingsInput = {}): string | undefined {
  if (level === 'bypass') return undefined;
  const allow = [...directoryGrants(input.directories ?? [])];
  if (level === 'allow-rules') {
    allow.unshift(...commandGrants([...ANTIGRAVITY_WORKER_COMMANDS, ...(input.bashAllowlist ?? [])]));
  }
  return allow.length ? JSON.stringify({ permissions: { allow } }) : undefined;
}

/** The permission flags for a level (the settings JSON travels as one argv entry, never through a shell). */
export function antigravityPermissionArgs(level: AgentPermissionLevel, input: AntigravitySettingsInput = {}): string[] {
  if (level === 'bypass') return ['--dangerously-skip-permissions'];
  const settings = antigravitySettings(level, input);
  return settings ? ['--settings', settings] : [];
}

export interface EffectiveLevel {
  level: AgentPermissionLevel;
  /** Why the configured level was lowered, for a run note. */
  downgradedBecause?: string;
}

/**
 * `bypass` is for a task a person is watching. An unattended run (autonomous or dispatched — every
 * manager–worker child) never inherits it: it falls back to `allow-rules`, so a Settings choice
 * made for interactive use cannot silently widen a tree nobody is watching (ADR 0005, 0007).
 */
export function effectiveAntigravityLevel(configured: AgentPermissionLevel, unattended: boolean): EffectiveLevel {
  if (configured === 'bypass' && unattended) {
    return {
      level: 'allow-rules',
      downgradedBecause: 'unattended runs never skip permission checks — using the allow-rules level instead of "Skip all confirmations"',
    };
  }
  return { level: configured };
}
