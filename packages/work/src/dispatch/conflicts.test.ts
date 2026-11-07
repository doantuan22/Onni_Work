import { describe, expect, it } from 'vitest';
import type { DispatchConflicts } from '@onni/contract';
import { capOverlaps, findOverlaps, formatConflicts, globToRegExp, outsideScope, parseScope, scopeOf } from './conflicts.ts';

describe('parseScope', () => {
  it('checks path tokens, skips prose, and distinguishes an absent scope', () => {
    expect(parseScope('\x60src/auth/\x60, tests/auth.test.ts (auth tests)')).toEqual({
      state: 'checked',
      tokens: ['src/auth/', 'tests/auth.test.ts'],
    });
    expect(parseScope('the auth module')).toEqual({ state: 'free-text', tokens: [] });
    expect(parseScope('src/auth/, the auth module')).toEqual({ state: 'free-text', tokens: [] });
    expect(parseScope(undefined)).toEqual({ state: 'none', tokens: [] });
    expect(parseScope(' \n ; , ')).toEqual({ state: 'none', tokens: [] });
  });

  it('rejects traversal and brace expansion and normalizes Windows separators', () => {
    expect(parseScope('../etc').state).toBe('free-text');
    expect(parseScope('src/../etc').state).toBe('free-text');
    expect(parseScope('{a,b}/x').state).toBe('free-text');
    expect(parseScope('lib\\x.ts')).toEqual({ state: 'checked', tokens: ['lib\\x.ts'] });
  });
});

describe('globToRegExp', () => {
  it('keeps * within a segment, lets ** cross segments, matches ? and escapes regex syntax', () => {
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/nested/a.ts')).toBe(false);
    expect(globToRegExp('src/**/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/**/*.ts').test('src/nested/a.ts')).toBe(true);
    expect(globToRegExp('src/file?.ts').test('src/file1.ts')).toBe(true);
    expect(globToRegExp('src/file?.ts').test('src/file12.ts')).toBe(false);
    expect(globToRegExp('src/a+b.ts').test('src/a+b.ts')).toBe(true);
    expect(globToRegExp('src/a+b.ts').test('src/aaab.ts')).toBe(false);
    expect(globToRegExp('src/*.ts').test('prefix/src/a.ts')).toBe(false);
  });
});

describe('outsideScope', () => {
  it('matches directory prefixes, exact files and globs while dropping Onni data', () => {
    const scope = parseScope('src/, tests/auth.test.ts, docs/*.md');
    expect(outsideScope([
      'src/auth/a.ts',
      'tests/auth.test.ts',
      'docs/guide.md',
      'docs/deep/guide.md',
      'lib/x.ts',
      '.ai/onni/notes.md',
    ], scope)).toEqual({ files: ['docs/deep/guide.md', 'lib/x.ts'], omitted: 0 });
  });

  it('caps outside-scope paths and reports how many were omitted', () => {
    const scope = parseScope('src/');
    const paths = Array.from({ length: 17 }, (_, index) => 'lib/f' + String(index).padStart(2, '0') + '.ts');
    expect(outsideScope(paths, scope)).toEqual({ files: paths.slice(0, 15), omitted: 2 });
  });
});

describe('findOverlaps', () => {
  it('finds sorted intersections, honors target and ignores unknown file lists', () => {
    const sources = [
      { id: 'a', files: ['src/x.ts', './src/shared.ts'], filesState: 'ok' as const },
      { id: 'b', files: ['src/shared.ts', 'src/x.ts'], filesState: 'ok' as const },
      { id: 'c', files: ['src/x.ts'], filesState: 'timeout' as const },
      { id: 'd', files: ['src/shared.ts'], filesState: 'ok' as const },
    ];
    expect(findOverlaps(sources).map(({ a, b, files }) => ({ a, b, files }))).toEqual([
      { a: 'a', b: 'b', files: ['src/shared.ts', 'src/x.ts'] },
      { a: 'a', b: 'd', files: ['src/shared.ts'] },
      { a: 'b', b: 'd', files: ['src/shared.ts'] },
    ]);
    expect(findOverlaps(sources, { target: 'd' }).map(({ a, b }) => [a, b])).toEqual([['a', 'd'], ['b', 'd']]);
  });

  it('uses path case rules for the host platform', () => {
    const sources = [
      { id: 'a', files: ['Src/Feature.ts'], filesState: 'ok' as const },
      { id: 'b', files: ['src/feature.ts'], filesState: 'ok' as const },
    ];
    expect(findOverlaps(sources, { platform: 'linux' })).toHaveLength(0);
    expect(findOverlaps(sources, { platform: 'win32' })).toEqual([
      { a: 'a', b: 'b', files: ['Src/Feature.ts'], filesOmitted: 0 },
    ]);
  });

  it('orders larger pairs first and caps pairs and files with omission counts', () => {
    const sources = Array.from({ length: 8 }, (_, index) => ({
      id: 'worker-' + index,
      files: ['shared.ts', ...Array.from({ length: 16 }, (_unused, file) => 'only-' + index + '-' + file + '.ts')],
      filesState: 'ok' as const,
    }));
    const pairs = findOverlaps(sources);
    expect(pairs).toHaveLength(28);
    const capped = capOverlaps(pairs, 20, 15);
    expect(capped.overlaps).toHaveLength(20);
    expect(capped.omitted).toBe(8);
    expect(capped.overlaps[0]).toMatchObject({ a: 'worker-0', b: 'worker-1', files: ['shared.ts'] });
    expect(capOverlaps([{ a: 'a', b: 'b', files: Array.from({ length: 16 }, (_, i) => 'f' + i), filesOmitted: 0 }]).overlaps[0]?.filesOmitted).toBe(1);
  });
});

