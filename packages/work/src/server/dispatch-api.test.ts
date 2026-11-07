import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunStore } from '../runs/store.ts';
import type { RunManager } from '../workflows/run.ts';
import { createApp } from './server.ts';
import { apiRequest } from './loopback-request.testkit.ts';
import { connectedProviderAuth } from './provider-auth.testkit.ts';

/**
 * The dispatch family (spec 2026-09-10-dispatch): both routes are thin over `RunManager.dispatch`
 * and `RunManager.recordReport`, so what is pinned here is the wiring — the gate, the validation,
 * the status codes, and that the manager is called with exactly the validated body.
 */
describe('the dispatch routes', () => {
  let repoRoot: string;
  let store: RunStore;
  let app: Hono;
  let calls: Array<{ kind: 'dispatch' | 'report' | 'peek' | 'verify' | 'memory' | 'ask' | 'plan'; runId: string; body: unknown }>;
  let outcome: { id: string; branch?: string } | { refused: string };
  let reportOk: boolean;
  let budget: Record<string, unknown> | undefined;
  let peek: unknown;
  let verify: unknown = { state: 'passed' };
  let plan: unknown;
  let memory = { content: '', bytes: 0, maxBytes: 3072, revision: '0' };
  let memoryWrite: unknown = memory;
  let memoryAdd: unknown = memory;
  let ask: unknown = { requestId: 'q-1' };
  const savedFlag = process.env.ONNI_DISPATCH;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-dispatch-api-'));
    store = RunStore.open(join(repoRoot, '.ai/onni'));
    calls = [];
    outcome = { id: 'child-1', branch: 'onni/child1' };
    reportOk = true;
    budget = undefined;
    peek = { workers: [], workersOmitted: 0 };
    plan = { parts: [], updatedAt: '', revision: '0' };
    memory = { content: '', bytes: 0, maxBytes: 3072, revision: '0' };
    memoryWrite = memory;
    memoryAdd = memory;
    ask = { requestId: 'q-1' };
    process.env.ONNI_DISPATCH = '1';
    const manager = {
      // The route is thin over `dispatchFromAgent` (it awaits the engine's fork), so the stub is
      // that method — the older `dispatch` name answered 500 here and nothing noticed.
      dispatchFromAgent: async (runId: string, body: unknown) => {
        calls.push({ kind: 'dispatch', runId, body });
        return outcome;
      },
      recordReport: (runId: string, body: unknown) => {
        calls.push({ kind: 'report', runId, body });
        return reportOk;
      },
      dispatchBudgetFor: () => budget,
      peekFor: async (runId: string, body: unknown) => {
        calls.push({ kind: 'peek', runId, body });
        return peek;
      },
      verifyFor: async (runId: string, body: unknown) => {
        calls.push({ kind: 'verify', runId, body });
        return verify;
      },
      readManagerMemory: async () => memory,
      writeManagerMemory: async (body: unknown) => {
        calls.push({ kind: 'memory', runId: 'settings', body });
        return memoryWrite;
      },
      addManagerMemory: async (runId: string, body: unknown) => {
        calls.push({ kind: 'memory', runId, body });
        return memoryAdd;
      },
      askUser: (runId: string, body: unknown) => {
        calls.push({ kind: 'ask', runId, body });
        return ask;
      },
      readTreePlan: async (runId: string) => {
        calls.push({ kind: 'plan', runId, body: { action: 'read' } });
        return plan;
      },
      writeTreePlan: async (runId: string, body: unknown) => {
        calls.push({ kind: 'plan', runId, body });
        return plan;
      },
      patchTreePlanPart: async (runId: string, partId: string, body: unknown) => {
        calls.push({ kind: 'plan', runId, body: { partId, ...(body as object) } });
        return plan;
      },
    } as unknown as RunManager;
    app = createApp({ repoRoot, store, manager, version: '0.0.0-test', providerAuth: connectedProviderAuth() });
  });

  afterEach(() => {
    if (savedFlag === undefined) delete process.env.ONNI_DISPATCH;
    else process.env.ONNI_DISPATCH = savedFlag;
    store.flush();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('creates a child through the manager and answers its id and branch', async () => {
    const res = await apiRequest(app, '/api/v1/runs/parent-1/dispatch', json({ objective: 'take the flank', max_cost: 2 }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'child-1', branch: 'onni/child1' });
    expect(calls).toEqual([{ kind: 'dispatch', runId: 'parent-1', body: { objective: 'take the flank', max_cost: 2 } }]);
  });

  it('answers a refusal as 409 with the reason', async () => {
    outcome = { refused: 'no budget left' };
    const res = await apiRequest(app, '/api/v1/runs/parent-1/dispatch', json({ objective: 'x' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'no budget left' });
  });

  it('400s an order with an unknown key — a misspelled cap is a brake that did not fire', async () => {
    const res = await apiRequest(app, '/api/v1/runs/parent-1/dispatch', json({ objective: 'x', max_costs: 2 }));
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('records a report and answers ok; 404 for a run outside any tree', async () => {
    const report = { status: 'done', result: 'all green', evidence: ['npm test → 3 passed'], verdict: 'approve' };
    const res = await apiRequest(app, '/api/v1/runs/child-1/report', json(report));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ kind: 'report', runId: 'child-1' });
    expect(calls[0]?.body).toMatchObject({ ...report, side_effects: [], errors: [], suggestions: [] });
    reportOk = false;
    expect((await apiRequest(app, '/api/v1/runs/plain/report', json(report))).status).toBe(404);
  });

  it('returns the tree budget for any run id, and 404 for one the manager does not know', async () => {
    budget = { costUsd: 3.2, tokens: 120_000, minutes: null, steps: 800, subtasks: 2, subtaskCap: 8, maxDepth: 1, overBudget: false };
    const res = await apiRequest(app, '/api/v1/runs/child-1/budget');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(budget);
    budget = undefined;
    expect((await apiRequest(app, '/api/v1/runs/ghost/budget')).status).toBe(404);
  });

  it('passes peek query through validated, and maps the manager’s denial status unchanged', async () => {
    const res = await apiRequest(app, '/api/v1/runs/root/peek?target=abcd1234&tail=5');
    expect(res.status).toBe(200);
    expect(calls[0]).toEqual({ kind: 'peek', runId: 'root', body: { target: 'abcd1234', tail: 5 } });
    expect(await res.json()).toEqual({ workers: [], workersOmitted: 0 });

    calls = [];
    await apiRequest(app, '/api/v1/runs/root/peek');
    await apiRequest(app, '/api/v1/runs/root/peek?all=1&tail=3');
    expect(calls.map((call) => call.body)).toEqual([{}, { all: true, tail: 3 }]);

    calls = [];
    peek = { denied: 'only the manager of a manager–worker task can peek at this task tree', status: 403 };
    const forbidden = await apiRequest(app, '/api/v1/runs/worker/peek');
    expect(forbidden.status).toBe(403);
    peek = { denied: 'run 12345678 belongs to another task tree', status: 409 };
    expect((await apiRequest(app, '/api/v1/runs/root/peek?target=other')).status).toBe(409);
    peek = { denied: 'no such run: ghost', status: 404 };
    expect((await apiRequest(app, '/api/v1/runs/root/peek?target=ghost')).status).toBe(404);
  });

  it('400s a peek whose tail is outside the cap, before touching the manager', async () => {
    const res = await apiRequest(app, '/api/v1/runs/root/peek?tail=99');
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('forwards a non-blocking ask with its options and timeout, and maps a refusal unchanged', async () => {
    const res = await apiRequest(app, '/api/v1/runs/root/ask', json({
      question: 'Postgres or SQLite?',
      options: [{ label: 'Postgres', description: 'the deployed one' }, { label: 'SQLite' }],
      timeoutMinutes: 30,
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requestId: 'q-1' });
    expect(calls).toEqual([{
      kind: 'ask',
      runId: 'root',
      body: { question: 'Postgres or SQLite?', options: [{ label: 'Postgres', description: 'the deployed one' }, { label: 'SQLite' }], timeoutMinutes: 30 },
    }]);

    ask = { denied: 'only the manager of a manager–worker task can ask the user', status: 403 };
    expect((await apiRequest(app, '/api/v1/runs/worker/ask', json({ question: 'x' }))).status).toBe(403);
    ask = { denied: 'one open question per task — answer the current one first', status: 409 };
    expect((await apiRequest(app, '/api/v1/runs/root/ask', json({ question: 'x' }))).status).toBe(409);
  });

  it('400s an ask the schema refuses before touching the manager', async () => {
    for (const body of [
      { question: '   ' },
      { question: 'x', timeoutMinutes: 0 },
      { question: 'x', timeoutMinutes: 1_441 },
      { question: 'x', options: Array.from({ length: 11 }, (_, index) => ({ label: `option ${index}` })) },
      { question: 'x', options: [{ label: '   ' }] },
    ]) {
      expect((await apiRequest(app, '/api/v1/runs/root/ask', json(body))).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('reads, replaces and patches the tree plan, passing exactly the validated body', async () => {
    const saved = {
      parts: [{ id: 'p1', title: 'Parse the config', status: 'planned', worker: 'codex' }],
      updatedAt: '2026-11-03T10:00:00.000Z',
      revision: 'abcd1234',
    };
    plan = saved;
    const send = (method: string, body: unknown) => ({
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const read = await apiRequest(app, '/api/v1/runs/root/plan');
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(saved);

    const put = await apiRequest(app, '/api/v1/runs/root/plan', send('PUT', { parts: saved.parts, revision: 'abcd1234' }));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual(saved);

    const patch = await apiRequest(app, '/api/v1/runs/root/plan/parts/p1', send('PATCH', { status: 'assigned', runId: 'child-1' }));
    expect(patch.status).toBe(200);
    expect(await patch.json()).toEqual(saved);

    expect(calls).toEqual([
      { kind: 'plan', runId: 'root', body: { action: 'read' } },
      { kind: 'plan', runId: 'root', body: { parts: saved.parts, revision: 'abcd1234' } },
      { kind: 'plan', runId: 'root', body: { partId: 'p1', status: 'assigned', runId: 'child-1' } },
    ]);
  });

  it('maps a plan refusal status unchanged, and 400s a structurally invalid plan first', async () => {
    for (const [denied, status] of [
      ['only the manager of a manager–worker task can read the tree plan', 403],
      ['no such run', 404],
      ['plan changed in another window', 409],
    ] as const) {
      plan = { denied, status };
      const res = await apiRequest(app, '/api/v1/runs/worker/plan');
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: denied });
    }
    calls = [];
    const put = (body: unknown) => apiRequest(app, '/api/v1/runs/root/plan', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect((await put({ parts: [{ id: 'p1', title: 'a', status: 'planned' }, { id: 'p1', title: 'b', status: 'planned' }], revision: '0' })).status).toBe(400);
    expect((await put({ parts: [{ id: 'p1', title: 'a', status: 'planned', after: ['ghost'] }], revision: '0' })).status).toBe(400);
    expect((await put({ parts: [{ id: 'p1', title: 'a', status: 'paused' }], revision: '0' })).status).toBe(400);
    expect((await apiRequest(app, '/api/v1/runs/root/plan/parts/p1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('passes --part through the dispatch body, so the server can assign it after creating the child', async () => {
    const res = await apiRequest(app, '/api/v1/runs/root/dispatch', json({ objective: 'take the flank', partId: 'p1' }));
    expect(res.status).toBe(201);
    expect(calls).toEqual([{ kind: 'dispatch', runId: 'root', body: { objective: 'take the flank', partId: 'p1' } }]);
  });

  it('passes the verify body through validated and maps the manager’s denial status unchanged', async () => {
    verify = { state: 'passed' };
    const ok = await apiRequest(app, '/api/v1/runs/root/verify', json({ target: 'abcd1234', only: ['npm test'], baseline: true }));
    expect(ok.status).toBe(200);
    expect(calls[0]).toEqual({ kind: 'verify', runId: 'root', body: { target: 'abcd1234', only: ['npm test'], baseline: true } });
    for (const status of [400, 403, 404, 409]) {
      verify = { denied: 'no', status };
      expect((await apiRequest(app, '/api/v1/runs/root/verify', json({ target: 'abcd1234' }))).status).toBe(status);
    }
    const before = calls.length;
    expect((await apiRequest(app, '/api/v1/runs/root/verify', json({}))).status).toBe(400);
    expect((await apiRequest(app, '/api/v1/runs/root/verify', json({ target: 'a', command: 'rm -rf /' }))).status).toBe(400);
    expect((await apiRequest(app, '/api/v1/runs/root/verify', json({ target: 'a', only: Array.from({ length: 11 }, () => 'x') }))).status).toBe(400);
    expect(calls).toHaveLength(before);
  });

  it('answers 409 on both routes while ONNI_DISPATCH=0, before touching the manager', async () => {
    process.env.ONNI_DISPATCH = '0';
    app = createApp({ repoRoot, store, manager: {} as RunManager, version: '0.0.0-test', providerAuth: connectedProviderAuth() });
    for (const path of ['/api/v1/runs/p/dispatch', '/api/v1/runs/p/report', '/api/v1/runs/p/budget', '/api/v1/runs/p/peek', '/api/v1/runs/p/verify', '/api/v1/runs/p/ask']) {
      const res = await apiRequest(app, path, json({ objective: 'x', status: 'done', result: 'r', question: 'q' }));
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toMatch(/^dispatch is disabled on this cockpit \(ONNI_DISPATCH=0\).*stop and report/);
    }
    const add = await apiRequest(app, '/api/v1/runs/p/memory', json({ entry: 'a lesson' }));
    expect(add.status).toBe(409);
    for (const [method, path] of [['GET', '/plan'], ['PUT', '/plan'], ['PATCH', '/plan/parts/p1']] as const) {
      const res = await apiRequest(app, `/api/v1/runs/p${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify({}) }),
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toMatch(/^dispatch is disabled on this cockpit \(ONNI_DISPATCH=0\)/);
    }
  });

  it('reads and writes project memory through the manager, settings-side and ungated', async () => {
    memory = { content: '- a lesson\n', bytes: 11, maxBytes: 3072, revision: 'abcd1234' };
    const read = await apiRequest(app, '/api/v1/manager-memory');
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(memory);

    const put = await apiRequest(app, '/api/v1/manager-memory', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '- two lessons\n', revision: 'abcd1234' }),
    });
    expect(put.status).toBe(200);
    expect(calls[0]).toEqual({ kind: 'memory', runId: 'settings', body: { content: '- two lessons\n', revision: 'abcd1234' } });

    // The section must still be readable and editable with dispatch off — memory is a project
    // setting, not a dispatch command.
    process.env.ONNI_DISPATCH = '0';
    expect((await apiRequest(app, '/api/v1/manager-memory')).status).toBe(200);
  });

  it('maps a memory write’s 409 and 400 unchanged, and passes the current file on 409', async () => {
    memoryWrite = { ok: false, status: 409, error: 'memory changed in another window', current: memory };
    const stale = await apiRequest(app, '/api/v1/manager-memory', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'x', revision: 'stale' }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'memory changed in another window', current: memory });

    memoryWrite = { ok: false, status: 400, error: 'memory is 4000 bytes; the limit is 3072' };
    const tooBig = await apiRequest(app, '/api/v1/manager-memory', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'x', revision: '0' }),
    });
    expect(tooBig.status).toBe(400);
    expect(await tooBig.json()).toEqual({ error: 'memory is 4000 bytes; the limit is 3072' });
  });

  it('appends a lesson for a running task and maps the manager’s denial unchanged', async () => {
    memory = { content: '- a lesson\n', bytes: 31, maxBytes: 3072, revision: 'ef567890' };
    memoryAdd = memory;
    const ok = await apiRequest(app, '/api/v1/runs/root/memory', json({ entry: '## a lesson' }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(memory);
    expect(calls[0]).toEqual({ kind: 'memory', runId: 'root', body: { entry: '## a lesson' } });

    memoryAdd = { denied: 'only the manager of a manager–worker task can write project memory', status: 403 };
    expect((await apiRequest(app, '/api/v1/runs/worker/memory', json({ entry: 'x' }))).status).toBe(403);
    memoryAdd = { denied: 'memory is full — ask the user to prune it in Settings', status: 409 };
    expect((await apiRequest(app, '/api/v1/runs/root/memory', json({ entry: 'x' }))).status).toBe(409);
  });

  it('400s a memory entry the schema refuses before touching the manager', async () => {
    const res = await apiRequest(app, '/api/v1/runs/root/memory', json({ entry: '   ' }));
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });
});
