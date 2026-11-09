import { Hono, type Context, type Next } from 'hono';
import { AGENT_MODELS_LOCKED_ERROR, agentModelsLocked } from '../../core/agent-model-policy.ts';
import type { ProviderId } from '../../core/provider-auth.ts';
import { RUNNER_IDS } from '../../core/agent-runner.ts';
import { loadConfig } from '../../config.ts';
import { discoverSkills } from '../../skills.ts';
import { loadWorkflows } from '../../workflows/load.ts';
import { QUICK_TASK_WORKFLOW, type WorkflowDef } from '../../workflows/types.ts';
import { markStarted, readTodos, removeTodo, todoTaskText, type TodoItem } from '../../todos.ts';
import { providersRequiredByWorkflow } from '../provider-action-gate.ts';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator } from '../validators.ts';
import { z } from 'zod';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

/** 409 body for the inbox mutators while the follow-up inbox is off (#471). */
const FOLLOWUPS_OFF = 'the follow-up inbox is disabled — set ONNI_FOLLOWUPS=1 to enable it';

// Inbox "▶ Run" body (spec 007 / #401 / #413): every field optional, and the whole body is
// optional too, so an empty POST — every client before the pills and the composer — starts on
// the host's `defaultRunner` with no extra instructions, exactly as before. This is a START
// path, not a continue: there is no prior backend to preserve, so an omitted `runner`/`model`
// means "host default" rather than "keep what the run had". `prompt` (#413) is extra
// instructions appended to the entry's suggested/summary task text; whitespace-only degrades to
// absent so it never touches `task`.
const startTodoSchema = z
  .object({
    runner: z.enum(RUNNER_IDS).optional(),
    model: z.string().max(200).optional(),
    prompt: z
      .string()
      .trim()
      .max(20_000, 'must be at most 20000 characters')
      .optional()
      .transform((s) => (s ? s : undefined)),
  })
  .optional();

/** Hono env for `POST /todos/:id/start`: the guard in front of that route publishes the resolved
 *  entry so the handler does not re-read `todos.json` a second time in the same request. */
type TodoStartEnv = ProjectApiEnv & { Variables: { todo: TodoItem } };

type TodosRouteDeps = {
  capabilities: () => { followups: boolean };
  providerActionError: (required: readonly ProviderId[], scope: { repoRoot: string }) => Promise<string | null>;
};

export function todosRoutes(deps: TodosRouteDeps) {
  /**
   * "The inbox is on and this entry exists" — the 409/404 half of `POST /todos/:id/start`, lifted
   * out of the handler and in FRONT of the body validator.
   *
   * That position is the whole point. The route's contract is that an unknown id 404s before the
   * body is looked at, and Hono only records a body in the route type when it is validated as
   * MIDDLEWARE — which necessarily runs before the handler. Registering this guard first satisfies
   * both: the documented status order is unchanged, and `startTodoSchema` becomes visible to
   * `AppType` (and so to `hc`) instead of being parsed invisibly inside the handler.
   *
   * Deliberately NOT annotated with a return type: the inferred one carries the two typed
   * responses, which is what keeps the 409 and 404 branches in the route's schema for the client.
   */
  const todoMustExist = async (c: Context<TodoStartEnv, '/todos/:id/start'>, next: Next) => {
    if (!deps.capabilities().followups) return c.json({ error: FOLLOWUPS_OFF }, 409);
    const todo = (await readTodos(c.get('project').dataDir)).find((t) => t.id === c.req.param('id'));
    if (!todo) return c.json({ error: 'not found' }, 404);
    c.set('todo', todo);
    await next();
  };

  // ---- chained family: follow-up inbox / todos (project-scoped) ----
  return new Hono<ProjectApiEnv>()
    .get('/todos', async (c) => c.json(deps.capabilities().followups ? await readTodos(c.get('project').dataDir) : []))

    // Check off = delete the entry.
    .delete('/todos/:id', async (c) => {
      const { dataDir } = c.get('project');
      if (!deps.capabilities().followups) return c.json({ error: FOLLOWUPS_OFF }, 409);
      const removed = await removeTodo(dataDir, c.req.param('id'));
      return removed ? c.json({ removed: true }) : c.json({ error: 'not found' }, 404);
    })

    // "▶ Run": turn an inbox entry into a task — a one-off single-step workflow
    // around the suggested skill when it exists, plain quick-task otherwise.
    //
    // TWO middlewares, and their ORDER is the contract. This route's documented status order
    // (pinned by todos-start.test.ts) is that a disabled inbox 409s and an unknown id 404s BEFORE
    // the body is looked at — which is why the body used to be parsed inline, invisible to `hc`.
    // Hono runs route middleware in registration order, so `todoMustExist` FIRST keeps that order
    // exactly while `jsonZodValidator` second is what records the body in the route type.
    //
    // The two no-body cases the old inline parse distinguished are carried by the validator's
    // `absent`/`malformed` options: no body at all is `undefined` (the pre-#401 bodyless POST,
    // which the optional schema accepts → 201), a truncated payload is `null` (which it rejects
    // → 400, rather than passing as "no body" and silently starting a run).
    .post(
      '/todos/:id/start',
      todoMustExist,
      jsonZodValidator(startTodoSchema, { absent: undefined, malformed: null }),
      async (c) => {
        const { root: repoRoot, dataDir, manager } = c.get('project');
        const id = c.req.param('id');
        const todo = c.get('todo');
        const parsed = { data: c.req.valid('json') };
        if (agentModelsLocked(repoRoot) && parsed.data?.model?.trim()) {
          return c.json({ error: AGENT_MODELS_LOCKED_ERROR }, 409);
        }
        if (todo.startedTaskId) return c.json({ error: 'already started' }, 409);

        let task = todoTaskText(todo);
        if (parsed.data?.prompt) task += `\n\n${parsed.data.prompt}`;

        let workflow: WorkflowDef | undefined;
        if (todo.suggestedSkill) {
          const skills = await discoverSkills(repoRoot);
          if (skills.some((s) => s.name === todo.suggestedSkill)) {
            workflow = {
              name: '(inbox)',
              description: `Follow-up from the inbox — skill "${todo.suggestedSkill}"`,
              source: 'built-in',
              steps: [
                {
                  id: 'task',
                  name: 'Do the task',
                  skill: todo.suggestedSkill,
                  prompt: '{{task}}',
                },
              ],
            };
          }
        }
        if (!workflow) {
          const { workflows } = await loadWorkflows(repoRoot);
          workflow = workflows.find((w) => w.name === 'quick-task') ?? QUICK_TASK_WORKFLOW;
        }

        const fallback = parsed.data?.runner ?? (await loadConfig(repoRoot)).defaultRunner;
        const blocked = await deps.providerActionError(providersRequiredByWorkflow(workflow, fallback), { repoRoot });
        if (blocked) return c.json({ error: blocked }, 409);

        const run = manager.startRun(workflow, {
          task,
          runner: parsed.data?.runner,
          model: parsed.data?.model,
        });
        await markStarted(dataDir, id, run.id);
        return c.json({ run }, 201);
      },
    );
}
