import { Hono } from 'hono';
import { runIdParamSchema, workspaceLayoutsResponseSchema, workspaceLayoutsSchema } from '@onni/contract';
import { readRunLayouts, writeRunLayouts } from '../../runs/layouts.ts';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator, paramZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

// A task's saved workspace layouts belong to the task on the Onni host that owns it (spec
// `.ai/specs/2026-10-07-task-workspace.md` §5.3). The run-delete route removes the files.
export function createLayoutsRoutes() {
  return new Hono<ProjectApiEnv>()
    .get('/runs/:id/layouts', paramZodValidator(runIdParamSchema), (c) => {
      const { dataDir, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      return c.json(workspaceLayoutsResponseSchema.parse({ layouts: readRunLayouts(dataDir, run.id) }));
    })

    .put(
      '/runs/:id/layouts',
      paramZodValidator(runIdParamSchema),
      jsonZodValidator(workspaceLayoutsSchema),
      (c) => {
        const { dataDir, store } = c.get('project');
        const run = store.getRun(c.req.param('id'));
        if (!run) return c.json({ error: 'not found' }, 404);
        const value = c.req.valid('json');
        if (!writeRunLayouts(dataDir, run.id, value)) {
          // A read-only home or a full disk keeps the layout in memory for the current visit.
          return c.json({ error: 'could not save layouts on this host' }, 409);
        }
        return c.json(workspaceLayoutsResponseSchema.parse({ layouts: value }));
      },
    );
}
