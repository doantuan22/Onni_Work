import { Hono } from 'hono';\r\nimport { z } from 'zod';\r\nimport { listAgentConfig } from '../../agent-config/service.ts';\r\nimport { findConfigFile } from '../../agent-config/catalog.ts';\r\nimport { readConfigFile, writeConfigFile } from '../../agent-config/files.ts';\r\nimport type { ProjectContext } from '../project-context.ts';\r\nimport { jsonZodValidator } from '../validators.ts';\r\n\r\ntype ProjectApiEnv = { Variables: { project: ProjectContext } };\r\n\r\nexport function createAgentConfigRoutes(deps: {\r\n  capabilities: () => { localHandoff: boolean };\r\n}) {\r\n  const { capabilities } = deps;\r\n\r\n  // Set/clear the agents' config knobs (Settings → Agents; the Repo tab's\r\n  // base-branch picker). Merges into the RAW config.json so user keys
  // (skillsRepos…) survive and schema defaults are never materialized into
  // the file. All fields optional + additive: `null` (and `''` for the
  // R6 keys) clears a knob back to its default.
  const setAgentConfigSchema = z.object({
    content: z.string().max(2_000_000),
    version: z.string().nullable(),
  });

  // ---- chained family: agent-config (project-scoped) -----------------------
  // Agent config is project-scoped (spec #404, adapted to the multi-project
  // route seam from #521): handlers resolve the selected repo through the
  // same ProjectContext as every other mirrored route. Chained (not statements)
  // so `AppType` carries it — see `healthRoutes`.
  const agentConfigRoutes = new Hono<ProjectApiEnv>()
    .get('/agent-config', async (c) => {
      const editable = capabilities().localHandoff;
      return c.json(await listAgentConfig(c.get('project').root, process.env, editable));
    })

    .get('/agent-config/:id', async (c) => {
      const id = c.req.param('id');
      const def = findConfigFile(id);
      if (!def) return c.json({ error: 'unknown config file' }, 404);
      if (def.tracked === 'outside-repo' && !capabilities().localHandoff) {
        return c.json(
          {
            error: 'this file lives in your home directory and is not served in hosted mode (ONNI_REMOTE)',
          },
          409,
        );
      }
      const read = await readConfigFile(id, c.get('project').root);
      if (read === null) return c.json({ error: 'unknown config file' }, 404);
      if ('error' in read) return c.json({ error: read.error }, 500);
      return c.json(read);
    })

    .put('/agent-config/:id', jsonZodValidator(setAgentConfigSchema), async (c) => {
      // Config files may define hooks and MCP commands, so writes remain a
      // local-machine capability and are re-gated on every request.
      if (!capabilities().localHandoff) {
        return c.json(
          {
            error:
              'editing agent config is disabled in hosted mode (ONNI_REMOTE) — edit it from the machine that owns the checkout',
          },
          409,
        );
      }
      const parsed = { data: c.req.valid('json') };
      const out = await writeConfigFile(
        c.req.param('id'),
        parsed.data.content,
        parsed.data.version,
        c.get('project').root,
      );
      if (out === null) return c.json({ error: 'unknown config file' }, 404);
      if (!out.ok) return c.json({ error: out.error }, out.status);
      return c.json(out.read);
    });

  return agentConfigRoutes;
}
