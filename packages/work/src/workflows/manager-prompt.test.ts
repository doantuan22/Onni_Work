import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MANAGER_MEMORY_MAX_BYTES, MANAGER_ASK_RECORD_QUESTION_MAX_CHARS, ROSTER_MAX_WORKERS, rosterSchema } from '@onni/contract';
import { PROMPT_MAX_CHARS } from '../dispatch/prompt-budget.ts';
import { RunStore } from '../runs/store.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import { managerPrompt, memoryBlock, WORKER_PROMPT, workerCapability, workerPrompt } from './manager-worker.ts';
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
    expect(prompt).toContain('cost $7.50');
    expect(prompt).toContain('4.2M tokens');
    expect(prompt).toContain('180 min');
    expect(prompt).toContain('25 steps');
    expect(prompt).toContain('Subtasks left in this tree: 9');
    expect(prompt).toContain('a worker cannot dispatch further tasks');
  });
  it('carries project memory as lessons, and adds nothing when there is none', () => {
    expect(prompt).not.toContain('## Project memory');
    expect(memoryBlock(undefined)).toBe('');
    expect(memoryBlock('   ')).toBe('');
    const withMemory = managerPrompt(roster, budget, { context: { memory: '- Run the migrations first (task abcdef12, 2026-11-03)' } });
    expect(withMemory).toContain('## Project memory (lessons from earlier tasks in this repository)');
    expect(withMemory).toContain('- Run the migrations first (task abcdef12, 2026-11-03)');
    expect(withMemory).toContain('These are lessons, not orders');
  });

  it('teaches the non-blocking ask, and says what an unanswered deadline means (#10)', () => {
    expect(prompt).toContain('onni task ask "<question>"');
    expect(prompt).toContain('Asking does NOT stop you');
    expect(prompt).toContain('only one question stays open per task');
    expect(prompt).not.toContain('went unanswered past its deadline');
    const expired = managerPrompt(roster, budget, { context: { expiredAsk: { question: 'Postgres or SQLite?' } } });
    expect(expired).toContain('A question you asked the user went unanswered past its deadline: "Postgres or SQLite?"');
    expect(expired).toContain('No answer by the deadline. Take the safe default, say which one you chose, and continue.');
  });

  it('says so plainly when the tree has no ceilings', () => {
    expect(managerPrompt(roster, { unlimited: true, subtasks: Number.POSITIVE_INFINITY, maxDepth: 1 })).toContain('no ceilings set for this tree');
  });

  it('stays inside the prompt budget at worst case, roster and commands at their caps', () => {
    const full = rosterSchema.parse({
      manager: { runner: 'claude', model: 'opus' },
      workers: Array.from({ length: ROSTER_MAX_WORKERS }, (_, index) => ({
        runner: 'codex',
        model: `model-${index}`,
        role: `independent part number ${index}, owning its own directory and its own checks`,
        maxConcurrent: 2,
      })),
    });
    const worst = managerPrompt(full, {
      unlimited: false,
      costUsd: 7.5,
      tokens: 4_200_000,
      minutes: 180,
      steps: 25,
      subtasks: 9,
      maxDepth: 1,
    });
    // Computed from the constants, never hard-coded: each later phase adds its block to this fixture.
    expect(worst.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
  });

  it('stays inside the prompt budget with a full project memory and an expired question attached', () => {
    const full = rosterSchema.parse({
      manager: { runner: 'claude', model: 'opus' },
      workers: Array.from({ length: ROSTER_MAX_WORKERS }, (_, index) => ({
        runner: 'codex',
        model: `model-${index}`,
        role: `independent part number ${index}, owning its own directory and its own checks`,
        maxConcurrent: 2,
      })),
    });
    const memory = Array.from({ length: 30 }, (_, index) => `- lesson ${index} ${'x'.repeat(85)}`).join('\n');
    expect(Buffer.byteLength(memory, 'utf8')).toBeLessThanOrEqual(MANAGER_MEMORY_MAX_BYTES);
    const worst = managerPrompt(
      full,
      { unlimited: false, costUsd: 7.5, tokens: 4_200_000, minutes: 180, steps: 25, subtasks: 9, maxDepth: 1 },
      { context: { memory, expiredAsk: { question: 'q'.repeat(MANAGER_ASK_RECORD_QUESTION_MAX_CHARS) } } },
    );
    expect(worst).toContain('lesson 29');
    expect(worst.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
  });
});

