import { describe, expect, it } from 'vitest';

import {
  ANTIGRAVITY_WORKER_COMMANDS,
  antigravityPermissionArgs,
  antigravitySettings,
  commandGrants,
  effectiveAntigravityLevel,
} from './antigravity-permissions.ts';

describe('antigravity permission levels', () => {
  it('files-only is the empty set: no flag, no settings', () => {
    expect(antigravityPermissionArgs('files-only')).toEqual([]);
    expect(antigravitySettings('files-only')).toBeUndefined();
  });

  it('allow-rules grants exact read-only git lines, as command(<line>)', () => {
    const allow = (JSON.parse(antigravitySettings('allow-rules')!) as { permissions: { allow: string[] } }).permissions.allow;
    expect(allow).toEqual(ANTIGRAVITY_WORKER_COMMANDS.map((c) => `command(${c})`));
    expect(allow).toContain('command(git status)');
    expect(allow).toContain('command(git add -A)'); // observed to run (spike appendix C)
  });

  it('every default grant is one plain line: no chain, redirect, pipe, substitution, glob or newline', () => {
    for (const line of ANTIGRAVITY_WORKER_COMMANDS) expect(line).not.toMatch(/[;&|<>`$()\n\r*]/);
  });

  it('never grants push, network, delete, or a commit — by default or through a step allowlist', () => {
    const settings = antigravitySettings('allow-rules', {
      bashAllowlist: ['git push', 'git push --force', 'curl', 'curl https://x', 'wget', 'gh pr merge', 'rm', 'rm -rf', 'sudo', 'npm publish', 'npm test'],
    })!;
    const allow = (JSON.parse(settings) as { permissions: { allow: string[] } }).permissions.allow;
    const joined = allow.join(String.fromCharCode(10));
    for (const forbidden of ['git push', 'curl', 'wget', 'command(gh', 'command(rm', 'sudo', 'npm publish', 'git commit']) {
      expect(joined).not.toContain(forbidden);
    }
    expect(allow).toContain('command(npm test)');
    expect(ANTIGRAVITY_WORKER_COMMANDS.join(' ')).not.toMatch(/push|merge|reset|clean|commit|\brm\b|curl/);
  });

  it('a step entry becomes ONE exact line: it allows that command and nothing longer', () => {
    expect(commandGrants(['npm test'])).toEqual(['command(npm test)']);
    // The grant is the whole line, so `npm test -- --watch` is a different command and stays denied (measured).
    expect(commandGrants(['npm test'])[0]).not.toContain('*');
  });

  it('drops anything with shell syntax, since it could never be an exact grant for one command', () => {
    expect(commandGrants(['npm *', 'x) y', '', '  ', 'a && b', 'a ; b', 'a | b', 'a > f', 'echo $HOME', 'echo `x`', 'a$(b)', 'npm run build'])).toEqual(['command(npm run build)']);
  });

  it('bypass is the dangerous flag alone', () => {
    expect(antigravityPermissionArgs('bypass')).toEqual(['--dangerously-skip-permissions']);
  });

  it('extra directories become read/write path grants with forward slashes', () => {
    const allow = (JSON.parse(antigravitySettings('files-only', { directories: ['C:\\a\\b\\'] })!) as { permissions: { allow: string[] } })
      .permissions.allow;
    expect(allow).toEqual(['read_file(C:/a/b)', 'write_file(C:/a/b)']);
  });
});

describe('effectiveAntigravityLevel — bypass is never inherited by an unattended run', () => {
  it('lowers bypass to allow-rules for an unattended run, with a reason', () => {
    const result = effectiveAntigravityLevel('bypass', true);
    expect(result.level).toBe('allow-rules');
    expect(result.downgradedBecause).toMatch(/unattended/);
  });

  it('keeps bypass for a watched task, and leaves every other level alone', () => {
    expect(effectiveAntigravityLevel('bypass', false)).toEqual({ level: 'bypass' });
    expect(effectiveAntigravityLevel('allow-rules', true)).toEqual({ level: 'allow-rules' });
    expect(effectiveAntigravityLevel('files-only', true)).toEqual({ level: 'files-only' });
  });
});
