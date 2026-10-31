import { describe, expect, it } from 'vitest';
import { managerPresetSchema, rosterSchema, rosterWorkerKey, dispatchInputSchema } from '@onni/contract';
import { workspaceConfigSchema } from '../workspace/config.ts';

const base = {
  manager: { runner: 'claude', model: 'opus' },
  workers: [
    { runner: 'codex', model: 'gpt-5', role: 'backend tests', maxConcurrent: 2 },
    { runner: 'opencode', role: 'docs' },
  ],
};

describe('roster contract', () => {
  it('accepts a roster and fills defaults', () => {
    const roster = rosterSchema.parse(base);
    expect(roster.workers[1]).toMatchObject({ runner: 'opencode', maxConcurrent: 1 });
  });
  it('allows the same backend twice with different models, but not the same entry twice', () => {
    expect(rosterSchema.safeParse({ ...base, workers: [{ runner: 'codex', model: 'a' }, { runner: 'codex', model: 'b' }] }).success).toBe(true);
    expect(rosterSchema.safeParse({ ...base, workers: [{ runner: 'codex', model: 'a' }, { runner: 'codex', model: 'a' }] }).success).toBe(false);
  });
  it('the manager is never its own worker, but the same backend on another model may be', () => {
    expect(rosterSchema.safeParse({ ...base, workers: [{ runner: 'claude', model: 'opus' }] }).success).toBe(false);
    expect(rosterSchema.safeParse({ ...base, workers: [{ runner: 'claude', model: 'haiku' }] }).success).toBe(true);
  });
  it('needs 1–6 workers and a known backend', () => {
    expect(rosterSchema.safeParse({ ...base, workers: [] }).success).toBe(false);
    expect(rosterSchema.safeParse({ ...base, workers: [{ runner: 'nope' }] }).success).toBe(false);
    expect(rosterWorkerKey({ runner: 'codex' })).toBe('codex:');
  });
  it('dispatch input takes --backend as well as the compatible runner', () => {
    expect(dispatchInputSchema.safeParse({ objective: 'x', backend: 'codex' }).success).toBe(true);
    expect(dispatchInputSchema.safeParse({ objective: 'x', runner: 'codex' }).success).toBe(true);
  });
  it('workspace config keeps good presets, drops a corrupt one, and forgets a dangling default', () => {
    const preset = managerPresetSchema.parse({ id: 'p1', name: 'Claude leads', roster: base });
    const cfg = workspaceConfigSchema.parse({ managerWorker: { presets: [preset, { id: 'bad' }], defaultPresetId: 'gone' } });
    expect(cfg.managerWorker.presets.map((p) => p.id)).toEqual(['p1']);
    expect(cfg.managerWorker.defaultPresetId).toBeNull();
    expect(workspaceConfigSchema.parse({ managerWorker: { presets: [preset], defaultPresetId: 'p1' } }).managerWorker.defaultPresetId).toBe('p1');
    expect(workspaceConfigSchema.parse({}).managerWorker).toEqual({ presets: [], defaultPresetId: null });
  });
});
