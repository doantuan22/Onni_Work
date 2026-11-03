import { describe, expect, it } from 'vitest';
import { rosterSchema } from '@onni/contract';
import type { RunRecord } from '../runs/store.ts';
import { requireRootManager, requireSameTree, treeRootOf } from './access.ts';

const roster = rosterSchema.parse({
  manager: { runner: 'claude' },
  workers: [{ runner: 'codex', role: 'backend' }],
});

const run = (patch: Partial<RunRecord>): RunRecord =>
  ({ id: 'run-0000', title: 't', task: 't', workflow: 'w', ...patch }) as unknown as RunRecord;

describe('requireRootManager', () => {
  it('admits the root of a roster tree', () => {
    expect(requireRootManager(run({ roster }))).toEqual({ ok: true });
  });

  it('refuses a worker, naming the action that was attempted', () => {
    const worker = run({ roster, dispatch: { rootRunId: 'root-0000', parentRunId: 'root-0000' } });
    expect(requireRootManager(worker, 'peek at the tree')).toEqual({
      ok: false,
      denied: 'only the manager of a manager–worker task can peek at the tree',
      status: 403,
    });
  });

  it('refuses a plain task even when it dispatched ordinary work', () => {
    const plain = run({ dispatch: { rootRunId: 'run-0000' } });
    expect(requireRootManager(plain)).toMatchObject({ ok: false, status: 403 });
  });

  it('answers 404 for a run that does not exist', () => {
    expect(requireRootManager(undefined)).toEqual({ ok: false, denied: 'no such run', status: 404 });
  });
});

describe('requireSameTree', () => {
  it('admits any two runs in one tree, including the root', () => {
    const root = run({ id: 'root-0000', roster, dispatch: { rootRunId: 'root-0000' } });
    const child = run({ id: 'kid-0000', dispatch: { rootRunId: 'root-0000', parentRunId: 'root-0000' } });
    expect(requireSameTree(root, child)).toEqual({ ok: true });
    expect(requireSameTree(child, child)).toEqual({ ok: true });
  });

  it('refuses a run from another tree with a 409, never an empty answer', () => {
    const caller = run({ dispatch: { rootRunId: 'root-0000' } });
    const other = run({ id: 'other-000', dispatch: { rootRunId: 'other-000' } });
    expect(requireSameTree(caller, other)).toEqual({
      ok: false,
      denied: 'run other-00 belongs to another task tree',
      status: 409,
    });
  });
});

describe('treeRootOf', () => {
  it('is the run itself when it never joined a tree, and the stored root otherwise', () => {
    expect(treeRootOf(run({ id: 'solo-000' }))).toBe('solo-000');
    expect(treeRootOf(run({ id: 'kid-0000', dispatch: { rootRunId: 'root-0000' } }))).toBe('root-0000');
  });
});
