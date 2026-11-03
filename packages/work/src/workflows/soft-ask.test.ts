import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MANAGER_ASK_RECORD_QUESTION_MAX_CHARS, rosterSchema } from '@onni/contract';
import { RunStore, type RunRecord } from '../runs/store.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import { SOFT_ASK_EXPIRED_NUDGE } from './manager-worker.ts';
import { RunManager } from './run.ts';
import type { WorkflowDef } from './types.ts';

const runGit = promisify(execFile);
const GIT_ID = ['-c', 'user.name=test', '-c', 'user.email=test@local'];
const SINGLE_STEP: WorkflowDef = {
  name: '(planned)',
  source: 'built-in',
  steps: [{ id: 'task', name: 'Task', prompt: '{{task}}' }],
};
const ROSTER = rosterSchema.parse({ manager: { runner: 'claude' }, workers: [{ runner: 'codex' }] });

/**
 * #10 (plan v2 §9): the manager asks the user WITHOUT parking. The record carries the open
 * question (`dispatch.softAsk`), never `dispatch.pendingAsk` — that field belongs to the Guard and
 * makes a settled child report `blocked`. Everything here is driven through the real `RunManager`;
 * the two delivery tests use the dry-run mock because only a real turn has a session to answer.
 */
describe('a manager question that does not park the turn (#10)', () => {
  let repoRoot: string;
  let store: RunStore;
  let manager: RunManager;
  const savedEnv: Record<string, string | undefined> = {};
  const started: string[] = [];

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-soft-ask-'));
    for (const key of ['ONNI_DRY_RUN', 'ONNI_DISPATCH', 'ONNI_MOCK_STDIN_FILE']) savedEnv[key] = process.env[key];
    process.env.ONNI_DRY_RUN = '1';
    process.env.ONNI_DISPATCH = '1';
    await runGit('git', ['init', '-q', '-b', 'main'], { cwd: repoRoot });
    writeFileSync(join(repoRoot, 'a.txt'), 'one\n');
    await runGit('git', ['add', '-A'], { cwd: repoRoot });
    await runGit('git', [...GIT_ID, 'commit', '-q', '-m', 'base'], { cwd: repoRoot });
    store = RunStore.open(join(repoRoot, '.ai/onni'));
    manager = new RunManager(store, repoRoot, { semaphore: new WorkspaceSemaphore({ initial: {} }) });
    started.length = 0;
  });

  afterEach(async () => {
    for (const id of started) manager.cancel(id);
    const deadline = Date.now() + 10_000;
    while (store.listRuns().some(({ id }) => manager.isActive(id))) {
      if (Date.now() >= deadline) throw new Error('timed out waiting for soft-ask runs to stop');
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

  /** A root-manager record with no agent behind it — enough to exercise the bookkeeping. */
  const rootRecord = (status: RunRecord['status'] = 'running'): RunRecord => {
    const created = store.createRun({ title: 'manager', workflow: '(planned)', task: 't', steps: [] });
    store.updateRun(created.id, { status, dispatch: { rootRunId: created.id }, roster: ROSTER });
    return store.getRun(created.id)!;
  };

  const notes = (id: string): string[] =>
    store.readEvents(id).filter((event) => event.type === 'note').map((event) => String((event as { message?: unknown }).message ?? ''));

  const setExpiry = (id: string, expiresAt: string): void => {
    const dispatch = store.getRun(id)!.dispatch!;
    store.updateRun(id, { dispatch: { ...dispatch, softAsk: { ...dispatch.softAsk!, expiresAt } } });
  };

  const waitFor = async (id: string, pred: (r: RunRecord | undefined) => boolean, ms = 20_000) => {
    const deadline = Date.now() + ms;
    while (!pred(store.getRun(id))) {
      if (Date.now() > deadline) {
        const r = store.getRun(id);
        throw new Error(`condition not met in time for ${id} (status ${r?.status}, activity ${r?.activity})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  const startRoot = (task: string): RunRecord => {
    const record = manager.startRun(SINGLE_STEP, { task });
    started.push(record.id);
    store.updateRun(record.id, { dispatch: { rootRunId: record.id }, roster: ROSTER });
    return record;
  };

  const stdin = (file: string): string => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  };

  const delivered = (file: string, needle: string): string | undefined =>
    stdin(file)
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { userText: string })
      .find((entry) => entry.userText.includes(needle))?.userText;

  // ---- the record ----------------------------------------------------------------------------

  it('asks without parking: status stays running, the record carries softAsk, and the event names the manager', () => {
    const root = rootRecord();
    const outcome = manager.askUser(root.id, {
      question: 'Postgres or SQLite?',
      options: [{ label: 'Postgres', description: 'the deployed one' }, { label: 'SQLite' }],
      timeoutMinutes: 30,
    });
    if ('denied' in outcome) throw new Error(outcome.denied);
    const requestId = outcome.requestId;
    const run = store.getRun(root.id)!;
    expect(run.status).toBe('running');
    expect(run.attentionRequest).toBeUndefined();
    expect(run.dispatch?.pendingAsk).toBeUndefined();
    expect(run.dispatch?.softAsk).toMatchObject({ requestId, question: 'Postgres or SQLite?', optionCount: 2 });
    expect(Date.parse(run.dispatch!.softAsk!.expiresAt!)).toBeGreaterThan(Date.now());

    const ask = store.readEvents(root.id).find((event) => event.type === 'ask.requested')!;
    expect(ask).toMatchObject({ requestId, source: 'manager' });
    expect((ask.questions as Array<{ header: string; options: unknown[] }>)[0]).toMatchObject({
      header: 'Question from the manager',
      question: 'Postgres or SQLite?',
    });
    expect(notes(root.id).some((note) => note.startsWith('asked you:'))).toBe(true);
    expect(readFileSync(join(repoRoot, '.ai/onni/dispatch', root.id, 'ledger.jsonl'), 'utf8')).toContain('"type":"manager-ask"');
    expect((manager as unknown as { softAskTimers: Map<string, unknown> }).softAskTimers.has(root.id)).toBe(true);
  });

  it('cuts the record’s copy of the question but keeps the full one in the event', () => {
    const root = rootRecord();
    const question = 'q'.repeat(MANAGER_ASK_RECORD_QUESTION_MAX_CHARS + 50);
    const outcome = manager.askUser(root.id, { question });
    if ('denied' in outcome) throw new Error(outcome.denied);
    expect(store.getRun(root.id)?.dispatch?.softAsk?.question).toHaveLength(MANAGER_ASK_RECORD_QUESTION_MAX_CHARS);
    const ask = store.readEvents(root.id).find((event) => event.type === 'ask.requested')!;
    expect((ask.questions as Array<{ question: string }>)[0]!.question).toBe(question);
  });

  it('refuses a worker, a plain root, an unknown run, a settled task and a second open question', () => {
    const root = rootRecord();
    const worker = store.createRun({ title: 'w', workflow: '(planned)', task: 't', steps: [] });
    store.updateRun(worker.id, { status: 'running', dispatch: { rootRunId: root.id, parentRunId: root.id }, roster: ROSTER });
    expect(manager.askUser(worker.id, { question: 'x' })).toMatchObject({ status: 403 });

    const plain = store.createRun({ title: 'p', workflow: '(planned)', task: 't', steps: [] });
    store.updateRun(plain.id, { status: 'running', dispatch: { rootRunId: plain.id } });
    expect(manager.askUser(plain.id, { question: 'x' })).toMatchObject({ status: 403 });

    expect(manager.askUser('nope', { question: 'x' })).toMatchObject({ status: 404 });

    expect('requestId' in manager.askUser(root.id, { question: 'one' })).toBe(true);
    expect(manager.askUser(root.id, { question: 'two' })).toMatchObject({ status: 409 });

    const settled = rootRecord('done');
    expect(manager.askUser(settled.id, { question: 'late' })).toMatchObject({ status: 409 });
  });

  it('refuses when the Guard already holds the task’s one open question', () => {
    const root = rootRecord();
    store.updateRun(root.id, {
      dispatch: { rootRunId: root.id, pendingAsk: { questions: ['library?'], askedAt: new Date().toISOString() } },
    });
    expect(manager.askUser(root.id, { question: 'and this?' })).toMatchObject({ status: 409 });
    expect(store.getRun(root.id)?.dispatch?.softAsk).toBeUndefined();
  });

  // ---- answering -----------------------------------------------------------------------------

  it('a free message keeps the question; only the answer naming it clears it — and both reach the manager', async () => {
    const stdinFile = join(repoRoot, 'mock-stdin-soft-ask.ndjson');
    process.env.ONNI_MOCK_STDIN_FILE = stdinFile;
    const root = startRoot('mock:pause plan the work');
    await waitFor(root.id, () => stdin(stdinFile).includes('plan the work'));

    const outcome = manager.askUser(root.id, { question: 'which database?' });
    if ('denied' in outcome) throw new Error(outcome.denied);

    expect(manager.sendMessage(root.id, [{ type: 'text', text: 'a free note' }])).toBe(true);
    expect(store.getRun(root.id)?.dispatch?.softAsk?.requestId).toBe(outcome.requestId);
    expect(delivered(stdinFile, 'a free note')).toContain('a free note');

    expect(manager.sendMessage(root.id, [{ type: 'text', text: 'SQLite' }], outcome.requestId)).toBe(true);
    expect(store.getRun(root.id)?.dispatch?.softAsk).toBeUndefined();
    // `delivered` parses the NDJSON: the hook JSON-escapes the question's quotes.
    await waitFor(root.id, () => delivered(stdinFile, 'User answered your question') !== undefined);
    const answer = delivered(stdinFile, 'which database?');
    expect(answer).toContain('User answered your question "which database?": SQLite');
  }, 40_000);

  it('keeps the question after the manager settles, and the answer resumes the session naming the question', async () => {
    const stdinFile = join(repoRoot, 'mock-stdin-soft-ask-resume.ndjson');
    process.env.ONNI_MOCK_STDIN_FILE = stdinFile;
    // `mock:done` closes the session at the end of the 2 s pause, so the answer arrives after it.
    const root = startRoot('mock:pause mock:done hold on');
    await waitFor(root.id, () => stdin(stdinFile).includes('hold on'));

    const outcome = manager.askUser(root.id, { question: 'which database?' });
    if ('denied' in outcome) throw new Error(outcome.denied);

    await waitFor(root.id, (r) => r?.status === 'done' || r?.status === 'review');
    expect(store.getRun(root.id)?.dispatch?.softAsk?.requestId).toBe(outcome.requestId);

    expect(manager.continueRun(root.id, { text: 'mock:done SQLite', replyTo: outcome.requestId })).toEqual({ ok: true });
    expect(store.getRun(root.id)?.dispatch?.softAsk).toBeUndefined();
    await waitFor(root.id, () => delivered(stdinFile, 'User answered your question') !== undefined);
  }, 60_000);

  // ---- expiry and recovery -------------------------------------------------------------------

  it('an expiry never answers a Guard question that is still open', async () => {
    const stdinFile = join(repoRoot, 'mock-stdin-soft-ask-guard.ndjson');
    process.env.ONNI_MOCK_STDIN_FILE = stdinFile;
    const root = startRoot('mock:pause hold on');
    await waitFor(root.id, () => stdin(stdinFile).includes('hold on'));
    const outcome = manager.askUser(root.id, { question: 'which database?', timeoutMinutes: 5 });
    if ('denied' in outcome) throw new Error(outcome.denied);
    await waitFor(root.id, (r) => r?.status === 'waiting');

    // The Guard parks the same run with its own open question (the record shape `recordAsk` writes).
    store.updateRun(root.id, {
      dispatch: {
        ...store.getRun(root.id)!.dispatch!,
        pendingAsk: { questions: ['library?'], askedAt: new Date().toISOString() },
      },
    });
    setExpiry(root.id, new Date(Date.now() - 1_000).toISOString());
    (manager as unknown as { recoverSoftAsks(): void }).recoverSoftAsks();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const run = store.getRun(root.id)!;
    expect(run.dispatch?.softAsk?.requestId).toBe(outcome.requestId);
    expect(run.dispatch?.pendingAsk?.questions).toEqual(['library?']);
    expect(notes(root.id).some((note) => note.includes('no answer to "which database?" by its deadline'))).toBe(true);
    expect(delivered(stdinFile, 'No answer by the deadline')).toBeUndefined();
  }, 40_000);

  it('an expired question with no session stays on the record, and the next brief retires it there', async () => {
    const root = rootRecord();
    const outcome = manager.askUser(root.id, { question: 'which database?', timeoutMinutes: 5 });
    if ('denied' in outcome) throw new Error(outcome.denied);
    setExpiry(root.id, new Date(Date.now() - 1_000).toISOString());

    (manager as unknown as { recoverSoftAsks(): void }).recoverSoftAsks();
    expect(store.getRun(root.id)?.dispatch?.softAsk?.requestId).toBe(outcome.requestId);
    expect(notes(root.id).some((note) => note.includes('no answer to "which database?" by its deadline'))).toBe(true);

    const context = await (manager as unknown as {
      loadManagerSessionContext(id: string, state: { currentStepId?: string }): Promise<{ expiredAsk?: { question: string } }>;
    }).loadManagerSessionContext(root.id, { currentStepId: 'task' });
    expect(context.expiredAsk).toEqual({ question: 'which database?' });
    expect(store.getRun(root.id)?.dispatch?.softAsk).toBeUndefined();
    expect(notes(root.id).some((note) => note.includes('its deadline passed while the session was closed'))).toBe(true);
  });

  it('recover re-arms a live deadline, and a delete surface forgets the question', () => {
    const root = rootRecord();
    const outcome = manager.askUser(root.id, { question: 'which database?', timeoutMinutes: 30 });
    if ('denied' in outcome) throw new Error(outcome.denied);
    manager.dispose();

    manager = new RunManager(store, repoRoot, { semaphore: new WorkspaceSemaphore({ initial: {} }) });
    (manager as unknown as { recoverSoftAsks(): void }).recoverSoftAsks();
    const timers = (manager as unknown as { softAskTimers: Map<string, unknown> }).softAskTimers;
    expect(timers.has(root.id)).toBe(true);

    manager.forgetSoftAsk(root.id);
    expect(store.getRun(root.id)?.dispatch?.softAsk).toBeUndefined();
    expect(timers.has(root.id)).toBe(false);
  });

  it('cancelling a queued run clears the question and its timer', () => {
    const root = rootRecord();
    const outcome = manager.askUser(root.id, { question: 'which database?' });
    if ('denied' in outcome) throw new Error(outcome.denied);
    store.updateRun(root.id, { status: 'queued' });
    (manager as unknown as { queue: string[] }).queue.push(root.id);

    expect(manager.cancel(root.id)).toBe(true);
    expect(store.getRun(root.id)?.status).toBe('cancelled');
    expect(store.getRun(root.id)?.dispatch?.softAsk).toBeUndefined();
  });

  it('the expiry nudge is the exact sentence the plan names', () => {
    expect(SOFT_ASK_EXPIRED_NUDGE).toBe('No answer by the deadline. Take the safe default, say which one you chose, and continue.');
  });
});
