/**
 * `onni task verify` (wave A1) — the PURE half: which commands to run, the env they get, how raw
 * runs become a bounded, redacted answer, and how the answer reads in a terminal. The only impure
 * file is `verify-exec.ts`; `RunManager.verifyFor` composes the two.
 */
import {
  VERIFY_MAX_COMMANDS,
  VERIFY_TAIL_MAX_CHARS_PER_LINE,
  VERIFY_TAIL_MAX_LINES,
  VERIFY_TAIL_TOTAL_MAX_CHARS,
  VERIFY_WARNINGS_MAX,
  type DispatchVerifyBaseline,
  type DispatchVerifyCommandResult,
  type DispatchVerifyResult,
} from '@onni/contract';
import { loadConfig } from '../config.ts';
import { discoverVerifyCommands } from '../core/verify-commands.ts';
import { VERIFY_BASELINE_DISCLAIMER } from './baseline.ts';

export interface ResolvedChecks {
  source: 'required-checks' | 'discovered' | 'none';
  commands: string[];
}

const REFUSAL_ENTRY_MAX_CHARS = 120;
const REFUSAL_LIST_MAX_CHARS = 1_000;

function refusalEntry(text: string, redact: (text: string) => string): string {
  const clean = redact(text).replace(/\s+/g, ' ').trim();
  return clean.length > REFUSAL_ENTRY_MAX_CHARS
    ? clean.slice(0, REFUSAL_ENTRY_MAX_CHARS - 1) + '…'
    : clean;
}

function formatAvailableChecks(commands: readonly string[], redact: (text: string) => string): string {
  const entries = commands.map((command) => refusalEntry(command, redact));
  const included: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const candidate = [...included, entries[index]!].join(', ');
    const omitted = entries.length - index - 1;
    const suffix = omitted > 0 ? ', +' + omitted + ' more' : '';
    if (candidate.length + suffix.length > REFUSAL_LIST_MAX_CHARS) break;
    included.push(entries[index]!);
  }
  const omitted = entries.length - included.length;
  const rendered = included.join(', ') + (omitted > 0 ? (included.length > 0 ? ', ' : '') + '+' + omitted + ' more' : '');
  return rendered.slice(0, REFUSAL_LIST_MAX_CHARS);
}

/**
 * The commands verify may run, resolved on the SERVER. The project's `requiredChecks` come from the
 * checkout's config (never a worker's tracked copy); otherwise discovery runs on the MANAGER's
 * tree, which the worker did not write. `only` merely selects among them.
 */
export async function resolveVerifyCommands(input: {
  repoRoot: string;
  managerWorktree?: string;
  only?: readonly string[];
  redact?: (text: string) => string;
}): Promise<ResolvedChecks | { error: string }> {
  let required: string[] = [];
  try {
    required = (await loadConfig(input.repoRoot)).requiredChecks ?? [];
  } catch {
    required = [];
  }
  let source: ResolvedChecks['source'] = 'none';
  let commands: string[] = [];
  const cleaned = required.map((line) => line.trim()).filter(Boolean);
  if (cleaned.length > 0) {
    source = 'required-checks';
    commands = cleaned;
  } else {
    commands = discoverVerifyCommands(input.managerWorktree ?? input.repoRoot);
    if (commands.length > 0) source = 'discovered';
  }
  commands = [...new Set(commands)].slice(0, VERIFY_MAX_COMMANDS);
  if (input.only !== undefined && input.only.length > 0) {
    const wanted = new Set(input.only.map((line) => line.trim()));
    const unknown = [...wanted].filter((line) => !commands.includes(line));
    if (unknown.length > 0) {
      const redact = input.redact ?? ((text: string) => text);
      const selector = refusalEntry(unknown[0]!, redact);
      const available = commands.length > 0 ? formatAvailableChecks(commands, redact) : '(none)';
      return {
        error: `unknown check "${selector}"; available: ${available}`,
      };
    }
    commands = commands.filter((line) => wanted.has(line));
  }
  return { source: commands.length ? source : 'none', commands };
}

