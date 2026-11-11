import { describe, expect, it } from 'vitest';
import {
  threadsQuerySchema,
  threadsPageSchema,
  threadSummarySchema,
  transcriptSearchQuerySchema,
  transcriptSearchPageSchema,
  transcriptSearchItemSchema,
  markViewedInputSchema,
  workspacePanesSchema,
  workspacePanesInputSchema,
  putWorkspacePanesInputSchema,
  setWorkspacePanesInputSchema,
  runRecordSchema,
  runIndexEntrySchema,
  MAX_THREAD_CURSOR_LENGTH,
  MAX_THREAD_SUMMARY_PREVIEW_LENGTH,
  MAX_TRANSCRIPT_SEARCH_QUERY_LENGTH,
  MAX_TRANSCRIPT_SEARCH_SNIPPET_LENGTH,
  MAX_WORKSPACE_PANES_THREADS,
} from '../../../contract/src/index.ts';

describe('Phase 5 contract schemas: workspace threads, search, viewed, and panes', () => {
  describe('(1) threadsQuerySchema, threadSummarySchema, threadsPageSchema', () => {
    it('threadsQuerySchema defaults limit to 50 when omitted', () => {
      const parsed = threadsQuerySchema.parse({});
      expect(parsed).toEqual({ limit: 50 });
    });

    it('threadsQuerySchema accepts valid parameters and coerces string limit', () => {
      const parsed = threadsQuerySchema.parse({
        cursor: 'cur_123',
        limit: '25',
        projectId: 'proj-a',
        status: 'running',
      });
      expect(parsed).toEqual({
        cursor: 'cur_123',
        limit: 25,
        projectId: 'proj-a',
        status: 'running',
      });
    });

    it('threadsQuerySchema rejects limit out of range 1..100', () => {
      expect(threadsQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
      expect(threadsQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    });

    it('threadsQuerySchema rejects cursor exceeding max 2048 characters', () => {
      const tooLong = 'a'.repeat(MAX_THREAD_CURSOR_LENGTH + 1);
      expect(threadsQuerySchema.safeParse({ cursor: tooLong }).success).toBe(false);
      const exact = 'a'.repeat(MAX_THREAD_CURSOR_LENGTH);
      expect(threadsQuerySchema.safeParse({ cursor: exact }).success).toBe(true);
    });

    it('threadSummarySchema validates required and optional fields', () => {
      const validSummary = {
        runId: 'run-1',
        projectId: 'proj-1',
        title: 'Fix issue with login',
        status: 'running' as const,
        updatedAt: '2026-11-11T12:00:00Z',
        preview: 'Investigating failure in auth handler...',
        awaitingAsk: false,
        workerCount: 2,
        parentRunId: 'run-0',
        unread: true,
      };

      const parsed = threadSummarySchema.parse(validSummary);
      expect(parsed).toEqual(validSummary);

      // Rejects invalid run status
      expect(
        threadSummarySchema.safeParse({
          ...validSummary,
          status: 'unknown-status',
        }).success,
      ).toBe(false);

      // Rejects preview exceeding 280 chars
      expect(
        threadSummarySchema.safeParse({
          ...validSummary,
          preview: 'x'.repeat(MAX_THREAD_SUMMARY_PREVIEW_LENGTH + 1),
        }).success,
      ).toBe(false);

      // Rejects negative workerCount
      expect(
        threadSummarySchema.safeParse({
          ...validSummary,
          workerCount: -1,
        }).success,
      ).toBe(false);

      // Minimal summary without optional preview or parentRunId
      const minimal = {
        runId: 'run-2',
        projectId: 'proj-1',
        title: 'Minimal task',
        status: 'done' as const,
        updatedAt: '2026-11-11T12:00:00Z',
        awaitingAsk: false,
        workerCount: 0,
        unread: false,
      };
      expect(threadSummarySchema.safeParse(minimal).success).toBe(true);
    });

    it('threadsPageSchema validates paginated results', () => {
      const page = {
        items: [
          {
            runId: 'run-1',
            projectId: 'proj-1',
            title: 'Task 1',
            status: 'waiting' as const,
            updatedAt: '2026-11-11T12:00:00Z',
            awaitingAsk: true,
            workerCount: 1,
            unread: true,
          },
        ],
        nextCursor: 'next-page-cursor',
        truncatedProjects: ['proj-2'],
      };
      expect(threadsPageSchema.parse(page)).toEqual(page);
      expect(threadsPageSchema.parse({ items: [] })).toEqual({ items: [] });
    });
  });

  describe('(2) transcriptSearchQuerySchema, transcriptSearchItemSchema, transcriptSearchPageSchema', () => {
    it('transcriptSearchQuerySchema accepts valid search filters and bounds', () => {
      const query = {
        q: 'error: connection refused',
        projectId: 'proj-1',
        runId: 'run-1',
        cursor: 'c-1',
        limit: '10',
      };
      const parsed = transcriptSearchQuerySchema.parse(query);
      expect(parsed).toEqual({
        q: 'error: connection refused',
        projectId: 'proj-1',
        runId: 'run-1',
        cursor: 'c-1',
        limit: 10,
      });

      // Bare query with only q
      expect(transcriptSearchQuerySchema.parse({ q: 'needle' })).toEqual({ q: 'needle' });
    });

    it('transcriptSearchQuerySchema enforces query length and limit bounds', () => {
      expect(transcriptSearchQuerySchema.safeParse({ q: '' }).success).toBe(false);
      expect(
        transcriptSearchQuerySchema.safeParse({
          q: 'a'.repeat(MAX_TRANSCRIPT_SEARCH_QUERY_LENGTH + 1),
        }).success,
      ).toBe(false);
      expect(transcriptSearchQuerySchema.safeParse({ q: 'test', limit: 0 }).success).toBe(false);
      expect(transcriptSearchQuerySchema.safeParse({ q: 'test', limit: 51 }).success).toBe(false);
    });

    it('transcriptSearchItemSchema and transcriptSearchPageSchema validate results', () => {
      const item = {
        runId: 'run-1',
        projectId: 'proj-1',
        seq: 42,
        turnId: 'turn-3',
        snippet: 'Found matching error output here',
      };
      expect(transcriptSearchItemSchema.parse(item)).toEqual(item);

      // TurnId is optional
      const withoutTurn = {
        runId: 'run-1',
        projectId: 'proj-1',
        seq: 10,
        snippet: 'Snippet without turn',
      };
      expect(transcriptSearchItemSchema.safeParse(withoutTurn).success).toBe(true);

      // Rejects snippet > 400 chars
      expect(
        transcriptSearchItemSchema.safeParse({
          ...item,
          snippet: 'a'.repeat(MAX_TRANSCRIPT_SEARCH_SNIPPET_LENGTH + 1),
        }).success,
      ).toBe(false);

      // Page validation
      const page = {
        items: [item],
        nextCursor: 'next-search-cursor',
      };
      expect(transcriptSearchPageSchema.parse(page)).toEqual(page);
    });
  });

  describe('(3) markViewedInputSchema and lastViewedSeq on RunRecord / RunIndexEntry', () => {
    it('markViewedInputSchema validates non-negative integer seq', () => {
      expect(markViewedInputSchema.parse({ seq: 0 })).toEqual({ seq: 0 });
      expect(markViewedInputSchema.parse({ seq: 120 })).toEqual({ seq: 120 });
      expect(markViewedInputSchema.safeParse({ seq: -1 }).success).toBe(false);
      expect(markViewedInputSchema.safeParse({ seq: 1.5 }).success).toBe(false);
      expect(markViewedInputSchema.safeParse({}).success).toBe(false);
    });

    it('runRecordSchema accepts optional lastViewedSeq while preserving backward compatibility', () => {
      const baseRecord = {
        id: 'run-test',
        title: 'Test task',
        workflow: 'quick-task',
        task: 'Do something',
        status: 'running' as const,
        createdAt: '2026-11-11T00:00:00Z',
        tokensUsed: 100,
        archived: false,
        steps: [],
      };

      // Parses without lastViewedSeq (backward compatibility)
      const parsedOld = runRecordSchema.parse(baseRecord);
      expect(parsedOld.lastViewedSeq).toBeUndefined();

      // Parses with lastViewedSeq
      const parsedNew = runRecordSchema.parse({ ...baseRecord, lastViewedSeq: 42 });
      expect(parsedNew.lastViewedSeq).toBe(42);

      // Rejects negative lastViewedSeq
      expect(runRecordSchema.safeParse({ ...baseRecord, lastViewedSeq: -5 }).success).toBe(false);
    });

    it('runIndexEntrySchema accepts optional lastViewedSeq while preserving backward compatibility', () => {
      const baseEntry = {
        id: 'run-test',
        projectId: 'proj-1',
        title: 'Test Entry',
        status: 'done' as const,
        createdAt: '2026-11-11T00:00:00Z',
        lastActivityAt: '2026-11-11T00:01:00Z',
        workflow: 'quick-task',
        archived: false,
      };

      // Parses without lastViewedSeq
      const parsedOld = runIndexEntrySchema.parse(baseEntry);
      expect(parsedOld.lastViewedSeq).toBeUndefined();

      // Parses with lastViewedSeq
      const parsedNew = runIndexEntrySchema.parse({ ...baseEntry, lastViewedSeq: 99 });
      expect(parsedNew.lastViewedSeq).toBe(99);

      // Rejects negative lastViewedSeq
      expect(runIndexEntrySchema.safeParse({ ...baseEntry, lastViewedSeq: -1 }).success).toBe(false);
    });
  });

  describe('(4) workspacePanesSchema and put-input schemas', () => {
    it('validates workspacePanes with run and draft panes, split none and active', () => {
      const panes = {
        threads: [
          { kind: 'run' as const, paneId: 'p-run-1', projectId: 'proj-1', runId: 'run-1' },
          { kind: 'draft' as const, paneId: 'p-draft-1', projectId: 'proj-1', draftId: 'draft-abc' },
        ],
        active: 'p-run-1',
        split: 'none' as const,
      };
      expect(workspacePanesSchema.parse(panes)).toEqual(panes);
      expect(workspacePanesInputSchema.parse(panes)).toEqual(panes);
      expect(putWorkspacePanesInputSchema.parse(panes)).toEqual(panes);
      expect(setWorkspacePanesInputSchema.parse(panes)).toEqual(panes);
    });

    it('validates workspacePanes with 2-up split', () => {
      const splitPanes = {
        threads: [
          { kind: 'run' as const, paneId: 'pane-a', projectId: 'proj-1', runId: 'run-1' },
          { kind: 'run' as const, paneId: 'pane-b', projectId: 'proj-1', runId: 'run-2' },
        ],
        active: 'pane-a',
        split: { a: 'pane-a', b: 'pane-b' },
      };
      expect(workspacePanesSchema.parse(splitPanes)).toEqual(splitPanes);
    });

    it('rejects threads exceeding max 50 items', () => {
      const threads = Array.from({ length: MAX_WORKSPACE_PANES_THREADS + 1 }, (_, i) => ({
        kind: 'run' as const,
        paneId: `pane-${i}`,
        projectId: 'proj-1',
        runId: `run-${i}`,
      }));
      expect(workspacePanesSchema.safeParse({ threads, split: 'none' }).success).toBe(false);
    });

    it('rejects unknown pane thread kind', () => {
      expect(
        workspacePanesSchema.safeParse({
          threads: [{ kind: 'unknown', paneId: 'p1', projectId: 'proj-1', runId: 'r1' }],
          split: 'none',
        }).success,
      ).toBe(false);
    });
  });
});
