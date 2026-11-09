import { mkdir, unlink, writeFile } from 'node:fs/promises';\r\nimport { join, resolve, sep } from 'node:path';\r\nimport { Hono } from 'hono';\r\nimport { parse as parseYaml, stringify as stringifyYaml } from 'yaml';\r\nimport { z } from 'zod';\r\nimport type { ProjectContext } from '../project-context.ts';\r\nimport { graphIssues, graphToSteps, NODE_CATALOG, workflowGraphFileSchema, workflowGraphSchema } from '../../workflows/graph.ts';\r\nimport { WORKFLOWS_DIR, loadWorkflows } from '../../workflows/load.ts';\r\nimport { normalizeWorkflowDoc, skillStackOf, skillsToSteps, stepsIssue, workflowFileSchema, workflowStepSchema } from '../../workflows/types.ts';\r\nimport { slugify } from '../../planner.ts';\r\nimport { jsonZodValidator } from '../validators.ts';\r\n\r\ntype ProjectApiEnv = { Variables: { project: ProjectContext } };\r\nconst saveWorkflowSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    // Written into a YAML file on disk (#429) — a workflow description is a
    // short blurb, so a 2k cap is generous without allowing a file-bloat write.
    description: z.string().max(2_000, 'must be at most 2000 characters').optional(),
    steps: z.array(workflowStepSchema).min(1).max(8).optional(),
    skills: z.array(z.string().trim().min(1)).min(1).max(8).optional(),
    overwrite: z.boolean().optional(),
  })
  .refine((b) => Boolean(b.steps) !== Boolean(b.skills), {
    message: 'provide either "steps" or "skills", not both',
  });

const validateGraphSchema = z.object({ graph: workflowGraphSchema });
const saveGraphSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2_000, 'must be at most 2000 characters').optional(),
  graph: workflowGraphSchema,
  overwrite: z.boolean().optional(),
});

const parseWorkflowSchema = z.object({
  yaml: z.string().min(1).max(100_000),
});