const ENV_ALLOW = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TERM', 'TMPDIR', 'TEMP', 'TMP', 'USERPROFILE',
  'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'PROGRAMDATA', 'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE', 'OS',
];
const ENV_SECRETISH = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|AUTH)/i;

/**
 * An ALLOWLIST env for a check (never `{ ...process.env }`): no provider keys, no `GH_*`, no
 * `ONNI_*` — so a verified script cannot call back into `onni task` as the manager. A check that
 * needs a secret fails honestly. Pure: the input is not mutated.
 */
export function buildVerifyEnv(base: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    // Windows env names are case-insensitive; POSIX ones are not (`path` is not `PATH`).
    const probe = platform === 'win32' ? upper : name;
    const allowed = ENV_ALLOW.includes(probe) || probe.startsWith('LC_');
    if (!allowed) continue;
    if (ENV_SECRETISH.test(name) || upper.startsWith('ONNI_')) continue;
    out[name] = value;
  }
  return { ...out, CI: '1', NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

export interface RawCommandRun {
  command: string;
  outcome: DispatchVerifyCommandResult['outcome'];
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  output: string;
}

const COMMAND_DISPLAY_MAX = 300;
const TAIL_FLOOR_CHARS = 400;

/** Last lines of a failed command's output, ANSI stripped, redacted, cut — within `budgetChars`. */
function tailOf(output: string, redact: (text: string) => string, budgetChars: number): { lines: string[]; truncated: boolean } {
  const all = output.replace(ANSI, '').replace(/\r/g, '').split('\n');
  while (all.length > 0 && all[all.length - 1]!.trim() === '') all.pop();
  let truncated = all.length > VERIFY_TAIL_MAX_LINES;
  const recent = all.slice(-VERIFY_TAIL_MAX_LINES);
  const kept: string[] = [];
  let used = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    let line = redact(recent[i]!);
    if (line.length > VERIFY_TAIL_MAX_CHARS_PER_LINE) {
      line = line.slice(0, VERIFY_TAIL_MAX_CHARS_PER_LINE);
      truncated = true;
    }
    if (used + line.length > budgetChars) {
      truncated = true;
      break;
    }
    used += line.length;
    kept.unshift(line);
  }
  return { lines: kept, truncated };
}

/** Raw runs → the bounded, redacted per-command answers. Tails exist only for failures. */
export function assembleCommandResults(
  raws: readonly RawCommandRun[],
  redact: (text: string) => string,
): DispatchVerifyCommandResult[] {
  const failing = raws.filter((raw) => raw.outcome === 'failed' || raw.outcome === 'timed-out').length;
  const perCommand = failing > 0 ? Math.max(TAIL_FLOOR_CHARS, Math.floor(VERIFY_TAIL_TOTAL_MAX_CHARS / failing)) : 0;
  return raws.slice(0, VERIFY_MAX_COMMANDS).map((raw) => {
    const failed = raw.outcome === 'failed' || raw.outcome === 'timed-out';
    const tail = failed ? tailOf(raw.output, redact, perCommand) : { lines: [] as string[], truncated: false };
    return {
      command: redact(raw.command).slice(0, COMMAND_DISPLAY_MAX),
      outcome: raw.outcome,
      exitCode: raw.exitCode,
      durationMs: Math.max(0, Math.round(raw.durationMs)),
      timedOut: raw.timedOut,
      tail: tail.lines,
      tailTruncated: tail.truncated,
    };
  });
}

/** `passed` unless any command failed or timed out. A skipped command does not fail the run by itself. */
export function verifyStateOf(results: readonly Pick<DispatchVerifyCommandResult, 'outcome'>[]): 'passed' | 'failed' {
  return results.some((result) => result.outcome === 'failed' || result.outcome === 'timed-out') ? 'failed' : 'passed';
}

