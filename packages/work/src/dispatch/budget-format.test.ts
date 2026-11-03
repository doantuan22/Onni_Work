import { describe, expect, it } from 'vitest';
import { formatBudgetLine, toDispatchBudget } from './budget-format.ts';

const base = {
  costUsd: null,
  tokens: null,
  minutes: null,
  steps: null,
  subtasks: null,
  subtaskCap: null,
  maxDepth: 1,
  overBudget: false,
};

describe('formatBudgetLine', () => {
  it('renders every axis in one order', () => {
    expect(
      formatBudgetLine({ ...base, costUsd: 3.2, tokens: 120_000, minutes: 45, steps: 800, subtasks: 2, subtaskCap: 8 }),
    ).toBe('cost $3.20 · 120k tokens · 45 min · 800 steps · 2 workers left (cap 8)');
  });

  it('names the two unlimited axes the manager can act on', () => {
    expect(formatBudgetLine({ ...base, subtasks: 2, subtaskCap: 8 })).toBe('2 workers left (cap 8) · unlimited time');
    expect(formatBudgetLine({ ...base, costUsd: 1 })).toBe('cost $1.00 · unlimited worker calls · unlimited time');
  });

  it('summarises a completely uncapped tree in one phrase', () => {
    expect(formatBudgetLine(base)).toBe('no ceilings set for this tree');
  });

  it('marks an overspent tree and still shows zero, never a negative', () => {
    expect(formatBudgetLine({ ...base, costUsd: 0, overBudget: true })).toBe(
      'OVER BUDGET — cost $0.00 · unlimited worker calls · unlimited time',
    );
  });
});

describe('toDispatchBudget', () => {
  const left = (over: { subtasks?: number; costUsd?: number; steps?: number } = {}) => ({
    unlimited: false,
    subtasks: 2,
    subtaskCap: 8,
    maxDepth: 1,
    ...over,
  });

  it('turns Infinity into null so the body is always JSON-safe', () => {
    const budget = toDispatchBudget(left({ subtasks: Number.POSITIVE_INFINITY }));
    expect(budget.subtasks).toBeNull();
    expect(JSON.stringify(budget)).not.toContain('Infinity');
  });

  it('clamps a negative to zero and flags the tree as over budget', () => {
    const budget = toDispatchBudget(left({ costUsd: -3, steps: 2.6 }));
    expect(budget.costUsd).toBe(0);
    expect(budget.steps).toBe(3);
    expect(budget.overBudget).toBe(true);
  });

  it('is all null for a tree with no ceilings at all', () => {
    expect(toDispatchBudget({ unlimited: true, subtasks: Number.POSITIVE_INFINITY, maxDepth: 1 })).toEqual({
      costUsd: null,
      tokens: null,
      minutes: null,
      steps: null,
      subtasks: null,
      subtaskCap: null,
      maxDepth: 1,
      overBudget: false,
    });
  });
});
