import { Hono } from 'hono';\r\nimport { z } from 'zod';\r\nimport { planChain } from '../../planner.ts';\r\nimport { loadConfig } from '../../config.ts';\r\nimport type { ProviderId } from '../../core/provider-auth.ts';\r\nimport type { ProviderAccountScope } from '../provider-action-gate.ts';\r\nimport type { ProjectContext } from '../project-context.ts';\r\nimport { jsonZodValidator } from '../validators.ts';\r\n\r\ntype ProjectApiEnv = { Variables: { project: ProjectContext } };\r\nconst planSchema = z.object({
  // Same bound as `startRunSchema.task` — this flows into `planChain` (#429).
  task: z.string().trim().min(1).max(100_000, 'must be at most 100000 characters'),
});

export function createPlanRoutes(deps: {\r\n  providerActionError: (required: readonly ProviderId[], scope?: ProviderAccountScope) => Promise<string | null>;\r\n}) {\r\n  const { providerActionError } = deps;
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
