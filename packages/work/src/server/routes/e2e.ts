import { Hono } from 'hono';
import {
  e2eSetupInputSchema,
  type E2eStatus,
  type SecretValueInput,
} from '@onni/contract';
import type { SecretScopeRef } from '../../workspace/secrets.ts';
import {
  E2E_SETUP_TASK,
  e2eCredentialsAmong,
  e2eSetupWorkflow,
  latestE2eSetupRun,
  readE2eStatus,
  setupInFlight,
} from '../../e2e-setup.ts';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

/** One-click e2e setup saves checks credentials and starts a reviewable task (spec 2026-10-10-e2e-one-click-setup). */
export function createE2eRoutes(deps: {
  checkSecretNames: (project: ProjectContext) => Promise<string[]>;
  putSecret: (scope: SecretScopeRef, name: string, input: SecretValueInput) => Promise<{ status: 400 | 409; error: string } | null>;
  unregisteredSecrets: { error: string };
  hasGitRepo: (repoRoot: string) => Promise<boolean>;
  providerActionErrorForWorkflow: (workflow: ReturnType<typeof e2eSetupWorkflow>, repoRoot: string) => Promise<string | null>;
}) {
  return new Hono<ProjectApiEnv>()
    .get('/e2e', async (c) => {
      const project = c.get('project');
      const status: E2eStatus = await readE2eStatus(project.root, project.store.listRuns(), await deps.checkSecretNames(project));
      return c.json(status, 200);
    })
    .post('/e2e/setup', jsonZodValidator(e2eSetupInputSchema), async (c) => {
      const project = c.get('project');
      const { credential } = c.req.valid('json');
      const running = latestE2eSetupRun(project.store.listRuns());
      if (running && setupInFlight(running)) {
        return c.json({ error: `an e2e setup is already in progress (task ${running.id.slice(0, 8)})` }, 409);
      }
      if (!(await deps.hasGitRepo(project.root))) {
        return c.json({ error: 'e2e setup needs a git repository — it runs in its own worktree and finishes as a branch you merge' }, 409);
      }
      if (credential) {
        if (project.id === 'default') return c.json(deps.unregisteredSecrets, 409);
        const failed = await deps.putSecret(
          { kind: 'project', projectId: project.id, root: project.root },
          credential.name,
          { value: credential.value, audiences: ['checks'] },
        );
        if (failed) return c.json({ error: failed.error }, 409);
      }
      const workflow = e2eSetupWorkflow(e2eCredentialsAmong(await deps.checkSecretNames(project)));
      const blocked = await deps.providerActionErrorForWorkflow(workflow, project.root);
      if (blocked) return c.json({ error: blocked }, 409);
      // Keep this non-autonomous so the user's review gate still applies to its branch.
      const run = project.manager.startRun(workflow, { task: E2E_SETUP_TASK });
      return c.json({ runId: run.id }, 201);
    });
}