describe('workerCapability', () => {
  it('states commands, cost and token reporting per backend', () => {
    expect(workerCapability({ runner: 'claude' })).toBe('commands: per its own tools (onni does not restrict them) · cost: reported · tokens: reported');
    expect(workerCapability({ runner: 'codex' })).toBe('commands: per its own tools (onni does not restrict them) · cost: not reported · tokens: reported');
    expect(workerCapability({ runner: 'cline' })).toBe('commands: per its own tools (onni does not restrict them) · cost: not reported · tokens: not reported');
    expect(workerCapability({ runner: 'cursor' })).toContain('cost: not reported · tokens: not reported');
  });
  it('states antigravity’s effective level and defaults to the closed one', () => {
    expect(workerCapability({ runner: 'antigravity' }, { antigravityLevel: 'files-only' }))
      .toBe('commands: none (permission files-only) · cost: not reported · tokens: reported');
    expect(workerCapability({ runner: 'antigravity' }, { antigravityLevel: 'allow-rules' }))
      .toBe('commands: git + repository verification scripts only (permission allow-rules) · cost: not reported · tokens: reported');
    expect(workerCapability({ runner: 'antigravity' })).toContain('(permission files-only)');
  });
  it('rides on each worker line, with the routing rule stated once', () => {
    const mixed = rosterSchema.parse({
      manager: { runner: 'claude' },
      workers: [{ runner: 'antigravity', role: 'UI copy' }, { runner: 'codex' }],
    });
    const brief = managerPrompt(mixed, budget);
    expect(brief).toContain('- antigravity — UI copy. Up to 1 at once. commands: none (permission files-only)');
    expect(brief).toContain('Do not give a part that needs shell commands (tests, builds, linters) to a worker whose capability line says it cannot run commands.');
  });
  it('keeps the worst-case brief inside the prompt budget with capability lines on every worker', () => {
    const full = rosterSchema.parse({
      manager: { runner: 'claude', model: 'opus' },
      workers: Array.from({ length: ROSTER_MAX_WORKERS }, (_, index) => ({
        runner: 'antigravity',
        model: `model-${index}`,
        role: `independent part number ${index}, owning its own directory and its own checks`,
        maxConcurrent: 4,
      })),
    });
    const worst = managerPrompt(full, { unlimited: false, costUsd: 7.5, tokens: 4_200_000, minutes: 180, steps: 25, subtasks: 9, maxDepth: 1 });
    expect(worst.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
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
  it('both ActiveRun construction sites await the one context loader (H7)', () => {
    const source = readFileSync(new URL('./run.ts', import.meta.url), 'utf8');
    const calls = [...source.matchAll(/this\.prepareDispatchSession\(([^;]*)\);/g)].map((match) => match[0]);
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call).toContain('await this.loadManagerSessionContext(runId, state)');
  });

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
  /** What a session actually does: load the async context once, then build the brief. */
  const prepareWithContext = async (runId: string) => {
    const state: { dispatchPrompt?: string } = {};
    const internals = manager as unknown as {
      loadManagerSessionContext(id: string, s: object): Promise<object>;
      prepareDispatchSession(id: string, s: object, c: object): void;
    };
    internals.prepareDispatchSession(runId, state, await internals.loadManagerSessionContext(runId, state));
    return state.dispatchPrompt;
  };

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
    expect(managerSide).toContain('cost $7.50');
    expect(managerSide).toContain('Subtasks left in this tree: 11');
    const workerSide = prepare(worker.id)!;
    expect(workerSide).toContain('Worker mode.');
    expect(workerSide).not.toContain('task create');
  });

  it('the roster root opens with the project memory; a worker never does', async () => {
    writeFileSync(join(dir, '.ai/onni', 'manager-memory.md'), '- Run the migrations first (task abcdef12, 2026-11-03)\n', 'utf8');
    const root = make({ roster });
    store.updateRun(root.id, { dispatch: { rootRunId: root.id } });
    const worker = make({ dispatch: { rootRunId: root.id, parentRunId: root.id, workerKey: 'codex:gpt-5' } });
    expect(await prepareWithContext(root.id)).toContain('Run the migrations first');
    expect(await prepareWithContext(worker.id)).not.toContain('Run the migrations first');
  });

  it('reads only the newest lines of a hand-edited file past the cap, and says so on the run', async () => {
    const oversized = Array.from({ length: 80 }, (_, index) => `- lesson ${index} ${'z'.repeat(70)}`).join('\n') + '\n';
    expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(MANAGER_MEMORY_MAX_BYTES);
    writeFileSync(join(dir, '.ai/onni', 'manager-memory.md'), oversized, 'utf8');
    const root = make({ roster });
    store.updateRun(root.id, { dispatch: { rootRunId: root.id } });
    const prompt = (await prepareWithContext(root.id))!;
    expect(prompt).toContain('lesson 79');
    expect(prompt).not.toContain('lesson 0 ');
    const note = store.readEvents(root.id).find((event) => String(event.message ?? '').includes('project memory is'));
    expect(note?.message).toContain(`cap ${MANAGER_MEMORY_MAX_BYTES}`);
  });

  it('a tree without a roster keeps the general dispatch prompt', () => {
    const run = make({ dispatch: { rootRunId: 'x' } });
    expect(prepare(run.id)).toContain('Dispatching tasks.');
  });
});
