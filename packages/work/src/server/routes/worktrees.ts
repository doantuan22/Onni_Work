import { existsSync } from 'node:fs';
import { Hono } from 'hono';
import { resolveWorktreeRetention } from '../../config.ts';
import { worktreeSizeBytes } from '../../git-worktree.ts';
import { isReclaimable, reclaimWorktrees } from '../../runs/retention.ts';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator } from '../validators.ts';
import { z } from 'zod';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

export function worktreesRoutes() {
  const reclaimBodySchema = z.object({}).passthrough();
  // ---- chained family: worktrees (project-scoped) ----
  return new Hono<ProjectApiEnv>()
    .get('/worktrees', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      // The keep-limit the panel reports is the one the enforcer will actually
      // apply — inherited from the workspace default when this repo sets none.
      const keep = await resolveWorktreeRetention(repoRoot);
      const runs = store.listRuns().filter((r) => r.worktreePath && existsSync(r.worktreePath));
      const worktrees = await Promise.all(
        runs.map(async (r) => ({
          runId: r.id,
          title: r.title ?? r.id,
          status: r.status,
          branch: r.branch ?? null,
          // POSIX `du` — degrades to null (Windows / du missing / error); never blocks.
          sizeBytes: await worktreeSizeBytes(r.worktreePath as string),
          finishedAt: r.finishedAt ?? null,
          reclaimable: isReclaimable(r),
        })),
      );
      // Total is null when any size degraded, so the panel never shows a wrong sum.
      const totalBytes = worktrees.some((w) => w.sizeBytes === null)
        ? null
        : worktrees.reduce((sum, w) => sum + (w.sizeBytes ?? 0), 0);
      return c.json({ worktrees, totalBytes, keep });
    })

    .post('/worktrees/reclaim', jsonZodValidator(() => reclaimBodySchema, { absent: ({}), message: 'invalid body' }), async (c) => {
      const { root: repoRoot, store } = c.get('project');
      // The body is validated (an empty or `{}` one is accepted) but carries nothing this
      // handler reads; retention is best-effort, so 200 always.
      const reclaimed = await reclaimWorktrees(repoRoot, store, await resolveWorktreeRetention(repoRoot), { lifecycle: c.get('project').manager.lifecycle });
      return c.json({ reclaimed });
    });


}
