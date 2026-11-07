import { Hono } from 'hono';
import { z } from 'zod';
import type * as Browse from '../fs-browse.ts';
import type { ProjectContext } from '../project-context.ts';
import { queryZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };
type QueryValue = z.ZodType<string | undefined, string | string[] | undefined>;

export function createFsBrowseRoutes<QueryValueType extends QueryValue>(deps: {
  browseDirectory: typeof Browse.browseDirectory;
  capabilities: () => { singleProject: boolean; localHandoff: boolean };
  queryValue: QueryValueType;
  resolveBrowseRoot: typeof Browse.resolveBrowseRoot;
  singleProjectRefusal: (action: 'folder browsing') => { error: string };
  workspaceBrowseRoot: () => Promise<string>;
}) {
  return new Hono<ProjectApiEnv>()
    .get(
      '/fs/browse',
      queryZodValidator(z.object({ path: deps.queryValue, showHidden: deps.queryValue })),
      async (c) => {
        if (deps.capabilities().singleProject) {
          return c.json(deps.singleProjectRefusal('folder browsing'), 409);
        }
        const query = c.req.valid('query') as { path?: string; showHidden?: string };
        const root = deps.resolveBrowseRoot(await deps.workspaceBrowseRoot());
        const result = await deps.browseDirectory({
          root,
          path: query.path,
          showHidden: query.showHidden === '1',
          // The user's own machine: any folder, `root` is only the starting point. A hosted
          // cockpit keeps the containment (registration already follows the same split).
          unrestricted: deps.capabilities().localHandoff,
        });
        if (!result.ok) return c.json({ error: result.error }, result.status);
        return c.json(result.body);
      },
    );
}
