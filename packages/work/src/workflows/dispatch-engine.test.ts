import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MANAGER_MEMORY_MAX_BYTES, PENDING_ASK_MAX_QUESTIONS, PEEK_MAX_ENTRIES, rosterSchema, type DispatchInput, type DispatchOrderSnapshot, type RunDispatch } from '@onni/contract';
import { runRecordSchema, RunStore, type RunRecord } from '../runs/store.ts';
import { WorkspaceSemaphore, type WorkspaceResourceLimits } from '../workspace/semaphore.ts';
import { RunManager, type StartRunInput } from './run.ts';
import { BASH_MISSING_MESSAGE } from '../core/bash-path.ts';
import { childSettleReport, childTaskEnvelope } from '../dispatch/engine.ts';
import { writeReport } from '../dispatch/tree-fs.ts';
import { PROMPT_MAX_CHARS } from '../dispatch/prompt-budget.ts';
import type { WorkflowDef } from './types.ts';

const run = promisify(execFile);
const GIT_ID = ['-c', 'user.name=test', '-c', 'user.email=test@local'];

/**
 * Task dispatch's ENGINE (spec `.ai/specs/2026-09-10-dispatch.md`), driven end to end through the
 * dry-run mock: a task that dispatches, refusals that are answers rather than crashes, the budget
 * brakes, the cancel cascade, the settle→parent report, the tree directory, and the Guard.
 *
 * Everything here is gated twice — dispatch on (the default) AND a `dispatch` on the record — so the last
 * describe block is the counterweight: the same turns on a run with no `dispatch` must behave
 * exactly as they did before this feature existed.
 *
 * The runs are real: real worktrees off a real temp repository, because the fork point IS the
 * feature and a `worktree: false` fixture could not observe it.
 */
