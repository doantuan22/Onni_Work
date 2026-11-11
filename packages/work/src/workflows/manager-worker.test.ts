import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rosterSchema, type Roster } from '@onni/contract';
import { protectedByLiveTree, reclaimWorktrees, selectReclaimableWorktrees } from '../runs/retention.ts';
import { RunStore, type RunRecord } from '../runs/store.ts';
import { WorkspaceSemaphore, type WorkspaceResourceLimits } from '../workspace/semaphore.ts';
import { COMPLEXITY, managerDoingComplexAlone, managerPrompt, resolveWorker } from './manager-worker.ts';
import { RunManager } from './run.ts';
import type { WorkflowDef } from './types.ts';

const run = promisify(execFile);
const GIT_ID = ['-c', 'user.name=test', '-c', 'user.email=test@local'];
const STEP: WorkflowDef = { name: '(planned)', source: 'built-in', steps: [{ id: 'task', name: 'Task', prompt: '{{task}}' }] };

const ROSTER: Roster = rosterSchema.parse({
  manager: { runner: 'claude', model: 'opus' },
  workers: [
    { runner: 'claude', model: 'haiku', role: 'quick edits', maxConcurrent: 1 },
    { runner: 'claude', model: 'sonnet', role: 'careful refactors', maxConcurrent: 2 },
    { runner: 'pi', role: 'docs' },
  ],
});

describe('resolveWorker (pure)', () => {
  it('maps an order onto exactly one entry, or says why not', () => {
    expect(resolveWorker(ROSTER, { runner: 'pi' })).toMatchObject({ ok: true, runner: 'pi', model: undefined });
    expect(resolveWorker(ROSTER, { runner: 'pi', model: 'any-model' })).toMatchObject({ ok: true, model: 'any-model', key: 'pi:' });
    expect(resolveWorker(ROSTER, { runner: 'claude', model: 'haiku' })).toMatchObject({ ok: true, key: 'claude:haiku' });
    expect(resolveWorker(ROSTER, { runner: 'claude', model: 'sonnet' })).toMatchObject({ ok: true, key: 'claude:sonnet' });
  });
  it('refuses an unlisted backend, an unlisted model, an ambiguous one and an unnamed one', () => {
    expect(resolveWorker(ROSTER, { runner: 'cursor' })).toMatchObject({ refused: expect.stringContaining('allowed workers: claude (haiku)') });
    expect(resolveWorker(ROSTER, { runner: 'claude', model: 'opus' })).toMatchObject({ refused: expect.stringContaining('not an allowed worker') });
    expect(resolveWorker(ROSTER, { runner: 'claude' })).toMatchObject({ refused: expect.stringContaining('--model') });
    expect(resolveWorker(ROSTER, {})).toMatchObject({ refused: expect.stringContaining('--backend') });
  });
  it('a single worker needs no --backend', () => {
    const solo = rosterSchema.parse({ manager: { runner: 'claude' }, workers: [{ runner: 'codex', model: 'gpt-5' }] });
    expect(resolveWorker(solo, {})).toMatchObject({ ok: true, runner: 'codex', model: 'gpt-5' });
    expect(resolveWorker(solo, { runner: 'codex', model: 'other' })).toMatchObject({ refused: expect.any(String) });
  });
});