export function createWorkflowsRoutes() {
  const workflowsRoutes = new Hono<ProjectApiEnv>()
    .get('/workflows', async (c) => c.json(await loadWorkflows(c.get('project').root)))

    // Save an approved plan as a reusable chain (spec 008): YAML in
    // `.ai/onni/workflows/<slug>.yaml` — from then on it's in the dropdown
    // like any other workflow.
    .post('/workflows', jsonZodValidator(saveWorkflowSchema), async (c) => {
      const { root: repoRoot } = c.get('project');
      const parsed = { data: c.req.valid('json') };
      const steps = parsed.data.steps ?? skillsToSteps(parsed.data.skills ?? []);
      const issue = stepsIssue(steps);
      if (issue) return c.json({ error: issue }, 400);
      const slug = slugify(parsed.data.name) || 'chain';
      const dir = join(repoRoot, WORKFLOWS_DIR);
      const path = join(dir, `${slug}.yaml`);
      // Pure skill stacks are written in the portable compact form (spec 012) —
      // `name` + `skills:` — so the file imports cleanly in any repo.
      const stack = skillStackOf(steps);
      const doc = {
        name: parsed.data.name,
        ...(parsed.data.description ? { description: parsed.data.description } : {}),
        ...(stack ? { skills: stack } : { steps }),
      };
      try {
        await mkdir(dir, { recursive: true });
        // `wx` = fail if the file exists — no silent overwrite of a chain.
        await writeFile(path, stringifyYaml(doc), {
          encoding: 'utf8',
          flag: parsed.data.overwrite ? 'w' : 'wx',
        });
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'EEXIST') {
          return c.json({ error: `workflow file already exists: ${path}`, exists: true }, 409);
        }
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: message }, 500);
      }
      return c.json({ path, name: parsed.data.name }, 201);
    })

    // Delete a saved workflow (spec 012 follow-up): file workflows only —
    // built-ins have no file and always come back.
    .delete('/workflows/:name', async (c) => {
      const { root: repoRoot } = c.get('project');
      const name = c.req.param('name');
      const { workflows } = await loadWorkflows(repoRoot);
      const wf = workflows.find((w) => w.name === name);
      if (!wf) return c.json({ error: `unknown workflow: ${name}` }, 404);
      if (wf.source !== 'file' || !wf.path) {
        return c.json({ error: 'built-in workflows cannot be deleted' }, 400);
      }
      const dir = resolve(repoRoot, WORKFLOWS_DIR);
      const target = resolve(wf.path);
      if (!target.startsWith(dir + sep)) {
        return c.json({ error: 'refusing to delete a file outside the workflows dir' }, 400);
      }
      try {
        await unlink(target);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return c.json({ ok: true, path: target });
    })

    // Graph workflows (spec 2026-09-30-workflow-node-editor): the palette's node catalog, a
    // structural validator the editor calls as you edit, and the `version: 2` save.
    .get('/workflows/nodes', (c) => c.json({ nodes: NODE_CATALOG }))
    .post('/workflows/validate', jsonZodValidator(validateGraphSchema), (c) =>
      c.json({ issues: graphIssues(c.req.valid('json').graph) }),
    )
    .post('/workflows/graph', jsonZodValidator(saveGraphSchema), async (c) => {
      const { root: repoRoot } = c.get('project');
      const body = c.req.valid('json');
      const issues = graphIssues(body.graph);
      if (issues.length) return c.json({ error: issues.join('; ') }, 400);
      const slug = slugify(body.name) || 'workflow';
      const dir = join(repoRoot, WORKFLOWS_DIR);
      const path = join(dir, `${slug}.yaml`);
      const { nodes, edges, layout } = body.graph;
      const doc = {
        version: 2,
        name: body.name,
        ...(body.description ? { description: body.description } : {}),
        nodes,
        edges,
        ...(layout ? { layout } : {}),
      };
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(path, stringifyYaml(doc), { encoding: 'utf8', flag: body.overwrite ? 'w' : 'wx' });
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'EEXIST') {
          return c.json({ error: `workflow file already exists: ${path}`, exists: true }, 409);
        }
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return c.json({ path, name: body.name }, 201);
    })

    // Import support for the builder (spec 012): parse + validate a pasted
    // workflow YAML (either form) and hand back the normalized definition. The
    // server owns YAML parsing — the GUI stays dependency-free.
    .post('/workflows/parse', jsonZodValidator(parseWorkflowSchema), async (c) => {
      const parsed = { data: c.req.valid('json') };
      let raw: unknown;
      try {
        raw = parseYaml(parsed.data.yaml);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: `not valid YAML: ${message}` }, 400);
      }
      const rawVersion = raw && typeof raw === 'object' ? (raw as { version?: unknown }).version : undefined;
      // Accept a quoted `version: "2"` as the same intent as the numeric literal — a hand-edited
      // YAML easily picks up the quotes, and without this it falls through to the v1 parser below
      // with a confusing "missing steps" error instead of a graph validation message.
      if (raw && typeof raw === 'object' && (rawVersion === 2 || rawVersion === '2')) {
        const graphDoc = workflowGraphFileSchema.safeParse({ ...(raw as object), version: 2 });
        if (!graphDoc.success) {
          return c.json({ error: graphDoc.error.issues.map((i) => i.message).join('; ') }, 400);
        }
        const problems = graphIssues(graphDoc.data);
        if (problems.length) return c.json({ error: problems.join('; ') }, 400);
        const { name, description, nodes, edges, layout } = graphDoc.data;
        return c.json({
          name,
          ...(description ? { description } : {}),
          steps: graphToSteps(graphDoc.data),
          graph: { nodes, edges, ...(layout ? { layout } : {}) },
        });
      }
      const doc = workflowFileSchema.safeParse(raw);
      if (!doc.success) {
        return c.json({ error: doc.error.issues.map((i) => i.message).join('; ') }, 400);
      }
      const normalized = normalizeWorkflowDoc(doc.data);
      const issue = stepsIssue(normalized.steps);
      if (issue) return c.json({ error: issue }, 400);
      return c.json(normalized);
    });

  return workflowsRoutes;
}
