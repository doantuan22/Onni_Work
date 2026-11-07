import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assembleCommandResults,
  buildVerifyEnv,
  capWarnings,
  formatVerify,
  resolveVerifyCommands,
  verifyStateOf,
  type RawCommandRun,
} from './verify.ts';
import { reconcileChecks } from './engine.ts';

describe('resolveVerifyCommands', () => {
  let repo: string;
  let manager: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'onni-verify-repo-'));
    manager = mkdtempSync(join(tmpdir(), 'onni-verify-mgr-'));
    mkdirSync(join(repo, '.ai/onni'), { recursive: true });
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(manager, { recursive: true, force: true });
  });
  const config = (checks: string[]) => writeFileSync(join(repo, '.ai/onni/config.json'), JSON.stringify({ requiredChecks: checks }));
  const pkg = (dir: string, scripts: Record<string, string>) => writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }));

  it('prefers required checks, then discovery from the manager tree, then none', async () => {
    pkg(manager, { test: 'x', build: 'y' });
    config(['make check']);
    expect(await resolveVerifyCommands({ repoRoot: repo, managerWorktree: manager })).toEqual({ source: 'required-checks', commands: ['make check'] });
    config([]);
    expect(await resolveVerifyCommands({ repoRoot: repo, managerWorktree: manager })).toEqual({ source: 'discovered', commands: ['npm test', 'npm run build'] });
    const empty = mkdtempSync(join(tmpdir(), 'onni-verify-empty-'));
    expect(await resolveVerifyCommands({ repoRoot: repo, managerWorktree: empty })).toEqual({ source: 'none', commands: [] });
    rmSync(empty, { recursive: true, force: true });
  });

  it('selects with --only in resolved order and names the available list for an unknown one', async () => {
    config(['a', 'b', 'c']);
    expect(await resolveVerifyCommands({ repoRoot: repo, only: ['c', 'a'] })).toEqual({ source: 'required-checks', commands: ['a', 'c'] });
    const bad = await resolveVerifyCommands({ repoRoot: repo, only: ['rm -rf /'] });
    expect(bad).toEqual({ error: 'unknown check "rm -rf /"; available: a, b, c' });
  });

  it('redacts and bounds an unknown selector and its available checks', async () => {
    const secret = 'VERIFY_SELECTOR_SECRET';
    config(Array.from({ length: 10 }, (_, index) => `check-${index} ${secret} ${'x'.repeat(140)}`));
    const bad = await resolveVerifyCommands({
      repoRoot: repo,
      only: [`${secret} ${'y'.repeat(150)}`],
      redact: (text) => text.replaceAll(secret, '[redacted]'),
    });
    if (!('error' in bad)) throw new Error('expected an unknown check refusal');
    expect(bad.error).not.toContain(secret);
    const selector = bad.error.match(/^unknown check "([^"]+)"/)?.[1];
    const available = bad.error.split('; available: ')[1]!;
    expect(selector?.length).toBeLessThanOrEqual(120);
    expect(available.length).toBeLessThanOrEqual(1_000);
    expect(available).not.toContain(secret);
    expect(available.split(', ').every((entry) => entry === '+N more' || entry.length <= 120)).toBe(true);
    expect(available).toMatch(/\+\d+ more$/);
  });
});