describe('manager–worker engine (dry-run)', () => {
  let repoRoot: string;
  let store: RunStore;
  let manager: RunManager;
  let semaphore: WorkspaceSemaphore;
  const started: string[] = [];
  const saved: Record<string, string | undefined> = {};

  const boot = (limits: Partial<WorkspaceResourceLimits> = {}) => {
    manager?.dispose();
    semaphore = new WorkspaceSemaphore({ initial: { maxParallel: 4, maxMonitoringSessions: 0, ...limits } });
    manager = new RunManager(store, repoRoot, { semaphore });
  };

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-manager-worker-'));
    for (const key of ['ONNI_DRY_RUN', 'ONNI_DISPATCH', 'ONNI_WEBHOOKS', 'ONNI_MOCK_STDIN_FILE']) saved[key] = process.env[key];
    delete process.env.ONNI_WEBHOOKS;
    process.env.ONNI_DRY_RUN = '1';
    process.env.ONNI_DISPATCH = '1';
    await run('git', ['init', '-q', '-b', 'main'], { cwd: repoRoot });
    writeFileSync(join(repoRoot, 'a.txt'), 'one\n');
    await run('git', ['add', '-A'], { cwd: repoRoot });
    await run('git', [...GIT_ID, 'commit', '-q', '-m', 'base'], { cwd: repoRoot });
    store = RunStore.open(join(repoRoot, '.ai/onni'));
    boot();
    started.length = 0;
  });

  afterEach(async () => {
    for (const id of started) manager.cancel(id);
    const deadline = Date.now() + 10_000;
    while (store.listRuns().some(({ id }) => manager.isActive(id)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    manager.dispose();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    store.flush();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const waitFor = async (id: string, pred: (r: RunRecord | undefined) => boolean, ms = 25_000) => {
    const deadline = Date.now() + ms;
    while (!pred(store.getRun(id))) {
      if (Date.now() > deadline) throw new Error(`condition not met for ${id}: ${store.getRun(id)?.status}`);
      await new Promise((r) => setTimeout(r, 40));
    }
  };
  const startManager = (task = 'mock:monitoring manage', roster: Roster = ROSTER, extra: Record<string, unknown> = {}) => {
    const r = manager.startRun(STEP, { task, roster, limits: { mode: 'none' }, ...extra });
    started.push(r.id);
    return r;
  };
  const parked = async (task?: string) => {
    const r = startManager(task);
    await waitFor(r.id, (x) => x?.activity === 'monitoring');
    return r;
  };
  const ok = async (parentId: string, objective: string, extra: Record<string, unknown> = {}) => {
    const out = await manager.dispatchFromAgent(parentId, { objective, ...extra });
    if ('refused' in out) throw new Error(`refused: ${out.refused}`);
    started.push(out.id);
    return out;
  };
  const refused = async (parentId: string, objective: string, extra: Record<string, unknown> = {}) => {
    const out = await manager.dispatchFromAgent(parentId, { objective, ...extra });
    if (!('refused' in out)) throw new Error('expected a refusal');
    return out.refused;
  };

  it('a manager takes the roster\'s manager backend and model, gets a worktree, and is the tree root', async () => {
    const r = startManager();
    expect(r.runner).toBe('claude');
    expect(r.model).toBe('opus');
    expect(r.roster?.workers).toHaveLength(3);
    expect(r.dispatch).toEqual({ rootRunId: r.id });
    await waitFor(r.id, (x) => x?.worktreePath !== undefined);
    expect(existsSync(store.getRun(r.id)!.worktreePath!)).toBe(true);
  }, 40_000);

  it('allows a listed worker and refuses a backend outside the roster, naming the allowed list', async () => {
    const m = await parked();
    const good = await ok(m.id, 'mock:done write docs', { backend: 'pi', title: 'docs' });
    expect(store.getRun(good.id)).toMatchObject({ runner: 'pi', dispatch: { workerKey: 'pi:', parentRunId: m.id } });
    // The worker's record carries no dispatch-teaching prompt (it gets the report-only brief at session start).
    expect(store.getRun(good.id)!.systemPrompt).toBeUndefined();
    const reason = await refused(m.id, 'mock:done nope', { backend: 'cursor', title: 'nope' });
    expect(reason).toContain('cursor is not an allowed worker');
    expect(reason).toContain('allowed workers:');
    expect(reason).toContain('pi — docs');
    expect(store.listRuns().filter((x) => x.dispatch?.parentRunId === m.id)).toHaveLength(1);
    // The same fence answers through the old name.
    expect(await refused(m.id, 'mock:done nope', { runner: 'cursor', title: 'nope2' })).toContain('not an allowed worker');
    expect(await refused(m.id, 'x', { runner: 'pi', backend: 'claude', model: 'haiku' })).toContain('disagree');
  }, 60_000);

  it('tells two entries on one backend apart by model', async () => {
    const m = await parked();
    const quick = await ok(m.id, 'mock:done a', { backend: 'claude', model: 'haiku', title: 'a' });
    const careful = await ok(m.id, 'mock:done b', { backend: 'claude', model: 'sonnet', title: 'b' });
    expect(store.getRun(quick.id)).toMatchObject({ runner: 'claude', model: 'haiku', dispatch: { workerKey: 'claude:haiku' } });
    expect(store.getRun(careful.id)).toMatchObject({ model: 'sonnet', dispatch: { workerKey: 'claude:sonnet' } });
    expect(await refused(m.id, 'mock:done c', { backend: 'claude', model: 'opus', title: 'c' })).toContain('claude with model opus is not an allowed worker');
    expect(await refused(m.id, 'mock:done d', { backend: 'claude', title: 'd' })).toContain('several worker entries');
  }, 60_000);

  it('a worker may not dispatch further (depth 1) even to a listed backend', async () => {
    const m = await parked();
    const worker = await ok(m.id, 'mock:monitoring worker', { backend: 'claude', model: 'haiku', title: 'w' });
    await waitFor(worker.id, (x) => x?.activity === 'monitoring');
    expect(await refused(worker.id, 'mock:done more', { backend: 'pi', title: 'deeper' })).toContain('depth is capped at 1');
  }, 60_000);

  it('forks from the manager\'s uncommitted work: a labelled WIP commit lands first, whatever ONNI_AUTOSAVE says', async () => {
    delete process.env.ONNI_AUTOSAVE;
    const m = await parked();
    const wt = store.getRun(m.id)!.worktreePath!;
    writeFileSync(join(wt, 'wip.txt'), 'half done\n');
    const child = await ok(m.id, 'mock:done pick it up', { backend: 'pi', title: 'pick up' });
    const { stdout: log } = await run('git', ['log', '--format=%s', '-3'], { cwd: wt });
    expect(log).toContain('onni: wip before dispatch');
    const childBase = store.getRun(child.id)!.baseBranch!;
    const { stdout: tree } = await run('git', ['ls-tree', '--name-only', childBase], { cwd: repoRoot });
    expect(tree).toContain('wip.txt');
    // A clean worktree makes no empty commit.
    const before = (await run('git', ['rev-list', '--count', 'HEAD'], { cwd: wt })).stdout.trim();
    await ok(m.id, 'mock:done again', { backend: 'pi', title: 'again' });
    expect((await run('git', ['rev-list', '--count', 'HEAD'], { cwd: wt })).stdout.trim()).toBe(before);
  }, 60_000);

  it('refuses the dispatch — and creates no child — when the WIP cannot be committed', async () => {
    const m = await parked();
    const wt = store.getRun(m.id)!.worktreePath!;
    writeFileSync(join(wt, 'a.txt'), '<<<<<<< ours\none\n=======\ntwo\n>>>>>>> theirs\n');
    const reason = await refused(m.id, 'mock:done fork', { backend: 'pi', title: 'fork' });
    expect(reason).toContain('could not be committed before forking');
    expect(store.listRuns().some((x) => x.dispatch?.parentRunId === m.id)).toBe(false);
    expect(store.readEvents(m.id).some((e) => String((e as { message?: unknown }).message ?? '').includes('could not be committed'))).toBe(true);
  }, 60_000);

  it('refuses the dispatch when another git process holds the index (index.lock), without touching the worktree or creating a child', async () => {
    const m = await parked();
    const wt = store.getRun(m.id)!.worktreePath!;
    const gitDir = (await run('git', ['rev-parse', '--absolute-git-dir'], { cwd: wt })).stdout.trim();
    const lock = join(gitDir, 'index.lock');
    writeFileSync(join(wt, 'half-written.txt'), 'partial conte');
    writeFileSync(lock, '');
    try {
      const reason = await refused(m.id, 'mock:done fork', { backend: 'pi', title: 'fork' });
      expect(reason).toContain('could not be committed before forking');
      expect(store.listRuns().some((x) => x.dispatch?.parentRunId === m.id)).toBe(false);
      // Nothing was damaged: the lock is still the other process's, and the file is untouched and uncommitted.
      expect(existsSync(lock)).toBe(true);
      expect(readFileSync(join(wt, 'half-written.txt'), 'utf8')).toBe('partial conte');
      const { stdout: status } = await run('git', ['status', '--porcelain'], { cwd: wt }).catch(() => ({ stdout: '??' }));
      expect(status).toContain('half-written.txt');
    } finally {
      rmSync(lock, { force: true });
    }
    // Once the other process lets go, the same dispatch goes through and the WIP is committed.
    const child = await ok(m.id, 'mock:done fork', { backend: 'pi', title: 'fork' });
    const { stdout: tree } = await run('git', ['ls-tree', '--name-only', store.getRun(child.id)!.baseBranch!], { cwd: repoRoot });
    expect(tree).toContain('half-written.txt');
  }, 60_000);

  it.each([1, 2])('maxParallel=%i: a monitoring manager does not starve its workers or deadlock', async (maxParallel) => {
    boot({ maxParallel, maxMonitoringSessions: 0 });
    const stdinFile = join(repoRoot, 'mock-stdin.ndjson');
    process.env.ONNI_MOCK_STDIN_FILE = stdinFile;
    const m = startManager('mock:pause plan the work', ROSTER, { autonomous: true });
    await waitFor(m.id, () => existsSync(stdinFile) && readFileSync(stdinFile, 'utf8').includes('plan the work'));
    // Dispatched from INSIDE the manager's turn, as an agent's `onni task create` would.
    const a = await ok(m.id, 'mock:done first', { backend: 'claude', model: 'sonnet', title: 'first' });
    const b = await ok(m.id, 'mock:done second', { backend: 'claude', model: 'haiku', title: 'second' });
    await waitFor(m.id, (x) => x?.activity === 'monitoring');
    await waitFor(a.id, (x) => x?.status === 'done' || x?.status === 'review', 40_000);
    await waitFor(b.id, (x) => x?.status === 'done' || x?.status === 'review', 40_000);
  }, 120_000);

  it.each([1, 2, 3])('capacity at maxParallel=%i: three workers run at the cap, the manager holds a slot only while its turn runs', async (maxParallel) => {
    boot({ maxParallel, maxMonitoringSessions: 0 });
    const wide: Roster = rosterSchema.parse({ manager: { runner: 'claude', model: 'opus' }, workers: [{ runner: 'claude', model: 'haiku', role: 'any', maxConcurrent: 3 }] });
    const stdinFile = join(repoRoot, 'mock-stdin.ndjson');
    process.env.ONNI_MOCK_STDIN_FILE = stdinFile;
    const busy = () => (manager as unknown as { busySlots(): number }).busySlots();
    const m = startManager('mock:pause plan the work', wide, { autonomous: true });
    await waitFor(m.id, () => existsSync(stdinFile) && readFileSync(stdinFile, 'utf8').includes('plan the work'));
    // Phase A — the manager's turn is running and it dispatches three workers.
    const kids = [] as string[];
    for (let i = 0; i < 3; i += 1) kids.push((await ok(m.id, `mock:pause mock:done part ${i}`, { backend: 'claude', model: 'haiku', title: `part ${i}` })).id);
    const turnSlots = busy();
    // Phase B — the turn ends, the manager parks as a monitor; sample until every worker has settled.
    let parkedSlots: number | undefined;
    let maxRunning = 0;
    const deadline = Date.now() + 100_000;
    const settled = (id: string) => ['done', 'review', 'failed', 'cancelled'].includes(store.getRun(id)?.status ?? '');
    while (!kids.every(settled)) {
      if (Date.now() > deadline) throw new Error('workers did not finish: ' + kids.map((id) => store.getRun(id)?.status).join(','));
      if (store.getRun(m.id)?.activity === 'monitoring') {
        parkedSlots ??= busy() - kids.filter((id) => store.getRun(id)?.status === 'running').length;
        maxRunning = Math.max(maxRunning, kids.filter((id) => store.getRun(id)?.status === 'running').length);
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    // eslint-disable-next-line no-console
    console.log(`CAPACITY maxParallel=${maxParallel} managerSlotsDuringTurn=${turnSlots} managerSlotsParked=${parkedSlots} maxWorkersRunning=${maxRunning}`);
    expect(turnSlots).toBe(1);
    expect(parkedSlots).toBe(0);
    expect(maxRunning).toBeLessThanOrEqual(maxParallel);
    expect(maxRunning).toBeGreaterThanOrEqual(1);
    expect(kids.every((id) => ['done', 'review'].includes(store.getRun(id)!.status))).toBe(true);
  }, 150_000);

  it('maxConcurrent is per roster entry: the second task of a full entry waits while others start', async () => {
    const stdinFile = join(repoRoot, 'mock-stdin.ndjson');
    process.env.ONNI_MOCK_STDIN_FILE = stdinFile;
    const m = startManager('mock:pause plan the work', ROSTER, { autonomous: true });
    await waitFor(m.id, () => existsSync(stdinFile) && readFileSync(stdinFile, 'utf8').includes('plan the work'));
    // haiku allows ONE at a time; sonnet two.
    const h1 = await ok(m.id, 'mock:pause mock:done slow one', { backend: 'claude', model: 'haiku', title: 'h1' });
    const h2 = await ok(m.id, 'mock:pause mock:done slow two', { backend: 'claude', model: 'haiku', title: 'h2' });
    const s1 = await ok(m.id, 'mock:pause mock:done other', { backend: 'claude', model: 'sonnet', title: 's1' });
    await waitFor(h1.id, (x) => x?.status === 'running');
    await waitFor(s1.id, (x) => x?.status === 'running');
    // While h1 occupies its entry, h2 keeps its place in the queue; sonnet is unaffected.
    expect(store.getRun(h2.id)!.status).toBe('queued');
    await waitFor(h1.id, (x) => ['done', 'review', 'failed', 'cancelled'].includes(x?.status ?? ''), 40_000);
    await waitFor(h2.id, (x) => x?.status !== 'queued', 40_000);
  }, 120_000);

  it('notes a manager that finished without delegating, once', async () => {
    const m = startManager('mock:done I will do it myself', ROSTER, { autonomous: true });
    await waitFor(m.id, (x) => x?.status === 'done' || x?.status === 'review', 40_000);
    const finished = store.getRun(m.id)!;
    expect(finished.managerDidNotDelegate).toBe(true);
    const notes = store.readEvents(m.id).filter((e) => String((e as { message?: unknown }).message ?? '').includes('manager did not delegate'));
    expect(notes).toHaveLength(1);
  }, 60_000);

  it('does not note it when the manager delegated', async () => {
    const m = await parked();
    await ok(m.id, 'mock:done piece', { backend: 'pi', title: 'p' });
    expect(store.getRun(m.id)!.managerDidNotDelegate).toBeUndefined();
  }, 60_000);

  describe('Full quyền manager: the merge permission is checked on the server', () => {
    const commitInWorker = async (id: string, file: string) => {
      await waitFor(id, (x) => x?.worktreePath !== undefined);
      const wt = store.getRun(id)!.worktreePath!;
      writeFileSync(join(wt, file), `${file}\n`);
      await run('git', ['add', '-A'], { cwd: wt });
      await run('git', [...GIT_ID, 'commit', '-q', '-m', `add ${file}`], { cwd: wt });
    };

    it('refuses with a clear message while the permission is off, and logs the refusal', async () => {
      const m = await parked();
      const out = await manager.mergeFromAgent(m.id, { into: 'task', source: 'whatever' });
      expect(out).toEqual({ denied: expect.stringContaining('Manager chưa được cấp quyền merge') });
      expect(store.readEvents(m.id).some((e) => e.type === 'note' && String((e as { message?: string }).message).includes('merge refused'))).toBe(true);
    }, 60_000);

    it('a worker can never merge, even in a tree whose manager may', async () => {
      const m = startManager('mock:monitoring manage', ROSTER, { managerFullAccess: true });
      await waitFor(m.id, (x) => x?.activity === 'monitoring');
      const w = await ok(m.id, 'mock:monitoring work', { backend: 'claude', model: 'haiku', title: 'w' });
      expect(await manager.mergeFromAgent(w.id, { into: 'base' })).toEqual({ denied: expect.stringContaining('only the manager') });
    }, 80_000);

    it('with the permission on: merges a worker branch into the task branch, then the task branch into the local base, and audits both', async () => {
      writeFileSync(join(repoRoot, '.git', 'info', 'exclude'), '.ai/\n', { flag: 'a' });
      const m = startManager('mock:monitoring manage', ROSTER, { managerFullAccess: true });
      expect(store.getRun(m.id)!.managerFullAccess).toBe(true);
      await waitFor(m.id, (x) => x?.activity === 'monitoring');
      const w = await ok(m.id, 'mock:monitoring work', { backend: 'claude', model: 'haiku', title: 'w' });
      await commitInWorker(w.id, 'from-worker.txt');

      expect(await manager.mergeFromAgent(m.id, { into: 'task', source: 'not-a-worker' })).toEqual({ denied: expect.stringContaining('is not a worker of this task') });
      const first = await manager.mergeFromAgent(m.id, { into: 'task', source: w.id.slice(0, 8) });
      expect(first).toMatchObject({ outcome: 'merged' });
      expect(existsSync(join(store.getRun(m.id)!.worktreePath!, 'from-worker.txt'))).toBe(true);

      const second = await manager.mergeFromAgent(m.id, { into: 'base' });
      expect(second).toMatchObject({ outcome: 'merged' });
      expect(existsSync(join(repoRoot, 'from-worker.txt'))).toBe(true);
      const notes = store.readEvents(m.id).map((e) => String((e as { message?: string }).message ?? ''));
      expect(notes.filter((n) => n.startsWith('merge (')).length).toBe(2);
    }, 120_000);
  });

  describe('--after: ordering dependent work', () => {
    it('holds a dependent queued until the order it depends on has finished, then starts it on that branch', async () => {
      const m = await parked();
      const first = await ok(m.id, 'mock:monitoring first', { backend: 'claude', model: 'haiku', title: 'first' });
      await waitFor(first.id, (x) => x?.activity === 'monitoring');
      const second = await ok(m.id, 'mock:done second', { backend: 'claude', model: 'sonnet', title: 'second', after: ['first'] });
      expect(store.getRun(second.id)!.dispatch?.after).toEqual([first.id]);
      expect(store.getRun(second.id)!.baseBranch).toBe(store.getRun(first.id)!.branch);
      // The other worker entry is free and a slot exists, yet the dependent does not start.
      await new Promise((r) => setTimeout(r, 600));
      expect(store.getRun(second.id)!.status).toBe('queued');
      expect(store.getRun(second.id)!.task).toContain('Starts after: first');
    }, 80_000);

    it('runs the dependent after a successful predecessor, in order', async () => {
      const m = await parked();
      const first = await ok(m.id, 'mock:done first', { backend: 'claude', model: 'haiku', title: 'first' });
      const second = await ok(m.id, 'mock:done second', { backend: 'claude', model: 'sonnet', title: 'second', after: [first.id.slice(0, 8)] });
      await waitFor(second.id, (x) => x?.status === 'done' || x?.status === 'review');
      expect(Date.parse(store.getRun(second.id)!.startedAt ?? '')).toBeGreaterThanOrEqual(Date.parse(store.getRun(first.id)!.finishedAt ?? ''));
    }, 80_000);

    it('cancels the dependent with the reason when its predecessor fails, instead of leaving it queued forever', async () => {
      const m = await parked();
      const first = await ok(m.id, 'mock:monitoring first', { backend: 'claude', model: 'haiku', title: 'first' });
      await waitFor(first.id, (x) => x?.activity === 'monitoring');
      const second = await ok(m.id, 'mock:done second', { backend: 'claude', model: 'sonnet', title: 'second', after: ['first'] });
      manager.cancel(first.id);
      await waitFor(second.id, (x) => x?.status === 'cancelled');
      expect(store.getRun(second.id)!.error).toContain('blocked');
      expect(store.getRun(second.id)!.error).toContain('first');
    }, 80_000);

    it('waits for every predecessor and starts only after both have finished', async () => {
      const m = await parked();
      const a = await ok(m.id, 'mock:monitoring A', { backend: 'claude', model: 'haiku', title: 'A' });
      const b = await ok(m.id, 'mock:monitoring B', { backend: 'claude', model: 'sonnet', title: 'B' });
      await Promise.all([
        waitFor(a.id, (x) => x?.activity === 'monitoring'),
        waitFor(b.id, (x) => x?.activity === 'monitoring'),
      ]);
      expect(store.getRun(a.id)!.status).toBe('running');
      expect(store.getRun(b.id)!.status).toBe('running');

      const busyBefore = semaphore.busy();
      const c = await ok(m.id, 'mock:monitoring C', { backend: 'claude', model: 'haiku', title: 'C', after: ['A', 'B'] });
      expect(store.getRun(c.id)!.dispatch?.after).toEqual([a.id, b.id]);
      expect(store.getRun(c.id)!.status).toBe('queued');
      // A dependency wait must not consume one of the workspace's run slots.
      expect(semaphore.busy()).toBe(busyBefore);

      expect(manager.sendMessage(a.id, [{ type: 'text', text: 'mock:done A finished' }])).toBe(true);
      await waitFor(a.id, (x) => x?.status === 'done' || x?.status === 'review');
      expect(store.getRun(b.id)!.status).toBe('running');
      expect(store.getRun(c.id)!.status).toBe('queued');

      expect(manager.sendMessage(b.id, [{ type: 'text', text: 'mock:done B finished' }])).toBe(true);
      await waitFor(b.id, (x) => x?.status === 'done' || x?.status === 'review');
      await waitFor(c.id, (x) => x?.activity === 'monitoring');
      expect(store.getRun(c.id)!.status).toBe('running');
    }, 100_000);

    it('uses the first dependency as the fork point and names the other branch in the task order', async () => {
      const m = await parked();
      const a = await ok(m.id, 'mock:monitoring A', { backend: 'claude', model: 'haiku', title: 'A' });
      const b = await ok(m.id, 'mock:monitoring B', { backend: 'claude', model: 'sonnet', title: 'B' });
      await Promise.all([
        waitFor(a.id, (x) => x?.activity === 'monitoring'),
        waitFor(b.id, (x) => x?.activity === 'monitoring'),
      ]);

      const forward = await ok(m.id, 'mock:monitoring combine A and B', { backend: 'pi', title: 'forward', after: ['A', 'B'] });
      const reverse = await ok(m.id, 'mock:monitoring combine B and A', { backend: 'pi', title: 'reverse', after: ['B', 'A'] });
      const runA = store.getRun(a.id)!;
      const runB = store.getRun(b.id)!;
      const runForward = store.getRun(forward.id)!;
      const runReverse = store.getRun(reverse.id)!;

      expect(runForward.baseBranch).toBe(runA.branch);
      expect(runReverse.baseBranch).toBe(runB.branch);
      // A is the fork point; the order still gives the worker B's branch to merge.
      expect(runForward.task).toContain(`Starts after: A (${a.id.slice(0, 8)}, branch ${runA.branch}), B (${b.id.slice(0, 8)}, branch ${runB.branch})`);
    }, 80_000);

    it('cancels C with a reason naming B when B fails', async () => {
      const m = await parked();
      const a = await ok(m.id, 'mock:monitoring A', { backend: 'claude', model: 'haiku', title: 'A' });
      const b = await ok(m.id, 'mock:monitoring B', { backend: 'claude', model: 'sonnet', title: 'B' });
      await Promise.all([
        waitFor(a.id, (x) => x?.activity === 'monitoring'),
        waitFor(b.id, (x) => x?.activity === 'monitoring'),
      ]);
      const c = await ok(m.id, 'mock:monitoring C', { backend: 'pi', title: 'C', after: ['A', 'B'] });
      expect(store.getRun(c.id)!.status).toBe('queued');

      expect(manager.sendMessage(b.id, [{ type: 'text', text: 'mock:auth-error B failed' }])).toBe(true);
      await waitFor(b.id, (x) => x?.status === 'failed');
      await waitFor(c.id, (x) => x?.status === 'cancelled');
      expect(store.getRun(c.id)!.error).toContain('B');
    }, 80_000);

    it('refuses an unknown or already-failed dependency, naming the valid orders', async () => {
      const m = await parked();
      await ok(m.id, 'mock:monitoring first', { backend: 'claude', model: 'haiku', title: 'first' });
      expect(await refused(m.id, 'mock:done x', { backend: 'claude', model: 'sonnet', title: 'x', after: ['nope'] })).toContain('Orders so far: "first"');
    }, 60_000);
  });

  describe('complexity policy reminder (real worktree, fake session)', () => {
    const fakeState = () => {
      const sendMessage = vi.fn(() => true);
      return { state: { autonomous: true, autoContinues: 0, session: { open: true, sendMessage } } as never, sendMessage };
    };
    const writeFiles = (worktree: string, count: number) => {
      for (let i = 0; i < count; i++) writeFileSync(join(worktree, `big-${i}.txt`), 'x\n'.repeat(5));
    };
    const events = (id: string) => store.readEvents(id).filter((e) => e.type === 'note' && String((e as { message?: string }).message).includes('complexity policy'));

    it('warns once and reminds the manager when it edits many files and has dispatched nobody', async () => {
      const m = await parked();
      await waitFor(m.id, (x) => x?.worktreePath !== undefined);
      writeFiles(store.getRun(m.id)!.worktreePath!, COMPLEXITY.warnFiles);
      const { state, sendMessage } = fakeState();
      expect(await manager.checkManagerComplexity(m.id, { state, stepId: 'task', done: false })).toBe(true);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(sendMessage.mock.calls[0])).toContain('Complexity policy reminder');
      expect(events(m.id).length).toBeGreaterThanOrEqual(1);
      // Once per run.
      expect(await manager.checkManagerComplexity(m.id, { state, stepId: 'task', done: false })).toBe(false);
      expect(sendMessage).toHaveBeenCalledTimes(1);
    }, 60_000);

    it('stays quiet for a small change, and once a worker was dispatched', async () => {
      const small = await parked();
      await waitFor(small.id, (x) => x?.worktreePath !== undefined);
      writeFiles(store.getRun(small.id)!.worktreePath!, 1);
      const a = fakeState();
      expect(await manager.checkManagerComplexity(small.id, { state: a.state, stepId: 'task', done: false })).toBe(false);

      const big = await parked();
      await waitFor(big.id, (x) => x?.worktreePath !== undefined);
      writeFiles(store.getRun(big.id)!.worktreePath!, COMPLEXITY.warnFiles + 1);
      await ok(big.id, 'mock:done piece', { backend: 'pi', title: 'piece' });
      const b = fakeState();
      expect(await manager.checkManagerComplexity(big.id, { state: b.state, stepId: 'task', done: false })).toBe(false);
      expect(b.sendMessage).not.toHaveBeenCalled();
    }, 80_000);

    it('only logs when the session cannot take a message', async () => {
      const m = await parked();
      await waitFor(m.id, (x) => x?.worktreePath !== undefined);
      writeFiles(store.getRun(m.id)!.worktreePath!, COMPLEXITY.warnFiles);
      const closed = { state: { autonomous: true, autoContinues: 0, session: { open: false, sendMessage: vi.fn() } } as never };
      expect(await manager.checkManagerComplexity(m.id, { state: closed.state, stepId: 'task', done: false })).toBe(false);
      expect(events(m.id).length).toBeGreaterThanOrEqual(1);
    }, 60_000);
  });

  it('the whole tree shares the root ceiling: workers cannot jointly outspend it', async () => {
    const m = manager.startRun(STEP, { task: 'mock:monitoring manage', roster: ROSTER, limits: { mode: 'capped', maxCostUsd: 5 } });
    started.push(m.id);
    await waitFor(m.id, (x) => x?.activity === 'monitoring');
    const w = await ok(m.id, 'mock:monitoring work', { backend: 'claude', model: 'haiku', title: 'w' });
    expect(store.getRun(w.id)!.limits?.mode).toBe('capped');
    expect(store.getRun(w.id)!.limits?.maxCostUsd).toBeLessThanOrEqual(5);
    await waitFor(w.id, (x) => x?.activity === 'monitoring');
    store.updateStep(w.id, store.getRun(w.id)!.steps[0]!.id, { costUsd: 6 });
    manager.sweepLimits();
    await waitFor(m.id, (x) => x?.status === 'cancelled');
    await waitFor(w.id, (x) => x?.status === 'cancelled');
    expect(store.getRun(w.id)!.limitHit?.kind).toBe('cost');
  }, 80_000);
});

describe('worker retention while the tree is live', () => {
  const finishedWorker = (id: string, rootId: string, at: string): RunRecord =>
    ({ id, title: id, status: 'done', createdAt: at, finishedAt: at, worktreePath: `/wt/${id}`, steps: [], dispatch: { rootRunId: rootId, parentRunId: rootId } }) as unknown as RunRecord;
  const root = (id: string, status: string): RunRecord => ({ id, title: id, status, createdAt: '2026-01-01T00:00:00Z', steps: [], dispatch: { rootRunId: id } }) as unknown as RunRecord;

  it('keeps a worker\'s worktree while its root is not final, and releases it once the root is', () => {
    const w = finishedWorker('w1', 'r', '2026-01-02T00:00:00Z');
    expect(protectedByLiveTree(w, [root('r', 'running'), w])).toBe(true);
    expect(protectedByLiveTree(w, [root('r', 'review'), w])).toBe(true);
    expect(protectedByLiveTree(w, [root('r', 'done'), w])).toBe(false);
    // keep=0 means unlimited; with keep=1 and two finished workers only the older one is a candidate.
    const older = finishedWorker('w0', 'r', '2026-01-01T12:00:00Z');
    expect(selectReclaimableWorktrees([root('r', 'running'), w, older], 1)).toEqual([]);
    expect(selectReclaimableWorktrees([root('r', 'done'), w, older], 1)).toEqual(['w0']);
  });

  it('the enforcer removes nothing under a live root, and the branch is never touched', async () => {
    const removed: string[] = [];
    const runs = [root('r', 'running'), finishedWorker('w1', 'r', '2026-01-02T00:00:00Z'), finishedWorker('w0', 'r', '2026-01-01T00:00:00Z')];
    const fake = { listRuns: () => runs, updateRun: () => undefined };
    const remove = async (_root: string, path: string) => { removed.push(path); };
    expect(await reclaimWorktrees('/repo', fake, 1, { remove })).toEqual([]);
    expect(removed).toEqual([]);
    runs[0] = root('r', 'done');
    await reclaimWorktrees('/repo', fake, 1, { remove });
    expect(removed).toEqual(['/wt/w0']);
  });
});

describe('manager complexity policy', () => {
  const left = { unlimited: true, subtasks: 12, maxDepth: 1 };

  it('is in the manager brief by default, with the thresholds and the out-of-calls rule', () => {
    const prompt = managerPrompt(ROSTER, left);
    expect(prompt).toContain('The roster can change while you work. The CURRENT roster is authoritative');
    expect(prompt).toContain('onni task roster add <backend[:model]>');
    expect(prompt).toContain('onni task roster remove <backend[:model]>');
    expect(prompt).toContain('Sizing the work');
    expect(prompt).toContain(`at most ${COMPLEXITY.simpleMaxFiles} files`);
    expect(prompt).toContain('You may not do a whole complex task alone');
    expect(prompt).toContain('Unlimited worker calls');
  });

  it('is absent when the setting is off', () => {
    expect(managerPrompt(ROSTER, left, { complexityPolicy: false })).not.toContain('Sizing the work');
  });

  it('warns only for an unaided manager past the file or line threshold', () => {
    expect(managerDoingComplexAlone({ files: 1, adds: 5, dels: 0 }, 0)).toBe(false);
    expect(managerDoingComplexAlone({ files: COMPLEXITY.warnFiles, adds: 5, dels: 0 }, 0)).toBe(true);
    expect(managerDoingComplexAlone({ files: 1, adds: COMPLEXITY.warnLines - 10, dels: 10 }, 0)).toBe(true);
    // A manager that has dispatched anyone is working with its workers.
    expect(managerDoingComplexAlone({ files: 20, adds: 900, dels: 0 }, 1)).toBe(false);
    expect(managerDoingComplexAlone(undefined, 0)).toBe(false);
  });
});
