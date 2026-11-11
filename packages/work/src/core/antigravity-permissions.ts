/**
 * What an Antigravity (`agy`) run is allowed to do headlessly (ADR 0007).
 *
 * agy cannot ask for approval when stdout is a pipe: a tool that needs a permission is auto-denied,
 * and the denial ends the turn. Three levels decide what the runner passes: none, a `--settings`
 * allowlist, or `--dangerously-skip-permissions`. Anything not allowed stays denied.
 *
 * MEASURED (docs/design/antigravity-spike.md, Appendix C): `command(<line>)` matches the WHOLE
 * command line, not a prefix. `command(git add -A)` ran `git add -A`; `command(git add)` did not;
 * `command(git status)` denied `git status --short`; `command(node --version)` denied
 * `node --version > f` (redirect), `… && …`, `… $(…)` and `… \`…\``. So a grant cannot be widened by an
 * argument, a redirect, a chain, a pipe or a substitution — and it cannot be a pattern either:
 * `command(git add *)` matched nothing. Every grant below is therefore one exact line.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentPermissionLevel } from '@onni/contract';
export { discoverVerifyCommands } from './verify-commands.ts';

const TASK_FILE_REFERENCE = /(?:^|[\s`"'(])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs))(?=$|[\s`"'),:.])/g;
const TASK_TEST_COMMAND_LIMIT = 12;

/** Exact invocations for test files named by a dispatched order or beside its named source files. */
export function discoverTaskTestCommands(cwd: string | undefined, task: string): string[] {
  if (!cwd) return [];
  const candidates = new Set<string>();
  for (const match of task.matchAll(TASK_FILE_REFERENCE)) {
    const file = match[1]!;
    if (file.split('/').some((part) => !part || part === '.' || part === '..')) continue;
    const absolute = join(cwd, file);
    if (!existsSync(absolute)) continue;
    if (/\.test\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(file)) candidates.add(file);
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(file)) {
      const base = file.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/i, '');
      for (const ext of ['.test.ts', '.test.tsx', '.test.js', '.test.jsx']) {
        const testFile = `${base}${ext}`;
        if (existsSync(join(cwd, testFile))) candidates.add(testFile);
      }
    }
    if (candidates.size >= TASK_TEST_COMMAND_LIMIT) break;
  }
  return [...candidates].slice(0, TASK_TEST_COMMAND_LIMIT).map((file) => `npm test -- ${file}`);
}

/**
 * A narrow worker set: read-only git inspection only. Staging, commit, push, network, destructive
 * commands, and manager-only commands remain absent; Onni commits worker worktrees.
 */
export const ANTIGRAVITY_WORKER_COMMANDS: readonly string[] = [
  'git status',
  'git status --short',
  'git diff',
  'git diff --stat',
  'git log --oneline',
  'git show',
  'git ls-files',
  'git rev-parse --show-toplevel',
];

/** Lines that must never be granted through the step's own `bashAllowlist`, whatever else is in it. */
const NEVER_GRANT = [/^git\s+push\b/i, /^curl\b/i, /^wget\b/i, /^gh\b/i, /^rm\b/i, /^sudo\b/i, /^npm\s+publish\b/i];

/** Characters that mean "more than one command" or "something else happens" — never part of a grant. */
const SHELL_META = /[;&|<>`$()\n\r*]/;

export interface AntigravitySettingsInput {
  /**
   * The step's own test/build commands (`AgentRunSpec.bashAllowlist`). For Claude these are prefixes;
   * here each entry becomes ONE exact line, so `npm test` allows `npm test` and nothing longer.
   */
  bashAllowlist?: readonly string[];
  /** Extra directories the run must read/write besides the worktree (the handoff file lives in one). */
  directories?: readonly string[];
}

/** Forward slashes keep one grant spelling across Windows and POSIX. */
function grantPath(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * `command(<line>)` for each safe exact line. A line that names a network or destructive tool, or that
 * carries shell syntax (a chain, a redirect, a substitution, a glob), is dropped: it could not be an
 * exact grant for the one command it names anyway.
 */
export function commandGrants(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || SHELL_META.test(line) || NEVER_GRANT.some((re) => re.test(line))) continue;
    const grant = `command(${line})`;
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
 * `bypass` is for a task a person is watching. An unattended run (autonomous or dispatched) falls
 * back to `allow-rules` unless the owner opts in through `ONNI_ANTIGRAVITY_UNATTENDED_BYPASS=1`.
 * An unconfigured dispatched child also defaults to allow-rules. A dispatched child treats stored
 * `files-only` as unchosen even if selected; watched and top-level runs keep that setting untouched.
 * Read the flag here so environment changes apply at the next decision.
 */
export function effectiveAntigravityLevel(
  configured: AgentPermissionLevel | undefined,
  unattended: boolean,
  dispatchedChild = false,
): EffectiveLevel {
  const level = dispatchedChild && configured === 'files-only'
    ? 'allow-rules'
    : configured ?? (dispatchedChild ? 'allow-rules' : 'files-only');
  if (level === 'bypass' && unattended && process.env.ONNI_ANTIGRAVITY_UNATTENDED_BYPASS !== '1') {
    return {
      level: 'allow-rules',
      downgradedBecause: 'unattended runs never skip permission checks — using the allow-rules level instead of "Skip all confirmations"',
    };
  }
  return { level };
}
