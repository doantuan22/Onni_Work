import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ThreadsPage } from '@onni/contract';
import { RunStore } from '../../runs/store.ts';
import type { RunManager } from '../../workflows/run.ts';
import { clearProjectProbeCache, registerProject } from '../../workspace/projects.ts';
import { apiRequest } from '../loopback-request.testkit.ts';
import { createApp, type ServerDeps } from '../server.ts';
import { computeThreadUnread, matchesStatusFilter } from './workspace-threads.ts';

function storedRun(over: Record<string, unknown> & { id: string; title: string }) {
  return {
    workflow: 'build',
    task: 'do something',
    status: 'done' as const,
    createdAt: '2026-07-14T10:00:00Z',
    tokensUsed: 0,
    archived: false,
    steps: [{ id: 's1', name: 'work', kind: 'agent' as const, status: 'done' as const, iterations: 1, tokensUsed: 0 }],
    ...over,
  };
}

describe('workspace threads route and viewed read receipts', () => {
  const savedHome = process.env.ONNI_HOME;
  const savedDryRun = process.env.ONNI_DRY_RUN;
  let home: string;
  let repoRoot: string;
  let otherRoot: string;
  let store: RunStore;

  beforeEach(() => {
    home = mkdtempSync(join(realpathSync(tmpdir()), 'onni-threads-home-'));
    repoRoot = mkdtempSync(join(realpathSync(tmpdir()), 'onni-threads-boot-'));
    otherRoot = mkdtempSync(join(realpathSync(tmpdir()), 'onni-threads-other-'));
    process.env.ONNI_HOME = home;
    process.env.ONNI_DRY_RUN = '1';
    store = RunStore.open(join(repoRoot, '.ai/onni'));
    clearProjectProbeCache();
  });

  afterEach(() => {
    store.flush();
    for (const dir of [home, repoRoot, otherRoot]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    if (savedHome === undefined) delete process.env.ONNI_HOME;
    else process.env.ONNI_HOME = savedHome;
    if (savedDryRun === undefined) delete process.env.ONNI_DRY_RUN;
    else process.env.ONNI_DRY_RUN = savedDryRun;
  });

  const makeApp = (over: Partial<ServerDeps> = {}) =>
    createApp({ repoRoot, store, manager: {} as RunManager, version: '0.0.0-test', ...over });

  const seedColdProject = (root: string, runs: unknown[]) => {
    mkdirSync(join(root, '.ai/onni'), { recursive: true });
    writeFileSync(join(root, '.ai/onni/runs.json'), JSON.stringify(runs), 'utf8');
  };

  const seedRunEvents = (dataDir: string, runId: string, events: unknown[]) => {
    mkdirSync(join(dataDir, 'runs'), { recursive: true });
    writeFileSync(
      join(dataDir, 'runs', `${runId}.ndjson`),
      events.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf8',
    );
  };

  describe('GET /api/v1/workspace/threads', () => {
    it('answers an empty page when no projects or runs exist', async () => {
      const app = makeApp();
      const res = await apiRequest(app, '/api/v1/workspace/threads');
      expect(res.status).toBe(200);
      const body = (await res.json()) as ThreadsPage;
      expect(body).toEqual({ items: [] });
    });

    it('returns cross-project threads ordered by activity descending', async () => {
      const boot = await registerProject(repoRoot);
      const other = await registerProject(otherRoot);

      const bootRun = store.createRun({ title: 'Boot Task', workflow: 'quick-task', task: 'boot', steps: [] });
      store.updateRun(bootRun.id, { createdAt: '2026-11-10T10:00:00Z', startedAt: '2026-11-10T10:00:00Z' });

      seedColdProject(otherRoot, [
        storedRun({
          id: 'cold-1',
          title: 'Cold Newer Task',
          createdAt: '2026-11-11T12:00:00Z',
          startedAt: '2026-11-11T12:00:00Z',
        }),
      ]);

      const app = makeApp();
      const res = await apiRequest(app, '/api/v1/workspace/threads');
      expect(res.status).toBe(200);
      const body = (await res.json()) as ThreadsPage;

      expect(body.items.length).toBe(2);
      expect(body.items[0]!.runId).toBe('cold-1');
      expect(body.items[0]!.projectId).toBe(other.id);
      expect(body.items[1]!.runId).toBe(bootRun.id);
      expect(body.items[1]!.projectId).toBe(boot.id);
    });

    it('supports cursor pagination across multiple pages without duplicates or holes', async () => {
      await registerProject(repoRoot);
      const ids: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const run = store.createRun({ title: `Task ${i}`, workflow: 'quick-task', task: `t${i}`, steps: [] });
        const time = `2026-11-10T10:0${i}:00Z`;
        store.updateRun(run.id, { createdAt: time, startedAt: time, finishedAt: time });
        ids.push(run.id);
      }
      // Newest activity first: Task 5, 4, 3, 2, 1
      const expectedOrder = [...ids].reverse();

      const app = makeApp();

      // Page 1: limit = 2
      const res1 = await apiRequest(app, '/api/v1/workspace/threads?limit=2');
      expect(res1.status).toBe(200);
      const page1 = (await res1.json()) as ThreadsPage;
      expect(page1.items.map((it) => it.runId)).toEqual([expectedOrder[0], expectedOrder[1]]);
      expect(page1.nextCursor).toBeDefined();

      // Page 2: with cursor
      const res2 = await apiRequest(app, `/api/v1/workspace/threads?limit=2&cursor=${page1.nextCursor}`);
      expect(res2.status).toBe(200);
      const page2 = (await res2.json()) as ThreadsPage;
      expect(page2.items.map((it) => it.runId)).toEqual([expectedOrder[2], expectedOrder[3]]);
      expect(page2.nextCursor).toBeDefined();

      // Page 3: last item
      const res3 = await apiRequest(app, `/api/v1/workspace/threads?limit=2&cursor=${page2.nextCursor}`);
      expect(res3.status).toBe(200);
      const page3 = (await res3.json()) as ThreadsPage;
      expect(page3.items.map((it) => it.runId)).toEqual([expectedOrder[4]]);
      expect(page3.nextCursor).toBeUndefined();
    });

    it('uses projectId to paginate colliding run IDs and activity times (QA7-A04)', async () => {
      const boot = await registerProject(repoRoot);
      const other = await registerProject(otherRoot);
      const run = store.createRun({ title: 'Boot collision', workflow: 'quick-task', task: 'same', steps: [] });
      const timestamp = '2026-11-11T10:00:00Z';
      store.updateRun(run.id, { createdAt: timestamp, startedAt: timestamp });
      seedRunEvents(store.dataDir, run.id, []);
      seedColdProject(otherRoot, [storedRun({ id: run.id, title: 'Other collision', createdAt: timestamp, startedAt: timestamp })]);
      seedRunEvents(join(otherRoot, '.ai/onni'), run.id, []);

      const app = makeApp();
      const firstResponse = await apiRequest(app, '/api/v1/workspace/threads?limit=1');
      const first = (await firstResponse.json()) as ThreadsPage;
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).toBeDefined();
      const secondResponse = await apiRequest(app, `/api/v1/workspace/threads?limit=1&cursor=${first.nextCursor}`);
      const second = (await secondResponse.json()) as ThreadsPage;

      expect([first.items[0]!.projectId, second.items[0]!.projectId].sort()).toEqual([boot.id, other.id].sort());
      expect(second.items[0]!.runId).toBe(run.id);
    });

    it('rejects an invalid cursor with 400', async () => {
      const app = makeApp();
      const res = await apiRequest(app, '/api/v1/workspace/threads?cursor=not-a-valid-cursor');
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid cursor' });
    });

    it('filters by status: normal queries exclude archived runs; asking for archived includes them', async () => {
      await registerProject(repoRoot);
      const active = store.createRun({ title: 'Active Run', workflow: 'quick-task', task: 'act', steps: [] });
      store.updateRun(active.id, { status: 'running' });

      const archived = store.createRun({ title: 'Archived Run', workflow: 'quick-task', task: 'arch', steps: [] });
      store.setArchived(archived.id, true);

      const app = makeApp();

      // Normal query: archived excluded
      const resDefault = await apiRequest(app, '/api/v1/workspace/threads');
      const bodyDefault = (await resDefault.json()) as ThreadsPage;
      expect(bodyDefault.items.map((it) => it.runId)).toEqual([active.id]);

      // Filter by status=archived: only archived included
      const resArchived = await apiRequest(app, '/api/v1/workspace/threads?status=archived');
      const bodyArchived = (await resArchived.json()) as ThreadsPage;
      expect(bodyArchived.items.map((it) => it.runId)).toEqual([archived.id]);

      // Filter by status=running: running included, archived excluded
      const resRunning = await apiRequest(app, '/api/v1/workspace/threads?status=running');
      const bodyRunning = (await resRunning.json()) as ThreadsPage;
      expect(bodyRunning.items.map((it) => it.runId)).toEqual([active.id]);
    });

    it('filters by projectId', async () => {
      const boot = await registerProject(repoRoot);
      const other = await registerProject(otherRoot);

      const bootRun = store.createRun({ title: 'Boot Run', workflow: 'quick-task', task: 'b', steps: [] });
      seedColdProject(otherRoot, [
        storedRun({ id: 'cold-1', title: 'Other Project Run' }),
      ]);

      const app = makeApp();
      const res = await apiRequest(app, `/api/v1/workspace/threads?projectId=${other.id}`);
      const body = (await res.json()) as ThreadsPage;
      expect(body.items.map((it) => it.runId)).toEqual(['cold-1']);
      expect(body.items[0]!.projectId).toBe(other.id);
    });

    it('reports truncatedProjects when a project exceeds 200 runs', async () => {
      const boot = await registerProject(repoRoot);
      const coldRuns: unknown[] = [];
      for (let i = 1; i <= 205; i++) {
        coldRuns.push(storedRun({ id: `cold-${i}`, title: `Run ${i}` }));
      }
      seedColdProject(otherRoot, coldRuns);
      const other = await registerProject(otherRoot);

      const app = makeApp();
      const res = await apiRequest(app, '/api/v1/workspace/threads?limit=10');
      const body = (await res.json()) as ThreadsPage;

      expect(body.truncatedProjects).toContain(other.id);
      expect(body.truncatedProjects).not.toContain(boot.id);
    });

    it('derives preview <= 280 chars cheaply from assistant message events', async () => {
      await registerProject(repoRoot);
      const run = store.createRun({ title: 'Task with preview', workflow: 'quick-task', task: 'p', steps: [] });
      const longMessage = 'A'.repeat(300);

      seedRunEvents(join(repoRoot, '.ai/onni'), run.id, [
        { type: 'item.started', item: { kind: 'message', role: 'user', text: 'Hello' } },
        { type: 'item.completed', item: { kind: 'message', role: 'assistant', text: longMessage } },
      ]);

      const app = makeApp();
      const res = await apiRequest(app, '/api/v1/workspace/threads');
      const body = (await res.json()) as ThreadsPage;
      expect(body.items.length).toBe(1);
      const item = body.items[0]!;
      expect(item.preview).toBeDefined();
      expect(item.preview!.length).toBe(280);
      expect(item.preview).toBe('A'.repeat(280));
    });

    it('handles workerCount and parentRunId for direct dispatched children', async () => {
      await registerProject(repoRoot);
      const parent = store.createRun({ title: 'Parent Task', workflow: 'quick-task', task: 'parent', steps: [] });
      const child1 = store.createRun({ title: 'Child 1', workflow: 'quick-task', task: 'c1', steps: [] });
      const child2 = store.createRun({ title: 'Child 2', workflow: 'quick-task', task: 'c2', steps: [] });

      store.updateRun(child1.id, { dispatch: { rootRunId: parent.id, parentRunId: parent.id } });
      store.updateRun(child2.id, { dispatch: { rootRunId: parent.id, parentRunId: parent.id } });

      const app = makeApp();
      const res = await apiRequest(app, '/api/v1/workspace/threads');
      const body = (await res.json()) as ThreadsPage;

      const parentItem = body.items.find((it) => it.runId === parent.id)!;
      const child1Item = body.items.find((it) => it.runId === child1.id)!;

      expect(parentItem.workerCount).toBe(2);
      expect(parentItem.parentRunId).toBeUndefined();

      expect(child1Item.workerCount).toBe(0);
      expect(child1Item.parentRunId).toBe(parent.id);
    });

    it('accurately identifies awaitingAsk from awaitingAnswerSince, pendingAsk, and softAsk', async () => {
      await registerProject(repoRoot);
      const runAskSince = store.createRun({ title: 'Ask Since', workflow: 'quick-task', task: '1', steps: [] });
      store.updateRun(runAskSince.id, { awaitingAnswerSince: '2026-11-10T12:00:00Z', status: 'failed' });

      const runPendingAsk = store.createRun({ title: 'Pending Ask', workflow: 'quick-task', task: '2', steps: [] });
      store.updateRun(runPendingAsk.id, {
        dispatch: {
          rootRunId: runPendingAsk.id,
          pendingAsk: { questions: ['Proceed?'], askedAt: '2026-11-10T12:00:00Z' },
        },
      });

      const runSoftAsk = store.createRun({ title: 'Soft Ask', workflow: 'quick-task', task: '3', steps: [] });
      store.updateRun(runSoftAsk.id, {
        dispatch: {
          rootRunId: runSoftAsk.id,
          softAsk: { requestId: 'req-1', askedAt: '2026-11-10T12:00:00Z', question: 'Choice?', optionCount: 2 },
        },
      });

      const runNormal = store.createRun({ title: 'Normal Run', workflow: 'quick-task', task: '4', steps: [] });

      const app = makeApp();
      const res = await apiRequest(app, '/api/v1/workspace/threads');
      const body = (await res.json()) as ThreadsPage;

      expect(body.items.find((it) => it.runId === runAskSince.id)!.awaitingAsk).toBe(true);
      expect(body.items.find((it) => it.runId === runPendingAsk.id)!.awaitingAsk).toBe(true);
      expect(body.items.find((it) => it.runId === runSoftAsk.id)!.awaitingAsk).toBe(true);
      expect(body.items.find((it) => it.runId === runNormal.id)!.awaitingAsk).toBe(false);
    });

    it('refuses path traversal via RunRecord.id from a cold project runs.json (QA7-A01)', async () => {
      await registerProject(otherRoot);
      mkdirSync(join(otherRoot, '.ai/onni/runs'), { recursive: true });

      // Write an event-like file outside `.ai/onni/runs/`
      writeFileSync(
        join(otherRoot, '.ai/onni/secret.ndjson'),
        JSON.stringify({
          type: 'item.completed',
          item: { kind: 'message', role: 'assistant', text: 'LEAKED_OUTSIDE_RUNS_PREVIEW' },
        }) + '\n',
        'utf8',
      );

      seedColdProject(otherRoot, [
        storedRun({
          id: '../secret',
          title: 'Malicious Traversal Run',
        }),
      ]);

      const app = makeApp();
      const res = await apiRequest(app, '/api/v1/workspace/threads');
      expect(res.status).toBe(200);
      const body = (await res.json()) as ThreadsPage;
      expect(body.items).toEqual([]);
    });
  });

  describe('Unread logic (computeThreadUnread)', () => {
    it('marks active/waiting runs unread when lastSeq > lastViewedSeq', () => {
      expect(
        computeThreadUnread({
          status: 'running',
          archived: false,
          lastSeq: 5,
          lastViewedSeq: 2,
        }),
      ).toBe(true);

      expect(
        computeThreadUnread({
          status: 'waiting',
          archived: false,
          lastSeq: 5,
          lastViewedSeq: 5,
        }),
      ).toBe(false);
    });

    it('marks active run unread when lastViewedSeq is undefined but lastSeq > 0', () => {
      expect(
        computeThreadUnread({
          status: 'running',
          archived: false,
          lastSeq: 3,
          lastViewedSeq: undefined,
        }),
      ).toBe(true);
    });

    it('treats finished runs with lastViewedSeq vs lastSeq', () => {
      expect(
        computeThreadUnread({
          status: 'done',
          archived: false,
          finishedAt: '2026-11-10T12:00:00Z',
          lastSeq: 10,
          lastViewedSeq: 9,
        }),
      ).toBe(true);

      expect(
        computeThreadUnread({
          status: 'done',
          archived: false,
          finishedAt: '2026-11-10T12:00:00Z',
          lastSeq: 10,
          lastViewedSeq: 10,
        }),
      ).toBe(false);
    });

    it('falls back to finished-run seenAt semantics when lastViewedSeq is not present', () => {
      const finishedAt = '2026-11-10T12:00:00Z';
      // Unseen finished run is unread
      expect(
        computeThreadUnread({
          status: 'done',
          archived: false,
          finishedAt,
          seenAt: undefined,
        }),
      ).toBe(true);

      // Seen after finishing is read
      expect(
        computeThreadUnread({
          status: 'done',
          archived: false,
          finishedAt,
          seenAt: '2026-11-10T12:05:00Z',
        }),
      ).toBe(false);

      // Seen before finishing is unread
      expect(
        computeThreadUnread({
          status: 'done',
          archived: false,
          finishedAt,
          seenAt: '2026-11-10T11:55:00Z',
        }),
      ).toBe(true);
    });

    it('never marks archived or cancelled runs as unread', () => {
      expect(
        computeThreadUnread({
          status: 'done',
          archived: true,
          lastSeq: 10,
          lastViewedSeq: 2,
        }),
      ).toBe(false);

      expect(
        computeThreadUnread({
          status: 'cancelled',
          archived: false,
          lastSeq: 10,
          lastViewedSeq: 2,
        }),
      ).toBe(false);
    });
  });

  describe('POST /api/v1/p/:projectId/runs/:id/viewed', () => {
    it('stores lastViewedSeq monotonically and returns updated RunRecord', async () => {
      const project = await registerProject(repoRoot);
      const run = store.createRun({ title: 'Task to view', workflow: 'quick-task', task: 'v', steps: [] });

      const app = makeApp();

      // First call with seq = 10
      const res1 = await apiRequest(app, `/api/v1/p/${project.id}/runs/${run.id}/viewed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seq: 10 }),
      });
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as { lastViewedSeq: number };
      expect(body1.lastViewedSeq).toBe(10);
      expect(store.getRun(run.id)?.lastViewedSeq).toBe(10);

      // Second call with seq = 15 (increases)
      const res2 = await apiRequest(app, `/api/v1/p/${project.id}/runs/${run.id}/viewed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seq: 15 }),
      });
      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as { lastViewedSeq: number };
      expect(body2.lastViewedSeq).toBe(15);
      expect(store.getRun(run.id)?.lastViewedSeq).toBe(15);

      // Third call with seq = 5 (lower: monotonic, must NOT decrease)
      const res3 = await apiRequest(app, `/api/v1/p/${project.id}/runs/${run.id}/viewed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seq: 5 }),
      });
      expect(res3.status).toBe(200);
      const body3 = (await res3.json()) as { lastViewedSeq: number };
      expect(body3.lastViewedSeq).toBe(15);
      expect(store.getRun(run.id)?.lastViewedSeq).toBe(15);
    });

    it('works identically under the legacy unprefixed /api/v1/runs/:id/viewed mount', async () => {
      await registerProject(repoRoot);
      const run = store.createRun({ title: 'Unprefixed view', workflow: 'quick-task', task: 'uv', steps: [] });

      const app = makeApp();
      const res = await apiRequest(app, `/api/v1/runs/${run.id}/viewed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seq: 42 }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { lastViewedSeq: number };
      expect(body.lastViewedSeq).toBe(42);
      expect(store.getRun(run.id)?.lastViewedSeq).toBe(42);
    });

    it('returns 404 for an unknown run id', async () => {
      const project = await registerProject(repoRoot);
      const app = makeApp();
      const res = await apiRequest(app, `/api/v1/p/${project.id}/runs/no-such-run/viewed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seq: 1 }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not found' });
    });

    it('returns 400 when body does not satisfy markViewedInputSchema', async () => {
      const project = await registerProject(repoRoot);
      const run = store.createRun({ title: 'Test body validation', workflow: 'quick-task', task: 'tb', steps: [] });

      const app = makeApp();
      // Negative seq
      const resNegative = await apiRequest(app, `/api/v1/p/${project.id}/runs/${run.id}/viewed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seq: -1 }),
      });
      expect(resNegative.status).toBe(400);

      // Missing seq
      const resMissing = await apiRequest(app, `/api/v1/p/${project.id}/runs/${run.id}/viewed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(resMissing.status).toBe(400);
    });
  });
});
