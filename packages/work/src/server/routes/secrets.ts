import { Hono } from 'hono';
import { secretParamsSchema, secretValueInputSchema, type SecretsList, type SecretValueInput } from '@onni/contract';
import type { SecretScopeRef } from '../../workspace/secrets.ts';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator, paramZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

type PutSecretFailure = { status: 400 | 409; error: string } | null;
type DeleteSecretFailure = { status: 404 | 409; error: string } | null;

export function secretsRoutes(deps: {
  secretsList: (scope: SecretScopeRef) => Promise<SecretsList>;
  putSecret: (scope: SecretScopeRef, name: string, input: SecretValueInput) => Promise<PutSecretFailure>;
  deleteSecret: (scope: SecretScopeRef, name: string) => Promise<DeleteSecretFailure>;
  unregisteredSecrets: { error: string };
}) {
  return new Hono<ProjectApiEnv>()
    .get('/secrets', async (c) => {
      const project = c.get('project');
      return c.json(await deps.secretsList({ kind: 'project', projectId: project.id, root: project.root }), 200);
    })
    .put('/secrets/:name', paramZodValidator(secretParamsSchema), jsonZodValidator(secretValueInputSchema), async (c) => {
      const project = c.get('project');
      if (project.id === 'default') return c.json(deps.unregisteredSecrets, 409);
      const failed = await deps.putSecret({ kind: 'project', projectId: project.id, root: project.root }, c.req.valid('param').name, c.req.valid('json'));
      if (failed) return c.json({ error: failed.error }, failed.status);
      return c.body(null, 204);
    })
    .delete('/secrets/:name', paramZodValidator(secretParamsSchema), async (c) => {
      const project = c.get('project');
      if (project.id === 'default') return c.json(deps.unregisteredSecrets, 409);
      const failed = await deps.deleteSecret({ kind: 'project', projectId: project.id, root: project.root }, c.req.valid('param').name);
      if (failed) return c.json({ error: failed.error }, failed.status);
      return c.body(null, 204);
    });
}
