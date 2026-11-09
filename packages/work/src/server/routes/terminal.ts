import { Hono } from 'hono';
import {
  detectedUrlsSchema, discoveredCommandsSchema, startAppSetSchema, startAppStateSchema,
  terminalCreateSchema, terminalInputSchema, terminalOutputQuerySchema, terminalOutputSchema,
  terminalResizeSchema, terminalSessionParamsSchema, terminalSessionSchema, terminalStateSchema,
} from '@onni/contract';
import { effectiveStartApp, readStartApp, writeStartApp } from '../../start-app.ts';
import type { RunRecord } from '../../runs/store.ts';
import { readLifecycleConfigOrDefault } from '../../worktree-lifecycle/config.ts';
import { discoverCommands, installCommand } from '../terminal/commands.ts';
import type { DetectedUrls } from '../terminal/detected-urls.ts';
import { processSnapshot } from '../terminal/foreground.ts';
import { loadPty } from '../terminal/pty-module.ts';
import { discoverShells } from '../terminal/shells.ts';
import type { TerminalSessionInfo, TerminalSessions } from '../terminal/sessions.ts';
import type { SocketHub } from '../ws.ts';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator, paramZodValidator, queryZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };
type TerminalCapabilities = { terminal: boolean };

export function createTerminalRouteHelpers(deps: {
  capabilities: () => TerminalCapabilities;
  terminalSessions: TerminalSessions;
  socketHub?: SocketHub;
}) {
  const { capabilities, terminalSessions } = deps;
  /** One refusal sentence for every terminal route, or null when a shell is allowed here. */
  const terminalPolicyRefusal = (caps: ReturnType<typeof capabilities>): string | null =>
    caps.terminal
      ? null
      : 'the terminal is disabled on this cockpit — it is off in hosted mode unless ONNI_TERMINAL=1';

  /** The topic a client subscribes to for "there is new output". Derived, never stored, so the
   *  session id stays the only identity. */
  const terminalTopic = (sessionId: string) => `terminal:${sessionId}`;
  const withTopic = (session: TerminalSessionInfo) => ({ ...session, topic: terminalTopic(session.id) });

  /**
   * Publish a cursor — and ONLY a cursor — whenever a session produces output or exits.
   *
   * The hub's topics are workspace-level and readable by anything the upgrade guard trusts, so
   * nothing that is terminal CONTENT may ride one. A monotonically growing number tells the
   * cockpit "there is more", and it then reads the bytes over the same authenticated HTTP as
   * everything else. The registration disposes itself when the session goes, the way a tracker
   * watch does.
   */
  const registerTerminalTopic = (sessionId: string) => {
    if (!deps.socketHub) return;
    const read = () => ({ cursor: terminalSessions.read(sessionId, Number.MAX_SAFE_INTEGER)?.cursor ?? 0 });
    const remove = deps.socketHub.registerTopic(terminalTopic(sessionId), {
      snapshot: async () => read(),
      start: (publish) => terminalSessions.subscribe(sessionId, () => publish(read())),
    });
    // The registry forgets an exited session a minute later; drop the topic with it rather than
    // leaving a name that answers forever.
    terminalSessions.subscribe(sessionId, () => {
      if (!terminalSessions.get(sessionId)) remove();
    });
  };

  /** The session named by this URL, but only if it really belongs to the run named by this URL. */
  const terminalFor = ({ id, sessionId }: { id: string; sessionId: string }): TerminalSessionInfo | null => {
    const session = terminalSessions.get(sessionId);
    return session && session.runId === id ? session : null;
  };

  return { terminalPolicyRefusal, terminalTopic, withTopic, registerTerminalTopic, terminalFor };
}

