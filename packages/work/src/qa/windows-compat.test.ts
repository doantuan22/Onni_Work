import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  agentHomePaths,
  claudeStateFilePath,
  expandTilde,
  instanceSlug,
  isAbsolutePath,
} from '../paths.ts';
import {
  isPathInsideDir,
  isSafeRunId,
  readEventsTailFromPath,
  resolveRunEventsPath,
} from '../runs/store.ts';
import { RESERVED_PROJECT_IDS, allocateProjectSlug } from '../workspace/projects.ts';

/**
 * Cross-platform hardening: the same rules must hold on a stock Windows host
 * (native `C:\…` roots, drive letters, CRLF transcripts, `%USERPROFILE%` with no
 * `$HOME`) as on POSIX. Every expectation is built with `join()` or an explicit
 * `platform`, so this file is meaningful on either CI OS.
 */

let root: string;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

function tempDir(): string {
  root = mkdtempSync(join(tmpdir(), 'onni-wincompat-'));
  return root;
}

describe('isAbsolutePath on win32', () => {
  it('accepts native roots a Windows user actually pastes', () => {
    expect(isAbsolutePath('C:\\projects\\Onni', 'win32')).toBe(true);
    expect(isAbsolutePath('C:/projects/Onni', 'win32')).toBe(true);
    expect(isAbsolutePath('c:\\projects', 'win32')).toBe(true);
    expect(isAbsolutePath('C:\\', 'win32')).toBe(true);
    expect(isAbsolutePath('\\\\server\\share\\repo', 'win32')).toBe(true);
    expect(isAbsolutePath('\\\\?\\C:\\long\\repo', 'win32')).toBe(true);
    expect(isAbsolutePath('\\\\.\\pipe\\onni', 'win32')).toBe(true);
  });

  it('refuses relative, drive-relative and home-shorthand spellings', () => {
    expect(isAbsolutePath('projects\\Onni', 'win32')).toBe(false);
    expect(isAbsolutePath('.\\repo', 'win32')).toBe(false);
    expect(isAbsolutePath('..\\repo', 'win32')).toBe(false);
    expect(isAbsolutePath('C:repo', 'win32')).toBe(false);
    expect(isAbsolutePath('~/projects', 'win32')).toBe(false);
    expect(isAbsolutePath('', 'win32')).toBe(false);
  });

  it('keeps POSIX rules on POSIX hosts', () => {
    expect(isAbsolutePath('/srv/repo', 'linux')).toBe(true);
    expect(isAbsolutePath('C:\\repo', 'linux')).toBe(false);
    expect(isAbsolutePath('~/repo', 'linux')).toBe(false);
  });
});

describe('expandTilde', () => {
  it('expands the bare home shorthand and one nested path', () => {
    expect(expandTilde('~')).toBe(homedir());
    expect(expandTilde('~/projects/app')).toBe(join(homedir(), 'projects', 'app'));
  });

  it('accepts the Windows separator on Windows — `~\\projects` is a home path there', () => {
    expect(expandTilde('~\\projects\\app', 'win32')).toBe(join(homedir(), 'projects', 'app'));
    expect(expandTilde('~\\', 'win32')).toBe(homedir());
    // The same string on POSIX stays a literal (unexpanded) path.
    expect(expandTilde('~\\projects', 'linux')).toBe('~\\projects');
  });

  it('leaves absolute paths and unknown shorthands untouched', () => {
    expect(expandTilde(join('C:', 'repo'))).toBe(join('C:', 'repo'));
    expect(expandTilde('/srv/repo')).toBe('/srv/repo');
    // `~user/…` is a shell convention onni does not implement; passing it through
    // is honest — the caller then rejects it as non-absolute instead of guessing.
    expect(expandTilde('~someone/repo')).toBe('~someone/repo');
  });
});

