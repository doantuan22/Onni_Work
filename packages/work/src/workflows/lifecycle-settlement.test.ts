import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RunStore } from '../runs/store.ts';
import { fakeProgram } from '../test-fixtures/fake-program.testkit.ts';
import { WebhookService } from '../webhooks/service.ts';
import { WebhookScheduler } from '../webhooks/scheduler.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import { RunManager } from './run.ts';
import type { WorkflowDef } from './types.ts';

const workflow: WorkflowDef = {
  name: 'quick-task', source: 'built-in', steps: [{ id: 'task', name: 'Task', prompt: '{{task}}' }],
};
const waitFor = async (predicate: () => boolean) => {
  await vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 15_000, interval: 25 });
};

/** Resolve the real git before the fake becomes the first `git` on PATH. */
function realGitPath(): string {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const extension of process.platform === 'win32' ? ['.exe', ''] : ['']) {
      const candidate = join(dir, `git${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error('git is not on PATH');
}

/** Gate one product git call so a cancellation can race it, then delegate to the real git. */
function gatedGit(bin: string, gate: 'completion' | 'review'): { signal: string; release: string } {
  const signal = join(bin, 'probing');
  const release = join(bin, 'release');
  const condition = gate === 'completion'
    ? `args[0] === 'diff' && args[1] === '--name-only' && args.length === 4 && args[3] === '--'`
    : `args[0] === 'diff' && args.length === 2`;
  fakeProgram('git', {
    dir: bin,
    body: `
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
if (${condition}) {
  fs.writeFileSync(${JSON.stringify(signal)}, '');
  const cell = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(${JSON.stringify(release)})) Atomics.wait(cell, 0, 0, 20);
}
const run = spawnSync(${JSON.stringify(realGitPath())}, args, { stdio: 'inherit' });
process.exit(run.status ?? 1);
`,
  }).use();
  return { signal, release };
}
let root: string;
let store: RunStore;
let manager: RunManager;
let service: WebhookService;
let receiverId: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'onni-lifecycle-settlement-'));
  vi.stubEnv('ONNI_WEBHOOKS', '1');
  vi.stubEnv('ONNI_AUTO_NAMING', '0');
  vi.stubEnv('ONNI_DRY_RUN', '0');
  vi.stubEnv('ONNI_REVIEW_GATE', '0');
  vi.stubEnv('ONNI_CLAUDE_BIN', join(import.meta.dirname, '../../scripts/mock-claude.mjs'));
  vi.stubEnv('ONNI_CODEX_BIN', join(import.meta.dirname, '../core/__fixtures__/codex/mock-codex-app-server.mjs'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  writeFileSync(join(root, 'a.txt'), 'base\n');
  writeFileSync(join(root, '.gitignore'), '.ai/\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base'], { cwd: root });
  store = RunStore.open(join(root, '.ai/onni'));
  manager = new RunManager(store, root);
  service = (await WebhookService.open({
    root, dataDir: join(root, '.ai/onni'), projectId: 'lifecycle', mode: 'local',
    serverPorts: () => [], scheduler: new WebhookScheduler(),
    send: async () => ({ kind: 'http', status: 200 }),
  }))!;
  const { receiver } = await service.create({ name: 'lifecycle', url: 'https://example.com', graceSeconds: 0 });
  receiverId = receiver.id;
  await service.activate(receiverId, 1);
  service.attach(store, manager, true);
});

afterEach(async () => {
  for (const run of store.listRuns()) manager.cancel(run.id);
  await waitFor(() => store.listRuns().every(run => !manager.isActive(run.id)));
  manager.dispose();
  await service.dispose();
  store.flush();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});

it.each([
  { continuation: false, replace: false },
  { continuation: true, replace: false },
  { continuation: false, replace: true },
  { continuation: true, replace: true },
])('completion classification respects cancellation and ownership ($continuation, $replace)', async ({ continuation, replace }) => {
  // Observe the real settlement promise so a retired generation can be awaited even
  // after the public isActive() flag belongs to its replacement. No implementation is mocked.
  const settlement = vi.spyOn(manager as unknown as { settleSuccess: (...args: unknown[]) => Promise<boolean> }, 'settleSuccess');
  let id = '';
  if (continuation) {
    id = manager.startRun(workflow, { task: 'mock:done initial', worktree: true }).id;
    await waitFor(() => store.getRun(id)?.status === 'done' && !manager.isActive(id));
    await service.tick();
  }
  // Gate only completionReason's exact diff invocation; every other Git command is real.
  const bin = join(root, '.ai/bin');
  const { signal, release } = gatedGit(bin, 'completion');
  const finishedDeliveries = () => service.deliveries(receiverId).filter(delivery => delivery.body?.includes('task.finished')).length;
  const previousDeliveries = finishedDeliveries();
  if (continuation) expect(manager.continueRun(id, { text: 'mock:done continued' }).ok).toBe(true);
  else id = manager.startRun(workflow, { task: 'mock:done initial', worktree: true }).id;
  await waitFor(() => existsSync(signal));
  const settling = settlement.mock.results.at(-1)!.value as Promise<boolean>;
  expect(manager.cancel(id)).toBe(true);
  expect(store.getRun(id)?.status).toBe('cancelled');
  if (replace) {
    // Let cancellation's grace timer retire the old owner while Git is still blocked.
    await waitFor(() => !manager.isActive(id));
    expect(manager.continueRun(id, { text: 'mock:ask replacement question' }).ok).toBe(true);
    await waitFor(() => store.getRun(id)?.status === 'waiting');
  }
  const replacementQuestion = store.getRun(id)?.attentionRequest;
  writeFileSync(release, '');
  await settling;
  if (!replace) await waitFor(() => !manager.isActive(id));
  await service.tick();
  expect(store.getRun(id)?.status).toBe(replace ? 'waiting' : 'cancelled');
  if (replace) {
    expect(manager.isActive(id)).toBe(true);
    expect(store.getRun(id)?.attentionRequest).toEqual(replacementQuestion);
  }
  expect(store.getRun(id)?.completionReason).toBeUndefined();
  expect(finishedDeliveries()).toBe(previousDeliveries);
}, 30_000);

it.each([false, true])('idle continuation respects cancellation during review Git (replacement: %s)', async (replace) => {
  const id = manager.startRun(workflow, { task: 'mock:done initial', worktree: true }).id;
  await waitFor(() => store.getRun(id)?.status === 'done' && !manager.isActive(id));
  await service.tick();
  const finishedDeliveries = () => service.deliveries(receiverId).filter(delivery => delivery.body?.includes('task.finished')).length;
  const deliveriesBefore = finishedDeliveries();
  // Observe the entire retired continuation, including its finally block, without
  // mocking settlement or relying on the replacement's isActive flag to await it.
  const continuation = vi.spyOn(manager as unknown as {
    runContinuation: (...args: unknown[]) => Promise<void>;
  }, 'runContinuation');
  expect(manager.continueRun(id, { text: 'ordinary followup' }).ok).toBe(true);
  const retiring = continuation.mock.results.at(-1)!.value as Promise<void>;
  await waitFor(() => store.getRun(id)?.status === 'waiting');
  const stepId = store.getRun(id)!.currentStepId!;
  expect(stepId).toBeDefined();
  const bin = join(root, '.ai/bin');
  // Gate the real review-gate diff, leaving all other Git operations untouched.
  const { signal, release } = gatedGit(bin, 'review');
  const live = (manager as unknown as {
    active: Map<string, { idleClosed?: boolean; session: { end: () => void } }>;
  }).active.get(id)!;
  live.idleClosed = true;
  live.session.end();
  try {
    await waitFor(() => existsSync(signal));
    expect(manager.cancel(id)).toBe(true);
    expect(store.getRun(id)?.status).toBe('cancelled');
    if (replace) {
      await waitFor(() => !manager.isActive(id));
      expect(manager.continueRun(id, { text: 'mock:ask replacement question' }).ok).toBe(true);
      await waitFor(() => store.getRun(id)?.status === 'waiting');
    }
    const before = structuredClone(store.getRun(id)!);
    expect(before.steps.find(step => step.id === stepId)).toBeDefined();
    if (replace) expect(before.attentionRequest?.questions.length).toBeGreaterThan(0);
    writeFileSync(release, '');
    await retiring;
    await service.tick();
    const after = store.getRun(id)!;
    expect(after.status).toBe(replace ? 'waiting' : 'cancelled');
    expect(after.attentionRequest).toEqual(before.attentionRequest);
    expect(after.currentStepId).toBe(before.currentStepId);
    expect(after.steps.find(step => step.id === stepId)).toEqual(before.steps.find(step => step.id === stepId));
    expect(after.error).toBe(before.error);
    expect(after.completionReason).toBeUndefined();
    expect(manager.isActive(id)).toBe(replace);
    expect(finishedDeliveries()).toBe(deliveriesBefore);
  } finally {
    writeFileSync(release, '');
    await retiring;
  }
}, 30_000);

it('recovers a persisted unanswered native Codex question without reporting success', async () => {
  const id = manager.startRun(workflow, {
    task: 'mock:native-codex-ask choose a library', runner: 'codex', worktree: false,
  }).id;
  await waitFor(() => store.getRun(id)?.status === 'waiting');
  expect(store.getRun(id)?.attentionRequest?.questions.length).toBeGreaterThan(0);
  expect(store.getRun(id)?.dispatch?.pendingAsk).toBeUndefined();
  store.flush();
  const copy = mkdtempSync(join(tmpdir(), 'onni-lifecycle-restart-'));
  execFileSync('git', ['init', '-q'], { cwd: copy });
  cpSync(join(root, '.ai'), join(copy, '.ai'), { recursive: true });
  const recovered = RunStore.open(join(copy, '.ai/onni'), { keepLive: true });
  const recovery = new RunManager(recovered, copy, { semaphore: new WorkspaceSemaphore({ initial: { maxParallel: 0 } }) });
  const send = vi.fn(async () => ({ kind: 'http' as const, status: 200 }));
  const capture = (await WebhookService.open({
    root: copy, dataDir: join(copy, '.ai/onni'), projectId: 'restart', mode: 'local',
    serverPorts: () => [], scheduler: new WebhookScheduler(), send,
  }))!;
  try {
    capture.attach(recovered, recovery, false);
    await recovery.recover();
    capture.markReady();
    await capture.tick();
    expect(recovered.getRun(id)?.status).toBe('failed');
    expect(recovered.getRun(id)?.awaitingAnswerSince).toBeDefined();
    expect(recovered.getRun(id)?.completionReason).toBeUndefined();
    expect(capture.deliveries(receiverId).some(delivery => delivery.body?.includes('task.finished'))).toBe(false);
  } finally {
    recovery.dispose();
    await capture.dispose();
    recovered.flush();
    rmSync(copy, { recursive: true, force: true, maxRetries: 5 });
  }
}, 30_000);
