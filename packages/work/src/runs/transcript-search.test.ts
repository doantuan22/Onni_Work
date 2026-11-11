import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSnippet,
  decodeSearchCursor,
  encodeSearchCursor,
  extractEventTexts,
  SearchCursorError,
  searchTranscripts,
  type CandidateRun,
} from './transcript-search.ts';

describe('transcript-search', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'onni-search-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createSnippet', () => {
    it('returns the full text when shorter than or equal to maxLength', () => {
      const text = 'short snippet with match';
      const snippet = createSnippet(text, 6, 7, 400);
      expect(snippet).toBe(text);
    });

    it('centers the snippet around the match when text exceeds maxLength', () => {
      const prefix = 'a'.repeat(300);
      const match = 'TARGET_STRING';
      const suffix = 'b'.repeat(300);
      const text = `${prefix}${match}${suffix}`;

      const matchIndex = 300;
      const snippet = createSnippet(text, matchIndex, match.length, 400);

      expect(snippet.length).toBe(400);
      expect(snippet).toContain(match);
      // Center of match should be approximately in the center of the 400 chars
      const targetInSnippet = snippet.indexOf(match);
      expect(targetInSnippet).toBeGreaterThanOrEqual(180);
      expect(targetInSnippet).toBeLessThanOrEqual(220);
    });

    it('clamps to the beginning when match is near start', () => {
      const match = 'START_TARGET';
      const text = `abc ${match} ${'z'.repeat(1000)}`;
      const snippet = createSnippet(text, 4, match.length, 400);

      expect(snippet.length).toBe(400);
      expect(snippet.startsWith('abc START_TARGET')).toBe(true);
    });

    it('clamps to the end when match is near the end', () => {
      const match = 'END_TARGET';
      const text = `${'z'.repeat(1000)} ${match} xyz`;
      const matchIndex = 1001;
      const snippet = createSnippet(text, matchIndex, match.length, 400);

      expect(snippet.length).toBe(400);
      expect(snippet.endsWith('END_TARGET xyz')).toBe(true);
    });
  });

  describe('extractEventTexts', () => {
    it('extracts text from various event shapes', () => {
      expect(extractEventTexts({ text: 'assistant reply' })).toEqual(['assistant reply']);
      expect(extractEventTexts({ message: 'system note' })).toEqual(['system note']);
      expect(extractEventTexts({ error: 'fatal error occurred' })).toEqual(['fatal error occurred']);
      expect(extractEventTexts({ output: 'command output line' })).toEqual(['command output line']);
      expect(
        extractEventTexts({
          result: { output: 'tool result output', text: 'extra tool text' },
        }),
      ).toEqual(['tool result output', 'extra tool text']);
      expect(
        extractEventTexts({
          item: {
            kind: 'tool',
            title: 'Ran git status',
            output: 'M file.ts',
            input: { command: 'git status' },
          },
        }),
      ).toEqual(['Ran git status', 'M file.ts', 'git status']);
      expect(
        extractEventTexts({
          item: {
            kind: 'message',
            text: 'Hello from assistant item',
          },
        }),
      ).toEqual(['Hello from assistant item']);
    });

    it('ignores envelope fields when searching arbitrary properties', () => {
      const event = {
        type: 'custom.event',
        seq: 42,
        ts: '2026-11-11T12:00:00Z',
        stepId: 'step-1',
        sessionId: 'sess-1',
        turnId: 'turn-1',
        customText: 'found custom data here',
      };
      expect(extractEventTexts(event)).toEqual(['found custom data here']);
    });
  });

  describe('cursor encoding and decoding', () => {
    it('encodes and decodes a search cursor payload', () => {
      const payload = {
        v: 1 as const,
        q: 'needle',
        runIndex: 3,
        runId: 'run-xyz',
        fromSeq: 42,
      };
      const encoded = encodeSearchCursor(payload);
      expect(typeof encoded).toBe('string');
      const decoded = decodeSearchCursor(encoded);
      expect(decoded).toEqual(payload);
    });

    it('throws SearchCursorError on invalid or corrupt cursor', () => {
      expect(() => decodeSearchCursor('')).toThrow(SearchCursorError);
      expect(() => decodeSearchCursor('invalid-base64-???')).toThrow(SearchCursorError);
      expect(() => decodeSearchCursor(Buffer.from('{"v":2}').toString('base64url'))).toThrow(
        SearchCursorError,
      );
      expect(() => decodeSearchCursor('a'.repeat(2049))).toThrow(SearchCursorError);
    });
  });

  describe('searchTranscripts', () => {
    it('performs case-insensitive substring search across candidate run transcripts', async () => {
      const file1 = join(tempDir, 'run-1.ndjson');
      const file2 = join(tempDir, 'run-2.ndjson');

      writeFileSync(
        file1,
        [
          JSON.stringify({ type: 'lifecycle', message: 'Task initialized', seq: 1, ts: '2026-11-11T10:00:00Z' }),
          JSON.stringify({ type: 'turn.started', turnId: 'turn_1', seq: 2, ts: '2026-11-11T10:00:01Z' }),
          JSON.stringify({ type: 'text', text: 'Investigating CONNECTION REFUSED error in api client', seq: 3, ts: '2026-11-11T10:00:02Z' }),
          JSON.stringify({ type: 'turn.completed', seq: 4, ts: '2026-11-11T10:00:03Z' }),
        ].join('\n') + '\n',
      );

      writeFileSync(
        file2,
        [
          JSON.stringify({ type: 'turn.started', turnId: 'turn_2', seq: 1, ts: '2026-11-11T11:00:00Z' }),
          JSON.stringify({
            type: 'item.completed',
            item: { kind: 'tool', title: 'Ran curl', output: 'Failed to connect: connection refused' },
            seq: 2,
            ts: '2026-11-11T11:00:01Z',
          }),
        ].join('\n') + '\n',
      );

      const candidateRuns: CandidateRun[] = [
        { projectId: 'proj-a', runId: 'run-1', filePath: file1 },
        { projectId: 'proj-b', runId: 'run-2', filePath: file2 },
      ];

      const result = await searchTranscripts({ q: 'connection refused' }, candidateRuns);

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        runId: 'run-1',
        projectId: 'proj-a',
        seq: 3,
        turnId: 'turn_1',
        snippet: 'Investigating CONNECTION REFUSED error in api client',
      });
      expect(result.items[1]).toEqual({
        runId: 'run-2',
        projectId: 'proj-b',
        seq: 2,
        turnId: 'turn_2',
        snippet: 'Failed to connect: connection refused',
      });
      expect(result.nextCursor).toBeUndefined();
    });

    it('handles special characters and literal punctuation in query', async () => {
      const file = join(tempDir, 'special.ndjson');
      writeFileSync(
        file,
        JSON.stringify({
          type: 'text',
          text: 'Debug: [WARN] (auth-test) => failed: code=401!',
          seq: 10,
          ts: '2026-11-11T10:00:00Z',
        }) + '\n',
      );

      const candidateRuns: CandidateRun[] = [
        { projectId: 'p1', runId: 'r1', filePath: file },
      ];

      const result = await searchTranscripts({ q: '[warn] (auth-test)' }, candidateRuns);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.seq).toBe(10);
      expect(result.items[0]?.snippet).toContain('[WARN] (auth-test)');
    });

    it('paginates across runs when limit is reached', async () => {
      const file1 = join(tempDir, 'p1.ndjson');
      const file2 = join(tempDir, 'p2.ndjson');

      writeFileSync(
        file1,
        [
          JSON.stringify({ type: 'text', text: 'match one', seq: 1, ts: '2026-11-11T10:00:00Z' }),
          JSON.stringify({ type: 'text', text: 'match two', seq: 2, ts: '2026-11-11T10:00:01Z' }),
          JSON.stringify({ type: 'text', text: 'match three', seq: 3, ts: '2026-11-11T10:00:02Z' }),
        ].join('\n') + '\n',
      );

      writeFileSync(
        file2,
        [
          JSON.stringify({ type: 'text', text: 'match four', seq: 10, ts: '2026-11-11T11:00:00Z' }),
          JSON.stringify({ type: 'text', text: 'match five', seq: 11, ts: '2026-11-11T11:00:01Z' }),
        ].join('\n') + '\n',
      );

      const candidateRuns: CandidateRun[] = [
        { projectId: 'p1', runId: 'r1', filePath: file1 },
        { projectId: 'p1', runId: 'r2', filePath: file2 },
      ];

      // Page 1 with limit = 2
      const page1 = await searchTranscripts({ q: 'match', limit: 2 }, candidateRuns);
      expect(page1.items).toHaveLength(2);
      expect(page1.items.map((i) => i.seq)).toEqual([1, 2]);
      expect(page1.nextCursor).toBeDefined();

      // Page 2 resuming from page 1 cursor with limit = 2
      const page2 = await searchTranscripts(
        { q: 'match', limit: 2, cursor: page1.nextCursor },
        candidateRuns,
      );
      expect(page2.items).toHaveLength(2);
      expect(page2.items[0]).toMatchObject({ runId: 'r1', seq: 3 });
      expect(page2.items[1]).toMatchObject({ runId: 'r2', seq: 10 });
      expect(page2.nextCursor).toBeDefined();

      // Page 3 resuming from page 2 cursor
      const page3 = await searchTranscripts(
        { q: 'match', limit: 2, cursor: page2.nextCursor },
        candidateRuns,
      );
      expect(page3.items).toHaveLength(1);
      expect(page3.items[0]).toMatchObject({ runId: 'r2', seq: 11 });
      expect(page3.nextCursor).toBeUndefined();
    });

    it('enforces maxRunsScanned bound and returns nextCursor to continue', async () => {
      const runs: CandidateRun[] = [];
      for (let i = 0; i < 5; i++) {
        const file = join(tempDir, `run-${i}.ndjson`);
        writeFileSync(
          file,
          JSON.stringify({ type: 'text', text: `scan item in run ${i}`, seq: 1, ts: '2026-11-11T10:00:00Z' }) + '\n',
        );
        runs.push({ projectId: 'p', runId: `run-${i}`, filePath: file });
      }

      // Bound to scanning at most 2 runs per request
      const page1 = await searchTranscripts(
        { q: 'scan item', limit: 10 },
        runs,
        { maxRunsScanned: 2 },
      );
      expect(page1.items).toHaveLength(2);
      expect(page1.items.map((i) => i.runId)).toEqual(['run-0', 'run-1']);
      expect(page1.nextCursor).toBeDefined();

      // Next page scans the next 2 runs
      const page2 = await searchTranscripts(
        { q: 'scan item', limit: 10, cursor: page1.nextCursor },
        runs,
        { maxRunsScanned: 2 },
      );
      expect(page2.items).toHaveLength(2);
      expect(page2.items.map((i) => i.runId)).toEqual(['run-2', 'run-3']);
      expect(page2.nextCursor).toBeDefined();

      // Final page finishes the remaining 1 run
      const page3 = await searchTranscripts(
        { q: 'scan item', limit: 10, cursor: page2.nextCursor },
        runs,
        { maxRunsScanned: 2 },
      );
      expect(page3.items).toHaveLength(1);
      expect(page3.items[0]?.runId).toBe('run-4');
      expect(page3.nextCursor).toBeUndefined();
    });

    it('enforces maxBytesPerRun bound without throwing', async () => {
      const file = join(tempDir, 'huge.ndjson');
      const lines: string[] = [];
      for (let i = 1; i <= 100; i++) {
        lines.push(
          JSON.stringify({
            type: 'text',
            text: `Line ${i}: long filler text with needle repeatedly mentioned`,
            seq: i,
            ts: '2026-11-11T10:00:00Z',
          }),
        );
      }
      writeFileSync(file, lines.join('\n') + '\n');

      const runs: CandidateRun[] = [{ projectId: 'p', runId: 'r-huge', filePath: file }];

      // Bounded to 300 bytes of the file
      const result = await searchTranscripts(
        { q: 'needle', limit: 50 },
        runs,
        { maxBytesPerRun: 300 },
      );

      // Should have read only the first few events before hitting 300 bytes
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.length).toBeLessThan(10);
    });

    it('never throws on missing or corrupt files (skips them)', async () => {
      const corruptFile = join(tempDir, 'corrupt.ndjson');
      writeFileSync(
        corruptFile,
        'NOT VALID JSON LINE\n{"type":"text","text":"valid hit","seq":5,"ts":"2026-11-11T10:00:00Z"}\nANOTHER CORRUPT LINE\n',
      );

      const missingFile = join(tempDir, 'does-not-exist.ndjson');

      const runs: CandidateRun[] = [
        { projectId: 'p', runId: 'r-missing', filePath: missingFile },
        { projectId: 'p', runId: 'r-corrupt', filePath: corruptFile },
      ];

      const result = await searchTranscripts({ q: 'valid hit' }, runs);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        runId: 'r-corrupt',
        seq: 5,
        snippet: 'valid hit',
      });
    });

    it('rejects cursor when query does not match cursor query', async () => {
      const cursor = encodeSearchCursor({
        v: 1,
        q: 'apple',
        runIndex: 0,
        runId: 'r1',
      });

      await expect(
        searchTranscripts({ q: 'banana', cursor }, [{ projectId: 'p', runId: 'r1', filePath: 'none' }]),
      ).rejects.toThrow(SearchCursorError);
    });

    it('returns empty items when query matches nothing', async () => {
      const file = join(tempDir, 'empty-match.ndjson');
      writeFileSync(
        file,
        JSON.stringify({ type: 'text', text: 'Some text here', seq: 1, ts: '2026-11-11T10:00:00Z' }) + '\n',
      );

      const result = await searchTranscripts(
        { q: 'non-existent-search-term' },
        [{ projectId: 'p', runId: 'r1', filePath: file }],
      );
      expect(result).toEqual({ items: [] });
    });

    it('skips candidate runs with unsafe runIds or paths escaping runsDir (QA7-A01)', async () => {
      const outsideFile = join(tempDir, 'secret.ndjson');
      writeFileSync(
        outsideFile,
        JSON.stringify({ type: 'text', text: 'secret traversal needle', seq: 1, ts: '2026-11-11T10:00:00Z' }) + '\n',
      );

      const candidateRuns: CandidateRun[] = [
        { projectId: 'p', runId: '../secret', filePath: outsideFile },
        { projectId: 'p', runId: '../../secret', filePath: outsideFile },
        { projectId: 'p', runId: '..', filePath: outsideFile },
      ];

      const result = await searchTranscripts({ q: 'secret traversal needle' }, candidateRuns);
      expect(result.items).toEqual([]);
    });
  });
});
