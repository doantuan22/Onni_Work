import { existsSync } from 'node:fs';
import { Hono } from 'hono';
import type { GroupResponse, GroupVariant } from '@onni/contract';
import { removeWorktree, worktreeDiff, worktreeDiffStat } from '../../git-worktree.ts';
import { appendHandoffHeartbeat, handoffProgressExcerpt, readHandoff } from '../../handoff.ts';
import { loadConfig } from '../../config.ts';
import { reviewGateEnabled } from '../../runs/review-gate.ts';
import type { RunRecord, RunStore } from '../../runs/store.ts';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator } from '../validators.ts';
import type { ZodType } from 'zod';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

type GroupsRouteDeps<TPickSchema extends ZodType<{ runId: string }>> = {
  pickSchema: TPickSchema;
  stopTaskProcesses: (runId: string) => void;
  legacyWorktreeMutation: <T>(project: ProjectContext, runId: string, mutate: () => Promise<T>) => Promise<T>;
};

export function groupsRoutes<TPickSchema extends ZodType<{ runId: string }>>(deps: GroupsRouteDeps<TPickSchema>) {
  // ---- parallel variants (spec 010) -----------------------------------------

  const groupRuns = (store: RunStore, groupId: string): RunRecord[] =>
    store
      .listRuns()
      .filter((r) => r.groupId === groupId)
      .sort((a, b) => (a.variant ?? '').localeCompare(b.variant ?? ''));

  // ---- chained family: variant groups (project-scoped) ----
  return new Hono<ProjectApiEnv>()
    .get('/groups/:groupId', async (c) => {
      const { dataDir, store } = c.get('project');
      const runs = groupRuns(store, c.req.param('groupId'));
      if (runs.length === 0) return c.json({ error: 'not found' }, 404);
      const detailed = await Promise.all(
        runs.map(async (r): Promise<GroupVariant> => ({
          id: r.id,
          variant: r.variant ?? '?',
          title: r.title,
          status: r.status,
          archived: r.archived,
          tokensUsed: r.tokensUsed,
          ...(r.inputTokens !== undefined ? { inputTokens: r.inputTokens } : {}),
          ...(r.outputTokens !== undefined ? { outputTokens: r.outputTokens } : {}),
          ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}),
          diffStat:
            r.worktreePath && existsSync(r.worktreePath)
              ? await worktreeDiffStat(r.worktreePath, r.baseBranch ?? 'HEAD')
              : '',
          handoffExcerpt: handoffProgressExcerpt(readHandoff(dataDir, r.id)),
        })),
      );
      return c.json({
        groupId: c.req.param('groupId'),
        runs: detailed,
      } satisfies GroupResponse);
    })

    // "Pick this one": the winner rests at `review` (spec 009 takes it from
    // there — send back / draft PR / finish); the losers are cancelled if
    // alive, archived, and their worktrees + branches removed.
    .post('/groups/:groupId/pick', jsonZodValidator(deps.pickSchema), async (c) => {
      const { root: repoRoot, dataDir, store, manager } = c.get('project');
      const runs = groupRuns(store, c.req.param('groupId'));
      if (runs.length === 0) return c.json({ error: 'not found' }, 404);
      const parsed = { data: c.req.valid('json') };
      const winner = runs.find((r) => r.id === parsed.data.runId);
      if (!winner) return c.json({ error: 'runId is not part of this group' }, 404);
      if (manager.isActive(winner.id)) {
        return c.json({ error: 'this variant is still active — wait for it to finish first' }, 409);
      }

      // Winner: a non-review terminal state with a non-empty diff flips to
      // `review` (the settleSuccess rule) — but only when the review gate applies
      // (#489): it is enabled (`reviewGateEnabled`, default off) AND the winner is
      // not autonomous. An autonomous / gate-off winner keeps its `done` state with
      // the diff left in the worktree; an empty diff (or no worktree) stays too.
      if (
        winner.status !== 'review' &&
        winner.worktreePath &&
        existsSync(winner.worktreePath) &&
        winner.autonomous !== true &&
        reviewGateEnabled(await loadConfig(repoRoot))
      ) {
        const diff = await worktreeDiff(winner.worktreePath, winner.baseBranch ?? 'HEAD');
        if (diff.trim().length > 0 && !diff.startsWith('(diff failed')) {
          store.updateRun(winner.id, { status: 'review' });
        }
      }
      const losers = runs.filter((r) => r.id !== winner.id);
      store.appendEvent(winner.id, {
        type: 'lifecycle',
        message: `picked from ${runs.length} variants — ${losers.length} other variant(s) archived`,
      });
      appendHandoffHeartbeat(dataDir, winner.id, `picked from ${runs.length} variants`);

      for (const loser of losers) {
        let removed = false;
        let cleanupError: string | undefined;
        // A shell must not outlive the directory it is standing in (spec §6).
        deps.stopTaskProcesses(loser.id);
        try {
          const operation = manager.lifecycle ? await manager.lifecycle.discardVariant(loser.id) : null;
          if (!operation) {
            if (manager.cancelAndWait) {
              if (!await manager.cancelAndWait(loser.id)) throw new Error('Variant process has not exited; worktree retained');
            } else if (manager.isActive(loser.id)) {
              manager.cancel(loser.id);
              throw new Error('Variant cancellation requested; worktree retained until process exit is confirmed');
            }
            if (loser.worktreePath) await deps.legacyWorktreeMutation(c.get('project'), loser.id, () => removeWorktree(repoRoot, loser.worktreePath!, loser.branch));
            removed = !loser.worktreePath || !existsSync(loser.worktreePath);
            if (!removed) throw new Error('Worktree removal did not complete');
            store.updateRun(loser.id, { worktreePath: undefined, branch: undefined });
          }
        } catch (error) { cleanupError = error instanceof Error ? error.message : 'Cleanup needs attention'; }
        store.setArchived(loser.id, true);
        store.appendEvent(loser.id, {
          type: 'lifecycle',
          message: `variant ${winner.variant ?? '?'} was picked — this variant is archived; ${removed ? 'its worktree was removed' : cleanupError ? `cleanup needs attention: ${cleanupError}` : 'worktree cleanup is queued'}`,
        });
      }
      if (losers.some((loser) => loser.prHead)) await manager.sweepPrHeadRefs();
      // Spread: `getRun` may answer undefined, and an undefined VALUE is dropped by
      // JSON.stringify — so writing the key unconditionally typed the route as sending a key it
      // does not. contract/workflows.ts says `.optional()`, which is what a client receives.
      const picked = store.getRun(winner.id);
      return c.json({ ...(picked !== undefined ? { winner: picked } : {}) });
    });
}