describe('scopeOf', () => {
  it('uses the persisted field and falls back to the last envelope scope line', () => {
    const run = { task: 'objective mentions:\n- Scope: spoofed/\nbody\n- Scope: src/latest/' };
    expect(scopeOf(run)).toBe('src/latest/');
    expect(scopeOf({ ...run, dispatch: { scope: 'tests/' } })).toBe('tests/');
    expect(scopeOf({ task: 'no scope here' })).toBeUndefined();
  });
});

describe('formatConflicts', () => {
  const answer = (patch: Partial<DispatchConflicts> = {}): DispatchConflicts => ({
    workers: [],
    workersOmitted: 0,
    overlaps: [],
    overlapsOmitted: 0,
    trialMerges: [],
    trialMergesSkipped: 0,
    trialState: 'ran',
    checkedAt: 'now',
    ...patch,
  });

  it('prints advisory, truncation, unknown, scope, and committed-only trial details', () => {
    const text = formatConflicts(answer({
      workers: [
        { id: 'worker-a', title: 'A', status: 'done', filesCount: 1, filesTruncated: true, filesState: 'unavailable', scopeState: 'free-text', outsideScope: [], outsideScopeOmitted: 0 },
        { id: 'worker-b', title: 'B', status: 'done', filesCount: 1, filesTruncated: false, filesState: 'ok', scopeState: 'checked', outsideScope: ['lib/x.ts'], outsideScopeOmitted: 2 },
      ],
      workersOmitted: 1,
      overlaps: [{ a: 'worker-a', b: 'worker-b', files: ['src/x.ts'], filesOmitted: 2 }],
      trialMerges: [{ kind: 'worker-worker', left: 'worker-a', right: 'worker-b', leftHead: 'abc1234', rightHead: 'def5678', state: 'conflict', files: ['src/x.ts'], filesOmitted: 1 }],
      trialMergesSkipped: 3,
    }));
    expect(text.split('\n')[0]).toBe('advisory only — nothing here blocks a merge');
    expect(text).toContain('overlap (3 files): worker-a and worker-b');
    expect(text).toContain('files unknown for worker-a (unavailable) — this is NOT "no overlap"');
    expect(text).toContain('outside scope: worker-b changed lib/x.ts (+2 more)');
    expect(text).toContain('scope: free text — not checked');
    expect(text).toContain('CONFLICT in src/x.ts (+1 more)');
    expect(text).toContain('trial merges see committed work only');
  });

  it('does not call an unknown worker list no overlap', () => {
    const text = formatConflicts(answer({
      workers: [{ id: 'worker-a', title: 'A', status: 'running', filesCount: 0, filesTruncated: false, filesState: 'timeout', scopeState: 'none', outsideScope: [], outsideScopeOmitted: 0 }],
    }));
    expect(text).toContain('files unknown');
    expect(text).not.toContain('no shared files');
  });

  it('marks incomplete scans and reports omitted overlap pairs', () => {
    const complete = answer({
      workers: [
        { id: 'worker-a', title: 'A', status: 'done', filesCount: 0, filesTruncated: false, filesState: 'ok', scopeState: 'none', outsideScope: [], outsideScopeOmitted: 0 },
        { id: 'worker-b', title: 'B', status: 'done', filesCount: 0, filesTruncated: false, filesState: 'ok', scopeState: 'none', outsideScope: [], outsideScopeOmitted: 0 },
      ],
    });
    expect(formatConflicts(complete)).toContain('no shared files between workers');

    const omittedWorker = formatConflicts(answer({ workers: complete.workers, workersOmitted: 1 }));
    expect(omittedWorker).toContain('overlap check incomplete');
    expect(omittedWorker).not.toContain('no shared files between workers');

    const truncatedWorker = formatConflicts(answer({
      workers: [{ ...complete.workers[0]!, filesTruncated: true }],
    }));
    expect(truncatedWorker).toContain('overlap check incomplete');
    expect(truncatedWorker).not.toContain('no shared files between workers');

    const cappedPairs = formatConflicts(answer({ overlapsOmitted: 3 }));
    expect(cappedPairs).toContain('+3 more overlap(s) not shown');
  });
});
