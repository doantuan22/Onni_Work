import { secretParamsSchema, secretValueInputSchema, type SecretsList, type SecretValueInput } from '@onni/contract';
import { Hono } from 'hono';
import type { SecretScopeRef } from '../../workspace/secrets.ts';
import { jsonZodValidator, paramZodValidator } from '../validators.ts';

export function createWorkspaceSecretsRoutes(deps: {
  secretsList: (scope: SecretScopeRef) => Promise<SecretsList>;
  putSecret: (scope: SecretScopeRef, name: string, input: SecretValueInput) => Promise<{ status: 400 | 409; error: string } | null>;
  deleteSecret: (scope: SecretScopeRef, name: string) => Promise<{ status: 404 | 409; error: string } | null>;
}) {
  return new Hono()
    // The user's own secrets, shared by every project — an LLM key for onni's own features, a
    // token every project's checks need. Single-mount like every workspace family.
    .get('/workspace/secrets', async (c) => c.json(await deps.secretsList({ kind: 'workspace' }), 200))
    .put('/workspace/secrets/:name', paramZodValidator(secretParamsSchema), jsonZodValidator(secretValueInputSchema), async (c) => {
      const failed = await deps.putSecret({ kind: 'workspace' }, c.req.valid('param').name, c.req.valid('json'));
      if (failed) return c.json({ error: failed.error }, failed.status);
      return c.body(null, 204);
    })
    .delete('/workspace/secrets/:name', paramZodValidator(secretParamsSchema), async (c) => {
      const failed = await deps.deleteSecret({ kind: 'workspace' }, c.req.valid('param').name);
      if (failed) return c.json({ error: failed.error }, failed.status);
      return c.body(null, 204);
    });
}
