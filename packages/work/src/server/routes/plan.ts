import { Hono } from 'hono';
import { z } from 'zod';
import { planChain } from '../../planner.ts';
import { loadConfig } from '../../config.ts';
import type { ProviderId } from '../../core/provider-auth.ts';
import type { ProviderAccountScope } from '../provider-action-gate.ts';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };
const planSchema = z.object({
  // Same bound as `startRunSchema.task` — this flows into `planChain` (#429).
  task: z.string().trim().min(1).max(100_000, 'must be at most 100000 characters'),
});

export function createPlanRoutes(deps: {
  providerActionError: (required: readonly ProviderId[], scope?: ProviderAccountScope) => Promise<string | null>;
}) {
  const { providerActionError } = deps;
  const planRoutes = new Hono<ProjectApiEnv>()
    .post('/plan', jsonZodValidator(planSchema), async (c) => {
      const { root: repoRoot } = c.get('project');
      const parsed = { data: c.req.valid('json') };
      const blocked = await providerActionError([(await loadConfig(repoRoot)).defaultRunner], { repoRoot });
      if (blocked) return c.json({ error: blocked }, 409);
      return c.json(await planChain(repoRoot, parsed.data.task));
    });

  return planRoutes;
}
