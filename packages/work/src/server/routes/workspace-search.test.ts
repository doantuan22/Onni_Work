import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hc, type InferResponseType } from 'hono/client';
import {
  transcriptSearchPageSchema,
  type TranscriptSearchPage,
} from '@onni/contract';
import { RunStore } from '../../runs/store.ts';
import type { RunManager } from '../../workflows/run.ts';
import { clearProjectProbeCache, registerProject } from '../../workspace/projects.ts';
import { apiRequest } from '../loopback-request.testkit.ts';
import { createApp, type ServerDeps } from '../server.ts';
import type { AppType } from '../app-type.ts';

describe('workspace transcript search API', () => {
  const savedHome = process.env.ONNI_HOME;
  const savedDryRun = process.env.ONNI_DRY_RUN;
  let home: string;
  let repoRoot: string;
  let otherRoot: string;
  let store: RunStore;
  let bootProjectId: string;

  beforeEach(async () => {
    home = mkdtempSync(join(realpathSync(tmpdir()), 'onni-search-api-home-'));
    repoRoot = mkdtempSync(join(realpathSync(tmpdir()), 'onni-search-api-boot-'));
    otherRoot = mkdtempSync(join(realpathSync(tmpdir()), 'onni-search-api-other-'));
    process.env.ONNI_HOME = home;
    process.env.ONNI_DRY_RUN = '1';
    store = RunStore.open(join(repoRoot, '.ai/onni'));
    clearProjectProbeCache();
    bootProjectId = (await registerProject(repoRoot)).id;
  });

  afterEach(() => {
    store.flush();
    for (const dir of [home, repoRoot, otherRoot]) rmSync(dir, { recursive: true, force: true });
    if (savedHome === undefined) delete process.env.ONNI_HOME;
    else process.env.ONNI_HOME = savedHome;
    if (savedDryRun === undefined) delete process.env.ONNI_DRY_RUN;
    else process.env.ONNI_DRY_RUN = savedDryRun;
  });

  const makeApp = (over: Partial<ServerDeps> = {}) =>
    createApp({ repoRoot, store, manager: {} as RunManager, version: '0.0.0-test', ...over });

  it('verifies exact contract response schema type parity', () => {
    const client = hc<AppType>('http://127.0.0.1');
    type Search200 = InferResponseType<
      (typeof client.api.v1.workspace)['search']['$get'],
      200
    >;
    type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : 'route-is-wider') : 'schema-is-wider';
    type Exact<Schema, Route> = Mutual<Schema, Route>;
    type Assert<T extends true> = T;

    type _Check = Assert<Exact<TranscriptSearchPage, Search200>>;
    const check: _Check = true;
    expect(check).toBe(true);
  });

  it('searches transcripts across projects and returns matching snippets', async () => {
    const app = makeApp();

    // Seed run 1 in boot store
    const run1 = store.createRun({
      title: 'Fix auth flow',
      workflow: 'quick-task',
      task: 'Investigate token error',
      steps: [],
    });
    const run1Events = [
      JSON.stringify({ type: 'lifecycle', message: 'Starting task', seq: 1, ts: '2026-11-11T10:00:00Z' }),
      JSON.stringify({ type: 'turn.started', turnId: 'turn_1', seq: 2, ts: '2026-11-11T10:00:01Z' }),
      JSON.stringify({
        type: 'text',
        text: 'Encountered unexpected authentication timeout on handshake',
        seq: 3,
        ts: '2026-11-11T10:00:02Z',
      }),
      JSON.stringify({ type: 'turn.completed', seq: 4, ts: '2026-11-11T10:00:03Z' }),
    ].join('\n') + '\n';
    writeFileSync(join(repoRoot, '.ai/onni/runs', `${run1.id}.ndjson`), run1Events, 'utf8');

    // Seed run 2 in second project
    const otherProject = await registerProject(otherRoot);
    mkdirSync(join(otherRoot, '.ai/onni/runs'), { recursive: true });
    const run2Id = 'run-other-99';
    const otherRunsJson = [
      {
        id: run2Id,
        title: 'Other repo task',
        workflow: 'quick-task',
        task: 'check connections',
        status: 'done',
        createdAt: '2026-11-11T10:30:00Z',
        tokensUsed: 0,
        archived: false,
        steps: [],
      },
    ];
    writeFileSync(join(otherRoot, '.ai/onni/runs.json'), JSON.stringify(otherRunsJson), 'utf8');
    const run2Events = [
      JSON.stringify({ type: 'turn.started', turnId: 'turn_a', seq: 10, ts: '2026-11-11T10:30:00Z' }),
      JSON.stringify({
        type: 'item.completed',
        item: { kind: 'tool', title: 'Ran curl', output: 'Client connection timeout after 30s' },
        seq: 11,
        ts: '2026-11-11T10:30:01Z',
      }),
    ].join('\n') + '\n';
    writeFileSync(join(otherRoot, '.ai/onni/runs', `${run2Id}.ndjson`), run2Events, 'utf8');

    // Cross-project query for "timeout"
    const res = await apiRequest(app, '/api/v1/workspace/search?q=timeout');
    expect(res.status).toBe(200);
    const body = (await res.json()) as TranscriptSearchPage;

    // Conforms to contract schema
    expect(transcriptSearchPageSchema.parse(body)).toEqual(body);
    expect(body.items).toHaveLength(2);

    expect(body.items.find((i) => i.runId === run1.id)).toMatchObject({
      runId: run1.id,
      projectId: bootProjectId,
      seq: 3,
      turnId: 'turn_1',
      snippet: 'Encountered unexpected authentication timeout on handshake',
    });

    expect(body.items.find((i) => i.runId === run2Id)).toMatchObject({
      runId: run2Id,
      projectId: otherProject.id,
      seq: 11,
      turnId: 'turn_a',
      snippet: 'Client connection timeout after 30s',
    });
  });

  it('filters results by projectId and runId', async () => {
    const app = makeApp();

    const runA = store.createRun({
      title: 'Task A',
      workflow: 'quick-task',
      task: 'Task A',
      steps: [],
    });
    const runB = store.createRun({
      title: 'Task B',
      workflow: 'quick-task',
      task: 'Task B',
      steps: [],
    });

    writeFileSync(
      join(repoRoot, '.ai/onni/runs', `${runA.id}.ndjson`),
      JSON.stringify({ type: 'text', text: 'unique needle in task A', seq: 1, ts: '2026-11-11T10:00:00Z' }) + '\n',
    );
    writeFileSync(
      join(repoRoot, '.ai/onni/runs', `${runB.id}.ndjson`),
      JSON.stringify({ type: 'text', text: 'unique needle in task B', seq: 1, ts: '2026-11-11T10:00:00Z' }) + '\n',
    );

    // Filter by runId
    const resRun = await apiRequest(app, `/api/v1/workspace/search?q=needle&runId=${runA.id}`);
    expect(resRun.status).toBe(200);
    const bodyRun = (await resRun.json()) as TranscriptSearchPage;
    expect(bodyRun.items).toHaveLength(1);
    expect(bodyRun.items[0]?.runId).toBe(runA.id);

    // Filter by non-matching runId
    const resNone = await apiRequest(app, '/api/v1/workspace/search?q=needle&runId=no-such-run');
    expect(resNone.status).toBe(200);
    const bodyNone = (await resNone.json()) as TranscriptSearchPage;
    expect(bodyNone.items).toHaveLength(0);

    // Filter by projectId
    const resProj = await apiRequest(app, `/api/v1/workspace/search?q=needle&projectId=${bootProjectId}`);
    expect(resProj.status).toBe(200);
    const bodyProj = (await resProj.json()) as TranscriptSearchPage;
    expect(bodyProj.items).toHaveLength(2);
  });

  it('validates query bounds and rejects malformed requests with 400', async () => {
    const app = makeApp();

    // Missing q
    const res1 = await apiRequest(app, '/api/v1/workspace/search');
    expect(res1.status).toBe(400);

    // Empty q
    const res2 = await apiRequest(app, '/api/v1/workspace/search?q=');
    expect(res2.status).toBe(400);

    // Limit out of bounds
    const res3 = await apiRequest(app, '/api/v1/workspace/search?q=test&limit=0');
    expect(res3.status).toBe(400);

    const res4 = await apiRequest(app, '/api/v1/workspace/search?q=test&limit=51');
    expect(res4.status).toBe(400);

    // Invalid cursor
    const res5 = await apiRequest(app, '/api/v1/workspace/search?q=test&cursor=bad-cursor');
    expect(res5.status).toBe(400);
    expect(await res5.json()).toEqual({ error: 'invalid search cursor' });
  });

  it('supports cursor pagination across requests', async () => {
    const app = makeApp();

    const run = store.createRun({
      title: 'Paging task',
      workflow: 'quick-task',
      task: 'Paging task',
      steps: [],
    });

    writeFileSync(
      join(repoRoot, '.ai/onni/runs', `${run.id}.ndjson`),
      [
        JSON.stringify({ type: 'text', text: 'page item one', seq: 1, ts: '2026-11-11T10:00:00Z' }),
        JSON.stringify({ type: 'text', text: 'page item two', seq: 2, ts: '2026-11-11T10:00:01Z' }),
      ].join('\n') + '\n',
    );

    // First page with limit 1
    const res1 = await apiRequest(app, `/api/v1/workspace/search?q=page%20item&limit=1`);
    expect(res1.status).toBe(200);
    const page1 = (await res1.json()) as TranscriptSearchPage;
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0]?.seq).toBe(1);
    expect(page1.nextCursor).toBeDefined();

    // Second page using nextCursor
    const res2 = await apiRequest(
      app,
      `/api/v1/workspace/search?q=page%20item&limit=1&cursor=${encodeURIComponent(page1.nextCursor!)}`,
    );
    expect(res2.status).toBe(200);
    const page2 = (await res2.json()) as TranscriptSearchPage;
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]?.seq).toBe(2);
    expect(page2.nextCursor).toBeUndefined();
  });
});
