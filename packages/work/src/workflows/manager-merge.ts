import { execFile } from 'node:child_process';
import { isSafeGitRef } from '../git-refs.ts';

/**
 * The manager's merge, done by the server (not by a prompt) when "Full quyền manager" is on.
 *
 * Scope, deliberately small: local merges only. It never pushes, never force-updates, never deletes
 * a branch and never rewrites history. A merge into the base branch is done in the MANAGER's
 * worktree first (base into task branch), so conflicts are resolved there and the user's checkout
 * only ever sees a fast-forward.
 */
export interface MergeContext {
  /** The manager's worktree (its task branch is checked out there). */
  worktree: string;
  taskBranch: string;
  baseBranch: string;
  /** The user's main checkout. */
  repoRoot: string;
  into: 'task' | 'base';
  /** For `into: 'task'`: a branch already verified to belong to this tree. */
  sourceBranch?: string;
  abort?: boolean;
}

export type MergeOutcome =
  | { outcome: 'merged' | 'up-to-date' | 'aborted'; message: string; before?: string; after?: string }
  | { outcome: 'conflict'; message: string; files: string[] }
  | { outcome: 'refused'; message: string };

interface G { ok: boolean; stdout: string; stderr: string }
const g = (cwd: string, args: string[]): Promise<G> =>
  new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '' }),
    );
  });

const PROTECTED = new Set(['main', 'master', 'trunk', 'develop']);