export function capWarnings(warnings: readonly string[]): string[] {
  return warnings.slice(0, VERIFY_WARNINGS_MAX).map((warning) => warning.slice(0, 300));
}

/** One short clause per command, for the manager note and the report section. */
export function verifySummary(results: readonly DispatchVerifyCommandResult[]): string {
  return results
    .map((result) =>
      result.outcome === 'passed'
        ? `${result.command} ok`
        : result.outcome === 'timed-out'
          ? `${result.command} timed out`
          : result.outcome === 'skipped'
            ? `${result.command} skipped`
            : `${result.command} exit ${result.exitCode ?? '?'}`,
    )
    .join(', ');
}

const MARK: Record<DispatchVerifyCommandResult['outcome'], string> = {
  passed: '✓',
  failed: '✗',
  'timed-out': '⏱',
  skipped: '–',
};

/** The terminal rendering of an answer; the CLI prints it verbatim. */
export function formatVerify(result: DispatchVerifyResult, targetId8: string): string {
  const verdict = result.state.toUpperCase();
  const lines: string[] = [];
  if (result.state === 'unavailable') {
    lines.push(`verify ${targetId8}: UNAVAILABLE — ${result.reason ?? result.reasonCode ?? 'cannot run'}`);
    if (result.reasonCode) lines.push(`  (${result.reasonCode}; this did not count as a run — ${result.runsUsed} of ${result.runsMax} used)`);
  } else {
    const sha = result.headCommit ? ` @ ${result.headCommit}` : '';
    lines.push(
      `verify ${targetId8}: ${verdict} — ${result.source}, ${result.results.length} command(s), ${Math.round(result.durationMs / 1000)}s${sha}  (run ${result.runsUsed} of ${result.runsMax})`,
    );
    for (const entry of result.results) {
      const exit = entry.timedOut ? 'timed out' : entry.exitCode === null ? 'not run' : `exit ${entry.exitCode}`;
      lines.push(`  ${MARK[entry.outcome]} ${entry.command}  ${exit}  ${entry.durationMs}ms`);
      for (const line of entry.tail) lines.push(`    | ${line}`);
      if (entry.tailTruncated) lines.push('    | … truncated');
    }
  }
  if (result.baseline) lines.push(...formatBaseline(result.baseline));
  for (const warning of result.warnings) lines.push(`! ${warning}`);
  return lines.join('\n');
}

function formatBaseline(baseline: DispatchVerifyBaseline): string[] {
  const lines = [`baseline (HEURISTIC${baseline.baseRef ? `, at ${baseline.baseRef}` : ''}):`, `  ${VERIFY_BASELINE_DISCLAIMER}`];
  if (baseline.state === 'unavailable') {
    lines.push(`  UNAVAILABLE — ${baseline.reason ?? 'the baseline could not be checked'}`);
  } else {
    for (const entry of baseline.results) {
      if (entry.classification === 'new-failure' || entry.classification === 'new-signatures') {
        if (entry.newSignatures.length > 0) {
          for (const signature of entry.newSignatures) lines.push(`  NEW ${entry.command}: ${signature}${entry.newSignaturesOmitted ? ' …' : ''}`);
        } else {
          lines.push(`  NEW ${entry.command}: worker exit ${entry.workerExitCode ?? '?'}; baseline exit ${entry.baselineExitCode ?? '?'}`);
        }
      } else if (entry.classification === 'inconclusive') {
        lines.push(`  INCONCLUSIVE ${entry.command}: worker exit ${entry.workerExitCode ?? '?'}; baseline exit ${entry.baselineExitCode ?? '?'}`);
      }
    }
    if (baseline.preExistingCount > 0) lines.push(`  ${baseline.preExistingCount} pre-existing failure(s) excluded`);
    lines.push(`  verdict: ${baseline.verdict ?? 'inconclusive'}`);
  }
  lines.push(`  cleanup: ${baseline.cleanup}`);
  return lines;
}
