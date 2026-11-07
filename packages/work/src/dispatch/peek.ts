/**
 * `onni task peek` — what a manager sees of a worker without opening its worktree (plan v2 §7).
 * Everything here is pure: the engine supplies the events, the read-only git result and the
 * redaction callback; this file decides the lines, their caps and their order.
 */
import {
  PEEK_TAIL_MAX_CHARS_PER_ENTRY,
  PEEK_TAIL_MAX_CHARS_PER_LINE,
  PEEK_TAIL_MAX_LINES,
  type DispatchPeek,
  type DispatchPeekEntry,
} from '@onni/contract';
import type { RunEvent } from '../runs/store.ts';

/** The only event fields a tail may show: free text a model or the engine wrote for a human. */
const TAIL_FIELDS = ['text', 'message', 'name', 'title'] as const;

/** Terminal in the dispatch sense: a worker here will produce no more transcript. */
const SETTLED = new Set(['done', 'review', 'failed', 'cancelled']);

export interface PeekTailOptions {
  maxLines?: number;
  maxCharsPerLine?: number;
  /** Total characters for this entry's tail (the `--all` budget divides this by worker count). */
  maxChars?: number;
  redact?: (line: string) => string;
}

/**
 * The newest lines of a transcript, oldest first. One line per event, from the whitelist above —
 * never raw JSON, never tool output. `truncated` is true when something was dropped for a cap, so
 * the reader knows the tail is not the whole story.
 */
export function peekTail(
  events: readonly RunEvent[],
  opts: PeekTailOptions = {},
): { lines: string[]; truncated: boolean } {
  const maxLines = opts.maxLines ?? PEEK_TAIL_MAX_LINES;
  const maxCharsPerLine = opts.maxCharsPerLine ?? PEEK_TAIL_MAX_CHARS_PER_LINE;
  const maxChars = opts.maxChars ?? PEEK_TAIL_MAX_CHARS_PER_ENTRY;
  const redact = opts.redact ?? ((line: string) => line);
  const kept: string[] = [];
  let used = 0;
  let truncated = false;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const line = lineOf(events[index], maxCharsPerLine, redact);
    if (line === undefined) continue;
    if (kept.length >= maxLines || used + line.length + 1 > maxChars) {
      truncated = true;
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }
  return { lines: kept.reverse(), truncated };
}

function lineOf(event: RunEvent | undefined, maxChars: number, redact: (line: string) => string): string | undefined {
  if (!event) return undefined;
  for (const field of TAIL_FIELDS) {
    const value = event[field];
    if (typeof value !== 'string') continue;
    const compact = value.replace(/\s+/g, ' ').trim();
    if (!compact) continue;
    return redact(compact).slice(0, maxChars);
  }
  return undefined;
}

/**
 * Minutes since the newest event. Named for what it measures — silence in the transcript — not
 * "stuck": a worker running one long tool is quiet and perfectly healthy.
 */
export function quietMinutesOf(events: readonly RunEvent[], now = Date.now()): number | null {
  const newest = events.at(-1)?.ts;
  if (!newest) return null;
  const then = Date.parse(newest);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / 60_000));
}

/**
 * Which workers a compact `peek` lists, and how many it hides. Live work first (that is what a
 * manager is peeking AT); settled workers only fill the remaining room, oldest first, so the
 * order is stable between calls.
 */
export function orderPeekCandidates<T extends { status: string; createdAt: string }>(
  runs: readonly T[],
  max: number,
): { chosen: T[]; omitted: number } {
  const byAge = (a: T, b: T) => a.createdAt.localeCompare(b.createdAt);
  const live = runs.filter((run) => !SETTLED.has(run.status)).sort(byAge);
  const settled = runs.filter((run) => SETTLED.has(run.status)).sort(byAge);
  const ordered = [...live, ...settled];
  return { chosen: ordered.slice(0, max), omitted: Math.max(0, ordered.length - max) };
}

/** The human-readable answer `onni task peek` prints. Compact entries stay within ten lines. */
export function formatPeek(peek: DispatchPeek): string {
  if (peek.workers.length === 0) return 'no workers in this tree yet';
  const blocks = peek.workers.map(formatEntry);
  if (peek.workersOmitted > 0) {
    blocks.push(`(+${peek.workersOmitted} more worker${peek.workersOmitted === 1 ? '' : 's'} not shown — peek one by id)`);
  }
  return blocks.join('\n\n');
}

function formatEntry(entry: DispatchPeekEntry): string {
  const lines = [`${entry.id.slice(0, 8)}  ${entry.status}${entry.activity ? ` (${entry.activity})` : ''} — ${entry.title}`];
  const facts: string[] = [];
  if (entry.runner) facts.push(entry.model ? `${entry.runner} (${entry.model})` : entry.runner);
  if (entry.costUsd !== undefined) facts.push(`$${entry.costUsd.toFixed(2)}`);
  if (entry.tokensUsed > 0) facts.push(`${entry.tokensUsed.toLocaleString('en-US')} tokens`);
  if (entry.quietMinutes !== null) facts.push(`no new activity for ${entry.quietMinutes}m`);
  if (facts.length > 0) lines.push(`  ${facts.join(' · ')}`);
  if (entry.currentStep) lines.push(`  step: ${entry.currentStep.name} (${entry.currentStep.status})`);
  if (entry.branch) lines.push(`  branch ${entry.branch}${entry.baseBranch ? ` from ${entry.baseBranch}` : ''}`);
  if (entry.lastManagerDelivery) {
    const delivery = entry.lastManagerDelivery;
    lines.push(`  manager delivery: ${delivery.state} (${delivery.capability})${delivery.reasonCode ? ` — ${delivery.reasonCode}` : ''} [${delivery.deliveryId.slice(0, 8)}]`);
  }
  lines.push(`  ${filesLine(entry)}`);
  if (entry.tail.length > 0) {
    lines.push('  recent:');
    for (const line of entry.tail) lines.push(`  | ${line}`);
    if (entry.tailTruncated) lines.push('  | … truncated');
  }
  return lines.join('\n');
}

function filesLine(entry: DispatchPeekEntry): string {
  if (entry.filesState === 'unavailable') return 'files: unavailable — the worktree is gone or unreadable; this is NOT "nothing changed"';
  if (entry.filesState === 'timeout') return 'files: timed out — unknown, not "nothing changed"';
  if (entry.files.length === 0 && entry.filesOmitted === 0) return 'files: nothing changed yet';
  const omitted = entry.filesOmitted > 0 ? ` (+${entry.filesOmitted} more)` : '';
  return `files (${entry.files.length + entry.filesOmitted}): ${entry.files.join(', ')}${omitted}`;
}