describe('allocateProjectSlug on Windows-shaped roots', () => {
  it('derives a safe registry id from a drive path with spaces and mixed case', () => {
    expect(allocateProjectSlug(join('C:', 'Users', 'me', 'My Project'), [])).toBe('my-project');
  });

  it('never hands out a reserved shell segment', () => {
    for (const reserved of RESERVED_PROJECT_IDS) {
      expect(allocateProjectSlug(join('C:', reserved), [])).toBe(`${reserved}-2`);
    }
  });

  it('dedupes against taken ids with a numeric suffix inside the 64-char cap', () => {
    expect(allocateProjectSlug(join('C:', 'api'), ['api-2'])).toBe('api-3');
    const long = 'a'.repeat(80);
    const first = allocateProjectSlug(join('C:', long), []);
    expect(first).toHaveLength(64);
    const second = allocateProjectSlug(join('C:', long), [first]);
    expect(second.length).toBeLessThanOrEqual(64);
    expect(second.endsWith('-2')).toBe(true);
    expect(second).not.toBe(first);
  });

  it('falls back to a stable slug for a basename no slug can represent', () => {
    expect(allocateProjectSlug(join('C:', '日本語'), [])).toBe('project');
    expect(allocateProjectSlug(join('C:', '---'), [])).toBe('project');
  });
});

describe('instanceSlug', () => {
  it('normalizes a domain into a filesystem- and systemd-safe key', () => {
    expect(instanceSlug('SHOP.Example.COM')).toBe('shop-example-com');
    expect(instanceSlug('...')).toBe('default');
    expect(instanceSlug('')).toBe('default');
    expect(instanceSlug(undefined)).toBe('default');
    expect(instanceSlug('a b/c')).toBe('a-b-c');
  });
});

describe('run ids stay inside the runs directory', () => {
  const safe = [
    '2f7b6c1e-8d4a-4f3b-9c2d-1a0b3c4d5e6f',
    'legacy-1',
    'a.b_c-1',
    'A'.repeat(128),
  ];
  const hostile = [
    '',
    '.',
    '..',
    '..\\secret',
    '../secret',
    'a..b',
    'a/b',
    'a\\b',
    'C:\\Windows\\win.ini',
    '\\\\server\\share\\x',
    'with space',
    'line\nbreak',
    'nul\0byte',
    'A'.repeat(129),
  ];

  it('accepts ordinary ids, including the old dotted spelling', () => {
    for (const id of safe) expect(isSafeRunId(id)).toBe(true);
  });

  it('refuses every traversal, separator and length violation', () => {
    for (const id of hostile) expect(isSafeRunId(id), `id=${JSON.stringify(id)}`).toBe(false);
  });

  it('resolveRunEventsPath answers a path directly under runs/ for safe ids', () => {
    const dataDir = tempDir();
    const file = resolveRunEventsPath(dataDir, safe[0]!);
    expect(file).toBe(join(dataDir, 'runs', `${safe[0]}.ndjson`));
    expect(isPathInsideDir(file!, join(dataDir, 'runs'))).toBe(true);
  });

  it('resolveRunEventsPath answers null for every hostile id', () => {
    const dataDir = tempDir();
    for (const id of hostile) expect(resolveRunEventsPath(dataDir, id)).toBeNull();
  });

  it('isPathInsideDir is not fooled by a sibling whose name starts with the parent', () => {
    const dataDir = tempDir();
    const runs = join(dataDir, 'runs');
    mkdirSync(runs, { recursive: true });
    expect(isPathInsideDir(join(runs, 'a.ndjson'), runs)).toBe(true);
    expect(isPathInsideDir(join(dataDir, 'runs-evil', 'a.ndjson'), runs)).toBe(false);
    expect(isPathInsideDir(join(dataDir, 'a.ndjson'), runs)).toBe(false);
    expect(isPathInsideDir(runs, runs)).toBe(false);
  });
});