describe('buildVerifyEnv', () => {
  const base = {
    PATH: '/bin', HOME: '/h', LC_ALL: 'C', ANTHROPIC_API_KEY: 'k', GITHUB_TOKEN: 't', AWS_SECRET_ACCESS_KEY: 's',
    ONNI_TASK_ID: 'x', ONNI_API_URL: 'u', MY_SERVICE_PASSWORD: 'p', RANDOM_THING: '1',
  };
  it('is an allowlist: secrets and ONNI_* never pass, CI settings are added, input untouched', () => {
    const frozen = { ...base };
    const env = buildVerifyEnv(base, 'linux');
    expect(env).toMatchObject({ PATH: '/bin', HOME: '/h', LC_ALL: 'C', CI: '1', NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0' });
    for (const name of ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'ONNI_TASK_ID', 'ONNI_API_URL', 'MY_SERVICE_PASSWORD', 'RANDOM_THING']) {
      expect(env[name]).toBeUndefined();
    }
    expect(base).toEqual(frozen);
    expect(env).not.toBe(process.env);
  });
  it('matches names case-insensitively on win32 only', () => {
    expect(buildVerifyEnv({ systemroot: 'C:\\Windows', Path: 'p' }, 'win32')).toMatchObject({ systemroot: 'C:\\Windows', Path: 'p' });
    expect(buildVerifyEnv({ systemroot: 'x' }, 'linux').systemroot).toBeUndefined();
  });
});

describe('assembleCommandResults', () => {
  const raw = (patch: Partial<RawCommandRun>): RawCommandRun => ({
    command: 'npm test', outcome: 'failed', exitCode: 1, durationMs: 4, timedOut: false, output: '', ...patch,
  });
  const redact = (text: string) => text.replaceAll('SECRET', '[redacted]');

  it('keeps tails for failures only, strips ANSI, caps lines, redacts command and tail', () => {
    const output = `${'old\n'.repeat(60)}\u001b[31mred SECRET\u001b[0m\n${'y'.repeat(500)}\n`;
    const [pass, fail] = assembleCommandResults(
      [raw({ outcome: 'passed', exitCode: 0, output: 'noise' }), raw({ command: 'run SECRET', output })],
      redact,
    );
    expect(pass!.tail).toEqual([]);
    expect(fail!.command).toBe('run [redacted]');
    expect(fail!.tail.length).toBeLessThanOrEqual(40);
    expect(fail!.tail.some((line) => line.includes('red [redacted]'))).toBe(true);
    expect(fail!.tail.join('')).not.toContain('\u001b');
    expect(fail!.tail.every((line) => line.length <= 200)).toBe(true);
    expect(fail!.tailTruncated).toBe(true);
  });

  it('shares the total tail budget across failing commands and cuts the displayed command', () => {
    const big = Array.from({ length: 40 }, () => 'z'.repeat(190)).join('\n');
    const results = assembleCommandResults(Array.from({ length: 10 }, (_, i) => raw({ command: `c${i}${'q'.repeat(400)}`, output: big })), redact);
    const total = results.reduce((sum, r) => sum + r.tail.join('').length, 0);
    expect(total).toBeLessThanOrEqual(8_000);
    expect(results[0]!.command.length).toBe(300);
  });

  it('maps state: failed iff something failed or timed out; skipped alone is not a failure', () => {
    expect(verifyStateOf([{ outcome: 'passed' }, { outcome: 'skipped' }])).toBe('passed');
    expect(verifyStateOf([{ outcome: 'passed' }, { outcome: 'timed-out' }])).toBe('failed');
    expect(capWarnings(Array.from({ length: 9 }, (_, i) => `w${i}`))).toHaveLength(5);
  });
});

describe('reconcileChecks', () => {
  const claims = [{ command: 'npm test', exitCode: 0 }];
  const last = (patch: Record<string, unknown> = {}) => ({
    at: 't', headCommit: 'abc1234', state: 'failed' as const, source: 'discovered' as const,
    results: [{ command: 'npm test', outcome: 'failed' as const, exitCode: 1 }], ...patch,
  });
  it('keeps the legacy string byte for byte without a verification', () => {
    expect(reconcileChecks(claims, undefined, 'abc1234')).toBe('checks (worker-reported, not verified): npm test → 0');
    expect(reconcileChecks([], undefined, 'abc1234')).toBeUndefined();
  });
  it('shows onni’s result for the same head, with a MISMATCH and claimed-not-run lines', () => {
    const line = reconcileChecks([...claims, { command: 'npm run lint', exitCode: 0 }], last(), 'abc12345678')!;
    expect(line).toContain('checks (verified by onni at abc1234, t): npm test → 1');
    expect(line).toContain('MISMATCH with the worker\'s claim: "npm test" claimed 0, onni got 1');
    expect(line).toContain('also claimed, not verified: npm run lint → 0');
  });
  it('is stale for another or unknown head', () => {
    expect(reconcileChecks(claims, last(), 'fffffff')).toContain('is stale');
    expect(reconcileChecks(claims, last(), undefined)).toContain('is stale');
    expect(reconcileChecks(claims, last(), 'fffffff')).toContain('worker-reported, not verified');
  });
});

describe('formatVerify', () => {
  const base = { source: 'required-checks' as const, startedAt: 't', durationMs: 3000, runsUsed: 2, runsMax: 3, warnings: ['careful'] };
  it('renders the three verdicts', () => {
    const failed = formatVerify({
      ...base, state: 'failed', headCommit: 'abc1234',
      results: [{ command: 'npm test', outcome: 'failed', exitCode: 1, durationMs: 9, timedOut: false, tail: ['boom'], tailTruncated: true }],
    }, 'abcd1234');
    expect(failed).toContain('verify abcd1234: FAILED — required-checks, 1 command(s), 3s @ abc1234  (run 2 of 3)');
    expect(failed).toContain('✗ npm test  exit 1');
    expect(failed).toContain('| boom');
    expect(failed).toContain('| … truncated');
    expect(failed).toContain('! careful');
    expect(formatVerify({ ...base, state: 'passed', results: [] }, 'abcd1234')).toContain('PASSED');
    const none = formatVerify({ ...base, state: 'unavailable', reasonCode: 'no-bash', reason: 'bash was not found', results: [], warnings: [] }, 'abcd1234');
    expect(none).toContain('UNAVAILABLE — bash was not found');
  });
});
