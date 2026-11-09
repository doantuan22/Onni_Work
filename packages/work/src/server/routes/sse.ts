import { join } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { runEventsQuerySchema, runIdParamSchema } from '@onni/contract';
import type { RunEvent } from '../../runs/store.ts';
import { onUsage } from '../../core/process-usage.ts';
import { isV2WireEventType } from '../../runs/ui-event-sink.ts';
import { HistoryCursorError, readEventsAfterLiveCursor, streamRunEvents, validateLiveCursor } from '../../runs/event-history.ts';
import { onTodosChanged, readTodos, type TodoItem } from '../../todos.ts';
import { onRunFrames } from '../run-frames.ts';
import { onRunDeleted, onRunEvent } from '../sse-subscriptions.ts';
import type { ProjectContext } from '../project-context.ts';
import { paramZodValidator, queryZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

export function createSseRoutes(deps: {
  capabilities: () => { followups: boolean };
  streamSSENoBuffer: typeof streamSSE;
}) {
  const { capabilities, streamSSENoBuffer } = deps;
  const sseRoutes = new Hono<ProjectApiEnv>()
    .get(
      '/runs/:id/events',
      paramZodValidator(runIdParamSchema),
      queryZodValidator(runEventsQuerySchema),
      async (c) => {
      const { store, dataDir } = c.get('project');
      const { id } = c.req.valid('param');
      if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
      const query = c.req.valid('query');
      const eventsPath = join(dataDir, 'runs', `${id}.ndjson`);
      if (query.cursor) {
        try {
          await validateLiveCursor(eventsPath, query.cursor);
        } catch (error) {
          if (error instanceof HistoryCursorError) return c.json({ error: error.message }, error.status);
          throw error;
        }
      }
      const lastEventId = Number.parseInt(c.req.header('Last-Event-ID') ?? '', 10);
      const requestedAfter = Math.max(
        query.afterSeq ?? 0,
        Number.isSafeInteger(lastEventId) && lastEventId >= 0 ? lastEventId : 0,
      );
      return streamSSENoBuffer(c, async (stream) => {
        let replaying = true;
        let maxSeq = requestedAfter;
        const buffered: RunEvent[] = [];
        // One endpoint, two SSE event names: v1 lines stay `run-event` (the name
        // the legacy UI listened to — its default branch JSON-dumped unknown
        // types into the transcript, which is why v2 never rode that name; the
        // split outlives the R7 retirement as wire shape); protocol-v2 lines
        // (dotted types, persisted snapshots AND ephemeral coalesced deltas)
        // ride `ui-event`, which only v2-aware clients subscribe to.
        // EventSource ignores names it has no listener for.
        const writeEvent = (event: RunEvent) =>
          stream.writeSSE({
            id: String(event.seq),
            event: isV2WireEventType(event.type) ? 'ui-event' : 'run-event',
            data: JSON.stringify(event),
          });
        const onEvent = (event: RunEvent) => {
          if (replaying) buffered.push(event);
          else void writeEvent(event);
        };
        const offEvent = onRunEvent(store, id, onEvent);
        const offRun = onRunFrames(store, (run, frames) => {
          if (run.id !== id) return;
          void stream.writeSSE({ event: 'run', data: frames.record() });
        });
        stream.onAbort(() => {
          offEvent();
          offRun();
        });

        const replay = query.cursor
          ? await readEventsAfterLiveCursor(eventsPath, query.cursor)
          : { events: streamRunEvents(eventsPath), boundarySeq: 0 };
        maxSeq = Math.max(maxSeq, replay.boundarySeq);
        for await (const event of replay.events) {
          if (stream.aborted) break;
          if (event.seq <= maxSeq) continue;
          await writeEvent(event);
          maxSeq = event.seq;
        }
        replaying = false;
        for (const event of buffered) {
          if (event.seq > maxSeq) await writeEvent(event);
        }
        const run = store.getRun(id);
        if (run) await stream.writeSSE({ event: 'run', data: JSON.stringify(run) });

        while (!stream.aborted) {
          await stream.writeSSE({ event: 'ping', data: '' });
          await stream.sleep(15_000);
        }
      });
    },
    )

    // Global SSE: run-summary updates for the list view + inbox changes.
    // Scoped `/p/:projectId/events` carries that project's stream in today's
    // shape; the legacy unprefixed alias stays bound to the boot project ONLY
    // (spec "Legacy aliases" — widening it would be a silent behavioral break;
    // the all-project stream arrives as `/api/workspace/events` in step 2.8).
    .get('/events', (c) => {
      const { dataDir, store } = c.get('project');
      return streamSSENoBuffer(c, async (stream) => {
        const onDeleted = (id: string) =>
          void stream.writeSSE({
            event: 'run-deleted',
            data: JSON.stringify({ id }),
          });
        const sendTodos = async () => {
          const items: TodoItem[] = await readTodos(dataDir).catch(() => []);
          await stream.writeSSE({ event: 'todos', data: JSON.stringify(items) });
        };
        // Opt-in inbox (#471): subscribing is what creates this project's
        // watcher (step 2.3), so with the capability off we never subscribe —
        // no watcher, no fd. Scoped to this stream's dataDir: another
        // project's todos.json writes never reach this connection.
        const offTodos = capabilities().followups ? onTodosChanged(dataDir, () => void sendTodos()) : () => undefined;
        // Live resource telemetry (#348): the sampler ticks ~every 2 s only
        // while some run has a registered process; each tick is relayed as one
        // `usage` message (runId → {cpuPct, rssBytes, procCount}). Never
        // persisted — the NDJSON transcripts stay usage-free. The sampler is
        // module-global, so a snapshot carries EVERY project's runs — split it
        // by ownership and relay only this project's rows, never a stamped
        // whole (multi-project spec, step 2.4: filtered, not stamped).
        const offUsage = onUsage((usage) => {
          const owned: typeof usage = {};
          for (const [runId, sample] of Object.entries(usage)) {
            if (store.getRun(runId)) owned[runId] = sample;
          }
          void stream.writeSSE({ event: 'usage', data: JSON.stringify(owned) });
        });
        const offRun = onRunFrames(store, (_run, frames) => void stream.writeSSE({ event: 'run', data: frames.record() }));
        const offDeleted = onRunDeleted(store, onDeleted);
        stream.onAbort(() => {
          offRun();
          offDeleted();
          offTodos();
          offUsage();
        });
        while (!stream.aborted) {
          await stream.writeSSE({ event: 'ping', data: '' });
          await stream.sleep(15_000);
        }
      });
    });

  return sseRoutes;
}
