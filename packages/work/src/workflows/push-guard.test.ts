import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildClaudeArgs } from '../core/claude-cli-runner.ts';
import { pushBranch } from '../git-worktree.ts';
import { RunStore } from '../runs/store.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import { RunManager } from './run.ts';
import { PRE_PUSH_HOOK, UNATTENDED_DENIED_TOOLS, ensurePushGuard, pushGuardEnv, pushRefusal } from './push-guard.ts';

const ID = ['-c', 'user.name=test', '-c', 'user.email=test@local'];
let dir: string;
let remote: string;
let work: string;
const sh = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
const tryPush = (env: NodeJS.ProcessEnv, refspec: string): { ok: boolean; stderr: string } => {
  try {
    sh(work, ['push', 'origin', refspec], env);
    return { ok: true, stderr: '' };
  } catch (error) {
    return { ok: false, stderr: String((error as { stderr?: unknown }).stderr ?? error) };
  }
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'onni-push-guard-'));
  remote = join(dir, 'remote.git');
  work = join(dir, 'work');
  sh(dir, ['init', '-q', '--bare', '-b', 'main', remote]);
  sh(dir, ['clone', '-q', remote, work]);
  writeFileSync(join(work, 'a.txt'), 'one\n');
  sh(work, ['add', '-A']);
  sh(work, [...ID, 'commit', '-q', '-m', 'base']);
  sh(work, ['branch', '-M', 'main']);
  sh(work, ['push', '-q', '-u', 'origin', 'main']);
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

describe('the pre-push fence for unattended runs', () => {
  it('writes the hook once, idempotently, under the data dir', () => {
    const hooks = ensurePushGuard(join(dir, 'data'))!;
    expect(readFileSync(join(hooks, 'pre-push'), 'utf8')).toBe(PRE_PUSH_HOOK);
    expect(ensurePushGuard(join(dir, 'data'))).toBe(hooks);
  });

  it('refuses a push to the default branch, a tag and a deletion, and allows only onni/* or the run\'s own branch', () => {
    const env = pushGuardEnv(join(dir, 'data'), { branch: 'feat/named-by-namer' });
    sh(work, ['checkout', '-q', '-b', 'onni/abcd1234']);
    sh(work, [...ID, 'commit', '-q', '--allow-empty', '-m', 'work']);

    const toMain = tryPush(env, 'HEAD:main');
    expect(toMain.ok).toBe(false);
    expect(toMain.stderr).toContain('refused');
    expect(sh(remote, ['rev-parse', 'main']).trim()).not.toBe(sh(work, ['rev-parse', 'HEAD']).trim());

    sh(work, ['tag', 'v1']);
    expect(tryPush(env, 'v1').ok).toBe(false);
    expect(tryPush(env, ':main').ok).toBe(false);
    expect(tryPush(env, '+HEAD:main').ok).toBe(false);

    expect(tryPush(env, 'HEAD:onni/abcd1234').ok).toBe(true);
    expect(tryPush(env, 'HEAD:feat/named-by-namer').ok).toBe(true);
    expect(tryPush(env, 'HEAD:feat/someone-elses').ok).toBe(false);
  }, 60_000);

  it('leaves a person\'s push alone (no env, no fence)', () => {
    sh(work, [...ID, 'commit', '-q', '--allow-empty', '-m', 'mine']);
    expect(tryPush({}, 'HEAD:main').ok).toBe(true);
  });

  it('keeps GIT_CONFIG pairs that were already set', () => {
    const env = pushGuardEnv(join(dir, 'data'), {}, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'x' });
    expect(env).toMatchObject({ GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_KEY_1: 'core.hooksPath' });
  });

  it('is only a fence: --no-verify walks straight through it', () => {
    const env = pushGuardEnv(join(dir, 'data'), {});
    sh(work, [...ID, 'commit', '-q', '--allow-empty', '-m', 'sneaky']);
    expect(() => sh(work, ['push', '--no-verify', 'origin', 'HEAD:main'], env)).not.toThrow();
  });
});

