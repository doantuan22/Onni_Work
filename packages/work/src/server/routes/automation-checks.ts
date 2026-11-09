import { Hono, type MiddlewareHandler } from 'hono';
import { automationTemplatesOf } from '../../automations/templates.ts';
import { queryZodValidator } from '../validators.ts';
import { z } from 'zod';

export type ManualCheck = {
  id: string;
  automationId: string;
  mode: 'preview' | 'execute';
  status: 'queued' | 'running' | 'complete' | 'error';
  createdAt: string;
  completedAt?: string;
  matches?: number;
  truncated?: boolean;
  error?: string;
};

type AutomationTemplateProjects = Parameters<typeof automationTemplatesOf>[0];

type AutomationChecksRouteDeps = {
  requireAutomations: MiddlewareHandler;
  listProjects: () => Promise<AutomationTemplateProjects>;
  manualChecks: Map<string, ManualCheck>;
};

export function createAutomationChecksRoutes(deps: AutomationChecksRouteDeps) {
  const { requireAutomations, listProjects, manualChecks } = deps;
  // ---- chained family: manual automation checks (workspace-level) ----
  // Workspace-level because the handler reads no project: a check lives in the server-memory map
  // above, keyed by an unguessable id that the project-scoped POST hands back. Mounting it under
  // `/api/v1/p/:projectId` too would be a second spelling of a lookup that consults no project.
  return new Hono()
    .use('/automation-checks/*', requireAutomations)
    .use('/workspace/automation-templates', requireAutomations)
    // The editor's "From your other projects" palette (spec 2026-09-14 Q7): every OTHER
    // registered project's definitions, read-only, from their own stores. Workspace-level
    // because it reads the registry, not the calling project.
    .get('/workspace/automation-templates', queryZodValidator(z.object({ exclude: z.string().optional() })), async (c) => {
      const exclude = c.req.valid('query').exclude;
      // The registry, not the calling project; an unreadable workspace answers an empty palette.
      const projects = await listProjects().catch(() => []);
      return c.json({ templates: automationTemplatesOf(projects, exclude) });
    })
    .get('/automation-checks/:checkId', (c) => {
      const check = manualChecks.get(c.req.param('checkId'));
      return check ? c.json(check) : c.json({ error: 'not found' }, 404);
    });
}
