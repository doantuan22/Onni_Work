import { Hono } from 'hono';
import { openProjectInSchema } from '@onni/contract';
import type { OpenTarget } from '../open-in-app.ts';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

type OpenTargetsRouteDeps = {
  capabilities: () => { localHandoff: boolean };
  detectOpenTargets: () => OpenTarget[];
  agentCliRunner: (targetId: string) => string | null;
  openApp: (targetId: string, dir: string) => Promise<boolean>;
};

export function openTargetsRoutes(deps: OpenTargetsRouteDeps) {
  return new Hono<ProjectApiEnv>()
    .get('/open-targets', (c) => c.json({ targets: deps.capabilities().localHandoff ? deps.detectOpenTargets() : [] }))

    // Open the PROJECT ROOT itself (Settings → "Project folder" → Open with). The run route
    // above opens a task worktree and needs a run to name one; this is the repo the cockpit is
    // scoped to, which the scope middleware has already resolved — so no path is accepted from
    // the client and there is nothing to contain.
    .post('/open-in', jsonZodValidator(openProjectInSchema), async (c) => {
      const { root } = c.get('project');
      if (!deps.capabilities().localHandoff) {
        return c.json(
          { error: 'local handoff is disabled — this cockpit runs in hosted mode (ONNI_REMOTE)' },
          409,
        );
      }
      const { target } = c.req.valid('json');
      // Refused here rather than left to the menu, on the same principle as the accounts route:
      // a `cli:<runner>` handoff would START AN AGENT in the checkout everything else runs in a
      // worktree to protect. Which app APPLIES is a property of the route, not of one client.
      if (deps.agentCliRunner(target) !== null) {
        return c.json({ error: 'agent CLIs open a task worktree, not the project folder' }, 400);
      }
      if (!deps.detectOpenTargets().some((candidate) => candidate.id === target)) {
        return c.json({ error: `no such app on this machine: ${target}` }, 400);
      }
      const opened = await deps.openApp(target, root);
      if (!opened) return c.json({ error: `could not open ${target}`, path: root }, 409);
      // After the allowlist and the open: a closed label set (see the run route above).
      return c.json({ opened: true as const, path: root });
    });
}
