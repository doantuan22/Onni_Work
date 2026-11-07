import { modelDiscoveryRunnerSchema } from '@onni/contract';
import { Hono } from 'hono';
import { z } from 'zod';
import type { RunnerModelCatalog } from '../../core/runner-model-catalog.ts';
import type { ProjectContext } from '../project-context.ts';
import { queryZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

export function createModelsRoutes(deps: { modelCatalog: RunnerModelCatalog }) {
  return new Hono<ProjectApiEnv>()
    // `modelDiscoveryRunnerSchema` is the contract's own list of the runners with an
    // authoritative host-local catalog (#794, #784), so the client compiles against exactly what
    // this validates. A runner absent from it has no discovery path and this 400s.
    .get('/models', queryZodValidator(z.object({ runner: z.union([z.string(), z.array(z.string()).transform((v) => v[0] as string)]).pipe(modelDiscoveryRunnerSchema) }), { message: 'runner must be claude, codex, opencode, cursor, pi, junie, or antigravity' }), async (c) => {
      const query = { data: c.req.valid('query') };
      return c.json(await deps.modelCatalog.get(query.data.runner));
    });
}