describe('the dispatch engine (spec 2026-09-10-dispatch)', () => {
  let repoRoot: string;
  let store: RunStore;
  let manager: RunManager;
  const started: string[] = [];
  const savedEnv: Record<string, string | undefined> = {};

  const SINGLE_STEP: WorkflowDef = {
    name: '(planned)',
    source: 'built-in',
    steps: [{ id: 'task', name: 'Task', prompt: '{{task}}' }],
  };

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-dispatch-'));
    for (const key of ['ONNI_DRY_RUN', 'ONNI_DISPATCH', 'ONNI_WEBHOOKS', 'ONNI_CODEX_BIN', 'ONNI_API_URL']) savedEnv[key] = process.env[key];
    delete process.env.ONNI_WEBHOOKS;
    delete process.env.ONNI_API_URL;
    process.env.ONNI_DRY_RUN = '1';
    process.env.ONNI_DISPATCH = '1';
    await run('git', ['init', '-q', '-b', 'main'], { cwd: repoRoot });
    writeFileSync(join(repoRoot, 'a.txt'), 'one\n');
    await run('git', ['add', '-A'], { cwd: repoRoot });
    await run('git', [...GIT_ID, 'commit', '-q', '-m', 'base'], { cwd: repoRoot });
    store = RunStore.open(join(repoRoot, '.ai/onni'));
    manager = boot();
    started.length = 0;
  });

  afterEach(async () => {
    for (const id of started) manager.cancel(id);
    // Cancellation interrupts the agent process, but the terminal lifecycle and its final
    // writes happen asynchronously. Do not remove the repository while a dispatched child is
    // still finishing inside it — under a full-suite load that races the recursive delete and
    // surfaces as ENOTEMPTY (#986).
    const deadline = Date.now() + 10_000;
    while (store.listRuns().some(({ id }) => manager.isActive(id))) {
      if (Date.now() >= deadline) throw new Error('timed out waiting for dispatch runs to stop');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    manager.dispose();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    store.flush();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  /** A manager with its own semaphore, so a test can decide how much of the tree may run. */
  const boot = (limits: Partial<WorkspaceResourceLimits> = {}): RunManager =>
    new RunManager(store, repoRoot, { semaphore: new WorkspaceSemaphore({ initial: limits }) });

  /** Re-boot the manager with different limits (before anything has started). */
  const reboot = (limits: Partial<WorkspaceResourceLimits>): void => {
    manager.dispose();
    manager = boot(limits);
  };

  const start = (task: string, dispatch?: RunDispatch, extra: Record<string, unknown> = {}): RunRecord => {
    const record = manager.startRun(SINGLE_STEP, { task, ...(dispatch ? { dispatch } : {}), ...extra });
    started.push(record.id);
    return record;
  };

  const waitFor = async (id: string, pred: (r: RunRecord | undefined) => boolean, ms = 20_000) => {
    const deadline = Date.now() + ms;
    while (!pred(store.getRun(id))) {
      if (Date.now() > deadline) throw new Error(`condition not met in time for ${id}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  const notes = (id: string): string[] =>
    store
      .readEvents(id)
      .filter((event) => event.type === 'note')
      .map((event) => String((event as { message?: unknown }).message ?? ''));

  const childrenOf = (parentId: string): RunRecord[] =>
    store.listRuns().filter((r) => r.dispatch?.parentRunId === parentId);

  const settled = (r: RunRecord | undefined): boolean =>
    r !== undefined && ['done', 'review', 'failed', 'cancelled'].includes(r.status);

  /** Everything the mock has been handed on stdin so far — '' before its first session opens. */
  const stdin = (file: string): string => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  };

  /** The full inbound message containing `needle` (the scripted replies only echo a slice). */
  const delivered = (file: string, needle: string): string | undefined =>
    stdin(file)
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { userText: string })
      .find((entry) => entry.userText.includes(needle))?.userText;

  const activeState = (id: string) =>
    (manager as unknown as {
      active: Map<string, { monitoringWakeTimer?: NodeJS.Timeout }>;
    }).active.get(id);

  /** A root's dispatch record — it names itself. */
  const rootOf = (id: string, budgetUsd?: number): RunDispatch => ({
    rootRunId: id,
    ...(budgetUsd !== undefined ? { budgetUsd } : {}),
  });
  const childOf = (rootId: string, parentId = rootId): RunDispatch => ({ rootRunId: rootId, parentRunId: parentId });
  const treeDirOf = (rootId: string) => join(repoRoot, '.ai/onni/dispatch', rootId);
  const order = (objective: string, extra: Partial<DispatchInput> = {}): DispatchInput => ({ objective, ...extra });
  /** Start a root that parks as a monitor, so dispatches against it are observable. */
  const parkedRoot = async (budgetUsd?: number): Promise<RunRecord> => {
    const record = start('mock:monitoring waiting on my tasks');
    store.updateRun(record.id, { dispatch: rootOf(record.id, budgetUsd) });
    await waitFor(record.id, (r) => r?.activity === 'monitoring');
    return record;
  };
  const dispatchOk = (parentId: string, input: DispatchInput): { id: string; branch?: string } => {
    const outcome = manager.dispatch(parentId, input);
    if ('refused' in outcome) throw new Error(`dispatch refused: ${outcome.refused}`);
    return outcome;
  };
  const refusal = (parentId: string, input: DispatchInput): string => {
    const outcome = manager.dispatch(parentId, input);
    if (!('refused' in outcome)) throw new Error('expected a refusal');
    return outcome.refused;
  };

  // ---- dispatch ------------------------------------------------------------------------------

  describe('dispatch()', () => {
    it('creates a child forked off the parent branch, with its order, budget and tree files', async () => {
      reboot({ maxParallel: 1, maxMonitoringSessions: 0 });
      const parent = await parkedRoot(20);
      const created = dispatchOk(parent.id, order('mock:done take the left flank', {
        title: 'Take the left flank',
        scope: 'src/left/**',
        max_cost: 2.5,
        success_criteria: 'the left half compiles and its tests pass',
        retry_limit: 1,
      }));
      const child = store.getRun(created.id);
      expect(child?.title).toBe('Take the left flank');
      expect(child?.dispatch).toMatchObject({
        rootRunId: parent.id,
        parentRunId: parent.id,
        scope: 'src/left/**',
        budgetUsd: 2.5,
        order: {
          objective: 'mock:done take the left flank',
          title: 'Take the left flank',
          kind: 'implement',
          scope: 'src/left/**',
          maxCost: 2.5,
          successCriteria: 'the left half compiles and its tests pass',
          retryLimit: 1,
          backend: 'claude',
          after: [],
        },
      });
      expect(child?.autonomous).toBe(true);
      // The child forks off the PARENT's branch, which is what `execute()` reads.
      expect(child?.baseBranch).toBe(store.getRun(parent.id)?.branch);
      expect(child?.baseBranch).toMatch(/^onni\//);
      // The task order the child receives — its own scope, the fork point, its files.
      expect(child?.task).toContain('## Task order');
      expect(child?.task).toContain('- Scope: src/left/**');
      expect(child?.task).toContain('- Max cost: $2.50');
      expect(child?.task).toContain(`- Ordered by: run ${parent.id}`);
      expect(child?.task).toContain('brief.md');
      expect(child?.task).not.toContain('{{TREE_PATHS}}');
      const dir = join(treeDirOf(parent.id), 'units', created.id.slice(0, 8));
      expect(readFileSync(join(dir, 'order.md'), 'utf8')).toContain('Take the left flank');
      expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toContain('## Suggestions for the root');
      expect(readFileSync(join(treeDirOf(parent.id), 'brief.md'), 'utf8')).toContain('waiting on my tasks');
      expect(readFileSync(join(treeDirOf(parent.id), 'ledger.jsonl'), 'utf8')).toContain('"type":"dispatch"');
      // The parent's transcript says who it dispatched.
      expect(notes(parent.id).some((n) => n.startsWith('dispatched "Take the left flank"'))).toBe(true);
    }, 40_000);

    it('makes a plain task a root on its first dispatch — no record needed up front', async () => {
      reboot({ maxParallel: 1, maxMonitoringSessions: 0 });
      const parent = start('mock:monitoring plain task');
      await waitFor(parent.id, (r) => r?.activity === 'monitoring');
      expect(store.getRun(parent.id)?.dispatch).toBeUndefined();
      const created = dispatchOk(parent.id, order('mock:done a piece'));
      expect(store.getRun(parent.id)?.dispatch).toEqual({ rootRunId: parent.id });
      expect(store.getRun(created.id)?.dispatch?.rootRunId).toBe(parent.id);
    }, 40_000);

    it('parks the dispatching task as a monitor when its turn ends, surrendering its slot', async () => {
      reboot({ maxParallel: 1, maxMonitoringSessions: 0 });
      const stdinFile = join(repoRoot, 'mock-stdin-dispatch.ndjson');
      savedEnv.ONNI_MOCK_STDIN_FILE = process.env.ONNI_MOCK_STDIN_FILE;
      process.env.ONNI_MOCK_STDIN_FILE = stdinFile;
      // A two-second turn: long enough to dispatch from "inside" it.
      const parent = start('mock:pause plan the work', undefined, { autonomous: true });
      await waitFor(parent.id, () => stdin(stdinFile).includes('plan the work'));
      dispatchOk(parent.id, order('mock:done a piece'));
      // The turn ends plainly; the dispatch makes it a monitoring park, not a nudge.
      await waitFor(parent.id, (r) => r?.activity === 'monitoring');
      expect(store.getRun(parent.id)?.status).toBe('running');
      expect(activeState(parent.id)?.monitoringWakeTimer).toBeDefined();
    }, 40_000);

    it('refuses a fifth child in flight, with the reason', async () => {
      reboot({ maxParallel: 1, maxMonitoringSessions: 0 });
      const parent = await parkedRoot(20);
      for (let i = 0; i < 4; i += 1) {
        const child = store.createRun({ title: `in flight ${i}`, workflow: '(planned)', task: 't', steps: [] });
        store.updateRun(child.id, { status: 'running', dispatch: childOf(parent.id) });
      }
      const reason = refusal(parent.id, order('one more'));
      expect(reason).toContain('the cap is 4');
      expect(childrenOf(parent.id)).toHaveLength(4);
      expect(notes(parent.id).some((n) => n.includes('dispatch refused') && n.includes('the cap is 4'))).toBe(true);
    }, 40_000);

    it('refuses a child that would overspend the parent, and hands an uncapped child the remainder', async () => {
      reboot({ maxParallel: 1, maxMonitoringSessions: 0 });
      const parent = await parkedRoot(1);
      expect(refusal(parent.id, order('too rich', { max_cost: 2.5 }))).toMatch(/only \$[\d.]+ of the budget is left/);
      const created = dispatchOk(parent.id, order('mock:done fits'));
      // The uncapped child gets the whole remainder — one child at a time, nobody to share with.
      const remainder = store.getRun(created.id)?.dispatch?.budgetUsd ?? 0;
      expect(remainder).toBeGreaterThan(0.5);
      expect(remainder).toBeLessThanOrEqual(1);
      expect(refusal(parent.id, order('nothing left'))).toContain('no budget left');
    }, 40_000);

    it('releases a settled child’s unspent budget to the parent', async () => {
      // Default slots: the parked parent and its child must both be able to run.
      const parent = await parkedRoot(5);
      // Titled: the report quotes the title, and a `mock:done` in it would settle the parent's mock
      // before the second dispatch below.
      const first = dispatchOk(parent.id, order('mock:done quick', { max_cost: 4, title: 'quick' }));
      expect(refusal(parent.id, order('second', { max_cost: 3 }))).toMatch(/only \$[\d.]+ of the budget is left/);
      await waitFor(first.id, settled);
      // The first child settled far under its cap (a dry run costs cents at most), so its
      // reservation flows back and a second child of the same size fits.
      const second = dispatchOk(parent.id, order('mock:done second', { max_cost: 3 }));
      expect(store.getRun(second.id)?.dispatch?.budgetUsd).toBe(3);
    }, 60_000);

    it('honours the user’s intent: a lower in-flight cap, a total cap, and child defaults', async () => {
      reboot({ maxParallel: 1, maxMonitoringSessions: 0 });
      const parent = await parkedRoot(20);
      store.updateRun(parent.id, {
        dispatch: { ...rootOf(parent.id, 20), intent: { maxSubtasks: 3, inFlight: 2, runner: 'codex', model: 'gpt-5', budgetUsd: 1.5 } },
      });
      // Two children in flight fill the USER's cap of 2, well under the engine's 4.
      for (let i = 0; i < 2; i += 1) {
        const child = store.createRun({ title: `in flight ${i}`, workflow: '(planned)', task: 't', steps: [] });
        store.updateRun(child.id, { status: 'running', dispatch: childOf(parent.id) });
      }
      expect(refusal(parent.id, order('a third at once'))).toContain('the cap is 2 per task (set by the user)');
      // With one settled, a third child fits in flight but is the tree's third and last.
      const [first] = childrenOf(parent.id);
      store.updateRun(first!.id, { status: 'done' });
      const third = dispatchOk(parent.id, order('the last one'));
      const record = store.getRun(third.id);
      // Defaults from the intent fill what the order left out.
      expect(record?.runner).toBe('codex');
      expect(record?.model).toBe('gpt-5');
      expect(record?.dispatch?.budgetUsd).toBe(1.5);
      // A fourth breaks the total cap, whatever is in flight.
      store.updateRun(third.id, { status: 'done' });
      expect(refusal(parent.id, order('one too many'))).toContain('the user capped it at 3');
      // An order that names its own runner, model and budget wins over the defaults.
      store.updateRun(parent.id, { dispatch: { ...rootOf(parent.id, 20), intent: { runner: 'codex', model: 'gpt-5', budgetUsd: 1.5 } } });
      const explicit = dispatchOk(parent.id, order('explicit', { runner: 'claude', model: 'opus', max_cost: 3 }));
      expect(store.getRun(explicit.id)?.runner).toBe('claude');
      expect(store.getRun(explicit.id)?.model).toBe('opus');
      expect(store.getRun(explicit.id)?.dispatch?.budgetUsd).toBe(3);
    }, 40_000);

    it('a child on another runner does not inherit the parent’s or the intent’s model (telemetry 43bdda11)', async () => {
      reboot({ maxParallel: 1, maxMonitoringSessions: 0 });
      const parent = await parkedRoot(20);
      store.updateRun(parent.id, { runner: 'codex', model: 'gpt-5.6-luna' });
      // Same runner: the parent's model still follows.
      const same = dispatchOk(parent.id, order('same runner', { max_cost: 1 }));
      expect(store.getRun(same.id)?.runner).toBe('codex');
      expect(store.getRun(same.id)?.model).toBe('gpt-5.6-luna');
      store.updateRun(same.id, { status: 'done' });
      // `--runner claude` with no `--model`: Claude picks its own default.
      const switched = dispatchOk(parent.id, order('switched runner', { runner: 'claude', max_cost: 1 }));
      expect(store.getRun(switched.id)?.runner).toBe('claude');
      expect(store.getRun(switched.id)?.model).toBeUndefined();
      store.updateRun(switched.id, { status: 'done' });
      // An intent model belongs to the intent's runner, not to an order that names another.
      store.updateRun(parent.id, { dispatch: { ...rootOf(parent.id, 20), intent: { runner: 'codex', model: 'gpt-5.6-terra' } } });
      const fromIntent = dispatchOk(parent.id, order('intent runner', { max_cost: 1 }));
      expect(store.getRun(fromIntent.id)?.model).toBe('gpt-5.6-terra');
      store.updateRun(fromIntent.id, { status: 'done' });
      const overIntent = dispatchOk(parent.id, order('over the intent', { runner: 'claude', max_cost: 1 }));
      expect(store.getRun(overIntent.id)?.model).toBeUndefined();
    }, 40_000);

    it('a root started with an intent runs in a worktree even when the composer opted out, and its prompt carries the intent block', async () => {
      const record = start('mock:monitoring the user asked for a fan-out', undefined, { worktree: false, dispatchIntent: { maxSubtasks: 5 } });
      await waitFor(record.id, (r) => r?.activity === 'monitoring');
      const stored = store.getRun(record.id);
      expect(stored?.dispatch).toEqual({ rootRunId: record.id, intent: { maxSubtasks: 5 } });
      expect(stored?.worktree).toBeUndefined();
      expect(stored?.branch).toBeTruthy();
      expect(notes(record.id).some((n) => n.startsWith('worktree on'))).toBe(true);
    }, 40_000);

    it('refuses against a settled parent and while the feature is off', async () => {
      const parent = store.createRun({ title: 'done', workflow: 'quick-task', task: 't', steps: [] });
      store.updateRun(parent.id, { status: 'done', dispatch: rootOf(parent.id) });
      expect(refusal(parent.id, order('late'))).toContain('already settled');
      process.env.ONNI_DISPATCH = '0';
      expect(refusal(parent.id, order('off'))).toContain('ONNI_DISPATCH=0');
    });

    it('warns — without refusing — when a files-only antigravity worker is asked to verify', async () => {
      const parent = await parkedRoot();
      const out = manager.dispatch(parent.id, order('mock:done tidy the module', {
        backend: 'antigravity',
        success_criteria: 'npm run lint passes',
      }), { antigravityLevel: 'files-only' });
      expect('refused' in out).toBe(false);
      expect(notes(parent.id).filter((n) => n.startsWith('warning — this worker cannot run shell commands (files-only)'))).toHaveLength(1);
    }, 40_000);

    it('stays silent at allow-rules, for another backend, and when the order asks for no verification', async () => {
      const parent = await parkedRoot();
      const warned = () => notes(parent.id).filter((n) => n.startsWith('warning — this worker cannot run shell commands'));
      manager.dispatch(parent.id, order('mock:done npm test', { backend: 'antigravity' }), { antigravityLevel: 'allow-rules' });
      expect(warned()).toHaveLength(0);
      manager.dispatch(parent.id, order('mock:done npm test', { backend: 'codex' }), { antigravityLevel: 'files-only' });
      expect(warned()).toHaveLength(0);
      manager.dispatch(parent.id, order('mock:done update the README', { backend: 'antigravity' }), { antigravityLevel: 'files-only' });
      expect(warned()).toHaveLength(0);
      // A graph node passes no level, so a workflow child never warns.
      manager.dispatch(parent.id, order('mock:done pytest', { backend: 'antigravity' }));
      expect(warned()).toHaveLength(0);
    }, 40_000);
  });

  // ---- manager redirect (wave B4) -----------------------------------------------------------

  describe('manager redirect', () => {
    it('holds multiple dependents through replacement admission, then starts them from its branch', async () => {
      reboot({ maxParallel: 2, maxMonitoringSessions: 0 });
      const parent = await parkedRoot();
      store.updateRun(parent.id, {
        roster: {
          manager: { runner: 'claude' },
          workers: [{ runner: 'claude', role: 'worker', maxConcurrent: 2 }],
        },
      });
      await run('git', ['branch', 'redirect-pred-a'], { cwd: repoRoot });
      await run('git', ['branch', 'redirect-pred-b'], { cwd: repoRoot });
      const predecessorA = store.createRun({ title: 'predecessor A', workflow: '(planned)', task: 'done', steps: [] });
      const predecessorB = store.createRun({ title: 'predecessor B', workflow: '(planned)', task: 'done', steps: [] });
      store.updateRun(predecessorA.id, { status: 'done', branch: 'redirect-pred-a', dispatch: childOf(parent.id) });
      store.updateRun(predecessorB.id, { status: 'done', branch: 'redirect-pred-b', dispatch: childOf(parent.id) });
      const canonicalOrder: DispatchOrderSnapshot = {
        objective: 'mock:done implement the parser',
        title: 'parser worker',
        kind: 'implement',
        retryLimit: 1,
        backend: 'claude',
        after: [predecessorA.id, predecessorB.id],
      };
      const source = store.createRun({ title: 'parser worker', workflow: '(planned)', task: canonicalOrder.objective, runner: 'claude', steps: [] });
      store.updateRun(source.id, {
        dispatch: { ...childOf(parent.id), after: canonicalOrder.after, order: canonicalOrder },
      });
      const seam = manager as unknown as {
        queue: string[];
        pendingJobs: Map<string, { workflow: WorkflowDef; input: StartRunInput }>;
      };
      const dependent = (title: string, after: string[]): RunRecord => {
        const input: DispatchInput = { title, objective: `mock:done ${title}`, after };
        const afterText = after.map((id) => {
          const run = store.getRun(id);
          return `${run?.title ?? id} (${id.slice(0, 8)}${run?.branch ? `, branch ${run.branch}` : ''})`;
        });
        const task = childTaskEnvelope({ ...input, after: afterText }, { id: parent.id, branch: parent.branch });
        const record = store.createRun({ title, workflow: '(planned)', task, runner: 'claude', steps: [] });
        const dispatch = { ...childOf(parent.id), after };
        store.updateRun(record.id, { dispatch });
        seam.queue.push(record.id);
        seam.pendingJobs.set(record.id, { workflow: SINGLE_STEP, input: { task, runner: 'claude', autonomous: true, dispatch } });
        return record;
      };
      const dependentA = dependent('dependent A', [predecessorA.id, source.id]);
      const dependentB = dependent('dependent B', [source.id, predecessorB.id]);

      const result = await manager.redirectFor(parent.id, { target: source.id, instruction: 'Keep the parser streaming' });

      expect(result).toMatchObject({ cancelledRunId: source.id, repointedDependents: 2, retryAccounting: 'excluded' });
      if ('denied' in result || 'error' in result) throw new Error(`redirect failed: ${'denied' in result ? result.denied : result.error}`);
      const replacementId = result.replacement.id;
      started.push(replacementId);
      await waitFor(replacementId, settled, 40_000);
      await waitFor(dependentA.id, settled, 40_000);
      await waitFor(dependentB.id, settled, 40_000);
      const replacement = store.getRun(replacementId)!;
      expect(store.getRun(source.id)?.status).toBe('cancelled');
      expect(store.getRun(source.id)?.dispatch?.redirectedTo).toBe(replacementId);
      expect(store.getRun(replacementId)?.dispatch?.redirectedFrom).toBe(source.id);
      expect(store.getRun(dependentA.id)?.status).toBe('done');
      expect(store.getRun(dependentB.id)?.status).toBe('done');
      expect(store.getRun(dependentA.id)?.dispatch?.after).toEqual([replacementId, predecessorA.id]);
      expect(store.getRun(dependentB.id)?.dispatch?.after).toEqual([replacementId, predecessorB.id]);
      expect(store.getRun(dependentA.id)?.baseBranch).toBe(replacement.branch);
      expect(store.getRun(dependentB.id)?.baseBranch).toBe(replacement.branch);
      expect(store.getRun(dependentA.id)?.task).toContain(`parser worker (${replacementId.slice(0, 8)}, branch ${replacement.branch})`);
      expect(store.getRun(dependentB.id)?.task).toContain(`parser worker (${replacementId.slice(0, 8)}, branch ${replacement.branch})`);
      expect(readFileSync(join(treeDirOf(parent.id), 'ledger.jsonl'), 'utf8')).toContain(`"replacementRunId":"${replacementId}"`);
    }, 60_000);

    it('resumes a persisted dispatching transaction after restart without a second source retry', async () => {
      const parent = store.createRun({ title: 'manager', task: 'manage', workflow: 'quick-task', runner: 'claude', steps: [] });
      store.updateRun(parent.id, { status: 'queued', branch: 'main', dispatch: rootOf(parent.id) });
      const canonicalOrder: DispatchOrderSnapshot = {
        objective: 'mock:done implement the restarted parser',
        title: 'restart parser',
        kind: 'implement',
        retryLimit: 0,
        backend: 'claude',
        after: [],
      };
      const source = store.createRun({ title: canonicalOrder.title, workflow: '(planned)', task: canonicalOrder.objective, runner: 'claude', steps: [] });
      store.updateRun(source.id, {
        dispatch: {
          ...childOf(parent.id),
          order: canonicalOrder,
          redirectOperation: {
            operationId: 'restart-redirect-op',
            managerRunId: parent.id,
            state: 'dispatching',
            instruction: 'Keep the parser streaming',
            requestedAt: new Date().toISOString(),
          },
          managerCancellation: { byRunId: parent.id, requestedAt: new Date().toISOString(), reason: 'redirected by manager' },
        },
      });
      manager.dispose();
      manager = boot({ maxParallel: 1, maxMonitoringSessions: 0 });

      await (manager as unknown as { recoverRedirectOperations(): Promise<void> }).recoverRedirectOperations();

      const replacement = store.listRuns().find((run) => run.dispatch?.redirectedFrom === source.id);
      expect(replacement).toBeTruthy();
      started.push(replacement!.id);
      expect(store.getRun(source.id)?.status).toBe('cancelled');
      expect(store.getRun(source.id)?.dispatch?.redirectOperation).toMatchObject({
        state: 'complete',
        replacementRunId: replacement!.id,
      });
      expect(store.getRun(replacement!.id)?.dispatch?.order).toMatchObject({
        objective: canonicalOrder.objective,
        redirectInstruction: 'Keep the parser streaming',
        retryLimit: 0,
      });
      await waitFor(replacement!.id, settled, 40_000);
      expect(store.getRun(replacement!.id)?.status).toBe('done');
    }, 60_000);
  });

  // ---- reports and the settle→parent wake ----------------------------------------------------

  describe('reports', () => {
    it('does not report an idle-closed ask early, then reports exactly once after Continue settles it', async () => {
      const stdinFile = join(repoRoot, 'mock-stdin-ask-settle.ndjson');
      savedEnv.ONNI_MOCK_STDIN_FILE = process.env.ONNI_MOCK_STDIN_FILE;
      process.env.ONNI_MOCK_STDIN_FILE = stdinFile;

      const parent = await parkedRoot();
      const child = start('mock:ask which library?', childOf(parent.id), { autonomous: true });
      await waitFor(child.id, (r) => r?.status === 'waiting');

      const live = (manager as unknown as {
        active: Map<string, { idleClosed?: boolean; session?: { end(): void } }>;
      }).active.get(child.id);
      live!.idleClosed = true;
      live!.session!.end();
      await waitFor(child.id, (r) => r?.status === 'failed' && r.awaitingAnswerSince !== undefined);
      await waitFor(child.id, (r) => !manager.isActive(r?.id ?? child.id));
      expect(notes(parent.id).some((note) => note.includes('report received from task'))).toBe(false);

      expect(manager.continueRun(child.id, { text: 'mock:done use zod' })).toEqual({ ok: true });
      await waitFor(child.id, (r) => r?.status === 'done' || r?.status === 'review');
      await waitFor(parent.id, () => stdin(stdinFile).includes('Report from task'), 40_000);
      const reportNotes = notes(parent.id).filter((note) => note.includes('report received from task'));
      expect(reportNotes).toHaveLength(1);
      expect(store.getRun(child.id)?.awaitingAnswerSince).toBeUndefined();
    }, 60_000);

    it('reports an unanswered child exactly once when cancellation explicitly retires it', async () => {
      const stdinFile = join(repoRoot, 'mock-stdin-ask-cancel.ndjson');
      savedEnv.ONNI_MOCK_STDIN_FILE = process.env.ONNI_MOCK_STDIN_FILE;
      process.env.ONNI_MOCK_STDIN_FILE = stdinFile;

      const parent = await parkedRoot();
      const child = start('mock:ask which library?', childOf(parent.id), { autonomous: true });
      await waitFor(child.id, (r) => r?.status === 'waiting');
      expect(manager.cancel(child.id)).toBe(true);
      await waitFor(child.id, (r) => r?.status === 'cancelled');
      await waitFor(parent.id, (r) => (r?.dispatch?.pendingReports?.length ?? 0) === 1, 40_000);
      const reportNotes = notes(parent.id).filter((note) => note.includes('report received from task'));
      expect(reportNotes).toHaveLength(1);
      expect(stdin(stdinFile)).not.toContain('Report from task'); // cancellation never wakes a parent
      expect(store.getRun(child.id)?.awaitingAnswerSince).toBeUndefined();
    }, 60_000);

    it('reports an unanswered child exactly once when Finish explicitly retires it', async () => {
      const parent = await parkedRoot();
      const child = start('mock:ask which library?', childOf(parent.id), { autonomous: true });
      await waitFor(child.id, (r) => r?.status === 'waiting');
      expect(manager.finish(child.id)).toBe(true);
      await waitFor(child.id, (r) => r?.status === 'done' || r?.status === 'review');
      await waitFor(parent.id, () => notes(parent.id).some((note) => note.includes('report received from task')), 40_000);
      const reportNotes = notes(parent.id).filter((note) => note.includes('report received from task'));
      expect(reportNotes).toHaveLength(1);
      expect(store.getRun(child.id)?.awaitingAnswerSince).toBeUndefined();
    }, 60_000);

    it('records a child’s own report and delivers it into the parent’s open session at settle', async () => {
      const stdinFile = join(repoRoot, 'mock-stdin.ndjson');
      savedEnv.ONNI_MOCK_STDIN_FILE = process.env.ONNI_MOCK_STDIN_FILE;
      process.env.ONNI_MOCK_STDIN_FILE = stdinFile;

      const parent = await parkedRoot();
      const child = start('mock:pause mock:done take the left flank', childOf(parent.id));
      await waitFor(child.id, (r) => r?.status === 'running');
      expect(
        manager.recordReport(child.id, {
          status: 'done',
          result: 'Took the left flank; the login handler now answers 401.',
          evidence: ['npm test -- auth → 12 passed'],
          checks: [],
          side_effects: [],
          errors: [],
          suggestions: [],
          verdict: undefined,
        }),
      ).toBe(true);
      await waitFor(child.id, settled, 40_000);

      await waitFor(parent.id, () => stdin(stdinFile).includes('Report from task'));
      const text = delivered(stdinFile, 'Report from task');
      expect(text).toContain(`"${store.getRun(child.id)?.title}"`);
      expect(text).toContain(child.id);
      expect(text).toContain('status done');
      expect(text).toContain('evidence: npm test -- auth → 12 passed');
      // The branch is what makes a report actionable — it is what the parent has to merge.
      expect(text).toContain(`branch ${store.getRun(child.id)?.branch}`);
      // Delivering wakes the monitor: it is working again, not parked.
      expect(store.getRun(parent.id)?.activity).toBeUndefined();
      expect(notes(parent.id).some((n) => n.startsWith('report received from task'))).toBe(true);
      // Persist-then-ACK: the live session taking it retires the pending entry.
      await waitFor(parent.id, (r) => (r?.dispatch?.pendingReports?.length ?? 0) === 0);
      // And the tree directory has the report file.
      expect(readFileSync(join(treeDirOf(parent.id), 'units', child.id.slice(0, 8), 'report.md'), 'utf8')).toContain('"status": "done"');
    }, 60_000);

    it('refuses a report from a run outside any tree', () => {
      const plain = store.createRun({ title: 'plain', workflow: 'quick-task', task: 't', steps: [] });
      expect(manager.recordReport(plain.id, { status: 'done', result: 'x', evidence: [], side_effects: [], errors: [], checks: [], suggestions: [] })).toBe(false);
    });

    it('resolves a worker to its tree root for the budget, counting the worker against the cap', () => {
      const parent = store.createRun({ title: 'commander', workflow: 'quick-task', task: 't', steps: [] });
      store.updateRun(parent.id, { status: 'running', dispatch: { rootRunId: parent.id, intent: { maxSubtasks: 1 } } });
      const child = store.createRun({ title: 'worker', workflow: 'quick-task', task: 't', steps: [] });
      store.updateRun(child.id, { status: 'running', dispatch: { rootRunId: parent.id, parentRunId: parent.id } });
      expect(manager.dispatchBudgetFor(child.id)).toEqual(manager.dispatchBudgetFor(parent.id));
      expect(manager.dispatchBudgetFor(child.id)?.subtasks).toBe(0);
      expect(manager.dispatchBudgetFor('ghost')).toBeUndefined();
    });

    it('persists a pending report for a parent with no session, and flushes it into its next prompt', async () => {
      const stdinFile = join(repoRoot, 'mock-stdin-flush.ndjson');
      savedEnv.ONNI_MOCK_STDIN_FILE = process.env.ONNI_MOCK_STDIN_FILE;
      process.env.ONNI_MOCK_STDIN_FILE = stdinFile;

      // A parent that already FINISHED: no session, so the report can only be persisted.
      const parent = start('mock:done first pass');
      store.updateRun(parent.id, { dispatch: rootOf(parent.id) });
      await waitFor(parent.id, settled);
      const child = start('mock:done take the right flank', childOf(parent.id));
      await waitFor(child.id, settled);
      // Rung 4 of the delivery ladder: a finished parent is continued with the report.
      await waitFor(parent.id, () => stdin(stdinFile).includes('Report from task'), 40_000);
      const text = delivered(stdinFile, 'Report from task');
      expect(text).toContain(child.id);
    }, 60_000);

    it('forwards a settled child’s suggestions to the root’s inbox', async () => {
      const parent = await parkedRoot();
      const child = start('mock:pause mock:done take the right flank', childOf(parent.id));
      await waitFor(child.id, (r) => r?.status === 'running');
      manager.recordReport(child.id, {
        status: 'done',
        result: 'done',
        evidence: [],
        checks: [],
        side_effects: [],
        errors: [],
        suggestions: ['split billing out of this order — it is a task of its own'],
      });
      await waitFor(child.id, settled, 40_000);
      // The report (and the suggestion it carries) is written after the settle hook's read-only
      // git capture, so wait for the file instead of assuming the settle poll observed it.
      const inbox = join(treeDirOf(parent.id), 'inbox', 'root');
      const deadline = Date.now() + 10_000;
      while (!(existsSync(inbox) && readdirSync(inbox).some((name) => name.includes('suggestions'))) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const files = readdirSync(inbox);
      const suggestion = files.find((name) => name.includes('suggestions'));
      expect(suggestion).toBeTruthy();
      expect(readFileSync(join(treeDirOf(parent.id), 'inbox', 'root', suggestion!), 'utf8')).toContain('split billing out of this order');
    }, 60_000);
  });

  // ---- peek (plan v2 §7) ---------------------------------------------------------------------

  describe('peek', () => {
    /** `peek` is a manager command (plan v2 §1.3): only a root carrying a roster sees it in its
     *  brief, so only that shape is the "root manager" the route admits. */
    const ROSTER = rosterSchema.parse({ manager: { runner: 'claude' }, workers: [{ runner: 'codex', role: 'work' }] });
    const managerRoot = async (): Promise<RunRecord> => {
      const record = await parkedRoot();
      store.updateRun(record.id, { roster: ROSTER });
      return record;
    };

    it('shows a running worker’s state and files without writing the worktree’s index', async () => {
      const parent = await managerRoot();
      const child = start('mock:monitoring work', childOf(parent.id), { autonomous: true });
      await waitFor(child.id, (r) => r?.status === 'running' && r.worktreePath !== undefined);
      const worktree = store.getRun(child.id)!.worktreePath!;
      writeFileSync(join(worktree, 'peeked.txt'), 'new\n');
      const gitDir = (await run('git', ['rev-parse', '--absolute-git-dir'], { cwd: worktree })).stdout.trim();
      const indexBefore = readFileSync(join(gitDir, 'index'));

      const outcome = await manager.peekFor(parent.id, { target: child.id });
      if ('denied' in outcome) throw new Error(outcome.denied);
      const entry = outcome.workers[0]!;
      expect(entry).toMatchObject({ id: child.id, status: 'running', filesState: 'ok' });
      expect(entry.files).toContain('peeked.txt');
      expect(entry.tail.length).toBeGreaterThan(0);

      // The whole point of H3 here: a worker is running in that worktree, so `git add -N` is a
      // race with its own index. The bytes must be identical afterwards.
      expect(readFileSync(join(gitDir, 'index')).equals(indexBefore)).toBe(true);
    }, 60_000);

    it('lets only the root peek, and only inside its own tree; a reclaimed worktree reads unavailable', async () => {
      const parent = await managerRoot();
      const child = start('mock:monitoring work', childOf(parent.id), { autonomous: true });
      await waitFor(child.id, (r) => r?.status === 'running');
      expect(await manager.peekFor(child.id, {})).toMatchObject({ status: 403 });
      const other = await parkedRoot();
      expect(await manager.peekFor(parent.id, { target: other.id })).toMatchObject({ status: 409 });
      expect(await manager.peekFor(parent.id, { target: 'nope' })).toMatchObject({ status: 404 });
      expect('workers' in (await manager.peekFor(parent.id, { target: parent.id }))).toBe(true);

      store.updateRun(child.id, { worktreePath: join(repoRoot, 'reclaimed-by-retention') });
      const outcome = await manager.peekFor(parent.id, { target: child.id });
      if ('denied' in outcome) throw new Error(outcome.denied);
      expect(outcome.workers[0]?.filesState).toBe('unavailable');
    }, 60_000);

    it('caps a compact list and counts what it hides', async () => {
      const parent = await managerRoot();
      for (let index = 0; index < PEEK_MAX_ENTRIES + 1; index += 1) {
        const worker = store.createRun({ title: `worker ${index}`, workflow: 'quick-task', task: 't', steps: [] });
        store.updateRun(worker.id, { status: 'done', dispatch: childOf(parent.id), createdAt: `2026-11-03T09:${String(index).padStart(2, '0')}:00.000Z` });
      }
      const outcome = await manager.peekFor(parent.id, {});
      if ('denied' in outcome) throw new Error(outcome.denied);
      expect(outcome.workers).toHaveLength(PEEK_MAX_ENTRIES);
      expect(outcome.workersOmitted).toBe(1);
      // Compact mode: state, files — never a tail.
      expect(outcome.workers.every((worker) => worker.tail.length === 0)).toBe(true);
    }, 60_000);
  });

  // ---- onni task verify (wave A1) ------------------------------------------------------------

  describe('verify', () => {
    const ROSTER = rosterSchema.parse({ manager: { runner: 'claude' }, workers: [{ runner: 'codex', role: 'work' }] });
    type Deps = NonNullable<NonNullable<ConstructorParameters<typeof RunManager>[2]>['verifyDeps']>;
    type Runner = NonNullable<Deps['runCommand']>;
    const FAKE_BASH = () => ({ path: 'bash', pathDirs: [] as string[] });
    let verifyEnv: NodeJS.ProcessEnv;
    const okRun = { exitCode: 0, timedOut: false, aborted: false, output: '', durationMs: 5 };
    const calls: string[] = [];
    const exitByCommand: Record<string, number> = {};
    let observedChildEnv: NodeJS.ProcessEnv | undefined;
    const fakeRunner: Runner = async (opts) => {
      calls.push(opts.command);
      observedChildEnv = opts.env;
      const exitCode = exitByCommand[opts.command] ?? 0;
      return { ...okRun, exitCode, output: exitCode === 0 ? '' : `FAILED with sk-ant-secret-1234 here\n${opts.command} broke` };
    };
    const until = async (cond: () => boolean) => {
      const deadline = Date.now() + 15_000;
      while (!cond()) {
        if (Date.now() > deadline) throw new Error('condition not met');
        await new Promise((r) => setTimeout(r, 25));
      }
    };
    // One manager for the test (swapping it would dispose the parked root); the seam reads `current`.
    let current: Deps = {};
    const useVerifyDeps = (deps: Deps): void => {
      current = deps;
    };
    /** Roots park on the dry-run mock; verify injects a non-dry environment without changing process.env. */
    const verify = (...args: Parameters<RunManager['verifyFor']>) => manager.verifyFor(...args);
    const writeChecks = (checks: string[]) => {
      mkdirSync(join(repoRoot, '.ai/onni'), { recursive: true });
      writeFileSync(join(repoRoot, '.ai/onni/config.json'), JSON.stringify({ requiredChecks: checks }));
    };
    const managerRoot = async (): Promise<RunRecord> => {
      const record = await parkedRoot();
      store.updateRun(record.id, { roster: ROSTER });
      return record;
    };
    /** A settled worker whose worktree is the (real, git) temp repository. */
    const settledWorker = (parentId: string, patch: Partial<RunRecord> = {}): RunRecord => {
      const worker = store.createRun({ title: 'worker', workflow: 'quick-task', task: 't', steps: [] });
      store.updateRun(worker.id, { status: 'done', dispatch: childOf(parentId), worktreePath: repoRoot, ...patch });
      return store.getRun(worker.id)!;
    };

    beforeEach(() => {
      calls.length = 0;
      for (const key of Object.keys(exitByCommand)) delete exitByCommand[key];
      verifyEnv = { ...process.env, ONNI_DRY_RUN: '' };
      useVerifyDeps({ runCommand: fakeRunner, resolveBash: FAKE_BASH });
      manager.dispose();
      manager = new RunManager(store, repoRoot, {
        semaphore: new WorkspaceSemaphore(),
        verifyDeps: {
          runCommand: (o) => (current.runCommand ?? fakeRunner)(o),
          resolveBash: (options) => (current.resolveBash ?? FAKE_BASH)(options),
          now: () => (current.now ?? Date.now)(),
          env: () => current.env?.() ?? verifyEnv,
        },
      });
    });

    it('runs the required checks in a settled worker, stores the verdict and leaves a trail', async () => {
      writeChecks(['npm test', 'npm run build']);
      verifyEnv.HOME = 'verify-injected-home';
      exitByCommand['npm run build'] = 1;
      const parent = await managerRoot();
      const worker = settledWorker(parent.id);
      store.registerRunSecrets(worker.id, ['sk-ant-secret-1234']);
      writeReport(join(repoRoot, '.ai/onni'), parent.id, worker.id, 'Report body', {});

      const outcome = await verify(parent.id, { target: worker.id.slice(0, 8) });
      if ('denied' in outcome) throw new Error(outcome.denied);
      expect(outcome).toMatchObject({ state: 'failed', source: 'required-checks', runsUsed: 1, runsMax: 3 });
      expect(outcome.results.map((entry) => [entry.command, entry.outcome])).toEqual([['npm test', 'passed'], ['npm run build', 'failed']]);
      const failed = outcome.results[1]!;
      expect(failed.tail.join('\n')).toContain('npm run build broke');
      expect(failed.tail.join('\n')).not.toContain('sk-ant-secret-1234'.slice(0, 0) + 'sk-ant-secret-1234');
      expect(calls).toEqual(['npm test', 'npm run build']);
      expect(observedChildEnv?.HOME).toBe('verify-injected-home');
      expect(observedChildEnv?.ONNI_DRY_RUN).toBeUndefined();
      expect(store.getRun(worker.id)?.dispatch?.verify).toMatchObject({ runs: 1, last: { state: 'failed', source: 'required-checks' } });
      const ledger = readFileSync(join(treeDirOf(parent.id), 'ledger.jsonl'), 'utf8');
      expect(ledger).toContain('"type":"verify"');
      expect(ledger).not.toContain('npm run build');
      expect(notes(parent.id).some((line) => line.startsWith(`verify ${worker.id.slice(0, 8)}`) && line.includes('failed'))).toBe(true);
      expect(notes(worker.id).some((line) => line.startsWith('verified by its manager: failed'))).toBe(true);
      expect(readFileSync(join(treeDirOf(parent.id), 'units', worker.id.slice(0, 8), 'report.md'), 'utf8')).toContain('## Verification');
    }, 60_000);

    it('refuses on the server: a worker, an unknown caller, another tree, itself, an ambiguous id, an unknown --only', async () => {
      writeChecks(['npm test']);
      const parent = await managerRoot();
      const worker = settledWorker(parent.id);
      expect(await verify(worker.id, { target: worker.id })).toMatchObject({ status: 403 });
      expect(await verify('no-such-run', { target: worker.id })).toMatchObject({ status: 404 });
      const other = await managerRoot();
      const foreign = settledWorker(other.id);
      expect(await verify(parent.id, { target: foreign.id })).toMatchObject({ status: 409 });
      expect(await verify(parent.id, { target: parent.id })).toMatchObject({ status: 409 });
      expect(await verify(parent.id, { target: 'zzzzzzzz' })).toMatchObject({ status: 404 });
      const twin = store.createRun({ title: 'twin', workflow: 'quick-task', task: 't', steps: [] });
      store.updateRun(twin.id, { status: 'done', dispatch: childOf(parent.id), worktreePath: repoRoot });
      const shared = worker.id.slice(0, 1);
      const sameStart = store.listRuns().filter((r) => r.id.startsWith(shared));
      if (sameStart.length > 1) {
        expect(await verify(parent.id, { target: shared.padEnd(6, shared) })).toMatchObject({ status: expect.any(Number) });
      }
      expect(await verify(parent.id, { target: worker.id, only: ['rm -rf /'] })).toMatchObject({ status: 400 });
      const secret = 'verify-selector-secret-1234';
      store.registerRunSecrets(worker.id, [secret]);
      writeChecks(Array.from({ length: 10 }, (_, index) => `check-${index} ${secret} ${'x'.repeat(140)}`));
      const longSelector = await verify(parent.id, { target: worker.id, only: [`${secret} ${'y'.repeat(150)}`] });
      expect(longSelector).toMatchObject({ status: 400 });
      const refusal = (longSelector as { denied: string }).denied;
      expect(refusal).not.toContain(secret);
      expect(refusal.match(/^unknown check "([^"]+)"/)?.[1]?.length).toBeLessThanOrEqual(120);
      const available = refusal.split('; available: ')[1]!;
      expect(available.length).toBeLessThanOrEqual(1_000);
      expect(available).not.toContain(secret);
      expect(calls).toEqual([]);
    }, 60_000);

    it('runs only on a settled worker', async () => {
      writeChecks(['npm test']);
      const parent = await managerRoot();
      for (const status of ['running', 'queued', 'waiting'] as const) {
        const worker = settledWorker(parent.id, { status });
        const outcome = await verify(parent.id, { target: worker.id });
        expect(outcome).toMatchObject({ status: 409 });
        expect((outcome as { denied: string }).denied).toContain(status);
      }
      for (const status of ['failed', 'cancelled'] as const) {
        const worker = settledWorker(parent.id, { status });
        expect('denied' in (await verify(parent.id, { target: worker.id }))).toBe(false);
      }
    }, 60_000);

    it('allows three runs per worker, counts only real ones, and survives a restart', async () => {
      writeChecks(['npm test']);
      const parent = await managerRoot();
      const worker = settledWorker(parent.id);
      store.updateRun(worker.id, { worktreePath: join(repoRoot, 'gone') });
      const gone = await verify(parent.id, { target: worker.id });
      expect(gone).toMatchObject({ state: 'unavailable', reasonCode: 'no-worktree', runsUsed: 0 });
      store.updateRun(worker.id, { worktreePath: repoRoot });
      for (let n = 1; n <= 3; n += 1) {
        expect(await verify(parent.id, { target: worker.id })).toMatchObject({ state: 'passed', runsUsed: n });
      }
      const fourth = await verify(parent.id, { target: worker.id });
      expect(fourth).toMatchObject({ status: 409 });
      expect((fourth as { denied: string }).denied).toContain('3 of 3');
      store.flush();
      const reopened = RunStore.open(join(repoRoot, '.ai/onni'));
      expect(reopened.getRun(worker.id)?.dispatch?.verify?.runs).toBe(3);
    }, 60_000);

    it('holds one verify per tree, releases the slot afterwards and lets cancel abort it', async () => {
      writeChecks(['npm test']);
      let release: (() => void) | undefined;
      let sawAbort = false;
      useVerifyDeps({
        resolveBash: FAKE_BASH,
        runCommand: (opts) =>
          new Promise((resolve) => {
            release = () => resolve({ ...okRun });
            opts.signal?.addEventListener('abort', () => {
              sawAbort = true;
              resolve({ ...okRun, exitCode: null, aborted: true });
            });
          }),
      });
      const parent = await managerRoot();
      const a = settledWorker(parent.id);
      const b = settledWorker(parent.id);
      const first = verify(parent.id, { target: a.id });
      await until(() => release !== undefined);
      expect(await verify(parent.id, { target: b.id })).toMatchObject({ status: 409 });
      release?.();
      expect(await first).toMatchObject({ state: 'passed' });
      release = undefined;
      const second = verify(parent.id, { target: b.id });
      await until(() => release !== undefined);
      manager.cancel(parent.id);
      const aborted = await second;
      expect(sawAbort).toBe(true);
      expect(aborted).toMatchObject({ results: [{ outcome: 'skipped' }] });
      // released: the entry is gone after an abort too
      expect((manager as unknown as { verifying: Map<string, unknown> }).verifying.size).toBe(0);
    }, 60_000);

    it('answers “cannot run” as a value and spends nothing', async () => {
      writeChecks(['npm test']);
      const parent = await managerRoot();
      const worker = settledWorker(parent.id);
      useVerifyDeps({ env: () => ({ ONNI_DRY_RUN: '1' }) });
      expect(await verify(parent.id, { target: worker.id })).toMatchObject({ state: 'unavailable', reasonCode: 'dry-run' });
      useVerifyDeps({ runCommand: fakeRunner, resolveBash: () => null });
      const noBash = await verify(parent.id, { target: worker.id });
      expect(noBash).toMatchObject({ state: 'unavailable', reasonCode: 'no-bash' });
      expect((noBash as { reason: string }).reason).toBe(BASH_MISSING_MESSAGE);
      useVerifyDeps({
        runCommand: async () => ({ ...okRun, exitCode: null, spawnError: 'spawn bash ENOENT', spawnErrorCode: 'ENOENT' }),
        resolveBash: FAKE_BASH,
      });
      expect(await verify(parent.id, { target: worker.id })).toMatchObject({ state: 'unavailable', reasonCode: 'no-bash', runsUsed: 0 });
      expect(store.getRun(worker.id)?.dispatch?.verify).toBeUndefined();
      useVerifyDeps({ runCommand: fakeRunner, resolveBash: FAKE_BASH });
      writeChecks([]);
      const empty = store.getRun(parent.id)!;
      store.updateRun(parent.id, { worktreePath: join(repoRoot, 'no-such-manager-tree') });
      expect(empty).toBeDefined();
      expect(await verify(parent.id, { target: worker.id })).toMatchObject({ state: 'unavailable', reasonCode: 'no-commands' });
      expect(calls).toEqual([]);
      expect(store.getRun(worker.id)?.dispatch?.verify).toBeUndefined();
    }, 60_000);

    it('discovers checks from the manager’s tree, and warns when the worker changed package.json', async () => {
      const parent = await managerRoot();
      const managerTree = mkdtempSync(join(tmpdir(), 'onni-verify-mgr-'));
      writeFileSync(join(managerTree, 'package.json'), JSON.stringify({ scripts: { test: 'x' } }));
      store.updateRun(parent.id, { worktreePath: managerTree });
      // a worker tree that DEFINES another script must not widen the list
      const workerTree = mkdtempSync(join(tmpdir(), 'onni-verify-wrk-'));
      writeFileSync(join(workerTree, 'package.json'), JSON.stringify({ scripts: { test: 'x', build: 'y' } }));
      await run('git', ['init', '-q', '-b', 'main'], { cwd: workerTree });
      await run('git', ['add', '-A'], { cwd: workerTree });
      await run('git', [...GIT_ID, 'commit', '-q', '-m', 'base'], { cwd: workerTree });
      writeFileSync(join(workerTree, 'package.json'), JSON.stringify({ scripts: { test: 'true' } }));
      const worker = settledWorker(parent.id, { worktreePath: workerTree, baseBranch: 'HEAD' });
      const outcome = await verify(parent.id, { target: worker.id });
      rmSync(managerTree, { recursive: true, force: true });
      rmSync(workerTree, { recursive: true, force: true });
      if ('denied' in outcome) throw new Error(outcome.denied);
      expect(outcome.source).toBe('discovered');
      expect(outcome.results.map((entry) => entry.command)).toEqual(['npm test']);
      expect(outcome.warnings.some((line) => line.includes('package.json'))).toBe(true);
    }, 60_000);

    it('skips what is left once the total deadline is spent', async () => {
      writeChecks(['one', 'two', 'three']);
      let clock = 0;
      useVerifyDeps({
        resolveBash: FAKE_BASH,
        now: () => clock,
        runCommand: async (opts) => {
          calls.push(opts.command);
          clock += 300_000;
          return { ...okRun };
        },
      });
      const parent = await managerRoot();
      const worker = settledWorker(parent.id);
      const outcome = await verify(parent.id, { target: worker.id });
      if ('denied' in outcome) throw new Error(outcome.denied);
      expect(outcome.results.map((entry) => entry.outcome)).toEqual(['passed', 'skipped', 'skipped']);
      expect(calls).toEqual(['one']);
    }, 60_000);

    it('replaces the worker-reported label for the same head and marks it stale after the branch moves', async () => {
      writeChecks(['npm test']);
      const parent = await managerRoot();
      const worker = settledWorker(parent.id);
      const outcome = await verify(parent.id, { target: worker.id });
      if ('denied' in outcome) throw new Error(outcome.denied);
      const head = outcome.headCommit!;
      const verified = store.getRun(worker.id)!;
      const claims = { checks: [{ command: 'npm test', exitCode: 1 }], headCommit: head };
      const same = childSettleReport(verified, claims).text;
      expect(same).toContain('verified by onni');
      expect(same).toContain('MISMATCH');
      const moved = childSettleReport(verified, { checks: claims.checks, headCommit: 'abcdef0123' }).text;
      expect(moved).toContain('worker-reported, not verified');
      expect(moved).toContain('stale');
    }, 60_000);

    it('never touches the worker’s index', async () => {
      writeChecks(['npm test']);
      const parent = await managerRoot();
      const worker = settledWorker(parent.id);
      const gitDir = (await run('git', ['rev-parse', '--absolute-git-dir'], { cwd: repoRoot })).stdout.trim();
      writeFileSync(join(repoRoot, 'untracked-by-verify.txt'), 'x\n');
      const before = readFileSync(join(gitDir, 'index'));
      await verify(parent.id, { target: worker.id });
      expect(readFileSync(join(gitDir, 'index')).equals(before)).toBe(true);
    }, 60_000);

    it('re-runs only failed checks on the base, sharing the same injected env and classifying pre-existing failures', async () => {
      writeChecks(['npm test', 'npm run build']);
      exitByCommand['npm test'] = 1;
      const parent = await managerRoot();
      const worker = settledWorker(parent.id);
      const runEnvs: NodeJS.ProcessEnv[] = [];
      const runCwds: string[] = [];
      useVerifyDeps({
        resolveBash: FAKE_BASH,
        runCommand: async (opts) => {
          runEnvs.push(opts.env);
          runCwds.push(opts.cwd);
          const failed = opts.command === 'npm test';
          return { ...okRun, exitCode: failed ? 1 : 0, output: failed ? 'FAIL src/auth.test.ts:17 rejects a token' : '' };
        },
      });

      const outcome = await verify(parent.id, { target: worker.id, baseline: true });
      if ('denied' in outcome) throw new Error(outcome.denied);
      expect(outcome.baseline).toMatchObject({
        method: 'heuristic', state: 'compared', verdict: 'no-new-failures',
        newCount: 0, preExistingCount: 1, inconclusiveCount: 0, cleanup: 'removed',
      });
      expect(outcome.baseline?.verdict).toBeDefined();
      expect(runCwds.filter((cwd) => cwd !== repoRoot)).toHaveLength(1);
      expect(runEnvs[0]).toBe(runEnvs[1]);
      expect(readdirSync(join(repoRoot, '.ai/onni/tmp/verify-baseline'))).toHaveLength(0);
    }, 60_000);

    it('classifies a worker-only failure as new and removes the linked node_modules before cleanup', async () => {
      writeChecks(['npm test']);
      const workerModules = join(repoRoot, 'node_modules');
      mkdirSync(workerModules, { recursive: true });
      writeFileSync(join(workerModules, 'preserve.txt'), 'keep');
      const parent = await managerRoot();
      const worker = settledWorker(parent.id);
      const baselineModuleSeen: boolean[] = [];
      useVerifyDeps({
        resolveBash: FAKE_BASH,
        runCommand: async (opts) => {
          if (opts.cwd !== repoRoot) baselineModuleSeen.push(existsSync(join(opts.cwd, 'node_modules', 'preserve.txt')));
          return opts.cwd === repoRoot
            ? { ...okRun, exitCode: 1, output: 'FAIL src/new.test.ts:4 worker regression' }
            : { ...okRun, exitCode: 0, output: '' };
        },
      });

      const outcome = await verify(parent.id, { target: worker.id, baseline: true });
      if ('denied' in outcome) throw new Error(outcome.denied);
      expect(outcome.baseline).toMatchObject({ state: 'compared', verdict: 'new-failures', newCount: 1, cleanup: 'removed' });
      expect(outcome.baseline?.results[0]).toMatchObject({ classification: 'new-failure', workerExitCode: 1, baselineExitCode: 0 });
      expect(baselineModuleSeen).toEqual([true]);
      expect(outcome.warnings).toContain("baseline shares the worker's node_modules");
      expect(readFileSync(join(workerModules, 'preserve.txt'), 'utf8')).toBe('keep');
      expect(readdirSync(join(repoRoot, '.ai/onni/tmp/verify-baseline'))).toHaveLength(0);
    }, 60_000);

    it('cleans the baseline worktree when a baseline runner throws or times out', async () => {
      writeChecks(['npm test']);
      const parent = await managerRoot();
      const worker = settledWorker(parent.id);
      useVerifyDeps({
        resolveBash: FAKE_BASH,
        runCommand: async (opts) => {
          if (opts.cwd !== repoRoot) throw new Error('injected baseline runner failure');
          return { ...okRun, exitCode: 1, output: 'FAIL test worker failure' };
        },
      });
      const failed = await verify(parent.id, { target: worker.id, baseline: true });
      if ('denied' in failed) throw new Error(failed.denied);
      expect(failed.baseline).toMatchObject({ state: 'unavailable', cleanup: 'removed' });
      expect(readdirSync(join(repoRoot, '.ai/onni/tmp/verify-baseline'))).toHaveLength(0);

      useVerifyDeps({
        resolveBash: FAKE_BASH,
        runCommand: async (opts) => opts.cwd === repoRoot
          ? { ...okRun, exitCode: 1, output: 'FAIL test worker failure' }
          : { ...okRun, exitCode: null, timedOut: true, output: '' },
      });
      const timedOut = await verify(parent.id, { target: worker.id, baseline: true });
      if ('denied' in timedOut) throw new Error(timedOut.denied);
      expect(timedOut.baseline).toMatchObject({ state: 'compared', verdict: 'inconclusive', inconclusiveCount: 1, cleanup: 'removed' });
      expect(readdirSync(join(repoRoot, '.ai/onni/tmp/verify-baseline'))).toHaveLength(0);
    }, 60_000);

    it('does not create a baseline tree when no worker check failed and preserves the worker result when no base is reliable', async () => {
      writeChecks(['npm test']);
      const parent = await managerRoot();
      const worker = settledWorker(parent.id);
      const passing = await verify(parent.id, { target: worker.id, baseline: true });
      if ('denied' in passing) throw new Error(passing.denied);
      expect(passing).toMatchObject({ state: 'passed', baseline: { state: 'compared', verdict: 'no-new-failures', results: [], cleanup: 'removed' } });
      expect(existsSync(join(repoRoot, '.ai/onni/tmp/verify-baseline'))).toBe(false);

      exitByCommand['npm test'] = 1;
      const noBaseWorker = settledWorker(parent.id, { baseBranch: '--invalid-ref' });
      const noBase = await verify(parent.id, { target: noBaseWorker.id, baseline: true });
      if ('denied' in noBase) throw new Error(noBase.denied);
      expect(noBase).toMatchObject({ state: 'failed', baseline: { state: 'unavailable', reason: 'no reliable diff base for this worker' } });
    }, 60_000);
  });

  // ---- conflicts (wave A2) ------------------------------------------------------------------

  describe('conflicts', () => {
    const ROSTER = rosterSchema.parse({ manager: { runner: 'claude' }, workers: [{ runner: 'codex', role: 'work' }] });
    const managerRoot = async (): Promise<RunRecord> => {
      const record = await parkedRoot();
      store.updateRun(record.id, { roster: ROSTER });
      return store.getRun(record.id)!;
    };
    const workerTree = async (
      parent: RunRecord,
      name: string,
      files: Record<string, string>,
      opts: { scope?: string; status?: 'done' | 'running' } = {},
    ): Promise<RunRecord> => {
      if (!parent.branch) throw new Error('manager branch is required for the git fixture');
      const branch = 'onni/conflicts-' + name + '-' + parent.id.slice(0, 6);
      const worktreePath = join(repoRoot, '.ai', 'onni', 'conflict-worktrees', name);
      mkdirSync(join(repoRoot, '.ai', 'onni', 'conflict-worktrees'), { recursive: true });
      await run('git', ['worktree', 'add', '-q', '-b', branch, worktreePath, parent.branch], { cwd: repoRoot });
      for (const [file, contents] of Object.entries(files)) {
        const path = join(worktreePath, file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, contents);
      }
      await run('git', ['add', '-A'], { cwd: worktreePath });
      await run('git', [...GIT_ID, 'commit', '-q', '-m', 'worker ' + name], { cwd: worktreePath });
      const worker = store.createRun({ title: name, workflow: 'quick-task', task: 'worker order', steps: [] });
      store.updateRun(worker.id, {
        status: opts.status ?? 'done',
        dispatch: { ...childOf(parent.id), ...(opts.scope ? { scope: opts.scope } : {}) },
        branch,
        baseBranch: parent.branch,
        worktreePath,
      });
      return store.getRun(worker.id)!;
    };

    it('reports worker overlaps and out-of-scope paths, accepts a running worker, and leaves git state untouched', async () => {
      const parent = await managerRoot();
      const workerA = await workerTree(parent, 'scope-a', { 'src/b/shared.ts': 'export const side = "a";\n' }, { scope: 'src/a/' });
      const workerB = await workerTree(parent, 'running-b', { 'src/b/shared.ts': 'export const side = "b";\n' }, { scope: 'the auth module', status: 'running' });
      const worktrees = [parent.worktreePath!, workerA.worktreePath!, workerB.worktreePath!];
      const snapshot = async (path: string) => ({
        index: (await run('git', ['ls-files', '--stage'], { cwd: path })).stdout,
        status: (await run('git', ['status', '--porcelain'], { cwd: path })).stdout,
      });
      const before = await Promise.all(worktrees.map(snapshot));
      const refsBefore = (await run('git', ['for-each-ref', '--format=%(refname) %(objectname)'], { cwd: repoRoot })).stdout;
      const notesBefore = notes(parent.id);
      const supported = await run('git', ['merge-tree', '--write-tree', 'refs/heads/main', 'refs/heads/main'], { cwd: repoRoot }).then(() => true, () => false);

      const outcome = await manager.conflictsFor(parent.id, { target: workerA.id.slice(0, 8) });
      if ('denied' in outcome) throw new Error(outcome.denied);
      expect(outcome.workers.map((worker) => [worker.id, worker.filesState, worker.scopeState])).toContainEqual([workerB.id, 'ok', 'free-text']);
      expect(outcome.workers.find((worker) => worker.id === workerA.id)).toMatchObject({ scopeState: 'checked', outsideScope: ['src/b/shared.ts'] });
      expect(outcome.overlaps).toHaveLength(1);
      expect(new Set([outcome.overlaps[0]!.a, outcome.overlaps[0]!.b])).toEqual(new Set([workerA.id, workerB.id]));
      expect(outcome.overlaps[0]?.files).toEqual(['src/b/shared.ts']);
      expect(outcome.trialMerges[0]).toMatchObject({ kind: 'worker-worker', state: supported ? 'conflict' : 'unavailable' });
      if (supported) expect(outcome.trialMerges[0]?.files).toContain('src/b/shared.ts');
      expect(notes(parent.id)).toEqual(notesBefore);
      expect((await run('git', ['for-each-ref', '--format=%(refname) %(objectname)'], { cwd: repoRoot })).stdout).toBe(refsBefore);
      expect(await Promise.all(worktrees.map(snapshot))).toEqual(before);
    }, 60_000);

    it('returns explicit unknown values and fences caller and target access', async () => {
      const parent = await managerRoot();
      const running = store.createRun({ title: 'running', workflow: 'quick-task', task: 't', steps: [] });
      store.updateRun(running.id, { status: 'running', dispatch: childOf(parent.id) });
      const unknownTree = await manager.conflictsFor(parent.id, { target: running.id });
      if ('denied' in unknownTree) throw new Error(unknownTree.denied);
      expect(unknownTree.workers[0]).toMatchObject({ id: running.id, filesState: 'unavailable', scopeState: 'none' });

      expect(await manager.conflictsFor(running.id, {})).toMatchObject({ status: 403 });
      expect(await manager.conflictsFor('no-such-run', {})).toMatchObject({ status: 404 });
      expect(await manager.conflictsFor(parent.id, { target: 'no-such-run' })).toMatchObject({ status: 404 });
      expect(await manager.conflictsFor(parent.id, { target: parent.id })).toMatchObject({ status: 409 });
      const foreign = store.createRun({ title: 'foreign', workflow: 'quick-task', task: 't', steps: [] });
      store.updateRun(foreign.id, { dispatch: { rootRunId: foreign.id } });
      expect(await manager.conflictsFor(parent.id, { target: foreign.id })).toMatchObject({ status: 409 });
      const ambiguousA = store.createRun({ id: 'abcdef1234567890abcdef01', title: 'a', workflow: 'quick-task', task: 't', steps: [] });
      const ambiguousB = store.createRun({ id: 'abcdef1234567890abcdef02', title: 'b', workflow: 'quick-task', task: 't', steps: [] });
      store.updateRun(ambiguousA.id, { dispatch: childOf(parent.id) });
      store.updateRun(ambiguousB.id, { dispatch: childOf(parent.id) });
      expect(await manager.conflictsFor(parent.id, { target: 'abcdef1234567890abcdef' })).toMatchObject({ status: 409 });
    }, 60_000);

    it('trials a settled worker branch ahead of the manager when changed paths overlap', async () => {
      const parent = await managerRoot();
      const worker = await workerTree(parent, 'into-manager', { 'a.txt': 'worker committed change\n' });
      const managerFile = join(parent.worktreePath!, 'a.txt');
      writeFileSync(managerFile, 'export const manager = true;\n');
      const outcome = await manager.conflictsFor(parent.id);
      if ('denied' in outcome) throw new Error(outcome.denied);
      const trial = outcome.trialMerges.find((entry) => entry.kind === 'into-manager' && entry.right === worker.id);
      expect(trial, JSON.stringify(outcome)).toMatchObject({ kind: 'into-manager', left: parent.id, right: worker.id, state: 'clean' });
      expect(outcome.workers.find((entry) => entry.id === worker.id)?.headCommit).toBeTruthy();
    }, 60_000);
  });

  // ---- project memory (#9) -------------------------------------------------------------------

  describe('project memory', () => {
    const ROSTER = rosterSchema.parse({ manager: { runner: 'claude' }, workers: [{ runner: 'codex', role: 'work' }] });
    const managerRoot = async (): Promise<RunRecord> => {
      const record = await parkedRoot();
      store.updateRun(record.id, { roster: ROSTER });
      return record;
    };

    it('lets the root manager add a lesson, and records it in the tree ledger and its transcript', async () => {
      const parent = await managerRoot();
      const outcome = await manager.addManagerMemory(parent.id, { entry: '## Run the migrations first' });
      if ('denied' in outcome) throw new Error(outcome.denied);
      expect(outcome.content).toContain(`- Run the migrations first (task ${parent.id.slice(0, 8)}`);
      expect(readFileSync(join(repoRoot, '.ai/onni/manager-memory.md'), 'utf8')).toContain('Run the migrations first');
      expect(readFileSync(join(treeDirOf(parent.id), 'ledger.jsonl'), 'utf8')).toContain('"type":"memory-add"');
      expect(notes(parent.id).some((line) => line.startsWith('project memory: added one lesson'))).toBe(true);
    }, 40_000);

    it('refuses a worker, a plain root and an unknown run — the same root-with-roster gate as peek', async () => {
      const parent = await managerRoot();
      const worker = store.createRun({ title: 'w', workflow: 'w', task: 't', steps: [] });
      store.updateRun(worker.id, { dispatch: childOf(parent.id) });
      expect(await manager.addManagerMemory(worker.id, { entry: 'x' })).toMatchObject({ status: 403 });
      const plain = await parkedRoot();
      expect(await manager.addManagerMemory(plain.id, { entry: 'x' })).toMatchObject({ status: 403 });
      expect(await manager.addManagerMemory('nope', { entry: 'x' })).toMatchObject({ status: 404 });
    }, 40_000);

    it('refuses a lesson that would cross the ceiling instead of truncating the file', async () => {
      const parent = await managerRoot();
      writeFileSync(join(repoRoot, '.ai/onni/manager-memory.md'), 'x'.repeat(MANAGER_MEMORY_MAX_BYTES), 'utf8');
      expect(await manager.addManagerMemory(parent.id, { entry: 'one more' })).toMatchObject({ status: 409 });
      expect(readFileSync(join(repoRoot, '.ai/onni/manager-memory.md'), 'utf8')).toHaveLength(MANAGER_MEMORY_MAX_BYTES);
    }, 40_000);
  });

  // ---- the tree directory (the filesystem channel) -------------------------------------------

  describe('the tree directory', () => {
    it('wakes a parked parent when a file lands in its inbox', async () => {
      const stdinFile = join(repoRoot, 'mock-stdin-inbox.ndjson');
      savedEnv.ONNI_MOCK_STDIN_FILE = process.env.ONNI_MOCK_STDIN_FILE;
      process.env.ONNI_MOCK_STDIN_FILE = stdinFile;

      const parent = await parkedRoot();
      // A child whose turn ends is the SIGNAL: it wrote into the root's inbox, then finished.
      const inbox = join(treeDirOf(parent.id), 'inbox', 'root');
      mkdirSync(inbox, { recursive: true });
      writeFileSync(join(inbox, 'scope-question.md'), '# Scope\n\nMay I touch billing?\n');
      const child = start('mock:done take the left flank', childOf(parent.id));
      await waitFor(child.id, settled);
      await waitFor(parent.id, () => stdin(stdinFile).includes('Tree inbox'));
      expect(delivered(stdinFile, 'Tree inbox')).toContain(join(inbox, 'scope-question.md'));
      expect(store.getRun(parent.id)?.dispatch?.inboxSeenAt).toBeTruthy();
      expect(notes(parent.id).some((n) => n.includes('new tree inbox message'))).toBe(true);
    }, 60_000);

    it('hands a working task its own inbox at turn end instead of parking it', async () => {
      const stdinFile = join(repoRoot, 'mock-stdin-own-inbox.ndjson');
      savedEnv.ONNI_MOCK_STDIN_FILE = process.env.ONNI_MOCK_STDIN_FILE;
      process.env.ONNI_MOCK_STDIN_FILE = stdinFile;
      const root = store.createRun({ title: 'root', workflow: 'quick-task', task: 'hold', steps: [] });
      store.updateRun(root.id, { status: 'waiting', dispatch: rootOf(root.id) });
      const child = start('mock:pause work on it', childOf(root.id), { autonomous: true });
      await waitFor(child.id, () => stdin(stdinFile).includes('work on it'));
      const inbox = join(treeDirOf(root.id), 'inbox', child.id.slice(0, 8));
      mkdirSync(inbox, { recursive: true });
      writeFileSync(join(inbox, 'from-parent.md'), '# Redirect\n\nStop at the API layer.\n');
      await waitFor(child.id, settled, 40_000);
      expect(store.getRun(child.id)?.status).toBe('done'); // the mock answers a digest with DONE
      expect(delivered(stdinFile, '## Tree inbox')).toContain('from-parent.md');
      expect(notes(child.id).some((n) => n.startsWith('tree inbox digest delivered into the session at turn end'))).toBe(true);
    }, 60_000);

    // #997: the Guard park wins over an inbox delivery even when task-reference lines trail the
    // marker. The guard runs BEFORE the ask is resolved and a delivery auto-continues the turn,
    // so reading the raw text there let a sibling's message answer the question instead of the
    // human — and suppressed the ask card the normalization had just recovered.
    it('keeps a Guard question ahead of an inbox delivery when task references trail it', async () => {
      const stdinFile = join(repoRoot, 'mock-stdin-own-inbox-ask-refs.ndjson');
      savedEnv.ONNI_MOCK_STDIN_FILE = process.env.ONNI_MOCK_STDIN_FILE;
      process.env.ONNI_MOCK_STDIN_FILE = stdinFile;
      const root = store.createRun({ title: 'root', workflow: 'quick-task', task: 'hold', steps: [] });
      store.updateRun(root.id, { status: 'waiting', dispatch: rootOf(root.id) });
      const child = start('mock:pause mock:ask-refs which library?', childOf(root.id), { autonomous: true });
      await waitFor(child.id, () => stdin(stdinFile).includes('which library?'));
      const inbox = join(treeDirOf(root.id), 'inbox', child.id.slice(0, 8));
      mkdirSync(inbox, { recursive: true });
      writeFileSync(join(inbox, 'from-parent.md'), '# Redirect\n\nStop at the API layer.\n');
      await waitFor(child.id, (r) => r?.status === 'waiting', 40_000);
      expect(store.getRun(child.id)?.dispatch?.pendingAsk?.questions).toHaveLength(1);
      expect(notes(child.id).some((n) => n.startsWith('tree inbox digest delivered into the session at turn end'))).toBe(false);
    }, 60_000);

    it('keeps an inbox delivery ahead of a monitoring park at turn end', async () => {
      const stdinFile = join(repoRoot, 'mock-stdin-own-inbox-monitoring.ndjson');
      savedEnv.ONNI_MOCK_STDIN_FILE = process.env.ONNI_MOCK_STDIN_FILE;
      process.env.ONNI_MOCK_STDIN_FILE = stdinFile;
      const root = store.createRun({ title: 'root', workflow: 'quick-task', task: 'hold', steps: [] });
      store.updateRun(root.id, { status: 'waiting', dispatch: rootOf(root.id) });
      const child = start('mock:pause mock:monitoring keep watching', childOf(root.id), { autonomous: true });
      await waitFor(child.id, () => stdin(stdinFile).includes('keep watching'));
      const inbox = join(treeDirOf(root.id), 'inbox', child.id.slice(0, 8));
      mkdirSync(inbox, { recursive: true });
      writeFileSync(join(inbox, 'from-parent.md'), '# Redirect\n\nKeep going with the parent\'s latest instruction.\n');

      // The note is persisted immediately after sendMessage accepts the delivery, while the
      // mock's stdin writer may flush its JSON line a tick later. Wait for the actual inbound
      // evidence before asking `delivered` to parse the file; otherwise the regression itself
      // races the fixture and can report a false failure under suite load.
      await waitFor(child.id, () => stdin(stdinFile).includes('## Tree inbox'), 40_000);
      expect(delivered(stdinFile, '## Tree inbox')).toContain('from-parent.md');
      expect(notes(child.id).some((n) => n.startsWith('tree inbox digest delivered into the session at turn end'))).toBe(true);
      expect(store.getRun(child.id)?.activity).toBeUndefined();
    }, 60_000);

    it('tells a parked parent, through its inbox, that a child is blocked on the Guard', async () => {
      const stdinFile = join(repoRoot, 'mock-stdin-blocked.ndjson');
      savedEnv.ONNI_MOCK_STDIN_FILE = process.env.ONNI_MOCK_STDIN_FILE;
      process.env.ONNI_MOCK_STDIN_FILE = stdinFile;
      const parent = await parkedRoot();
      const child = start('mock:ask which library?', childOf(parent.id), { autonomous: true });
      await waitFor(child.id, (r) => r?.status === 'waiting');
      expect(store.getRun(child.id)?.dispatch?.pendingAsk?.questions).toHaveLength(1);
      expect(store.getRun(child.id)?.attentionRequest?.requestId).toBe(store.getRun(child.id)?.dispatch?.pendingAsk?.requestId);
      const rootInbox = join(treeDirOf(parent.id), 'inbox', 'root');
      const blocked = readdirSync(rootInbox).find((name) => name.includes('blocked-on-a-guard'));
      expect(blocked).toBeTruthy();
      await waitFor(parent.id, () => stdin(stdinFile).includes('## Tree inbox'));
      expect(store.getRun(child.id)?.status).toBe('waiting'); // nothing answered its question
    }, 60_000);
  });

  // ---- the pending question (the Guard) ------------------------------------------------------

  describe('pendingAsk', () => {
    it('native attention persists a snapshot without Guard routing or waking the parent', async () => {
      const parent = await parkedRoot();
      delete process.env.ONNI_DRY_RUN;
      process.env.ONNI_CODEX_BIN = join(import.meta.dirname, '../core/__fixtures__/codex/mock-codex-app-server.mjs');
      const child = start('mock:native-codex-ask choose a library', childOf(parent.id), { runner: 'codex' });
      await waitFor(child.id, (r) => r?.status === 'waiting');
      // Any later parent wake/continuation must still use the bundled dry-run runner.
      process.env.ONNI_DRY_RUN = '1';
      const parked = store.getRun(child.id);
      expect(parked?.attentionRequest?.questions.length).toBeGreaterThan(0);
      expect(parked?.dispatch?.pendingAsk).toBeUndefined();
      const rootInbox = join(treeDirOf(parent.id), 'inbox', 'root');
      expect(existsSync(rootInbox) && readdirSync(rootInbox).some((name) => name.includes('blocked-on-a-guard'))).toBe(false);
      expect(store.getRun(parent.id)?.activity).toBe('monitoring');
      expect(manager.sendMessage(child.id, [{ type: 'text', text: 'Library: Vitest' }])).toBe(true);
      expect(store.getRun(child.id)?.attentionRequest).toBeUndefined();
    }, 40_000);

    it('records a dispatched run’s question when it parks and clears it when an answer is delivered', async () => {
      reboot({ maxParallel: 1, maxMonitoringSessions: 0 });
      const record = start('mock:ask which library?', rootOf('m8'), { autonomous: true });
      await waitFor(record.id, (r) => r?.status === 'waiting');
      expect(store.getRun(record.id)?.dispatch?.pendingAsk?.questions).toHaveLength(1);
      expect(manager.sendMessage(record.id, [{ type: 'text', text: 'mock:done use date-fns' }])).toBe(true);
      expect(store.getRun(record.id)?.dispatch?.pendingAsk).toBeUndefined();
      await waitFor(record.id, settled);
    }, 40_000);

    // A card may now carry up to ASK_MAX_QUESTIONS, but this RECORD field may not: it is read
    // back by an all-or-nothing index parser, so an over-long list in a fresh `runs.json` would
    // cost an older onni every task in the project, not just the park.
    it('truncates a six-question park to the record’s bound and counts the rest', async () => {
      const parent = await parkedRoot();
      const child = start('mock:ask-many pick a path', childOf(parent.id), { autonomous: true });
      await waitFor(child.id, (r) => r?.status === 'waiting');
      const parked = store.getRun(child.id);
      expect(parked?.dispatch?.pendingAsk?.questions).toHaveLength(PENDING_ASK_MAX_QUESTIONS);
      expect(parked?.dispatch?.pendingAsk?.omittedQuestions).toBe(6 - PENDING_ASK_MAX_QUESTIONS);
      // The point of the truncation: the record still parses, so the index keeps every task.
      expect(runRecordSchema.safeParse(parked).success).toBe(true);
      // Nothing is hidden from the parent — the Guard inbox message is a file under no schema.
      const rootInbox = join(treeDirOf(parent.id), 'inbox', 'root');
      const guard = readdirSync(rootInbox).find((name) => name.includes('blocked-on-a-guard'));
      expect(guard).toBeTruthy();
      const body = readFileSync(join(rootInbox, guard!), 'utf8');
      for (let index = 0; index < 6; index += 1) {
        expect(body).toContain(`Decision ${index} — which way?`);
      }
    }, 60_000);
  });

  // ---- brakes -------------------------------------------------------------------------------

  it('parks an over-budget run at waiting — no autonomous nudge, no wake timer', async () => {
    reboot({ maxParallel: 1, maxMonitoringSessions: 0 });
    const record = start('mock:monitoring keep going', rootOf('m6', 0), { autonomous: true });
    await waitFor(record.id, (r) => r?.status === 'waiting');
    expect(store.getRun(record.id)?.dispatch?.overBudget).toBe(true);
    expect(store.getRun(record.id)?.activity).toBeUndefined();
    expect(activeState(record.id)?.monitoringWakeTimer).toBeUndefined();
    expect(notes(record.id).some((n) => n.startsWith('budget spent'))).toBe(true);
  }, 40_000);

  it('cancels a whole subtree, deepest first', async () => {
    const root = start('mock:monitoring hold', rootOf('m7'));
    await waitFor(root.id, (r) => r?.activity === 'monitoring');
    const child = store.createRun({ title: 'child', workflow: '(planned)', task: 't', steps: [] });
    store.updateRun(child.id, { status: 'waiting', dispatch: childOf(root.id) });
    const grandchild = store.createRun({ title: 'grandchild', workflow: '(planned)', task: 't', steps: [] });
    store.updateRun(grandchild.id, { status: 'queued', dispatch: { rootRunId: root.id, parentRunId: child.id } });
    // Queued in the manager's own queue so `cancel` has something to drop.
    (manager as unknown as { queue: string[] }).queue.push(grandchild.id);
    expect(manager.cancel(root.id)).toBe(true);
    expect(store.getRun(grandchild.id)?.status).toBe('cancelled');
    await waitFor(root.id, (r) => r?.status === 'cancelled');
  }, 40_000);

  // ---- the Guard: an autonomous dispatched run never answers its own ONNI:ASK ------------------

  describe('the Guard', () => {
    it('parks a dispatched run at waiting with the ask card instead of nudging it onward', async () => {
      reboot({ maxParallel: 1, maxMonitoringSessions: 0 });
      const record = start('mock:ask which library?', rootOf('m9'), { autonomous: true });
      await waitFor(record.id, (r) => r?.status === 'waiting');
      expect(notes(record.id).some((n) => n.includes('autonomous — continuing'))).toBe(false);
    }, 40_000);

    it('leaves a NON-dispatch autonomous run auto-continuing, exactly as before', async () => {
      reboot({ maxParallel: 1, maxMonitoringSessions: 0 });
      const record = start('mock:ask mock:autonomous which library?', undefined, { autonomous: true });
      await waitFor(record.id, settled);
      expect(notes(record.id).some((n) => n.includes('autonomous — continuing'))).toBe(true);
    }, 40_000);
  });

  // ---- the counterweight ---------------------------------------------------------------------

  describe('a run with no dispatch is untouched', () => {
    it('settles the way it always did, with no tree directory and no dispatch env', async () => {
      const record = start('mock:done plain task');
      await waitFor(record.id, settled);
      expect(store.getRun(record.id)?.dispatch).toBeUndefined();
      expect(existsSync(join(repoRoot, '.ai/onni/dispatch'))).toBe(false);
    }, 40_000);
  });

  describe('manager scorecard and ledger evidence', () => {
    const scorecardRoster = rosterSchema.parse({
      manager: { runner: 'claude' },
      workers: [{ runner: 'codex', model: 'gpt-5', role: 'private-role-text', tier: 'heavy', kinds: ['implement', 'test'], maxConcurrent: 2 }],
    });

    it('adds a bounded history block without task titles or prompts after enough settled samples', async () => {
      process.env.ONNI_API_URL = 'http://127.0.0.1:4321/api/v1';
      const finishedAt = new Date().toISOString();
      for (let index = 0; index < 3; index += 1) {
        const historical = store.createRun({
          title: `scorecard-private-title-${index}`,
          workflow: '(planned)',
          task: `scorecard-private-prompt-${index}`,
          steps: [],
        });
        store.updateRun(historical.id, {
          status: 'done',
          runner: 'codex',
          startedAt: finishedAt,
          finishedAt,
          tokensUsed: 300,
          dispatch: { rootRunId: 'historical-tree', parentRunId: 'historical-tree', workerKey: 'codex:gpt-5', kind: 'implement' },
        });
      }

      const managerRun = start('mock:monitoring scorecard manager', undefined, { roster: scorecardRoster });
      const activeRuns = manager as unknown as { active: Map<string, { dispatchPrompt?: string }> };
      await waitFor(managerRun.id, () => activeRuns.active.get(managerRun.id)?.dispatchPrompt !== undefined);
      const prompt = activeRuns.active.get(managerRun.id)?.dispatchPrompt ?? '';
      const scorecardBlock = prompt.slice(prompt.indexOf('## Worker scorecard'));
      expect(prompt).toContain('## Worker scorecard (settled work, last 30 days)');
      expect(prompt).toContain('codex:gpt-5 | impl 100%/3');
      expect(prompt.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
      expect(scorecardBlock).not.toContain('scorecard-private-title');
      expect(scorecardBlock).not.toContain('scorecard-private-prompt');
      expect(scorecardBlock).not.toContain('private-role-text');
    }, 60_000);

    it('omits the scorecard block when the roster has no settled history', async () => {
      process.env.ONNI_API_URL = 'http://127.0.0.1:4321/api/v1';
      const noHistoryRun = start('mock:monitoring manager without worker history', undefined, { roster: scorecardRoster });
      const activeRuns = manager as unknown as { active: Map<string, { dispatchPrompt?: string }> };
      await waitFor(noHistoryRun.id, () => activeRuns.active.get(noHistoryRun.id)?.dispatchPrompt !== undefined);
      const noHistoryPrompt = activeRuns.active.get(noHistoryRun.id)?.dispatchPrompt ?? '';
      expect(noHistoryPrompt).not.toContain('## Worker scorecard');
    }, 60_000);

    it('records the selected worker and one privacy-safe roster snapshot on first dispatch', async () => {
      const root = start('mock:monitoring manager ledger root', undefined, { roster: scorecardRoster });
      await waitFor(root.id, (record) => record?.activity === 'monitoring');
      const first = dispatchOk(root.id, order('mock:monitoring first order', { backend: 'codex', model: 'gpt-5', kind: 'implement' }));
      expect(first.id).toBeTruthy();

      const lines = readFileSync(join(treeDirOf(root.id), 'ledger.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines.filter((entry) => entry.type === 'roster')).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        type: 'roster',
        workers: [{ key: 'codex:gpt-5', tier: 'heavy', kinds: ['implement', 'test'], concurrency: 2 }],
      });
      expect(lines[0]).not.toHaveProperty('role');
      expect(lines[0]).not.toHaveProperty('path');
      expect(lines[1]).toMatchObject({
        type: 'dispatch',
        runId: first.id,
        workerKey: 'codex:gpt-5',
        workerTier: 'heavy',
        workerKinds: ['implement', 'test'],
        kind: 'implement',
      });
    }, 60_000);
  });
});
