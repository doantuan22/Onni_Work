import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunStore } from '../runs/store.ts';
import { RunManager } from './run.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import { isUnattended } from './unattended.ts';

let root: string, store: RunStore, manager: RunManager;
const workflow = { name: 'quick-task', source: 'built-in' as const, steps: [{ id: 'task', name: 'Task', prompt: '{{task}}' }] };
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

beforeEach(() => {
  vi.stubEnv('ONNI_DRY_RUN', '1');
  vi.stubEnv('ONNI_AUTO_NAMING', '0');
  root = mkdtempSync(join(tmpdir(), 'onni-unattended-landing-'));
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'a.txt'), 'base\n');
  git('add', '.');
  git('-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-qm', 'base');
  mkdirSync(join(root, '.ai/onni'), { recursive: true });
  writeFileSync(join(root, '.ai/onni/config.json'), JSON.stringify({ landing: 'auto' }));
  store = RunStore.open(join(root, '.ai/onni'));
  manager = new RunManager(store, root, { semaphore: new WorkspaceSemaphore({ initial: { maxParallel: 0 } }) });
});
afterEach(() => {
  for (const run of store.listRuns()) manager.cancel(run.id);
  manager.dispose();
  store.flush();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function inPlaceRun(patch: Parameters<RunStore['updateRun']>[1] = {}) {
  const run = store.createRun({ title: 't', task: 'Task', workflow: 'quick-task', steps: [{ id: 'task', name: 'Task', kind: 'agent' }] });
  store.updateStep(run.id, 'task', { status: 'done', sessionId: 'mock-session' });
  store.updateRun(run.id, { status: 'review', workflowDef: workflow, worktree: false, baseBranch: git('rev-parse', 'HEAD'), ...patch });
  writeFileSync(join(root, 'a.txt'), 'changed\n');
  return run;
}

it('defines unattended as autonomous or dispatched', () => {
  expect(isUnattended({ autonomous: true })).toBe(true);
  expect(isUnattended({ dispatch: { rootRunId: 'r', parentRunId: 'p' } })).toBe(true);
  expect(isUnattended({ dispatch: { rootRunId: 'r' } })).toBe(false);
  expect(isUnattended({})).toBe(false);
});

it.each([
  ['autonomous', { autonomous: true }],
  ['dispatched child', { dispatch: { rootRunId: 'root', parentRunId: 'parent' } }],
])('landing:auto never lands a %s run', async (_name, patch) => {
  const run = inPlaceRun(patch);
  const before = git('rev-parse', 'HEAD');
  expect((await manager.land(run.id)).outcome).toBe('unavailable');
  expect(git('rev-parse', 'HEAD')).toBe(before);
  expect(run.landing).toBeUndefined();
});

it('landing:auto still lands an attended in-place run', async () => {
  const run = inPlaceRun();
  expect((await manager.land(run.id)).outcome).toBe('landed');
});