describe('onni\'s own pushes', () => {
  it('refuses a base or protected branch and any forced spelling', () => {
    expect(pushRefusal('main')).toContain('protected');
    expect(pushRefusal('feature-x', ['feature-x'])).toContain('base branch');
    expect(pushRefusal('+onni/abc')).toContain('forced');
    expect(pushRefusal('onni/abc12345', ['main'])).toBeUndefined();
  });

  it('pushBranch moves only the named ref and never forces', async () => {
    sh(work, ['checkout', '-q', '-b', 'onni/zz']);
    sh(work, [...ID, 'commit', '-q', '--allow-empty', '-m', 'one']);
    expect((await pushBranch(work, 'onni/zz')).ok).toBe(true);
    expect(sh(remote, ['rev-parse', 'onni/zz']).trim()).toBe(sh(work, ['rev-parse', 'HEAD']).trim());
    // Rewrite history locally: a plain push must now be rejected, not forced through.
    sh(work, ['reset', '-q', '--hard', 'HEAD~1']);
    sh(work, [...ID, 'commit', '-q', '--allow-empty', '-m', 'diverged']);
    const second = await pushBranch(work, 'onni/zz');
    expect(second.ok).toBe(false);
    expect((await pushBranch(work, '+onni/zz')).ok).toBe(false);
  });
});

describe('unattended agent sessions', () => {
  it('claude gets the deny rules only when the spec carries them', () => {
    const plain = buildClaudeArgs({ allowedTools: ['Bash'] } as never, {});
    expect(plain).not.toContain('--disallowedTools');
    const denied = buildClaudeArgs({ allowedTools: ['Bash'], deniedTools: [...UNATTENDED_DENIED_TOOLS] } as never, {});
    expect(denied[denied.indexOf('--disallowedTools') + 1]).toContain('Bash(git push:*)');
  });

  describe('RunManager.agentEnv', () => {
    let repo: string;
    let store: RunStore;
    let manager: RunManager;
    beforeEach(() => {
      repo = mkdtempSync(join(tmpdir(), 'onni-agentenv-'));
      store = RunStore.open(join(repo, '.ai/onni'));
      manager = new RunManager(store, repo, { semaphore: new WorkspaceSemaphore({ initial: { maxParallel: 0 } }) });
    });
    afterEach(() => {
      manager.dispose();
      store.flush();
      rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });
    const envOf = (patch: Parameters<RunStore['updateRun']>[1]) => {
      const run = store.createRun({ title: 't', task: 't', workflow: 'w', steps: [{ id: 'a', name: 'a', kind: 'agent' }] });
      store.updateRun(run.id, patch);
      return (manager as unknown as { agentEnv(id: string): Record<string, string> }).agentEnv(run.id);
    };
    it.each([
      ['an autonomous run', { autonomous: true, branch: 'onni/aaaa1111' }],
      ['a dispatched child', { dispatch: { rootRunId: 'r', parentRunId: 'r' }, branch: 'onni/bbbb2222' }],
    ])('arms the hook for %s', (_name, patch) => {
      const env = envOf(patch);
      const slot = Number(env.GIT_CONFIG_COUNT) - 1; // ours is appended after any pairs the host already set
      expect(env[`GIT_CONFIG_KEY_${slot}`]).toBe('core.hooksPath');
      expect(existsSync(join(env[`GIT_CONFIG_VALUE_${slot}`]!, 'pre-push'))).toBe(true);
      expect(env.ONNI_PUSH_ALLOW_BRANCH).toBe(patch.branch);
    });
    it('does not arm it for an attended run', () => {
      expect(envOf({ branch: 'onni/cccc3333' })).not.toHaveProperty('ONNI_PUSH_ALLOW_BRANCH');
    });
  });
});
