import { mkdir, writeFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ZodType } from 'zod';
import { jsonZodValidator } from '../validators.ts';
import type { ProjectContext } from '../project-context.ts';
import { readUiState, uiStatePath } from '../../ui-state.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

export function uiStateRoutes<TUiStateBody extends ZodType<Record<string, unknown>, any>>(deps: {
  uiStateBody: TUiStateBody;
  maxBodySize: number;
}) {
  return new Hono<ProjectApiEnv>()
    .get('/ui-state', async (c) => c.json(await readUiState(c.get('project').root)))

    // On `use`, not inline on the route — see the workspace ui-state PUT above.
    .use('/ui-state', bodyLimit({ maxSize: deps.maxBodySize }))

    .put('/ui-state', jsonZodValidator(deps.uiStateBody), async (c) => {
      const { root: repoRoot, dataDir } = c.get('project');
      // `.passthrough()` keeps unknown prefs (BACKWARD_COMPATIBILITY §3), but a
      // single request may not stuff an unbounded key set (#429) — the shared
      // schema+cap half of both ui-state routes lives in `uiStateBody`.
      const parsed = { data: c.req.valid('json') };
      const merged = { ...(await readUiState(repoRoot)), ...parsed.data };
      try {
        await mkdir(dataDir, { recursive: true });
        await writeFile(uiStatePath(repoRoot), `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return c.json(merged);
    });
}
