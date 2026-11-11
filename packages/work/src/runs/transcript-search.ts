import { createReadStream, existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import {
  MAX_THREAD_CURSOR_LENGTH,
  MAX_TRANSCRIPT_SEARCH_PAGE_LIMIT,
  MAX_TRANSCRIPT_SEARCH_SNIPPET_LENGTH,
  type RunHistoryEvent,
  type TranscriptSearchItem,
  type TranscriptSearchPage,
  type TranscriptSearchQuery,
} from '@onni/contract';

export const DEFAULT_SEARCH_PAGE_LIMIT = 20;
export const MAX_RUNS_SCANNED_PER_PAGE = 25;
export const MAX_BYTES_PER_RUN_TRANSCRIPT = 1024 * 1024; // 1 MiB

const MAX_SNIPPET_LENGTH = MAX_TRANSCRIPT_SEARCH_SNIPPET_LENGTH || 400;
const MAX_PAGE_LIMIT = MAX_TRANSCRIPT_SEARCH_PAGE_LIMIT || 50;
const MAX_CURSOR_LENGTH = MAX_THREAD_CURSOR_LENGTH || 2048;

export class SearchCursorError extends Error {
  readonly status = 400;

  constructor(message = 'invalid search cursor') {
    super(message);
    this.name = 'SearchCursorError';
  }
}

export const searchCursorPayloadSchema = z.object({
  v: z.literal(1),
  q: z.string(),
  runIndex: z.number().int().nonnegative(),
  runId: z.string(),
  fromSeq: z.number().int().nonnegative().optional(),
});
export type SearchCursorPayload = z.infer<typeof searchCursorPayloadSchema>;

export function encodeSearchCursor(payload: SearchCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeSearchCursor(cursor: string): SearchCursorPayload {
  if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) {
    throw new SearchCursorError('invalid search cursor');
  }
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const parsed = searchCursorPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      throw new SearchCursorError('invalid search cursor');
    }
    return parsed.data;
  } catch (err) {
    if (err instanceof SearchCursorError) throw err;
    throw new SearchCursorError('invalid search cursor');
  }
}

/**
 * Centered snippet of at most maxLength characters around the match.
 */
export function createSnippet(
  text: string,
  matchIndex: number,
  matchLength: number,
  maxLength = MAX_SNIPPET_LENGTH,
): string {
  if (text.length <= maxLength) {
    return text;
  }
  const matchCenter = matchIndex + Math.floor(matchLength / 2);
  let start = Math.max(0, matchCenter - Math.floor(maxLength / 2));
  let end = start + maxLength;
  if (end > text.length) {
    end = text.length;
    start = Math.max(0, end - maxLength);
  }
  return text.slice(start, end);
}

/**
 * Extract distinct searchable text values from an event payload.
 */
export function extractEventTexts(event: RunHistoryEvent | Record<string, unknown>): string[] {
  const texts: string[] = [];
  const seen = new Set<string>();

  const add = (val: unknown) => {
    if (typeof val === 'string' && val.trim().length > 0 && !seen.has(val)) {
      seen.add(val);
      texts.push(val);
    }
  };

  add(event.text);
  add(event.message);
  if (typeof event.content === 'string') {
    add(event.content);
  } else if (Array.isArray(event.content)) {
    for (const part of event.content) {
      if (typeof part === 'string') add(part);
      else if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>;
        add(p.text);
        add(p.output);
      }
    }
  }
  add(event.output);
  add(event.error);

  if (typeof event.result === 'string') {
    add(event.result);
  } else if (event.result && typeof event.result === 'object') {
    const res = event.result as Record<string, unknown>;
    add(res.output);
    add(res.text);
    add(res.error);
    add(res.message);
  }

  if (event.item && typeof event.item === 'object') {
    const item = event.item as Record<string, unknown>;
    add(item.text);
    add(item.title);
    add(item.output);
    if (typeof item.input === 'string') {
      add(item.input);
    } else if (item.input && typeof item.input === 'object') {
      const input = item.input as Record<string, unknown>;
      add(input.command);
      add(input.prompt);
      add(input.query);
      add(input.path);
    }
  }

  if (typeof event.input === 'string') {
    add(event.input);
  } else if (event.input && typeof event.input === 'object') {
    const input = event.input as Record<string, unknown>;
    add(input.command);
    add(input.prompt);
    add(input.query);
    add(input.path);
  }

  add(event.question);
  add(event.prompt);
  add(event.title);

  if (texts.length === 0) {
    const ENVELOPE_KEYS = new Set([
      'type',
      'seq',
      'ts',
      'stepId',
      'sessionId',
      'turnId',
      'id',
      'backend',
      'kind',
      'status',
    ]);
    for (const [key, val] of Object.entries(event)) {
      if (!ENVELOPE_KEYS.has(key) && typeof val === 'string') {
        add(val);
      }
    }
  }

  return texts;
}

function parseLine(line: string): RunHistoryEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const value = JSON.parse(trimmed) as Partial<RunHistoryEvent>;
    return typeof value.seq === 'number' &&
      Number.isInteger(value.seq) &&
      value.seq >= 0 &&
      typeof value.type === 'string' &&
      typeof value.ts === 'string'
      ? (value as RunHistoryEvent)
      : null;
  } catch {
    return null;
  }
}

/**
 * Read NDJSON lines incrementally up to a maximum byte budget without throwing on missing or corrupt files.
 */
