import { Hono, type MiddlewareHandler } from 'hono';
import { managerMemoryAddSchema, managerMemoryPutSchema } from '@onni/contract';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };
  // ---- chained family: project memory (plan v2 §8) ----
  // `GET/PUT /manager-memory` are the Settings pair and work with dispatch off: they edit a file,
  // not a tree. `POST /runs/:id/memory` is the manager's own command and sits behind the gate.
export function createMemoryRoutes(deps: {
  requireDispatch: MiddlewareHandler<ProjectApiEnv>;
}) {
  return new Hono<ProjectApiEnv>()
    .get('/manager-memory', async (c) => {
      const { manager } = c.get('project');
      return c.json(await manager.readManagerMemory());
    })

    /** Refuses rather than truncates: over the cap is 400, a stale revision is 409 with the
     *  current file so Settings can reload instead of dropping the other window's lesson. */
    .put('/manager-memory', jsonZodValidator(managerMemoryPutSchema), async (c) => {
      const { manager } = c.get('project');
      const outcome = await manager.writeManagerMemory(c.req.valid('json'));
      if (!outcome.ok) {
        return c.json({ error: outcome.error, ...(outcome.current ? { current: outcome.current } : {}) }, outcome.status);
      }
      return c.json(outcome.memory);
    })

    .use('/runs/:id/memory', deps.requireDispatch)
    .post('/runs/:id/memory', jsonZodValidator(managerMemoryAddSchema), async (c) => {
      const { manager } = c.get('project');
      const outcome = await manager.addManagerMemory(c.req.param('id'), c.req.valid('json'));
      if ('denied' in outcome) return c.json({ error: outcome.denied }, outcome.status);
      return c.json(outcome);
    });
}
