import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rosterSchema, type TreePlanPart } from '@onni/contract';
import { planPath } from '../dispatch/tree-fs.ts';
import { RunStore, type RunRecord } from '../runs/store.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import { RunManager } from './run.ts';

const run = promisify(execFile);
const GIT_ID = ['-c', 'user.name=test', '-c', 'user.email=test@local'];
const ROSTER = rosterSchema.parse({
  manager: { runner: 'claude' },
  workers: [{ runner: 'codex', model: 'gpt-5', role: 'api' }],
});

/**
 * #6A (plan v2 §10) at the RunManager seam: the access gate, the rules the schema cannot express
 * (roster membership, a `runId` inside the tree, `after` acyclicity), the revision handshake, and
 * `--part` on a dispatch. The plan is DISPLAY state (D6) — nothing here may change how a child is
 * queued, ordered or settled, which is why the dispatch tests assert the child record and never a
 * queue position.
 *
 * A semaphore capped at 0 freezes the queue: a dispatched child is created and never executed, so
 * no agent process is spawned and the test observes only the bookkeeping under test.
 */
describe('the tree plan through RunManager (#6A)', () => {
  let repoRoot: string;
  let dataDir: string;
  let store: RunStore;
  let manager: RunManager;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-tree-plan-'));
    dataDir = join(repoRoot, '.ai/onni');
    for (const key of ['ONNI_DISPATCH', 'ONNI_DRY_RUN', 'ONNI_AUTONAME']) savedEnv[key] = process.env[key];
    process.env.ONNI_DISPATCH = '1';
    process.env.ONNI_DRY_RUN = '1';
    process.env.ONNI_AUTONAME = '0';
    await run('git', ['init', '-q', '-b', 'main'], { cwd: repoRoot });
    writeFileSync(join(repoRoot, 'a.txt'), 'one\n');
    await run('git', ['add', '-A'], { cwd: repoRoot });
    await run('git', [...GIT_ID, 'commit', '-q', '-m', 'base'], { cwd: repoRoot });
    store = RunStore.open(dataDir);
    manager = new RunManager(store, repoRoot, { semaphore: new WorkspaceSemaphore({ initial: { maxParallel: 0 } }) });
  });

  afterEach(() => {
    manager.dispose();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    store.flush();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  /** A root-manager record with no agent behind it — enough for every bookkeeping path. */
  const rootRecord = (): RunRecord => {
    const created = store.createRun({ title: 'manager', workflow: '(planned)', task: 't', steps: [] });
    store.updateRun(created.id, { status: 'running', dispatch: { rootRunId: created.id }, roster: ROSTER });
    return store.getRun(created.id)!;
  };

  const childOf = (root: RunRecord): RunRecord => {
    const created = store.createRun({ title: 'worker', workflow: '(planned)', task: 'w', steps: [] });
    store.updateRun(created.id, { status: 'running', dispatch: { rootRunId: root.id, parentRunId: root.id }, roster: ROSTER });
    return store.getRun(created.id)!;
  };

  const part = (id: string, extra: Partial<TreePlanPart> = {}): TreePlanPart => ({ id, title: `part ${id}`, status: 'planned', ...extra });

  const put = async (rootId: string, parts: TreePlanPart[], revision = '0') => {
    const outcome = await manager.writeTreePlan(rootId, { parts, revision });
    if ('denied' in outcome) throw new Error(outcome.denied);
    return outcome;
  };

  const get = async (rootId: string) => {
    const outcome = await manager.readTreePlan(rootId);
    if ('denied' in outcome) throw new Error(outcome.denied);
    return outcome;
  };

  const notes = (id: string): string[] =>
    store.readEvents(id).filter((event) => event.type === 'note').map((event) => String((event as { message?: unknown }).message ?? ''));

  const ledger = (rootId: string): string => {
    try {
      return readFileSync(join(dataDir, 'dispatch', rootId, 'ledger.jsonl'), 'utf8');
    } catch {
      return '';
    }
  };

  // ---- the file ------------------------------------------------------------------------------

  it('reads as an empty plan before anything was written', async () => {
    const root = rootRecord();
    expect(await get(root.id)).toEqual({ parts: [], updatedAt: '', revision: '0' });
  });

  it('round-trips through plan.json: server-stamped updatedAt, a revision of the parts, a ledger line and a note', async () => {
    const root = rootRecord();
    const written = await put(root.id, [part('p1'), part('p2', { worker: 'codex:gpt-5', after: ['p1'] })]);
    expect(written.revision).not.toBe('0');
    expect(written.updatedAt).not.toBe('');
    expect(await get(root.id)).toEqual(written);

    const onDisk = JSON.parse(readFileSync(planPath(dataDir, root.id), 'utf8')) as { parts: TreePlanPart[] };
    expect(onDisk.parts.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(ledger(root.id)).toContain('"type":"plan"');
    expect(notes(root.id).some((note) => note.startsWith('tree plan written: 2 parts'))).toBe(true);
  });

  it('flattens a title to one line on the way in, and refuses one that cleans to nothing', async () => {
    const root = rootRecord();
    const written = await put(root.id, [part('p1', { title: '## Ship it\nnow' })]);
    expect(written.parts[0]!.title).toBe('Ship it now');
    expect(await manager.writeTreePlan(root.id, { parts: [part('p2', { title: '#' })], revision: written.revision })).toMatchObject({
      status: 400,
      denied: 'plan part "p2" has an empty title after cleaning',
    });
  });

  it('treats a corrupt file as an empty plan, notes it, and refuses --part until it is rewritten', async () => {
    const root = rootRecord();
    mkdirSync(dirname(planPath(dataDir, root.id)), { recursive: true });
    writeFileSync(planPath(dataDir, root.id), '{ not json');
    expect(await get(root.id)).toEqual({ parts: [], updatedAt: '', revision: '0' });
    expect(notes(root.id).some((note) => note.includes('the tree plan could not be read'))).toBe(true);
    expect(await manager.dispatchFromAgent(root.id, { objective: 'x', backend: 'codex', title: 'X', partId: 'p1' })).toMatchObject({
      refused: expect.stringContaining('could not be read'),
    });
    // A hand-rewritten file is a real plan again; its revision is what the next PUT must carry.
    writeFileSync(planPath(dataDir, root.id), JSON.stringify({ parts: [part('p1')], updatedAt: '2026-01-01T00:00:00.000Z', revision: 'ignored' }));
    const reread = await get(root.id);
    expect(reread.parts.map((p) => p.id)).toEqual(['p1']);
    expect(reread.revision).not.toBe('0');
    expect(reread.revision).not.toBe('ignored');
  });

  // ---- the access gate -----------------------------------------------------------------------

  it('refuses a worker, a plain root and an unknown run', async () => {
    const root = rootRecord();
    expect(await manager.readTreePlan(childOf(root).id)).toMatchObject({ status: 403 });
    expect(await manager.writeTreePlan(childOf(root).id, { parts: [], revision: '0' })).toMatchObject({ status: 403 });
    expect(await manager.patchTreePlanPart(childOf(root).id, 'p1', { status: 'done' })).toMatchObject({ status: 403 });

    const plain = store.createRun({ title: 'plain', workflow: '(planned)', task: 't', steps: [] });
    store.updateRun(plain.id, { status: 'running', dispatch: { rootRunId: plain.id } });
    expect(await manager.readTreePlan(plain.id)).toMatchObject({ status: 403 });

    expect(await manager.readTreePlan('nope')).toMatchObject({ status: 404 });
    expect(await manager.patchTreePlanPart('nope', 'p1', { status: 'done' })).toMatchObject({ status: 404 });
  });

  // ---- rules the schema cannot express -------------------------------------------------------

  it('refuses a worker outside the roster, a run outside the tree, and an after-cycle', async () => {
    const root = rootRecord();
    const outside = store.createRun({ title: 'outside', workflow: '(planned)', task: 't', steps: [] });

    expect(await manager.writeTreePlan(root.id, { parts: [part('p1', { worker: 'claude' })], revision: '0' })).toMatchObject({
      status: 400,
      denied: expect.stringContaining('allowed workers: codex:gpt-5'),
    });
    expect(await manager.writeTreePlan(root.id, { parts: [part('p1', { runId: outside.id })], revision: '0' })).toMatchObject({
      status: 409,
      denied: expect.stringContaining('is not part of this task tree'),
    });
    expect(
      await manager.writeTreePlan(root.id, { parts: [part('a', { after: ['b'] }), part('b', { after: ['a'] })], revision: '0' }),
    ).toMatchObject({ status: 400, denied: expect.stringContaining('cycle') });

    // A bare backend name is an allowed worker, and a run INSIDE the tree is normalized to its full id.
    const child = childOf(root);
    const written = await put(root.id, [part('p1', { worker: 'codex', runId: child.id.slice(0, 8) })]);
    expect(written.parts[0]).toMatchObject({ worker: 'codex', runId: child.id });
  });

  it('refuses a stale revision and hands back the current plan, never merges', async () => {
    const root = rootRecord();
    await put(root.id, [part('p1')]);
    expect(await manager.writeTreePlan(root.id, { parts: [part('p2')], revision: '0' })).toMatchObject({
      status: 409,
      denied: 'plan changed in another window',
    });
    expect((await get(root.id)).parts.map((p) => p.id)).toEqual(['p1']);
  });

  // ---- one part at a time --------------------------------------------------------------------

  it('patches one part without touching the others, and validates the patch', async () => {
    const root = rootRecord();
    await put(root.id, [part('p1'), part('p2')]);

    const patched = await manager.patchTreePlanPart(root.id, 'p1', { status: 'done' });
    if ('denied' in patched) throw new Error(patched.denied);
    expect(patched.parts.map((p) => [p.id, p.status])).toEqual([['p1', 'done'], ['p2', 'planned']]);
    expect(ledger(root.id)).toContain('"action":"patch"');

    expect(await manager.patchTreePlanPart(root.id, 'nope', { status: 'done' })).toMatchObject({ status: 404 });
    expect(await manager.patchTreePlanPart(root.id, 'p2', {})).toMatchObject({ status: 400 });
    const outside = store.createRun({ title: 'outside', workflow: '(planned)', task: 't', steps: [] });
    expect(await manager.patchTreePlanPart(root.id, 'p2', { runId: outside.id })).toMatchObject({ status: 409 });

    const child = childOf(root);
    const linked = await manager.patchTreePlanPart(root.id, 'p2', { runId: child.id.slice(0, 8) });
    if ('denied' in linked) throw new Error(linked.denied);
    expect(linked.parts.find((p) => p.id === 'p2')?.runId).toBe(child.id);
    const cleared = await manager.patchTreePlanPart(root.id, 'p2', { runId: '' });
    if ('denied' in cleared) throw new Error(cleared.denied);
    expect(cleared.parts.find((p) => p.id === 'p2')?.runId).toBeUndefined();
  });

  // ---- --part on a dispatch ------------------------------------------------------------------

  it('marks the part assigned with the child id after the dispatch succeeds', async () => {
    const root = rootRecord();
    await put(root.id, [part('p1', { worker: 'codex:gpt-5' }), part('p2')]);

    const outcome = await manager.dispatchFromAgent(root.id, { objective: 'take p1', backend: 'codex', title: 'P one', partId: 'p1' });
    if ('refused' in outcome) throw new Error(outcome.refused);

    expect(store.getRun(outcome.id)?.dispatch).toMatchObject({ rootRunId: root.id, parentRunId: root.id });
    expect((await get(root.id)).parts.find((p) => p.id === 'p1')).toMatchObject({ status: 'assigned', runId: outcome.id });
    expect(notes(root.id).some((note) => note.includes('plan part "p1" → assigned'))).toBe(true);
    expect(ledger(root.id)).toContain('"action":"assign"');
    // D6: the plan is display state — the child's own record is untouched by it.
    expect(store.getRun(outcome.id)?.dispatch?.after).toBeUndefined();
  });

  it('refuses an unknown or settled part BEFORE creating a child', async () => {
    const root = rootRecord();
    await put(root.id, [part('p1'), part('p2', { status: 'done' }), part('p3', { status: 'dropped' })]);
    const before = store.listRuns().length;

    expect(await manager.dispatchFromAgent(root.id, { objective: 'x', backend: 'codex', title: 'X', partId: 'nope' })).toMatchObject({
      refused: expect.stringContaining('does not exist'),
    });
    expect(await manager.dispatchFromAgent(root.id, { objective: 'x', backend: 'codex', title: 'X', partId: 'p2' })).toMatchObject({
      refused: expect.stringContaining('is done'),
    });
    expect(await manager.dispatchFromAgent(root.id, { objective: 'x', backend: 'codex', title: 'X', partId: 'p3' })).toMatchObject({
      refused: expect.stringContaining('is dropped'),
    });
    expect(store.listRuns()).toHaveLength(before);
  });

  it('refuses --part from a worker before anything is created', async () => {
    const root = rootRecord();
    await put(root.id, [part('p1')]);
    const worker = childOf(root);
    const before = store.listRuns().length;
    expect(await manager.dispatchFromAgent(worker.id, { objective: 'x', backend: 'codex', title: 'X', partId: 'p1' })).toMatchObject({
      refused: expect.stringContaining('can assign a plan part'),
    });
    expect(store.listRuns()).toHaveLength(before);
  });

  it('dispatches without --part exactly as before, leaving the plan alone', async () => {
    const root = rootRecord();
    const written = await put(root.id, [part('p1')]);
    const outcome = await manager.dispatchFromAgent(root.id, { objective: 'unplanned', backend: 'codex', title: 'U' });
    if ('refused' in outcome) throw new Error(outcome.refused);
    expect(store.getRun(outcome.id)?.dispatch).toMatchObject({ rootRunId: root.id, parentRunId: root.id });
    expect(await get(root.id)).toEqual(written);
  });
});