export function terminalRoutes(deps: {
  capabilities: () => TerminalCapabilities;
  terminalSessions: TerminalSessions;
  detectedUrls: DetectedUrls;
  workingDirectoryOf: (run: RunRecord, repoRoot: string) => string | null;
  helpers: ReturnType<typeof createTerminalRouteHelpers>;
}) {
  const { capabilities, terminalSessions, detectedUrls, workingDirectoryOf, helpers } = deps;
  /**
   * The workspace terminal (spec `.ai/specs/2026-10-07-task-workspace.md` §6, Milestone 2).
   *
   * Every route answers 409 unless `capabilities().terminal` allows a shell here — policy first,
   * before anything touches a PTY. A session is addressed by id but ALWAYS re-checked against the
   * run in the path, so one task's url can never drive another task's shell.
   *
   * Output is never pushed over the WebSocket. The topic carries a cursor and nothing else; the
   * bytes come back over the same authenticated HTTP as everything else. That keeps terminal
   * content off a workspace-level bus entirely — the hub's topics are single-mount and readable
   * by anything the upgrade guard trusts, and a shell's output is the last thing that should ride one.
   */
  // Keep this as one chained expression so Hono preserves the route types in `AppType`.
  return new Hono<ProjectApiEnv>()
    .get('/runs/:id/terminal', async (c) => {
      const { store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const refusal = helpers.terminalPolicyRefusal(capabilities());
      if (refusal) return c.json(terminalStateSchema.parse({ available: false, reason: refusal, sessions: [] }));
      const binding = await loadPty();
      // One `ps` reading names every tab and answers "is anything running" for all of them.
      terminalSessions.observe(await processSnapshot());
      return c.json(terminalStateSchema.parse({
        available: binding.available,
        ...(binding.available ? {} : { reason: binding.reason }),
        sessions: terminalSessions.listFor(run.id).map(helpers.withTopic),
        // What a new tab may be opened with (spec §6, "shell selection"). Sent only when the PTY
        // is actually available, because a cockpit that cannot open a terminal has no use for a
        // list of shells it cannot spawn.
        ...(binding.available ? { shells: discoverShells() } : {}),
      }));
    })
    .post('/runs/:id/terminal', jsonZodValidator(terminalCreateSchema), async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const refusal = helpers.terminalPolicyRefusal(capabilities());
      if (refusal) return c.json({ error: refusal }, 409);
      // The task's OWN tree or nothing. Falling back to the repo root the way open-in-cli
      // does would put the user in the boot checkout while the header says they are in a task —
      // exactly the "panels must not silently display the boot repo" rule (spec §3.3). A
      // worktree-off task is not that fallback: the repo checkout IS the tree it ran in.
      const cwd = workingDirectoryOf(run, repoRoot);
      if (!cwd) {
        return c.json({ error: 'this task has no worktree to open a terminal in' }, 409);
      }
      const { agent: _agent, ...body } = c.req.valid('json');
      const created = await terminalSessions.create({
        runId: run.id,
        cwd,
        ...body,
      });
      if (!created.ok) return c.json({ error: created.reason }, 409);
      helpers.registerTerminalTopic(created.session.id);
      return c.json(terminalSessionSchema.parse(helpers.withTopic(created.session)), 201);
    })
    .get(
      '/runs/:id/terminal/:sessionId/output',
      paramZodValidator(terminalSessionParamsSchema),
      queryZodValidator(terminalOutputQuerySchema),
      async (c) => {
        const session = helpers.terminalFor(c.req.valid('param'));
        if (!session) return c.json({ error: 'terminal session not found' }, 404);
        // Policy is re-checked on the READ too, not only on create and write: `ONNI_TERMINAL` is
        // read live, so turning it off must stop a session's output being served from under a
        // cockpit that is no longer allowed one — a shell's scrollback is the content this flag
        // exists to withhold.
        const outputRefusal = helpers.terminalPolicyRefusal(capabilities());
        if (outputRefusal) return c.json({ error: outputRefusal }, 409);
        const read = terminalSessions.read(session.id, c.req.valid('query').cursor ?? 0);
        if (!read) return c.json({ error: 'terminal session not found' }, 404);
        c.header('Cache-Control', 'no-store');
        return c.json(terminalOutputSchema.parse(read));
      },
    )
    .post(
      '/runs/:id/terminal/:sessionId/input',
      paramZodValidator(terminalSessionParamsSchema),
      jsonZodValidator(terminalInputSchema),
      async (c) => {
        const session = helpers.terminalFor(c.req.valid('param'));
        if (!session) return c.json({ error: 'terminal session not found' }, 404);
        const refusal = helpers.terminalPolicyRefusal(capabilities());
        if (refusal) return c.json({ error: refusal }, 409);
        // A write to a shell that has already exited is not an error: the client may not have
        // learned about the exit yet, and the exit code is in every output read anyway.
        return c.json({ delivered: terminalSessions.write(session.id, c.req.valid('json').data) });
      },
    )
    .post(
      '/runs/:id/terminal/:sessionId/resize',
      paramZodValidator(terminalSessionParamsSchema),
      jsonZodValidator(terminalResizeSchema),
      async (c) => {
        const session = helpers.terminalFor(c.req.valid('param'));
        if (!session) return c.json({ error: 'terminal session not found' }, 404);
        const resizeRefusal = helpers.terminalPolicyRefusal(capabilities());
        if (resizeRefusal) return c.json({ error: resizeRefusal }, 409);
        const { cols, rows } = c.req.valid('json');
        return c.json({ resized: terminalSessions.resize(session.id, cols, rows) });
      },
    )
    .get('/runs/:id/terminal/urls', async (c) => {
      const { store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      // Probed on read rather than on a timer: the list is only looked at while the drawer is
      // open, and an idle cockpit should cost no connections at all.
      const urls = await detectedUrls.refresh(run.id);
      c.header('Cache-Control', 'no-store');
      return c.json(detectedUrlsSchema.parse({ urls }));
    })
    .get('/runs/:id/terminal/commands', async (c) => {
      const { root: repoRoot, store, dataDir } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      // The task's own tree or nothing: suggesting the boot repo's scripts for a task would
      // offer commands that run against the wrong tree (spec §3.3). Same tree the terminal opens.
      const worktree = workingDirectoryOf(run, repoRoot);
      // A project with its own setup scripts (#1495) prepares its worktrees itself; the automatic
      // install is only for the zero-config project that has none.
      const setupScripts = (await readLifecycleConfigOrDefault(repoRoot)).config.afterCreate.length;
      const [commands, install] = worktree
        ? await Promise.all([discoverCommands(worktree), setupScripts > 0 ? null : installCommand(worktree)])
        : [[], null];
      const recipe = effectiveStartApp(await readStartApp(dataDir, repoRoot));
      return c.json(
        discoveredCommandsSchema.parse({ commands, ...(install ? { install } : {}), ...(recipe ? { recipe } : {}) }),
      );
    })
    // The project's start recipe (spec `2026-10-09-design-mode` §7c): the team's in the repo
    // config, the user's own in their registry entry. Writing one stores a command a terminal will
    // later run, so it is refused wherever the terminal is.
    .get('/start-app', async (c) => {
      const { root, dataDir } = c.get('project');
      return c.json(startAppStateSchema.parse(await readStartApp(dataDir, root)));
    })
    .put('/start-app', jsonZodValidator(startAppSetSchema), async (c) => {
      const refusal = helpers.terminalPolicyRefusal(capabilities());
      if (refusal) return c.json({ error: refusal }, 409);
      const { root, dataDir } = c.get('project');
      const { scope, recipe } = c.req.valid('json');
      try {
        if (!(await writeStartApp(dataDir, root, scope, recipe))) {
          return c.json({ error: 'This project is not in your project list, so it cannot keep a recipe of your own.' }, 409);
        }
      } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'The start recipe could not be saved' }, 409); }
      return c.json(startAppStateSchema.parse(await readStartApp(dataDir, root)));
    })
    // Deliberately NOT policy-gated: stopping a shell is the one terminal action that reduces
    // exposure, and refusing it with the flag off would strand a running process tree with no
    // way to reach it.
    .delete('/runs/:id/terminal/:sessionId', paramZodValidator(terminalSessionParamsSchema), async (c) => {
      const session = helpers.terminalFor(c.req.valid('param'));
      if (!session) return c.json({ error: 'terminal session not found' }, 404);
      terminalSessions.kill(session.id);
      return c.json({ stopped: true });
    });

}
