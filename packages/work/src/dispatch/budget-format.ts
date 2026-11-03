/**
 * One wording for "what is left" (plan v2 §6.2), shared by the CLI, the settle report and the
 * manager brief. Three surfaces, one string: a manager that reads "$3.20" in one place and
 * "3.2 USD" in another cannot tell whether they are the same number.
 */
import type { DispatchBudget } from '@onni/contract';
import type { RemainingBudget } from '../workflows/manager-worker.ts';

const clamp = (value: number, round = false): number => {
  const n = Math.max(0, value);
  return round ? Math.round(n) : n;
};

/** `RemainingBudget` (in-memory, may hold `Infinity`) → the JSON-safe contract shape. */
export function toDispatchBudget(left: RemainingBudget): DispatchBudget {
  const overBudget = [left.costUsd, left.tokens, left.minutes, left.steps, left.subtasks].some(
    (value) => value !== undefined && Number.isFinite(value) && value < 0,
  );
  return {
    costUsd: left.costUsd === undefined ? null : clamp(left.costUsd),
    tokens: left.tokens === undefined ? null : clamp(left.tokens, true),
    minutes: left.minutes === undefined ? null : clamp(left.minutes),
    steps: left.steps === undefined ? null : clamp(left.steps, true),
    subtasks: Number.isFinite(left.subtasks) ? clamp(left.subtasks, true) : null,
    subtaskCap: left.subtaskCap ?? null,
    maxDepth: left.maxDepth,
    overBudget,
  };
}

function tokenCount(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${Math.round(n)}`;
}

/**
 * `cost $3.20 · 120k tokens · 45 min · 800 steps · 2 workers left (cap 8) · unlimited time`.
 * Every axis that is `null` is left out, except the two the manager can act on: unlimited worker
 * calls and unlimited time are stated, because "not mentioned" reads as "unknown".
 */
export function formatBudgetLine(budget: DispatchBudget): string {
  const over = budget.overBudget ? 'OVER BUDGET — ' : '';
  const unlimited =
    budget.costUsd === null &&
    budget.tokens === null &&
    budget.minutes === null &&
    budget.steps === null &&
    budget.subtasks === null &&
    budget.subtaskCap === null;
  if (unlimited) return `${over}no ceilings set for this tree`;
  const parts: string[] = [];
  if (budget.costUsd !== null) parts.push(`cost $${budget.costUsd.toFixed(2)}`);
  if (budget.tokens !== null) parts.push(`${tokenCount(budget.tokens)} tokens`);
  if (budget.minutes !== null) parts.push(`${Math.round(budget.minutes)} min`);
  if (budget.steps !== null) parts.push(`${Math.round(budget.steps)} steps`);
  if (budget.subtasks === null) parts.push('unlimited worker calls');
  else parts.push(`${budget.subtasks} workers left${budget.subtaskCap !== null ? ` (cap ${budget.subtaskCap})` : ''}`);
  if (budget.minutes === null) parts.push('unlimited time');
  return over + parts.join(' · ');
}