export async function* streamRunEventsBounded(
  filePath: string,
  maxBytes: number,
): AsyncGenerator<RunHistoryEvent> {
  if (!existsSync(filePath)) return;
  try {
    if (statSync(filePath).isDirectory()) return;
  } catch {
    return;
  }

  let input: ReturnType<typeof createReadStream> | undefined;
  let lines: ReturnType<typeof createInterface> | undefined;
  try {
    input = createReadStream(filePath, { encoding: 'utf8' });
    input.on('error', () => {});
    lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      const event = parseLine(line);
      if (event) yield event;
      if (input.bytesRead >= maxBytes) {
        break;
      }
    }
  } catch {
    return;
  } finally {
    lines?.close();
    input?.destroy();
  }
}

export interface CandidateRun {
  projectId: string;
  runId: string;
  filePath: string;
  lastActivityAt?: string;
}

export interface TranscriptSearchOptions {
  maxRunsScanned?: number;
  maxBytesPerRun?: number;
}

/**
 * Pure case-insensitive substring search over persisted candidate run transcripts.
 *
 * Bounded by maxRunsScanned and maxBytesPerRun per request, with opaque cursor pagination.
 * Degrades gracefully on missing or corrupt transcript files without throwing.
 */
export async function searchTranscripts(
  query: TranscriptSearchQuery,
  candidateRuns: readonly CandidateRun[],
  options?: TranscriptSearchOptions,
): Promise<TranscriptSearchPage> {
  const q = query.q;
  if (!q || q.length === 0) {
    return { items: [] };
  }

  const pageLimit = Math.min(
    Math.max(1, query.limit ?? DEFAULT_SEARCH_PAGE_LIMIT),
    MAX_PAGE_LIMIT,
  );
  const maxRunsScanned = options?.maxRunsScanned ?? MAX_RUNS_SCANNED_PER_PAGE;
  const maxBytesPerRun = options?.maxBytesPerRun ?? MAX_BYTES_PER_RUN_TRANSCRIPT;

  let startIndex = 0;
  let minSeq: number | undefined = undefined;

  if (query.cursor) {
    const payload = decodeSearchCursor(query.cursor);
    if (payload.q.toLowerCase() !== q.toLowerCase()) {
      throw new SearchCursorError('cursor query does not match search query');
    }
    if (candidateRuns[payload.runIndex]?.runId === payload.runId) {
      startIndex = payload.runIndex;
    } else {
      const found = candidateRuns.findIndex((r) => r.runId === payload.runId);
      startIndex = found !== -1 ? found : Math.min(payload.runIndex, candidateRuns.length);
    }
    minSeq = payload.fromSeq;
  }

  const lowerQ = q.toLowerCase();
  const items: TranscriptSearchItem[] = [];
  let nextCursor: string | undefined = undefined;
  let runsScannedCount = 0;

  for (let rIdx = startIndex; rIdx < candidateRuns.length; rIdx++) {
    if (runsScannedCount >= maxRunsScanned) {
      nextCursor = encodeSearchCursor({
        v: 1,
        q,
        runIndex: rIdx,
        runId: candidateRuns[rIdx]!.runId,
      });
      break;
    }

    const run = candidateRuns[rIdx]!;
    runsScannedCount++;

    const runMinSeq = rIdx === startIndex ? minSeq : undefined;
    let hasMoreInRun = false;
    let lastMatchedSeq: number | undefined = undefined;

    let currentTurnId: string | undefined = undefined;

    const iterator = streamRunEventsBounded(run.filePath, maxBytesPerRun)[Symbol.asyncIterator]();
    try {
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        const event = next.value;

        if (event.type === 'turn.started') {
          if (typeof event.turnId === 'string' && event.turnId.trim().length > 0) {
            currentTurnId = event.turnId.trim();
          } else {
            currentTurnId = undefined;
          }
        } else if (event.type === 'user-message') {
          if (typeof event.turnId === 'string' && event.turnId.trim().length > 0) {
            currentTurnId = event.turnId.trim();
          } else {
            currentTurnId = undefined;
          }
        }

        if (runMinSeq !== undefined && event.seq <= runMinSeq) {
          if (event.type === 'turn.completed') {
            currentTurnId = undefined;
          }
          continue;
        }

        const turnId =
          typeof event.turnId === 'string' && event.turnId.trim().length > 0
            ? event.turnId.trim()
            : currentTurnId;

        const texts = extractEventTexts(event);
        let matchedSnippet: string | undefined = undefined;

        for (const text of texts) {
          const matchIdx = text.toLowerCase().indexOf(lowerQ);
          if (matchIdx !== -1) {
            matchedSnippet = createSnippet(text, matchIdx, q.length, MAX_SNIPPET_LENGTH);
            break;
          }
        }

        if (matchedSnippet !== undefined) {
          items.push({
            runId: run.runId,
            projectId: run.projectId,
            seq: event.seq,
            snippet: matchedSnippet,
            ...(turnId !== undefined ? { turnId } : {}),
          });
          lastMatchedSeq = event.seq;

          if (items.length >= pageLimit) {
            const peek = await iterator.next();
            if (!peek.done) {
              hasMoreInRun = true;
            }
            break;
          }
        }

        if (event.type === 'turn.completed') {
          currentTurnId = undefined;
        }
      }
    } finally {
      await iterator.return?.(undefined);
    }

    if (hasMoreInRun) {
      nextCursor = encodeSearchCursor({
        v: 1,
        q,
        runIndex: rIdx,
        runId: run.runId,
        fromSeq: lastMatchedSeq,
      });
      break;
    }

    if (items.length >= pageLimit) {
      if (rIdx + 1 < candidateRuns.length) {
        nextCursor = encodeSearchCursor({
          v: 1,
          q,
          runIndex: rIdx + 1,
          runId: candidateRuns[rIdx + 1]!.runId,
        });
      }
      break;
    }
  }

  return {
    items,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}
