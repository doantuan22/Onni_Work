import { Hono } from 'hono';
import type { ProjectContext } from '../project-context.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

export function launchKeyRoutes() {
  return new Hono<ProjectApiEnv>()
    .get('/launch-key', (c) => c.json({ key: c.get('project').launchKey }));
}
