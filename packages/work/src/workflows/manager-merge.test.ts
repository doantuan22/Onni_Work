import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runManagerMerge } from './manager-merge.ts';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@l'];
const git = (cwd: string, ...args: string[]) => execFileSync('git', [...ID, ...args], { cwd, encoding: 'utf8' }).trim();

describe('runManagerMerge (real git)', () => {
  let root: string;
  let work: string; // the manager worktree
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'onni-merge-'));
    git(root, 'init', '-q', '-b', 'main');
    writeFileSync(join(root, 'a.txt'), 'one\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    work = join(root, '..', `${root.split(/[\\/]/).pop()}-wt`);
    git(root, 'worktree', 'add', '-q', '-b', 'onni/mgr', work, 'main');
    git(root, 'branch', 'onni/w1', 'main');
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const ctx = (over: Record<string, unknown> = {}) => ({ worktree: work, taskBranch: 'onni/mgr', baseBranch: 'main', repoRoot: root, into: 'task' as const, ...over });
  const commitOn = (branch: string, file: string, text: string) => {
    const wt = join(root, '..', `${root.split(/[\\/]/).pop()}-tmp-${branch.replace(/\W/g, '')}`);
    git(root, 'worktree', 'add', '-q', wt, branch);
    writeFileSync(join(wt, file), text);
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', `edit ${file}`);
    git(root, 'worktree', 'remove', '--force', wt);
  };

  it('merges a worker branch into the manager branch with a merge commit', async () => {
    commitOn('onni/w1', 'w1.txt', 'w1\n');
    const r = await runManagerMerge(ctx({ sourceBranch: 'onni/w1' }));
    expect(r.outcome).toBe('merged');
    expect(existsSync(join(work, 'w1.txt'))).toBe(true);
    expect(git(work, 'log', '-1', '--pretty=%P').split(' ')).toHaveLength(2);
  });

  it('says up-to-date when there is nothing to merge, and refuses a dirty worktree', async () => {
    expect((await runManagerMerge(ctx({ sourceBranch: 'onni/w1' }))).outcome).toBe('up-to-date');
    writeFileSync(join(work, 'wip.txt'), 'x');
    const r = await runManagerMerge(ctx({ sourceBranch: 'onni/w1' }));
    expect(r).toMatchObject({ outcome: 'refused' });
    expect(r.message).toContain('uncommitted');
  });

  it('leaves a conflict in progress, lists the files, and --abort restores a clean branch', async () => {
    commitOn('onni/w1', 'a.txt', 'worker\n');
    writeFileSync(join(work, 'a.txt'), 'manager\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'manager edit');
    const before = git(work, 'rev-parse', 'HEAD');
    const r = await runManagerMerge(ctx({ sourceBranch: 'onni/w1' }));
    expect(r).toMatchObject({ outcome: 'conflict', files: ['a.txt'] });
    // Asking again while it is unresolved reports the same conflict rather than stacking another merge.
    expect((await runManagerMerge(ctx({ sourceBranch: 'onni/w1' }))).outcome).toBe('conflict');
    const aborted = await runManagerMerge(ctx({ abort: true }));
    expect(aborted.outcome).toBe('aborted');
    expect(git(work, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(work, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(work, 'a.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('manager\n');
  });

  it('a conflict the manager resolves and commits completes on the next call', async () => {
    commitOn('onni/w1', 'a.txt', 'worker\n');
    writeFileSync(join(work, 'a.txt'), 'manager\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'manager edit');
    expect((await runManagerMerge(ctx({ sourceBranch: 'onni/w1' }))).outcome).toBe('conflict');
    writeFileSync(join(work, 'a.txt'), 'both\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '--no-edit');
    expect((await runManagerMerge(ctx({ sourceBranch: 'onni/w1' }))).outcome).toBe('up-to-date');
  });

  it('refuses --abort when nothing is in progress', async () => {
    expect(await runManagerMerge(ctx({ abort: true }))).toMatchObject({ outcome: 'refused' });
  });

  it('into base: fast-forwards the checked-out local base and never touches a remote', async () => {
    commitOn('onni/w1', 'w1.txt', 'w1\n');
    await runManagerMerge(ctx({ sourceBranch: 'onni/w1' }));
    const r = await runManagerMerge(ctx({ into: 'base' }));
    expect(r.outcome).toBe('merged');
    expect(git(root, 'rev-parse', 'main')).toBe(git(work, 'rev-parse', 'HEAD'));
    expect(existsSync(join(root, 'w1.txt'))).toBe(true);
    expect(r.message).toContain('main branch');
  });

  it('into base: brings a moved base into the task branch first, and conflicts there, not in the main checkout', async () => {
    writeFileSync(join(work, 'a.txt'), 'task\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'task edit');
    writeFileSync(join(root, 'a.txt'), 'base moved\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base moved');
    const r = await runManagerMerge(ctx({ into: 'base' }));
    expect(r).toMatchObject({ outcome: 'conflict', files: ['a.txt'] });
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(root, 'a.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('base moved\n');
  });

  it('into base: refuses while the main checkout has uncommitted changes', async () => {
    commitOn('onni/w1', 'w1.txt', 'w1\n');
    await runManagerMerge(ctx({ sourceBranch: 'onni/w1' }));
    writeFileSync(join(root, 'a.txt'), 'user edit\n');
    const r = await runManagerMerge(ctx({ into: 'base' }));
    expect(r).toMatchObject({ outcome: 'refused' });
    expect(readFileSync(join(root, 'a.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('user edit\n');
  });

  it('into base when the base branch is not checked out: moves the ref only', async () => {
    commitOn('onni/w1', 'w1.txt', 'w1\n');
    await runManagerMerge(ctx({ sourceBranch: 'onni/w1' }));
    git(root, 'checkout', '-q', '-b', 'other');
    const r = await runManagerMerge(ctx({ into: 'base' }));
    expect(r.outcome).toBe('merged');
    expect(git(root, 'rev-parse', 'main')).toBe(git(work, 'rev-parse', 'HEAD'));
    expect(git(root, 'symbolic-ref', '--short', 'HEAD')).toBe('other');
  });

  // Nothing stops an agent from checking out another branch in its worktree (every review/pr-N run
  // does). The merge then acts on THAT branch while reporting the task branch: `main` was moved to
  // somebody else's commits and the manager's own work was never merged.
  describe.each([['a different branch', ['checkout', '-q', '-b', 'review/pr-9', 'main']], ['a detached HEAD', ['checkout', '-q', '--detach', 'main']]] as const)(
    'when the worktree sits on %s instead of the task branch', (_name, checkout) => {
      beforeEach(() => {
        writeFileSync(join(work, 'mgr.txt'), 'manager work\n');
        git(work, 'add', '-A');
        git(work, 'commit', '-q', '-m', 'manager work');
        git(work, ...checkout);
        writeFileSync(join(work, 'other.txt'), 'somebody else\n');
        git(work, 'add', '-A');
        git(work, 'commit', '-q', '-m', 'other work');
        git(root, 'checkout', '-q', '-b', 'parking');
      });

      it('refuses to move the base to commits that are not the task branch', async () => {
        const mainBefore = git(root, 'rev-parse', 'main');
        const r = await runManagerMerge(ctx({ into: 'base' }));
        expect(r.outcome).toBe('refused');
        expect(r.message).toContain('onni/mgr');
        expect(git(root, 'rev-parse', 'main')).toBe(mainBefore);
      });

      it('refuses to merge a worker into a branch that is not the task branch', async () => {
        commitOn('onni/w1', 'w1.txt', 'w1\n');
        const headBefore = git(work, 'rev-parse', 'HEAD');
        const r = await runManagerMerge(ctx({ sourceBranch: 'onni/w1' }));
        expect(r.outcome).toBe('refused');
        expect(git(work, 'rev-parse', 'HEAD')).toBe(headBefore);
      });
    },
  );
});
