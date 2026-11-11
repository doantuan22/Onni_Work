import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ANTIGRAVITY_WORKER_COMMANDS,
  antigravityPermissionArgs,
  antigravitySettings,
  commandGrants,
  discoverVerifyCommands,
  effectiveAntigravityLevel,
} from './antigravity-permissions.ts';
import { workerPrompt } from '../workflows/manager-worker.ts';
import { finalAssistantText } from '../workflows/run/dispatch.ts';
import { childSettleReport } from '../dispatch/engine.ts';
import type { RunRecord } from '../runs/store.ts';

describe('antigravity permission levels', () => {
  it('files-only is the empty set: no flag, no settings', () => {
    expect(antigravityPermissionArgs('files-only')).toEqual([]);
    expect(antigravitySettings('files-only')).toBeUndefined();
  });

  it('allow-rules grants exact read-only git inspection lines, as command(<line>)', () => {
    const allow = (JSON.parse(antigravitySettings('allow-rules')!) as { permissions: { allow: string[] } }).permissions.allow;
    expect(allow).toEqual(ANTIGRAVITY_WORKER_COMMANDS.map((c) => `command(${c})`));
    expect(allow).toContain('command(git status)');
    expect(allow).toContain('command(git show)');
    expect(allow).toContain('command(git ls-files)');
    expect(allow).toContain('command(git rev-parse --show-toplevel)');
    expect(allow).not.toContain('command(git add -A)');
  });

  it('does not grant a report command and tells agy to finish with plain text', () => {
    expect(ANTIGRAVITY_WORKER_COMMANDS.some((line) => line.includes('task report'))).toBe(false);
    const prompt = workerPrompt(undefined, 'antigravity');
    expect(prompt).toContain('do not run git commit or git push');
    expect(prompt).toContain('do not run commands to look up environment variables or to submit a report');
    expect(prompt).toContain('finish with a plain final text summary');
    expect(prompt).not.toContain('onni task report');
    expect(prompt).not.toContain('ONNI_BIN');
    expect(prompt).not.toContain('Get-ChildItem env:ONNI');
    expect(prompt).not.toContain('COMMIT your work before you finish');
    const reviewPrompt = workerPrompt('review', 'antigravity');
    expect(reviewPrompt).toContain('do not edit the reviewed files');
    expect(reviewPrompt).toContain('Finish your plain text summary with a verdict');
    expect(reviewPrompt).not.toContain('onni task report');
    expect(reviewPrompt).not.toContain('--verdict');
  });

  it('uses the last completed assistant summary for an automatic child report', () => {
    const summary = finalAssistantText([
      { seq: 1, ts: 't1', type: 'item.completed', item: { kind: 'message', role: 'assistant', text: 'First turn.' } },
      { seq: 2, ts: 't2', type: 'item.completed', item: { kind: 'tool', name: 'run_command' } },
      { seq: 3, ts: 't3', type: 'item.completed', item: { kind: 'message', role: 'assistant', text: 'Finished the work; the status is clear.' } },
    ]);
    expect(summary).toBe('Finished the work; the status is clear.');
    expect(finalAssistantText([{ seq: 4, ts: 't4', type: 'tool-result' }])).toBeUndefined();

    const { report, text } = childSettleReport({
      id: 'agy-child',
      title: 'Agy worker',
      status: 'done',
      runner: 'antigravity',
      dispatch: { rootRunId: 'root', parentRunId: 'root' },
    } as RunRecord, { resumeNotes: summary });
    expect(report.status).toBe('done');
    expect(report.result).toBe(summary);
    expect(text).toContain(summary);
  });

  it('every default grant is one plain line: no chain, redirect, pipe, substitution, glob or newline', () => {
    for (const line of ANTIGRAVITY_WORKER_COMMANDS) expect(line).not.toMatch(/[;&|<>`$()\n\r*]/);
  });

  it('never grants staging, push, network, delete, or a commit — by default or through a step allowlist', () => {
    const settings = antigravitySettings('allow-rules', {
      bashAllowlist: ['git push', 'git push --force', 'curl', 'curl https://x', 'wget', 'gh pr merge', 'rm', 'rm -rf', 'sudo', 'npm publish', 'npm test'],
    })!;
    const allow = (JSON.parse(settings) as { permissions: { allow: string[] } }).permissions.allow;
    const joined = allow.join(String.fromCharCode(10));
    for (const forbidden of ['git push', 'curl', 'wget', 'command(gh', 'command(rm', 'sudo', 'npm publish', 'git commit']) {
      expect(joined).not.toContain(forbidden);
    }
    expect(allow).toContain('command(npm test)');
    expect(ANTIGRAVITY_WORKER_COMMANDS.join(' ')).not.toMatch(/add|push|merge|reset|clean|commit|\brm\b|curl/);
  });

  it('a step entry becomes ONE exact line: it allows that command and nothing longer', () => {
    expect(commandGrants(['npm test'])).toEqual(['command(npm test)']);
    // The grant is the whole line, so `npm test -- --watch` is a different command and stays denied (measured).
    expect(commandGrants(['npm test'])[0]).not.toContain('*');
    expect(commandGrants(['npm test -- packages/work/src/core/antigravity-permissions.test.ts']))
      .toEqual(['command(npm test -- packages/work/src/core/antigravity-permissions.test.ts)']);
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

describe('effectiveAntigravityLevel — unattended bypass opt-in', () => {
  function withUnattendedBypassFlag<T>(value: string | undefined, run: () => T): T {
    const key = 'ONNI_ANTIGRAVITY_UNATTENDED_BYPASS';
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    try {
      return run();
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }

  it('lowers bypass to allow-rules for an unattended run by default, with a reason', () => {
    withUnattendedBypassFlag(undefined, () => {
      const result = effectiveAntigravityLevel('bypass', true);
      expect(result.level).toBe('allow-rules');
      expect(result.downgradedBecause).toMatch(/unattended/);
    });
  });

  it('keeps bypass for unattended runs only when the opt-in flag is set to 1', () => {
    withUnattendedBypassFlag('1', () => {
      expect(effectiveAntigravityLevel('bypass', true)).toEqual({ level: 'bypass' });
      expect(effectiveAntigravityLevel('allow-rules', true)).toEqual({ level: 'allow-rules' });
      expect(effectiveAntigravityLevel('files-only', true)).toEqual({ level: 'files-only' });
    });
  });

  it('reads the opt-in at call time and requires its exact value', () => {
    withUnattendedBypassFlag('0', () => {
      expect(effectiveAntigravityLevel('bypass', true).level).toBe('allow-rules');
      process.env.ONNI_ANTIGRAVITY_UNATTENDED_BYPASS = '1';
      expect(effectiveAntigravityLevel('bypass', true)).toEqual({ level: 'bypass' });
      process.env.ONNI_ANTIGRAVITY_UNATTENDED_BYPASS = 'true';
      expect(effectiveAntigravityLevel('bypass', true).level).toBe('allow-rules');
    });
  });

  it('keeps bypass for a watched task, and leaves every other level alone', () => {
    expect(effectiveAntigravityLevel('bypass', false)).toEqual({ level: 'bypass' });
    expect(effectiveAntigravityLevel('allow-rules', true)).toEqual({ level: 'allow-rules' });
    expect(effectiveAntigravityLevel('files-only', true)).toEqual({ level: 'files-only' });
  });

  it('defaults only an unconfigured dispatched child to allow-rules', () => {
    expect(effectiveAntigravityLevel(undefined, true, true).level).toBe('allow-rules');
    expect(effectiveAntigravityLevel('files-only', true, true).level).toBe('allow-rules');
    expect(effectiveAntigravityLevel('files-only', true, false).level).toBe('files-only');
    expect(effectiveAntigravityLevel('allow-rules', true, true).level).toBe('allow-rules');
    expect(effectiveAntigravityLevel(undefined, true, false).level).toBe('files-only');
  });
});

describe('discoverVerifyCommands', () => {
  it('turns the repo\'s verification scripts into exact lines, and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agy-verify-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', build: 'tsc', dev: 'vite', lint: 'eslint .' } }));
      writeFileSync(join(dir, 'Cargo.toml'), '[package]\n');
      expect(discoverVerifyCommands(dir)).toEqual(['npm test', 'npm run build', 'npm run lint', 'cargo check', 'cargo test']);
      expect(antigravitySettings('allow-rules', { bashAllowlist: discoverVerifyCommands(dir) })).toContain('command(npm run build)');
      // Never at files-only: that level passes no command grants at all.
      expect(antigravitySettings('files-only', { bashAllowlist: discoverVerifyCommands(dir) })).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
