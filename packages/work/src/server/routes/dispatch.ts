import { Hono, type MiddlewareHandler } from 'hono';
import {
  dispatchInputSchema,
  dispatchManagerCancelInputSchema,
  dispatchManagerMessageInputSchema,
  dispatchManagerRedirectInputSchema,
  dispatchReportSchema,
  dispatchVerifyInputSchema,
  managerAskInputSchema,
  mergeInputSchema,
  PEEK_TAIL_MAX_LINES,
  treePlanPatchSchema,
  treePlanPutSchema,
  type MergeResult,
} from '@onni/contract';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator, queryZodValidator } from '../validators.ts';
import { z } from 'zod';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

const queryValue = z.union([z.string(), z.array(z.string()).transform((v) => v[0] as string)]).optional();

// ---- chained family: dispatch (project-scoped) ----
// A task dispatching other tasks (spec 2026-09-10-dispatch). Both routes are what the `onni task`
// CLI calls from inside a running agent, with ONNI_API_URL / ONNI_PROJECT_ID / ONNI_TASK_ID from
// its environment; nothing stops a human or a script from calling them too.
export function createDispatchRoutes(deps: {
  requireDispatch: MiddlewareHandler<ProjectApiEnv>;
}) {
  return new Hono<ProjectApiEnv>()
    .use('/runs/:id/dispatch', deps.requireDispatch)
    .use('/runs/:id/report', deps.requireDispatch)
    .use('/runs/:id/merge', deps.requireDispatch)
    .use('/runs/:id/budget', deps.requireDispatch)
    .use('/runs/:id/peek', deps.requireDispatch)
    .use('/runs/:id/verify', deps.requireDispatch)
    .use('/runs/:id/conflicts', deps.requireDispatch)
    .use('/runs/:id/worker-message', deps.requireDispatch)
    .use('/runs/:id/worker-cancel', deps.requireDispatch)
    .use('/runs/:id/worker-redirect', deps.requireDispatch)
    .use('/runs/:id/ask', deps.requireDispatch)
    .use('/runs/:id/plan', deps.requireDispatch)
    .use('/runs/:id/plan/parts/:partId', deps.requireDispatch)

    /** Create ONE child of run `:id`. Refusals (cap, budget, settled parent) are 409 with the
     *  reason — the same text the parent's transcript notes. */
    .post('/runs/:id/dispatch', jsonZodValidator(dispatchInputSchema), async (c) => {
      const { manager } = c.get('project');
      const outcome = await manager.dispatchFromAgent(c.req.param('id'), c.req.valid('json'));
      if ('refused' in outcome) return c.json({ error: outcome.refused }, 409);
      return c.json(outcome, 201);
    })

    /** Root-manager controls for a direct worker. Guard questions remain for the user to answer. */
    .post('/runs/:id/worker-message', jsonZodValidator(dispatchManagerMessageInputSchema), (c) => {
      const { manager } = c.get('project');
      const outcome = manager.messageFor(c.req.param('id'), c.req.valid('json'));
      if ('denied' in outcome) return c.json({ error: outcome.denied }, outcome.status);
      return c.json(outcome);
    })
    .post('/runs/:id/worker-cancel', jsonZodValidator(dispatchManagerCancelInputSchema), (c) => {
      const { manager } = c.get('project');
      const outcome = manager.cancelFor(c.req.param('id'), c.req.valid('json'));
      if ('denied' in outcome) return c.json({ error: outcome.denied }, outcome.status);
      return c.json(outcome);
    })
    .post('/runs/:id/worker-redirect', jsonZodValidator(dispatchManagerRedirectInputSchema), async (c) => {
      const { manager } = c.get('project');
      const outcome = await manager.redirectFor(c.req.param('id'), c.req.valid('json'));
      if ('denied' in outcome) {
        switch (outcome.status) {
          case 400: return c.json({ error: outcome.denied }, 400);
          case 403: return c.json({ error: outcome.denied }, 403);
          case 404: return c.json({ error: outcome.denied }, 404);
          case 409: return c.json({ error: outcome.denied }, 409);
        }
      }
      if ('error' in outcome) return c.json(outcome, 409);
      return c.json(outcome, 200);
    })

    /** The manager's merge tool. The permission is checked in `mergeFromAgent`; a denial is 409
     *  with the reason, a conflict is a 200 `{ outcome: 'conflict' }` (the merge stays in progress). */
    .post('/runs/:id/merge', jsonZodValidator(mergeInputSchema), async (c) => {
      const { manager } = c.get('project');
      const outcome = await manager.mergeFromAgent(c.req.param('id'), c.req.valid('json'));
      if ('denied' in outcome) return c.json({ error: outcome.denied }, 409);
      return c.json(outcome as MergeResult, 200); // `refused` is already a `denied` above
    })

    /** Record run `:id`'s own report. 404 when the run is not in a dispatch tree. */
    .post('/runs/:id/report', jsonZodValidator(dispatchReportSchema), (c) => {
      const { manager } = c.get('project');
      const recorded = manager.recordReport(c.req.param('id'), c.req.valid('json'));
      if (!recorded) return c.json({ error: 'run is not part of a dispatch tree' }, 404);
      return c.json({ ok: true as const });
    })

    /** `onni task ask` (plan v2 §9): a root manager asks WITHOUT parking. 409 for a non-root
     *  caller, a second open question, or a task that is no longer live. */
    .post('/runs/:id/ask', jsonZodValidator(managerAskInputSchema), (c) => {
      const { manager } = c.get('project');
      const outcome = manager.askUser(c.req.param('id'), c.req.valid('json'));
      if ('denied' in outcome) return c.json({ error: outcome.denied }, outcome.status);
      return c.json(outcome);
    })

    /** What is left of the tree's ceilings (`onni task budget`, plan v2 §6.2). Any run in the
     *  tree may ask; the arithmetic is the ROOT's, resolved inside the manager. */
    .get('/runs/:id/budget', (c) => {
      const { manager } = c.get('project');
      const budget = manager.dispatchBudgetFor(c.req.param('id'));
      return budget ? c.json(budget) : c.json({ error: 'no such run' }, 404);
    })

    /** The tree plan (`onni task plan`, plan v2 §10). Root manager only; a corrupt file reads as
     *  an empty plan, never a failed request. */
    .get('/runs/:id/plan', async (c) => {
      const { manager } = c.get('project');
      const outcome = await manager.readTreePlan(c.req.param('id'));
      if ('denied' in outcome) return c.json({ error: outcome.denied }, outcome.status);
      return c.json(outcome);
    })

    /** `PUT /runs/:id/plan` — replace every part. A stale `revision` is 409 with the current plan. */
    .put('/runs/:id/plan', jsonZodValidator(treePlanPutSchema), async (c) => {
      const { manager } = c.get('project');
      const outcome = await manager.writeTreePlan(c.req.param('id'), c.req.valid('json'));
      if ('denied' in outcome) return c.json({ error: outcome.denied }, outcome.status);
      return c.json(outcome);
    })

    /** `PATCH /runs/:id/plan/parts/:partId` — one part, read-modify-write inside the tree lock. */
    .patch('/runs/:id/plan/parts/:partId', jsonZodValidator(treePlanPatchSchema), async (c) => {
      const { manager } = c.get('project');
      const outcome = await manager.patchTreePlanPart(c.req.param('id'), c.req.param('partId'), c.req.valid('json'));
      if ('denied' in outcome) return c.json({ error: outcome.denied }, outcome.status);
      return c.json(outcome);
    })

    /** What a manager sees of its workers (`onni task peek`, plan v2 §7). Read-only. Access is
     *  checked in `peekFor`: 404 unknown run, 403 a worker asking, 409 a run of another tree. */
    .get('/runs/:id/peek', queryZodValidator(z.object({
      target: z.string().trim().min(1).max(200).optional(),
      all: queryValue,
      tail: z.coerce.number().int().min(1).max(PEEK_TAIL_MAX_LINES).optional(),
    }), { message: `tail must be 1-${PEEK_TAIL_MAX_LINES}` }), async (c) => {
      const { manager } = c.get('project');
      const { target, all, tail } = c.req.valid('query');
      const outcome = await manager.peekFor(c.req.param('id'), {
        ...(target !== undefined ? { target } : {}),
        ...(all !== undefined ? { all: true } : {}),
        ...(tail !== undefined ? { tail } : {}),
      });
      if ('denied' in outcome) return c.json({ error: outcome.denied }, outcome.status);
      return c.json(outcome);
    })

    /** `onni task verify` (wave A1): the root manager has onni run the repo's checks inside a SETTLED
     *  worker's worktree. 4xx: 403 non-root, 404 unknown, 409 other tree / not settled / cap / busy,
     *  400 unknown `only` entry. A check that cannot run is a 200 with state 'unavailable'. */
    .post('/runs/:id/verify', jsonZodValidator(dispatchVerifyInputSchema), async (c) => {
      const { manager } = c.get('project');
      const outcome = await manager.verifyFor(c.req.param('id'), c.req.valid('json'));
      if ('denied' in outcome) return c.json({ error: outcome.denied }, outcome.status);
      return c.json(outcome);
    })

    /** Read-only overlap and trial-merge report. Access is checked by the manager; the result is advisory. */
    .get('/runs/:id/conflicts', queryZodValidator(z.object({
      target: z.string().trim().min(1).max(200).optional(),
    })), async (c) => {
      const { manager } = c.get('project');
      const { target } = c.req.valid('query');
      const outcome = await manager.conflictsFor(c.req.param('id'), target !== undefined ? { target } : {});
      if ('denied' in outcome) return c.json({ error: outcome.denied }, outcome.status);
      return c.json(outcome);
    });
}