describe('readEventsTailFromPath survives Windows-authored transcripts', () => {
  function writeTranscript(lines: string[]): { file: string; runsDir: string } {
    const dataDir = tempDir();
    const runsDir = join(dataDir, 'runs');
    mkdirSync(runsDir, { recursive: true });
    const id = '2f7b6c1e-8d4a-4f3b-9c2d-1a0b3c4d5e6f';
    const file = join(runsDir, `${id}.ndjson`);
    writeFileSync(file, lines.join(''));
    return { file, runsDir };
  }

  it('parses CRLF line endings (an editor or PowerShell rewrite)', () => {
    const { file, runsDir } = writeTranscript([
      '{"seq":1,"type":"note","ts":"2026-01-01T00:00:00.000Z"}\r\n',
      '{"seq":2,"type":"note","ts":"2026-01-01T00:00:01.000Z"}\r\n',
      '{"seq":3,"type":"note","ts":"2026-01-01T00:00:02.000Z"}\r\n',
    ]);
    const events = readEventsTailFromPath(file, 10, runsDir);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it('drops a torn final line but keeps the complete ones', () => {
    const { file, runsDir } = writeTranscript([
      '{"seq":1,"type":"note","ts":"2026-01-01T00:00:00.000Z"}\n',
      '{"seq":2,"type":"no',
    ]);
    const events = readEventsTailFromPath(file, 10, runsDir);
    expect(events.map((event) => event.seq)).toEqual([1]);
  });

  it('returns nothing for a path outside runs/ or a non-ndjson file', () => {
    const { file, runsDir } = writeTranscript(['{"seq":1,"type":"note","ts":"t"}\n']);
    expect(readEventsTailFromPath(file, 10, join(runsDir, '..', 'other'))).toEqual([]);
    expect(readEventsTailFromPath(file.replace(/\.ndjson$/, '.json'), 10, runsDir)).toEqual([]);
    expect(readEventsTailFromPath(join(runsDir, '..', 'escape.ndjson'), 10, runsDir)).toEqual([]);
  });

  it('answers [] for a non-positive count', () => {
    const { file, runsDir } = writeTranscript(['{"seq":1,"type":"note","ts":"t"}\n']);
    expect(readEventsTailFromPath(file, 0, runsDir)).toEqual([]);
    expect(readEventsTailFromPath(file, -1, runsDir)).toEqual([]);
  });
});

describe('agent homes on a native Windows environment', () => {
  const windowsHome = join('C:', 'Users', 'me');

  it('falls back to %USERPROFILE% when $HOME is absent (a stock cmd/powershell launch)', () => {
    const homes = agentHomePaths({ USERPROFILE: windowsHome });
    expect(homes.claude).toBe(join(windowsHome, '.claude'));
    expect(homes.codex).toBe(join(windowsHome, '.codex'));
    expect(homes.cursor).toBe(join(windowsHome, '.cursor'));
    expect(homes.antigravity).toBe(join(windowsHome, '.gemini'));
  });

  it('prefers $HOME when Git Bash supplies one', () => {
    const homes = agentHomePaths({ HOME: join('C:', 'msys', 'home'), USERPROFILE: windowsHome });
    expect(homes.claude).toBe(join('C:', 'msys', 'home', '.claude'));
  });

  it('honours the vendor overrides', () => {
    const homes = agentHomePaths({
      USERPROFILE: windowsHome,
      CLAUDE_CONFIG_DIR: join('D:', 'profiles', 'work'),
      CODEX_HOME: join('D:', 'codex'),
      XDG_CONFIG_HOME: join('D:', 'xdg'),
      CURSOR_CONFIG_DIR: join('D:', 'cursor'),
    });
    expect(homes.claude).toBe(join('D:', 'profiles', 'work'));
    expect(homes.codex).toBe(join('D:', 'codex'));
    expect(homes.opencodeConfig).toBe(join('D:', 'xdg', 'opencode'));
    expect(homes.cursor).toBe(join('D:', 'cursor'));
  });

  it('claudeStateFilePath reads the sibling file with no override and the inner file with one', () => {
    const env = { USERPROFILE: windowsHome };
    const defaultHome = join(windowsHome, '.claude');
    expect(claudeStateFilePath(defaultHome, env)).toBe(join(windowsHome, '.claude.json'));
    const overridden = join('D:', 'profiles', 'work');
    expect(claudeStateFilePath(overridden, { ...env, CLAUDE_CONFIG_DIR: overridden })).toBe(
      join(overridden, '.claude.json'),
    );
  });
});
