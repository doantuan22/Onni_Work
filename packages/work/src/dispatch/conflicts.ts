import {
  CONFLICTS_FILES_MAX,
  type DispatchConflictOverlap,
  type DispatchConflicts,
} from '@onni/contract';

export interface ParsedScope {
  state: 'none' | 'free-text' | 'checked';
  tokens: string[];
}

export interface ConflictFileSource {
  id: string;
  files: readonly string[];
  filesState: 'ok' | 'timeout' | 'unavailable';
}

export interface ConflictOverlap extends DispatchConflictOverlap {
  files: string[];
}

function cleanScopeToken(raw: string): string {
  return raw
    .replace(/\s+\([^()]*\)\s*$/, '')
    .trim()
    .replace(/^\x60+|\x60+$/g, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
}

function isPathLike(token: string): boolean {
  if (!token || /\s/.test(token) || /[{}]/.test(token)) return false;
  if (!/^[\w@.\-/*?\\]+$/.test(token)) return false;
  const normalized = token.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) return false;
  return /[\/\\*?]/.test(token) || /\.[^/.]+$/.test(normalized);
}

export function parseScope(scope: string | undefined): ParsedScope {
  if (scope === undefined) return { state: 'none', tokens: [] };
  const tokens = scope.split(/[\n,;]/).map(cleanScopeToken).filter(Boolean);
  if (tokens.length === 0) return { state: 'none', tokens: [] };
  if (!tokens.every(isPathLike)) return { state: 'free-text', tokens: [] };
  return { state: 'checked', tokens };
}

export function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/');
  let source = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]!;
    if (char === '*' && normalized[index + 1] === '*') {
      if (normalized[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += '.+^$()|[]\\{}'.includes(char) ? '\\' + char : char;
    }
  }
  return new RegExp(source + '$');
}

function normalizedPath(path: string, platform: NodeJS.Platform): string {
  let normalized = displayPath(path);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function displayPath(path: string): string {
  let normalized = path.replace(/\\/g, '/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  return normalized;
}

function isOnniDataPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return normalized === '.ai/onni' || normalized.startsWith('.ai/onni/');
}

function tokenMatches(path: string, token: string): boolean {
  const normalizedToken = token.replace(/\\/g, '/');
  if (/[*?]/.test(normalizedToken)) return globToRegExp(normalizedToken).test(path);
  const isDirectory = normalizedToken.endsWith('/') || !/\.[^/]+$/.test(normalizedToken);
  return isDirectory ? path.startsWith(normalizedToken.replace(/\/+$/, '') + '/') : path === normalizedToken;
}

export function outsideScope(
  paths: readonly string[],
  scope: ParsedScope,
  max = CONFLICTS_FILES_MAX,
): { files: string[]; omitted: number } {
  if (scope.state !== 'checked') return { files: [], omitted: 0 };
  const normalizedTokens = scope.tokens.map((token) => token.replace(/\\/g, '/'));
  const outside = [...new Set(paths)]
    .filter((path) => !isOnniDataPath(path))
    .filter((path) => !normalizedTokens.some((token) => tokenMatches(path.replace(/\\/g, '/'), token)))
    .sort();
  const limit = Number.isFinite(max) ? Math.max(0, Math.trunc(max)) : CONFLICTS_FILES_MAX;
  return { files: outside.slice(0, limit), omitted: Math.max(0, outside.length - limit) };
}

export function findOverlaps(
  sources: readonly ConflictFileSource[],
  opts: { target?: string; platform?: NodeJS.Platform } = {},
): ConflictOverlap[] {
  const platform = opts.platform ?? process.platform;
  const workers = sources.filter((source) => source.filesState === 'ok').slice().sort((a, b) => a.id.localeCompare(b.id));
  const pairs: ConflictOverlap[] = [];
  for (let leftIndex = 0; leftIndex < workers.length; leftIndex += 1) {
    const left = workers[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < workers.length; rightIndex += 1) {
      const right = workers[rightIndex]!;
      if (opts.target && left.id !== opts.target && right.id !== opts.target) continue;
      const leftByNormalized = new Map(left.files.map((file) => [normalizedPath(file, platform), displayPath(file)]));
      const files = [...new Set(right.files
        .filter((file) => leftByNormalized.has(normalizedPath(file, platform)))
        .map((file) => leftByNormalized.get(normalizedPath(file, platform))!))]
        .sort((a, b) => normalizedPath(a, platform).localeCompare(normalizedPath(b, platform)));
      if (files.length > 0) pairs.push({ a: left.id, b: right.id, files, filesOmitted: 0 });
    }
  }
  return pairs.sort((a, b) => b.files.length - a.files.length || a.a.localeCompare(b.a) || a.b.localeCompare(b.b));
}

export function capOverlaps(
  pairs: readonly ConflictOverlap[],
  maxPairs = 20,
  maxFiles = CONFLICTS_FILES_MAX,
): { overlaps: DispatchConflictOverlap[]; omitted: number } {
  const overlaps = pairs.slice(0, maxPairs).map((pair) => {
    const files = pair.files.slice(0, maxFiles);
    return {
      a: pair.a,
      b: pair.b,
      files,
      filesOmitted: pair.filesOmitted + Math.max(0, pair.files.length - files.length),
    };
  });
  return { overlaps, omitted: Math.max(0, pairs.length - overlaps.length) };
}

export function scopeOf(run: { dispatch?: { scope?: string }; task: string }): string | undefined {
  if (run.dispatch?.scope !== undefined) return run.dispatch.scope;
  const matches = [...run.task.matchAll(/^- Scope: (.+)$/gm)];
  return matches.at(-1)?.[1]?.trim() || undefined;
}

export function formatConflicts(answer: DispatchConflicts): string {
  const lines = ['advisory only — nothing here blocks a merge'];
  for (const worker of answer.workers) {
    if (worker.filesState !== 'ok') {
      lines.push('files unknown for ' + worker.id.slice(0, 8) + ' (' + worker.filesState + ') — this is NOT "no overlap"');
    }
  }
  for (const overlap of answer.overlaps) {
    const count = overlap.files.length + overlap.filesOmitted;
    const more = overlap.filesOmitted > 0 ? ' (+' + overlap.filesOmitted + ' more)' : '';
    lines.push('overlap (' + count + ' file' + (count === 1 ? '' : 's') + '): ' + overlap.a.slice(0, 8) + ' and ' + overlap.b.slice(0, 8) + ' both changed ' + overlap.files.join(', ') + more);
  }
  const overlapCheckIncomplete = answer.workersOmitted > 0 || answer.workers.some(
    (worker) => worker.filesState !== 'ok' || worker.filesTruncated,
  );
  if (
    answer.overlaps.length === 0 &&
    answer.overlapsOmitted === 0 &&
    answer.workers.length > 0 &&
    !overlapCheckIncomplete
  ) {
    lines.push('no shared files between workers');
  }
  if (overlapCheckIncomplete) lines.push('overlap check incomplete');
  if (answer.overlapsOmitted > 0) lines.push('+' + answer.overlapsOmitted + ' more overlap(s) not shown');
  for (const worker of answer.workers.filter((entry) => entry.scopeState === 'checked' && entry.outsideScope.length > 0)) {
    const more = worker.outsideScopeOmitted > 0 ? ' (+' + worker.outsideScopeOmitted + ' more)' : '';
    lines.push('outside scope: ' + worker.id.slice(0, 8) + ' changed ' + worker.outsideScope.join(', ') + more);
  }
  if (answer.workers.some((worker) => worker.scopeState === 'free-text')) {
    lines.push('scope: free text — not checked');
  }
  if (answer.workersOmitted > 0) lines.push('+' + answer.workersOmitted + ' more worker(s) not shown');
  for (const trial of answer.trialMerges) {
    const heads = (trial.leftHead ?? '?') + '/' + (trial.rightHead ?? '?');
    const pair = trial.left.slice(0, 8) + ' + ' + trial.right.slice(0, 8) + ' (committed state @ ' + heads + ')';
    if (trial.state === 'clean') lines.push('trial merge ' + pair + ': CLEAN');
    else if (trial.state === 'conflict') {
      const more = trial.filesOmitted > 0 ? ' (+' + trial.filesOmitted + ' more)' : '';
      lines.push('trial merge ' + pair + ': CONFLICT in ' + trial.files.join(', ') + more);
    } else if (trial.state === 'timeout') lines.push('trial merge ' + pair + ': timed out');
    else lines.push('trial merge ' + pair + ': unavailable (' + (trial.reason ?? 'unknown reason') + ')');
  }
  if (answer.trialState === 'unavailable') {
    lines.push('trial merges unavailable (' + (answer.trialReason ?? 'git merge-tree is unavailable') + ')');
  }
  if (answer.trialMergesSkipped > 0) lines.push(answer.trialMergesSkipped + ' trial merge(s) skipped by the per-call cap or time budget');
  if (answer.trialMerges.length > 0) {
    lines.push('trial merges see committed work only; uncommitted changes are in the overlap list but not in the trial');
  }
  return lines.join('\n');
}