async function conflictedFiles(cwd: string): Promise<string[]> {
  const res = await g(cwd, ['diff', '--name-only', '--diff-filter=U']);
  return res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

async function head(cwd: string): Promise<string> {
  return (await g(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
}

/** Merge `ref` into the worktree's branch. A conflict is LEFT IN PROGRESS for the manager to fix. */
async function mergeInWorktree(cwd: string, ref: string): Promise<MergeOutcome> {
  if (!isSafeGitRef(ref)) return { outcome: 'refused', message: `"${ref}" is not a usable branch name` };
  const before = await head(cwd);
  const res = await g(cwd, ['-c', 'user.name=onni', '-c', 'user.email=onni@localhost', 'merge', '--no-ff', '--no-edit', ref]);
  const after = await head(cwd);
  if (res.ok) {
    return before === after
      ? { outcome: 'up-to-date', message: `${ref} is already contained in this branch`, before, after }
      : { outcome: 'merged', message: `merged ${ref}`, before, after };
  }
  const files = await conflictedFiles(cwd);
  if (files.length > 0) {
    return {
      outcome: 'conflict',
      files,
      message: `merge of ${ref} conflicts in ${files.length} file${files.length === 1 ? '' : 's'}: ${files.join(', ')}. Resolve them, git add, git commit — then run the merge again — or run "onni task merge --abort" if you cannot.`,
    };
  }
  await g(cwd, ['merge', '--abort']);
  return { outcome: 'refused', message: `git could not merge ${ref}: ${(res.stderr || res.stdout).trim().slice(0, 300)}` };
}

export async function runManagerMerge(ctx: MergeContext): Promise<MergeOutcome> {
  const { worktree } = ctx;
  const inProgress = (await g(worktree, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).ok;

  if (ctx.abort) {
    if (!inProgress) return { outcome: 'refused', message: 'no merge is in progress in your worktree' };
    const aborted = await g(worktree, ['merge', '--abort']);
    return aborted.ok
      ? { outcome: 'aborted', message: 'the merge in progress was aborted; your branch is back where it was' }
      : { outcome: 'refused', message: `git merge --abort failed: ${aborted.stderr.trim().slice(0, 200)}` };
  }

  if (inProgress) {
    const files = await conflictedFiles(worktree);
    if (files.length > 0) {
      return { outcome: 'conflict', files, message: `a merge is still in progress with unresolved files: ${files.join(', ')}. Resolve and commit them, or run "onni task merge --abort".` };
    }
    return { outcome: 'refused', message: 'a merge is in progress with all files resolved: finish it with git commit (or "onni task merge --abort"), then merge again' };
  }

  // Both merges act on whatever HEAD is. An agent may have checked out another branch (every review
  // run does) or detached: merging then moves the base to commits that are not the task branch while
  // the result still says it is.
  const current = (await g(worktree, ['symbolic-ref', '--short', '-q', 'HEAD'])).stdout.trim();
  if (current !== ctx.taskBranch) {
    return {
      outcome: 'refused',
      message: `your worktree is ${current ? `on "${current}"` : 'on a detached HEAD'}, not on your task branch "${ctx.taskBranch}" — check "${ctx.taskBranch}" out (git checkout ${ctx.taskBranch}) before merging, so the merge cannot act on another branch`,
    };
  }

  const status = await g(worktree, ['status', '--porcelain']);
  if (status.stdout.trim()) {
    return { outcome: 'refused', message: 'your worktree has uncommitted changes — commit them first so a merge cannot mix with unfinished work' };
  }

  if (ctx.into === 'task') {
    if (!ctx.sourceBranch) return { outcome: 'refused', message: 'name the branch or run to merge: onni task merge <run id or branch>' };
    return mergeInWorktree(worktree, ctx.sourceBranch);
  }

  // into base
  const { baseBranch, taskBranch, repoRoot } = ctx;
  if (!baseBranch || !isSafeGitRef(baseBranch) || !isSafeGitRef(taskBranch)) return { outcome: 'refused', message: 'this task has no usable base branch' };
  const baseTip = (await g(repoRoot, ['rev-parse', '--verify', `refs/heads/${baseBranch}`])).stdout.trim();
  if (!baseTip) return { outcome: 'refused', message: `the local base branch "${baseBranch}" does not exist` };

  // 1. base into the task branch, in the manager's worktree.
  const contains = (await g(worktree, ['merge-base', '--is-ancestor', baseTip, 'HEAD'])).ok;
  if (!contains) {
    const step = await mergeInWorktree(worktree, baseBranch);
    if (step.outcome === 'conflict' || step.outcome === 'refused') return step;
  }
  const tip = await head(worktree);
  if (tip === baseTip) return { outcome: 'up-to-date', message: `${baseBranch} already points at this branch`, before: baseTip, after: tip };

  // 2. fast-forward the local base branch to the task tip.
  const onBranch = (await g(repoRoot, ['symbolic-ref', '--short', '-q', 'HEAD'])).stdout.trim();
  if (onBranch === baseBranch) {
    const dirty = (await g(repoRoot, ['status', '--porcelain'])).stdout.trim();
    if (dirty) return { outcome: 'refused', message: `your main checkout is on ${baseBranch} with uncommitted changes — merging into it now could clobber them. Ask the user to commit or stash, then retry` };
    const ff = await g(repoRoot, ['merge', '--ff-only', taskBranch]);
    if (!ff.ok) return { outcome: 'refused', message: `could not fast-forward ${baseBranch}: ${(ff.stderr || ff.stdout).trim().slice(0, 300)}` };
  } else {
    const elsewhere = (await g(repoRoot, ['worktree', 'list', '--porcelain'])).stdout.includes(`branch refs/heads/${baseBranch}\n`);
    if (elsewhere) return { outcome: 'refused', message: `${baseBranch} is checked out in another worktree; merge it there instead` };
    const moved = await g(repoRoot, ['update-ref', `refs/heads/${baseBranch}`, tip, baseTip]);
    if (!moved.ok) return { outcome: 'refused', message: `could not move ${baseBranch}: ${moved.stderr.trim().slice(0, 300)}` };
  }
  const note = PROTECTED.has(baseBranch) ? ` (${baseBranch} is a main branch — logged for review)` : '';
  return { outcome: 'merged', message: `${baseBranch} fast-forwarded to ${taskBranch}${note}`, before: baseTip, after: tip };
}
