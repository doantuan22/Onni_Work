import { Hono } from 'hono';
import type { WorktreeLifecycleInvalidation } from '@onni/contract';
import type { RunStore } from '../../runs/store.ts';
import { onUsage, currentTimedUsage } from '../../core/process-usage.ts';
import { onTodosChanged, readTodos, type TodoItem } from '../../todos.ts';
import { onRunFrames } from '../run-frames.ts';
import { onRunDeleted } from '../sse-subscriptions.ts';
import type { ProjectContext, ProjectContexts } from '../project-context.ts';
import type { WorkspaceEventName } from '../server.ts';
import { streamSSE } from 'hono/streaming';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

export function createWorkspaceEventsRoutes(deps: {
  bootContext: ProjectContext;
  capabilities: () => { followups: boolean };
  contexts: Pick<ProjectContexts, 'ids' | 'peek' | 'onContextBuilt'>;
  resolveBootProject: () => Promise<string>;
  streamSSENoBuffer: typeof streamSSE;
  workspaceEvents: { on(listener: (event: WorkspaceEventName, data: unknown) => void): () => void };
}) {
  const { bootContext, capabilities, contexts, resolveBootProject, streamSSENoBuffer, workspaceEvents } = deps;
  const workspaceEventsRoutes = new Hono<ProjectApiEnv>()
    .get('/workspace/events', (c) => {
      return streamSSENoBuffer(c, async (stream) => {
        // One detach bundle per attached project — the id guard makes a double
        // attach (connect-time snapshot vs. the built hook) impossible.
        const attached = new Map<string, { store: RunStore; detach: () => void }>();
        const attach = (project: string, ctx: Pick<ProjectContext, 'store' | 'dataDir' | 'manager'>): void => {
          if (attached.has(project)) return;
          const { store, dataDir } = ctx;
          const onDeleted = (id: string) =>
            void stream.writeSSE({
              event: 'run-deleted',
              data: JSON.stringify({ id, project }),
            });
          const sendTodos = async () => {
            const items: TodoItem[] = await readTodos(dataDir).catch(() => []);
            await stream.writeSSE({
              event: 'todos',
              data: JSON.stringify({ project, items }),
            });
          };
          // Same opt-in gate as the per-project stream (#471): no capability, no
          // watcher — and each subscription is scoped to its own dataDir (2.3).
          const offTodos = capabilities().followups ? onTodosChanged(dataDir, () => void sendTodos()) : () => undefined;
          const offRun = onRunFrames(store, (_run, frames) =>
            void stream.writeSSE({ event: 'run', data: frames.workspace(project) }),
          );
          const offLifecycle = ctx.manager.lifecycle?.onChange(event => {
            const payload: WorktreeLifecycleInvalidation = { ...event, projectId: project };
            void stream.writeSSE({ event: 'worktree-lifecycle', data: JSON.stringify(payload) });
          });
          const offDeleted = onRunDeleted(store, onDeleted);
          attached.set(project, {
            store,
            detach: () => {
              offRun();
              offDeleted();
              offTodos();
              offLifecycle?.();
            },
          });
        };

        // The boot context never lives in the lazy map — seed it under its
        // registry id (`resolveBootProject`, NOT `bootContext.id`, which may be
        // the reserved alias when registration was suppressed).
        attach(await resolveBootProject(), bootContext);
        // NB: snapshot + hook subscription happen in one sync block, so no
        // context can slip between them.
        for (const id of contexts.ids()) {
          const ctx = contexts.peek(id);
          if (ctx) attach(ctx.id, ctx);
        }
        const offBuilt = contexts.onContextBuilt((ctx) => attach(ctx.id, ctx));

        // `usage` is FILTERED per project, never a stamped whole (spec "SSE
        // streams"): the module-global sampler's snapshot is split by each
        // attached project's owned runIds, one event per project that has live
        // rows. No event for a row-less project — the workspace stream carries
        // no empty-record clears (that is the per-project streams' contract).
        const offUsage = onUsage((usage) => {
          const rows = Object.entries(usage);
          for (const [project, { store }] of attached) {
            const owned: typeof usage = {};
            for (const [runId, sample] of rows) {
              if (store.getRun(runId)) owned[runId] = sample;
            }
            if (Object.keys(owned).length > 0) {
              void stream.writeSSE({
                event: 'usage',
                data: JSON.stringify({
                  project, usage: owned, sentAt: new Date().toISOString(),
                  samples: Object.keys(owned).flatMap((runId) => {
                    const run = store.getRun(runId);
                    const timed = currentTimedUsage(runId);
                    return timed && run?.status === 'running' && !run.archived
                      ? [{ projectId: project, runId, ...timed }] : [];
                  }),
                }),
              });
            }
          }
        });

        // Workspace-level events (project-added / project-removed /
        // checkout-progress plus host-wide unstamped provider-status) — relayed
        // verbatim under their own names. A removal also drops the project's
        // attach entry: the id guard in `attach` would otherwise pin the
        // DISPOSED context forever, so a project removed and re-added on the
        // same slug would rebuild a fresh context whose events never reach this
        // already-open stream.
        const offWorkspace = workspaceEvents.on((event, data) => {
          if (event === 'project-removed') {
            const removed = (data as { id?: string }).id;
            if (removed !== undefined && attached.has(removed)) {
              attached.get(removed)?.detach();
              attached.delete(removed);
            }
          }
          void stream.writeSSE({ event, data: JSON.stringify(data) });
        });

        stream.onAbort(() => {
          offBuilt();
          offUsage();
          offWorkspace();
          for (const { detach } of attached.values()) detach();
          attached.clear();
        });

        while (!stream.aborted) {
          await stream.writeSSE({ event: 'ping', data: '' });
          await stream.sleep(15_000);
        }
      });
    });

  return workspaceEventsRoutes;
}
