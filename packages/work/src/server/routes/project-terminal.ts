import { Hono } from 'hono';
import {
  terminalCreateSchema, terminalInputSchema, terminalOutputQuerySchema, terminalOutputSchema,
  terminalProjectSessionParamsSchema, terminalResizeSchema, terminalSessionSchema, terminalStateSchema,
} from '@onni/contract';
import { AGENT_COMMAND } from '../terminal/agent-commands.ts';
import { processSnapshot } from '../terminal/foreground.ts';
import { loadPty } from '../terminal/pty-module.ts';
import { discoverShells } from '../terminal/shells.ts';
import { projectTerminalOwner, type TerminalSessions } from '../terminal/sessions.ts';
import type { ProjectContext } from '../project-context.ts';
import type { createTerminalRouteHelpers } from './terminal.ts';
import { jsonZodValidator, paramZodValidator, queryZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

/** The project terminal: shells owned by the PROJECT and opened in its root — a plain terminal
 *  inside the cockpit for running agent CLIs by hand. Its sessions stay isolated from task runs. */
export function projectTerminalRoutes(deps: {
  capabilities: () => { terminal: boolean };
  terminalSessions: TerminalSessions;
  helpers: ReturnType<typeof createTerminalRouteHelpers>;
}) {
  const { capabilities, terminalSessions, helpers } = deps;
  return new Hono<ProjectApiEnv>()
    .get('/terminal', async (c) => {
      const owner = projectTerminalOwner(c.get('project').id);
      const refusal = helpers.terminalPolicyRefusal(capabilities());
      if (refusal) return c.json(terminalStateSchema.parse({ available: false, reason: refusal, sessions: [] }));
      const binding = await loadPty();
      terminalSessions.observe(await processSnapshot());
      return c.json(terminalStateSchema.parse({
        available: binding.available,
        ...(binding.available ? {} : { reason: binding.reason }),
        sessions: terminalSessions.listFor(owner).map(helpers.withTopic),
        ...(binding.available ? { shells: discoverShells() } : {}),
      }));
    })
    .post('/terminal', jsonZodValidator(terminalCreateSchema), async (c) => {
      const project = c.get('project');
      const refusal = helpers.terminalPolicyRefusal(capabilities());
      if (refusal) return c.json({ error: refusal }, 409);
      const { agent, ...body } = c.req.valid('json');
      const created = await terminalSessions.create({
        runId: projectTerminalOwner(project.id),
        cwd: project.root,
        // A fixed tab name for an agent tab, so the process table does not rename it to the shell.
        ...(agent ? { agent, label: agent } : {}),
        ...body,
      });
      if (!created.ok) return c.json({ error: created.reason }, 409);
      helpers.registerTerminalTopic(created.session.id);
      // Typed into the shell rather than spawned in place of it: when the agent exits the tab keeps a prompt.
      if (agent) terminalSessions.write(created.session.id, `${AGENT_COMMAND[agent]}\r`);
      return c.json(terminalSessionSchema.parse(helpers.withTopic(created.session)), 201);
    })
    .get(
      '/terminal/:sessionId/output',
      paramZodValidator(terminalProjectSessionParamsSchema),
      queryZodValidator(terminalOutputQuerySchema),
      async (c) => {
        const session = helpers.terminalFor({
          id: projectTerminalOwner(c.get('project').id),
          sessionId: c.req.valid('param').sessionId,
        });
        if (!session) return c.json({ error: 'terminal session not found' }, 404);
        const refusal = helpers.terminalPolicyRefusal(capabilities());
        if (refusal) return c.json({ error: refusal }, 409);
        const read = terminalSessions.read(session.id, c.req.valid('query').cursor ?? 0);
        if (!read) return c.json({ error: 'terminal session not found' }, 404);
        c.header('Cache-Control', 'no-store');
        return c.json(terminalOutputSchema.parse(read));
      },
    )
    .post(
      '/terminal/:sessionId/input',
      paramZodValidator(terminalProjectSessionParamsSchema),
      jsonZodValidator(terminalInputSchema),
      async (c) => {
        const session = helpers.terminalFor({
          id: projectTerminalOwner(c.get('project').id),
          sessionId: c.req.valid('param').sessionId,
        });
        if (!session) return c.json({ error: 'terminal session not found' }, 404);
        const refusal = helpers.terminalPolicyRefusal(capabilities());
        if (refusal) return c.json({ error: refusal }, 409);
        return c.json({ delivered: terminalSessions.write(session.id, c.req.valid('json').data) });
      },
    )
    .post(
      '/terminal/:sessionId/resize',
      paramZodValidator(terminalProjectSessionParamsSchema),
      jsonZodValidator(terminalResizeSchema),
      async (c) => {
        const session = helpers.terminalFor({
          id: projectTerminalOwner(c.get('project').id),
          sessionId: c.req.valid('param').sessionId,
        });
        if (!session) return c.json({ error: 'terminal session not found' }, 404);
        const refusal = helpers.terminalPolicyRefusal(capabilities());
        if (refusal) return c.json({ error: refusal }, 409);
        const { cols, rows } = c.req.valid('json');
        return c.json({ resized: terminalSessions.resize(session.id, cols, rows) });
      },
    )
    // Not policy-gated, for the reason the task terminal's delete is not.
    .delete('/terminal/:sessionId', paramZodValidator(terminalProjectSessionParamsSchema), async (c) => {
      const session = helpers.terminalFor({
        id: projectTerminalOwner(c.get('project').id),
        sessionId: c.req.valid('param').sessionId,
      });
      if (!session) return c.json({ error: 'terminal session not found' }, 404);
      terminalSessions.kill(session.id);
      return c.json({ stopped: true });
    });
}
