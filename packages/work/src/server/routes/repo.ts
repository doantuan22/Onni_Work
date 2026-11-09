import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { repoFileQuerySchema, type RepoSync } from '@onni/contract';
import { loadConfig } from '../../config.ts';
import { branchesCheckedOutElsewhere } from '../../git-worktree.ts';
import {
  getBranches, getCommit, getDiff, getLog, getRepoInfo, getStatus,
} from '../git.ts';
import {
  collectChanges, collectCommitChanges, createOrSwitchBranch, imageMimeType,
  listRepoPaths, readWorktreePath, repoIndexContains,
} from '../git-changes.ts';
import { fetchRepo, pullRepo, pushRepo, repoSyncStatus, syncRepo, type SyncActionResult } from '../repo-sync.ts';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator, queryZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };
type QueryValue = z.ZodType<string | undefined, string | string[] | undefined>;
type StructuredQuery = z.ZodType<{ structured?: string | undefined }, any>;

/** What `GET /repo/commit/:sha` offers, DEFAULT FIRST: the legacy `text/plain` blob is what a
 *  request with no opinion has always received (§2), so it also wins an Accept tie. */
const COMMIT_FORMATS = ['text/plain', 'application/json'] as const;

export function createRepoRoutes<QueryValueType extends QueryValue>(deps: {
  queryValue: QueryValueType;
  negotiate: <O extends string>(accept: string | undefined, offers: readonly O[]) => O | null;
  fileFormats: readonly ['application/json', 'image/*'];
}) {
  // Task branches are never a base: hide the named ones (no `onni/` prefix) by record. An in-place
  // run's branch is the user's own checkout, so it stays listed.
  const taskOwnedBranches = (store: ProjectContext['store']): Set<string> =>
    new Set(store.listRuns().flatMap((r) => (r.branch && r.worktree !== false ? [r.branch] : [])));
  const runRepoSyncAction = async (
    project: ProjectContext,
    action: (root: string) => Promise<SyncActionResult>,
  ): Promise<{ error: string } | { message: string; sync: RepoSync }> => {
    const info = await getRepoInfo(project.root);
    if (!info) return { error: 'not a git repository' };
    // A pull moves HEAD and the working files: never under an in-place run's agent.
    if (action === pullRepo || action === syncRepo) {
      const live = project.store
        .listRuns()
        .some((r) => r.worktree === false && (r.status === 'running' || r.status === 'waiting'));
      if (live) return { error: 'an in-place task is running in this checkout — wait for it to finish' };
    }
    const result = await action(info.root);
    if (!result.ok) return { error: result.error };
    return { message: result.message, sync: await repoSyncStatus(info.root, taskOwnedBranches(project.store)) };
  };

  // Repo view branch actions: switch to an existing branch, or create one
  // (from `from` or HEAD) and switch. Predictable git failures — invalid
  // name, unknown `from`, dirty-tree checkout conflict — are 409 + reason.
  const structuredQuery: StructuredQuery = z.object({ structured: deps.queryValue });
  const repoBranchSchema = z.object({
    name: z.string().trim().min(1).max(200),
    from: z.string().trim().min(1).max(200).optional(),
  });
  return new Hono<ProjectApiEnv>()
    .get('/repo', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const info = await getRepoInfo(repoRoot);
      if (!info)
        return c.json({
          info: null,
          status: [],
          log: [],
          branches: [],
          checkedOutElsewhere: {},
          baseBranch: null,
        });
      const taskBranches = taskOwnedBranches(store);
      const [status, log, branches, held, config] = await Promise.all([
        getStatus(info.root),
        getLog(info.root),
        getBranches(info.root, taskBranches),
        branchesCheckedOutElsewhere(info.root),
        loadConfig(repoRoot),
      ]);
      return c.json({
        info,
        status,
        log,
        branches,
        checkedOutElsewhere: Object.fromEntries(branches.flatMap((b) => (held.has(b) ? [[b, held.get(b)!]] : []))),
        baseBranch: config.baseBranch ?? null,
      });
    })

    .get('/repo/diff', async (c) => {
      const { root: repoRoot } = c.get('project');
      const info = await getRepoInfo(repoRoot);
      if (!info) return c.text('not a git repository');
      return c.text(await getDiff(info.root));
    })

    // One commit's message + stat + patch — the Repo view expands it inline.
    // `?structured=1` is the ADDITIVE sibling (R5 Step 1.7): the new repo view's commit-diff
    // shape `{sha, subject, author, when, files, stat}` with 409 + reason on failure. The
    // legacy text answer below is a protected surface (BACKWARD_COMPATIBILITY.md §2) — its
    // shape, including the in-band failure sentences, stays exactly as it was.
    //
    // `Accept: application/json` reaches the same structured answer without the flag, and
    // `Accept: text/plain` asks for the blob; the flag still wins whenever it is present, and a
    // request with no opinion still gets the blob. See `negotiate`.
    .get('/repo/commit/:sha', queryZodValidator(structuredQuery), async (c) => {
      const { root: repoRoot } = c.get('project');
      c.header('vary', 'Accept');
      const { structured } = c.req.valid('query');
      const wantsJson =
        structured !== undefined
          ? structured === '1'
          : deps.negotiate(c.req.header('accept'), COMMIT_FORMATS) === 'application/json';
      const info = await getRepoInfo(repoRoot);
      if (wantsJson) {
        if (!info) return c.json({ error: 'not a git repository' }, 409);
        const result = await collectCommitChanges(info.root, c.req.param('sha'));
        if (!result.ok) return c.json({ error: result.error }, 409);
        return c.json(result.commit);
      }
      if (!info) return c.text('not a git repository');
      try {
        return c.text(await getCommit(info.root, c.req.param('sha')));
      } catch (err) {
        return c.text(`(git show failed: ${err instanceof Error ? err.message : String(err)})`);
      }
    })

    // Structured sibling of the text-blob /api/repo/diff above (protected
    // surface, untouched): the same {files, stat} shape the session /changes
    // route serves, here for the MAIN working tree's uncommitted changes vs
    // HEAD (redesign R5 Step 1.3 — §"Git/session API additions").
    .get('/repo/changes', async (c) => {
      const { root: repoRoot } = c.get('project');
      const info = await getRepoInfo(repoRoot);
      if (!info) return c.json({ error: 'not a git repository' }, 409);
      // The user's REAL working tree — never stage into their index (a GET must not write).
      const result = await collectChanges(info.root, 'HEAD', {
        intentToAdd: false,
      });
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json(result.changes);
    })

    // The repository's whole path index in ONE bounded response (spec
    // `.ai/specs/2026-10-05-repo-file-browser.md`, #1279) — the Git tab's Files sub-tab builds its
    // tree from this and filters it client-side, which is why there is no search endpoint.
    // `git ls-files` is the source, so `.gitignore`d build output and `node_modules` never appear,
    // and the set it returns is the membership guard the content route below enforces.
    .get('/repo/tree', async (c) => {
      const { root: repoRoot } = c.get('project');
      const info = await getRepoInfo(repoRoot);
      // Same status AND the same words as /repo/changes: the Files tab reads this 409 as "the
      // whole Git view has nothing to show", exactly as the Changes tab does.
      if (!info) return c.json({ error: 'not a git repository' }, 409);
      const result = await listRepoPaths(info.root);
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json({ paths: result.paths, truncated: result.truncated });
    })

    // One repository file, for the Files sub-tab's viewer — the `/runs/:id/files` handler's shape
    // with the run lookup replaced by `getRepoInfo`, plus ONE extra guard that the run route does
    // not need and this one cannot do without.
    //
    // This serves the user's REAL checkout, not an isolated worktree. `readWorktreePath` stops
    // traversal, `.git` and symlinks — it knows nothing about `.gitignore`, so on its own
    // `?path=.env` would be served verbatim, and AGENTS.md § Zero config's promise that a
    // repository `.env` is never read would be one fetch away from any cockpit client. The index
    // membership check below is that control: only a path `git ls-files` returned is readable, so
    // the reachable set is exactly what is committed or deliberately left untracked-and-unignored.
    // A TRACKED `.env` stays readable, by design — it is in the index and in the remote already.
    //
    // The index is re-derived per request rather than cached: a cache would serve a file the user
    // has since ignored, and `ls-files` is one bounded subprocess.
    .get('/repo/files', queryZodValidator(repoFileQuerySchema), async (c) => {
      const { root: repoRoot } = c.get('project');
      const query = c.req.valid('query');
      c.header('vary', 'Accept');
      const wantsRaw =
        query.raw !== undefined
          ? query.raw === '1'
          : deps.negotiate(c.req.header('accept'), deps.fileFormats) === 'image/*';
      const info = await getRepoInfo(repoRoot);
      if (!info) return c.json({ error: 'not a git repository' }, 409);
      const index = await repoIndexContains(info.root, query.path);
      if (!index.ok) return c.json({ error: index.error }, 409);
      if (!index.indexed) {
        // Deliberately ONE message for "ignored", "untracked and ignored" and "does not exist" —
        // a distinct wording for the ignored case would disclose that an ignored file is present
        // on disk, which is the very thing this guard exists to keep quiet about.
        return c.json({ error: `path is not in the repository index: ${query.path}` }, 409);
      }
      const result = await readWorktreePath(info.root, query.path);
      if (result.kind === 'invalid' || result.kind === 'missing') {
        return c.json({ error: result.error }, 409);
      }
      if (result.kind === 'dir') {
        // Reachable despite every indexed path being a file: a submodule is one `ls-files` entry
        // that resolves to a directory. Refused in the resolver's own grammar rather than
        // inventing a submodule view.
        return c.json({ error: `not a regular file: ${result.path}` }, 409);
      }
      if (wantsRaw) {
        const mime = imageMimeType(result.path);
        if (mime === null || result.tooLarge) {
          // `?raw=1` asked for bytes, so it hears why it cannot have them; a mere `Accept`
          // preference falls through to the JSON answer. Same split as `/runs/:id/files`.
          if (query.raw !== undefined) {
            const error =
              mime === null
                ? `raw serving is limited to images: ${result.path}`
                : `file too large to serve raw (${result.size} bytes): ${result.path}`;
            return c.json({ error }, 409);
          }
        } else {
          const bytes = await readFile(join(info.root, result.path));
          return c.body(new Uint8Array(bytes).buffer as ArrayBuffer, 200, {
            'content-type': mime,
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          });
        }
      }
      return c.json({
        // `as const` or Hono's inference widens the literal to `string` and the consumer's
        // discriminated narrowing collapses to `never` — the same trap `/runs/:id/files` documents.
        type: 'file' as const,
        path: result.path,
        size: result.size,
        binary: result.binary,
        tooLarge: result.tooLarge,
        ...(result.content !== undefined ? { content: result.content } : {}),
      });
    })

    .post('/repo/branch', jsonZodValidator(() => repoBranchSchema), async (c) => {
      const { root: repoRoot } = c.get('project');
      const info = await getRepoInfo(repoRoot);
      if (!info) return c.json({ error: 'not a git repository' }, 409);
      const parsed = { data: c.req.valid('json') };
      const result = await createOrSwitchBranch(info.root, parsed.data.name, parsed.data.from);
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json({ branch: result.branch, created: result.created });
    })

    // Source-Control sync (spec 2026-10-19-repo-git-sync): offline status, explicit network.
    .get('/repo/sync', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const info = await getRepoInfo(repoRoot);
      if (!info) return c.json({ error: 'not a git repository' }, 409);
      return c.json(await repoSyncStatus(info.root, taskOwnedBranches(store)));
    })
    .post('/repo/fetch', async (c) => {
      const r = await runRepoSyncAction(c.get('project'), fetchRepo);
      return 'error' in r ? c.json({ error: r.error }, 409) : c.json({ message: r.message, sync: r.sync });
    })
    .post('/repo/pull', async (c) => {
      const r = await runRepoSyncAction(c.get('project'), pullRepo);
      return 'error' in r ? c.json({ error: r.error }, 409) : c.json({ message: r.message, sync: r.sync });
    })
    .post('/repo/push', async (c) => {
      const r = await runRepoSyncAction(c.get('project'), pushRepo);
      return 'error' in r ? c.json({ error: r.error }, 409) : c.json({ message: r.message, sync: r.sync });
    })
    .post('/repo/sync', async (c) => {
      const r = await runRepoSyncAction(c.get('project'), syncRepo);
      return 'error' in r ? c.json({ error: r.error }, 409) : c.json({ message: r.message, sync: r.sync });
    });
}
