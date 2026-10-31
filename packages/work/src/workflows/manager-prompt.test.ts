import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rosterSchema } from '@onni/contract';
import { RunStore } from '../runs/store.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import { managerPrompt, WORKER_PROMPT, workerPrompt } from './manager-worker.ts';
import { RunManager } from './run.ts';

const roster = rosterSchema.parse({
  manager: { runner: 'claude', model: 'opus' },
  workers: [
    { runner: 'codex', model: 'gpt-5', role: 'backend tests and migrations', maxConcurrent: 2 },
    { runner: 'opencode', role: 'documentation and changelogs' },
    { runner: 'codex', model: 'mini', role: 'mechanical renames' },
  ],
});
const budget = { unlimited: false, costUsd: 7.5, tokens: 4_200_000, minutes: 180, steps: 25, subtasks: 9, maxDepth: 1 };

describe('managerPrompt', () => {
  const prompt = managerPrompt(roster, budget);

  it('lists every worker with its model, role and concurrency', () => {
    expect(prompt).toContain('- codex (gpt-5) — backend tests and migrations. Up to 2 at once.');
    expect(prompt).toContain('- opencode — documentation and changelogs. Up to 1 at once.');
    expect(prompt).toContain('- codex (mini) — mechanical renames.');
    expect(prompt).toContain('(claude (opus))');
  });
  it('teaches --backend (not --runner), --model, scopes and waiting for reports', () => {
    expect(prompt).toContain('onni task create "<objective>" --backend <worker backend> [--model <model>]');
    expect(prompt).not.toContain('--runner');
    expect(prompt).toContain('DISJOINT file scopes');
    expect(prompt).toContain('ONNI:MONITORING');
    expect(prompt).toContain('Dispatch EVERY independent part first');
    expect(prompt).toContain('do not end the turn with ONNI:DONE while any worker you dispatched has not reported');
    expect(prompt).toContain('server refuses any other backend or model with a 409');
  });
  it('spells out the integration procedure', () => {
    expect(prompt).toContain('git merge --no-ff <worker branch>');
    expect(prompt).toContain('one at a time');
    expect(prompt).toContain('Resolve any conflict yourself');
    expect(prompt).toContain('Run the repository\'s checks after EACH merge');
    expect(prompt).toContain('Do NOT merge a worker whose status is failed or blocked');
    expect(prompt).toContain('report the final result');
    expect(prompt).toContain('never push');
  });
  it('states what is left: budget, tokens, time, steps, subtasks and depth', () => {
    expect(prompt).toContain('$7.50 of budget');
    expect(prompt).toContain('4,200,000 tokens');
    expect(prompt).toContain('180 minutes of running time');
    expect(prompt).toContain('25 agent steps');
    expect(prompt).toContain('Subtasks left in this tree: 9');
    expect(prompt).toContain('a worker cannot dispatch further tasks');
  });
  it('says so plainly when the tree has no ceilings', () => {
    expect(managerPrompt(roster, { unlimited: true, subtasks: 12, maxDepth: 1 })).toContain('no ceiling is set for this tree');
  });
});

describe('workerPrompt', () => {
  it('teaches reporting and nothing about dispatching', () => {
    expect(WORKER_PROMPT).toContain('onni task report');
    expect(WORKER_PROMPT).toContain('You cannot dispatch further tasks');
    expect(WORKER_PROMPT).not.toContain('task create');
    expect(WORKER_PROMPT).not.toContain('--backend');
    expect(WORKER_PROMPT).not.toContain('ONNI:MONITORING');
    expect(workerPrompt('review')).toContain('Your KIND is review');
  });
});

describe('which prompt each session of a roster tree gets', () => {
  let dir: string;
  let store: RunStore;
  let manager: RunManager;
  let savedUrl: string | undefined;
  beforeEach(() => {
    savedUrl = process.env.ONNI_API_URL;
    process.env.ONNI_API_URL = 'http://127.0.0.1:4321';
    dir = mkdtempSync(join(tmpdir(), 'onni-manager-prompt-'));
    store = RunStore.open(join(dir, '.ai/onni'));
    manager = new RunManager(store, dir, { semaphore: new WorkspaceSemaphore({ initial: { maxParallel: 0 } }) });
  });
  afterEach(() => {
    manager.dispose();
    store.flush();
    if (savedUrl === undefined) delete process.env.ONNI_API_URL;
    else process.env.ONNI_API_URL = savedUrl;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const prepare = (runId: string) => {
    const state: { dispatchPrompt?: string } = {};
    (manager as unknown as { prepareDispatchSession(id: string, s: object): void }).prepareDispatchSession(runId, state);
    return state.dispatchPrompt;
  };
  const make = (patch: Parameters<RunStore['updateRun']>[1]) => {
    const run = store.createRun({ title: 't', task: 't', workflow: 'w', steps: [{ id: 'a', name: 'a', kind: 'agent' }] });
    store.updateRun(run.id, patch);
    return run;
  };

  it('the root gets the manager brief with live numbers; a worker gets the report-only brief', () => {
    const root = make({ roster, limits: { mode: 'capped', maxCostUsd: 10 } });
    store.updateRun(root.id, { dispatch: { rootRunId: root.id } });
    const worker = make({ dispatch: { rootRunId: root.id, parentRunId: root.id, workerKey: 'codex:gpt-5' } });
    store.updateStep(root.id, 'a', { costUsd: 2.5 });
    const managerSide = prepare(root.id)!;
    expect(managerSide).toContain('Manager mode.');
    expect(managerSide).toContain('$7.50 of budget');
    expect(managerSide).toContain('Subtasks left in this tree: 11');
    const workerSide = prepare(worker.id)!;
    expect(workerSide).toContain('Worker mode.');
    expect(workerSide).not.toContain('task create');
  });

  it('a tree without a roster keeps the general dispatch prompt', () => {
    const run = make({ dispatch: { rootRunId: 'x' } });
    expect(prepare(run.id)).toContain('Dispatching tasks.');
  });
});
